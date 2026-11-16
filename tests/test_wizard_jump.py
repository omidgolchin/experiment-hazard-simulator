"""The Plan wizard's "Jump to the verdict" control.

Two layers:
- Static checks (always run): the control exists in the page as a real
  button inside the wizard's navigation row, it is wired in app.js to go
  to the final step with focus, it is hidden once the summary card is
  showing, and it has its own style rule.
- Browser check (skipped when node, puppeteer-core or Chromium are not
  available): runs scripts/check_wizard_jump.js, which walks all 12
  steps with Next, reloads and jumps from step 1, reloads and jumps from
  step 6 by keyboard, and requires the three verdicts to be identical.
"""

import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "docs" / "index.html").read_text()
APP = (ROOT / "docs" / "app.js").read_text()
CSS = (ROOT / "docs" / "tool.css").read_text()

NODE = shutil.which("node")
HOME = Path(os.environ.get("HOME", "/home/hatch"))
CHROME_CANDIDATES = [
    os.environ.get("CHROME_PATH"),
    str(HOME / ".cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell"),
    str(HOME / ".cache/ms-playwright/chromium-1255/chrome-linux64/chrome"),
]
CHROME = next((c for c in CHROME_CANDIDATES if c and Path(c).exists()), None)
PUPPETEER = os.environ.get("PUPPETEER_CORE") or str(
    ROOT.parent / "tools" / "node_modules" / "puppeteer-core"
)
needs_browser = pytest.mark.skipif(
    NODE is None or CHROME is None or not Path(PUPPETEER).exists(),
    reason="node, Chromium or puppeteer-core not available",
)


def test_jump_control_exists_in_nav_row():
    assert 'id="wizJump"' in INDEX
    nav = INDEX.index('<div class="wiz-nav">')
    form_end = INDEX.index("</form>")
    jump = INDEX.index('id="wizJump"')
    assert nav < jump < form_end, "jump control must live in the wizard nav row"
    button = INDEX[INDEX.rindex("<button", 0, jump):INDEX.index(">", jump) + 1]
    assert 'type="button"' in button, "jump control must be a real button (keyboard-operable)"
    label_end = INDEX.index("</button>", jump)
    assert "Jump to the verdict" in INDEX[jump:label_end]


def test_jump_control_wired_to_final_step_with_focus():
    assert '$("wizJump").addEventListener("click"' in APP
    assert "wizGo(wizSteps.length - 1, true)" in APP
    # Hidden while the summary card itself is showing.
    assert '$("wizJump").hidden = wizIdx === wizSteps.length - 1' in APP
    # Styling lives in the tool's own stylesheet, not the shared kit.
    assert ".wiz-jump" in CSS


@needs_browser
def test_jump_verdict_matches_walkthrough():
    proc = subprocess.run(
        [NODE, "scripts/check_wizard_jump.js"],
        capture_output=True, text=True, timeout=600, cwd=ROOT,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "PASS" in proc.stdout
