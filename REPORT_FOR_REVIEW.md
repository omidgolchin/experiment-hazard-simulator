# Report for review — P06 experiment-hazard-simulator

## 1. What was built, and the result

A Monte Carlo simulator of a two-condition agent experiment, implemented
twice — Python (`sim/model.py`, NumPy) for the sweeps and JavaScript
(`docs/sim.js`) for the browser playground (`docs/index.html`) — with the
eight hazards from the agent-experiment-methodology skill as toggles,
each paired with the check that catches it.

- Plan and freeze: [PLAN.md](PLAN.md), [FREEZE_MANIFEST.txt](FREEZE_MANIFEST.txt)
- Sweeps and write-up numbers: [results/summary.md](results/summary.md),
  figure [results/figures/fpr_sweeps.png](results/figures/fpr_sweeps.png)
- Playground: [docs/index.html](docs/index.html), screenshots in
  [docs/screenshots/](docs/screenshots/)
- Decisions log: [DECISIONS.md](DECISIONS.md)

**Result.** At the default design (20 tasks, 5 seeds per condition, true
effect zero), a clean design gives a false-positive rate of 5.0%. At
realistic settings, single hazards push it to: compute bundling
(best-of-3) 91%, selective reporting (best of 5) 22%, unblinded judge
20%, prompt cue 14%, pseudo-replication 13%, differential failure
handling 13%, model drift 7.8%, and post-treatment exclusion 5.3% — the
one mild case at this study size (bias +0.02, rising to 9.0% false
positives at the strongest setting swept; the write-up says so plainly).
Two hazards at once give 97%. The pre-specified honest case behaves as
expected: pseudo-replication with homogeneous tasks (σ_task = 0) stays at
5.3%. All data are simulated.

## 2. Deviations from the spec, and every DECISIONS.md entry

Deviations:

- **Skill file could not be read.** The skill repository and
  `references/agent-hazards.md` returned HTTP 404 from this machine on
  2026-11-12 (presumably private). Per the build instruction I proceeded
  from the spec's own enumeration of the eight hazards and checks; the
  one-line checks are worded from the spec, not quoted verbatim from the
  skill file. Links to the skill are in place as specified. (DECISIONS 1)
- **Spec claim softened where the evidence required it.** The spec says
  each hazard produces confident wrong answers at realistic settings.
  Post-treatment exclusion at its pre-registered realistic setting is
  mild at T = 20 (above). The README and summary report the measured
  numbers rather than the stronger claim.
- **GitHub repo not created, nothing pushed.** Per the instruction for
  this pass (repo-access selection pending). The local git history is
  complete (git user "Omid Golchin" <omidgolchin92@gmail.com>, small
  meaningful commits). Creating the private repo under `omidgolchin`,
  setting the one-line description and topics, and pushing are pending —
  the README's playground/repo links already use the intended URLs and
  will 404 until then.

DECISIONS.md entries (each with its reason in the file):

1. Skill repo unreachable → checks worded from the spec's enumeration.
2. Unpaired task samples per condition — in a paired design the naive
   pooled SE is conservative, so hazard 4 could not show the spec's
   harm; the harmless case (σ_task = 0) is only special in this design.
3. Welch t-test over per-task means as the correct analysis (a z test
   gives a 6.4% clean baseline at T = 20, blurring hazard effects).
4. Exclusion modelled at task level for B (run-level dropout is mostly
   absorbed by the task-mean analysis; pilots shown in the file).
5. σ_noise = 0.5 by default (the spec's "+ noise" term).
6. No Web Worker; chunked main-thread simulation keeps the page
   responsive (spec allows a worker "if needed").
7. Chart.js 4.4.1 pinned from CDN, with a hand-drawn canvas fallback.
8. GitHub creation/push deferred (see above).
9. Selective-reporting outcomes are independent copies; correlation
   would weaken the hazard, independence is the clearer teaching case.

Post-freeze amendments (logged in PLAN.md, hashes appended to
FREEZE_MANIFEST.txt; simulation model untouched): playground seed bases
randomised per run (fixed seeds froze the clean design at an atypical
2.8% display), and a histogram caption/CSS fix.

## 3. Spend

$0.00. Simulation only; no API calls were made. See SPEND.md.

## 4. Tests and reproducibility

- `pytest`: 12/12 pass, including the JS↔Python agreement test (three
  documented settings, 20,000 experiments each; JS FPRs 0.0514 / 0.1292 /
  0.9124 vs Python within the 4× Monte Carlo tolerance) and behavioural
  tests for every hazard.
- Reproduce command: `python -m sim.analyze`. Verified from a fresh
  clone: tests pass and the command regenerates `results/summary.md`,
  the PNG figure and both JSON outputs byte-identically (the PDF figure
  differs only in embedded metadata).
- CI: `.github/workflows/ci.yml` is written (pytest + smoke test, no API
  calls) but has not run on GitHub because the repo does not exist yet.

## 5. Known issues and things I am unsure about

- The quoted checks should be diffed against the skill's exact wording
  once the skill repo is reachable; if the skill phrases them
  differently, update `sim/hazards.py`, the playground and the README
  table together (they are kept in sync manually).
- The sandbox browser used for screenshots could not reach the CDN, so
  the committed screenshots show the fallback histogram. Chart.js itself
  loads from the pinned jsdelivr URL in a normal browser (verified
  reachable over HTTPS), and interactive behaviour — presets, toggles,
  check cards, no horizontal scroll at 375 px, dark mode — was verified
  in the sandbox browser with zero page errors.
- Playground first-load numbers are single 1,000-experiment draws, so
  the clean design will show roughly 3.5–6.5% across visits rather than
  exactly 5%; the precomputed table on the page carries the
  10,000-experiment numbers.
- Exclusion and drift are genuinely the weakest hazards in this model.
  Both are one-parameter simplifications; a reviewer could reasonably
  argue for stronger parameterisations. The sweeps show the full
  dose-response so readers can judge.

## 6. Playground screenshots

- Desktop: [docs/screenshots/desktop.png](docs/screenshots/desktop.png)
- Phone (375 px): [docs/screenshots/phone.png](docs/screenshots/phone.png)

## 7. Draft LinkedIn post (do not post — for Omid's review)

> I built a small simulator that puts numbers on a question I keep
> asking when I read LLM-agent experiments: if one design flaw slips in,
> how often does the study report an effect that is not there? With a
> true effect of zero, a clean design cries wolf 5% of the time. Give
> condition B best-of-3 attempts and it is 91%. Cherry-pick the best of
> five outcomes and it is 22%. The simulator covers eight hazards, each
> paired with the check that catches it, and runs in the browser — all
> data simulated. Link in the comments. #LLMEvaluation
> #ExperimentalDesign

(≈95 words, two hashtags.)

## 8. Checklist for Omid before making the repo public

- [ ] Create the private repo `omidgolchin/experiment-hazard-simulator`,
      push, set the one-line description and 5–8 topics; make public only
      after the rest of this list passes.
- [ ] Diff the eight quoted checks against the skill's
      `references/agent-hazards.md` wording (the repo was unreachable
      from the build machine) and adjust if needed.
- [ ] Open the playground from the live Pages URL on a phone and a
      desktop browser; confirm Chart.js loads and the clean preset shows
      a false-positive rate near 5%.
- [ ] Read the README's exclusion paragraph and decide whether the
      honest-but-mild framing is the one you want to publish.
- [ ] Decide whether the LinkedIn draft (section 7) should be posted,
      edited, or dropped. It has not been posted anywhere.
- [ ] Confirm the CITATION.cff metadata (title, keywords) reads the way
      you want to be cited.
