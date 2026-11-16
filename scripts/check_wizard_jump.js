/* Browser check: the wizard's "Jump to the verdict" control must land on
   exactly the same verdict as clicking Next through all 12 steps.

   Three passes over the page with the default inputs:
     1. walk  — click Next 11 times to reach the summary card;
     2. jump1 — reload, click "Jump to the verdict" on the first card;
     3. jump6 — reload, click Next 5 times, then activate the jump control
        with the keyboard (focus + Enter).
   The verdict (title, body, KPIs, fix list, checks) must be identical in
   all three passes; the summary card must be visible and focused, the
   last progress dot must carry aria-current="step", and there must be no
   console errors. Prints the verdict values as JSON; exits 1 on failure.

   Run:  node scripts/check_wizard_jump.js
   Needs puppeteer-core and a Chromium build. Resolution order for
   puppeteer-core: $PUPPETEER_CORE, a normal require(), then the
   structural-variation tools folder next to this repo. Chromium:
   $CHROME_PATH, then the Playwright headless shell in ~/.cache. */
"use strict";
const fs = require("fs");
const http = require("http");
const path = require("path");

const DOCS = path.join(__dirname, "..", "docs");

function loadPuppeteer() {
  const candidates = [];
  if (process.env.PUPPETEER_CORE) candidates.push(process.env.PUPPETEER_CORE);
  candidates.push("puppeteer-core");
  candidates.push(path.join(__dirname, "..", "..", "tools", "node_modules", "puppeteer-core"));
  for (const c of candidates) {
    try { return require(c); } catch (e) { /* try next */ }
  }
  throw new Error("puppeteer-core not found (set PUPPETEER_CORE)");
}

function chromePath() {
  const candidates = [];
  if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);
  const home = process.env.HOME || "/home/hatch";
  candidates.push(path.join(home, ".cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell"));
  candidates.push(path.join(home, ".cache/ms-playwright/chromium-1255/chrome-linux64/chrome"));
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error("no Chromium found (set CHROME_PATH)");
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".gif": "image/gif", ".svg": "image/svg+xml" };
function serveDocs() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      const file = path.join(DOCS, urlPath === "/" ? "index.html" : urlPath);
      if (!file.startsWith(DOCS) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end("not found"); return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readVerdict(page) {
  return page.evaluate(() => {
    const txt = (id) => { const el = document.getElementById(id); return el ? el.innerText : null; };
    const dots = Array.prototype.slice.call(document.querySelectorAll(".wiz-dot"));
    const summary = document.querySelector(".wiz-summary");
    return {
      title: txt("vTitle"), body: txt("vBody"), kpis: txt("kpis"),
      fixList: txt("fixList"), checks: txt("checks"),
      progress: txt("wizProgress"),
      currentDot: dots.findIndex((d) => d.getAttribute("aria-current") === "step"),
      dotCount: dots.length,
      summaryVisible: !!summary && !summary.hidden,
      focusOnSummary: !!summary && (document.activeElement === summary || summary.contains(document.activeElement)),
      jumpHidden: document.getElementById("wizJump").hidden
    };
  }).then((v) => {
    for (const k of ["title", "body", "kpis", "fixList", "checks", "progress"]) v[k] = norm(v[k]);
    return v;
  });
}

async function openFresh(page, base) {
  await page.goto(base, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => {
    const t = document.getElementById("vTitle");
    const j = document.getElementById("wizJump");
    return t && t.textContent.trim() && t.textContent.trim() !== "…" && j && !j.hidden;
  }, { timeout: 30000 });
}

(async () => {
  const puppeteer = loadPuppeteer();
  const srv = await serveDocs();
  const base = "http://127.0.0.1:" + srv.address().port + "/";
  const browser = await puppeteer.launch({ executablePath: chromePath(), args: ["--no-sandbox"] });
  const errors = [];
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  const out = {};
  try {
    /* Pass 1: walk through all 12 steps with Next. */
    await openFresh(page, base);
    for (let i = 0; i < 11; i++) { await page.click("#wizNext"); await sleep(150); }
    out.walk = await readVerdict(page);

    /* Pass 2: jump from the first card. */
    await openFresh(page, base);
    await page.click("#wizJump");
    await sleep(200);
    out.jumpFromStep1 = await readVerdict(page);

    /* Pass 3: jump from a middle step, by keyboard. */
    await openFresh(page, base);
    for (let i = 0; i < 5; i++) { await page.click("#wizNext"); await sleep(150); }
    await page.focus("#wizJump");
    await page.keyboard.press("Enter");
    await sleep(200);
    out.jumpFromStep6 = await readVerdict(page);
  } finally {
    await browser.close();
    srv.close();
  }

  const verdictOf = (v) => JSON.stringify({ title: v.title, body: v.body, kpis: v.kpis, fixList: v.fixList, checks: v.checks });
  const problems = [];
  for (const [name, v] of Object.entries(out)) {
    if (!v.summaryVisible) problems.push(name + ": summary card not visible");
    if (!v.focusOnSummary) problems.push(name + ": focus is not on the summary card");
    if (v.currentDot !== v.dotCount - 1) problems.push(name + ": aria-current dot is " + v.currentDot + ", expected last (" + (v.dotCount - 1) + ")");
    if (v.progress !== "Step 12 of 12 · Your verdict") problems.push(name + ": progress reads '" + v.progress + "'");
    if (!v.jumpHidden) problems.push(name + ": jump control still visible on the summary card");
  }
  if (verdictOf(out.jumpFromStep1) !== verdictOf(out.walk)) problems.push("jump-from-step-1 verdict differs from the walk-through verdict");
  if (verdictOf(out.jumpFromStep6) !== verdictOf(out.walk)) problems.push("jump-from-step-6 verdict differs from the walk-through verdict");
  if (errors.length) problems.push("console errors: " + errors.join(" | "));

  console.log(JSON.stringify(out, null, 2));
  if (problems.length) {
    console.error("FAIL: " + problems.join("; "));
    process.exit(1);
  }
  console.log("PASS: jump verdict == walk-through verdict (title, body, KPIs, fix list, checks); focus, dots and progress correct; no console errors.");
})().catch((e) => { console.error(e); process.exit(1); });
