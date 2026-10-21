"""Opt-in checks against an explicitly disposable local PostgreSQL database."""
import os
from pathlib import Path
import subprocess
from types import SimpleNamespace

import pytest

from analytics.fixtures import identity, seed
from analytics.pipeline import PipelineError, connect, refresh


@pytest.mark.skipif(not os.environ.get("REV_TEST_DATABASE_URL"), reason="Set REV_TEST_DATABASE_URL to a migrated *_test database")
def test_postgres_reconciliation_snapshots_and_recovery(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", os.environ["REV_TEST_DATABASE_URL"])
    monkeypatch.setenv("REV_ANALYTICS_RUNTIME", str(tmp_path))
    with connect() as db:
        assert db.execute("select current_database() as name").fetchone()["name"].endswith("_test")
    seed()
    lead = identity("scd2-lead")
    plan_probe = identity("scd2-plan-probe")
    with connect() as db:
        db.execute("""insert into customers(id,name,domain,industry,company_size,country,acquisition_channel,created_at,status)
          values(%s,'Snapshot probe','probe.example','SaaS','<10','US','organic','2026-09-01','lead')""", (lead,))
    with connect() as db:
        db.execute("insert into plans(id,name,billing_interval,base_price,seat_price,created_at) values(%s,'Snapshot plan probe','monthly',0,0,'2022-10-01')", (plan_probe,))
    first = refresh()
    assert first["prediction"]["coverage"]["completeMonths"] == 48
    assert first["prediction"]["status"] == "ready"
    with connect() as db:
        for row in db.execute("""select month,sum(mrr) as value from analytics.mart_mrr_by_month
                    where scope_plan='' group by month order by month""").fetchall():
            raw = db.execute("""select coalesce(sum(current_mrr),0) as value from subscriptions
                 where started_at < %s::date+interval '1 month' and (ended_at is null or ended_at >= %s::date+interval '1 month')""", (row["month"],row["month"])).fetchone()
            assert row["value"] == raw["value"]
        assert db.execute("select count(*) as n from analytics_history.customer_attributes").fetchone()["n"] == 61
    # A launcher-owned Python process must work without shell activation or PATH lookup.
    with monkeypatch.context() as patch:
        patch.setenv("PATH", "")
        refresh()
    with connect() as db:
        assert db.execute("select count(*) as n from analytics_history.customer_attributes").fetchone()["n"] == 61
        db.execute("update customers set industry='Updated industry' where id=%s", (identity("customer:0"),))
        db.execute("update plans set base_price=base_price+1 where id=%s", (identity("plan:Starter"),))
        db.execute("delete from customers where id=%s", (lead,))
        db.execute("delete from plans where id=%s", (plan_probe,))
        db.execute("update dataset_metadata set revision=revision+1,pipeline_status='pending' where id='local'")
    refresh()
    with connect() as db:
        assert db.execute("select count(*) as n from analytics_history.customer_attributes where customer_id=%s", (identity("customer:0"),)).fetchone()["n"] == 2
        assert db.execute("select count(*) as n from analytics_history.plan_attributes where plan_id=%s", (identity("plan:Starter"),)).fetchone()["n"] == 2
        assert db.execute("select dbt_is_deleted from analytics_history.customer_attributes where customer_id=%s and dbt_valid_to is null", (lead,)).fetchone()["dbt_is_deleted"] in (True,"True")
        db.execute("""insert into customers(id,name,domain,industry,company_size,country,acquisition_channel,created_at,status)
          values(%s,'Snapshot probe','probe.example','SaaS','<10','US','organic','2026-09-01','lead')""", (lead,))
        db.execute("update dataset_metadata set revision=revision+1,pipeline_status='pending' where id='local'")
    refresh()
    with connect() as db:
        assert db.execute("select count(*) as n from analytics_history.customer_attributes where customer_id=%s", (lead,)).fetchone()["n"] == 3
    with connect() as db:
        assert db.execute("select dbt_is_deleted from analytics_history.plan_attributes where plan_id=%s and dbt_valid_to is null", (plan_probe,)).fetchone()["dbt_is_deleted"] in (True, "True")
        db.execute("insert into plans(id,name,billing_interval,base_price,seat_price,created_at) values(%s,'Snapshot plan probe','monthly',0,0,'2022-10-01')", (plan_probe,))
        db.execute("update dataset_metadata set revision=revision+1,pipeline_status='pending' where id='local'")
    refresh()
    with connect() as db:
        assert db.execute("select count(*) as n from analytics_history.plan_attributes where plan_id=%s", (plan_probe,)).fetchone()["n"] == 3
    # A failed external process leaves the committed data and a retryable persisted state.
    with monkeypatch.context() as patch:
        patch.setattr(subprocess,"run",lambda *args,**kwargs:SimpleNamespace(returncode=1,stdout="synthetic process failure",stderr=""))
        with pytest.raises(PipelineError):
            refresh()
    with connect() as db:
        assert db.execute("select pipeline_status from dataset_metadata").fetchone()["pipeline_status"] == "failed"
        assert db.execute("select count(*) as n from customers").fetchone()["n"] == 61
    refresh()
    with connect() as db:
        assert db.execute("select pipeline_status from dataset_metadata").fetchone()["pipeline_status"] == "ready"


@pytest.mark.skipif(not os.environ.get("REV_TEST_DATABASE_URL"), reason="Requires disposable PostgreSQL")
def test_actual_process_interruption_is_recoverable(monkeypatch, tmp_path):
    import signal
    import sys
    import time
    monkeypatch.setenv("DATABASE_URL", os.environ["REV_TEST_DATABASE_URL"])
    monkeypatch.setenv("REV_ANALYTICS_RUNTIME", str(tmp_path))
    seed(); refresh()
    with connect() as db:
        count_before = db.execute("select count(*) as n from analytics_history.customer_attributes").fetchone()["n"]
        db.execute("update customers set industry='Interrupted capture' where id=%s", (identity("customer:0"),))
        db.execute("update dataset_metadata set revision=revision+1,pipeline_status='pending' where id='local'")
    # Hold a raw-table lock so the REAL dbt child is provably executing and waiting, not a simulated failure.
    with connect() as blocker:
        with blocker.transaction():
            blocker.execute("lock table customers in access exclusive mode")
            child = subprocess.Popen([sys.executable, "-m", "analytics.cli", "refresh"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                     start_new_session=os.name != "nt")
            try:
                deadline = time.monotonic() + 45
                blocked = False
                while time.monotonic() < deadline:
                    with connect() as observer:
                        blocked = observer.execute("select exists(select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and query ilike '%%customers%%') as blocked").fetchone()["blocked"]
                    if blocked: break
                    assert child.poll() is None, "Pipeline exited before the interruption probe"
                    time.sleep(.1)
                assert blocked, "The real dbt process never reached the raw data lock"
            finally:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(child.pid), "/T", "/F"], check=True, capture_output=True)
                else:
                    os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=15)
    with connect() as db:
        assert db.execute("select count(*) as n from customers").fetchone()["n"] == 60
        assert db.execute("select pipeline_status from dataset_metadata").fetchone()["pipeline_status"] == "pending"
    refresh(); refresh()
    with connect() as db:
        assert db.execute("select pipeline_status from dataset_metadata").fetchone()["pipeline_status"] == "ready"
        assert db.execute("select count(*) as n from analytics_history.customer_attributes").fetchone()["n"] == count_before + 1
        assert db.execute("select count(*) as n from analytics_history.customer_attributes where customer_id=%s and dbt_valid_to is null", (identity("customer:0"),)).fetchone()["n"] == 1
