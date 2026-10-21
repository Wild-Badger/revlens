"""Small, auditable monthly forecasting experiment shared by the service and CLI."""
from __future__ import annotations

import hashlib
import json
import math
import warnings
from datetime import date, datetime, timezone
from statistics import NormalDist

import numpy as np
import pandas as pd
from statsmodels.tsa.exponential_smoothing.ets import ETSModel

METHOD_VERSION = "revlens-monthly-v1"
MODELS = ("naive", "ets_level", "ets_damped")
LABELS = {"naive": "Last observed value", "ets_level": "Exponential smoothing · level", "ets_damped": "ETS · damped trend"}
MIN_MONTHS = 24
HORIZON = 3


def add_months(month: str, offset: int) -> str:
    value = date.fromisoformat(month)
    year, zero_month = divmod(value.year * 12 + value.month - 1 + offset, 12)
    return date(year, zero_month + 1, 1).isoformat()


def fit_predict(values: list[float], model: str, horizon: int = HORIZON, intervals: bool = False) -> list[dict]:
    y = np.asarray(values, dtype=float)
    if not len(y) or not np.isfinite(y).all() or (y < 0).any():
        raise ValueError("Monthly values must be finite and nonnegative")
    if model not in MODELS:
        raise ValueError("Unknown forecasting method")
    constant = np.ptp(y) < 1e-9
    if model == "naive" or constant:
        point = np.repeat(y[-1], horizon)
        sigma = float(np.sqrt(np.mean(np.diff(y) ** 2))) if len(y) > 1 else 0.0
        scales = sigma * np.sqrt(np.arange(1, horizon + 1))
        bounds = {level: (point - NormalDist().inv_cdf((1 + level) / 2) * scales,
                          point + NormalDist().inv_cdf((1 + level) / 2) * scales) for level in (.8, .95)}
    else:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            result = ETSModel(pd.Series(y), error="add", trend="add" if model == "ets_damped" else None,
                              damped_trend=model == "ets_damped", seasonal=None,
                              initialization_method="estimated").fit(disp=False, maxiter=1000)
        if not result.mle_retvals.get("converged", False):
            raise ArithmeticError("Optimizer did not converge")
        point = np.asarray(result.forecast(horizon), dtype=float)
        bounds = {}
        if intervals:
            prediction = result.get_prediction(start=len(y), end=len(y) + horizon - 1, method="exact")
            for level in (.8, .95):
                frame = prediction.summary_frame(alpha=1 - level)
                bounds[level] = (frame["pi_lower"].to_numpy(), frame["pi_upper"].to_numpy())
    if not np.isfinite(point).all():
        raise ArithmeticError("Forecast produced a nonfinite value")
    rows = []
    for i, value in enumerate(point):
        row = {"horizon": i + 1, "predicted": round(max(0, float(value)), 2)}
        if intervals:
            for level, (lower, upper) in bounds.items():
                if not np.isfinite([lower[i], upper[i]]).all():
                    raise ArithmeticError("Prediction interval is nonfinite")
                row[f"lower{int(level * 100)}"] = round(max(0, float(lower[i])), 2)
                row[f"upper{int(level * 100)}"] = round(max(0, float(upper[i])), 2)
        rows.append(row)
    return rows


def score(rows: list[dict]) -> dict:
    errors = [abs(row["actual"] - row["predicted"]) for row in rows]
    denominator = sum(abs(row["actual"]) for row in rows)
    return {"count": len(rows), "mae": round(sum(errors) / len(errors), 4) if errors else None,
            "wape": round(sum(errors) / denominator, 6) if denominator else None}


def by_horizon(rows: list[dict]) -> list[dict]:
    return [{"horizon": h, **score([row for row in rows if row["horizon"] == h])} for h in range(1, HORIZON + 1)]


def evaluate_series(rows: list[dict], *, target: str = "mrr", currency: str = "USD", source: str = "local",
                    revision: int = 0, as_of: str | None = None, coverage_confirmed: bool = True) -> dict:
    if len(rows) > 120:
        rows = rows[-120:]
    normalized = [{"month": str(row["month"]), "value": float(row["value"])} for row in rows]
    for i, row in enumerate(normalized):
        if not math.isfinite(row["value"]) or row["value"] < 0 or row["month"][-3:] != "-01":
            raise ValueError("Use finite nonnegative values and month-start dates")
        date.fromisoformat(row["month"])
        if i and row["month"] != add_months(normalized[i - 1]["month"], 1):
            raise ValueError("Monthly history must be consecutive and ordered; do not interpolate unknown months")
    canonical = json.dumps({"target": target, "currency": currency, "rows": normalized,
                            "coverageConfirmed": coverage_confirmed, "methodVersion": METHOD_VERSION}, sort_keys=True, separators=(",", ":"))
    report = {"format": "revlens-prediction", "schemaVersion": 1, "methodVersion": METHOD_VERSION,
              "generatedAt": datetime.now(timezone.utc).isoformat(), "dataHash": hashlib.sha256(canonical.encode()).hexdigest(),
              "source": source, "target": target, "currency": currency, "revision": revision, "asOf": as_of,
              "history": normalized, "coverage": {"confirmed": coverage_confirmed, "completeMonths": len(rows),
              "requiredMonths": MIN_MONTHS, "start": normalized[0]["month"] if rows else None,
              "end": normalized[-1]["month"] if rows else None}, "forecast": [], "warnings": []}
    if not coverage_confirmed or len(rows) < MIN_MONTHS:
        report.update(status="insufficient_history", message="Confirm complete billing history and supply at least 24 complete months.")
        return report
    values = [row["value"] for row in normalized]
    development_end = len(values) - 6
    candidates = []
    for model in MODELS:
        predictions, failures = [], []
        for origin in range(12, development_end - HORIZON + 1):
            try:
                points = fit_predict(values[:origin], model)
                predictions.extend({**point, "actual": values[origin + point["horizon"] - 1]} for point in points)
            except (ValueError, ArithmeticError, np.linalg.LinAlgError) as error:
                failures.append({"origin": normalized[origin - 1]["month"], "reason": type(error).__name__})
        candidates.append({"model": model, "label": LABELS[model], "status": "failed" if failures else "evaluated",
                           **score(predictions), "byHorizon": by_horizon(predictions), "failures": failures})
    eligible = [candidate for candidate in candidates if candidate["status"] == "evaluated"]
    # ponytail: fixed candidate order breaks numerical ties in favor of the simpler method.
    chosen = min(eligible, key=lambda candidate: (round(candidate["mae"], 6), MODELS.index(candidate["model"])))
    model = chosen["model"]
    holdout, baseline = [], []
    try:
        for origin in range(development_end, len(values)):
            horizon = min(HORIZON, len(values) - origin)
            for point in fit_predict(values[:origin], model, horizon, intervals=True):
                holdout.append({**point, "origin": normalized[origin - 1]["month"],
                                "month": normalized[origin + point["horizon"] - 1]["month"],
                                "actual": values[origin + point["horizon"] - 1]})
            baseline.extend({**point, "actual": values[origin + point["horizon"] - 1]}
                            for point in fit_predict(values[:origin], "naive", horizon))
        forecast = fit_predict(values, model, intervals=True)
    except (ValueError, ArithmeticError, np.linalg.LinAlgError) as error:
        report.update(status="model_error", message="The selected model failed during test or final fitting; no forecast was published.",
                      selectedModel=model, validation={"candidates": candidates}, warnings=[type(error).__name__])
        return report
    for row in forecast:
        row["month"] = add_months(normalized[-1]["month"], row["horizon"])
    coverage = []
    for h in range(1, HORIZON + 1):
        sample = [row for row in holdout if row["horizon"] == h]
        coverage.append({"horizon": h, "count": len(sample), **{
            f"coverage{level}": round(sum(row[f"lower{level}"] <= row["actual"] <= row[f"upper{level}"] for row in sample) / len(sample), 6)
            for level in (80, 95)}})
    report.update(status="ready", selectedModel=model, selectedLabel=LABELS[model], forecast=forecast,
                  validation={"initialTrainingMonths": 12, "developmentEnd": normalized[development_end - 1]["month"],
                              "selection": "Lowest rolling-origin MAE on development data; fixed simpler-first tie break",
                              "candidates": candidates},
                  test={"start": normalized[development_end]["month"], "end": normalized[-1]["month"],
                        "selected": {**score(holdout), "byHorizon": by_horizon(holdout)},
                        "baseline": {**score(baseline), "byHorizon": by_horizon(baseline)},
                        "intervalCoverage": coverage, "predictions": holdout},
                  intervalMethod="ETS additive-error model intervals; naive uses random-walk innovation variance. Bounds clipped at zero.",
                  warnings=["80% and 95% are nominal model-based intervals, not guaranteed coverage.",
                            "The final six months provide only six, five and four test predictions at horizons 1, 2 and 3.",
                            "Univariate trend forecasting does not estimate individual churn or causal effects.",
                            "Test horizons overlap; their errors are not independent. A zero-variation history gives zero-width conditional intervals and does not rule out a regime change."])
    return report
