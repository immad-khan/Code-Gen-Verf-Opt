"""Unit tests for tivr.metrics (Requirements 14 and 15)."""
import json
from pathlib import Path

import pytest

from tivr.config import Decoding, RunConfig
from tivr.llm_client import CallRecord
from tivr.metrics import (
    ProgramOutcome, build_summary, conditional_rates, cost, evolution_matrices,
    highest_priority_category, pass_at_1, per_category, per_primary_type, rate, rsr,
    unmapped_as_c_by_iteration,
)
from tivr.taxonomy_def import load_definition


@pytest.fixture(scope="module")
def definition():
    return load_definition()


def _paper_outcomes() -> list[ProgramOutcome]:
    """Paper Section 6.2 example: N=120, 29 pass at iteration 1, 6 more at iteration 2."""
    out = []
    for i in range(29):
        out.append(ProgramOutcome(f"T/{i:03d}", ("C", "PASS", "PASS"), "C.1"))
    for i in range(29, 35):
        out.append(ProgramOutcome(f"T/{i:03d}", ("B", "C", "PASS"), "B.1"))
    for i in range(35, 120):
        out.append(ProgramOutcome(f"T/{i:03d}", ("C", "C", "C"), "C.1"))
    return out


# ---- rate ---------------------------------------------------------------

def test_rate_rounds_half_up():
    assert rate(1, 8) == {"num": 1, "den": 8, "pct": 12.5}
    assert rate(1, 16)["pct"] == 6.3          # 6.25 → 6.3 (not banker's 6.2)
    assert rate(1, 3)["pct"] == 33.3
    assert rate(2, 3)["pct"] == 66.7
    assert rate(3, 3)["pct"] == 100.0


def test_rate_zero_denominator_is_null():
    assert rate(0, 0) == {"num": 0, "den": 0, "pct": None}


@pytest.mark.parametrize("num,den", [(-1, 3), (4, 3), (1, 0), (True, 2), (1.0, 2)])
def test_rate_rejects_invalid(num, den):
    with pytest.raises(ValueError):
        rate(num, den)


# ---- ProgramOutcome -----------------------------------------------------

def test_outcome_validates_states():
    with pytest.raises(ValueError):
        ProgramOutcome("t", ("PASS",))                 # s0 must be A/B/C
    with pytest.raises(ValueError):
        ProgramOutcome("t", ("C", "PASS", "B"))        # PASS absorbing
    with pytest.raises(ValueError):
        ProgramOutcome("t", ("C", "X"))
    with pytest.raises(ValueError):
        ProgramOutcome("t", ())


def test_outcome_round_trips_programs_jsonl_line():
    o = ProgramOutcome("HumanEval/12", ["C", "B", "PASS"], "C.1", [False, False, False],
                       iterations_run=2, stop_reason="hidden_pass")
    d = o.to_dict()
    assert d == {"task_id": "HumanEval/12", "states": ["C", "B", "PASS"], "initial_category": "C.1",
                 "unmapped_as_c": [False, False, False], "iterations_run": 2,
                 "stop_reason": "hidden_pass", "empty_visible_suite": False}
    assert ProgramOutcome.from_dict(json.loads(json.dumps(d))) == o


def test_highest_priority_category(definition):
    order = definition.priority_order
    assert highest_priority_category([order[5], order[2], order[9]], definition) == order[2]
    assert highest_priority_category([], definition) == "UNMAPPED"
    assert highest_priority_category(["UNMAPPED", order[-1]], definition) == order[-1]


# ---- paper example ------------------------------------------------------

def test_paper_example_rsr_and_conditional():
    outcomes = _paper_outcomes()
    assert rsr(outcomes, 2) == [
        {"iteration": 1, "num": 29, "den": 120, "pct": 24.2},
        {"iteration": 2, "num": 35, "den": 120, "pct": 29.2},
    ]
    assert conditional_rates(outcomes, 2) == [{"iteration": 2, "num": 6, "den": 91, "pct": 6.6}]


def test_paper_example_per_primary_type_matches_matrix():
    outcomes = _paper_outcomes()
    ppt = per_primary_type(outcomes, 2)
    mats = evolution_matrices(outcomes, 2)
    assert ppt[0]["A"] == {"num": 0, "den": 0, "pct": None}
    assert ppt[0]["B"] == {"num": 0, "den": 6, "pct": 0.0}
    assert ppt[0]["C"] == {"num": 29, "den": 114, "pct": 25.4}
    assert ppt[1]["C"] == {"num": 6, "den": 91, "pct": 6.6}
    for p, m in zip(ppt, mats):
        for r, x in enumerate(("A", "B", "C")):
            assert p[x]["den"] == sum(m["counts"][r])
            assert p[x]["num"] == m["counts"][r][3]


def test_per_category_has_all_categories_and_unmapped(definition):
    outcomes = _paper_outcomes()
    pc = per_category(outcomes, definition, 2)
    assert list(pc) == list(definition.priority_order) + ["UNMAPPED"]
    assert len(pc) == 13
    assert pc["C.1"] == {"num": 29, "den": 114, "pct": 25.4}
    assert pc["B.1"] == {"num": 6, "den": 6, "pct": 100.0}
    assert pc["UNMAPPED"] == {"num": 0, "den": 0, "pct": None}
    # Within k only: a k=1 horizon excludes the iteration-2 passes.
    assert per_category(outcomes, definition, 1)["B.1"]["num"] == 0


def test_per_category_rejects_unknown_category(definition):
    with pytest.raises(ValueError):
        per_category([ProgramOutcome("t", ("C", "C"), "Z.9")], definition)


# ---- zero denominators --------------------------------------------------

def test_empty_sample_produces_null_rates(definition):
    assert rsr([], 2) == [{"iteration": 1, "num": 0, "den": 0, "pct": None},
                          {"iteration": 2, "num": 0, "den": 0, "pct": None}]
    assert conditional_rates([], 2) == [{"iteration": 2, "num": 0, "den": 0, "pct": None}]
    assert all(v["pct"] is None for v in per_category([], definition).values())
    mats = evolution_matrices([], 2)
    assert len(mats) == 2
    assert all(row == [None] * 4 for m in mats for row in m["row_percentages"])


def test_conditional_rate_null_when_everything_passed_at_iteration_1():
    outcomes = [ProgramOutcome("a", ("A", "PASS", "PASS")), ProgramOutcome("b", ("C", "PASS", "PASS"))]
    assert conditional_rates(outcomes, 2) == [{"iteration": 2, "num": 0, "den": 0, "pct": None}]


def test_k_1_has_no_conditional_rates():
    assert conditional_rates([ProgramOutcome("a", ("A", "PASS"))], 1) == []


# ---- evolution matrices -------------------------------------------------

def test_evolution_matrix_carry_forward_and_pass_absorbing():
    k = 3
    outcomes = [
        ProgramOutcome("p1", ("A", "PASS")),             # loop ended at 1 → carried PASS
        ProgramOutcome("p2", ("B", "C", "PASS")),        # carried PASS at 3
        ProgramOutcome("p3", ("C",)),                    # LLM error before iteration 1 → C carried
        ProgramOutcome("p4", ("C", "B", "B", "C")),
    ]
    mats = evolution_matrices(outcomes, k)
    assert [m["iteration"] for m in mats] == [1, 2, 3]
    assert all(m["states"] == ["A", "B", "C", "PASS"] for m in mats)
    # A B C PASS
    assert mats[0]["counts"] == [[0, 0, 0, 1], [0, 0, 1, 0], [0, 1, 1, 0], [0, 0, 0, 0]]
    assert mats[1]["counts"] == [[0, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 1], [0, 0, 0, 1]]
    assert mats[2]["counts"] == [[0, 0, 0, 0], [0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 0, 2]]
    for m in mats:
        assert sum(map(sum, m["counts"])) == len(outcomes)           # conservation
        assert m["counts"][3][:3] == [0, 0, 0]                        # PASS absorbing
        for counts, pcts in zip(m["counts"], m["row_percentages"]):
            if sum(counts) == 0:
                assert pcts == [None] * 4
            else:
                assert abs(sum(pcts) - 100.0) <= 0.01
                assert all(0.0 <= p <= 100.0 for p in pcts)
    assert mats[0]["row_percentages"][2] == [0.0, 50.0, 50.0, 0.0]
    assert mats[0]["row_percentages"][3] == [None] * 4                # iteration-1 PASS row empty
    # PASS column / N == RSR_i
    for m, r in zip(mats, rsr(outcomes, k)):
        assert sum(row[3] for row in m["counts"]) == r["num"]


def test_row_percentages_are_unrounded():
    outcomes = [ProgramOutcome(f"t{i}", s) for i, s in enumerate(
        [("B", "B")] * 20 + [("B", "C")] * 2 + [("B", "PASS")] * 6)]
    row = evolution_matrices(outcomes, 1)[0]["row_percentages"][1]
    assert row == [0.0, 100.0 * 20 / 28, 100.0 * 2 / 28, 100.0 * 6 / 28]


def test_states_longer_than_k_plus_1_rejected():
    with pytest.raises(ValueError):
        rsr([ProgramOutcome("t", ("C", "C", "C"))], 1)


def test_unmapped_as_c_by_iteration_counts_only_flagged_iterations():
    outcomes = [ProgramOutcome("a", ("C", "C", "PASS"), unmapped_as_c=(True, False, False)),
                ProgramOutcome("b", ("C", "C"), unmapped_as_c=(False, True))]
    assert unmapped_as_c_by_iteration(outcomes, 2) == [1, 1, 0]


# ---- pass@1 and cost ----------------------------------------------------

def test_pass_at_1_before_and_after():
    entries = [{"task_id": "t0", "hidden": {"passed": True}},
               {"task_id": "t1", "hidden": {"passed": False}},
               {"task_id": "t2", "hidden": {"passed": False}},
               {"task_id": "t3", "hidden": {"passed": False}}]   # not in sample
    outcomes = [ProgramOutcome("t1", ("C", "PASS")), ProgramOutcome("t2", ("B", "B"))]
    assert pass_at_1(entries, outcomes, 1) == {
        "before": {"num": 1, "den": 4, "pct": 25.0},
        "after": {"num": 2, "den": 4, "pct": 50.0},
    }


def test_cost_counts_repair_calls_and_excludes_missing_usage():
    calls = [CallRecord(1000, 500, "generation"),
             CallRecord(100, 40, "repair"),
             CallRecord(200, 60, "repair"),
             CallRecord(None, None, "repair"),
             CallRecord(50, None, "repair")]
    assert cost(calls, 2) == {
        "llm_calls": 4, "calls_without_usage": 2, "prompt_tokens": 300, "completion_tokens": 100,
        "per_program": {"llm_calls": 2.0, "prompt_tokens": 150.0, "completion_tokens": 50.0},
    }


def test_cost_all_calls_without_usage_and_zero_n():
    c = cost([CallRecord(None, None, "repair")], 1)
    assert c["llm_calls"] == 1 and c["calls_without_usage"] == 1
    assert c["prompt_tokens"] is None and c["per_program"]["prompt_tokens"] is None
    assert cost([], 0) == {"llm_calls": 0, "calls_without_usage": 0, "prompt_tokens": 0,
                           "completion_tokens": 0,
                           "per_program": {"llm_calls": None, "prompt_tokens": None,
                                           "completion_tokens": None}}


# ---- build_summary ------------------------------------------------------

def test_build_summary_schema_and_round_trip(definition):
    outcomes = _paper_outcomes()
    entries = ([{"task_id": f"T/{i:03d}", "hidden": {"passed": False}} for i in range(120)]
               + [{"task_id": f"P/{i:02d}", "hidden": {"passed": True}} for i in range(44)])
    calls = [CallRecord(900, 300, "repair")] * 240
    cfg = RunConfig(dataset=Path("data/humaneval_plus.jsonl"), mode="dou", feedback_regime="dou", k=2,
                    decoding=Decoding(temperature=0.1), sample_size=120, seed=0, model="gpt-4")
    s = build_summary(outcomes, entries, calls, cfg, run_id="r1", definition=definition,
                      dataset_sha256="ab" * 32, api_host="api.openai.com:443")
    assert list(s) == ["schema", "run_id", "llm_mode", "taxonomy_version", "dataset", "config",
                       "sample", "pass_at_1", "rsr", "conditional_repair_rate", "per_primary_type",
                       "per_category", "bug_evolution", "unmapped_as_c_by_iteration",
                       "empty_visible_suite_programs", "cost"]
    assert s["schema"] == "tivr.run_summary.v1"
    assert s["llm_mode"] == "live"
    assert s["taxonomy_version"] == definition.version
    assert s["dataset"] == {"path": str(Path("data/humaneval_plus.jsonl")), "sha256": "ab" * 32,
                            "task_count": 164}
    assert s["config"] == {"repair_mode": "dou", "feedback_regime": "dou", "k": 2, "model": "gpt-4",
                           "api_host": "api.openai.com:443", "temperature": 0.1, "top_p": None,
                           "max_tokens": None, "generation_prompt_style": cfg.generation_prompt_style,
                           "seed": 0}
    assert s["sample"] == {"requested": 120, "actual": 120}
    assert s["pass_at_1"]["before"] == {"num": 44, "den": 164, "pct": 26.8}
    assert s["pass_at_1"]["after"] == {"num": 79, "den": 164, "pct": 48.2}
    assert s["rsr"][0]["pct"] == 24.2 and s["rsr"][1]["pct"] == 29.2
    assert s["conditional_repair_rate"] == [{"iteration": 2, "num": 6, "den": 91, "pct": 6.6}]
    assert len(s["bug_evolution"]) == 2
    assert s["unmapped_as_c_by_iteration"] == [0, 0, 0]
    assert s["empty_visible_suite_programs"] == 0
    assert s["cost"]["llm_calls"] == 240 and s["cost"]["per_program"]["llm_calls"] == 2.0
    text = json.dumps(s, allow_nan=False)
    assert json.loads(text) == s


def test_build_summary_zero_incorrect(definition):
    entries = [{"task_id": "t0", "hidden": {"passed": True}}]
    cfg = RunConfig(dataset=Path("d.jsonl"), k=2, sample_size=10, mock=True)
    s = build_summary([], entries, [], cfg, run_id="r0", definition=definition, dataset_sha256="0" * 64)
    assert s["sample"] == {"requested": 10, "actual": 0}
    assert s["llm_mode"] == "mock"
    assert s["rsr"][0]["pct"] is None
    assert s["pass_at_1"]["after"] == {"num": 1, "den": 1, "pct": 100.0}
    assert json.loads(json.dumps(s, allow_nan=False)) == s
