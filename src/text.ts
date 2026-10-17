/**
 * Pure text helpers. They have no JupyterLab dependency, so the unit tests
 * cover them directly.
 */

export interface ICellText {
  type: string;
  source: string;
}

/**
 * Turns notebook cells into one plain-text document for the knowledge base.
 * Markdown and raw cells keep their text. Code cells go in fenced blocks, so
 * the answers can quote them as code. Empty cells are dropped.
 */
export function notebookToText(cells: ICellText[], language = ''): string {
  const parts: string[] = [];
  for (const cell of cells) {
    const source = (cell.source || '').replace(/\s+$/, '');
    if (!source.trim()) {
      continue;
    }
    if (cell.type === 'code') {
      parts.push('```' + language + '\n' + source + '\n```');
    } else {
      parts.push(source);
    }
  }
  return parts.join('\n\n');
}

/** Uses the file name without its folder and extension as the title. */
export function titleFromPath(path: string): string {
  const name = (path || '').split('/').pop() || '';
  const stem = name.replace(/\.[^.]+$/, '').trim();
  return stem || 'Untitled notebook';
}

/** Returns a new random session id, so each conversation keeps its history. */
export function newSessionId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `jupyterlab-${Date.now().toString(36)}-${random}`;
}
