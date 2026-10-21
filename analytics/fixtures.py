"""Deterministic fictional subscription intervals; restricted to disposable databases."""
from datetime import datetime, timezone
from decimal import Decimal
import random
import uuid

from analytics.forecast import add_months
from analytics.pipeline import connect

AS_OF = "2026-09-30T23:59:59.999000+00:00"
START = "2022-10-01"


def identity(value):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "https://revlens.example/" + value))


def seed():
    rng = random.Random(42)
    with connect() as db:
        name = db.execute("select current_database() as name").fetchone()["name"]
        if not name.endswith(("_demo", "_test")):
            raise ValueError("Synthetic seed only accepts a dedicated *_demo or *_test database")
        if db.execute("select count(*) as n from customers where domain is null or domain not like '%%.example'").fetchone()["n"]:
            raise ValueError("Refusing to replace non-fictional customer records")
        with db.transaction():
            db.execute("select pg_advisory_xact_lock(20261020,2)")
            db.execute("truncate payments,product_events,invoices,subscriptions,customers,plans,dataset_metadata cascade")
            for table in ("customer_attributes", "plan_attributes"):
                if db.execute("select to_regclass(%s) as relation", (f"analytics_history.{table}",)).fetchone()["relation"]:
                    db.execute(f"truncate analytics_history.{table}")
            for plan, amount in (("Starter", 49), ("Growth", 199), ("Enterprise", 599)):
                db.execute("insert into plans(id,name,billing_interval,base_price,seat_price,created_at) values(%s,%s,'monthly',%s,10,%s)",
                           (identity("plan:" + plan), plan, amount, START))
            intervals_count = 0
            for i in range(60):
                cid = identity(f"customer:{i}")
                begin = 0 if i < 12 else rng.randrange(1, 43)
                active, returned, intervals = True, False, []
                start = begin
                plan = rng.choice(("Starter", "Growth", "Enterprise"))
                amount = Decimal({"Starter": 49, "Growth": 199, "Enterprise": 599}[plan] + rng.randrange(1, 9) * 10)
                current = amount
                for month in range(begin + 1, 48):
                    if active and rng.random() < .025:
                        intervals.append((start, month, current, plan)); active = False
                    elif not active and rng.random() < .10:
                        start = month; active = True; returned = True
                    elif active and rng.random() < .08:
                        intervals.append((start, month, current, plan)); start = month
                        current = max(Decimal(29), (current * Decimal(str(rng.choice((.85, 1.10, 1.25))))).quantize(Decimal(".01")))
                if active:
                    intervals.append((start, None, current, plan))
                status = ("reactivated" if returned else "active") if active else "churned"
                industry = ("SaaS", "Fintech", "Healthcare", "E-commerce")[i % 4]
                created = add_months(START, begin)
                ended = add_months(START, intervals[-1][1]) if not active else None
                db.execute("""insert into customers(id,name,domain,industry,company_size,country,acquisition_channel,created_at,converted_at,churned_at,status)
                    values(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (cid, f"Example Company {i+1:02}", f"company-{i+1:02}.example", industry, ("<10", "10-50", "50-200")[i % 3],
                     ("US", "GB", "CA")[i % 3], ("organic", "paid", "referral", "partner")[i % 4], created, created, ended, status))
                for j, (first, last, mrr, catalog) in enumerate(intervals):
                    sid = identity(f"interval:{i}:{j}")
                    started = add_months(START,first)
                    finished = add_months(START,last) if last is not None else None
                    if i % 5 == 0:
                        if j: started = started[:8] + "15"
                        if finished: finished = finished[:8] + "15"
                    db.execute("""insert into subscriptions(id,customer_id,plan_id,status,started_at,ended_at,billing_interval,current_mrr,seats)
                        values(%s,%s,%s,%s,%s,%s,'monthly',%s,3)""",
                        (sid,cid,identity("plan:" + catalog),"active" if last is None else "cancelled",started,finished,mrr))
                    intervals_count += 1
                last_start,last_end,mrr,_ = intervals[-1]
                invoice_date = max(started,add_months(START, 47 if active else max(last_start, last_end-1)))
                paid = not active or i % 7 != 0
                invoice = identity(f"invoice:{i}")
                db.execute("""insert into invoices(id,customer_id,subscription_id,amount,currency,status,invoice_date,paid_at,failed_at)
                    values(%s,%s,%s,%s,'USD',%s,%s,%s,%s)""",
                    (invoice,cid,identity(f"interval:{i}:{len(intervals)-1}"),mrr,"paid" if paid else "failed",invoice_date,invoice_date if paid else None,None if paid else invoice_date))
                if paid:
                    db.execute("insert into payments(id,invoice_id,customer_id,amount,status,payment_method,processed_at) values(%s,%s,%s,%s,'succeeded','card',%s)",
                               (identity(f"payment:{i}"),invoice,cid,mrr,invoice_date))
                if active:
                    for event in range(2 + i % 5):
                        db.execute("insert into product_events(customer_id,event_name,properties,timestamp) values(%s,%s,'{}',%s)",
                                   (cid,"feature_used" if event else "login",f"2026-09-{5+event:02}T12:00:00Z"))
            db.execute("""insert into dataset_metadata(id,source_id,source_name,as_of,imported_at,row_count,history_start,history_complete,revision,analytics_revision,pipeline_status)
                values('local',%s,'Fictional subscriptions · seed 42',%s,%s,%s,%s,true,1,-1,'pending')""",
                (identity("source:demo"),AS_OF,datetime.now(timezone.utc),intervals_count,START))
    return {"customers":60,"intervals":intervals_count,"completeMonths":48,"asOf":AS_OF}


def capture_demo_change():
    with connect() as db:
        if not db.execute("select current_database() as name").fetchone()["name"].endswith("_demo"):
            raise ValueError("Demonstration changes require a disposable *_demo database")
        if db.execute("select count(*) as n from customers where domain is null or domain not like '%%.example'").fetchone()["n"]:
            raise ValueError("Only fictional .example accounts may be changed")
        with db.transaction():
            db.execute("select pg_advisory_xact_lock(20261020,2)")
            db.execute("update customers set industry='Developer Tools' where id=%s",(identity("customer:0"),))
            db.execute("update plans set base_price=59 where id=%s",(identity("plan:Starter"),))
            db.execute("update dataset_metadata set revision=revision+1,pipeline_status='pending' where id='local'")
