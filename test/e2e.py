"""Browser test of the installed extension in a real JupyterLab and real Chrome.

Needs: the wheel installed in the Python env that runs JupyterLab, the stand-in
API (test/mock_api.py) on 8898, and JupyterLab on 8897 started with
--LabApp.expose_app_in_browser=True and a user setting
apiBaseUrl = http://127.0.0.1:8898. See test/README.md.

    python test/e2e.py <settings_dir> <work_dir> <screenshot_dir>
"""
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

LAB = "http://127.0.0.1:8897/lab"
HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, "requests.jsonl")
SETTINGS_DIR, WORK_DIR, SHOTS = sys.argv[1], sys.argv[2], sys.argv[3]
SETTINGS_FILE = os.path.join(
    SETTINGS_DIR, "jupyterlab-asyntai-ai-assistant", "plugin.jupyterlab-settings"
)
os.makedirs(SHOTS, exist_ok=True)

NOTEBOOK = {
    "cells": [
        {"cell_type": "markdown", "metadata": {}, "source": ["# Q3 sales report\n", "Revenue grew in every region."]},
        {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [],
         "source": ["import pandas as pd\n", "df = pd.read_csv('sales.csv')"]},
        {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": []},
    ],
    "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
                 "language_info": {"name": "python"}},
    "nbformat": 4,
    "nbformat_minor": 5,
}

# Start from a clean state: no key, no website, a fresh notebook, no request log.
os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
    json.dump({"apiBaseUrl": "http://127.0.0.1:8898"}, f)
with open(os.path.join(WORK_DIR, "Q3_sales.ipynb"), "w", encoding="utf-8") as f:
    json.dump(NOTEBOOK, f)
if os.path.exists(LOG):
    os.remove(LOG)

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))


def requests():
    if not os.path.exists(LOG):
        return []
    with open(LOG, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def last(path):
    hits = [r for r in requests() if r["path"] == path]
    return hits[-1] if hits else None


def read_settings():
    with open(SETTINGS_FILE, encoding="utf-8") as f:
        text = f.read()
    # JupyterLab writes JSON5 with comments; the values we need are plain.
    lines = [l for l in text.splitlines() if not l.strip().startswith("//")]
    return json.loads("\n".join(lines))


def run_command(page, command, args=None):
    page.evaluate(
        # Return nothing: some commands resolve to a widget, which cannot be
        # sent back to Python and makes evaluate hang.
        # Do not wait either: a command that opens a dialog only resolves
        # after the dialog closes.
        "([c, a]) => { window.jupyterapp.commands.execute(c, a || {}); return null; }",
        [command, args],
    )


with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True)
    context = browser.new_context(viewport={"width": 1400, "height": 900})
    context.grant_permissions(["clipboard-read", "clipboard-write"], origin="http://127.0.0.1:8897")
    page = context.new_page()
    page.set_default_timeout(20000)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "asyntai" in m.text.lower() else None)

    page.goto(LAB)
    page.wait_for_selector("#jp-main-dock-panel", timeout=60000)
    page.wait_for_function("() => window.jupyterapp && window.jupyterapp.commands.hasCommand('asyntai-ai-assistant:open')", timeout=60000)
    check("extension commands are registered", True)

    tab = page.locator('.lm-TabBar-tab[data-id="asyntai-ai-assistant"]')
    check("sidebar tab exists on the right", tab.count() == 1 and page.locator('#jp-right-stack, .jp-SideBar.jp-mod-right').count() > 0)
    tab.click()
    panel = page.locator("#asyntai-ai-assistant")
    panel.wait_for(state="visible")
    key_view = panel.locator(".jp-AsyntaiPanel-key")
    chat_view = panel.locator(".jp-AsyntaiPanel-chat")
    check("without a key the key form shows", key_view.is_visible() and not chat_view.is_visible())
    link = key_view.locator("a")
    check("key form links to the API key page", link.get_attribute("href") == "https://asyntai.com/settings/api/" and link.get_attribute("target") == "_blank")
    page.screenshot(path=os.path.join(SHOTS, "01_key_form.png"))

    key_input = key_view.locator("input")
    status = key_view.locator(".jp-AsyntaiPanel-status")
    key_view.locator("button").click()
    check("empty key gives a message", "Paste your API key" in status.inner_text())

    key_input.fill("wrong-key")
    key_input.press("Enter")
    page.wait_for_function("() => document.querySelector('.jp-AsyntaiPanel-key .jp-AsyntaiPanel-status').textContent.includes('did not accept')")
    check("bad key shows the 401 message", "did not accept this API key" in status.inner_text())
    check("bad key is not saved", "wrong-key" not in open(SETTINGS_FILE, encoding="utf-8").read())

    key_input.fill("starter-less")
    key_view.locator("button").click()
    page.wait_for_function("() => document.querySelector('.jp-AsyntaiPanel-key .jp-AsyntaiPanel-status').textContent.includes('Starter')")
    check("key without API access shows the plan message", "Starter plan" in status.inner_text())

    key_input.fill("good-key")
    key_view.locator("button").click()
    chat_view.wait_for(state="visible")
    page.wait_for_function("() => document.querySelectorAll('.jp-AsyntaiPanel-select option').length === 2")
    check("good key opens the conversation view", chat_view.is_visible() and not key_view.is_visible())
    check("good key is saved in the settings", read_settings().get("apiKey") == "good-key")
    acct = last("/api/v1/account/")
    check("key check calls /api/v1/account/ with Bearer", acct and acct["auth"] == "Bearer good-key")
    select = panel.locator("select")
    check("primary website is selected first", select.input_value() == "10")
    check("website names show", select.locator("option").all_inner_texts() == ["example.test", "docs.example.test"])

    question = panel.locator("textarea")
    question.fill("How do I reset my password?")
    question.press("Enter")
    page.wait_for_selector(".jp-AsyntaiPanel-message.jp-mod-answer")
    answer = panel.locator(".jp-AsyntaiPanel-message.jp-mod-answer").first
    chat = last("/api/v1/chat/")
    check("question goes to /api/v1/chat/", chat and chat["body"]["message"] == "How do I reset my password?")
    check("question asks the primary website", chat and chat["body"].get("website_id") == 10)
    first_session = chat["body"].get("session_id", "") if chat else ""
    check("question sends a jupyterlab- session id", first_session.startswith("jupyterlab-"))
    check("question bubble shows", panel.locator(".jp-mod-question").first.inner_text() == "How do I reset my password?")
    check("answer renders Markdown bold", answer.locator("strong").first.inner_text() == "Answer")
    check("answer renders a list", answer.locator("li").count() == 2)
    guide = answer.locator('a[href="https://example.test/guide"]')
    check("answer link opens in a new tab", guide.count() == 1 and guide.get_attribute("target") == "_blank")
    check("answer HTML is sanitized (no onerror)", answer.locator("img[onerror]").count() == 0 and page.title() != "XSS")
    check("AI disclosure shows", panel.locator(".jp-AsyntaiPanel-disclosure").inner_text() == "Answers are written by AI.")
    check("question box is empty after send", question.input_value() == "")
    page.screenshot(path=os.path.join(SHOTS, "02_answer_light.png"))

    question.fill("And on mobile?")
    panel.locator("button", has_text="Ask").click()
    page.wait_for_function("() => document.querySelectorAll('.jp-AsyntaiPanel-message.jp-mod-answer').length === 2")
    chat = last("/api/v1/chat/")
    check("follow-up keeps the same session", chat["body"].get("session_id") == first_session)

    question.fill("first line")
    question.press("Shift+Enter")
    question.type("second line")
    check("Shift+Enter adds a new line and does not send", question.input_value() == "first line\nsecond line" and len([r for r in requests() if r["path"] == "/api/v1/chat/"]) == 2)
    question.fill("")

    select.select_option("11")
    time.sleep(0.5)
    check("changing website clears the conversation", panel.locator(".jp-AsyntaiPanel-message").count() == 0)
    check("chosen website is saved in the settings", read_settings().get("websiteId") == 11)
    question.fill("What is in the docs?")
    question.press("Enter")
    page.wait_for_selector(".jp-AsyntaiPanel-message.jp-mod-answer")
    chat = last("/api/v1/chat/")
    check("question asks the chosen website", chat["body"].get("website_id") == 11)
    check("new website starts a new session", chat["body"].get("session_id") != first_session)

    # Insert into a notebook.
    panel.locator("button", has_text="Insert in notebook").first.click()
    check("insert without a notebook gives a message", "Open a notebook first" in panel.locator(".jp-AsyntaiPanel-chat > .jp-AsyntaiPanel-status").inner_text())
    run_command(page, "docmanager:open", {"path": "Q3_sales.ipynb"})
    page.wait_for_selector(".jp-NotebookPanel .jp-Cell")
    time.sleep(1.5)
    before = page.locator(".jp-NotebookPanel .jp-Cell").count()
    page.locator(".jp-NotebookPanel .jp-Cell").first.click()
    panel.locator("button", has_text="Insert in notebook").first.click()
    time.sleep(0.5)
    cells = page.locator(".jp-NotebookPanel .jp-Cell")
    check("insert adds one cell", cells.count() == before + 1, f"{before} -> {cells.count()}")
    new_cell = cells.nth(1)
    check("inserted cell is Markdown and rendered", "jp-MarkdownCell" in (new_cell.get_attribute("class") or "") and new_cell.locator(".jp-RenderedMarkdown strong").count() >= 1)

    panel.locator("button", has_text="Copy").first.click()
    time.sleep(0.3)
    clip = page.evaluate("() => navigator.clipboard.readText()")
    check("copy puts the Markdown answer on the clipboard", clip.startswith("**Answer** for website 11"))

    # Ask about the selection (context menu on a cell).
    code_cell = cells.nth(2)
    code_cell.click(button="right")
    item = page.locator(".lm-Menu-item", has_text="Ask Asyntai about the selection")
    check("cell context menu has the ask item", item.count() >= 1)
    item.first.click()
    time.sleep(0.4)
    check("ask about cell fills the question box", "pd.read_csv('sales.csv')" in question.input_value() and question.input_value().startswith("Explain this:"))
    question.fill("")

    # Add the notebook to the knowledge base.
    page.locator(".jp-NotebookPanel .jp-Cell").first.click()
    run_command(page, "asyntai-ai-assistant:add-notebook")
    page.wait_for_selector(".jp-Dialog")
    check("add-notebook asks for confirmation", "Add notebook to Asyntai" in page.locator(".jp-Dialog").inner_text())
    page.screenshot(path=os.path.join(SHOTS, "03_add_dialog.png"))
    page.locator(".jp-Dialog button", has_text="Add").click()
    page.wait_for_function("() => document.body.innerText.includes('is in your Asyntai knowledge base')", timeout=10000)
    kb = last("/api/v1/knowledge/text/")
    check("add-notebook posts title from the file name", kb and kb["body"]["title"] == "Q3_sales")
    check("add-notebook sends Markdown and fenced code", kb and "# Q3 sales report" in kb["body"]["content"] and "```python\nimport pandas as pd" in kb["body"]["content"])
    check("add-notebook uses the chosen website", kb and kb["body"].get("website_id") == 11)
    check("add-notebook shows a success notice", page.locator("text=is in your Asyntai knowledge base").count() >= 1)

    n_kb = len([r for r in requests() if r["path"] == "/api/v1/knowledge/text/"])
    run_command(page, "asyntai-ai-assistant:add-notebook")
    page.wait_for_selector(".jp-Dialog")
    page.locator(".jp-Dialog button", has_text="Cancel").click()
    time.sleep(0.5)
    check("cancel sends nothing", len([r for r in requests() if r["path"] == "/api/v1/knowledge/text/"]) == n_kb)

    # Palette entries.
    page.keyboard.press("Control+Shift+C")
    page.wait_for_selector(".lm-CommandPalette-input")
    page.keyboard.type("Asyntai")
    time.sleep(0.5)
    labels = page.locator(".lm-CommandPalette-itemLabel").all_inner_texts()
    check("palette lists the 4 commands", all(any(x in l for l in labels) for x in [
        "Open Asyntai AI Assistant", "Ask Asyntai about the selection",
        "Add this notebook to the Asyntai knowledge base", "New Asyntai conversation"]), str(labels))
    page.keyboard.press("Escape")

    run_command(page, "asyntai-ai-assistant:new-conversation")
    time.sleep(0.3)
    check("new conversation clears messages", panel.locator(".jp-AsyntaiPanel-message").count() == 0)

    # Dark theme.
    question.fill("Dark theme check")
    question.press("Enter")
    page.wait_for_selector(".jp-AsyntaiPanel-message.jp-mod-answer")
    run_command(page, "apputils:change-theme", {"theme": "JupyterLab Dark"})
    page.wait_for_function("() => document.body.dataset.jpThemeLight === 'false'", timeout=15000)
    time.sleep(1)
    bg = page.evaluate("() => getComputedStyle(document.querySelector('#asyntai-ai-assistant')).backgroundColor")
    fg = page.evaluate("() => getComputedStyle(document.querySelector('.jp-AsyntaiPanel-answer')).color")
    check("dark theme gives a dark panel and light text", bg.startswith("rgb(") and sum(map(int, bg[4:-1].split(",")[:3])) < 200 and sum(map(int, fg[fg.index("(")+1:-1].split(",")[:3])) > 400, f"bg={bg} fg={fg}")
    page.screenshot(path=os.path.join(SHOTS, "04_answer_dark.png"))
    run_command(page, "apputils:change-theme", {"theme": "JupyterLab Light"})
    page.wait_for_function("() => document.body.dataset.jpThemeLight === 'true'", timeout=15000)

    # Reload: key and website persist.
    page.reload()
    page.wait_for_function("() => window.jupyterapp && window.jupyterapp.commands.hasCommand('asyntai-ai-assistant:open')", timeout=60000)
    run_command(page, "asyntai-ai-assistant:open")
    panel = page.locator("#asyntai-ai-assistant")
    page.wait_for_function("() => document.querySelectorAll('.jp-AsyntaiPanel-select option').length === 2", timeout=15000)
    check("after reload the key is kept", panel.locator(".jp-AsyntaiPanel-chat").is_visible())
    check("after reload the website is kept", panel.locator("select").input_value() == "11")

    panel.locator(".jp-AsyntaiPanel-linkButton").click()
    check("Change API key shows the key form", panel.locator(".jp-AsyntaiPanel-key").is_visible())

    check("no extension errors in the console", not errors, "; ".join(errors[:3]))
    browser.close()

passed = sum(1 for _, ok in results if ok)
print(f"\n{passed}/{len(results)} passed")
sys.exit(0 if passed == len(results) else 1)
