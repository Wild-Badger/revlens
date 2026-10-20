[CmdletBinding()]
param(
    [ValidateSet('Start', 'Prepare', 'Build', 'Check')][string]$Mode = 'Start',
    [ValidateRange(1024, 65535)][int]$AppPort = 3101,
    [ValidateRange(1024, 65535)][int]$DatabasePort = 55433,
    [string]$PostgresBin = 'C:\Program Files\PostgreSQL\17\bin',
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$appRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'RevLensLocalWorkspace'
$dataRoot = Join-Path $runtimeRoot 'postgres'
$configPath = Join-Path $runtimeRoot 'owner-runtime.json'
$pgCtl = Join-Path $PostgresBin 'pg_ctl.exe'
$psql = Join-Path $PostgresBin 'psql.exe'
$pnpm = (Get-Command pnpm -ErrorAction Stop).Source
foreach ($binary in @('initdb.exe', 'pg_ctl.exe', 'psql.exe', 'createdb.exe')) {
    if (!(Test-Path -LiteralPath (Join-Path $PostgresBin $binary))) { throw "PostgreSQL executable missing: $binary" }
}
if ($AppPort -eq 3100 -or $DatabasePort -eq 55432 -or $AppPort -eq $DatabasePort) {
    throw 'Choose separate local-workspace ports; the demo uses 3100 and 55432.'
}
if ([version]((& node -p 'process.versions.node')) -lt [version]'22.12.0') { throw 'Node.js 22.12 or newer is required.' }
if ($Mode -eq 'Check') {
    Write-Host "Node/pnpm/PostgreSQL found. Local app: http://127.0.0.1:$AppPort; dedicated PostgreSQL: 127.0.0.1:$DatabasePort. No state changed."
    return
}
if (!(Test-Path -LiteralPath (Join-Path $appRoot 'node_modules'))) { throw 'Run pnpm install --frozen-lockfile --ignore-scripts from the project directory first.' }

function Invoke-Checked([string]$Tool, [string[]]$ToolArgs) {
    & $Tool @ToolArgs
    if ($LASTEXITCODE -ne 0) { throw "Command failed: $([IO.Path]::GetFileName($Tool)) (exit $LASTEXITCODE)." }
}

function New-Secret {
    $bytes = New-Object byte[] 32
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes) } finally { $random.Dispose() }
    return [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}

if (!(Test-Path -LiteralPath $configPath)) {
    if ((Test-Path -LiteralPath $runtimeRoot) -and (Get-ChildItem -LiteralPath $runtimeRoot -Force | Select-Object -First 1)) {
        throw 'Runtime folder has files but no ownership marker; refusing to adopt an unknown database.'
    }
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    # Credentials and database files inherit access only for this Windows user and SYSTEM.
    & icacls.exe $runtimeRoot /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not restrict the local runtime folder permissions.' }
    $settings = [ordered]@{
        kind = 'revlens-local-v1'; database = 'revlens_local'; user = 'revlens_local_owner'
        databasePort = $DatabasePort; appPort = $AppPort
        password = New-Secret; authSecret = New-Secret
    }
    [IO.File]::WriteAllText($configPath, ($settings | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
}
try { $settings = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json }
catch { throw 'The private local runtime configuration is unreadable; no database was changed.' }
if ($settings.kind -ne 'revlens-local-v1' -or $settings.database -ne 'revlens_local' -or $settings.user -ne 'revlens_local_owner' -or
    $settings.databasePort -ne $DatabasePort -or $settings.appPort -ne $AppPort -or
    $settings.password -notmatch '^[a-f0-9]{64}$' -or $settings.authSecret -notmatch '^[a-f0-9]{64}$') {
    throw 'Local runtime marker/ports are inconsistent; no database was changed.'
}

$localEnv = @{
    DATABASE_URL = "postgresql://$($settings.user):$($settings.password)@127.0.0.1:$DatabasePort/$($settings.database)?schema=public"
    AUTH_SECRET = $settings.authSecret; AUTH_URL = "http://127.0.0.1:$AppPort"; AUTH_TRUST_HOST = 'true'
    LOCAL_WORKSPACE_MODE = 'true'; NEXT_PUBLIC_LOCAL_WORKSPACE_MODE = 'true'
    DEMO_MODE = 'false'; NEXT_PUBLIC_DEMO_MODE = 'false'; DEMO_AS_OF = ''
    AUTH_GITHUB_ID = ''; AUTH_GITHUB_SECRET = ''; NEXT_TELEMETRY_DISABLED = '1'
    PGPASSWORD = $settings.password
}
$previousEnv = @{}
foreach ($key in $localEnv.Keys) {
    $previousEnv[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    [Environment]::SetEnvironmentVariable($key, $localEnv[$key], 'Process')
}
Push-Location $appRoot
try {
    if (!(Test-Path -LiteralPath (Join-Path $dataRoot 'PG_VERSION'))) {
        if ((Test-Path -LiteralPath $dataRoot) -and (Get-ChildItem -LiteralPath $dataRoot -Force | Select-Object -First 1)) {
            throw 'PostgreSQL data directory is not empty; refusing to initialize over it.'
        }
        $passwordFile = Join-Path $runtimeRoot 'initdb-password.tmp'
        try {
            [IO.File]::WriteAllText($passwordFile, $settings.password, [Text.UTF8Encoding]::new($false))
            Invoke-Checked (Join-Path $PostgresBin 'initdb.exe') @('-D', $dataRoot, '--username', $settings.user, '--pwfile', $passwordFile, '-A', 'scram-sha-256', '--encoding', 'UTF8', '--locale', 'C')
        } finally {
            if (Test-Path -LiteralPath $passwordFile) { Remove-Item -LiteralPath $passwordFile }
        }
    }
    & $pgCtl status -D $dataRoot 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        $logPath = Join-Path $runtimeRoot 'postgres.log'
        $pgProcess = Start-Process -FilePath $pgCtl -ArgumentList @('-D', "`"$dataRoot`"", '-l', "`"$logPath`"", '-o', "`"-h 127.0.0.1 -p $DatabasePort`"", '-w', 'start') -WindowStyle Hidden -PassThru
        # Wait only for pg_ctl; Start-Process -Wait also waits for its long-lived PostgreSQL descendant on Windows.
        $pgProcess.WaitForExit()
        if ($pgProcess.ExitCode -ne 0) { throw 'Dedicated PostgreSQL did not start. Check its local postgres.log; no alternate database will be used.' }
    }
    $exists = & $psql -h 127.0.0.1 -p $DatabasePort -U $settings.user -d postgres --no-password -t -A -v ON_ERROR_STOP=1 -c "SELECT 1 FROM pg_database WHERE datname = 'revlens_local'"
    if ($LASTEXITCODE -ne 0) { throw 'Could not authenticate to the dedicated local cluster.' }
    if ($exists -ne '1') {
        Invoke-Checked (Join-Path $PostgresBin 'createdb.exe') @('-h', '127.0.0.1', '-p', "$DatabasePort", '-U', $settings.user, '--no-password', '--owner', $settings.user, $settings.database)
    }
    $identity = & $psql -h 127.0.0.1 -p $DatabasePort -U $settings.user -d $settings.database --no-password -t -A -v ON_ERROR_STOP=1 -c "SELECT current_database() || ':' || current_user"
    if ($LASTEXITCODE -ne 0 -or $identity -ne 'revlens_local:revlens_local_owner') { throw 'Dedicated database identity check failed; migrations were not run.' }
    Invoke-Checked $pnpm @('exec', 'prisma', 'generate')
    Invoke-Checked $pnpm @('exec', 'prisma', 'migrate', 'deploy')
    if ($Mode -eq 'Prepare') { Write-Host 'Local workspace prepared; existing local data retained. No synthetic seed was run.'; return }
    if (!$SkipBuild -or $Mode -eq 'Build') { Invoke-Checked $pnpm @('build') }
    if ($Mode -eq 'Build') { return }
    if (!(Test-Path -LiteralPath (Join-Path $appRoot '.next-local\BUILD_ID'))) { throw 'Local build is missing. Run without -SkipBuild first.' }
    Write-Host "Open http://127.0.0.1:$AppPort/signup to create the first local owner; returning owners use /login. Ctrl+C stops the app."
    Invoke-Checked $pnpm @('exec', 'next', 'start', '--hostname', '127.0.0.1', '--port', "$AppPort")
} finally {
    Pop-Location
    foreach ($key in $previousEnv.Keys) { [Environment]::SetEnvironmentVariable($key, $previousEnv[$key], 'Process') }
}
