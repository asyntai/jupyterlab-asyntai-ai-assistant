# Browser test

`e2e.py` runs the installed extension in a real JupyterLab and real Chrome
(Playwright, `channel="chrome"`), against `mock_api.py`. No AI call is made.

1. Build the wheel and install it with JupyterLab in a clean venv:

   ```bash
   python -m build --outdir dist .
   pip install jupyterlab playwright dist/*.whl
   ```

2. Start the stand-in API (it logs every request to `test/requests.jsonl`):

   ```bash
   python test/mock_api.py 8898
   ```

3. Start JupyterLab with its own settings folder. `e2e.py` writes the
   extension settings (`apiBaseUrl = http://127.0.0.1:8898`) into it.
   Also put `{"fetchNews": "false", "checkForUpdates": false}` in
   `<settings>/@jupyterlab/apputils-extension/notification.jupyterlab-settings`,
   or the news pop-up covers the Ask button.

   ```bash
   JUPYTERLAB_SETTINGS_DIR=<settings> jupyter lab --no-browser --port 8897 \
     --IdentityProvider.token= --ServerApp.password= \
     --LabApp.expose_app_in_browser=True
   ```

   Run it from `<work>`. `e2e.py` writes `Q3_sales.ipynb` there.

4. Run the test:

   ```bash
   python test/e2e.py <settings> <work> <screenshot-folder>
   ```

It checks 48 things: the key form (empty, 401, 403, good key), website list,
questions and follow-ups (session id), Markdown rendering and sanitizing,
links in a new tab, the AI disclosure, insert in notebook, copy, the cell
context menu, add notebook (confirm and cancel), the palette, new
conversation, the dark theme, and that the key and website survive a reload.
