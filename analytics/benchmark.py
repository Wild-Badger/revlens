"""Public real-data benchmark, deliberately separate from subscription MRR."""
from collections import Counter, defaultdict
from datetime import datetime
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import urllib.request
import zipfile

import numpy as np

from analytics.forecast import add_months, evaluate_series

ROOT = Path(__file__).resolve().parent
SOURCE = "https://archive.ics.uci.edu/static/public/502/online%2Bretail%2Bii.zip"


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value,indent=2,allow_nan=False)+"\n",encoding="utf-8")


def aggregate_retail(download=False):
    aggregate = ROOT / "data" / "retail-monthly.json"
    if aggregate.exists() and not download:
        return json.loads(aggregate.read_text(encoding="utf-8"))
    from openpyxl import load_workbook
    raw = ROOT / "data" / "raw"
    raw.mkdir(parents=True,exist_ok=True)
    archive = raw / "online-retail-ii.zip"
    if not archive.exists():
        with urllib.request.urlopen(SOURCE,timeout=60) as response, archive.open("wb") as output:
            while block := response.read(1024*1024):
                output.write(block)
    zip_hash = hashlib.sha256(archive.read_bytes()).hexdigest()
    with zipfile.ZipFile(archive) as zipped:
        member = next(name for name in zipped.namelist() if name.endswith(".xlsx"))
        workbook_path = raw / Path(member).name
        if not workbook_path.exists():
            workbook_path.write_bytes(zipped.read(member))
    totals, counts = defaultdict(Decimal), Counter()
    book = load_workbook(workbook_path, read_only=True, data_only=True)
    for sheet in book:
        values = sheet.iter_rows(values_only=True)
        headers = [str(value) for value in next(values)]
        date_index,quantity_index = headers.index("InvoiceDate"),headers.index("Quantity")
        price_index = headers.index("Price") if "Price" in headers else headers.index("UnitPrice")
        for row in values:
            counts["sourceRows"] += 1
            at = row[date_index]
            if not isinstance(at,datetime):
                counts["invalidDate"] += 1; continue
            try:
                quantity,price = Decimal(str(row[quantity_index])),Decimal(str(row[price_index]))
                if not quantity.is_finite() or not price.is_finite() or price < 0:
                    raise InvalidOperation
            except (InvalidOperation,ValueError):
                counts["invalidNumericOrNegativePrice"] += 1; continue
            key = at.strftime("%Y-%m-01")
            if not "2009-12-01" <= key <= "2011-11-01":
                counts["partialPeriodRowsExcluded"] += 1; continue
            totals[key] += quantity*price
            counts["includedRows"] += 1
            if quantity < 0:
                counts["returnRowsIncluded"] += 1
    book.close()
    result = {"target":"net_invoiced_sales","currency":"GBP","source":"UCI Online Retail II",
              "sourceUrl":"https://archive.ics.uci.edu/dataset/502/online%2Bretail%2Bii",
              "downloadUrl":SOURCE,"sourceSha256":zip_hash,"license":"CC BY 4.0",
              "attribution":"Chen, D. (2012). Online Retail II. UCI. https://doi.org/10.24432/C5CG6D",
              "rules":["Signed quantity × nonnegative unit price; returns included.",
                       "Rows with missing customer IDs remain: customer identity is not needed for aggregate sales.",
                       "Exact repeated lines retained: no trustworthy line ID is supplied.",
                       "December 2011 excluded because observation stops on December 9.",
                       "GBP sales are not USD MRR and are never imported as subscriptions."],
              "counts":dict(counts),"rows":[{"month":month,"value":float(value.quantize(Decimal('.01')))} for month,value in sorted(totals.items())]}
    result["aggregateSha256"] = hashlib.sha256(json.dumps(result["rows"],sort_keys=True,separators=(",",":")).encode()).hexdigest()
    write_json(aggregate,result)
    return result


def run_benchmarks(download=False):
    dataset = aggregate_retail(download)
    report = evaluate_series(dataset["rows"],target=dataset["target"],currency=dataset["currency"],source=dataset["source"],as_of="2011-11-30")
    report["provenance"] = {key:value for key,value in dataset.items() if key != "rows"}
    write_json(ROOT / "reports" / "retail-benchmark.json",report)
    regimes = {}
    for label,seed in (("stable",42),("growth",43),("decline_with_break",44)):
        rng = np.random.default_rng(seed)
        values = []
        for i in range(48):
            trend = 10000 if label=="stable" else 5000+i*200 if label=="growth" else 18000-i*100-(3500 if i>=35 else 0)
            values.append(round(max(0,trend+rng.normal(0,250)),2))
        result = evaluate_series([{"month":add_months("2022-10-01",i),"value":value} for i,value in enumerate(values)],source=f"Synthetic stress case: {label}; seed {seed}",as_of="2026-09-30")
        result["fixture"] = {"seed":seed,"regime":label,"noiseStd":250,"months":48,"synthetic":True}
        write_json(ROOT / "reports" / f"stress-{label}.json",result)
        regimes[label] = {"status":result["status"],"selectedModel":result.get("selectedModel"),"test":result.get("test",{}).get("selected")}
    return {"realBenchmark":report["status"],"realSelectedModel":report.get("selectedModel"),"stress":regimes}
