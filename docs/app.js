/* Agent Eval Planner: page logic. Engine in evalsim.js. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var F = Tool.fmt;
  var NOISE = 0.5;

  /* The checklist: the eight hazards of the agent-experiment-methodology
   * skill, asked as questions about the visitor's own setup. */
  var HAZ = [
    { key: "compute", name: "Compute parity", q: "Do both versions get the same number of attempts, retries and compute per task?",
      param: { id: "compute_k", label: "B effectively gets best of", min: 2, max: 8, step: 1, def: 3, show: function (v) { return v + " attempts"; } },
      fix: "Give both versions the same attempts, retries and budget, and report compute per task." },
    { key: "failures", name: "Crashes and timeouts", q: "Are crashes and timeouts kept and scored the same way for both versions?",
      param: { id: "err_excess", label: "B crashes on hard tasks (then dropped)", min: 0.1, max: 1, step: 0.05, def: 0.4, show: function (v) { return Math.round(100 * v) + "%"; } },
      fix: "Score crashes and timeouts as failures for both versions instead of dropping them, and report drop rates by version." },
    { key: "parse", name: "Unparseable outputs", q: "Are unparseable outputs handled by the same rule in both versions?",
      param: { id: "parse_fail_rate", label: "Outputs that fail to parse", min: 0.02, max: 0.4, step: 0.01, def: 0.15, show: function (v) { return Math.round(100 * v) + "%"; } },
      fix: "Use one rule for unparseable outputs in both versions (usually: count them as failures)." },
    { key: "unit", name: "Unit of analysis", q: "Does your significance test treat tasks as the unit, not individual attempts?", param: null,
      fix: "Analyze per-task success rates (paired by task when the tasks are shared), not pooled attempts." },
    { key: "judge", name: "Judge blinding", q: "If an LLM judge grades the outputs, is it blind to which version produced them?", yesLabel: "Yes, or no judge",
      param: { id: "judge_bias", label: "B failures the judge upgrades", min: 0.05, max: 0.5, step: 0.05, def: 0.2, show: function (v) { return Math.round(100 * v) + "%"; } },
      fix: "Strip version labels and system prompts from what the judge sees, and validate the judge against human labels." },
    { key: "drift", name: "Model drift", q: "Did both versions run interleaved, at the same time, on the same model version?",
      param: { id: "drift", label: "Model change halfway through B (log-odds)", min: 0.1, max: 1.5, step: 0.1, def: 0.5, show: function (v) { return "+" + v.toFixed(1); } },
      fix: "Interleave runs of both versions in random order on a pinned model snapshot." },
    { key: "cue", name: "Prompt cue", q: "Do the two prompts differ only in what you are testing?",
      param: { id: "prompt_cue", label: "Extra nudge in B's prompt (log-odds)", min: 0.1, max: 1.5, step: 0.1, def: 0.4, show: function (v) { return "+" + v.toFixed(1); } },
      fix: "Diff the two prompts and remove any wording that hints at the expected behavior." },
    { key: "metrics", name: "Metrics examined", q: "How many metrics will you look at before choosing what to report?", numeric: true,
      fix: "Name one primary metric before running, and report every metric you looked at." }
  ];
  var DEFAULTS = { mode: "plan", tasks: 60, attempts: 3, rate: 50, gain: 10, spread: "1", paired: "1", gainCheck: 5 };
  HAZ.forEach(function (h) { DEFAULTS["h_" + h.key] = h.numeric ? 1 : 0; if (h.param) DEFAULTS["v_" + h.key] = h.param.def; });
  var EXAMPLES = [
    { label: "Small agent benchmark (60 tasks)", v: { tasks: 60, attempts: 3, rate: 50, gain: 10, spread: "1", paired: "1" }, h: {} },
    { label: "Judged chat eval with retries for the new version", v: { tasks: 120, attempts: 3, rate: 41, gain: 5, spread: "1", paired: "1" }, h: { compute: 1, judge: 1, failures: 1 } },
    { label: "Large coding benchmark (300 tasks)", v: { tasks: 300, attempts: 1, rate: 35, gain: 5, spread: "2", paired: "1" }, h: {} },
    { label: "Separate task sets, attempts pooled", v: { tasks: 50, attempts: 5, rate: 50, gain: 10, spread: "2", paired: "0" }, h: { unit: 1 } },
    { label: "Five metrics, report the best", v: { tasks: 80, attempts: 3, rate: 60, gain: 8, spread: "1", paired: "1" }, h: { metrics: 5 } }
  ];
  var state = Tool.readParams(DEFAULTS);
  var lastPlan = null, lastCheck = null, runId = 0;

  /* ---------- checklist UI ---------- */
  function buildChecklist() {
    $("qlist").innerHTML = HAZ.map(function (h) {
      var ctl = "";
      if (h.numeric) ctl = '<input id="h_' + h.key + '" type="number" min="1" max="20" step="1" style="width:5em">';
      else ctl = '<select id="h_' + h.key + '" aria-label="' + h.name + '"><option value="0">' + (h.yesLabel || "Yes") + '</option><option value="1">No</option></select>';
      var slider = h.param ? '<div class="ctl" id="row_' + h.key + '" hidden><label for="v_' + h.key + '">' + h.param.label + '</label><input type="range" id="v_' + h.key + '" min="' + h.param.min + '" max="' + h.param.max + '" step="' + h.param.step + '"><output id="o_' + h.key + '"></output></div>' : "";
      return '<div class="q" id="q_' + h.key + '"><div class="q-row"><span class="q-text">' + h.q + "</span>" + ctl + "</div>" + slider + "</div>";
    }).join("");
  }
  buildChecklist();
  function setInputs(v) { Object.keys(v).forEach(function (k) { var e = $(k); if (e) e.value = v[k]; }); }
  setInputs(state);
  function syncChecklist() {
    HAZ.forEach(function (h) {
      var unsafe = h.numeric ? Number($("h_" + h.key).value) > 1 : $("h_" + h.key).value === "1";
      $("q_" + h.key).classList.toggle("unsafe", unsafe);
      if (h.param) { $("row_" + h.key).hidden = !unsafe; $("o_" + h.key).textContent = h.param.show(Number($("v_" + h.key).value)); }
    });
  }
  syncChecklist();
  EXAMPLES.forEach(function (ex, i) { var o = document.createElement("option"); o.value = i; o.textContent = ex.label; $("example").appendChild(o); });
  $("example").addEventListener("change", function () {
    if (this.value === "") return;
    var ex = EXAMPLES[+this.value]; setInputs(ex.v);
    HAZ.forEach(function (h) { $("h_" + h.key).value = h.numeric ? (ex.h[h.key] || 1) : (ex.h[h.key] ? "1" : "0"); if (h.param) $("v_" + h.key).value = h.param.def; });
    this.value = ""; document.querySelectorAll(".field.filled").forEach(function (f) { f.classList.remove("filled"); });
    syncChecklist(); runPlan();
  });
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
  var runPlanSoon = debounce(runPlan, 250);
  ["tasks", "attempts", "rate", "gain", "spread", "paired"].forEach(function (id) { $(id).addEventListener("input", runPlanSoon); $(id).addEventListener("change", runPlanSoon); });
  HAZ.forEach(function (h) {
    $("h_" + h.key).addEventListener("change", function () { syncChecklist(); runPlanSoon(); });
    $("h_" + h.key).addEventListener("input", function () { syncChecklist(); runPlanSoon(); });
    if (h.param) $("v_" + h.key).addEventListener("input", function () { syncChecklist(); runPlanSoon(); });
  });
  function setMode(m) {
    state.mode = m;
    $("tab-plan").classList.toggle("active", m === "plan"); $("tab-plan").setAttribute("aria-selected", m === "plan");
    $("tab-check").classList.toggle("active", m === "check"); $("tab-check").setAttribute("aria-selected", m === "check");
    $("view-plan").hidden = m !== "plan"; $("view-check").hidden = m !== "check";
    if (m === "plan") runPlan(); else runCheck();
  }
  $("tab-plan").addEventListener("click", function () { setMode("plan"); });
  $("tab-check").addEventListener("click", function () { setMode("check"); });
  window.addEventListener("resize", debounce(function () { if (state.mode === "plan" && lastPlan) drawPower(); if (state.mode === "check" && lastCheck) drawCheck(); }, 200));
  if (window.KitTheme) KitTheme.onChange(function () { setTimeout(function () { if (state.mode === "plan" && lastPlan) drawPower(); if (state.mode === "check" && lastCheck) drawCheck(); }, 0); });
  function num(id) { var v = $(id).value; return v === "" ? null : Number(v); }
  function fieldError(id, msg) {
    var f = $(id).closest(".field"); var e = f.querySelector(".err");
    f.classList.toggle("invalid", !!msg);
    if (msg) { if (!e) { e = document.createElement("div"); e.className = "err"; f.appendChild(e); } e.textContent = msg; }
    else if (e) e.remove();
  }
  function pct(x) { return Math.round(100 * x) + "%"; }

  /* ---------- AI assist ---------- */
  var cfg = Object.assign({}, window.ASSIST_CONFIG);
  cfg.fields = cfg.fields.map(function (f) { return f.type === "boolean" ? Object.assign({ format: function (v) { return v ? "Yes" : "No"; } }, f) : f; });
  Tool.assist(Object.assign(cfg, {
    mount: $("assistMount"), toggle: $("assistToggle"),
    apply: function (vals) {
      document.querySelectorAll(".field.filled, .q.filled").forEach(function (f) { f.classList.remove("filled"); });
      var mark = function (id, v) { if (v === undefined || v === null) return; $(id).value = v; var f = $(id).closest(".field") || $(id).closest(".q"); if (f) f.classList.add("filled"); };
      mark("tasks", vals.tasks != null ? Math.round(vals.tasks) : null); mark("attempts", vals.attempts != null ? Math.round(vals.attempts) : null); mark("rate", vals.rate); mark("gain", vals.gain);
      if (vals.paired != null) mark("paired", vals.paired ? "1" : "0");
      var yes = function (key, v) { if (v === null || v === undefined) return; mark("h_" + key, v ? "0" : "1"); };
      yes("compute", vals.sameCompute); yes("failures", vals.sameFailureHandling); yes("parse", vals.sameParseHandling); yes("unit", vals.taskLevelTest);
      if (vals.judgeBlind) mark("h_judge", /unblind|not blind|sees/i.test(vals.judgeBlind) ? "1" : "0");
      yes("drift", vals.interleaved); yes("cue", vals.promptsMatch);
      if (vals.metricsExamined) mark("h_metrics", Math.max(1, Math.round(vals.metricsExamined)));
      syncChecklist(); runPlan();
    }
  }));

  /* ---------- plan ---------- */
  function readPlan() {
    var v = { tasks: num("tasks"), attempts: num("attempts"), rate: num("rate"), gain: num("gain"), spread: Number($("spread").value), paired: $("paired").value === "1" };
    var ok = true;
    function need(id, cond, msg) { fieldError(id, cond ? "" : msg); if (!cond) ok = false; }
    need("tasks", v.tasks >= 5 && v.tasks <= 2000 && Number.isInteger(v.tasks), "Whole number, 5 to 2,000.");
    need("attempts", v.attempts >= 1 && v.attempts <= 20 && Number.isInteger(v.attempts), "Whole number, 1 to 20.");
    need("rate", v.rate > 0 && v.rate < 100, "Between 1 and 99.");
    need("gain", v.gain > 0 && v.rate + v.gain < 100, "Above 0, and rate + gain under 100.");
    v.haz = {}; v.unsafe = [];
    HAZ.forEach(function (h) {
      var raw = $("h_" + h.key).value, unsafe = h.numeric ? Number(raw) > 1 : raw === "1";
      if (unsafe) v.unsafe.push(h);
      if (!unsafe) return;
      if (h.key === "unit") v.haz.naive_se = true;
      else if (h.key === "metrics") v.haz.n_outcomes = Math.max(1, Math.round(Number(raw)));
      else v.haz[h.param.id] = Number($("v_" + h.key).value);
    });
    return ok ? v : null;
  }
  function runPlan() {
    var v = readPlan();
    var url = { mode: "plan" }; ["tasks", "attempts", "rate", "gain", "spread", "paired"].forEach(function (k) { url[k] = $(k).value; });
    HAZ.forEach(function (h) { url["h_" + h.key] = $("h_" + h.key).value; if (h.param) url["v_" + h.key] = $("v_" + h.key).value; });
    Tool.writeParams(url);
    if (!v) { $("vTitle").textContent = "Check the highlighted inputs"; $("vBody").textContent = ""; $("kpis").innerHTML = ""; $("checks").innerHTML = ""; $("verdict").className = "panel verdict v-neutral"; return; }
    var my = ++runId;
    $("vTitle").textContent = "Simulating…";
    setTimeout(function () { if (my === runId) computePlan(v); }, 10);
  }
  function computePlan(v) {
    var sigTot = Math.sqrt(v.spread * v.spread + NOISE * NOISE);
    var base = EvalSim.baseFor(v.rate / 100, sigTot), delta = EvalSim.deltaFor(v.rate / 100, v.gain / 100, sigTot);
    var clean = { n_tasks: v.tasks, n_attempts: v.attempts, base_logit: base, sigma_task: v.spread, sigma_noise: NOISE, paired: v.paired };
    var N = 1500;
    var power = EvalSim.rate(Object.assign({}, clean, { delta: delta }), N, 7);
    var fake = EvalSim.rate(Object.assign({}, clean, v.haz), N, 8);
    var sd = EvalSim.taskDiffSd(Object.assign({}, clean, { delta: delta }));
    var n80 = EvalSim.tasksFor80(sd, v.gain / 100);
    var sd2 = EvalSim.taskDiffSd(Object.assign({}, clean, { delta: delta, n_attempts: v.attempts * 2 }));
    var n80x2 = EvalSim.tasksFor80(sd2, v.gain / 100);
    var impacts = v.unsafe.map(function (h) {
      var one = {}; Object.keys(v.haz).forEach(function (k) { if ((h.key === "unit" && k === "naive_se") || (h.key === "metrics" && k === "n_outcomes") || (h.param && k === h.param.id)) one[k] = v.haz[k]; });
      var f = EvalSim.rate(Object.assign({}, clean, one), 1000, 21);
      var pw = EvalSim.rate(Object.assign({}, clean, one, { delta: delta }), 1000, 22);
      return { h: h, fake: f.rate_any, power: pw.rate };
    });
    var de = EvalSim.designEffect(v.spread, NOISE, v.tasks, v.attempts);
    lastPlan = { v: v, base: base, delta: delta, clean: clean, power: power.rate, fake: fake.rate_any, fakeSe: fake.mc_se_any, sd: sd, n80: n80, n80x2: n80x2, impacts: impacts, de: de };
    renderPlan(); drawPower();
  }
  function renderPlan() {
    var P = lastPlan, v = P.v;
    var biased = P.fake > 0.075, weak = P.power < 0.7;
    var flagged = P.impacts.filter(function (x) { return x.fake > 0.075 || x.power < P.power - 0.05; });
    var title, cls, body;
    var powerSent = "With " + v.tasks + " tasks and " + v.attempts + " attempt" + (v.attempts === 1 ? "" : "s") + " each, a clean version of this eval has a " + pct(P.power) + " chance of detecting a " + v.gain + "-point improvement" + (P.power < 0.8 ? "; about " + F.int(P.n80) + " tasks gives 80%." : ".");
    if (biased && weak) { title = "Fix the design, then add tasks"; cls = "bad"; }
    else if (biased) { title = "Fix the design first"; cls = "bad"; }
    else if (weak) { title = "Too few tasks: use about " + F.int(P.n80); cls = "warn"; }
    else { title = "Ready to run"; cls = "good"; }
    if (biased) body = "If B were no better than A, this design would still show a significant difference " + pct(P.fake) + " of the time, instead of about 5%. " + (flagged.length ? "Fix " + (flagged.length === 1 ? "the flagged item" : "the " + flagged.length + " flagged items") + " below. " : "") + powerSent;
    else body = powerSent + " Fake wins stay near " + pct(P.fake) + (P.fake <= 0.065 ? ", as they should." : ".") + (flagged.length ? " Your answers still cost something: see the flagged items." : "");
    $("vTitle").textContent = title; $("vBody").textContent = body; $("verdict").className = "panel verdict v-" + cls;
    P.title = title; P.body = body;
    $("kpis").innerHTML = [[pct(P.power), "chance to detect +" + v.gain + " pts"], [pct(P.fake), "fake wins (aim: ~5%)"], [F.int(P.n80), "tasks for 80%"], [F.int(v.tasks * v.attempts * 2), "runs in total"]].map(function (x) { return '<div class="kpi"><span class="k-val">' + x[0] + '</span><span class="k-lbl">' + x[1] + "</span></div>"; }).join("");
    var c = [];
    P.impacts.forEach(function (x) {
      if (x.fake > 0.075) c.push(["fail", "FIX", x.h.name, "Alone, this takes fake wins to " + pct(x.fake) + ". " + x.h.fix]);
      else if (x.power < P.power - 0.05) c.push(["warn", "COSTLY", x.h.name, "No extra fake wins here, but the chance to detect falls from " + pct(P.power) + " to " + pct(x.power) + ". " + x.h.fix]);
      else c.push(["info", "MINOR", x.h.name, "Little effect at these settings (fake wins " + pct(x.fake) + "). Still worth fixing: " + x.h.fix.charAt(0).toLowerCase() + x.h.fix.slice(1)]);
    });
    if (!P.impacts.length) c.push(["ok", "OK", "Design checklist", "No risky answers: the simulated false-alarm rate is " + pct(P.fake) + "."]);
    c.push([v.paired ? "ok" : "warn", v.paired ? "PAIRED" : "UNPAIRED", "Same tasks for both", v.paired ? "Tasks, paired: each task's difference between versions is one data point, which cancels task difficulty." : "Separate task sets: task difficulty adds noise to the comparison. Running both versions on the same tasks would need fewer tasks."]);
    var runs1 = P.n80 * v.attempts, runs2 = P.n80x2 * v.attempts * 2;
    c.push(runs2 > runs1 * 1.15
      ? ["info", "TIP", "Tasks vs attempts", "Doubling attempts to " + v.attempts * 2 + " per task would still need about " + F.int(P.n80x2) + " tasks for 80% (vs " + F.int(P.n80) + "), so " + F.int(runs2) + " runs per version instead of " + F.int(runs1) + ". New tasks buy more certainty than repeat attempts here."]
      : ["info", "TIP", "Tasks vs attempts", "With the same tasks for both versions, task difficulty cancels out, so extra attempts work almost as well as extra tasks: " + v.attempts * 2 + " attempts on about " + F.int(P.n80x2) + " tasks also reaches 80%. Pick the cheaper option; new tasks also make the result more general."]);
    $("checks").innerHTML = c.map(function (x) { return '<div class="check is-' + x[0] + '"><span class="badge">' + x[1] + '</span><div><span class="c-name">' + x[2] + '.</span> <span class="c-text">' + x[3] + "</span></div></div>"; }).join("");
    P.checks = c;
    $("designEffect").textContent = v.paired ? "Your design: " + v.tasks + " tasks × " + v.attempts + " attempts per version, same tasks for both\nTask difficulty cancels in each task's difference between versions; what remains is attempt-to-attempt noise.\nSpread of per-task differences (simulated): " + P.sd.toFixed(3) + "\nTasks for 80% = ((1.96 + 0.84) × " + P.sd.toFixed(3) + " / " + (v.gain / 100).toFixed(3) + ")² + 1 = " + P.n80 : "Your design: " + v.tasks + " tasks × " + v.attempts + " attempts per version\nTask-level correlation of attempts (latent scale): " + P.de.icc.toFixed(2) + "\nDesign effect 1 + (attempts − 1) × correlation = " + P.de.deff.toFixed(2) + "\nSo " + v.tasks * v.attempts + " attempts per version carry about as much information as " + Math.round(P.de.effective) + " independent ones.\nSpread of per-task differences (simulated): " + P.sd.toFixed(3);
  }
  function drawPower() {
    var P = lastPlan, v = P.v;
    var maxT = Math.max(v.tasks, P.n80) * 1.5, grid = [], g;
    [10, 20, 30, 40, 60, 80, 100, 150, 200, 300, 400, 600, 800, 1200, 1600, 2000].forEach(function (t) { if (t <= Math.max(40, maxT)) grid.push(t); });
    if (grid.indexOf(v.tasks) < 0) grid.push(v.tasks); grid.sort(function (a, b) { return a - b; });
    var za = 1.959963984540054, pts = [], analytic = [], ci = [], hl = null;
    grid.forEach(function (t, i) {
      var r = EvalSim.rate(Object.assign({}, P.clean, { n_tasks: t, delta: P.delta }), 400, 31 + i);
      pts.push([t, 100 * r.rate]); ci.push([100 * Math.max(0, r.rate - 1.96 * r.mc_se), 100 * Math.min(1, r.rate + 1.96 * r.mc_se)]);
      if (t === v.tasks) hl = i;
    });
    for (g = 5; g <= grid[grid.length - 1]; g += Math.max(1, Math.round(grid[grid.length - 1] / 120))) {
      var z = (v.gain / 100) / (P.sd / Math.sqrt(g));
      analytic.push([g, 100 * (1 - normCdf(za - z))]);
    }
    Tool.lineChart($("powerChart"), {
      series: [{ label: "Formula", color: "neutral", points: analytic, dash: "5 4" }, { label: "Simulated (95% interval)", color: "accent", points: pts, ci: ci, markersOnly: true, markers: true, highlight: hl }],
      legend: true, yMin: 0, yMax: 100, height: 260,
      hLines: [{ y: 80, label: "80%", color: "series2", labelLeft: true }],
      vLines: [{ x: v.tasks, label: "your " + v.tasks + " tasks", color: "fg" }].concat(P.n80 <= grid[grid.length - 1] && Math.abs(P.n80 - v.tasks) > grid[grid.length - 1] * 0.04 ? [{ x: P.n80, label: F.int(P.n80) + " for 80%", color: "series2" }] : []),
      xTitle: "tasks (" + v.attempts + " attempt" + (v.attempts === 1 ? "" : "s") + " each, per version)", yTitle: "chance to detect +" + v.gain + " pts",
      xMin: 0, xFormat: function (x) { return F.int(x); }, yFormat: function (y) { return y + "%"; }
    });
    $("powerCaption").textContent = "For the clean design. Detecting half the improvement takes about four times the tasks. Fake wins from the checklist are not shown here: a biased design detects more often, for the wrong reason.";
  }
  function normCdf(x) { var t = 1 / (1 + 0.2316419 * Math.abs(x)); var poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))); var tail = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI) * poly; return x >= 0 ? 1 - tail : tail; }
  $("copyLink").addEventListener("click", function () { Tool.copy(location.href, $("toast"), "Link copied: it opens with this design."); });
  $("copyReport").addEventListener("click", function () {
    if (!lastPlan) return; var P = lastPlan, v = P.v;
    var lines = ["## Eval design check", "", "**Verdict:** " + P.title, "", P.body, "", "| Item | Value |", "|---|---|",
      "| Tasks | " + v.tasks + (v.paired ? " (same tasks for both versions)" : " (separate task sets)") + " |",
      "| Attempts per task, per version | " + v.attempts + " |", "| Baseline success rate | " + v.rate + "% |", "| Improvement to detect | " + v.gain + " points |",
      "| Chance to detect (clean design, simulated) | " + pct(P.power) + " |", "| Fake wins with this design (simulated) | " + pct(P.fake) + " |", "| Tasks for 80% | " + P.n80 + " |", "",
      "### Checklist", ""].concat(HAZ.map(function (h) {
        var x = P.impacts.filter(function (i) { return i.h === h; })[0];
        return "- [" + (x ? " " : "x") + "] " + h.q + (x ? " **No.** " + h.fix + " (alone: fake wins " + pct(x.fake) + ", chance to detect " + pct(x.power) + ")" : "");
      })).concat(["", "Analysis plan: " + (v.paired ? "paired t-test on per-task success rates (task = unit of analysis)." : "Welch t-test on per-task success rates."), "", "Checked with the Agent Eval Planner: " + location.href]);
    Tool.copy(lines.join("\n"), $("toast"), "Design report copied (Markdown).");
  });

  /* ---------- check ---------- */
  function parseCsv(text) {
    var lines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) return { rows: [] };
    var split = function (l) { return l.split(/[,;\t]/).map(function (x) { return x.trim().replace(/^"|"$/g, ""); }); };
    var first = split(lines[0]).map(function (x) { return x.toLowerCase(); });
    var idx = { task: 0, version: 1, attempt: 2, success: 3 }, start = 0;
    var find = function (names) { for (var i = 0; i < first.length; i++) if (names.indexOf(first[i]) >= 0) return i; return -1; };
    if (find(["task", "task_id", "taskid", "problem", "id", "item"]) >= 0 || find(["version", "arm", "variant", "condition", "agent", "model"]) >= 0) {
      start = 1;
      idx.task = find(["task", "task_id", "taskid", "problem", "id", "item"]); idx.version = find(["version", "arm", "variant", "condition", "agent", "model"]);
      idx.attempt = find(["attempt", "run", "seed", "trial", "repeat"]); idx.success = find(["success", "pass", "passed", "correct", "solved", "score", "result", "outcome"]);
      if (idx.success < 0) idx.success = first.length - 1;
    }
    var rows = [], bad = 0;
    for (var i = start; i < lines.length; i++) {
      var c = split(lines[i]); if (c.length < 3) { bad++; continue; }
      var sraw = String(c[idx.success] || "").toLowerCase(), s;
      if (/^(1|true|yes|pass|passed|correct|success|solved)$/.test(sraw)) s = 1;
      else if (/^(0|false|no|fail|failed|incorrect|error|wrong)$/.test(sraw)) s = 0;
      else if (isFinite(Number(sraw)) && sraw !== "") s = Number(sraw) >= 0.5 ? 1 : 0;
      else { bad++; continue; }
      rows.push({ task: c[idx.task], version: c[idx.version], attempt: idx.attempt >= 0 ? c[idx.attempt] : "", success: s });
    }
    return { rows: rows, bad: bad };
  }
  var runCheckSoon = debounce(runCheck, 300);
  $("csv").addEventListener("input", runCheckSoon);
  $("baseline").addEventListener("change", runCheck);
  $("upload").addEventListener("change", function () {
    var f = this.files && this.files[0]; if (!f) return;
    var rd = new FileReader(); rd.onload = function () { $("csv").value = String(rd.result); runCheck(); }; rd.readAsText(f);
  });
  $("loadExample").addEventListener("click", function () {
    // 50 tasks of very mixed difficulty, 3 attempts each; the new version is truly 8 points better
    var rng = EvalSim.makeRng(99), lines = ["task,version,attempt,success"], sig = 2, base = EvalSim.baseFor(0.45, Math.sqrt(4.25)), d = EvalSim.deltaFor(0.45, 0.08, Math.sqrt(4.25));
    for (var t = 1; t <= 50; t++) {
      var diff = rng.normal() * sig, id = "t" + t;
      ["baseline", "new"].forEach(function (ver) { for (var a = 1; a <= 3; a++) { var lg = base + diff + rng.normal() * NOISE + (ver === "new" ? d : 0); lines.push(id + "," + ver + "," + a + "," + (rng.next() < 1 / (1 + Math.exp(-lg)) ? 1 : 0)); } });
    }
    $("csv").value = lines.join("\n"); runCheck();
  });
  function runCheck() {
    var parsed = parseCsv($("csv").value);
    var versions = []; parsed.rows.forEach(function (r) { if (versions.indexOf(r.version) < 0) versions.push(r.version); });
    var cur = $("baseline").value;
    $("baseline").innerHTML = versions.map(function (v) { return '<option value="' + v.replace(/"/g, "&quot;") + '">' + v + "</option>"; }).join("");
    if (versions.indexOf(cur) >= 0) $("baseline").value = cur;
    if (!parsed.rows.length) { lastCheck = null; $("cTitle").textContent = "Paste results to check them"; $("cBody").textContent = "Or press Load example results."; $("cKpis").innerHTML = ""; $("cChecks").innerHTML = ""; $("cVerdict").className = "panel verdict v-neutral"; $("checkChart").innerHTML = ""; $("checkCaption").textContent = ""; return; }
    var r = EvalSim.analyzeResults(parsed.rows, { a: $("baseline").value });
    if (r.error) { lastCheck = null; $("cTitle").textContent = "Can't analyze these rows yet"; $("cBody").textContent = r.error; $("cKpis").innerHTML = ""; $("cChecks").innerHTML = ""; $("cVerdict").className = "panel verdict v-neutral"; return; }
    r.bad = parsed.bad; lastCheck = r;
    var pts = function (x) { return (x >= 0 ? "+" : "−") + Math.abs(100 * x).toFixed(1); };
    var title, cls;
    if (r.lo > 0) { title = r.vB + " is better by " + pts(r.diff).slice(1) + " points"; cls = "good"; }
    else if (r.hi < 0) { title = r.vB + " is worse by " + pts(-r.diff).slice(1) + " points"; cls = "bad"; }
    else { title = "No clear difference yet"; cls = "warn"; }
    var gainPts = num("gain") || 5;
    var n80 = EvalSim.tasksFor80(Math.sqrt(r.se * r.se * r.paired), gainPts / 100);
    var body = "On the same tasks, " + r.vB + "'s success rate was " + Math.abs(100 * r.diff).toFixed(1) + " points " + (r.diff >= 0 ? "higher" : "lower") + " than " + r.vA + "'s on average (95% interval " + pts(r.lo) + " to " + pts(r.hi) + " points, " + r.paired + " tasks)." + (cls === "warn" ? " With this much variation between tasks, detecting a " + gainPts + "-point difference (your planning target) 80% of the time takes about " + F.int(n80) + " tasks." : "");
    var naiveSig = r.naiveP < 0.05, taskSig = r.p < 0.05;
    if (naiveSig !== taskSig) body += naiveSig ? " Counting attempts as independent would have called this significant; the task-level analysis does not." : " Counting attempts as independent would have missed it: pairing by task removes task difficulty from the comparison.";
    title = title.charAt(0).toUpperCase() + title.slice(1);
    $("cTitle").textContent = title; $("cBody").textContent = body; $("cVerdict").className = "panel verdict v-" + cls;
    r.title = title; r.body = body;
    $("cKpis").innerHTML = [[pts(r.diff), "points, " + r.vB + " − " + r.vA], [Math.round(100 * r.rateB) + "%", r.vB + " success (" + r.vA + " " + Math.round(100 * r.rateA) + "%)"], [r.paired, "tasks on both versions"], [r.p < 0.001 ? "< 0.001" : r.p.toFixed(3), "p-value (paired t)"]].map(function (x) { return '<div class="kpi"><span class="k-val">' + x[0] + '</span><span class="k-lbl">' + x[1] + "</span></div>"; }).join("");
    var c = [];
    c.push(r.paired < 20 ? ["warn", "FEW", "Number of tasks", r.paired + " tasks: intervals are wide and the t-approximation is rough. Aim for many more tasks before drawing conclusions."] : ["ok", "OK", "Number of tasks", r.paired + " tasks ran on both versions."]);
    c.push(r.attemptsA !== r.attemptsB ? ["fail", "UNEQUAL", "Compute parity", r.vA + " has " + r.attemptsA + " attempts and " + r.vB + " has " + r.attemptsB + ". If one version got more tries, part of its gain is just more compute."] : ["ok", "OK", "Compute parity", "Both versions have " + r.attemptsA + " attempts in total."]);
    if (r.onlyOne.length) c.push(["warn", "DROPPED", "Unmatched tasks", r.onlyOne.length + " task" + (r.onlyOne.length === 1 ? "" : "s") + " ran on only one version and were left out (" + r.onlyOne.slice(0, 4).join(", ") + (r.onlyOne.length > 4 ? ", …" : "") + "). If one version crashed on them, that is itself a result."]);
    var tw = r.hi - r.lo, bw = r.bootHi - r.bootLo;
    c.push(Math.abs(tw - bw) > 0.25 * tw ? ["warn", "CHECK", "Interval methods", "The bootstrap interval (" + pts(r.bootLo) + " to " + pts(r.bootHi) + ") differs from the t-interval: the per-task differences are far from normal. Trust the bootstrap."] : ["ok", "AGREE", "Interval methods", "The task bootstrap (" + pts(r.bootLo) + " to " + pts(r.bootHi) + ") agrees with the t-interval."]);
    if (r.bad) c.push(["warn", "SKIPPED", "Unreadable rows", r.bad + " row" + (r.bad === 1 ? "" : "s") + " could not be read and were skipped."]);
    $("cChecks").innerHTML = c.map(function (x) { return '<div class="check is-' + x[0] + '"><span class="badge">' + x[1] + '</span><div><span class="c-name">' + x[2] + '.</span> <span class="c-text">' + x[3] + "</span></div></div>"; }).join("");
    r.checks = c;
    drawCheck();
  }
  function drawCheck() {
    var r = lastCheck, host = $("checkChart"); if (!r) return;
    var rows = [{ label: "Paired by task (t)", lo: r.lo, hi: r.hi, mid: r.diff, c: "--accent" }, { label: "Task bootstrap", lo: r.bootLo, hi: r.bootHi, mid: r.diff, c: "--accent" }, { label: "Attempts as independent", lo: r.naiveLo, hi: r.naiveHi, mid: r.naiveDiff, c: "--neutral" }];
    var lo = Math.min.apply(null, rows.map(function (x) { return x.lo; }).concat([0])), hi = Math.max.apply(null, rows.map(function (x) { return x.hi; }).concat([0]));
    var pad = (hi - lo) * 0.1 || 0.01; lo -= pad; hi += pad;
    host.innerHTML = "";
    var W = Math.max(280, host.clientWidth || 600), narrow = W < 520, H = narrow ? 230 : 170, ml = narrow ? 12 : 180, mr = 16, top = narrow ? 30 : 16;
    var NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg"); svg.setAttribute("viewBox", "0 0 " + W + " " + H); host.appendChild(svg);
    var css = function (n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); };
    var X = function (x) { return ml + (x - lo) / (hi - lo) * (W - ml - mr); };
    var add = function (n, a) { var e = document.createElementNS(NS, n); Object.keys(a).forEach(function (k) { e.setAttribute(k, a[k]); }); svg.appendChild(e); return e; };
    var txt = function (x, y, s, anchor, cls) { var t = add("text", { x: x, y: y, "text-anchor": anchor || "start" }); if (cls) t.setAttribute("class", cls); t.textContent = s; };
    var axisY = H - 40;
    add("line", { x1: X(0), x2: X(0), y1: top - 6, y2: axisY, stroke: css("--fg"), "stroke-width": 1.2 });
    rows.forEach(function (rw, i) {
      var y = top + (narrow ? 22 : 14) + i * (narrow ? 52 : 38);
      if (narrow) txt(ml, y - 12, rw.label, "start", "halo"); else txt(ml - 10, y + 4, rw.label, "end");
      add("line", { x1: X(rw.lo), x2: X(rw.hi), y1: y, y2: y, stroke: css(rw.c), "stroke-width": 6, "stroke-linecap": "round", opacity: 0.85 });
      add("circle", { cx: X(rw.mid), cy: y, r: 5.5, fill: css("--card"), stroke: css(rw.c), "stroke-width": 2.5 });
    });
    add("line", { x1: ml, x2: W - mr, y1: axisY, y2: axisY, stroke: css("--muted") });
    Tool.niceTicks(lo, hi, narrow ? 4 : 7).forEach(function (t) { add("line", { x1: X(t), x2: X(t), y1: axisY, y2: axisY + 4, stroke: css("--muted") }); txt(X(t), axisY + 16, (t > 0 ? "+" : t < 0 ? "−" : "") + Math.abs(100 * t).toFixed(0), "middle"); });
    txt((ml + W - mr) / 2, axisY + 33, r.vB + " minus " + r.vA + ", percentage points (95% intervals)", "middle", "title");
    $("checkCaption").textContent = "The first two intervals treat each task as one data point; they are the honest answer. The grey one pools every attempt as if independent, which ignores that attempts on the same task succeed or fail together.";
  }
  $("cCopy").addEventListener("click", function () {
    if (!lastCheck) return; var r = lastCheck;
    Tool.copy(["Eval result: " + r.title, r.body, "", "Checks: " + r.checks.map(function (x) { return x[2].toLowerCase() + " " + x[1].toLowerCase(); }).join(", "), "", "Analyzed with the Agent Eval Planner: " + location.origin + location.pathname].join("\n"), $("cToast"), "Summary copied.");
  });

  setMode(state.mode === "check" ? "check" : "plan");
})();
