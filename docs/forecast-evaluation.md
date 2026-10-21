# Forecast evaluation

Generated from checked-in engine outputs; no hand-entered accuracy figures.

## Protocol

Target: complete month-end total MRR in USD for subscriptions. At least 24 confirmed complete months; maximum 120. No interpolation of unknown months. The final six months are withheld from method selection. Expanding rolling origins begin with 12 training months and include all three forecast horizons. Selection minimizes mean absolute error, with fixed simpler-first ties. Development horizons have equal counts. During the final test, the selected method is fixed while parameters are refitted only to observations already available. Final fitting uses all complete history.

MAE is mean absolute error in the target currency. WAPE is sum of absolute errors divided by sum of absolute actual values and is undefined for an all-zero target. Pooled final-test scores weight the 15 available forecasts; horizons contain 6/5/4 forecasts and overlap. These are not 15 independent experiments.

Release JSON reports and the static demo are versioned together. CI regenerates them, verifies input hashes, method selection and bounded solver variation, then serves the checked-in release artifacts so the interface, README and case agree. ETS optimizers can differ slightly across operating systems/BLAS libraries: CI allows 1% MAE variation and 0.01% point-forecast variation (with currency rounding floors); larger changes require an explicit reviewed artifact update. These tolerances are reproducibility checks, not forecast-accuracy claims.

ETS uses additive errors, no seasonality and either level only or additive damped trend. Normal-innovation exact conditional ETS intervals come from statsmodels. The last-value method uses normal random-walk intervals with root-mean-square first differences and square-root horizon scaling. Bounds and point forecasts are clipped at zero. These intervals omit model-selection uncertainty and are not conformal or empirically recalibrated. Constant histories have zero-width conditional intervals; future regime changes remain possible. Failed candidates are recorded and excluded from selection, not assigned fabricated scores.

## Fictional subscriptions · seed 42

Target: mrr (USD); 48 months, 2022-10-01 through 2026-09-01. Selected: **ETS · damped trend**.

Development through 2026-03-01; final test 2026-04-01 through 2026-09-01.

| Development candidate | MAE | WAPE | Forecast count | Status |
| --- | ---: | ---: | ---: | --- |
| Last observed value | 875.65 | 7.59% | 84 | evaluated |
| Exponential smoothing · level | 890.79 | 7.72% | 84 | evaluated |
| ETS · damped trend | 680.66 | 5.90% | 84 | evaluated |

Final pooled MAE: **USD 339.68**; baseline **USD 386.02**; WAPE **2.11%**.

| Horizon | MAE | Baseline MAE | Count | Observed 80% coverage | Observed 95% coverage |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 316.64 | 311.71 | 6 | 83.3% | 100.0% |
| 2 | 344.40 | 381.07 | 5 | 100.0% | 100.0% |
| 3 | 368.33 | 503.65 | 4 | 100.0% | 100.0% |

Artifact: [JSON](../analytics/reports/demo-prediction.json); method revlens-monthly-v1; revision 2; generated 2026-10-21T00:25:27.138226+00:00; input SHA-256 `3b082ecd6bf3d3fae7273b63e69c58df45627448d564bc95f49324792e3ce6b1`.

## UCI Online Retail II

Target: net_invoiced_sales (GBP); 24 months, 2009-12-01 through 2011-11-01. Selected: **Last observed value**.

Development through 2011-05-01; final test 2011-06-01 through 2011-11-01.

| Development candidate | MAE | WAPE | Forecast count | Status |
| --- | ---: | ---: | ---: | --- |
| Last observed value | 365,732.53 | 58.52% | 12 | evaluated |
| Exponential smoothing · level | 373,503.70 | 59.76% | 12 | evaluated |
| ETS · damped trend | 591,663.98 | 94.66% | 12 | evaluated |

Final pooled MAE: **GBP 234,534.01**; baseline **GBP 234,534.01**; WAPE **23.73%**.

| Horizon | MAE | Baseline MAE | Count | Observed 80% coverage | Observed 95% coverage |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 137,081.59 | 137,081.59 | 6 | 66.7% | 100.0% |
| 2 | 240,414.22 | 240,414.22 | 5 | 80.0% | 100.0% |
| 3 | 373,362.39 | 373,362.39 | 4 | 75.0% | 75.0% |

Artifact: [JSON](../analytics/reports/retail-benchmark.json); method revlens-monthly-v1; revision 0; generated 2026-10-21T00:25:34.353340+00:00; input SHA-256 `2d0c5345e69dff19bbced10a66d3d2d8e5c2c2e0934f160becab5db33a0b8e18`.

## Synthetic stress case: decline_with_break; seed 44

Target: mrr (USD); 48 months, 2022-10-01 through 2026-09-01. Selected: **Last observed value**.

Development through 2026-03-01; final test 2026-04-01 through 2026-09-01.

| Development candidate | MAE | WAPE | Forecast count | Status |
| --- | ---: | ---: | ---: | --- |
| Last observed value | 500.94 | 3.42% | 84 | evaluated |
| Exponential smoothing · level | 529.14 | 3.61% | 84 | evaluated |
| ETS · damped trend | 604.45 | 4.13% | 84 | evaluated |

Final pooled MAE: **USD 353.86**; baseline **USD 353.86**; WAPE **3.50%**.

| Horizon | MAE | Baseline MAE | Count | Observed 80% coverage | Observed 95% coverage |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 386.64 | 386.64 | 6 | 83.3% | 100.0% |
| 2 | 229.49 | 229.49 | 5 | 100.0% | 100.0% |
| 3 | 460.17 | 460.17 | 4 | 100.0% | 100.0% |

Artifact: [JSON](../analytics/reports/stress-decline_with_break.json); method revlens-monthly-v1; revision 0; generated 2026-10-21T00:25:38.307737+00:00; input SHA-256 `d1e9f9b5aa19bc37412300fad0d7d51fbae59142d29290b9ca3a3a77ef37e5ee`.

## Synthetic stress case: growth; seed 43

Target: mrr (USD); 48 months, 2022-10-01 through 2026-09-01. Selected: **ETS · damped trend**.

Development through 2026-03-01; final test 2026-04-01 through 2026-09-01.

| Development candidate | MAE | WAPE | Forecast count | Status |
| --- | ---: | ---: | ---: | --- |
| Last observed value | 487.55 | 4.77% | 84 | evaluated |
| Exponential smoothing · level | 492.22 | 4.81% | 84 | evaluated |
| ETS · damped trend | 247.40 | 2.42% | 84 | evaluated |

Final pooled MAE: **USD 251.33**; baseline **USD 514.23**; WAPE **1.79%**.

| Horizon | MAE | Baseline MAE | Count | Observed 80% coverage | Observed 95% coverage |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 254.18 | 367.18 | 6 | 66.7% | 100.0% |
| 2 | 229.21 | 476.20 | 5 | 80.0% | 100.0% |
| 3 | 274.71 | 782.36 | 4 | 75.0% | 100.0% |

Artifact: [JSON](../analytics/reports/stress-growth.json); method revlens-monthly-v1; revision 0; generated 2026-10-21T00:25:36.561989+00:00; input SHA-256 `a59d916cd2fc02a96d6f324ffeb19b58a16afb57d851b4736831ece1e7f811ab`.

## Synthetic stress case: stable; seed 42

Target: mrr (USD); 48 months, 2022-10-01 through 2026-09-01. Selected: **Exponential smoothing · level**.

Development through 2026-03-01; final test 2026-04-01 through 2026-09-01.

| Development candidate | MAE | WAPE | Forecast count | Status |
| --- | ---: | ---: | ---: | --- |
| Last observed value | 243.33 | 2.43% | 84 | evaluated |
| Exponential smoothing · level | 162.52 | 1.62% | 84 | evaluated |
| ETS · damped trend | 168.85 | 1.68% | 84 | evaluated |

Final pooled MAE: **USD 77.93**; baseline **USD 125.79**; WAPE **0.77%**.

| Horizon | MAE | Baseline MAE | Count | Observed 80% coverage | Observed 95% coverage |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 87.47 | 151.02 | 6 | 100.0% | 100.0% |
| 2 | 68.72 | 93.32 | 5 | 100.0% | 100.0% |
| 3 | 75.11 | 128.56 | 4 | 100.0% | 100.0% |

Artifact: [JSON](../analytics/reports/stress-stable.json); method revlens-monthly-v1; revision 0; generated 2026-10-21T00:25:34.449610+00:00; input SHA-256 `530bc115893d5956e0253dc40bd54e80814f0116f1eba284c0a9d9d043687dfe`.

## Real-data provenance and limitations

Chen, D. (2012). Online Retail II. UCI. https://doi.org/10.24432/C5CG6D. [Official dataset](https://archive.ics.uci.edu/dataset/502/online%2Bretail%2Bii). License: CC BY 4.0.

- Signed quantity × nonnegative unit price; returns included.
- Rows with missing customer IDs remain: customer identity is not needed for aggregate sales.
- Exact repeated lines retained: no trustworthy line ID is supplied.
- December 2011 excluded because observation stops on December 9.
- GBP sales are not USD MRR and are never imported as subscriptions.

December 2009 through November 2011 provide 24 complete months. The source is not a SaaS subscription ledger. Its seasonality and short development window limit the nonseasonal candidates; baseline selection and substantial errors are retained. This is evidence of a reproducible experiment, not competitive benchmark leadership.

Download SHA-256: `572e36277c2390fbfde10664750731e0a86f55e33470d91919085f0408e67bfb`.

Aggregate SHA-256: `5ce05e8bd074a948aec05ed6d3dd2c5bb87de9325f93ac8c62f0d9e1a6b69fc5`.

Cleaning counters: `{"includedRows": 1041840, "invalidNumericOrNegativePrice": 5, "partialPeriodRowsExcluded": 25526, "returnRowsIncluded": 22560, "sourceRows": 1067371}`.

Only monthly aggregates, provenance and reports are published. Reaggregate the official workbook with `uv run --group benchmark python -m analytics.cli benchmark --download`; the raw archive/workbook remain ignored.

Synthetic stress fixtures are defined in analytics/benchmark.py before evaluation: stable (seed 42), growth (43), decline with a step break (44), each 48 months with Gaussian noise standard deviation 250. They exercise different regimes, without asserting a universal model winner. The subscription fixture uses its own deterministic seed 42 and dated account intervals.

Real SaaS evaluation with representative held-out customer data, larger seasonal history and drift monitoring remains future work.
