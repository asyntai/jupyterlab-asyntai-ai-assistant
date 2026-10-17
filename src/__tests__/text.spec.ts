import { newSessionId, notebookToText, titleFromPath } from '../text';

describe('notebookToText', () => {
  it('keeps Markdown, fences code and drops empty cells', () => {
    const text = notebookToText(
      [
        { type: 'markdown', source: '# Sales report\n' },
        { type: 'code', source: 'df = load()\n\n' },
        { type: 'code', source: '   ' },
        { type: 'raw', source: 'Raw note' }
      ],
      'python'
    );
    expect(text).toBe(
      '# Sales report\n\n```python\ndf = load()\n```\n\nRaw note'
    );
  });

  it('returns an empty string for an empty notebook', () => {
    expect(notebookToText([])).toBe('');
  });
});

describe('titleFromPath', () => {
  it('uses the file name without folder and extension', () => {
    expect(titleFromPath('reports/2026/Q3 sales.ipynb')).toBe('Q3 sales');
  });
  it('has a fallback for an empty name', () => {
    expect(titleFromPath('')).toBe('Untitled notebook');
  });
});

describe('newSessionId', () => {
  it('starts with jupyterlab- and is different each time', () => {
    const a = newSessionId();
    const b = newSessionId();
    expect(a.startsWith('jupyterlab-')).toBe(true);
    expect(a).not.toBe(b);
  });
});
