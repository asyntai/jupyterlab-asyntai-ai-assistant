import {
  AsyntaiClient,
  AsyntaiError,
  DEFAULT_BASE_URL,
  FetchLike,
  normalizeBaseUrl
} from '../api';

interface ICall {
  url: string;
  init: RequestInit;
}

function fakeFetch(
  status: number,
  body: unknown,
  calls: ICall[] = []
): FetchLike {
  return async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init || {} });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
    };
  };
}

describe('normalizeBaseUrl', () => {
  it('keeps a valid https address and drops the trailing slash', () => {
    expect(normalizeBaseUrl('https://example.test/')).toBe(
      'https://example.test'
    );
  });
  it('accepts http for a local test API', () => {
    expect(normalizeBaseUrl('http://127.0.0.1:8096')).toBe(
      'http://127.0.0.1:8096'
    );
  });
  it('falls back to the default for bad values', () => {
    expect(normalizeBaseUrl('')).toBe(DEFAULT_BASE_URL);
    expect(normalizeBaseUrl('javascript:alert(1)')).toBe(DEFAULT_BASE_URL);
    expect(normalizeBaseUrl('asyntai.com')).toBe(DEFAULT_BASE_URL);
    expect(normalizeBaseUrl(undefined)).toBe(DEFAULT_BASE_URL);
    expect(normalizeBaseUrl(42)).toBe(DEFAULT_BASE_URL);
  });
});

describe('AsyntaiClient.ask', () => {
  it('sends the question with the key, website and session', async () => {
    const calls: ICall[] = [];
    const client = new AsyntaiClient(
      ' key123 ',
      'https://api.test',
      fakeFetch(
        200,
        { success: true, response: 'Hi', session_id: 's-2' },
        calls
      )
    );
    const result = await client.ask('  What is it?  ', 7, 's-1');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.test/api/v1/chat/');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer key123');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      message: 'What is it?',
      website_id: 7,
      session_id: 's-1'
    });
    expect(result).toEqual({ answer: 'Hi', sessionId: 's-2', disclosure: '' });
  });

  it('leaves out an empty website and session', async () => {
    const calls: ICall[] = [];
    const client = new AsyntaiClient(
      'k',
      undefined,
      fakeFetch(200, { success: true, response: 'A' }, calls)
    );
    const result = await client.ask('Q', null, '');
    expect(calls[0].url).toBe('https://asyntai.com/api/v1/chat/');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ message: 'Q' });
    expect(result.sessionId).toBe('');
  });

  it('keeps the old session when the API sends none', async () => {
    const client = new AsyntaiClient(
      'k',
      undefined,
      fakeFetch(200, { response: 'A' })
    );
    expect((await client.ask('Q', null, 'old')).sessionId).toBe('old');
  });

  it('returns the AI disclosure when the API sends one', async () => {
    const client = new AsyntaiClient(
      'k',
      undefined,
      fakeFetch(200, { response: 'A', ai_disclosure: 'AI answer.' })
    );
    expect((await client.ask('Q')).disclosure).toBe('AI answer.');
  });

  it('refuses an empty question without a request', async () => {
    const calls: ICall[] = [];
    const client = new AsyntaiClient('k', undefined, fakeFetch(200, {}, calls));
    await expect(client.ask('   ')).rejects.toThrow('Write a question first.');
    expect(calls).toHaveLength(0);
  });

  it('refuses to send without a key', async () => {
    const calls: ICall[] = [];
    const client = new AsyntaiClient('', undefined, fakeFetch(200, {}, calls));
    await expect(client.ask('Q')).rejects.toThrow(
      'Enter your Asyntai API key first.'
    );
    expect(calls).toHaveLength(0);
  });
});

describe('AsyntaiClient errors', () => {
  const cases: Array<[number, string]> = [
    [401, 'did not accept this API key'],
    [403, 'needs the Starter plan'],
    [429, 'monthly message limit']
  ];
  it.each(cases)('maps HTTP %i to a clear message', async (status, text) => {
    const client = new AsyntaiClient(
      'k',
      undefined,
      fakeFetch(status, { error: 'x' })
    );
    const error = await client.ask('Q').catch(e => e);
    expect(error).toBeInstanceOf(AsyntaiError);
    expect(error.message).toContain(text);
    expect(error.status).toBe(status);
  });

  it('uses the API error text for other codes', async () => {
    const client = new AsyntaiClient(
      'k',
      undefined,
      fakeFetch(400, { error: 'Website not found' })
    );
    await expect(client.ask('Q')).rejects.toThrow('Website not found');
  });

  it('names the HTTP code when the body has no error', async () => {
    const client = new AsyntaiClient(
      'k',
      undefined,
      fakeFetch(502, '<html>bad gateway</html>')
    );
    await expect(client.ask('Q')).rejects.toThrow('HTTP 502');
  });

  it('treats success=false on a 200 as a failure', async () => {
    const client = new AsyntaiClient(
      'k',
      undefined,
      fakeFetch(200, { success: false, error: 'Limit reached' })
    );
    await expect(client.ask('Q')).rejects.toThrow('Limit reached');
  });

  it('rejects a 200 that is not JSON', async () => {
    const client = new AsyntaiClient(
      'k',
      undefined,
      fakeFetch(200, 'not json')
    );
    await expect(client.ask('Q')).rejects.toThrow('cannot read');
  });

  it('reports a network failure', async () => {
    const failing: FetchLike = async () => {
      throw new TypeError('Failed to fetch');
    };
    const client = new AsyntaiClient('k', undefined, failing);
    await expect(client.ask('Q')).rejects.toThrow('could not reach Asyntai');
  });

  it('reports a timeout', async () => {
    const aborting: FetchLike = async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    };
    const client = new AsyntaiClient('k', undefined, aborting);
    await expect(client.ask('Q')).rejects.toThrow('did not answer in time');
  });
});

describe('AsyntaiClient.websites', () => {
  it('puts the primary website first', async () => {
    const client = new AsyntaiClient(
      'k',
      undefined,
      fakeFetch(200, {
        success: true,
        websites: [
          { id: 1, domain: 'a.test', is_primary: false },
          { id: 2, domain: 'b.test', is_primary: true }
        ]
      })
    );
    const list = await client.websites();
    expect(list.map(site => site.id)).toEqual([2, 1]);
  });

  it('returns an empty list when the API sends none', async () => {
    const client = new AsyntaiClient(
      'k',
      undefined,
      fakeFetch(200, { success: true })
    );
    expect(await client.websites()).toEqual([]);
  });
});

describe('AsyntaiClient.addText', () => {
  it('sends the title, content and website', async () => {
    const calls: ICall[] = [];
    const client = new AsyntaiClient(
      'k',
      undefined,
      fakeFetch(201, { success: true }, calls)
    );
    await client.addText(' Notes ', ' Some long enough text ', 3);
    expect(calls[0].url).toBe('https://asyntai.com/api/v1/knowledge/text/');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      title: 'Notes',
      content: 'Some long enough text',
      website_id: 3
    });
  });

  it('cuts the title at 200 characters', async () => {
    const calls: ICall[] = [];
    const client = new AsyntaiClient(
      'k',
      undefined,
      fakeFetch(201, { success: true }, calls)
    );
    await client.addText('x'.repeat(300), 'Some long enough text');
    expect(JSON.parse(calls[0].init.body as string).title).toHaveLength(200);
  });

  it('refuses short content and an empty title', async () => {
    const calls: ICall[] = [];
    const client = new AsyntaiClient('k', undefined, fakeFetch(201, {}, calls));
    await expect(client.addText('T', 'short')).rejects.toThrow(
      'not enough text'
    );
    await expect(client.addText(' ', 'Some long enough text')).rejects.toThrow(
      'title'
    );
    expect(calls).toHaveLength(0);
  });
});

describe('AsyntaiClient.account', () => {
  it('calls the account endpoint with GET and no body', async () => {
    const calls: ICall[] = [];
    const client = new AsyntaiClient(
      'k',
      undefined,
      fakeFetch(200, { success: true }, calls)
    );
    await client.account();
    expect(calls[0].url).toBe('https://asyntai.com/api/v1/account/');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.body).toBeUndefined();
  });
});
