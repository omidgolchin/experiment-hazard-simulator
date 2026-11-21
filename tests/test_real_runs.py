"""The planner against 6,000 real runs (validation/check_real_runs.py).

Two different models on the same GSM8K questions favour different questions:
41-61% of the single-run spread of per-question differences is stable. With
"A lot" (the setting for two different models), the planned task counts must
deliver at least 80% real power; without the interaction, the plans at 5 runs
per question delivered about half that, which is what this release fixes."""

from validation.check_real_runs import main


def test_plans_deliver_their_power_on_real_runs():
    rows = main(reps=1500, seed=3, write=False)
    for r in rows:
        assert 0.35 <= r["measured_interaction_share"] <= 0.65
        if r["setting"].startswith("A lot"):
            assert r["real_power"] >= 0.80, r
        if r["setting"] == "No" and r["attempts"] == 5:
            assert r["real_power"] < 0.60, r


def test_pilot_margin_helps_plans_reach_their_power():
    # Random 30-question pilots with 3 runs each, planning the next eval from them.
    from validation.check_pilot_margin import main as pilots
    rows = pilots(n_pilots=60, reps=400, sizes=(30,), seed=5, write=False)
    cells = {(r["pair"], r["runs_per_question"]): {} for r in rows}
    for r in rows:
        cells[(r["pair"], r["runs_per_question"])][r["plan"]] = r
    for c in cells.values():
        assert c["margin"]["share_reaching_75"] > c["plain"]["share_reaching_75"]
        assert c["margin"]["mean_power"] >= 0.80
