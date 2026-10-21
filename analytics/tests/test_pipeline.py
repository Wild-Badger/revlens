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
    with connect() as db:
        db.execute("""insert into customers(id,name,domain,industry,company_size,country,acquisition_channel,created_at,status)
          values(%s,'Snapshot probe','probe.example','SaaS','<10','US','organic','2026-09-01','lead')""", (lead,))
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
    refresh()
    with connect() as db:
        assert db.execute("select count(*) as n from analytics_history.customer_attributes").fetchone()["n"] == 61
        db.execute("update customers set industry='Updated industry' where id=%s", (identity("customer:0"),))
        db.execute("update plans set base_price=base_price+1 where id=%s", (identity("plan:Starter"),))
        db.execute("delete from customers where id=%s", (lead,))
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
