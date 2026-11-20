"""Checkpoint policy for batching sprite rebuild reviews."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timedelta


MIN_COMMAND_AGE = timedelta(minutes=10)
MAX_ROUNDS = 10
MAX_MINUTES = timedelta(minutes=20)


@dataclass(frozen=True)
class Round:
    number: int
    at: datetime
    best_score: float
    newly_passed_gates: tuple[str, ...] = ()
    changes_note: str | None = None
    changed_note_parts: tuple[str, ...] = ()
    candidates: tuple[str, ...] = ()
    verdict_matches: bool | None = None


@dataclass(frozen=True)
class Checkpoint:
    round_number: int
    reasons: tuple[str, ...]
    addresses_note: str | None = None
    comparison_round: int | None = None
    candidates: tuple[str, ...] = ()


def review_checkpoints(rounds: list[Round], *, score_margin: float) -> list[Checkpoint]:
    """Select Commands; all other renders and scores remain local to the worker."""
    if score_margin <= 0:
        raise ValueError("score_margin must be positive")
    if any(later.number <= earlier.number or later.at < earlier.at
           for earlier, later in zip(rounds, rounds[1:])):
        raise ValueError("rounds must be in increasing number and time order")
    if not rounds:
        return []

    first = rounds[0]
    checkpoints = [Checkpoint(first.number, ("initial review",), candidates=first.candidates[:3])]
    last_command = first
    best_since_command = first.best_score
    judged: Round | None = first if first.verdict_matches is False else None
    if first.verdict_matches is True:
        return checkpoints

    for current in rounds[1:]:
        if current.verdict_matches is True:
            break
        if current.verdict_matches is False:
            judged = current
            last_command = current
            best_since_command = current.best_score
            continue

        if judged is not None:
            if current.at - last_command.at < MIN_COMMAND_AGE:
                continue
            if not set(judged.changed_note_parts) & set(current.changed_note_parts):
                continue
            checkpoints.append(Checkpoint(
                current.number, ("verdict follow-up",), judged.changes_note,
                judged.number, current.candidates[:3],
            ))
            last_command = current
            best_since_command = current.best_score
            judged = None
            continue

        if current.at - last_command.at < MIN_COMMAND_AGE:
            continue
        best_since_command = max(best_since_command, current.best_score)
        reasons: list[str] = []
        if current.newly_passed_gates:
            reasons.append("new gate passed")
        if best_since_command - last_command.best_score >= score_margin:
            reasons.append("score margin improved")
        if (current.number - last_command.number >= MAX_ROUNDS
                or current.at - last_command.at >= MAX_MINUTES):
            reasons.append("review interval reached")
        if reasons:
            checkpoints.append(Checkpoint(
                current.number, tuple(reasons), candidates=current.candidates[:3],
            ))
            last_command = current
            best_since_command = current.best_score
    return checkpoints


def apply_verdict(
    rounds: list[Round], *, verdict_round: int, matches: bool,
    note: str | None = None, changed_note_parts: tuple[str, ...] = (),
) -> list[Round]:
    """Attach an identified reviewer verdict to its judged round."""
    for index, current in enumerate(rounds):
        if current.number == verdict_round:
            rounds[index] = replace(
                current, changes_note=None if matches else note,
                changed_note_parts=() if matches else changed_note_parts,
                verdict_matches=matches,
            )
            return rounds
    raise ValueError(f"unknown verdict round: {verdict_round}")
