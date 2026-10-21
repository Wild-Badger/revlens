import argparse
import json
from pathlib import Path

from analytics.pipeline import refresh, prediction_report


def main():
    parser=argparse.ArgumentParser(description="Local RevLens analytics and reproducible public benchmarks")
    parser.add_argument("command",choices=("refresh","seed","benchmark","export-report","demo-history","examples"))
    parser.add_argument("--download",action="store_true",help="Reaggregate the official UCI workbook; raw files remain ignored")
    parser.add_argument("--output",type=Path,default=Path("analytics/reports/demo-prediction.json"))
    args=parser.parse_args()
    if args.command=="seed":
        from analytics.fixtures import seed
        result=seed()
    elif args.command=="examples":
        from analytics.fixtures import export_csv
        result=export_csv()
    elif args.command=="demo-history":
        from analytics.fixtures import capture_demo_change
        refresh();capture_demo_change();result=refresh()
        result={"status":result["status"],"revision":result["revision"]}
    elif args.command=="benchmark":
        from analytics.benchmark import run_benchmarks
        result=run_benchmarks(args.download)
    else:
        result=refresh() if args.command=="refresh" else prediction_report()
        report=result.get("prediction",result)
        if args.command=="export-report":
            from analytics.pipeline import connect
            with connect() as db:
                name=db.execute("select current_database() as name").fetchone()["name"]
                if not name.endswith("_demo") or db.execute("select count(*) as n from customers where domain is null or domain not like '%%.example'").fetchone()["n"]:
                    raise ValueError("Only the identified fictional demo may be exported to the repository")
            args.output.parent.mkdir(parents=True,exist_ok=True)
            args.output.write_text(json.dumps(report,indent=2,allow_nan=False)+"\n",encoding="utf-8")
        result={"status":report["status"],"revision":report["revision"],"completeMonths":report["coverage"]["completeMonths"],"selectedModel":report.get("selectedModel")}
    print(json.dumps(result,allow_nan=False))


if __name__=="__main__":
    main()
