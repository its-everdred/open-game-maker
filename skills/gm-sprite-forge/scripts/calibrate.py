"""Propose sprite gates from dated creator verdicts; never edits gates.json."""
import argparse
import copy
import json
import math
import sys
from pathlib import Path

import score

GATES = Path(__file__).resolve().parent.parent / 'gates.json'


def calibrate(gates, records):
    proposed = copy.deepcopy(gates)
    conflicts = []
    history = {}
    for record in sorted(records, key=lambda r: r['date']):
        cls = record['class']
        if cls not in proposed:
            raise ValueError(f'unknown class: {cls}')
        verdict = record['verdict'].lower()
        if verdict not in ('matches', 'needs changes'):
            raise ValueError(f'unknown verdict: {verdict}')
        raw_scores = record['scores']
        rules = proposed[cls]
        # compare.py still emits one score.py result per prop view. Preserve the
        # strictest view because every prop view must satisfy its gate.
        if not any(metric in raw_scores for metric in rules):
            views = list(raw_scores.values())
            if not views or not all(isinstance(view, dict) for view in views):
                raise ValueError('scores must contain scorer results')
            scores = {}
            for metric, rule in rules.items():
                values = [view.get(metric) for view in views]
                if all(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) for value in values):
                    scores[metric] = min(values) if 'min' in rule else max(values)
                elif 'equals' in rule and all(value is not None for value in values):
                    scores[metric] = all(value == rule['equals'] for value in values)
        else:
            scores = raw_scores
        results = score.gate_results(scores, rules)
        changes = []
        if verdict == 'matches':
            for metric, rule in rules.items():
                value = scores.get(metric)
                if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
                    if 'min' in rule and value < rule['min']:
                        changes.append((metric, 'min', value))
                    elif 'max' in rule and value > rule['max']:
                        changes.append((metric, 'max', value))
        elif all(result['pass'] for result in results.values()):
            candidates = []
            for metric, rule in rules.items():
                value = scores.get(metric)
                if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
                    for op in ('min', 'max'):
                        if op in rule:
                            threshold = rule[op]
                            margin = (value - threshold if op == 'min' else threshold - value) / max(abs(threshold), 1e-12)
                            candidates.append((margin, metric, op, value))
            if candidates:
                _, metric, op, value = min(candidates)
                changes.append((metric, op, math.nextafter(value, math.inf if op == 'min' else -math.inf)))
        for metric, op, value in changes:
            key = (cls, metric, op)
            previous = history.get(key)
            if previous and previous['verdict'] != verdict:
                conflicts.append({'class': cls, 'metric': metric, 'earlier': previous, 'later': {'verdict': verdict, 'date': record['date'], 'round': record['round']}})
            rules[metric][op] = value
            history[key] = {'verdict': verdict, 'date': record['date'], 'round': record['round']}
    return {'gates': proposed, 'conflicts': conflicts}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('calibration', type=Path, help='JSONL verdict records with score.py JSON in scores')
    parser.add_argument('--gates', type=Path, default=GATES)
    args = parser.parse_args()
    try:
        gates = json.loads(args.gates.read_text())
        records = [json.loads(line) for line in args.calibration.read_text().splitlines() if line.strip()]
        print(json.dumps(calibrate(gates, records), indent=2, allow_nan=False))
    except (ValueError, KeyError, OSError) as exc:
        print(f'calibration error: {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
