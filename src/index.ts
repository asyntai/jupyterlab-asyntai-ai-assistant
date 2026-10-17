import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import {
  Dialog,
  ICommandPalette,
  Notification,
  showDialog
} from '@jupyterlab/apputils';
import { MarkdownCell } from '@jupyterlab/cells';
import { CodeEditor } from '@jupyterlab/codeeditor';
import { IEditorTracker } from '@jupyterlab/fileeditor';
import { INotebookTracker, NotebookActions } from '@jupyterlab/notebook';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { LabIcon } from '@jupyterlab/ui-components';
import { Widget } from '@lumino/widgets';

import { AsyntaiClient, DEFAULT_BASE_URL, normalizeBaseUrl } from './api';
import { AssistantPanel, IAssistantSettings } from './panel';
import { notebookToText, titleFromPath } from './text';

const PLUGIN_ID = 'jupyterlab-asyntai-ai-assistant:plugin';
const CATEGORY = 'Asyntai AI Assistant';

namespace CommandIDs {
  export const open = 'asyntai-ai-assistant:open';
  export const askSelection = 'asyntai-ai-assistant:ask-selection';
  export const addNotebook = 'asyntai-ai-assistant:add-notebook';
  export const newConversation = 'asyntai-ai-assistant:new-conversation';
}

const assistantIcon = new LabIcon({
  name: 'asyntai-ai-assistant:icon',
  svgstr:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">' +
    '<path class="jp-icon3" fill="#616161" fill-rule="evenodd" d="M9 5h6a4 4 0 0 1 4 4v3.3a4 4 0 0 1-4 4h-4.1L7.2 19.2v-3A4 4 0 0 1 5 12.6V9a4 4 0 0 1 4-4zm3.1 3.4c-1.6 0-2.8 1.3-2.8 2.9s1.1 2.9 2.6 2.9c.8 0 1.4-.3 1.8-.9v.7h1.4V8.6h-1.4v.7c-.4-.6-1-.9-1.6-.9zm.2 1.3c.9 0 1.5.7 1.5 1.6s-.6 1.6-1.5 1.6-1.5-.7-1.5-1.6.6-1.6 1.5-1.6z"/>' +
    '</svg>'
});

function readSettings(
  settings: ISettingRegistry.ISettings | null
): IAssistantSettings {
  if (!settings) {
    return { apiKey: '', websiteId: null, baseUrl: DEFAULT_BASE_URL };
  }
  const key = settings.get('apiKey').composite;
  const website = settings.get('websiteId').composite;
  return {
    apiKey: typeof key === 'string' ? key.trim() : '',
    websiteId: typeof website === 'number' && website > 0 ? website : null,
    baseUrl: normalizeBaseUrl(settings.get('apiBaseUrl').composite)
  };
}

/** Returns the selected text in an editor, or an empty string. */
function selectedText(editor: CodeEditor.IEditor | null | undefined): string {
  if (!editor) {
    return '';
  }
  const selection = editor.getSelection();
  const start = editor.getOffsetAt(selection.start);
  const end = editor.getOffsetAt(selection.end);
  const source = editor.model.sharedModel.getSource();
  return source.slice(Math.min(start, end), Math.max(start, end));
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  description: 'Ask your Asyntai knowledge base from a JupyterLab side panel.',
  autoStart: true,
  requires: [IRenderMimeRegistry, ISettingRegistry],
  optional: [ICommandPalette, INotebookTracker, IEditorTracker],
  activate: async (
    app: JupyterFrontEnd,
    rendermime: IRenderMimeRegistry,
    settingRegistry: ISettingRegistry,
    palette: ICommandPalette | null,
    notebooks: INotebookTracker | null,
    editors: IEditorTracker | null
  ) => {
    let settings: ISettingRegistry.ISettings | null = null;
    try {
      settings = await settingRegistry.load(PLUGIN_ID);
    } catch (reason) {
      console.error(
        'Asyntai AI Assistant could not load its settings.',
        reason
      );
    }

    const insertAnswer = (markdown: string): boolean => {
      const current = notebooks?.currentWidget;
      if (!current) {
        return false;
      }
      const notebook = current.content;
      if (!notebook.model) {
        return false;
      }
      NotebookActions.insertBelow(notebook);
      NotebookActions.changeCellType(notebook, 'markdown');
      const cell = notebook.activeCell;
      if (!cell) {
        return false;
      }
      cell.model.sharedModel.setSource(markdown);
      if (cell instanceof MarkdownCell) {
        cell.rendered = true;
      }
      return true;
    };

    const panel = new AssistantPanel({
      rendermime,
      getSettings: () => readSettings(settings),
      saveApiKey: async key => {
        if (settings) {
          await settings.set('apiKey', key);
        }
      },
      saveWebsiteId: async id => {
        if (settings) {
          await settings.set('websiteId', id);
        }
      },
      insertAnswer
    });
    panel.title.icon = assistantIcon;
    app.shell.add(panel, 'right', { rank: 900 });
    settings?.changed.connect(() => panel.refresh());

    const openPanel = () => app.shell.activateById(panel.id);

    app.commands.addCommand(CommandIDs.open, {
      label: 'Open Asyntai AI Assistant',
      caption: 'Ask your Asyntai knowledge base',
      icon: assistantIcon,
      execute: openPanel
    });

    app.commands.addCommand(CommandIDs.newConversation, {
      label: 'New Asyntai conversation',
      execute: () => {
        panel.newConversation();
        openPanel();
      }
    });

    app.commands.addCommand(CommandIDs.askSelection, {
      label: 'Ask Asyntai about the selection',
      caption: 'Put the selected text in the Asyntai AI Assistant question box',
      icon: assistantIcon,
      execute: args => {
        let text = '';
        const notebook = notebooks?.currentWidget;
        const editor = editors?.currentWidget;
        const shellCurrent = app.shell.currentWidget;
        // From the cell context menu, use the cell under the mouse. The
        // active cell can be another one.
        let cell = notebook?.content.activeCell ?? null;
        if (args.fromContextMenu && notebook) {
          const hit = app.contextMenuHitTest(node =>
            node.classList.contains('jp-Cell')
          );
          const clicked = hit
            ? notebook.content.widgets.find(widget => widget.node === hit)
            : undefined;
          if (clicked) {
            cell = clicked;
          }
        }
        if (editor && shellCurrent === editor) {
          text = selectedText(editor.content.editor);
        } else if (cell) {
          text =
            selectedText(cell.editor) || cell.model.sharedModel.getSource();
        }
        openPanel();
        panel.setQuestion(text);
      }
    });

    app.commands.addCommand(CommandIDs.addNotebook, {
      label: 'Add this notebook to the Asyntai knowledge base',
      caption:
        'Send the text and code of the notebook to your Asyntai knowledge base',
      isEnabled: () => !!notebooks?.currentWidget,
      execute: async () => {
        const current = notebooks?.currentWidget;
        if (!current || !current.content.model) {
          return;
        }
        const options = readSettings(settings);
        if (!options.apiKey) {
          openPanel();
          return;
        }
        const model = current.content.model;
        const cells = Array.from(model.cells).map(cell => ({
          type: cell.type,
          source: cell.sharedModel.getSource()
        }));
        const languageInfo = model.getMetadata('language_info') as
          { name?: string } | undefined;
        const text = notebookToText(cells, languageInfo?.name || '');
        const title = titleFromPath(current.context.path);

        const body = new Widget();
        body.node.textContent =
          `Asyntai adds the text and code of "${title}" to the knowledge base ` +
          'of the website in the Asyntai panel. Your assistant can then answer from it.';
        const choice = await showDialog({
          title: 'Add notebook to Asyntai',
          body,
          buttons: [Dialog.cancelButton(), Dialog.okButton({ label: 'Add' })]
        });
        if (!choice.button.accept) {
          return;
        }
        try {
          await new AsyntaiClient(options.apiKey, options.baseUrl).addText(
            title,
            text,
            panel.websiteId ?? options.websiteId
          );
          Notification.success(
            `"${title}" is in your Asyntai knowledge base.`,
            {
              autoClose: 5000
            }
          );
        } catch (err) {
          Notification.error((err as Error).message, { autoClose: 8000 });
        }
      }
    });

    if (palette) {
      for (const command of [
        CommandIDs.open,
        CommandIDs.askSelection,
        CommandIDs.addNotebook,
        CommandIDs.newConversation
      ]) {
        palette.addItem({ command, category: CATEGORY });
      }
    }

    app.contextMenu.addItem({
      command: CommandIDs.askSelection,
      args: { fromContextMenu: true },
      selector: '.jp-Notebook .jp-Cell',
      rank: 50
    });
    app.contextMenu.addItem({
      command: CommandIDs.askSelection,
      selector: '.jp-FileEditor',
      rank: 50
    });
  }
};

export default plugin;
