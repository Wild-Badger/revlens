"""Build the case from structured copy + evaluated reports, never README parsing.

Requires reportlab (PDF), pypdf (structure) and pypdfium2 (rendered verification).
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
        "Release JSON reports and the static demo are versioned together. CI regenerates them, verifies input hashes, method selection and bounded solver variation, then serves the checked-in release artifacts so the interface, README and case agree. ETS optimizers can differ slightly across operating systems/BLAS libraries: CI retains 1% variation for held-out MAE and 0.01% point-forecast variation (with currency rounding floors), across all five reports. It recalculates test metrics/coverage and checks development selection, counts and weighted score/WAPE consistency. Earlier development scores can vary with solver/platform behavior; they are not subject to a newly invented release threshold. Larger changes in the gated held-out scores require an explicit reviewed artifact update. These tolerances are reproducibility checks, not forecast-accuracy claims.", "",
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


def readme_document(c, r, retail):
    demo = read("demo/data.json")
    lines = ["# " + c["title"], "", c["readmeIntroduction"], "",
        f"[Explore the demo]({c['demoUrl']}#/forecast) · [Evaluation results](docs/forecast-evaluation.md) · [Skills and code evidence](docs/skills-evidence.md) · [Architecture](docs/architecture.md)", "",
        "![Statistical forecast with observed error and baseline comparison](docs/images/portfolio-forecast.png)", "",
        "## The problem and the implementation", "", c["problem"], "", c["solution"], "",
        "## What a revenue analytics engagement can deliver", ""]
    lines.extend(f"- **{item['label']}:** {item['text']}" for item in c["delivery"] if item['label'] != 'Scope')
    lines += ["", "The implementation covers the complete handover: validated source data, reconciled SQL metrics, an evaluated Python forecast, an interactive dashboard and instructions to reproduce the results. The [evidence matrix](docs/skills-evidence.md) connects each skill to code, runnable checks and its limitations.", "",
        "## Forecast performance", "",
        f"The subscription experiment contains **{len(demo['customers'])} fictional customers**, **{sum(len(value['subscriptions']) for value in demo['histories'].values())} dated intervals** and **{r['coverage']['completeMonths']} complete months**, observed through {r['asOf'][:10]}. Latest MRR: **USD {r['history'][-1]['value']:,.2f}**.", "",
        f"Earlier rolling-origin validation selects **{r['selectedLabel']}** from a last-value baseline, level smoothing and damped-trend ETS. The final six months are reserved for evaluation. Pooled test MAE is **USD {r['test']['selected']['mae']:,.2f}**, compared with **USD {r['test']['baseline']['mae']:,.2f}** for the baseline.", "",
        "| Horizon | Selected MAE (USD) | Baseline MAE (USD) | Test forecasts |", "| --- | ---: | ---: | ---: |"]
    for selected, baseline in zip(r['test']['selected']['byHorizon'],r['test']['baseline']['byHorizon'],strict=True):
        lines.append(f"| {selected['horizon']} {'month' if selected['horizon'] == 1 else 'months'} | {selected['mae']:,.2f} | {baseline['mae']:,.2f} | {selected['count']} |")
    lines += ["", f"The selected method {'has higher error than' if r['test']['selected']['byHorizon'][0]['mae'] > r['test']['baseline']['byHorizon'][0]['mae'] else 'matches or beats'} the baseline at one month. Method selection uses aggregate earlier validation; the final test is never used to choose or tune the method. The overlapping test forecasts are a small sample. Nominal 80% and 95% intervals depend on model assumptions; observed coverage is reported in the [full evaluation](docs/forecast-evaluation.md).", "",
        f"A separate **real-data benchmark** uses UCI Online Retail II net invoiced sales in GBP, including returns. It selects **{retail['selectedLabel']}**, with pooled MAE **GBP {retail['test']['selected']['mae']:,.2f}** and WAPE **{retail['test']['selected']['wape']:.2%}**. Its aggregates, cleaning rules, checksums and CC BY 4.0 attribution are published with the [evaluation](docs/forecast-evaluation.md#real-data-provenance-and-limitations). This experiment measures retail sales, not SaaS MRR accuracy.", "",
        "## Data engineering and recovery", "", c['pipeline'], "",
        "SQL/dbt marts drive revenue movements, retention and cohorts. Native SCD2 snapshots record customer and plan changes from observed captures, keeping the source observation date separate from the capture timestamp. Pending analysis hides stale attribute versions while preserving access to operational records.", "",
        c['recovery'], "", "![Customer attribute history with distinct observation and capture dates](docs/images/portfolio-scd2.png)", "",
        "The [architecture](docs/architecture.md) documents the local Python service, PostgreSQL warehouse, Next.js APIs and static demo boundary. The [verification report](docs/verification.md) records import rejection, real process interruption, checkpoint restoration and successful retry through connected Chrome.", "", c['readmeInstructions']]
    (ROOT/'README.md').write_text("\n".join(lines).rstrip()+"\n",encoding='utf-8')


def build(output):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, PageBreak, Table, TableStyle
    from reportlab.lib.utils import ImageReader
    from pypdf import PdfReader
    import pypdfium2 as pdfium
    import subprocess

    c=read("docs/portfolio-case.json"); r=read("analytics/reports/demo-prediction.json"); retail=read("analytics/reports/retail-benchmark.json")
    assert len(c['title']) <= 70 and len(c['role']) <= 100 and len(c['summary']) <= 600 and len(c['skills']) <= 5
    output.mkdir(parents=True,exist_ok=True)
    styles=getSampleStyleSheet()
    styles.add(ParagraphStyle(name="CaseTitle",fontName="Helvetica-Bold",fontSize=24,leading=28,textColor=colors.HexColor("#171717"),spaceAfter=14))
    styles['BodyText'].fontSize=10; styles['BodyText'].leading=14; styles['BodyText'].spaceAfter=8
    styles['Heading2'].fontSize=14; styles['Heading2'].leading=18; styles['Heading2'].textColor=colors.HexColor('#047857')
    styles.add(ParagraphStyle(name='Cell',fontName='Helvetica',fontSize=8.5,leading=12))
    story=[]
    def p(text,style='BodyText'): story.append(Paragraph(escape(text),styles[style]))
    def link(label,url): story.append(Paragraph(f'<link href="{escape(url)}" color="#047857"><u>{escape(label)}</u></link>',styles['BodyText']))
    def shot(name,width=400):
        image=ROOT/'docs/images'/name
        w,h=ImageReader(str(image)).getSize()
        assert (w,h)==(1600,1200), f'{name}: expected 1600 x 1200'
        story.append(Image(str(image),width=width,height=width*h/w));story.append(Spacer(1,10))
    def table(rows,widths):
        values=[[Paragraph(escape(str(cell)),styles['Cell']) for cell in row] for row in rows]
        obj=Table(values,colWidths=widths,hAlign='LEFT',repeatRows=1)
        obj.setStyle(TableStyle([('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),('VALIGN',(0,0),(-1,-1),'TOP'),('BOTTOMPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),8),('LINEBELOW',(0,0),(-1,-1),.4,colors.HexColor('#d4d4d4'))]))
        story.append(obj);story.append(Spacer(1,10))
    p('REVLENS / PERSONAL ENGINEERING CASE','Heading2');p(c['title'],'CaseTitle')
    p('A subscription CSV becomes reconciled revenue, an evaluated forecast and a reproducible handover.')
    for item in c['delivery']:
        story.append(Paragraph(f"<b>{escape(item['label'])}.</b> {escape(item['text'])}",styles['BodyText']))
    shot(c['images'][0],390)
    link('Open the interactive demo',c['demoUrl']+'#/forecast')
    story.append(PageBreak())
    p('Results a buyer can inspect','CaseTitle')
    p(f"Fictional subscriptions: {r['coverage']['completeMonths']} complete months. Method: {r['selectedLabel']}. Earlier rolling-origin validation chooses the aggregate MAE winner; the final six months are never used for selection. The method stays fixed while parameters refit only to available observations.")
    table([['Horizon','Selected MAE / USD','Baseline MAE / USD','Count','80% / 95% coverage']]+[[f"{h['horizon']} month(s)",f"{h['mae']:,.2f}",f"{r['test']['baseline']['byHorizon'][i]['mae']:,.2f}",h['count'],f"{r['test']['intervalCoverage'][i]['coverage80']:.1%} / {r['test']['intervalCoverage'][i]['coverage95']:.1%}"] for i,h in enumerate(r['test']['selected']['byHorizon'])],[65,110,110,48,174])
    p(f"Pooled MAE: USD {r['test']['selected']['mae']:,.2f}; baseline USD {r['test']['baseline']['mae']:,.2f}. WAPE: {r['test']['selected']['wape']:.2%}. The selected method {'has higher error' if r['test']['selected']['byHorizon'][0]['mae'] > r['test']['baseline']['byHorizon'][0]['mae'] else 'matches or beats the baseline'} at horizon 1. These {r['test']['selected']['count']} forecasts overlap and are not independent experiments. Nominal intervals are not guaranteed coverage.")
    shot(c['images'][2],360)
    p(f"Separate real benchmark: UCI Online Retail II, signed net invoiced sales including returns, GBP. It selects the last-value baseline: MAE {retail['test']['selected']['mae']:,.2f}, WAPE {retail['test']['selected']['wape']:.2%}. This is retail, not SaaS accuracy evidence. D. Chen (2012), CC BY 4.0.")
    link('Full evaluation, all candidates, stress cases and provenance',c['sourceUrl']+'/blob/main/docs/forecast-evaluation.md')
    story.append(PageBreak())
    p('Traceable data. Recoverable failures.','CaseTitle');p(c['pipeline'])
    shot(c['images'][3],390)
    p('Observed history, not reconstructed history','Heading2')
    p('Native dbt SCD2 captures changed, removed and reappearing customers and plans. Source observation dates and capture timestamps remain distinct. Pending revisions keep the operational record available and hide stale captured versions. New sources have separate identities.')
    p('A checkpoint before destructive replacement','Heading2');p(c['recovery'])
    p('Checkpoint restoration verifies the checksum and all normal temporal/relationship constraints. Invalid raw content stays downloadable for manual recovery; it cannot bypass validation. Backups v1 remain restorable with earlier coverage/history unknown.')
    story.append(PageBreak())
    p('Reproduce the delivery','CaseTitle')
    p('Clone the public repository. Install the locked Node/Python dependencies and PostgreSQL 17. The Windows launcher creates a separate local owner workspace. Public Pages runs only precomputed fictional artifacts; private imports and fitting remain on the computer.')
    table([['Skill','Inspectable implementation / runnable evidence'],['Python / Data Science','analytics/forecast.py; pytest analytics/tests/test_forecast.py; earlier temporal validation and final errors'],['Data Engineering / SQL','dbt build via analytics.cli refresh; reconciled marts, cutoff tests and fixed-denominator cohorts'],['PostgreSQL / SCD2','dbt/snapshots; pytest analytics/tests/test_pipeline.py with a disposable *_test database'],['Integrity / Full-stack','scripts/verify-predictive.ts; real import, revision checks, full v2 round-trip and checkpoint recovery'],['Reproducible handover','scripts/verify-artifacts.py; five reports, recalculated scores/coverage, CI and static export']],[120,387])
    p('Start: ./scripts/start-local.ps1 (Windows). Verify: pnpm test --maxWorkers=2; uv run python -m pytest -q. The repository verification guide supplies isolated database flags and release commands. Unknown coverage produces a diagnosis, not an evaluated forecast.')
    shot(c['images'][5],260)
    p(c['limits'])
    link('Interactive demo',c['demoUrl']+'#/forecast');link('Source, installation and full evidence matrix',c['sourceUrl']);link('Database and release verification',c['sourceUrl']+'/blob/main/docs/verification.md')
    pdf=output/'RevLens-Case-Study.pdf'
    def footer(canvas,doc):
        canvas.setFont('Helvetica',8);canvas.setFillColor(colors.HexColor('#737373'))
        canvas.drawString(44,27,'RevLens | Personal project | Fictional MRR + separate real retail benchmark');canvas.drawRightString(551,27,str(doc.page))
    SimpleDocTemplate(str(pdf),pagesize=A4,rightMargin=44,leftMargin=44,topMargin=38,bottomMargin=45,title=c['title'],author='Anthony Macarth').build(story,onFirstPage=footer,onLaterPages=footer)
    assert len(PdfReader(pdf).pages)==4, 'Case must have exactly four pages'
    assert pdf.stat().st_size < 25*1024*1024
    revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    copy={key:value for key,value in c.items() if key not in ('readmeInstructions', 'readmeIntroduction')}
    import hashlib
    copy['imageSha256']={name:hashlib.sha256((ROOT/'docs/images'/name).read_bytes()).hexdigest() for name in c['images']}
    copy.update(codeRevision=revision,evaluation={'methodVersion':r['methodVersion'],'dataHash':r['dataHash'],'selectedModel':r['selectedModel'],'test':r['test']['selected'],'baseline':r['test']['baseline']},uploadStatus='Awaiting owner greenlight; not uploaded to Upwork')
    (output/'PORTFOLIO-COPY.json').write_text(json.dumps(copy,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    media=output/'media';media.mkdir(exist_ok=True)
    for name in c['images']: shutil.copy2(ROOT/'docs/images'/name,media/name)
    (output/'README.md').write_text('# RevLens portfolio package\n\nFour-page case and six real-UI presentation images, generated from docs/portfolio-case.json and evaluated reports. Use PORTFOLIO-COPY.json for the title, role, description and five tags. Nothing has been uploaded to Upwork; owner greenlight is required.\n',encoding='utf-8')
    with zipfile.ZipFile(output/'RevLens-Portfolio-Upload.zip','w',zipfile.ZIP_DEFLATED) as archive:
        for path in [pdf,output/'PORTFOLIO-COPY.json',output/'README.md',*[media/name for name in c['images']]]: archive.write(path,path.relative_to(output))
    render=output/'tmp'/'final';render.mkdir(parents=True,exist_ok=True)
    document=pdfium.PdfDocument(pdf)
    for i,page in enumerate(document): page.render(scale=1.5).to_pil().save(render/f'page-{i+1}.png')
    readme_document(c,r,retail)
    print(json.dumps({'pdf':str(pdf),'pages':len(document),'pdfBytes':pdf.stat().st_size,'zip':str(output/'RevLens-Portfolio-Upload.zip'),'copyCharacters':len(c['summary']),'codeRevision':revision}))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,default=ROOT.parent/'docs/cases/revlens');args=parser.parse_args()
    evaluation_document();build(args.output)
