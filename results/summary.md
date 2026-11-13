# Results — experiment hazard simulator

All data are simulated. Each number is the share of simulated experiments (true effect delta = 0 unless stated) that report a statistically significant effect at alpha = 0.05 — the false-positive rate (FPR) — plus the mean estimated effect (success-rate difference, B − A). Defaults: 20 tasks and 5 seeds per condition, sigma_task = 1, base success rate 0.5. Sweep points use 4000 experiments each; headline and realistic-setting numbers use 10000.

## Headline numbers

| Setting | FPR / power | Mean estimate |
|---|---|---|
| Clean design, delta = 0 (false-positive rate) | 0.050 | -0.001 |
| Clean design, delta = 0.3 (power) | 0.101 | +0.059 |
| Clean design, delta = 0.6 (power) | 0.251 | +0.119 |
| Pseudo-replication with sigma_task = 0 (the honest case) | 0.053 | -0.000 |
| Two hazards at once (best-of-3 + naive SE) | 0.973 | +0.299 |

## Each hazard at a realistic setting (delta = 0)

| Hazard | Setting | FPR | Mean estimate | Check that catches it |
|---|---|---|---|---|
| Compute bundling | compute_k = 3 | 0.912 | +0.300 | compute-matched arm |
| Post-treatment exclusion | err_excess = 0.4 | 0.053 | +0.022 | timing audit / intention-to-treat |
| Differential failure handling | parse_fail_rate = 0.15 | 0.129 | -0.075 | same failure rule in both arms |
| Pseudo-replication | naive_se = True, sigma_task = 1.0 | 0.128 | +0.000 | replication unit = task |
| Unblinded LLM judge | judge_bias = 0.2 | 0.199 | +0.101 | blinded judging + judge validation |
| Model drift | drift = 0.5 | 0.078 | +0.049 | interleave runs, pin the version |
| Prompt cue | prompt_cue = 0.4 | 0.138 | +0.080 | difference table / matched wording |
| Selective reporting | n_outcomes = 5 | 0.224 | +0.001 | pre-specified primary outcome + correction |

## Sweeps (delta = 0, 4000 experiments per point)

### Compute bundling — best-of-k samples for condition B

| compute_k | FPR | MC SE | Mean estimate |
|---|---|---|---|
| 1 | 0.048 | 0.003 | -0.002 |
| 2 | 0.571 | 0.008 | +0.199 |
| 3 | 0.911 | 0.005 | +0.296 |
| 4 | 0.984 | 0.002 | +0.356 |
| 6 | 0.999 | 0.001 | +0.416 |
| 8 | 1.000 | 0.000 | +0.445 |

### Post-treatment exclusion — excess error-out rate on hard tasks in B

| err_excess | FPR | MC SE | Mean estimate |
|---|---|---|---|
| 0.0 | 0.050 | 0.003 | -0.001 |
| 0.16 | 0.051 | 0.003 | +0.009 |
| 0.32 | 0.055 | 0.004 | +0.015 |
| 0.48 | 0.063 | 0.004 | +0.028 |
| 0.64 | 0.062 | 0.004 | +0.040 |
| 0.8 | 0.090 | 0.005 | +0.058 |

### Differential failure handling — parse-failure rate (both arms)

| parse_fail_rate | FPR | MC SE | Mean estimate |
|---|---|---|---|
| 0.0 | 0.050 | 0.003 | -0.001 |
| 0.05 | 0.061 | 0.004 | -0.024 |
| 0.1 | 0.080 | 0.004 | -0.046 |
| 0.15 | 0.119 | 0.005 | -0.073 |
| 0.2 | 0.191 | 0.006 | -0.102 |
| 0.3 | 0.337 | 0.007 | -0.149 |

### Pseudo-replication — task-difficulty spread sigma_task (naive SE on)

| sigma_task | FPR | MC SE | Mean estimate |
|---|---|---|---|
| 0.0 | 0.053 | 0.004 | -0.001 |
| 0.25 | 0.051 | 0.003 | +0.002 |
| 0.5 | 0.078 | 0.004 | -0.000 |
| 0.75 | 0.093 | 0.005 | -0.001 |
| 1.0 | 0.130 | 0.005 | +0.000 |
| 1.5 | 0.187 | 0.006 | +0.001 |

### Unblinded LLM judge — judge bias b toward B (label visible)

| judge_bias | FPR | MC SE | Mean estimate |
|---|---|---|---|
| 0.0 | 0.051 | 0.003 | +0.002 |
| 0.05 | 0.061 | 0.004 | +0.028 |
| 0.1 | 0.077 | 0.004 | +0.048 |
| 0.2 | 0.200 | 0.006 | +0.101 |
| 0.3 | 0.391 | 0.008 | +0.151 |
| 0.4 | 0.635 | 0.008 | +0.200 |

### Model drift — logit shift halfway through B's block

| drift | FPR | MC SE | Mean estimate |
|---|---|---|---|
| 0.0 | 0.046 | 0.003 | -0.000 |
| 0.1 | 0.051 | 0.003 | +0.012 |
| 0.2 | 0.058 | 0.004 | +0.020 |
| 0.3 | 0.064 | 0.004 | +0.030 |
| 0.5 | 0.085 | 0.004 | +0.049 |
| 0.75 | 0.119 | 0.005 | +0.073 |

### Prompt cue — demand effect added to B's logit

| prompt_cue | FPR | MC SE | Mean estimate |
|---|---|---|---|
| 0.0 | 0.050 | 0.003 | +0.003 |
| 0.1 | 0.063 | 0.004 | +0.020 |
| 0.2 | 0.069 | 0.004 | +0.040 |
| 0.3 | 0.096 | 0.005 | +0.060 |
| 0.5 | 0.185 | 0.006 | +0.100 |
| 0.75 | 0.369 | 0.008 | +0.148 |

### Selective reporting — outcomes measured (best one reported)

| n_outcomes | FPR | MC SE | Mean estimate |
|---|---|---|---|
| 1 | 0.052 | 0.004 | -0.001 |
| 2 | 0.096 | 0.005 | +0.001 |
| 3 | 0.139 | 0.005 | -0.003 |
| 5 | 0.230 | 0.007 | -0.001 |
| 8 | 0.344 | 0.008 | +0.001 |
| 12 | 0.462 | 0.008 | -0.003 |

Figure: `results/figures/fpr_sweeps.png` — one panel per hazard.
