/** Minimal, serializable editor state. No VS Code dependency in this module. */
export interface EditorCell { kind: number; metadata: Record<string, unknown>; document: { languageId: string; getText(): string } }
export interface EditorNotebook { metadata: Record<string, unknown>; getCells(): readonly EditorCell[] }
export interface SavedNotebookEnvelope { nbformat?: unknown; metadata: Record<string, unknown> }
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Builds analysis input only, never serialization back into the user's file.
 * Native ipynb metadata uses Notebook.metadata.metadata and Cell.metadata.id.
 * Source: microsoft/vscode extensions/ipynb/src/{de,}serializers.ts. */
export function notebookText(notebook: EditorNotebook, pythonOverride = false, saved?: SavedNotebookEnvelope): string {
  const native = notebook.metadata;
  const metadata = structuredClone(saved ? saved.metadata : object(native['metadata'] ?? native));
  if (pythonOverride) {
    metadata['language_info'] = { ...object(metadata['language_info']), name: 'python' };
    metadata['kernelspec'] = { ...object(metadata['kernelspec']), language: 'python' };
  }
  const cells = notebook.getCells().map(cell => {
    const cellMetadata = structuredClone(object(cell.metadata['metadata']));
    // Respect a native cell's explicit language without deriving notebook language
    // from VS Code's default Python selection for an unidentified notebook.
    if (cell.kind === 2 && cell.document.languageId !== 'raw') {
      cellMetadata['vscode'] = { ...object(cellMetadata['vscode']), languageId: cell.document.languageId };
    }
    return { cell_type: cell.kind === 1 ? 'markdown' : cell.document.languageId === 'raw' ? 'raw' : 'code',
      source: cell.document.getText(), metadata: cellMetadata,
      ...(cell.metadata['id'] !== undefined ? { id: cell.metadata['id'] } : {}),
    };
  });
  return JSON.stringify({ nbformat: saved?.nbformat ?? native['nbformat'] ?? 4, metadata, cells });
}

export function savedNotebookEnvelope(source: string): SavedNotebookEnvelope {
  const parsed: unknown = JSON.parse(source);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Saved notebook is not an object.');
  const notebook = parsed as Record<string, unknown>;
  return { ...(notebook['nbformat'] !== undefined ? { nbformat: notebook['nbformat'] } : {}), metadata: structuredClone(object(notebook['metadata'])) };
}

export function scopeDescription(description: string, dirty: boolean): string {
  return dirty ? `${description} · unsaved editor content; save it before linking or discarding changes may require relinking` : description;
}
