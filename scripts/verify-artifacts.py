"""Validate all release reports and retain the existing numerical tolerances."""
import hashlib
import json
import math
from datetime import date, datetime
from pathlib import Path
import subprocess

REPORTS = {'demo-prediction.json', 'retail-benchmark.json', 'stress-stable.json', 'stress-growth.json', 'stress-decline_with_break.json'}
MODELS = ('naive', 'ets_level', 'ets_damped')


def month(value, offset=0):
    parsed = date.fromisoformat(value)
    assert parsed.day == 1
    year, zero = divmod(parsed.year * 12 + parsed.month - 1 + offset, 12)
    return date(year, zero + 1, 1).isoformat()


def finite(value):
    if isinstance(value, dict):
        for item in value.values(): finite(item)
    elif isinstance(value, list):
        for item in value: finite(item)
    elif isinstance(value, (int, float)):
        assert math.isfinite(value), 'Nonfinite report value'


def check_score(actual, rows):
    assert type(actual["count"]) is int, "Forecast count must be an integer"
    error = sum(abs(row['actual'] - row['predicted']) for row in rows)
    denominator = sum(abs(row['actual']) for row in rows)
    expected = {'count': len(rows), 'mae': round(error / len(rows), 4) if rows else None, 'wape': round(error / denominator, 6) if denominator else None}
    for key, value in expected.items():
        assert actual[key] == value, f'Recalculated {key} differs'


def check_intervals(row):
    assert 0 <= row['lower95'] <= row['lower80'] <= row['predicted'] <= row['upper80'] <= row['upper95'], 'Intervals must be ordered, nested and contain the forecast'


def validate_report(report):
    finite(report)
    assert report['format'] == 'revlens-prediction' and report['schemaVersion'] == 1
    assert report['status'] == 'ready' and report['methodVersion'] == 'revlens-monthly-v1'
    assert report['selectedModel'] in MODELS and isinstance(report['revision'], int) and report['revision'] >= 0
    assert report['target'] in ('mrr', 'net_invoiced_sales') and report['currency'] in ('USD', 'GBP')
    assert datetime.fromisoformat(report['generatedAt']).tzinfo is not None
    as_of = date.fromisoformat(report['asOf'][:10])
    history = report['history']
    assert 24 <= len(history) <= 120
    for i, row in enumerate(history):
        assert month(row['month']) == row['month'] and row['value'] >= 0
        assert date.fromisoformat(month(row['month'], 1)) <= date.fromordinal(as_of.toordinal() + 1), 'Incomplete month'
        if i: assert row['month'] == month(history[i-1]['month'], 1)
    assert report['coverage'] == {'confirmed': True, 'completeMonths': len(history), 'requiredMonths': 24, 'start': history[0]['month'], 'end': history[-1]['month']}
    canonical = json.dumps({'target': report['target'], 'currency': report['currency'], 'rows': history, 'coverageConfirmed': True, 'methodVersion': report['methodVersion']}, sort_keys=True, separators=(',', ':'))
    assert hashlib.sha256(canonical.encode()).hexdigest() == report['dataHash'], 'Monthly input checksum differs'
    validation = report['validation']
    assert validation['initialTrainingMonths'] == 12 and validation['developmentEnd'] == history[-7]['month']
    candidates = validation['candidates']
    assert [row['model'] for row in candidates] == list(MODELS)
    for candidate in candidates:
        assert candidate['status'] in ('evaluated', 'failed')
        assert candidate['count'] == (len(history) - 20 - len(candidate['failures'])) * 3
        assert (candidate['status'] == 'failed') == bool(candidate['failures'])
        assert [row['horizon'] for row in candidate['byHorizon']] == [1, 2, 3]
        for row in candidate['byHorizon']:
            assert row['count'] == candidate['count'] // 3
            assert row['mae'] is None or row['mae'] >= 0
            assert row['wape'] is None or row['wape'] >= 0
        if candidate['count']:
            assert abs(sum(row['mae'] for row in candidate['byHorizon']) / 3 - candidate['mae']) <= .00011
    chosen = min((row for row in candidates if row['status'] == 'evaluated'), key=lambda row: (round(row['mae'], 6), MODELS.index(row['model'])))
    assert chosen['model'] == report['selectedModel'], 'Selection must use validation, never test data'
    test = report['test']
    assert test['start'] == history[-6]['month'] and test['end'] == history[-1]['month']
    lookup = {row['month']: row['value'] for row in history}
    pairs = {(history[origin-1]['month'], h) for origin in range(len(history)-6, len(history)) for h in range(1, min(3, len(history)-origin)+1)}
    predictions = test['predictions']
    assert len(predictions) == 15 and {(row['origin'], row['horizon']) for row in predictions} == pairs
    baseline = []
    for row in predictions:
        assert row['month'] == month(row['origin'], row['horizon']) and row['actual'] == lookup[row['month']]
        check_intervals(row)
        baseline.append({**row, 'predicted': lookup[row['origin']]})
    for key, rows in (('selected', predictions), ('baseline', baseline)):
        check_score(test[key], rows)
        assert [row['horizon'] for row in test[key]['byHorizon']] == [1, 2, 3]
        for group in test[key]['byHorizon']: check_score(group, [row for row in rows if row['horizon'] == group['horizon']])
    assert [row['horizon'] for row in test['intervalCoverage']] == [1, 2, 3]
    for group in test['intervalCoverage']:
        rows = [row for row in predictions if row['horizon'] == group['horizon']]
        assert group['count'] == len(rows)
        for level in (80, 95):
            expected = round(sum(row[f'lower{level}'] <= row['actual'] <= row[f'upper{level}'] for row in rows) / len(rows), 6)
            assert group[f'coverage{level}'] == expected, 'Recalculated interval coverage differs'
    assert len(report['forecast']) == 3
    for h, row in enumerate(report['forecast'], 1):
        assert row['horizon'] == h and row['month'] == month(history[-1]['month'], h)
        check_intervals(row)


def compare_release(actual, expected):
    for field in ('dataHash', 'methodVersion', 'status', 'selectedModel', 'history'):
        assert actual[field] == expected[field], f'Changed {field}; review and version the new release'
    # Existing MAE tolerance: 1%, floor .01. Existing point tolerance: .01%, floor .02.
    for section in ('selected', 'baseline'):
        for fresh, frozen in zip([actual['test'][section], *actual['test'][section]['byHorizon']], [expected['test'][section], *expected['test'][section]['byHorizon']], strict=True):
            assert abs(fresh['mae'] - frozen['mae']) <= max(.01, frozen['mae'] * .01), 'MAE outside release tolerance'
    for fresh, frozen in zip(actual['validation']['candidates'], expected['validation']['candidates'], strict=True):
        assert fresh['model'] == frozen['model'] and fresh['status'] == frozen['status']
        for a, b in zip([fresh, *fresh['byHorizon']], [frozen, *frozen['byHorizon']], strict=True):
            if b['mae'] is None: assert a['mae'] is None
            else: assert a['mae'] is not None and abs(a['mae'] - b['mae']) <= max(.01, b['mae'] * .01), 'Validation MAE outside release tolerance'
    for fresh, frozen in zip(actual['forecast'], expected['forecast'], strict=True):
        assert fresh['month'] == frozen['month']
        assert abs(fresh['predicted'] - frozen['predicted']) <= max(.02, frozen['predicted'] * .0001), 'Point forecast outside release tolerance'


def verify_reports(directory=Path('analytics/reports')):
    assert {path.name for path in directory.glob('*.json')} == REPORTS, 'Exactly five expected reports are required'
    for path in sorted(directory.glob('*.json')):
        actual = json.loads(path.read_text(encoding='utf-8'))
        expected = json.loads(subprocess.check_output(['git', 'show', f'HEAD:analytics/reports/{path.name}'], text=True, encoding='utf-8'))
        validate_report(actual)
        compare_release(actual, expected)
        print(f'Verified structure, recalculated metrics and release tolerances: {path.name}')


if __name__ == '__main__':
    verify_reports()
