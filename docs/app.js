/* Playground UI for the experiment hazard simulator.
 * Simulation core: sim.js (window.HazardSim), the mirror of sim/model.py.
 * Runs 1,000 simulated experiments per setting, in chunks so the page
 * stays responsive. No backend, no API calls, no keys.
 */
(function () {
  "use strict";

  var SKILL_HAZARDS_URL =
    "https://github.com/omidgolchin/agent-experiment-methodology/blob/main/references/agent-hazards.md";
  var N_EXP = 1000;
  var CHUNK = 100;

  // Hazard controls. `apply(settings, value)` mutates the settings object
  // when the hazard's checkbox is on. Checks are the one-line rules from
  // the agent-experiment-methodology skill (see sim/hazards.py).
  var HAZARDS = [
    {
      id: "compute", name: "1 · Compute bundling",
      blurb: "Condition B also gets more attempts per task (best-of-k), so the estimate mixes the treatment with extra compute.",
      control: { type: "range", label: "best-of-k for B", min: 2, max: 8, step: 1, value: 3 },
      apply: function (s, v) { s.compute_k = v; },
      check: "Run a compute-matched arm: give the control the same steps and samples before crediting the treatment."
    },
    {
      id: "exclusion", name: "2 · Post-treatment exclusion",
      blurb: "Runs that hit an error are dropped after the fact, and B errors out on hard tasks, so B's surviving tasks are easier.",
      control: { type: "range", label: "excess error-out rate on hard tasks in B", min: 0, max: 0.8, step: 0.05, value: 0.4, fmt: 2 },
      apply: function (s, v) { s.err_excess = v; },
      check: "Audit when exclusions happen and analyse intention-to-treat: every run you started counts."
    },
    {
      id: "parse", name: "3 · Differential failure handling",
      blurb: "Parse failures are counted as missing in one arm and as wrong in the other, so the same event moves only one rate.",
      control: { type: "range", label: "parse-failure rate (both arms)", min: 0, max: 0.3, step: 0.01, value: 0.15, fmt: 2 },
      extra: { type: "select", label: "rule", options: [
        ["b_wrong_a_missing", "B: wrong · A: missing"],
        ["a_wrong_b_missing", "A: wrong · B: missing"]
      ], value: "b_wrong_a_missing" },
      apply: function (s, v, extra) { s.parse_fail_rate = v; s.parse_rule = extra; },
      check: "Use one failure rule in both arms: a parse failure is missing everywhere or wrong everywhere."
    },
    {
      id: "pseudo", name: "4 · Pseudo-replication",
      blurb: "Seeds are treated as independent tasks and a naive pooled standard error is used, so the sample looks S times larger than the number of tasks really is. (Harmless when σ_task = 0 — try the preset.)",
      control: null,
      apply: function (s) { s.naive_se = true; },
      check: "Set the replication unit to the task: cluster standard errors by task, never count seeds as tasks."
    },
    {
      id: "judge", name: "5 · Unblinded LLM judge",
      blurb: "The judge sees the condition label and upgrades some of B's failures to successes.",
      control: { type: "range", label: "judge bias toward B", min: 0, max: 0.4, step: 0.05, value: 0.2, fmt: 2 },
      apply: function (s, v) { s.judge_bias = v; },
      check: "Blind the judge to condition labels and validate it against human labels before trusting its scores."
    },
    {
      id: "drift", name: "6 · Model drift",
      blurb: "Conditions run in sequence instead of interleaved, and the model version changes halfway through B's block, so the version change is credited to the treatment.",
      control: { type: "range", label: "logit shift halfway through B", min: -1, max: 1, step: 0.1, value: 0.5, fmt: 1 },
      apply: function (s, v) { s.drift = v; },
      check: "Interleave the conditions and pin the model version for the whole run."
    },
    {
      id: "cue", name: "7 · Prompt cue",
      blurb: "B's prompt hints at the expected behaviour, adding a demand effect that is not the treatment.",
      control: { type: "range", label: "demand effect on B's logit", min: 0, max: 0.75, step: 0.05, value: 0.4, fmt: 2 },
      apply: function (s, v) { s.prompt_cue = v; },
      check: "Diff the two prompts: they may differ only in the factor under test."
    },
    {
      id: "selective", name: "8 · Selective reporting",
      blurb: "Several outcomes are measured and only the most significant is reported, with no multiplicity correction.",
      control: { type: "range", label: "outcomes measured", min: 2, max: 12, step: 1, value: 5 },
      apply: function (s, v) { s.n_outcomes = v; },
      check: "Pre-specify one primary outcome and correct for multiplicity across the rest."
    }
  ];

  var PRESETS = [
    { name: "Clean design", base: {}, on: {} },
    { name: "Compute bundling", base: {}, on: { compute: 3 } },
    { name: "Post-treatment exclusion", base: {}, on: { exclusion: 0.4 } },
    { name: "Differential failure handling", base: {}, on: { parse: 0.15 } },
    { name: "Pseudo-replication", base: {}, on: { pseudo: true } },
    { name: "Unblinded judge", base: {}, on: { judge: 0.2 } },
    { name: "Model drift", base: {}, on: { drift: 0.5 } },
    { name: "Prompt cue", base: {}, on: { cue: 0.4 } },
    { name: "Selective reporting", base: {}, on: { selective: 5 } },
    { name: "Two hazards at once", base: {}, on: { compute: 3, pseudo: true } },
    { name: "Harmless hazard: pseudo-replication, σ_task = 0", base: { sigmaTask: 0 }, on: { pseudo: true } }
  ];

  var BASE_IDS = ["nTasks", "nSeeds", "sigmaTask", "delta"];
  var hazardEls = {}; // id -> {checkbox, input, output, extra}
  var lastHist = null; // last drawn estimates, for theme-change redraws

  function el(id) { return document.getElementById(id); }
  function fmt(v, d) { return Number(v).toFixed(d === undefined ? 0 : d); }

  // --- Build hazard cards -------------------------------------------------
  var grid = el("hazardGrid");
  HAZARDS.forEach(function (hz) {
    var card = document.createElement("div");
    card.className = "card";
    var h = document.createElement("h3");
    var cb = document.createElement("input");
    cb.type = "checkbox"; cb.id = "hz-" + hz.id;
    var lab = document.createElement("label");
    lab.htmlFor = cb.id; lab.textContent = " " + hz.name;
    h.appendChild(cb); h.appendChild(lab);
    card.appendChild(h);
    var p = document.createElement("p");
    p.textContent = hz.blurb;
    card.appendChild(p);
    var entry = { checkbox: cb, input: null, output: null, extra: null };
    if (hz.control) {
      var ctl = document.createElement("div");
      ctl.className = "ctl";
      var l = document.createElement("label");
      l.textContent = hz.control.label;
      var inp = document.createElement("input");
      inp.type = "range";
      inp.min = hz.control.min; inp.max = hz.control.max;
      inp.step = hz.control.step; inp.value = hz.control.value;
      var out = document.createElement("output");
      out.textContent = fmt(hz.control.value, hz.control.fmt);
      inp.addEventListener("input", function () {
        out.textContent = fmt(inp.value, hz.control.fmt);
      });
      ctl.appendChild(l); ctl.appendChild(inp); ctl.appendChild(out);
      card.appendChild(ctl);
      entry.input = inp; entry.output = out;
    }
    if (hz.extra) {
      var ctl2 = document.createElement("div");
      ctl2.className = "ctl";
      var l2 = document.createElement("label");
      l2.textContent = hz.extra.label;
      var sel = document.createElement("select");
      hz.extra.options.forEach(function (o) {
        var op = document.createElement("option");
        op.value = o[0]; op.textContent = o[1];
        sel.appendChild(op);
      });
      sel.value = hz.extra.value;
      ctl2.appendChild(l2); ctl2.appendChild(sel);
      card.appendChild(ctl2);
      entry.extra = sel;
    }
    hazardEls[hz.id] = entry;
    grid.appendChild(card);
  });

  // --- Base control value readouts ----------------------------------------
  BASE_IDS.forEach(function (id) {
    var inp = el(id), out = el(id + "V");
    var d = id === "sigmaTask" ? 2 : id === "delta" ? 1 : 0;
    inp.addEventListener("input", function () { out.textContent = fmt(inp.value, d); });
  });

  function baseSettings() {
    return {
      n_tasks: Number(el("nTasks").value),
      n_seeds: Number(el("nSeeds").value),
      sigma_task: Number(el("sigmaTask").value),
      delta: Number(el("delta").value)
    };
  }

  function currentSettings() {
    var s = baseSettings();
    var active = [];
    HAZARDS.forEach(function (hz) {
      var e = hazardEls[hz.id];
      if (e.checkbox.checked) {
        hz.apply(s, e.input ? Number(e.input.value) : true,
          e.extra ? e.extra.value : undefined);
        active.push(hz);
      }
    });
    return { settings: s, active: active };
  }

  // --- Presets --------------------------------------------------------------
  var presetWrap = el("presets");
  PRESETS.forEach(function (pr) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = pr.name;
    b.addEventListener("click", function () {
      BASE_IDS.forEach(function (id) {
        var def = { nTasks: 20, nSeeds: 5, sigmaTask: 1, delta: 0 }[id];
        var v = pr.base[id] !== undefined ? pr.base[id] : def;
        el(id).value = v;
        el(id).dispatchEvent(new Event("input"));
      });
      HAZARDS.forEach(function (hz) {
        var e = hazardEls[hz.id];
        var on = pr.on[hz.id] !== undefined;
        e.checkbox.checked = on;
        if (on && e.input && typeof pr.on[hz.id] === "number") {
          e.input.value = pr.on[hz.id];
          e.input.dispatchEvent(new Event("input"));
        }
      });
      Array.prototype.forEach.call(presetWrap.children, function (c) {
        c.classList.remove("active");
      });
      b.classList.add("active");
      run();
    });
    presetWrap.appendChild(b);
  });

  // --- Running ---------------------------------------------------------------
  function runChunked(settings, seedBase, done) {
    var estimates = [];
    var rejected = 0;
    var finished = 0;
    function step() {
      var out = HazardSim.simulateExperiments(settings, CHUNK, seedBase + finished);
      for (var i = 0; i < out.estimates.length; i++) {
        estimates.push(out.estimates[i]);
        // rate recomputed from aggregate below; count via mc fields is not
        // additive, so track rejections through a second pass is avoided by
        // using out.rate * CHUNK (exact: rate is rejected/CHUNK).
      }
      rejected += Math.round(out.rate * CHUNK);
      finished += CHUNK;
      el("progress").textContent = "simulating… " + finished + " / " + N_EXP;
      if (finished < N_EXP) setTimeout(step, 0);
      else {
        var mean = 0;
        for (var j = 0; j < estimates.length; j++) mean += estimates[j];
        done({
          estimates: estimates,
          rate: rejected / N_EXP,
          mean_estimate: mean / estimates.length
        });
      }
    }
    step();
  }

  var running = false;
  function run() {
    if (running) return;
    running = true;
    var cur = currentSettings();
    var cleanSettings = baseSettings();
    // Fresh random seed bases on every run: with fixed seeds the clean
    // design's displayed rate was frozen at one atypical draw (2.8%);
    // a fresh draw each run is the honest behaviour.
    var seedA = (Math.random() * 1e9) | 0;
    var seedB = (Math.random() * 1e9) | 0;
    runChunked(cur.settings, seedA, function (haz) {
      runChunked(cleanSettings, seedB, function (clean) {
        running = false;
        el("progress").textContent = "";
        showResults(haz, clean, cur);
      });
    });
  }
  el("runBtn").addEventListener("click", run);

  function rateWord(delta) {
    return delta === 0 ? "False-positive rate" : "Power";
  }

  function showResults(haz, clean, cur) {
    var delta = Number(el("delta").value);
    var pct = function (x) { return (x * 100).toFixed(1) + "%"; };
    var hEl = el("rateHazard");
    hEl.textContent = pct(haz.rate);
    hEl.className = "big " + (delta === 0 && haz.rate > 0.08 ? "bad-text" : "");
    el("rateHazardLbl").textContent =
      rateWord(delta) + " with the hazards above (" + N_EXP + " experiments)";
    el("meanHazard").textContent =
      "mean estimated effect " + (haz.mean_estimate >= 0 ? "+" : "") +
      haz.mean_estimate.toFixed(3);
    el("rateClean").textContent = pct(clean.rate);
    el("rateCleanLbl").textContent =
      rateWord(delta) + ", clean design, same settings";
    el("meanClean").textContent =
      "mean estimated effect " + (clean.mean_estimate >= 0 ? "+" : "") +
      clean.mean_estimate.toFixed(3);
    drawHistogram(haz.estimates, clean.estimates, clean.mean_estimate);
    showChecks(cur.active);
  }

  function showChecks(active) {
    var wrap = el("checks");
    wrap.innerHTML = "";
    if (active.length === 0) {
      wrap.innerHTML = "<p class=\"muted\">No hazards are on — " +
        "this is the clean design. Its false-positive rate should sit near 5%.</p>";
      return;
    }
    active.forEach(function (hz) {
      var card = document.createElement("div");
      card.className = "card";
      card.style.marginBottom = "10px";
      var h = document.createElement("h3");
      h.textContent = hz.name;
      var bq = document.createElement("blockquote");
      bq.textContent = "“" + hz.check + "”";
      var p = document.createElement("p");
      var a = document.createElement("a");
      a.href = SKILL_HAZARDS_URL;
      a.target = "_blank"; a.rel = "noopener";
      a.textContent = "agent-hazards.md in the agent-experiment-methodology skill";
      p.appendChild(document.createTextNode("Check from: "));
      p.appendChild(a);
      card.appendChild(h); card.appendChild(bq); card.appendChild(p);
      wrap.appendChild(card);
    });
  }

  // --- Histogram --------------------------------------------------------------
  function bins(estimates, edges) {
    var counts = new Array(edges.length - 1).fill(0);
    estimates.forEach(function (x) {
      var i = Math.floor((x - edges[0]) / (edges[1] - edges[0]));
      if (i < 0) i = 0;
      if (i >= counts.length) i = counts.length - 1;
      counts[i]++;
    });
    return counts.map(function (c) { return (c / estimates.length) * 100; });
  }

  // The histogram keeps its binning; the drawing is the shared kit chart
  // (KitChart.makeBars — Chart.js when the CDN loads, the kit's hand-drawn
  // fallback otherwise). Only every fifth bin edge is labelled, so the
  // axis stays readable at phone width in both renderers.
  function drawHistogram(hazEst, cleanEst, cleanMean) {
    lastHist = [hazEst, cleanEst, cleanMean];
    var edges = [];
    for (var i = 0; i <= 30; i++) edges.push(-0.6 + i * 0.04);
    var labels = edges.slice(0, -1).map(function (e, i) {
      return i % 5 === 0 ? e.toFixed(2) : "";
    });
    KitChart.makeBars(el("hist"), [
      { label: "with hazards", color: "bad", values: bins(hazEst, edges) },
      { label: "clean design", color: "neutral", values: bins(cleanEst, edges) }
    ], {
      labels: labels,
      xTitle: "estimated effect (B − A)",
      yTitle: "% of experiments",
      yDigits: 1
    });
  }

  // --- Precomputed sweep table --------------------------------------------------
  fetch("data/sweep.json")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var NAMES = {
        compute_bundling: ["Compute bundling", "best-of-3 for B"],
        post_treatment_exclusion: ["Post-treatment exclusion", "excess error-out 0.4"],
        differential_failure_handling: ["Differential failure handling", "parse failures 15%"],
        pseudo_replication: ["Pseudo-replication", "naive SE, σ_task = 1"],
        unblinded_judge: ["Unblinded LLM judge", "bias 0.2 toward B"],
        model_drift: ["Model drift", "+0.5 logit halfway through B"],
        prompt_cue: ["Prompt cue", "+0.4 logit demand effect"],
        selective_reporting: ["Selective reporting", "best of 5 outcomes"]
      };
      var tbody = document.querySelector("#sweepTable tbody");
      Object.keys(NAMES).forEach(function (id) {
        var r = data.realistic[id];
        if (!r) return;
        var tr = document.createElement("tr");
        [NAMES[id][0], NAMES[id][1], (r.rate * 100).toFixed(1) + "%",
          (r.mean_estimate >= 0 ? "+" : "") + r.mean_estimate.toFixed(3)
        ].forEach(function (txt) {
          var td = document.createElement("td");
          td.textContent = txt;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    })
    .catch(function () { /* table stays empty when data file is unavailable */ });

  // --- Theme: kit-theme.js wires the header toggle; redraw on change ----
  if (window.KitTheme) {
    KitTheme.onChange(function () {
      if (lastHist) drawHistogram(lastHist[0], lastHist[1], lastHist[2]);
    });
  }

  // Initial run: clean design.
  run();
})();
