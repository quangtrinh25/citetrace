import type { SourceDiagnostic, SourceReadResult, SourceUnit } from './types.js';

type JsonObject = Record<string, unknown>;

const CELL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function error(artifact: string, code: string, message: string): SourceDiagnostic {
  return { artifact, code, severity: 'error', message };
}

function cellDiagnostic(
  artifact: string,
  cellIndex: number,
  code: string,
  severity: SourceDiagnostic['severity'],
  message: string,
): SourceDiagnostic {
  return { artifact, cellIndex, code, severity, message };
}

function nestedString(object: unknown, parent: string, child: string): string | undefined {
  if (!isObject(object)) return undefined;
  const nested = object[parent];
  if (!isObject(nested)) return undefined;
  const value = nested[child];
  return typeof value === 'string' ? value.toLowerCase() : undefined;
}

function hasPythonLanguage(notebook: JsonObject): boolean {
  const metadata = notebook['metadata'];
  const languageInfo = nestedString(metadata, 'language_info', 'name');
  const kernelSpec = nestedString(metadata, 'kernelspec', 'language');

  if (languageInfo !== undefined && kernelSpec !== undefined && languageInfo !== kernelSpec) {
    return false;
  }

  return languageInfo === 'python' || kernelSpec === 'python';
}

function validCellId(cell: unknown): string | undefined {
  if (!isObject(cell)) return undefined;
  const id = cell['id'];
  return typeof id === 'string' && CELL_ID_PATTERN.test(id) ? id : undefined;
}

function sourceText(source: unknown): string | undefined {
  if (typeof source === 'string') return source;
  if (Array.isArray(source) && source.every((part): part is string => typeof part === 'string')) {
    return source.join('');
  }
  return undefined;
}

export function readNotebook(artifact: string, text: string): SourceReadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return {
      units: [],
      diagnostics: [error(artifact, 'invalid-notebook', 'Notebook is not valid JSON.')],
    };
  }

  if (!isObject(parsed)) {
    return {
      units: [],
      diagnostics: [error(artifact, 'invalid-notebook', 'Notebook must be a JSON object.')],
    };
  }

  if (parsed['nbformat'] !== 4) {
    return {
      units: [],
      diagnostics: [
        error(artifact, 'invalid-notebook', 'Notebook must use nbformat major version 4.'),
      ],
    };
  }

  const cells = parsed['cells'];
  if (!Array.isArray(cells)) {
    return {
      units: [],
      diagnostics: [error(artifact, 'invalid-notebook', 'Notebook cells must be an array.')],
    };
  }

  if (!hasPythonLanguage(parsed)) {
    return {
      units: [],
      diagnostics: [
        error(
          artifact,
          'unsupported-language',
          'Notebook must contain consistent, explicit Python language metadata.',
        ),
      ],
    };
  }

  const idCounts = new Map<string, number>();
  for (const cell of cells) {
    const id = validCellId(cell);
    if (id !== undefined) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }

  const units: SourceUnit[] = [];
  const diagnostics: SourceDiagnostic[] = [];

  cells.forEach((cell, index) => {
    if (!isObject(cell)) {
      diagnostics.push(
        cellDiagnostic(
          artifact,
          index,
          'invalid-cell',
          'error',
          `Cell ${index} must be a JSON object.`,
        ),
      );
      return;
    }

    const rawId = cell['id'];
    const id = validCellId(cell);
    if (rawId !== undefined && id === undefined) {
      diagnostics.push(
        cellDiagnostic(
          artifact,
          index,
          'invalid-cell-id',
          'warning',
          `Cell ${index} has an invalid ID; the ID was omitted.`,
        ),
      );
    } else if (id !== undefined && (idCounts.get(id) ?? 0) > 1) {
      diagnostics.push(
        cellDiagnostic(
          artifact,
          index,
          'duplicate-cell-id',
          'warning',
          `Cell ${index} uses duplicate ID "${id}"; the ID was omitted.`,
        ),
      );
    }

    const cellType = cell['cell_type'];
    if (cellType === 'markdown' || cellType === 'raw') return;
    if (cellType !== 'code') {
      diagnostics.push(
        cellDiagnostic(
          artifact,
          index,
          'invalid-cell',
          'error',
          `Cell ${index} must have a recognized cell_type.`,
        ),
      );
      return;
    }

    const cellLanguage = nestedString(cell['metadata'], 'vscode', 'languageId');
    if (cellLanguage !== undefined && cellLanguage !== 'python') {
      diagnostics.push(cellDiagnostic(artifact, index, 'unsupported-cell-language', 'warning', `Cell ${index} uses ${cellLanguage}; only Python code cells are analyzed.`));
      return;
    }

    const source = sourceText(cell['source']);
    if (source === undefined) {
      diagnostics.push(
        cellDiagnostic(
          artifact,
          index,
          'invalid-cell',
          'error',
          `Code cell ${index} must have a string source or an array of strings.`,
        ),
      );
      return;
    }

    const cellReference: NonNullable<SourceUnit['cell']> = { index };
    if (id !== undefined && (idCounts.get(id) ?? 0) === 1) cellReference.id = id;

    units.push({ artifact, kind: 'cell', source, cell: cellReference });
  });

  return { units, diagnostics };
}
