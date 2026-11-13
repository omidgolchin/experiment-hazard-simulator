# Plan — experiment hazard simulator

Frozen before the main sweeps. Changes after the freeze are recorded in
the amendment log at the bottom with "Outputs seen? Yes/No".

## Question and claim

**Question.** When one design hazard slips into an experiment on LLM
agents, how far off is the estimated effect, and how often does the study
report a "significant" effect that does not exist?

**Claim.** Each of the eight hazards from my
[agent-experiment-methodology](https://github.com/omidgolchin/agent-experiment-methodology)
skill produces confident wrong answers at realistic settings, and each is
caught by the specific check the skill names. One pre-specified case is
expected to be harmless (pseudo-replication when tasks are homogeneous),
and the write-up reports it as such.

All data are simulated. There is no empirical dataset and there are no API
calls; spend is $0.

## Simulation model

An experiment compares condition A (control) and B (treatment). Each
condition runs on its own sample of T tasks with S seeds per task.

- Task difficulty d_t ~ Normal(0, σ_task) on the logit scale.
- A run's success probability is sigmoid(base + d_t + δ·B + noise),
  noise ~ Normal(0, σ_noise); success is Bernoulli with that probability.
- Defaults: T = 20, S = 5, base = 0 (baseline success 0.5), σ_task = 1,
  σ_noise = 0.5, δ = 0, α = 0.05. Both arms also lose a flat 5% of runs
  at random (err_base — infrastructure flakiness, no bias by construction).
- Correct analysis: difference in success rates; per-task arm means, then
  a two-sample Welch standard error over the task means and a t reference
  distribution (the task is the replication unit; clustering by task is
  the standard fix for repeated-run evals).

The same model is implemented twice: Python (NumPy, `sim/`) for the
sweeps and write-up, and JavaScript (`docs/sim.js`) for the playground.
They must agree on the false-positive rate within Monte Carlo error on
three documented settings (clean; pseudo-replication at σ_task = 1;
compute bundling at k = 3), checked by `tests/test_js_agreement.py`
against saved JS output (`outputs/js_check.json`, from
`node sim/js_check.mjs`, 20,000 experiments per setting).

## Hazards and mechanisms

| # | Hazard | Mechanism in the model | Check (from the skill) |
|---|---|---|---|
| 1 | Compute bundling | B gets best-of-k attempts per run; A gets 1 | Compute-matched arm |
| 2 | Post-treatment exclusion | B's hard tasks error out entirely (prob. err_excess · task failure propensity); errored runs are dropped | Timing audit / intention-to-treat |
| 3 | Differential failure handling | Parse failures (rate f, both arms) counted as wrong in one arm, dropped as missing in the other | Same failure rule in both arms |
| 4 | Pseudo-replication | Analysis pools all runs with a naive two-proportion SE instead of clustering by task | Replication unit = task |
| 5 | Unblinded LLM judge | Judge sees the label; flips a B failure to a success with probability b | Blinded judging + judge validation |
| 6 | Model drift | Conditions run in sequence; halfway through B's block the model shifts B's logit by `drift` | Interleave runs, pin the version |
| 7 | Prompt cue | B's prompt adds a demand effect `cue` to B's logit | Difference table / matched wording |
| 8 | Selective reporting | M independent outcomes measured; the smallest p is reported uncorrected | Pre-specified primary outcome + multiplicity correction |

Two modelling choices to note (also in DECISIONS.md):

- **Unpaired task samples.** If both conditions ran on exactly the same
  tasks, task difficulty would cancel in a paired difference and the
  naive pooled SE would be conservative, not anti-conservative; the
  pseudo-replication inflation appears when each condition's task sample
  is its own draw (or inference is to new tasks). The spec's harmless
  case (σ_task = 0) only makes sense in this design, so the design is
  unpaired.
- **Task-clustered exclusion.** Run-level dropout that depends only on
  the run's own success propensity is largely absorbed by a task-mean
  analysis. The harmful real-world mechanism is that a hard task breaks
  the treated agent and all of its runs are lost together, so exclusion
  is modelled at task level for B.

## Pre-specified analyses

1. **Headline numbers** (10,000 experiments each): clean-design
   false-positive rate at δ = 0; clean power at δ = 0.3 and δ = 0.6;
   pseudo-replication at σ_task = 0 (expected ≈ 5%, the honest case);
   two hazards at once (best-of-3 + naive SE).
2. **Realistic-setting table** (10,000 experiments each, δ = 0): one row
   per hazard at the realistic setting in `sim/hazards.py`, reporting
   FPR and mean estimated effect.
3. **Sweeps** (4,000 experiments per point, δ = 0): each hazard's key
   parameter over the grid in `sim/hazards.py`, one panel per hazard:
   FPR vs hazard strength (`results/figures/fpr_sweeps.png`).
4. **Playground**: 1,000 experiments per setting in the browser, current
   settings vs the same design with hazards off; presets for the clean
   design, each hazard, two hazards at once, and the harmless case.

Report every number above in `results/summary.md`, including any that go
against the claim. Anything not listed here is exploratory and labelled
as such.

## Related work and what is different

- Hurlbert (1984) named pseudo-replication in ecological experiments:
  treating non-independent samples as replicates invalidates the error
  term. Hazard 4 is the same error with seeds in place of samples.
- Simmons, Nelson & Simonsohn (2011) showed by simulation that
  undisclosed flexibility in data collection and reporting inflates
  false-positive rates far above nominal. Hazard 8 is one of those
  flexibilities (choosing among dependent variables), isolated.
- LLM-as-a-judge is now standard in agent evaluation (Zheng et al.,
  2023), and evaluators show measurable self-preference when they can
  recognise the source (Panickssery, Bowman & Feng, 2024) — the family
  of biases hazard 5 simplifies into one parameter.
- Teaching simulators for single statistical ideas exist (p-hacking
  demos, power calculators). What this repo adds: all eight hazards of
  one published agent-experiment audit skill in a single model, each
  paired with its catching check, with the browser and Python
  implementations cross-validated against each other.

## References (all verified 2026-11-12)

- Hurlbert, S. H. (1984). Pseudoreplication and the design of ecological
  field experiments. *Ecological Monographs*, 54(2), 187–211.
  https://www.jstor.org/stable/1942661
- Simmons, J. P., Nelson, L. D., & Simonsohn, U. (2011). False-positive
  psychology: Undisclosed flexibility in data collection and analysis
  allows presenting anything as significant. *Psychological Science*,
  22(11), 1359–1366. https://doi.org/10.1177/0956797611417632
- Panickssery, A., Bowman, S. R., & Feng, S. (2024). LLM evaluators
  recognize and favor their own generations. *NeurIPS 2024*.
  https://arxiv.org/abs/2404.13076
- Zheng, L., Chiang, W.-L., Sheng, Y., et al. (2023). Judging LLM-as-a-judge
  with MT-bench and Chatbot Arena. *NeurIPS 2023*, 36, 46595–46623.
- Golchin, O. agent-experiment-methodology skill (the audit checklist
  this simulator is built from).
  https://github.com/omidgolchin/agent-experiment-methodology

## Amendment log

| Date | Change | Reason | Outputs seen? |
|---|---|---|---|
| 2026-11-12 | Playground seed bases are randomised per run instead of fixed (docs/app.js only; simulation model unchanged) | The fixed chunk seeds happened to give the clean design an atypical 2.8% false-positive rate on every page load, contradicting the page's own ≈5% claim; a fresh draw per run is the honest behaviour. Verified the simulator itself is unbiased at scale (JS and Python agree at 20,000 experiments). | Yes (playground display only; no sweep outputs affected) |
| 2026-11-12 | Playground wording/CSS fix (docs/index.html only): the histogram caption no longer mentions a dashed clean-mean line that was not drawn, and the canvas fills its card so the no-CDN fallback renders at full size | Caption described a visual element that does not exist; fallback rendering was undersized when the CDN was unreachable | Yes (playground display only) |
