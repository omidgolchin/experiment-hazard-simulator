# Decisions

Choices the spec left open, settled by the spec's decision rules or the
more conservative option, with reasons. (Program rule: no human
checkpoints; log and continue.)

1. **Skill file not reachable.** On 2026-11-12 the repository
   https://github.com/omidgolchin/agent-experiment-methodology and its
   `references/agent-hazards.md` both returned HTTP 404 from this machine
   (the repo is presumably private). I proceeded from the spec's own
   enumeration of the eight hazards and their checks, which is
   self-contained, and worded the one-line checks from it
   (`sim/hazards.py`). The playground and README still link to the skill,
   as the spec instructs. If the skill's exact wording differs, the
   quoted checks should be updated to match it verbatim.

2. **Unpaired task samples.** The spec does not say whether A and B share
   the same tasks. With shared (paired) tasks, difficulty cancels in the
   paired difference and the naive pooled SE is *conservative*, so hazard
   4 could not show the harm the spec describes, and the spec's harmless
   case (σ_task = 0) would not be special. With independent task samples
   per condition, the naive SE understates the task-level variance and
   the false-positive rate inflates with σ_task, collapsing to nominal
   at σ_task = 0 — exactly the spec's pattern. I used the unpaired
   design and say so in PLAN.md and the README.

3. **Welch t-test as the correct analysis.** A z test with an estimated
   cluster SE at T = 20 gives a clean-design false-positive rate of
   ≈ 6.4%, which would blur every hazard's effect. A Welch two-sample
   t-test over per-task means (df by Welch–Satterthwaite) keeps the
   clean baseline at the nominal 5%, so departures are attributable to
   hazards, not to the test. The naive analysis keeps the z test a
   careless analyst would actually run on pooled runs.

4. **Exclusion modelled at task level for B.** A pilot showed run-level
   dropout depending on the run's success propensity is mostly absorbed
   by the task-mean analysis (bias ≈ +0.03 at the strongest setting),
   because within a task it removes a near-random subset. The mechanism
   that actually biases agent experiments — a hard task breaks the
   treated agent (loops, timeouts) and all of its runs are lost
   together — is task-level, so B's hard tasks error out entirely with
   probability err_excess · (task failure propensity). A flat 5%
   run-level dropout in both arms stays, as harmless background.

5. **σ_noise = 0.5 by default.** The spec's model has a "+ noise" term;
   0.5 on the logit scale gives runs within a task distinct propensities
   without dominating task difficulty (σ_task = 1). Pilots confirmed the
   clean false-positive rate stays at 5%.

6. **No Web Worker.** The spec allows a worker "if needed for speed".
   At the default design 1,000 experiments take well under a second; the
   heaviest preset (selective reporting, M = 12) takes a few seconds.
   The page runs the simulation in chunks of 100 experiments with the
   event loop yielded between chunks, keeping the page responsive
   without worker plumbing.

7. **Chart.js 4.4.1, pinned CDN, with a hand-drawn fallback.** One
   charting library as required; if the CDN is unreachable the histogram
   falls back to a plain canvas rendering so the page still works
   offline after first load of sim.js/app.js.

8. **GitHub repo not created in this pass.** Per the build instruction
   for this pass (Omid's GitHub repo-access selection is still pending),
   the repo is local-only; creating and pushing the private repo is
   recorded as pending in REPORT_FOR_REVIEW.md. The README links use the
   intended repo URL, https://github.com/omidgolchin/experiment-hazard-simulator.

9. **Selective-reporting outcomes are independent copies.** Each of the
   M outcomes is a full independent copy of the experiment (own task
   samples and runs), and the reported one is the copy with the smallest
   p-value. Real outcomes measured on the same runs would be correlated,
   which would make selective reporting *weaker*; independence is the
   clearer teaching case and is stated in the write-up.

## 2026-11-13: v2, rebuilt as the Agent Eval Planner

- The page demonstrated eight hazards with sliders and a precomputed table; it did not help anyone plan or check an eval. v2 does that job: plan (chance to detect, fake-win rate, tasks for 80%) and check (task-level interval from pasted results). The sweeps moved to Research notes.
- New engine (`docs/evalsim.js`, NumPy reference `sim/planner.py`) adds the paired design: both versions on the same tasks, paired t-test on per-task differences. Paired is the default because shared benchmarks are the norm.
- Fake wins count significant differences in either direction (sound design = 5%); chance to detect counts wins for B only.
- Each "no" in the checklist is simulated alone to classify it as creating fake wins, costing power, or minor at these settings. Pooling attempts is conservative under pairing (costs power) and anti-conservative without it (fake wins); the tool shows which.
- Tasks for 80% from the simulated spread of per-task differences, checked by simulated power (test: 80% +/- 3 points).
- The original hazard engine moved to `sim/hazard_sim.js`; its JS/Python agreement test still runs.

## 2026-11-18: what a screen reader announces

- Only the verdict title is announced. The whole verdict panel used to
  be one `aria-live` region, and its KPI tiles and checks are rewritten
  on every run, so a screen reader read them all again after each pause
  in typing. Now the title alone carries `aria-live="polite"` and
  `aria-atomic="true"`: a changed verdict is announced in full, and the
  KPIs and checks stay on the page for the reader to move to. The title
  is written only when its text changes, so an unchanged verdict is not
  read out again.

## 2026-11-21: tasks that suit one version better

- Checked against 6,000 real runs (3 models x 400 GSM8K questions x 5 runs, from llm-eval-error-bars), the planner's task counts for 80% power delivered 41-49% at 5 runs per question. The engine gave every task the same effect, so per-task differences shrank with every extra attempt. In the real runs 41-61% of the single-run spread of per-question differences is stable and does not shrink.
- The engine (`docs/evalsim.js`, `sim/planner.py`) now draws a per-task shift u ~ Normal(0, sigma_int), +u/2 for B and -u/2 for A, so the null stays exact at any success rate and the design is symmetric in A and B. sigma_int = 0 draws no extra random numbers and reproduces the earlier engine exactly.
- New input "Do the versions favour different tasks?": No / A little / Somewhat / A lot, like two models (sigma_int 0, 1.1, 2, 3.75; about 0, 10, 25 and 50% of the single-attempt spread of per-task differences). Default Somewhat. Only "A lot" is backed by real data, so the verdict shows the task count at all three non-zero settings.
- The results checker estimates the share from pasted results with 2+ attempts per task and names the setting to use next. A pilot of 50 tasks estimated 26% for a pair whose full 400 questions gave 42%, so the message tells users with under 100 tasks to take the larger setting when in doubt.
- Corrected: the tasks-vs-attempts tip (it said extra attempts work almost as well as extra tasks under pairing), the README's "conservative with shared tasks" line, the unit-of-analysis row and the check-mode note on the pooled interval. Real-run check added as a test (`tests/test_real_runs.py`). Screenshots and the GIF regenerated.
