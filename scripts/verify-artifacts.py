"""Compare a fresh pipeline run to the versioned release, allowing numerical solver variation."""
import json
from pathlib import Path
import subprocess

for path in sorted(Path("analytics/reports").glob("*.json")):
    expected = json.loads(subprocess.check_output(["git", "show", f"HEAD:{path.as_posix()}"], text=True, encoding="utf-8"))
    actual = json.loads(path.read_text(encoding="utf-8"))
    for field in ("dataHash", "methodVersion", "status", "selectedModel"):
        assert actual[field] == expected[field], f"{path}: changed {field}; review and version the new release"
    assert actual["history"] == expected["history"], f"{path}: changed monthly input"
    if path.name == "demo-prediction.json":
        # BLAS/platform differences can move an ETS optimizer near a parameter boundary.
        assert abs(actual["test"]["selected"]["mae"] - expected["test"]["selected"]["mae"]) <= max(.01, expected["test"]["selected"]["mae"] * .01)
        for fresh, frozen in zip(actual["forecast"], expected["forecast"], strict=True):
            assert fresh["month"] == frozen["month"]
            assert abs(fresh["predicted"] - frozen["predicted"]) <= max(.02, frozen["predicted"] * .0001)
    print(f"Verified versioned artifact: {path.name}")
