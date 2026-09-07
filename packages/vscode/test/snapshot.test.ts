import { expect, test } from 'vitest';
import { readNotebook } from '../../core/src/notebook.js';
import { notebookText, scopeDescription, type EditorCell } from '../src/snapshot.js';
const cell = (source: string, id?: string, kind = 2, languageId = 'python'): EditorCell => ({ kind, metadata: id ? { id, metadata: {} } : {}, document: { languageId, getText: () => source } });

test('reads real ipynb serializer metadata and preserves unsaved reorder without synthesizing IDs', () => {
  const cells = [cell('def b(): pass', 'b'), cell('notes', 'text', 1), cell('def a(): pass')];
  const notebook = { metadata: { nbformat: 4, metadata: { language_info: { name: 'python' } }, cells: [] }, getCells: () => cells };
  const before = JSON.stringify(notebook.metadata);
  const result = readNotebook('n.ipynb', notebookText(notebook));
  expect(result.diagnostics).toEqual([]);
  expect(result.units.map(u => [u.cell, u.source])).toEqual([[{ index: 0, id: 'b' }, 'def b(): pass'], [{ index: 2 }, 'def a(): pass']]);
  expect(JSON.stringify(notebook.metadata)).toBe(before);
});

test('duplicates across markdown and code remain ambiguous to the shared reader', () => {
  const notebook = { metadata: { metadata: { language_info: { name: 'python' } } }, getCells: () => [cell('note', 'a', 1), cell('x = 1', 'a')] };
  const result = readNotebook('n.ipynb', notebookText(notebook));
  expect(result.units[0]?.cell).toEqual({ index: 1 });
  expect(result.diagnostics.map(d => d.code)).toEqual(['duplicate-cell-id', 'duplicate-cell-id']);
});

test('Python override is explicit, in-memory only, and resolves conflicting notebook metadata', () => {
  const notebook = { metadata: { metadata: { kernelspec: { language: 'julia' } } }, getCells: () => [cell('x=1')] };
  expect(readNotebook('n.ipynb', notebookText(notebook)).diagnostics[0]?.code).toBe('unsupported-language');
  expect(readNotebook('n.ipynb', notebookText(notebook, true)).units).toHaveLength(1);
  expect(notebook.metadata.metadata.kernelspec.language).toBe('julia');
});

test('per-cell non-Python language yields a partial diagnostic and no Python unit', () => {
  const notebook = { metadata: { metadata: { language_info: { name: 'python' } } }, getCells: () => [cell('class LayerNorm {}', 'js', 2, 'javascript'), cell('x=1', 'py')] };
  const result = readNotebook('n.ipynb', notebookText(notebook));
  expect(result.units.map(u => u.cell?.id)).toEqual(['py']);
  expect(result.diagnostics[0]).toMatchObject({ code: 'unsupported-cell-language', cellIndex: 0, severity: 'warning' });
});

test('saved raw metadata remains authoritative when the native document synthesizes Python', () => {
  const notebook = { metadata: { nbformat: 4, metadata: { language_info: { name: 'python' } } }, getCells: () => [cell('class RMSNorm: pass', 'a')] };
  const saved = { nbformat: 4, metadata: {} };
  const unsupported = readNotebook('n.ipynb', notebookText(notebook, false, saved));
  expect(unsupported.units).toEqual([]);
  expect(unsupported.diagnostics[0]?.code).toBe('unsupported-language');
  const authorized = readNotebook('n.ipynb', notebookText(notebook, true, saved));
  expect(authorized.units).toHaveLength(1);
});

test('dirty scope choices carry a specific saved-state caveat', () => {
  expect(scopeDescription('Whole scope', true)).toMatch(/unsaved|discard|save/i);
  expect(scopeDescription('Whole scope', false)).toBe('Whole scope');
});
