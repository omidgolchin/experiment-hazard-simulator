"""The eight hazards: names, mechanisms, the check that catches each one,
realistic settings, and sweep grids.

The one-line checks are worded from the hazard enumeration in the project
spec (the skill repository itself was not publicly reachable at build
time; see DECISIONS.md). The skill lives at SKILL_URL.
"""

SKILL_URL = "https://github.com/omidgolchin/agent-experiment-methodology"
SKILL_HAZARDS_URL = SKILL_URL + "/blob/main/references/agent-hazards.md"

HAZARDS = [
    {
        "id": "compute_bundling",
        "name": "Compute bundling",
        "param": "compute_k",
        "param_label": "best-of-k samples for condition B",
        "what_goes_wrong": "Condition B also gets more attempts per task (best-of-k), "
        "so the estimate mixes the treatment with extra compute.",
        "check": "Run a compute-matched arm: give the control the same steps "
        "and samples before crediting the treatment.",
        "check_short": "compute-matched arm",
        "realistic": {"compute_k": 3},
        "sweep": [1, 2, 3, 4, 6, 8],
    },
    {
        "id": "post_treatment_exclusion",
        "name": "Post-treatment exclusion",
        "param": "err_excess",
        "param_label": "excess error-out rate on hard tasks in B",
        "what_goes_wrong": "Runs that hit an error are dropped after the fact, "
        "and B errors out on hard tasks, so B's surviving tasks are easier.",
        "check": "Audit when exclusions happen and analyse intention-to-treat: "
        "every run you started counts.",
        "check_short": "timing audit / intention-to-treat",
        "realistic": {"err_excess": 0.4},
        "sweep": [0.0, 0.16, 0.32, 0.48, 0.64, 0.8],
    },
    {
        "id": "differential_failure_handling",
        "name": "Differential failure handling",
        "param": "parse_fail_rate",
        "param_label": "parse-failure rate (both arms)",
        "what_goes_wrong": "Parse failures are counted as missing in one arm "
        "and as wrong in the other, so the same event moves only one rate.",
        "check": "Use one failure rule in both arms: a parse failure is "
        "missing everywhere or wrong everywhere.",
        "check_short": "same failure rule in both arms",
        "realistic": {"parse_fail_rate": 0.15},
        "sweep": [0.0, 0.05, 0.1, 0.15, 0.2, 0.3],
    },
    {
        "id": "pseudo_replication",
        "name": "Pseudo-replication",
        "param": "sigma_task",
        "param_label": "task-difficulty spread sigma_task (naive SE on)",
        "what_goes_wrong": "Seeds are treated as independent tasks and a naive "
        "pooled standard error is used, so the sample looks S times larger "
        "than the number of tasks really is.",
        "check": "Set the replication unit to the task: cluster standard "
        "errors by task, never count seeds as tasks.",
        "check_short": "replication unit = task",
        "realistic": {"naive_se": True, "sigma_task": 1.0},
        "sweep": [0.0, 0.25, 0.5, 0.75, 1.0, 1.5],
        "base_overrides": {"naive_se": True},
    },
    {
        "id": "unblinded_judge",
        "name": "Unblinded LLM judge",
        "param": "judge_bias",
        "param_label": "judge bias b toward B (label visible)",
        "what_goes_wrong": "The judge sees the condition label and upgrades "
        "some of B's failures to successes.",
        "check": "Blind the judge to condition labels and validate it "
        "against human labels before trusting its scores.",
        "check_short": "blinded judging + judge validation",
        "realistic": {"judge_bias": 0.2},
        "sweep": [0.0, 0.05, 0.1, 0.2, 0.3, 0.4],
    },
    {
        "id": "model_drift",
        "name": "Model drift",
        "param": "drift",
        "param_label": "logit shift halfway through B's block",
        "what_goes_wrong": "Conditions run in sequence instead of "
        "interleaved, and the model version changes halfway through B, so "
        "the version change is credited to the treatment.",
        "check": "Interleave the conditions and pin the model version for "
        "the whole run.",
        "check_short": "interleave runs, pin the version",
        "realistic": {"drift": 0.5},
        "sweep": [0.0, 0.1, 0.2, 0.3, 0.5, 0.75],
    },
    {
        "id": "prompt_cue",
        "name": "Prompt cue",
        "param": "prompt_cue",
        "param_label": "demand effect added to B's logit",
        "what_goes_wrong": "B's prompt hints at the expected behaviour, "
        "adding a demand effect that is not the treatment.",
        "check": "Diff the two prompts: they may differ only in the factor "
        "under test.",
        "check_short": "difference table / matched wording",
        "realistic": {"prompt_cue": 0.4},
        "sweep": [0.0, 0.1, 0.2, 0.3, 0.5, 0.75],
    },
    {
        "id": "selective_reporting",
        "name": "Selective reporting",
        "param": "n_outcomes",
        "param_label": "outcomes measured (best one reported)",
        "what_goes_wrong": "Several outcomes are measured and only the most "
        "significant is reported, with no multiplicity correction.",
        "check": "Pre-specify one primary outcome and correct for "
        "multiplicity across the rest.",
        "check_short": "pre-specified primary outcome + correction",
        "realistic": {"n_outcomes": 5},
        "sweep": [1, 2, 3, 5, 8, 12],
    },
]
