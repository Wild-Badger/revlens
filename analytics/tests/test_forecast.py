import math

import pytest
from fastapi.testclient import TestClient

from analytics import forecast
from analytics.service import app


def monthly(values):
    return [{"month": forecast.add_months("2022-01-01", i), "value": value} for i, value in enumerate(values)]


def test_constant_and_zero_have_finite_intervals_and_honest_ties():
    for value in (0, 200):
        report = forecast.evaluate_series(monthly([value] * 24))
        assert report["status"] == "ready"
        assert report["selectedModel"] == "naive"
        assert report["test"]["selected"]["mae"] == 0
        assert report["test"]["selected"]["count"] == 15
        assert report["test"]["selected"]["wape"] == (None if value == 0 else 0)
        assert all(point["lower95"] == point["upper95"] == value for point in report["forecast"])


def test_selection_cannot_see_final_six_months():
    prefix = [100 + i * 3 + math.sin(i) * 5 for i in range(18)]
    first = forecast.evaluate_series(monthly(prefix + [160] * 6))
    second = forecast.evaluate_series(monthly(prefix + [9999] * 6))
    assert first["validation"] == second["validation"]
    assert first["selectedModel"] == second["selectedModel"]
    assert first["dataHash"] != second["dataHash"]
    assert all(row["origin"] < row["month"] for row in first["test"]["predictions"])


def test_unknown_or_short_history_does_not_publish_a_model():
    assert forecast.evaluate_series(monthly([1] * 23))["status"] == "insufficient_history"
    assert forecast.evaluate_series(monthly([1] * 24), coverage_confirmed=False)["forecast"] == []
    with pytest.raises(ValueError):
        forecast.evaluate_series(monthly([1, float("nan")]))
    with pytest.raises(ValueError):
        forecast.evaluate_series([{"month": "2022-01-01", "value": 1}, {"month": "2022-03-01", "value": 1}])


def test_failed_ets_fits_remain_visible_and_naive_is_eligible(monkeypatch):
    original = forecast.fit_predict
    def fail_ets(values, model, horizon=3, intervals=False):
        if model != "naive":
            raise ArithmeticError("synthetic optimizer failure")
        return original(values, model, horizon, intervals)
    monkeypatch.setattr(forecast, "fit_predict", fail_ets)
    report = forecast.evaluate_series(monthly(list(range(24))))
    assert report["selectedModel"] == "naive"
    assert report["validation"]["candidates"][1]["status"] == "failed"


def test_local_service_rejects_unauthorized_calls(monkeypatch):
    monkeypatch.setenv("REV_ANALYTICS_TOKEN", "a" * 64)
    client = TestClient(app)
    assert client.get("/health").status_code == 200
    assert client.get("/v1/prediction").status_code == 401
    assert client.post("/v1/refresh", json={"revision": 1}).status_code == 401
