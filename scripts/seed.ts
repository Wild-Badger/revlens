import { spawnSync } from "node:child_process";
// The Python seed refuses non-disposable databases and non-fictional records.
const result = spawnSync("uv", ["run", "python", "-m", "analytics.cli", "seed"], { stdio: "inherit", env: process.env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
