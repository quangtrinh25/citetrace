import { describe, expect, test } from 'vitest';

import { readNotebook } from '../src/notebook.js';

const artifact = 'notebooks/example.ipynb';

function notebook(cells: unknown[], metadata: unknown = { language_info: { name: 'python' } }): string {
  return JSON.stringify({
    cells,
    metadata,
    nbformat: 4,
    nbformat_minor: 5,
  });
}

describe('readNotebook', () => {
  test('reports malformed JSON and returns no source units', () => {
    expect(readNotebook(artifact, '{not json')).toEqual({
      units: [],
      diagnostics: [
        expect.objectContaining({
          artifact,
          code: 'invalid-notebook',
          severity: 'error',
        }),
      ],
    });
  });

  test.each([
    ['a null top level', 'null'],
    ['an array top level', '[]'],
    ['an unsupported major format', JSON.stringify({ cells: [], metadata: {}, nbformat: 3 })],
    [
      'a non-array cells value',
      JSON.stringify({ cells: {}, metadata: { language_info: { name: 'python' } }, nbformat: 4 }),
    ],
  ])('reports %s as an invalid notebook', (_description, text) => {
    expect(readNotebook(artifact, text)).toEqual({
      units: [],
      diagnostics: [
        expect.objectContaining({
          artifact,
          code: 'invalid-notebook',
          severity: 'error',
        }),
      ],
    });
  });

  test('requires explicit Python language metadata', () => {
    const text = notebook(
      [{ cell_type: 'code', id: 'code-1', source: 'print(1)' }],
      { kernelspec: { display_name: 'Python 3' } },
    );

    expect(readNotebook(artifact, text)).toEqual({
      units: [],
      diagnostics: [
        expect.objectContaining({
          artifact,
          code: 'unsupported-language',
          severity: 'error',
        }),
      ],
    });
  });

  test('rejects contradictory explicit language metadata', () => {
    const text = notebook([{ cell_type: 'code', source: 'print(1)' }], {
      language_info: { name: 'Python' },
      kernelspec: { language: 'javascript' },
    });

    expect(readNotebook(artifact, text)).toEqual({
      units: [],
      diagnostics: [
        expect.objectContaining({
          artifact,
          code: 'unsupported-language',
          severity: 'error',
        }),
      ],
    });
  });

  test('recognizes Python language metadata case-insensitively from either supported field', () => {
    const fromLanguageInfo = readNotebook(
      artifact,
      notebook([{ cell_type: 'code', source: 'first = 1' }], {
        language_info: { name: 'PyThOn' },
      }),
    );
    const fromKernelSpec = readNotebook(
      artifact,
      notebook([{ cell_type: 'code', source: 'second = 2' }], {
        kernelspec: { language: 'PYTHON' },
      }),
    );

    expect(fromLanguageInfo.units).toEqual([
      { artifact, kind: 'cell', source: 'first = 1', cell: { index: 0 } },
    ]);
    expect(fromLanguageInfo.diagnostics).toEqual([]);
    expect(fromKernelSpec.units).toEqual([
      { artifact, kind: 'cell', source: 'second = 2', cell: { index: 0 } },
    ]);
    expect(fromKernelSpec.diagnostics).toEqual([]);
  });

  test('preserves string and array sources exactly, including Unicode and whitespace', () => {
    const text = notebook([
      { cell_type: 'code', id: 'string-cell', source: '  café = "☕"  \n' },
      { cell_type: 'code', id: 'array_cell', source: ['漢字 = 1', ' + 2', '\n'] },
    ]);

    expect(readNotebook(artifact, text)).toEqual({
      units: [
        {
          artifact,
          kind: 'cell',
          source: '  café = "☕"  \n',
          cell: { index: 0, id: 'string-cell' },
        },
        {
          artifact,
          kind: 'cell',
          source: '漢字 = 1 + 2\n',
          cell: { index: 1, id: 'array_cell' },
        },
      ],
      diagnostics: [],
    });
  });

  test('ignores markdown, raw cells, outputs, and execution counts', () => {
    const text = notebook([
      { cell_type: 'markdown', id: 'notes', source: '# print(0)' },
      { cell_type: 'raw', id: 'raw', source: 'print(1)' },
      {
        cell_type: 'code',
        id: 'actual-code',
        execution_count: 99,
        outputs: [{ output_type: 'stream', text: 'secret output' }],
        source: 'print(2)',
      },
    ]);

    expect(readNotebook(artifact, text)).toEqual({
      units: [
        {
          artifact,
          kind: 'cell',
          source: 'print(2)',
          cell: { index: 2, id: 'actual-code' },
        },
      ],
      diagnostics: [],
    });
  });

  test('does not fabricate an ID when a code cell has none', () => {
    const result = readNotebook(artifact, notebook([{ cell_type: 'code', source: 'x = 1' }]));

    expect(result).toEqual({
      units: [{ artifact, kind: 'cell', source: 'x = 1', cell: { index: 0 } }],
      diagnostics: [],
    });
    expect(result.units[0]?.cell).not.toHaveProperty('id');
  });

  test.each([
    ['contains punctuation', 'bad.id'],
    ['is empty', ''],
    ['is longer than 64 characters', 'a'.repeat(65)],
    ['contains non-ASCII letters', 'célula'],
  ])('warns when a cell ID %s and treats it as missing', (_description, id) => {
    const result = readNotebook(
      artifact,
      notebook([{ cell_type: 'code', id, source: 'x = 1' }]),
    );

    expect(result.units).toEqual([
      { artifact, kind: 'cell', source: 'x = 1', cell: { index: 0 } },
    ]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        artifact,
        cellIndex: 0,
        code: 'invalid-cell-id',
        severity: 'warning',
      }),
    ]);
  });

  test('omits an ID duplicated across code and non-code cells from every affected code unit', () => {
    const text = notebook([
      { cell_type: 'code', id: 'shared-id', source: 'x = 1' },
      { cell_type: 'markdown', id: 'shared-id', source: 'notes' },
      { cell_type: 'code', id: 'shared-id', source: 'y = 2' },
    ]);

    const result = readNotebook(artifact, text);

    expect(result.units).toEqual([
      { artifact, kind: 'cell', source: 'x = 1', cell: { index: 0 } },
      { artifact, kind: 'cell', source: 'y = 2', cell: { index: 2 } },
    ]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        artifact,
        cellIndex: 0,
        code: 'duplicate-cell-id',
        severity: 'warning',
      }),
      expect.objectContaining({
        artifact,
        cellIndex: 1,
        code: 'duplicate-cell-id',
        severity: 'warning',
      }),
      expect.objectContaining({
        artifact,
        cellIndex: 2,
        code: 'duplicate-cell-id',
        severity: 'warning',
      }),
    ]);
  });

  test('keeps a stable cell ID when cells are reordered', () => {
    const firstOrder = readNotebook(
      artifact,
      notebook([
        { cell_type: 'code', id: 'target-cell', source: 'target = 1' },
        { cell_type: 'code', id: 'other-cell', source: 'other = 2' },
      ]),
    );
    const secondOrder = readNotebook(
      artifact,
      notebook([
        { cell_type: 'code', id: 'other-cell', source: 'other = 2' },
        { cell_type: 'code', id: 'target-cell', source: 'target = 1' },
      ]),
    );

    expect(firstOrder.units[0]?.cell).toEqual({ index: 0, id: 'target-cell' });
    expect(secondOrder.units[1]?.cell).toEqual({ index: 1, id: 'target-cell' });
  });

  test('reports a malformed code cell while retaining other valid code cells', () => {
    const text = notebook([
      { cell_type: 'code', id: 'broken-cell', source: ['x = 1', 2] },
      { cell_type: 'code', id: 'valid-cell', source: ['y = 2', '\n'] },
    ]);

    expect(readNotebook(artifact, text)).toEqual({
      units: [
        {
          artifact,
          kind: 'cell',
          source: 'y = 2\n',
          cell: { index: 1, id: 'valid-cell' },
        },
      ],
      diagnostics: [
        expect.objectContaining({
          artifact,
          cellIndex: 0,
          code: 'invalid-cell',
          severity: 'error',
        }),
      ],
    });
  });

  test('reports malformed cell entries by index while retaining valid code cells', () => {
    const text = notebook([
      null,
      42,
      [],
      {},
      { cell_type: 'cod', source: 'def hidden():\n    pass\n' },
      { cell_type: 'markdown', source: '# Notes' },
      { cell_type: 'raw', source: 'unparsed text' },
      { cell_type: 'code', id: 'valid-cell', source: 'value = 1\n' },
    ]);

    expect(readNotebook(artifact, text)).toEqual({
      units: [
        {
          artifact,
          kind: 'cell',
          source: 'value = 1\n',
          cell: { index: 7, id: 'valid-cell' },
        },
      ],
      diagnostics: [0, 1, 2, 3, 4].map(cellIndex =>
        expect.objectContaining({
          artifact,
          cellIndex,
          code: 'invalid-cell',
          severity: 'error',
        }),
      ),
    });
  });

  test('retains source containing notebook magic commands unchanged', () => {
    const source = '%matplotlib inline\n!pip list\nvalue = 1';

    expect(readNotebook(artifact, notebook([{ cell_type: 'code', source }])).units).toEqual([
      { artifact, kind: 'cell', source, cell: { index: 0 } },
    ]);
  });
});
