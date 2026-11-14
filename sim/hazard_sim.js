/*
 * Experiment hazard simulator — simulation core.
 *
 * This is the JavaScript mirror of sim/model.py. The two implementations
 * must agree on false-positive rates within Monte Carlo error; tests/
 * checks that against saved outputs of this file (see sim/js_check.mjs).
 *
 * Model: an experiment compares condition A and B. Each condition runs on
 * its own sample of T tasks, S seeds per task. Task difficulty ~
 * Normal(0, sigma_task) on the logit scale. Run success ~
 * Bernoulli(sigmoid(base + difficulty + delta*B + noise)). Correct
 * analysis: difference in success rates with a two-sample (Welch)
 * standard error over per-task means — the task is the replication unit.
 * All data are simulated.
 */
(function (global) {
  "use strict";

  // --- Seeded RNG (mulberry32) + Box-Muller normals -----------------------
  function makeRng(seed) {
    var a = seed >>> 0;
    function next() {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    var spare = null;
    function normal() {
      if (spare !== null) { var v = spare; spare = null; return v; }
      var u = 0, v2 = 0, s = 0;
      do {
        u = next() * 2 - 1; v2 = next() * 2 - 1; s = u * u + v2 * v2;
      } while (s >= 1 || s === 0);
      var m = Math.sqrt(-2 * Math.log(s) / s);
      spare = v2 * m;
      return u * m;
    }
    return { next: next, normal: normal };
  }

  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

  // Standard normal CDF (Abramowitz & Stegun 26.2.17).
  function normCdf(x) {
    var t = 1 / (1 + 0.2316419 * Math.abs(x));
    var poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 +
      t * (-1.821255978 + t * 1.330274429))));
    var tail = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI) * poly;
    return x >= 0 ? 1 - tail : tail;
  }

  // Regularized incomplete beta I_x(a, b), Lentz continued fraction
  // (Numerical Recipes, betacf/betai).
  function betacf(a, b, x) {
    var MAXIT = 200, EPS = 3e-12, FPMIN = 1e-300;
    var qab = a + b, qap = a + 1, qam = a - 1;
    var c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    var h = d;
    for (var m = 1; m <= MAXIT; m++) {
      var m2 = 2 * m;
      var aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      var del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  function betai(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var bt = Math.exp(
      lgamma(a + b) - lgamma(a) - lgamma(b) +
      a * Math.log(x) + b * Math.log(1 - x)
    );
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
    return 1 - bt * betacf(b, a, 1 - x) / b;
  }
  function lgamma(x) { // Lanczos approximation
    var c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
      771.32342877765313, -176.61502916214059, 12.507343278686905,
      -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
    x -= 1;
    var a = c[0], t = x + 7.5;
    for (var i = 1; i < c.length; i++) a += c[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }
  // Two-sided p-value for a t statistic.
  function tPValue(t, df) {
    if (!isFinite(t)) return 0;
    var x = df / (df + t * t);
    return betai(df / 2, 0.5, x);
  }

  var DEFAULTS = {
    n_tasks: 20, n_seeds: 5, base_logit: 0.0, sigma_task: 1.0,
    sigma_noise: 0.5, delta: 0.0, alpha: 0.05,
    compute_k: 1,
    err_base: 0.05, err_excess: 0.0,
    parse_fail_rate: 0.0, parse_rule: "b_wrong_a_missing",
    naive_se: false,
    judge_bias: 0.0,
    drift: 0.0,
    prompt_cue: 0.0,
    n_outcomes: 1
  };

  function withDefaults(s) {
    var out = {};
    for (var k in DEFAULTS) out[k] = (s && s[k] !== undefined) ? s[k] : DEFAULTS[k];
    return out;
  }

  // Simulate one experiment measuring one outcome.
  // Returns {estimate, se, p_value}.
  function oneExperiment(s, rng) {
    var T = s.n_tasks, S = s.n_seeds;
    var armData = {};
    var arms = [false, true]; // false = A, true = B
    for (var ai = 0; ai < 2; ai++) {
      var isB = arms[ai];
      var difficulty = new Array(T);
      for (var t = 0; t < T; t++) difficulty[t] = rng.normal() * s.sigma_task;
      var y = [], kept = [];
      for (t = 0; t < T; t++) {
        y.push(new Array(S)); kept.push(new Array(S));
        for (var j = 0; j < S; j++) {
          var logit = s.base_logit + difficulty[t];
          if (s.sigma_noise > 0) logit += rng.normal() * s.sigma_noise;
          if (isB) {
            logit += s.delta + s.prompt_cue;
            if (s.drift !== 0) {
              var runIndex = t * S + j;
              if (runIndex >= (T * S) / 2) logit += s.drift;
            }
          }
          var p = sigmoid(logit);
          var success, pRun;
          if (isB && s.compute_k > 1) {
            success = false;
            for (var k = 0; k < s.compute_k; k++) {
              if (rng.next() < p) success = true;
            }
            pRun = 1 - Math.pow(1 - p, s.compute_k);
          } else {
            success = rng.next() < p;
            pRun = p;
          }
          // Hazard 2: post-treatment exclusion (errors drop runs). Flat
          // run-level dropout in both arms; in B, hard tasks also error
          // out entirely (task-level drop, applied after the run loop).
          var keep = rng.next() >= s.err_base;
          // Hazard 3: parse failures with arm-specific rules.
          if (s.parse_fail_rate > 0 && rng.next() < s.parse_fail_rate) {
            var countsWrong = isB
              ? s.parse_rule === "b_wrong_a_missing"
              : s.parse_rule === "a_wrong_b_missing";
            if (countsWrong) success = false; else keep = false;
          }
          // Hazard 5: unblinded judge upgrades B failures.
          if (isB && s.judge_bias > 0 && !success && rng.next() < s.judge_bias) {
            success = true;
          }
          y[t][j] = success; kept[t][j] = keep;
        }
      }
      // Hazard 2 (B only): task-level exclusion — a hard task breaks the
      // treated agent and all of its B runs are dropped.
      if (isB && s.err_excess > 0) {
        for (t = 0; t < T; t++) {
          var qTask = 1 - sigmoid(s.base_logit + difficulty[t]);
          var pDrop = Math.min(0.95, s.err_excess * qTask);
          if (rng.next() < pDrop) {
            for (var j2 = 0; j2 < S; j2++) kept[t][j2] = false;
          }
        }
      }
      armData[isB ? "b" : "a"] = { y: y, kept: kept };
    }

    var est, se, pValue;
    if (s.naive_se) {
      // Hazard 4: pool all runs as if independent.
      var sums = {};
      for (var key in armData) {
        var d = armData[key], n = 0, tot = 0;
        for (t = 0; t < T; t++) for (var j = 0; j < S; j++) {
          if (d.kept[t][j]) { n++; if (d.y[t][j]) tot++; }
        }
        sums[key] = { n: n, p: n > 0 ? tot / n : NaN };
      }
      est = sums.b.p - sums.a.p;
      se = Math.sqrt(
        sums.a.p * (1 - sums.a.p) / Math.max(sums.a.n, 1) +
        sums.b.p * (1 - sums.b.p) / Math.max(sums.b.n, 1)
      );
      if (isNaN(est)) est = 0;
      var z = se > 0 ? est / se : (est !== 0 ? (est > 0 ? Infinity : -Infinity) : 0);
      pValue = isFinite(z) ? 2 * (1 - normCdf(Math.abs(z))) : 0;
    } else {
      // Correct analysis: per-task arm means, Welch two-sample test.
      var statsA = taskStats(armData.a, T, S), statsB = taskStats(armData.b, T, S);
      est = statsB.mean - statsA.mean;
      if (isNaN(est)) est = 0;
      if (statsA.n > 1 && statsB.n > 1) {
        var va = statsA.variance / statsA.n, vb = statsB.variance / statsB.n;
        se = Math.sqrt(va + vb);
        var denom = va * va / (statsA.n - 1) + vb * vb / (statsB.n - 1);
        var df = denom > 0 ? (va + vb) * (va + vb) / denom : NaN;
        if (se > 0 && isFinite(df)) {
          pValue = tPValue(est / se, df);
        } else {
          pValue = est !== 0 ? 0 : 1;
        }
      } else {
        se = NaN; pValue = 1;
      }
    }
    return { estimate: est, se: se, p_value: pValue };
  }

  function taskStats(d, T, S) {
    var means = [];
    for (var t = 0; t < T; t++) {
      var n = 0, tot = 0;
      for (var j = 0; j < S; j++) if (d.kept[t][j]) { n++; if (d.y[t][j]) tot++; }
      if (n > 0) means.push(tot / n);
    }
    var m = NaN, v = NaN;
    if (means.length > 0) {
      m = 0; for (var i = 0; i < means.length; i++) m += means[i];
      m /= means.length;
      if (means.length > 1) {
        var ss = 0; for (i = 0; i < means.length; i++) ss += (means[i] - m) * (means[i] - m);
        v = ss / (means.length - 1);
      }
    }
    return { mean: m, variance: v, n: means.length };
  }

  // Simulate nExp experiments. With selective reporting, each experiment
  // measures n_outcomes independent copies and reports the smallest p.
  function simulateExperiments(settings, nExp, seed) {
    var s = withDefaults(settings);
    var rng = makeRng(seed);
    var estimates = new Array(nExp);
    var rejected = 0;
    for (var e = 0; e < nExp; e++) {
      var best = null;
      var m = Math.max(1, s.n_outcomes);
      for (var o = 0; o < m; o++) {
        var out = oneExperiment(s, rng);
        if (best === null || out.p_value < best.p_value) best = out;
      }
      estimates[e] = best.estimate;
      if (best.p_value < s.alpha) rejected++;
    }
    var rate = rejected / nExp;
    var mean = 0; for (var i = 0; i < nExp; i++) mean += estimates[i];
    mean /= nExp;
    return {
      estimates: estimates,
      rate: rate,
      mc_se: Math.sqrt(rate * (1 - rate) / nExp),
      mean_estimate: mean,
      n_exp: nExp
    };
  }

  var api = {
    DEFAULTS: DEFAULTS,
    withDefaults: withDefaults,
    simulateExperiments: simulateExperiments,
    _oneExperiment: oneExperiment,
    _makeRng: makeRng
  };
  global.HazardSim = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
