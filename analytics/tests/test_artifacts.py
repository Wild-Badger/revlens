"""Regression checks for corrupted evaluation artifacts, without fitting another model."""
import copy
import json
from pathlib import Path
import runpy

import pytest

checker = runpy.run_path(str(Path(__file__).resolve().parents[2] / 'scripts' / 'verify-artifacts.py'))
ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize('name', sorted(checker['REPORTS']))
def test_report_contract_and_mae_magnitude(name):
    report = json.loads((ROOT / 'analytics' / 'reports' / name).read_text())
    checker['validate_report'](report)
    bad = copy.deepcopy(report)
    bad['test']['selected']['mae'] *= 1000
    with pytest.raises(AssertionError): checker['validate_report'](bad)
    with pytest.raises(AssertionError): checker['compare_release'](bad, report)
    bad = copy.deepcopy(report)
    bad['validation']['candidates'][2]['byHorizon'][2]['mae'] *= 1000
    with pytest.raises(AssertionError): checker['validate_report'](bad)
    bad = copy.deepcopy(report)
    candidate = bad['validation']['candidates'][2]
    candidate['mae'] *= 1000
    for horizon in candidate['byHorizon']: horizon['mae'] *= 1000
    with pytest.raises(AssertionError): checker['compare_release'](bad, report)
    bad = copy.deepcopy(report)
    bad['forecast'][0]['lower95'] = bad['forecast'][0]['predicted'] + 1
    with pytest.raises(AssertionError): checker['validate_report'](bad)


@pytest.mark.parametrize('field', ['wape', 'count'])
def test_recalculated_test_metrics(field):
    report = json.loads((ROOT / 'analytics/reports/demo-prediction.json').read_text())
    report['test']['baseline'][field] += 1
    with pytest.raises(AssertionError): checker['validate_report'](report)


def test_missing_report_and_nonfinite_value(tmp_path):
    with pytest.raises(AssertionError): checker['verify_reports'](tmp_path)
    report = json.loads((ROOT / 'analytics/reports/demo-prediction.json').read_text())
    report['forecast'][0]['predicted'] = float('nan')
    with pytest.raises(AssertionError): checker['validate_report'](report)
