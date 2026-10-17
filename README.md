# Asyntai AI Assistant for JupyterLab

Ask your [Asyntai](https://asyntai.com) knowledge base from a JupyterLab side
panel. Your team gets answers about your data, metrics, guides and processes
without leaving the notebook, in more than 80 languages.

## Features

- **Ask from the side panel.** Each conversation keeps its history, so
  follow-up questions work.
- **Insert in notebook.** Put any answer in a new Markdown cell below the
  active cell.
- **Ask about the selection.** Right-click a cell or a file and send the
  selected code or text to the panel.
- **Add a notebook to the knowledge base.** Send the text and code of a
  notebook to Asyntai, so the assistant can answer from it.
- **Pick the knowledge base.** If your account has more than one website,
  choose which one the panel asks.
- Works with the light, dark and high-contrast themes.

## Requirements

- JupyterLab 4
- Python 3.10 or later
- An Asyntai account on the Starter plan or higher, because the extension uses
  the Asyntai API

## Install

```bash
pip install jupyterlab-asyntai-ai-assistant
```

You can also open the **Extension Manager** in JupyterLab, search for
**Asyntai** and click **Install**. Restart JupyterLab after the install.

## Set up

1. Sign in to Asyntai and copy your API key from
   [Settings → API](https://asyntai.com/settings/api/).
2. Click the Asyntai icon in the right sidebar of JupyterLab.
3. Paste the key and click **Save key**. The extension checks the key and
   remembers it.
4. Write a question and press **Enter**. Press **Shift+Enter** for a new line.

## Commands

Open the Command Palette (`Ctrl+Shift+C`, or `Cmd+Shift+C` on macOS) and type
**Asyntai**:

| Command                                         | What it does                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| Open Asyntai AI Assistant                       | Opens the side panel                                                   |
| Ask Asyntai about the selection                 | Puts the selected text, or the cell, in the question box               |
| Add this notebook to the Asyntai knowledge base | Sends the Markdown and code of the open notebook to the knowledge base |
| New Asyntai conversation                        | Starts a new conversation with an empty history                        |

## Settings

Open **Settings → Settings Editor → Asyntai AI Assistant**:

| Setting      | What it does                                                           |
| ------------ | ---------------------------------------------------------------------- |
| `apiKey`     | Your Asyntai API key. The panel fills it in when you click Save key    |
| `websiteId`  | The website whose knowledge base the panel asks. The panel fills it in |
| `apiBaseUrl` | The address of the Asyntai API. Keep the default                       |

## Documentation

Full guide: [asyntai.com/documentation/integrations/jupyterlab](https://asyntai.com/documentation/integrations/jupyterlab/)

## Uninstall

```bash
pip uninstall jupyterlab-asyntai-ai-assistant
```

## Support

Email [hello@asyntai.com](mailto:hello@asyntai.com).

## Development

```bash
pip install "jupyterlab>=4" "jupyter-builder>=1.2,<2"
jlpm install
jlpm build
pip install -e .
jupyter labextension develop . --overwrite
jlpm jest          # unit tests
```

The browser test in `test/` runs the installed extension in a real JupyterLab
against a stand-in API. See [test/README.md](https://github.com/asyntai/jupyterlab-asyntai-ai-assistant/blob/main/test/README.md).

## License

MIT
