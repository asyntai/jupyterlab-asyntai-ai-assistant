import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { DisposableSet } from '@lumino/disposable';
import { Widget } from '@lumino/widgets';

import { API_KEY_PAGE, AsyntaiClient, AsyntaiError, IWebsite } from './api';
import { newSessionId } from './text';

export interface IAssistantSettings {
  apiKey: string;
  websiteId: number | null;
  baseUrl: string;
}

export interface IAssistantPanelOptions {
  rendermime: IRenderMimeRegistry;
  getSettings: () => IAssistantSettings;
  saveApiKey: (key: string) => Promise<void>;
  saveWebsiteId: (id: number | null) => Promise<void>;
  /** Inserts markdown below the active notebook cell. False if no notebook. */
  insertAnswer: (markdown: string) => boolean;
}

/**
 * The side panel: an API key form, a website picker and a conversation with
 * the knowledge base. Plain DOM, so it has no React dependency.
 */
export class AssistantPanel extends Widget {
  private readonly options: IAssistantPanelOptions;
  private sessionId = newSessionId();
  private websites: IWebsite[] = [];
  private busy = false;
  private loadedForKey: string | null = null;
  private renderers = new DisposableSet();

  private readonly keyView: HTMLElement;
  private readonly keyInput: HTMLInputElement;
  private readonly keyStatus: HTMLElement;
  private readonly chatView: HTMLElement;
  private readonly websiteSelect: HTMLSelectElement;
  private readonly messages: HTMLElement;
  private readonly disclosure: HTMLElement;
  private readonly questionInput: HTMLTextAreaElement;
  private readonly askButton: HTMLButtonElement;
  private readonly status: HTMLElement;

  constructor(options: IAssistantPanelOptions) {
    super();
    this.options = options;
    this.id = 'asyntai-ai-assistant';
    this.addClass('jp-AsyntaiPanel');
    this.title.caption = 'Asyntai AI Assistant';

    const node = this.node;

    const header = el('div', 'jp-AsyntaiPanel-header');
    header.appendChild(
      el('h2', 'jp-AsyntaiPanel-title', 'Asyntai AI Assistant')
    );
    node.appendChild(header);

    // API key view.
    this.keyView = el('div', 'jp-AsyntaiPanel-key');
    const intro = el('p', 'jp-AsyntaiPanel-text');
    intro.appendChild(
      document.createTextNode(
        'Ask your Asyntai knowledge base from JupyterLab. Paste an API key from '
      )
    );
    const link = el('a', '', 'asyntai.com/settings/api') as HTMLAnchorElement;
    link.href = API_KEY_PAGE;
    link.target = '_blank';
    link.rel = 'noopener';
    intro.appendChild(link);
    intro.appendChild(document.createTextNode('.'));
    this.keyView.appendChild(intro);

    this.keyInput = el('input', 'jp-AsyntaiPanel-input') as HTMLInputElement;
    this.keyInput.type = 'password';
    this.keyInput.placeholder = 'API key';
    this.keyInput.autocomplete = 'off';
    this.keyInput.setAttribute('aria-label', 'Asyntai API key');
    this.keyView.appendChild(this.keyInput);

    const saveKey = button('Save key', 'jp-mod-accept');
    saveKey.addEventListener('click', () => void this.onSaveKey());
    this.keyInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void this.onSaveKey();
      }
    });
    this.keyView.appendChild(saveKey);
    this.keyStatus = el('p', 'jp-AsyntaiPanel-status');
    this.keyView.appendChild(this.keyStatus);
    node.appendChild(this.keyView);

    // Conversation view.
    this.chatView = el('div', 'jp-AsyntaiPanel-chat');

    const toolbar = el('div', 'jp-AsyntaiPanel-toolbar');
    const label = el('label', 'jp-AsyntaiPanel-label', 'Knowledge base');
    this.websiteSelect = el(
      'select',
      'jp-AsyntaiPanel-select'
    ) as HTMLSelectElement;
    this.websiteSelect.id = 'jp-AsyntaiPanel-website';
    label.setAttribute('for', this.websiteSelect.id);
    this.websiteSelect.addEventListener('change', () => {
      const id = Number(this.websiteSelect.value) || null;
      this.newConversation();
      void this.options.saveWebsiteId(id);
    });
    toolbar.appendChild(label);
    toolbar.appendChild(this.websiteSelect);
    const reset = button('New conversation');
    reset.addEventListener('click', () => this.newConversation());
    toolbar.appendChild(reset);
    this.chatView.appendChild(toolbar);

    this.messages = el('div', 'jp-AsyntaiPanel-messages');
    this.messages.setAttribute('aria-live', 'polite');
    this.chatView.appendChild(this.messages);

    this.disclosure = el('p', 'jp-AsyntaiPanel-disclosure');
    this.chatView.appendChild(this.disclosure);

    const form = el('div', 'jp-AsyntaiPanel-form');
    this.questionInput = el(
      'textarea',
      'jp-AsyntaiPanel-question'
    ) as HTMLTextAreaElement;
    this.questionInput.rows = 3;
    this.questionInput.placeholder =
      'Ask a question. Press Enter to send, Shift+Enter for a new line.';
    this.questionInput.setAttribute('aria-label', 'Question');
    this.questionInput.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void this.ask(this.questionInput.value);
      }
    });
    form.appendChild(this.questionInput);
    this.askButton = button('Ask', 'jp-mod-accept');
    this.askButton.addEventListener(
      'click',
      () => void this.ask(this.questionInput.value)
    );
    form.appendChild(this.askButton);
    this.chatView.appendChild(form);

    this.status = el('p', 'jp-AsyntaiPanel-status');
    this.chatView.appendChild(this.status);

    const changeKey = el(
      'button',
      'jp-AsyntaiPanel-linkButton',
      'Change API key'
    ) as HTMLButtonElement;
    changeKey.type = 'button';
    changeKey.addEventListener('click', () => this.showKeyView(''));
    this.chatView.appendChild(changeKey);

    node.appendChild(this.chatView);
    this.refresh();
  }

  /** Re-reads the settings. Called at start and when the settings change. */
  refresh(): void {
    const { apiKey } = this.options.getSettings();
    if (!apiKey) {
      this.loadedForKey = null;
      this.showKeyView('');
      return;
    }
    this.keyView.hidden = true;
    this.chatView.hidden = false;
    if (this.loadedForKey !== apiKey) {
      this.loadedForKey = apiKey;
      void this.loadWebsites();
    } else {
      this.selectSavedWebsite();
    }
  }

  /** Starts a new conversation with an empty history. */
  newConversation(): void {
    this.sessionId = newSessionId();
    this.renderers.dispose();
    this.renderers = new DisposableSet();
    this.messages.textContent = '';
    this.disclosure.textContent = '';
    this.setStatus('');
  }

  /** Puts a question in the box and sends it. */
  async ask(question: string): Promise<void> {
    const text = (question || '').trim();
    if (!text || this.busy) {
      return;
    }
    const settings = this.options.getSettings();
    if (!settings.apiKey) {
      this.showKeyView('Enter your Asyntai API key first.');
      return;
    }

    this.busy = true;
    this.askButton.disabled = true;
    this.questionInput.value = '';
    this.addMessage('question', text);
    this.setStatus('Asyntai is writing an answer.');

    try {
      const client = new AsyntaiClient(settings.apiKey, settings.baseUrl);
      const result = await client.ask(
        text,
        this.currentWebsiteId(),
        this.sessionId
      );
      if (result.sessionId) {
        this.sessionId = result.sessionId;
      }
      if (result.disclosure) {
        this.disclosure.textContent = result.disclosure;
      }
      await this.addAnswer(result.answer || 'Asyntai sent an empty answer.');
      this.setStatus('');
    } catch (err) {
      this.setStatus(messageOf(err), true);
      this.questionInput.value = text;
    } finally {
      this.busy = false;
      this.askButton.disabled = false;
      this.questionInput.focus();
    }
  }

  /** Puts text in the question box, so the user can add to it and send. */
  setQuestion(text: string): void {
    if (!this.options.getSettings().apiKey) {
      this.showKeyView('Enter your Asyntai API key first.');
      return;
    }
    const clean = (text || '').trim();
    if (clean) {
      this.questionInput.value = clean.includes('\n')
        ? 'Explain this:\n\n' + clean
        : clean;
    }
    this.questionInput.focus();
    const end = this.questionInput.value.length;
    this.questionInput.setSelectionRange(end, end);
  }

  /** The website that the panel asks, or null before the list loads. */
  get websiteId(): number | null {
    return this.currentWebsiteId();
  }

  get isBusy(): boolean {
    return this.busy;
  }

  private showKeyView(message: string): void {
    this.chatView.hidden = true;
    this.keyView.hidden = false;
    this.keyInput.value = '';
    this.keyStatus.textContent = message;
    this.keyStatus.classList.toggle('jp-mod-error', !!message);
  }

  private async onSaveKey(): Promise<void> {
    const key = this.keyInput.value.trim();
    if (!key) {
      this.keyStatus.textContent = 'Paste your API key first.';
      this.keyStatus.classList.add('jp-mod-error');
      return;
    }
    this.keyStatus.classList.remove('jp-mod-error');
    this.keyStatus.textContent = 'Checking the key.';
    try {
      const { baseUrl } = this.options.getSettings();
      await new AsyntaiClient(key, baseUrl).account();
    } catch (err) {
      this.keyStatus.textContent = messageOf(err);
      this.keyStatus.classList.add('jp-mod-error');
      return;
    }
    this.keyStatus.textContent = '';
    await this.options.saveApiKey(key);
    this.refresh();
  }

  private async loadWebsites(): Promise<void> {
    const settings = this.options.getSettings();
    this.websiteSelect.textContent = '';
    this.websiteSelect.disabled = true;
    this.setStatus('Loading your websites.');
    try {
      const client = new AsyntaiClient(settings.apiKey, settings.baseUrl);
      this.websites = await client.websites();
    } catch (err) {
      this.websites = [];
      this.loadedForKey = null;
      this.setStatus(messageOf(err), true);
      return;
    }
    for (const site of this.websites) {
      const option = document.createElement('option');
      option.value = String(site.id);
      option.textContent = site.domain || `Website ${site.id}`;
      this.websiteSelect.appendChild(option);
    }
    this.websiteSelect.disabled = this.websites.length < 2;
    this.selectSavedWebsite();
    this.setStatus(
      this.websites.length
        ? ''
        : 'This account has no website yet. Add one at asyntai.com.',
      !this.websites.length
    );
  }

  private selectSavedWebsite(): void {
    const saved = this.options.getSettings().websiteId;
    if (saved && this.websites.some(site => site.id === saved)) {
      this.websiteSelect.value = String(saved);
    } else if (this.websites.length) {
      this.websiteSelect.value = String(this.websites[0].id);
    }
  }

  private currentWebsiteId(): number | null {
    return Number(this.websiteSelect.value) || null;
  }

  private addMessage(kind: 'question' | 'answer', text: string): HTMLElement {
    const item = el('div', `jp-AsyntaiPanel-message jp-mod-${kind}`);
    if (kind === 'question') {
      item.textContent = text;
    }
    this.messages.appendChild(item);
    this.messages.scrollTop = this.messages.scrollHeight;
    return item;
  }

  private async addAnswer(markdown: string): Promise<void> {
    const item = this.addMessage('answer', '');
    const body = el('div', 'jp-AsyntaiPanel-answer');
    item.appendChild(body);

    const rendermime = this.options.rendermime;
    try {
      const renderer = rendermime.createRenderer('text/markdown');
      this.renderers.add(renderer);
      const model = rendermime.createModel({
        data: { 'text/markdown': markdown },
        trusted: false
      });
      await renderer.renderModel(model);
      body.appendChild(renderer.node);
    } catch {
      body.textContent = markdown;
    }
    // Links in an answer open in a new browser tab, not inside JupyterLab.
    body.querySelectorAll('a[href^="http"]').forEach(anchor => {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener');
    });

    const actions = el('div', 'jp-AsyntaiPanel-actions');
    const insert = button('Insert in notebook');
    insert.addEventListener('click', () => {
      const done = this.options.insertAnswer(markdown);
      this.setStatus(
        done
          ? 'The answer is in a new Markdown cell.'
          : 'Open a notebook first, then insert the answer.',
        !done
      );
    });
    const copy = button('Copy');
    copy.addEventListener('click', () => {
      void copyText(markdown).then(ok =>
        this.setStatus(
          ok ? 'The answer is copied.' : 'The browser did not allow the copy.',
          !ok
        )
      );
    });
    actions.appendChild(insert);
    actions.appendChild(copy);
    item.appendChild(actions);
    this.messages.scrollTop = this.messages.scrollHeight;
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.renderers.dispose();
    super.dispose();
  }

  setStatus(message: string, isError = false): void {
    this.status.textContent = message;
    this.status.classList.toggle('jp-mod-error', isError && !!message);
  }
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text) {
    node.textContent = text;
  }
  return node;
}

function button(text: string, extraClass = ''): HTMLButtonElement {
  const node = el(
    'button',
    `jp-mod-styled jp-AsyntaiPanel-button ${extraClass}`.trim(),
    text
  ) as HTMLButtonElement;
  node.type = 'button';
  return node;
}

function messageOf(err: unknown): string {
  if (err instanceof AsyntaiError || err instanceof Error) {
    return err.message;
  }
  return 'Something went wrong. Try again.';
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
