$ErrorActionPreference = 'Stop'
$scriptPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\scripts\start-local.ps1'))
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'RevLensLocalWorkspace'
$before = if (Test-Path -LiteralPath $runtimeRoot) { (Get-Item -LiteralPath $runtimeRoot).LastWriteTimeUtc } else { $null }
$parseErrors = $null
$scriptAst = [Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$null, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors.Message -join '; ') }
& $scriptPath -Mode Check
foreach ($case in @(@{ AppPort = 3100 }, @{ DatabasePort = 55432 }, @{ AppPort = 3102; DatabasePort = 3102 })) {
    $rejected = $false
    try { & $scriptPath -Mode Check @case }
    catch { $rejected = $_.Exception.Message -like 'Choose separate local-workspace ports*' }
    if (!$rejected) { throw 'An unsafe/conflicting port was not rejected.' }
}
$after = if (Test-Path -LiteralPath $runtimeRoot) { (Get-Item -LiteralPath $runtimeRoot).LastWriteTimeUtc } else { $null }
if ($before -ne $after) { throw 'Check mode modified runtime state.' }

# Execute the real launch branch with a fake direct process: never start/stop PostgreSQL in this regression.
$branch = $scriptAst.Find({ param($node)
    $node -is [Management.Automation.Language.IfStatementAst] -and $node.Extent.Text -match '\$pgProcess = Start-Process'
}, $true).Clauses[0].Item2.Extent.Text
$launch = [scriptblock]::Create($branch.Substring(1, $branch.Length - 2))
function Start-Process {
    param($FilePath, $ArgumentList, $WindowStyle, [switch]$PassThru, [switch]$Wait)
    if ($Wait -or $WindowStyle -ne 'Hidden' -or !$PassThru) { throw 'Invalid process-launch lifecycle: never wait for the PostgreSQL descendant tree.' }
    $fake = [pscustomobject]@{ ExitCode = $null }
    $fake | Add-Member ScriptMethod WaitForExit { $script:waitCalls++; $this.ExitCode = $script:fakeExitCode }
    return $fake
}
$pgCtl = 'not-executed'
$dataRoot = 'not-executed'
$DatabasePort = 55433
foreach ($script:fakeExitCode in @(0, 7)) {
    $script:waitCalls = 0
    $failed = $false
    try { & $launch }
    catch {
        if ($_.Exception.Message -notlike 'Dedicated PostgreSQL did not start*') { throw }
        $failed = $true
    }
    if ($script:waitCalls -ne 1 -or $failed -ne ($script:fakeExitCode -ne 0)) { throw 'Direct-process completion/exit-code check regressed.' }
}
Write-Host 'Startup syntax, prerequisite checks, reserved-port guards, no-write check mode and direct-process wait regression passed.'
