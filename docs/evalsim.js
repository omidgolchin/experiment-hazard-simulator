/* Agent Eval Planner: simulation engine.
 *
 * Mirrors sim/planner.py (tests/test_planner.py checks agreement).
 *
 * An eval compares version A and version B of an agent on T tasks, S
 * attempts per task per version. Task difficulty ~ Normal(0, sigma_task) on
 * the logit scale; each attempt adds Normal(0, sigma_noise). Success ~
 * Bernoulli(sigmoid(base + difficulty + noise + effect)).
 *
 * Paired design (default): both versions run on the same tasks, and the
 * analysis is a paired t-test on per-task differences in success rate:
 * the task is the unit of analysis. Unpaired design: each version gets its
 * own task sample and a Welch test on per-task means.
 *
 * Design hazards (from the agent-experiment-methodology skill) bend the
 * data or the analysis:
 *   compute_k        B gets best-of-k attempts (compute bundling)
 *   err_excess       B errors out on hard tasks; those tasks are dropped for B
 *   parse_fail_rate  parse failures: counted wrong in B, dropped in A
 *   naive_se         attempts pooled as independent (pseudo-replication)
 *   judge_bias       an unblinded judge upgrades this share of B's failures
 *   drift            B's second half runs on a changed model (+logit)
 *   prompt_cue       B's prompt hints at the expected behavior (+logit)
 *   n_outcomes       metrics examined; the smallest p-value is reported
 * All data are simulated.
 */
(function (g) {
  "use strict";

  function makeRng(seed) {
    var a = seed >>> 0, spare = null;
    function next() {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    function normal() {
      if (spare !== null) { var v = spare; spare = null; return v; }
      var u, v2, s;
      do { u = next() * 2 - 1; v2 = next() * 2 - 1; s = u * u + v2 * v2; } while (s >= 1 || s === 0);
      var m = Math.sqrt(-2 * Math.log(s) / s); spare = v2 * m; return u * m;
    }
    return { next: next, normal: normal };
  }
  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
  function lgamma(x) {
    var c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
    x -= 1; var a = c[0], t = x + 7.5;
    for (var i = 1; i < c.length; i++) a += c[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }
  function betacf(a, b, x) {
    var qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < 1e-300) d = 1e-300; d = 1 / d; var h = d;
    for (var m = 1; m <= 300; m++) {
      var m2 = 2 * m, aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d;
      var del = d * c; h *= del; if (Math.abs(del - 1) < 3e-12) break;
    }
    return h;
  }
  function betai(a, b, x) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    var bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  }
  function tPValue(t, df) { if (!isFinite(t)) return 0; return betai(df / 2, 0.5, df / (df + t * t)); }
  function tQuantile975(df) { // two-sided 95% critical value, by bisection on tPValue
    var lo = 0, hi = 100;
    for (var i = 0; i < 80; i++) { var mid = (lo + hi) / 2; if (tPValue(mid, df) > 0.05) lo = mid; else hi = mid; }
    return hi;
  }
  function normCdf(x) {
    var t = 1 / (1 + 0.2316419 * Math.abs(x));
    var poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    var tail = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI) * poly;
    return x >= 0 ? 1 - tail : tail;
  }

  var DEFAULTS = { n_tasks: 40, n_attempts: 3, base_logit: 0, sigma_task: 1.0, sigma_noise: 0.5, delta: 0, paired: true, alpha: 0.05,
    compute_k: 1, err_excess: 0, parse_fail_rate: 0, naive_se: false, judge_bias: 0, drift: 0, prompt_cue: 0, n_outcomes: 1 };
  function withDefaults(s) { var o = {}; for (var k in DEFAULTS) o[k] = s && s[k] !== undefined ? s[k] : DEFAULTS[k]; return o; }

  /* Mean success over tasks and attempts for a given base logit and effect,
   * by Gauss-Hermite quadrature over the combined normal. */
  var GH_X = [-3.436159118837738, -2.532731674232790, -1.756683649299882, -1.036610829789514, -0.342901327223705, 0.342901327223705, 1.036610829789514, 1.756683649299882, 2.532731674232790, 3.436159118837738];
  var GH_W = [7.640432855232621e-06, 1.343645746781233e-03, 3.387439445548106e-02, 2.401386110823147e-01, 6.108626337353258e-01, 6.108626337353258e-01, 2.401386110823147e-01, 3.387439445548106e-02, 1.343645746781233e-03, 7.640432855232621e-06];
  function meanSuccess(base, sigma) {
    var s = 0; for (var i = 0; i < GH_X.length; i++) s += GH_W[i] * sigmoid(base + Math.SQRT2 * sigma * GH_X[i]);
    return s / Math.sqrt(Math.PI);
  }
  function baseFor(rate, sigma) { var lo = -15, hi = 15; for (var i = 0; i < 80; i++) { var m = (lo + hi) / 2; if (meanSuccess(m, sigma) < rate) lo = m; else hi = m; } return (lo + hi) / 2; }
  function deltaFor(rate, gainPts, sigma) { // logit effect giving +gainPts (absolute, 0-1) on the mean rate
    var b = baseFor(rate, sigma), target = Math.min(0.999, rate + gainPts), lo = -10, hi = 10;
    for (var i = 0; i < 80; i++) { var m = (lo + hi) / 2; if (meanSuccess(b + m, sigma) < target) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }

  function runArm(s, rng, isB, diff, T, S) {
    var succ = [], keep = [];
    for (var t = 0; t < T; t++) {
      var ys = new Array(S), ks = new Array(S);
      for (var j = 0; j < S; j++) {
        var logit = s.base_logit + diff[t] + (s.sigma_noise > 0 ? rng.normal() * s.sigma_noise : 0);
        if (isB) { logit += s.delta + s.prompt_cue; if (s.drift && t * S + j >= T * S / 2) logit += s.drift; }
        var p = sigmoid(logit), ok;
        if (isB && s.compute_k > 1) { ok = false; for (var k = 0; k < s.compute_k; k++) if (rng.next() < p) ok = true; }
        else ok = rng.next() < p;
        var kp = true;
        if (s.parse_fail_rate > 0 && rng.next() < s.parse_fail_rate) { if (isB) ok = false; else kp = false; }
        if (isB && s.judge_bias > 0 && !ok && rng.next() < s.judge_bias) ok = true;
        ys[j] = ok; ks[j] = kp;
      }
      if (isB && s.err_excess > 0) {
        var pDrop = Math.min(0.95, s.err_excess * (1 - sigmoid(s.base_logit + diff[t])));
        if (rng.next() < pDrop) for (var j2 = 0; j2 < S; j2++) ks[j2] = false;
      }
      succ.push(ys); keep.push(ks);
    }
    return { y: succ, k: keep };
  }
  function taskMeans(arm) {
    return arm.y.map(function (ys, t) { var n = 0, x = 0; for (var j = 0; j < ys.length; j++) if (arm.k[t][j]) { n++; if (ys[j]) x++; } return n ? x / n : null; });
  }
  function analyzeArms(A, B, paired, naive) {
    if (naive) { // pseudo-replication: every attempt counted as independent
      var c = function (arm) { var n = 0, x = 0; arm.y.forEach(function (ys, t) { ys.forEach(function (v, j) { if (arm.k[t][j]) { n++; if (v) x++; } }); }); return { n: n, p: n ? x / n : 0 }; };
      var a = c(A), b = c(B), est = b.p - a.p;
      var se = Math.sqrt(a.p * (1 - a.p) / Math.max(1, a.n) + b.p * (1 - b.p) / Math.max(1, b.n));
      var z = se > 0 ? est / se : 0;
      return { est: est, se: se, p: se > 0 ? 2 * (1 - normCdf(Math.abs(z))) : (est ? 0 : 1), lo: est - 1.96 * se, hi: est + 1.96 * se, n: Math.min(a.n, b.n) };
    }
    var ma = taskMeans(A), mb = taskMeans(B);
    if (paired) {
      var d = []; for (var t = 0; t < ma.length; t++) if (ma[t] !== null && mb[t] !== null) d.push(mb[t] - ma[t]);
      var n = d.length; if (n < 2) return { est: 0, se: NaN, p: 1, lo: NaN, hi: NaN, n: n };
      var m = d.reduce(function (x, y) { return x + y; }, 0) / n;
      var v = d.reduce(function (x, y) { return x + (y - m) * (y - m); }, 0) / (n - 1);
      var se2 = Math.sqrt(v / n);
      var p = se2 > 0 ? tPValue(m / se2, n - 1) : (m ? 0 : 1);
      return { est: m, se: se2, p: p, n: n, df: n - 1 };
    }
    var fa = ma.filter(function (x) { return x !== null; }), fb = mb.filter(function (x) { return x !== null; });
    var mv = function (xs) { var mm = xs.reduce(function (x, y) { return x + y; }, 0) / xs.length; return [mm, xs.reduce(function (x, y) { return x + (y - mm) * (y - mm); }, 0) / (xs.length - 1)]; };
    if (fa.length < 2 || fb.length < 2) return { est: 0, se: NaN, p: 1, n: 0 };
    var A1 = mv(fa), B1 = mv(fb), va = A1[1] / fa.length, vb = B1[1] / fb.length, se3 = Math.sqrt(va + vb), est3 = B1[0] - A1[0];
    var df = (va + vb) * (va + vb) / (va * va / (fa.length - 1) + vb * vb / (fb.length - 1));
    return { est: est3, se: se3, p: se3 > 0 && isFinite(df) ? tPValue(est3 / se3, df) : (est3 ? 0 : 1), n: Math.min(fa.length, fb.length), df: df };
  }
  function oneExperiment(s, rng) {
    var T = s.n_tasks, S = s.n_attempts, dA = new Array(T), dB = new Array(T), t;
    for (t = 0; t < T; t++) dA[t] = rng.normal() * s.sigma_task;
    if (s.paired) dB = dA; else for (t = 0; t < T; t++) dB[t] = rng.normal() * s.sigma_task;
    var A = runArm(s, rng, false, dA, T, S), B = runArm(s, rng, true, dB, T, S);
    return analyzeArms(A, B, s.paired, s.naive_se);
  }
  /* Share of simulated evals that call B significantly better (two-sided
   * test at alpha, effect in B's favor). With delta = 0 this is the
   * false-alarm rate; with delta > 0, the chance to detect. */
  function rate(settings, nExp, seed) {
    var s = withDefaults(settings), rng = makeRng(seed || 1), hits = 0, any = 0, ests = 0;
    for (var e = 0; e < nExp; e++) {
      var best = null;
      for (var o = 0; o < Math.max(1, s.n_outcomes); o++) { var r = oneExperiment(s, rng); if (!best || r.p < best.p) best = r; }
      if (best.p < s.alpha) { any++; if (best.est > 0) hits++; }
      ests += best.est;
    }
    var p = hits / nExp, pa = any / nExp;
    return { rate: p, rate_any: pa, mc_se: Math.sqrt(p * (1 - p) / nExp), mc_se_any: Math.sqrt(pa * (1 - pa) / nExp), mean_est: ests / nExp, n_exp: nExp };
  }
  /* Standard deviation of the per-task difference (B minus A) in the clean
   * design (paired: same task; unpaired: independent tasks), by simulation of many tasks; used for the sample-size
   * formula n = ((z_a + z_b) * sd / gain)^2. */
  function taskDiffSd(settings, nTasks, seed) {
    var s = withDefaults(settings), paired = s.paired; s.n_tasks = nTasks || 4000;
    var rng = makeRng(seed || 11), dA = new Array(s.n_tasks), dB = new Array(s.n_tasks);
    for (var t = 0; t < s.n_tasks; t++) dA[t] = rng.normal() * s.sigma_task;
    for (t = 0; t < s.n_tasks; t++) dB[t] = paired ? dA[t] : rng.normal() * s.sigma_task;
    var A = runArm(s, rng, false, dA, s.n_tasks, s.n_attempts), B = runArm(s, rng, true, dB, s.n_tasks, s.n_attempts);
    var ma = taskMeans(A), mb = taskMeans(B), d = [];
    for (t = 0; t < ma.length; t++) d.push(mb[t] - ma[t]);
    var m = d.reduce(function (x, y) { return x + y; }, 0) / d.length;
    return Math.sqrt(d.reduce(function (x, y) { return x + (y - m) * (y - m); }, 0) / (d.length - 1));
  }
  function tasksFor80(sd, gain, alpha, power) {
    var za = 1.959963984540054, zb = 0.8416212335729143;
    if (alpha && alpha !== 0.05) za = Math.abs(normInvApprox(alpha / 2));
    if (power && power !== 0.8) zb = Math.abs(normInvApprox(1 - power));
    return Math.ceil(Math.pow((za + zb) * sd / gain, 2)) + 1; // +1 for the t distribution at small n
  }
  function normInvApprox(p) { var lo = -10, hi = 10; for (var i = 0; i < 80; i++) { var m = (lo + hi) / 2; if (normCdf(m) < p) lo = m; else hi = m; } return (lo + hi) / 2; }

  /* Latent-scale intraclass correlation and the effective number of
   * independent attempts per version (design effect 1 + (S-1) ICC). */
  function designEffect(sigmaTask, sigmaNoise, T, S) {
    var icc = sigmaTask * sigmaTask / (sigmaTask * sigmaTask + sigmaNoise * sigmaNoise + Math.PI * Math.PI / 3);
    var deff = 1 + (S - 1) * icc;
    return { icc: icc, deff: deff, effective: T * S / deff };
  }

  /* Check mode: analyze pasted results rows {task, version, attempt, success}. */
  function analyzeResults(rows, opts) {
    opts = opts || {};
    var versions = []; rows.forEach(function (r) { if (versions.indexOf(r.version) < 0) versions.push(r.version); });
    if (versions.length !== 2) return { error: "Found " + versions.length + " version label" + (versions.length === 1 ? "" : "s") + " (" + versions.join(", ") + "). Results need exactly two." };
    var vA = opts.a && versions.indexOf(opts.a) >= 0 ? opts.a : versions[0], vB = versions[0] === vA ? versions[1] : versions[0];
    var byTask = {};
    rows.forEach(function (r) { var k = byTask[r.task] || (byTask[r.task] = { a: [], b: [] }); (r.version === vA ? k.a : k.b).push(r.success ? 1 : 0); });
    var tasks = Object.keys(byTask), d = [], onlyOne = [], attemptsA = 0, attemptsB = 0, nA = 0, xA = 0, nB = 0, xB = 0;
    tasks.forEach(function (t) {
      var k = byTask[t]; attemptsA += k.a.length; attemptsB += k.b.length;
      nA += k.a.length; nB += k.b.length; xA += k.a.reduce(function (x, y) { return x + y; }, 0); xB += k.b.reduce(function (x, y) { return x + y; }, 0);
      if (!k.a.length || !k.b.length) { onlyOne.push(t); return; }
      var ma = k.a.reduce(function (x, y) { return x + y; }, 0) / k.a.length, mb = k.b.reduce(function (x, y) { return x + y; }, 0) / k.b.length;
      d.push(mb - ma);
    });
    var n = d.length;
    var out = { vA: vA, vB: vB, tasks: tasks.length, paired: n, onlyOne: onlyOne, attemptsA: attemptsA, attemptsB: attemptsB, rateA: nA ? xA / nA : NaN, rateB: nB ? xB / nB : NaN };
    if (n < 2) { out.error = "Need at least two tasks that ran on both versions."; return out; }
    var m = d.reduce(function (x, y) { return x + y; }, 0) / n, v = d.reduce(function (x, y) { return x + (y - m) * (y - m); }, 0) / (n - 1), se = Math.sqrt(v / n);
    var tc = tQuantile975(n - 1);
    out.diff = m; out.se = se; out.lo = m - tc * se; out.hi = m + tc * se; out.p = se > 0 ? tPValue(m / se, n - 1) : (m ? 0 : 1);
    // task-level bootstrap (percentile), seeded
    var rng = makeRng(opts.seed || 2026), B = opts.boot || 2000, bs = [];
    for (var b = 0; b < B; b++) { var s = 0; for (var i = 0; i < n; i++) s += d[Math.floor(rng.next() * n)]; bs.push(s / n); }
    bs.sort(function (x, y) { return x - y; });
    out.bootLo = bs[Math.floor(0.025 * B)]; out.bootHi = bs[Math.ceil(0.975 * B) - 1];
    // the naive analysis: attempts as independent
    var pa = xA / nA, pb = xB / nB, sen = Math.sqrt(pa * (1 - pa) / nA + pb * (1 - pb) / nB);
    out.naiveDiff = pb - pa; out.naiveLo = pb - pa - 1.96 * sen; out.naiveHi = pb - pa + 1.96 * sen; out.naiveP = sen > 0 ? 2 * (1 - normCdf(Math.abs((pb - pa) / sen))) : 1;
    return out;
  }

  var api = { DEFAULTS: DEFAULTS, withDefaults: withDefaults, rate: rate, oneExperiment: oneExperiment, meanSuccess: meanSuccess, baseFor: baseFor, deltaFor: deltaFor, designEffect: designEffect, taskDiffSd: taskDiffSd, tasksFor80: tasksFor80, analyzeResults: analyzeResults, tPValue: tPValue, tQuantile975: tQuantile975, makeRng: makeRng };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  g.EvalSim = api;
})(typeof window !== "undefined" ? window : globalThis);
