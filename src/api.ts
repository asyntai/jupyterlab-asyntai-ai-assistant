/**
 * Thin client for the Asyntai public API.
 *
 * Every call in the extension goes through here, so the base URL, the auth
 * header and the error wording exist in one place. It has no JupyterLab
 * dependency, so the unit tests run it with a stand-in fetch.
 */

export const DEFAULT_BASE_URL = 'https://asyntai.com';
export const API_KEY_PAGE = 'https://asyntai.com/settings/api/';
const TIMEOUT_MS = 60000;

export class AsyntaiError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = 'AsyntaiError';
    this.status = status;
  }
}

export interface IWebsite {
  id: number;
  domain: string;
  is_primary: boolean;
}

export interface IAnswer {
  answer: string;
  sessionId: string;
  disclosure: string;
}

export type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>;

/**
 * Returns a clean base URL. Anything that is not http(s) falls back to the
 * default, so a typo in the settings cannot send the key somewhere odd.
 */
export function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_BASE_URL;
  }
  const trimmed = value.trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+/i.test(trimmed) ? trimmed : DEFAULT_BASE_URL;
}

// The API answers 401 for a bad key and 403 when the plan has no API access.
// Both are settings problems, so the message names the fix.
export function errorFor(status: number, body: unknown): AsyntaiError {
  if (status === 401) {
    return new AsyntaiError(
      `Asyntai did not accept this API key. Copy it again from ${API_KEY_PAGE}`,
      status
    );
  }
  if (status === 403) {
    return new AsyntaiError(
      'The Asyntai API needs the Starter plan or higher.',
      status
    );
  }
  if (status === 429) {
    return new AsyntaiError(
      'This Asyntai account reached its monthly message limit.',
      status
    );
  }
  const text =
    body && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : '';
  return new AsyntaiError(
    text || `Asyntai answered with HTTP ${status}.`,
    status
  );
}

export class AsyntaiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(apiKey: string, baseUrl?: string, fetchImpl?: FetchLike) {
    this.apiKey = (apiKey || '').trim();
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetchImpl =
      fetchImpl ||
      ((input: string, init?: RequestInit) => fetch(input, init) as never);
  }

  /** Validates the key and returns the account. */
  account(): Promise<Record<string, unknown>> {
    return this.request('GET', '/api/v1/account/');
  }

  /** Returns the websites of the account, primary first. */
  async websites(): Promise<IWebsite[]> {
    const data = await this.request('GET', '/api/v1/websites/');
    const list = Array.isArray(data.websites)
      ? (data.websites as IWebsite[]).slice()
      : [];
    list.sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));
    return list;
  }

  /** Asks the knowledge base of one website. */
  async ask(
    question: string,
    websiteId?: number | null,
    sessionId?: string
  ): Promise<IAnswer> {
    const text = (question || '').trim();
    if (!text) {
      throw new AsyntaiError('Write a question first.');
    }
    const body: Record<string, unknown> = { message: text };
    if (websiteId) {
      body.website_id = websiteId;
    }
    if (sessionId) {
      body.session_id = sessionId;
    }
    const data = await this.request('POST', '/api/v1/chat/', body);
    return {
      answer: typeof data.response === 'string' ? data.response : '',
      sessionId:
        typeof data.session_id === 'string' && data.session_id
          ? data.session_id
          : sessionId || '',
      disclosure:
        typeof data.ai_disclosure === 'string' ? data.ai_disclosure : ''
    };
  }

  /** Adds text to the knowledge base of one website. */
  addText(
    title: string,
    content: string,
    websiteId?: number | null
  ): Promise<Record<string, unknown>> {
    const cleanTitle = (title || '').trim();
    const cleanContent = (content || '').trim();
    if (!cleanTitle) {
      return Promise.reject(new AsyntaiError('Give the document a title.'));
    }
    if (cleanContent.length < 10) {
      return Promise.reject(
        new AsyntaiError(
          'There is not enough text. Add at least 10 characters.'
        )
      );
    }
    const body: Record<string, unknown> = {
      title: cleanTitle.slice(0, 200),
      content: cleanContent
    };
    if (websiteId) {
      body.website_id = websiteId;
    }
    return this.request('POST', '/api/v1/knowledge/text/', body);
  }

  private async request(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<Record<string, any>> {
    if (!this.apiKey) {
      throw new AsyntaiError('Enter your Asyntai API key first.');
    }
    const controller =
      typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), TIMEOUT_MS)
      : null;
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    };
    if (body) {
      init.body = JSON.stringify(body);
    }
    if (controller) {
      init.signal = controller.signal;
    }

    let response: Pick<Response, 'ok' | 'status' | 'text'>;
    try {
      response = await this.fetchImpl(this.baseUrl + path, init);
    } catch (err) {
      if (timer) {
        clearTimeout(timer);
      }
      if (err && (err as Error).name === 'AbortError') {
        throw new AsyntaiError('Asyntai did not answer in time. Try again.');
      }
      throw new AsyntaiError(
        'The extension could not reach Asyntai. Check the internet connection.'
      );
    }

    try {
      const raw = await response.text();
      let data: unknown = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }
      if (!response.ok) {
        throw errorFor(response.status, data);
      }
      if (!data || typeof data !== 'object') {
        throw new AsyntaiError(
          'Asyntai sent a response the extension cannot read.'
        );
      }
      // A 200 can still carry success=false, so the body decides too.
      const record = data as Record<string, any>;
      if (record.success === false) {
        throw new AsyntaiError(record.error || 'Asyntai reported a failure.');
      }
      return record;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
