import copy
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import calibrate

GATES = json.loads(calibrate.GATES.read_text())
SCORES = {'silhouette_iou': .95, 'pixel_similarity': .96, 'palette_distance': 2,
          'edge_f1': .8, 'lum_hist_l1': .1, 'shadow_iou': .7}


def record(verdict, date, **scores):
    return {'class': 'prop', 'round': date, 'date': date, 'verdict': verdict,
            'scores': {**SCORES, **scores}}


def test_matching_round_lowers_gate_without_modifying_input():
    original = copy.deepcopy(GATES)
    result = calibrate.calibrate(GATES, [record('matches', '2026-01-01', silhouette_iou=.86)])
    assert result['gates']['prop']['silhouette_iou']['min'] == .86
    assert GATES == original


def test_rejected_passing_round_tightens_weakest_metric():
    result = calibrate.calibrate(GATES, [record('needs changes', '2026-01-01')])
    assert result['gates']['prop']['pixel_similarity']['min'] > .96


def test_later_conflict_wins_even_if_input_unordered():
    result = calibrate.calibrate(GATES, [record('matches', '2026-01-02', pixel_similarity=.96), record('needs changes', '2026-01-01')])
    assert result['gates']['prop']['pixel_similarity']['min'] == .96
    assert result['conflicts'][0]['metric'] == 'pixel_similarity'


def test_unknown_class_fails():
    with pytest.raises(ValueError, match='unknown class'):
        calibrate.calibrate(GATES, [{**record('matches', '2026-01-01'), 'class': 'other'}])


def test_prop_comparison_uses_worst_view():
    views = {'N': SCORES, 'E': {**SCORES, 'silhouette_iou': .86}}
    result = calibrate.calibrate(GATES, [{**record('matches', '2026-01-01'), 'scores': views}])
    assert result['gates']['prop']['silhouette_iou']['min'] == .86


def test_failing_rejection_does_not_tighten_a_passing_view():
    views = {'N': SCORES, 'E': {**SCORES, 'shadow_iou': .5}}
    result = calibrate.calibrate(GATES, [{**record('needs changes', '2026-01-01'), 'scores': views}])
    assert result['gates'] == GATES


def test_passing_match_conflicts_with_later_rejection():
    result = calibrate.calibrate(GATES, [record('matches', '2026-01-01'), record('needs changes', '2026-01-02')])
    assert result['gates']['prop']['pixel_similarity']['min'] > .96
    assert result['conflicts'][0]['earlier']['verdict'] == 'matches'


def test_rejection_uses_original_gates_not_prior_proposal():
    result = calibrate.calibrate(GATES, [record('matches', '2026-01-01', silhouette_iou=.8),
                                        record('needs changes', '2026-01-02', silhouette_iou=.85)])
    assert result['gates']['prop']['silhouette_iou']['min'] == .8
    assert result['gates']['prop']['pixel_similarity']['min'] == .95


def test_dates_are_sorted_by_instant():
    later = record('matches', '2026-01-02T00:00:00Z', pixel_similarity=.96)
    earlier = record('needs changes', '2026-01-02T01:00:00+02:00')
    result = calibrate.calibrate(GATES, [later, earlier])
    assert result['gates']['prop']['pixel_similarity']['min'] == .96
    assert result['conflicts']


def test_rejection_honors_recorded_gate_snapshot():
    snapshot = copy.deepcopy(GATES['prop'])
    snapshot['silhouette_iou']['min'] = .99
    scored = {**SCORES, 'gates': {key: {'rule': rule} for key, rule in snapshot.items()}}
    result = calibrate.calibrate(GATES, [{**record('needs changes', '2026-01-01'), 'scores': scored}])
    assert result['gates'] == GATES
