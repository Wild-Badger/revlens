"""Build the case from structured copy + evaluated reports, never README parsing.

Requires reportlab (PDF) and pypdfium2 (rendered verification).
Outputs stay outside the source repository by default.
"""
from pathlib import Path
import argparse
import json
import shutil
import zipfile
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def evaluation_document():
    reports = sorted((ROOT / "analytics/reports").glob("*.json"))
    lines = ["# Forecast evaluation", "", "Generated from checked-in engine outputs; no hand-entered accuracy figures.", "",
        "## Protocol", "",
        "Target: complete month-end total MRR in USD for subscriptions. At least 24 confirmed complete months; maximum 120. No interpolation of unknown months. The final six months are withheld from method selection. Expanding rolling origins begin with 12 training months and include all three forecast horizons. Selection minimizes mean absolute error, with fixed simpler-first ties. Development horizons have equal counts. During the final test, the selected method is fixed while parameters are refitted only to observations already available. Final fitting uses all complete history.", "",
        "MAE is mean absolute error in the target currency. WAPE is sum of absolute errors divided by sum of absolute actual values and is undefined for an all-zero target. Pooled final-test scores weight the 15 available forecasts; horizons contain 6/5/4 forecasts and overlap. These are not 15 independent experiments.", "",
        "ETS uses additive errors, no seasonality and either level only or additive damped trend. Normal-innovation exact conditional ETS intervals come from statsmodels. The last-value method uses normal random-walk intervals with root-mean-square first differences and square-root horizon scaling. Bounds and point forecasts are clipped at zero. These intervals omit model-selection uncertainty and are not conformal or empirically recalibrated. Constant histories have zero-width conditional intervals; future regime changes remain possible. Failed candidates are recorded and excluded from selection, not assigned fabricated scores.", ""]
    for path in reports:
        r=json.loads(path.read_text(encoding="utf-8"))
        if r["status"]!="ready":
            lines.extend([f"## {r['source']}", "", f"Status: {r['status']}", ""]);continue
        unit=r["currency"]; t=r["test"]
        lines.extend([f"## {r['source']}", "", f"Target: {r['target']} ({unit}); {r['coverage']['completeMonths']} months, {r['coverage']['start']} through {r['coverage']['end']}. Selected: **{r['selectedLabel']}**.", "",
            f"Development through {r['validation']['developmentEnd']}; final test {t['start']} through {t['end']}.", "",
            "| Development candidate | MAE | WAPE | Forecast count | Status |",
            "| --- | ---: | ---: | ---: | --- |"])
        for c in r["validation"]["candidates"]:
            lines.append(f"| {c['label']} | {c['mae']:,.2f} | {c['wape']:.2%} | {c['count']} | {c['status']} |")
        lines.extend(["",f"Final pooled MAE: **{unit} {t['selected']['mae']:,.2f}**; baseline **{unit} {t['baseline']['mae']:,.2f}**; WAPE **{t['selected']['wape']:.2%}**.", "",
            "| Horizon | MAE | Baseline MAE | Count | Observed 80% coverage | Observed 95% coverage |",
            "| --- | ---: | ---: | ---: | ---: | ---: |"])
        for i,c in enumerate(t["intervalCoverage"]):
            lines.append(f"| {c['horizon']} | {t['selected']['byHorizon'][i]['mae']:,.2f} | {t['baseline']['byHorizon'][i]['mae']:,.2f} | {c['count']} | {c['coverage80']:.1%} | {c['coverage95']:.1%} |")
        lines.extend(["",f"Artifact: [JSON](../analytics/reports/{path.name}); method {r['methodVersion']}; revision {r['revision']}; generated {r['generatedAt']}; input SHA-256 `{r['dataHash']}`.", ""])
    provenance=read("analytics/data/retail-monthly.json")
    lines.extend(["## Real-data provenance and limitations", "",
        f"{provenance['attribution']}. [Official dataset]({provenance['sourceUrl']}). License: {provenance['license']}.", "",
        *[f"- {rule}" for rule in provenance["rules"]], "",
        "December 2009 through November 2011 provide 24 complete months. The source is not a SaaS subscription ledger. Its seasonality and short development window limit the nonseasonal candidates; baseline selection and substantial errors are retained. This is evidence of a reproducible experiment, not competitive benchmark leadership.", "",
        f"Download SHA-256: `{provenance['sourceSha256']}`.", "",
        f"Aggregate SHA-256: `{provenance['aggregateSha256']}`.", "",
        "Cleaning counters: `"+json.dumps(provenance["counts"],sort_keys=True)+"`.", "",
        "Only monthly aggregates, provenance and reports are published. Reaggregate the official workbook with `uv run --group benchmark python -m analytics.cli benchmark --download`; the raw archive/workbook remain ignored.", "",
        "Synthetic stress fixtures are defined in analytics/benchmark.py before evaluation: stable (seed 42), growth (43), decline with a step break (44), each 48 months with Gaussian noise standard deviation 250. They exercise different regimes, without asserting a universal model winner. The subscription fixture uses its own deterministic seed 42 and dated account intervals.", "",
        "Real SaaS evaluation with representative held-out customer data, larger seasonal history and drift monitoring remains future work."])
    (ROOT/"docs/forecast-evaluation.md").write_text("\n".join(lines)+"\n",encoding="utf-8")


def build(output):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, PageBreak, Table, TableStyle
    from reportlab.lib.utils import ImageReader
    import pypdfium2 as pdfium

    c=read("docs/portfolio-case.json"); r=read("analytics/reports/demo-prediction.json"); retail=read("analytics/reports/retail-benchmark.json")
    output.mkdir(parents=True,exist_ok=True)
    styles=getSampleStyleSheet()
    styles.add(ParagraphStyle(name="CaseTitle",fontName="Helvetica-Bold",fontSize=28,leading=32,textColor=colors.HexColor("#111827"),spaceAfter=16))
    styles["BodyText"].fontSize=10.5; styles["BodyText"].leading=16; styles["BodyText"].spaceAfter=10
    styles["Heading2"].textColor=colors.HexColor("#065f46")
    story=[]
    def p(text,style="BodyText"):
        story.append(Paragraph(escape(text),styles[style]))
    def shot(name):
        path=ROOT/"docs/images"/name
        width,height=ImageReader(str(path)).getSize()
        story.append(Image(str(path),width=507,height=507*height/width));story.append(Spacer(1,12))
    p("REVLENS / ENGINEERING CASE","Heading2");p(c["title"],"CaseTitle");p(c["role"]);p(c["summary"]);shot(c["images"][0])
    p("A model you can inspect","Heading2");p(c["problem"]);p(c["solution"])
    p("Skills: "+", ".join(c["skills"]))
    story.append(PageBreak())
    p("From imported records to evidence","CaseTitle");p(c["pipeline"]);shot(c["images"][1])
    p("History and recovery","Heading2");p(c["recovery"])
    p("SCD2 validity begins when the application captures a state. Source observation time is separate; earlier attribute changes are never fabricated.")
    p("The public demo contains 48 complete months of fictional subscriptions. Private imports and model fitting run locally; the published app serves precomputed artifacts.")
    story.append(PageBreak())
    p("Evaluation, including the baseline","CaseTitle")
    p("Method selection uses earlier expanding-window validation. The last six months remain outside selection; the chosen method is refitted only as observations become available. Horizons have 6, 5 and 4 overlapping test predictions.")
    rows=[["Dataset / currency","Selected method","Test MAE","Baseline MAE","WAPE"]]
    for label,report in (("Fictional MRR / USD",r),("Real retail / GBP",retail)):
        rows.append([label,report["selectedLabel"].replace(" · "," / "),f"{report['test']['selected']['mae']:,.2f}",f"{report['test']['baseline']['mae']:,.2f}",f"{report['test']['selected']['wape']:.2%}"])
    table=Table(rows,colWidths=[120,140,88,88,71],hAlign="LEFT")
    table.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#ecfdf5")),("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),("FONTSIZE",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),12),("TOPPADDING",(0,0),(-1,-1),12),("LINEBELOW",(0,0),(-1,-1),.5,colors.HexColor("#d1d5db")),("ALIGN",(2,0),(-1,-1),"RIGHT")]))
    story.append(table);story.append(Spacer(1,16))
    p("The real benchmark is UCI Online Retail II, attributed to D. Chen (2012), CC BY 4.0. It aggregates signed net invoiced sales, including returns, from December 2009 through November 2011. Its baseline wins selection; the result does not validate SaaS MRR prediction.")
    p("Limits and reproducibility","Heading2");p(c["limits"])
    p("Nominal 80%/95% prediction intervals expose model assumptions and observed small-sample coverage. Complete candidate scores, horizon errors, hashes, cleaning rules and predefined stress cases are in the repository evaluation report.")
    p("Inspect the demo: "+c["demoUrl"]);p("Source and reproducible checks: "+c["sourceUrl"])
    pdf=output/"RevLens-Case-Study.pdf"
    def footer(canvas,doc):
        canvas.setFont("Helvetica",8);canvas.setFillColor(colors.HexColor("#6b7280"))
        canvas.drawString(44,27,"RevLens | Personal project | Synthetic MRR + separate real-data benchmark")
        canvas.drawRightString(551,27,str(doc.page))
    SimpleDocTemplate(str(pdf),pagesize=A4,rightMargin=44,leftMargin=44,topMargin=40,bottomMargin=45,title=c["title"],author="Anthony Macarth").build(story,onFirstPage=footer,onLaterPages=footer)
    copy={**c,"evaluation":{"methodVersion":r["methodVersion"],"dataHash":r["dataHash"],"selectedModel":r["selectedModel"],"test":r["test"]["selected"],"baseline":r["test"]["baseline"]},"uploadStatus":"Awaiting owner greenlight; not uploaded to Upwork"}
    (output/"PORTFOLIO-COPY.json").write_text(json.dumps(copy,indent=2)+"\n",encoding="utf-8")
    media=output/"media";media.mkdir(exist_ok=True)
    for name in c["images"]:
        shutil.copy2(ROOT/"docs/images"/name,media/name)
    (output/"README.md").write_text("# RevLens portfolio package\n\nGenerated by scripts/build-case.py from docs/portfolio-case.json and evaluated JSON reports.\n\nUse the PDF, current media files and PORTFOLIO-COPY.json. Legacy screenshots outside media/ are superseded. Nothing has been uploaded to Upwork; owner approval is pending.\n",encoding="utf-8")
    with zipfile.ZipFile(output/"RevLens-Portfolio-Upload.zip","w",zipfile.ZIP_DEFLATED) as archive:
        for path in [pdf,output/"PORTFOLIO-COPY.json",output/"README.md",*[media/name for name in c["images"]]]:
            archive.write(path,path.relative_to(output))
    render=output/"tmp"/"predictive";render.mkdir(parents=True,exist_ok=True)
    document=pdfium.PdfDocument(pdf)
    for i,page in enumerate(document):
        page.render(scale=1.4).to_pil().save(render/f"page-{i+1}.png")
    print(json.dumps({"pdf":str(pdf),"pages":len(document),"zip":str(output/"RevLens-Portfolio-Upload.zip"),"copyCharacters":len(c["summary"])}))


if __name__=="__main__":
    parser=argparse.ArgumentParser();parser.add_argument("--output",type=Path,default=ROOT.parent/"docs/cases/revlens");args=parser.parse_args()
    evaluation_document();build(args.output)
