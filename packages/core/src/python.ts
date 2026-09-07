import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { Language, Parser, type Node } from 'web-tree-sitter';
import type { CodeSymbol, SourceDiagnostic, SourceRange, SourceUnit, UnitAnalysis } from './types.js';

const require = createRequire(import.meta.url);
let languagePromise: Promise<Language> | undefined;

export function pythonLanguage(): Promise<Language> {
  languagePromise ??= (async () => {
    await Parser.init();
    return Language.load(require.resolve('tree-sitter-python/tree-sitter-python.wasm'));
  })().catch((error: unknown) => {
    languagePromise = undefined;
    throw error;
  });
  return languagePromise;
}

function range(node: Node): SourceRange {
  return {
    start: { line: node.startPosition.row, character: node.startPosition.column },
    end: { line: node.endPosition.row, character: node.endPosition.column },
  };
}

/** Serialize tree structure, not whitespace; preserve literal values and operators. */
function fingerprint(node: Node, declarationName?: Node | null): string {
  function tokens(current: Node): unknown {
    if (current.type === 'comment') return undefined;
    if (current.id === declarationName?.id) return ['identifier', '<declaration-name>'];
    if (current.childCount === 0) return [current.type, current.text];
    return [current.type, current.children.map(tokens).filter(value => value !== undefined)];
  }
  return createHash('sha256').update(JSON.stringify(tokens(node))).digest('hex');
}

function diagnostic(unit: SourceUnit, node: Node, code: string, message: string): SourceDiagnostic {
  return {
    artifact: unit.artifact,
    code,
    severity: 'warning',
    message,
    range: range(node),
    ...(unit.cell ? { cellIndex: unit.cell.index } : {}),
  };
}

function unsupportedMagic(unit: SourceUnit, root: Node): boolean {
  if (unit.kind !== 'cell' || !root.hasError) return false;
  for (const match of unit.source.matchAll(/^[\t ]*[%!]/gm)) {
    const index = match.index + match[0].length - 1;
    let current: Node | null = root.descendantForIndex(index);
    let quoted = false;
    while (current) {
      if (current.type === 'string' || current.type === 'comment') quoted = true;
      current = current.parent;
    }
    if (!quoted) return true;
  }
  return false;
}

export async function analyzePython(unit: SourceUnit): Promise<UnitAnalysis> {
  const language = await pythonLanguage();
  const parser = new Parser();
  parser.setLanguage(language);
  try {
    const tree = parser.parse(unit.source);
    if (!tree) throw new Error('Python parser did not produce a syntax tree.');
    try {
      const root = tree.rootNode;
      const result: UnitAnalysis = { unit, fingerprint: fingerprint(root), symbols: [], diagnostics: [] };
      if (unsupportedMagic(unit, root)) {
        result.diagnostics.push(diagnostic(unit, root, 'unsupported-magic', 'This cell uses IPython magic or shell syntax; link the cell manually.'));
        return result;
      }

      function collectErrors(node: Node): void {
        if (node.isError || node.isMissing) {
          result.diagnostics.push(diagnostic(unit, node, 'syntax-error', 'Incomplete or invalid Python syntax; affected definitions were skipped.'));
          return;
        }
        if (node.hasError) node.children.forEach(collectErrors);
      }
      collectErrors(root);

      function hasInvalidDefinitionContext(node: Node): boolean {
        let ancestor = node.parent;
        while (ancestor?.parent) {
          if (ancestor.hasError) return true;
          ancestor = ancestor.parent;
        }

        let boundary = node.startIndex;
        let previous = node.previousNamedSibling;
        // Comments do not detach a decorator from the following definition.
        while (previous?.type === 'comment' && unit.source.slice(previous.endIndex, boundary).trim() === '') {
          boundary = previous.startIndex;
          previous = previous.previousNamedSibling;
        }
        return previous?.isError === true &&
          previous.text.trimStart().startsWith('@') &&
          unit.source.slice(previous.endIndex, boundary).trim() === '';
      }

      function visit(node: Node, scope: string[], owner?: 'class' | 'function'): void {
        const isClass = node.type === 'class_definition';
        const isFunction = node.type === 'function_definition';
        if (isClass || isFunction) {
          if (node.hasError || hasInvalidDefinitionContext(node)) return;
          const name = node.childForFieldName('name');
          if (!name) return;
          const decorated = node.parent?.type === 'decorated_definition' ? node.parent : node;
          const qualifiedName = [...scope, name.text].join('.');
          const kind: CodeSymbol['kind'] = isClass ? 'class' : owner === 'class' ? 'method' : 'function';
          result.symbols.push({ kind, name: name.text, qualifiedName, range: range(decorated), fingerprint: fingerprint(decorated, name) });
          const body = node.childForFieldName('body');
          if (body) visit(body, [...scope, name.text], isClass ? 'class' : 'function');
          return;
        }
        for (const child of node.namedChildren) visit(child, scope, owner);
      }
      visit(root, []);
      return result;
    } finally {
      tree.delete();
    }
  } finally {
    parser.delete();
  }
}
