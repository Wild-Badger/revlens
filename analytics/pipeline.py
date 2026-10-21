"""Bounded local pipeline. PostgreSQL serializes imports, restores and dbt snapshots."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import threading
from datetime import date, timezone
from urllib.parse import urlparse, urlunparse

import psycopg
from psycopg.rows import dict_row

from analytics.forecast import evaluate_series

ROOT = Path(__file__).resolve().parent.parent
LOCK = threading.Lock()


class PipelineError(Exception):
    pass


def database_url() -> str:
    value = urlparse(os.environ.get("DATABASE_URL", ""))
    if value.scheme not in ("postgresql", "postgres") or value.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise PipelineError("Configure a loopback PostgreSQL database")
    return urlunparse(value._replace(query=""))


def connect():
    return psycopg.connect(database_url(), row_factory=dict_row, autocommit=True, options="-c timezone=UTC")


def runtime_dir() -> Path:
    path = Path(os.environ.get("REV_ANALYTICS_RUNTIME", ROOT / "analytics" / "runtime"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def dbt_environment() -> dict:
    url = urlparse(database_url())
    from urllib.parse import unquote
    return {**os.environ, "DBT_HOST": url.hostname, "DBT_PORT": str(url.port or 5432),
            "DBT_USER": unquote(url.username or ""), "DBT_PASSWORD": unquote(url.password or ""),
            "DBT_DATABASE": url.path.lstrip("/"), "DBT_SEND_ANONYMOUS_USAGE_STATS": "false", "PGOPTIONS": "-c timezone=UTC",
            "DBT_LOG_PATH": str(runtime_dir() / "dbt-logs"), "DBT_TARGET_PATH": str(runtime_dir() / "dbt-target")}


def read_series(db, require_ready: bool = True):
    metadata = db.execute("select * from dataset_metadata where id='local'").fetchone()
    if not metadata:
        return None, []
    if require_ready and (metadata["analytics_revision"] != metadata["revision"] or metadata["pipeline_status"] != "ready"):
        raise PipelineError("Data saved; analytics pending. Retry the local refresh.")
    rows = db.execute("""select month::text, sum(mrr)::float8 as value
        from analytics.mart_mrr_by_month
        where scope_plan='' and is_complete and month >= %s
        group by month order by month""", (metadata["history_start"] or date(1,1,1),)).fetchall()
    return metadata, rows[-120:]


def prediction_report(require_ready: bool = True) -> dict:
    with connect() as db:
        with db.transaction():
            db.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            metadata, rows = read_series(db, require_ready)
    if metadata:
        return evaluate_series(rows, source=metadata["source_name"], revision=metadata["revision"],
                               as_of=metadata["as_of"].replace(tzinfo=timezone.utc).isoformat(), coverage_confirmed=metadata["history_complete"])
    return evaluate_series([], coverage_confirmed=False)


def refresh(expected_revision: int | None = None) -> dict:
    if not LOCK.acquire(blocking=False):
        raise PipelineError("An analytics refresh is already running")
    try:
        with connect() as db:
            # Same advisory key as the transactional import/restore paths.
            db.execute("select pg_advisory_lock(20261020,2)")
            metadata = db.execute("select * from dataset_metadata where id='local'").fetchone()
            revision = metadata["revision"] if metadata else 0
            if expected_revision is not None and revision != expected_revision:
                raise PipelineError("Dataset changed; request a fresh analytics refresh")
            db.execute("update dataset_metadata set pipeline_status='pending' where id='local'")
            try:
                result = subprocess.run(["dbt", "build", "--project-dir", str(ROOT / "dbt"), "--profiles-dir", str(ROOT / "dbt"),
                                         "--no-use-colors"], env=dbt_environment(), capture_output=True, text=True, timeout=120)
                (runtime_dir() / "dbt-last.log").write_text(result.stdout + result.stderr, encoding="utf-8")
                if result.returncode:
                    raise PipelineError("dbt checks failed. Inspect the private local analytics log, then retry.")
                db.execute("update dataset_metadata set analytics_revision=revision,pipeline_status='ready' where id='local'")
                report = prediction_report()
                (runtime_dir() / "prediction.json").write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8")
                return {"status": "ready", "revision": revision, "prediction": report}
            except Exception:
                db.execute("update dataset_metadata set pipeline_status='failed' where id='local'")
                raise
    finally:
        LOCK.release()


def cached_prediction() -> dict:
    with connect() as db:
        with db.transaction():
            db.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            metadata, _ = read_series(db)
    path = runtime_dir() / "prediction.json"
    if metadata and path.exists():
        report = json.loads(path.read_text(encoding="utf-8"))
        if report.get("revision") == metadata["revision"] and report.get("source") == metadata["source_name"]:
            return report
    return prediction_report()
