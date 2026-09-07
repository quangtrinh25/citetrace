import { createHash } from 'node:crypto';
import { Parser, type Node } from 'web-tree-sitter';
import { createAnchor, resolveAnchor, type CodeAnchor } from './anchors.js';
import type { SourceRange, UnitAnalysis } from './types.js';
import { pythonLanguage } from './python.js';
import { conceptRegistry, type ConceptRule } from './registry.js';

export interface DetectionEvidence { kind: 'definition-name' | 'imported-call'; text: string; range: SourceRange }
export interface Suggestion { id: string; conceptId: string; ruleVersion: string; anchor: CodeAnchor; fingerprint: string; evidence: DetectionEvidence[]; candidateIds: string[] }
type Bindings = Map<string, string | null>;
const normalName = (name: string) => name.replaceAll('_', '').toLowerCase();
const skippedExpressions = new Set(['lambda', 'list_comprehension', 'set_comprehension', 'dictionary_comprehension', 'generator_expression', 'match_statement']);

function sourceRange(node: Node): SourceRange {
  return { start: { line: node.startPosition.row, character: node.startPosition.column }, end: { line: node.endPosition.row, character: node.endPosition.column } };
}

function targetNames(node: Node | null): string[] {
  if (!node) return [];
  if (node.type === 'identifier') return [node.text];
  if (node.type === 'attribute' || node.type === 'subscript') return targetNames(node.childForFieldName(node.type === 'attribute' ? 'object' : 'value'));
  return node.namedChildren.flatMap(targetNames);
}

function firstIdentifier(node: Node | null): string | undefined {
  if (!node) return undefined;
  if (node.type === 'identifier') return node.text;
  for (const child of node.namedChildren) {
    const identifier = firstIdentifier(child);
    if (identifier) return identifier;
  }
  return undefined;
}

function typeParameterBinders(node: Node | null): string[] {
  if (!node) return [];
  return node.namedChildren.flatMap(parameter => {
    const binder = firstIdentifier(parameter);
    return binder ? [binder] : [];
  });
}

/** Conservative lexical bindings. Assignments anywhere in a scope shadow imports;
 * conditional imports, star imports and mutated module attributes are uncertain.
 * This trades recall for avoiding attribution through an unrelated local object. */
function bindingsFor(body: Node, inherited: Bindings, parameters?: Node | null, excludedDeclaration?: Node): Bindings {
  const env = new Map(inherited);
  const locals = new Map<string, string | null>();
  let starImport = false;
  const bind = (name: string, canonical: string | null) => {
    if (locals.has(name) && locals.get(name) !== canonical) locals.set(name, null);
    else locals.set(name, canonical);
  };
  const shadow = (node: Node | null) => targetNames(node).forEach(name => bind(name, null));
  for (const parameter of parameters?.namedChildren ?? []) {
    const name = parameter.childForFieldName('name');
    if (name) shadow(name);
    else if (parameter.type === 'typed_parameter') shadow(parameter.namedChildren[0] ?? null);
    else shadow(parameter);
  }
  function collect(node: Node): void {
    if (node.type === 'function_definition' || node.type === 'class_definition') {
      if (node.id !== excludedDeclaration?.id) shadow(node.childForFieldName('name'));
      return;
    }
    if (node.type === 'import_statement' || node.type === 'import_from_statement') {
      const module = node.childForFieldName('module_name')?.text;
      const unconditional = node.parent?.id === body.id && !module?.startsWith('.');
      if (node.namedChildren.some(child => child.type === 'wildcard_import')) starImport = true;
      for (const item of node.childrenForFieldName('name')) {
        const imported = item.childForFieldName('name')?.text ?? item.text;
        const alias = item.childForFieldName('alias')?.text;
        const name = alias ?? (module ? imported : imported.split('.')[0]!);
        const canonical = module ? `${module}.${imported}` : alias ? imported : imported.split('.')[0]!;
        bind(name, unconditional ? canonical : null);
      }
      return;
    }
    if (node.type === 'assignment' || node.type === 'augmented_assignment' || node.type === 'for_statement' || node.type === 'for_in_clause') shadow(node.childForFieldName('left'));
    if (node.type === 'named_expression') shadow(node.childForFieldName('name'));
    if (node.type === 'type_alias_statement') {
      const alias = firstIdentifier(node.childForFieldName('left'));
      if (alias) bind(alias, null);
      return;
    }
    if (node.type === 'call' && ['setattr', 'delattr'].includes(node.childForFieldName('function')?.text ?? '')) shadow(node.childForFieldName('arguments')?.namedChildren[0] ?? null);
    if (node.type === 'as_pattern') shadow(node.childForFieldName('alias'));
    if (node.type === 'global_statement' || node.type === 'nonlocal_statement' || node.type === 'delete_statement') shadow(node);
    // Comprehensions/lambdas have their own scopes and are deliberately outside
    // automatic call coverage. Do not contaminate surrounding bindings.
    if (skippedExpressions.has(node.type)) {
      if (node.type === 'match_statement') shadow(node);
      if (node.type !== 'lambda') {
        const walruses = (child: Node): void => {
          if (child.type === 'lambda') return;
          if (child.type === 'named_expression') shadow(child.childForFieldName('name'));
          child.namedChildren.forEach(walruses);
        };
        walruses(node);
      }
      return;
    }
    node.namedChildren.forEach(collect);
  }
  body.namedChildren.forEach(collect);
  for (const [name, canonical] of locals) env.set(name, canonical);
  if (starImport) for (const name of env.keys()) env.set(name, null);
  return env;
}

function importedName(node: Node | null, env: Bindings): string | undefined {
  if (!node) return undefined;
  if (node.type === 'identifier') return env.get(node.text) ?? undefined;
  if (node.type !== 'attribute') return undefined;
  const object = importedName(node.childForFieldName('object'), env);
  const attribute = node.childForFieldName('attribute')?.text;
  return object && attribute ? `${object}.${attribute}` : undefined;
}

/** Analyze explicit evidence without network access or execution. */
export async function detectConcepts(analysis: UnitAnalysis): Promise<Suggestion[]> {
  // A recovered syntax tree cannot establish reliable lexical bindings.
  if (analysis.diagnostics.length > 0) return [];
  const suggestions = new Map<string, Suggestion>();
  function add(rule: ConceptRule, evidence: DetectionEvidence): void {
    const line = evidence.range.start.line;
    const character = evidence.range.start.character;
    const owner = analysis.symbols.filter(s =>
      (s.range.start.line < line || (s.range.start.line === line && s.range.start.character <= character)) &&
      (s.range.end.line > line || (s.range.end.line === line && s.range.end.character >= character)))
      .sort((a, b) => b.qualifiedName.split('.').length - a.qualifiedName.split('.').length)[0];
    const anchor = createAnchor(analysis, owner);
    if (resolveAnchor(anchor, [analysis]).status !== 'resolved') return;
    const id = createHash('sha256').update(JSON.stringify([rule.id, rule.version, anchor])).digest('hex');
    let suggestion = suggestions.get(id);
    if (!suggestion) {
      suggestion = { id, conceptId: rule.id, ruleVersion: rule.version, anchor, fingerprint: owner?.fingerprint ?? analysis.fingerprint, evidence: [], candidateIds: [rule.paper.id] };
      suggestions.set(id, suggestion);
    }
    suggestion.evidence.push(evidence);
  }
  for (const symbol of analysis.symbols) {
    for (const rule of conceptRegistry) if (rule.aliases.some(alias => normalName(alias) === normalName(symbol.name))) {
      if (rule.id === 'adam' && normalName(symbol.name) === 'adam' && (symbol.kind !== 'class' || symbol.name !== 'Adam')) continue;
      add(rule, { kind: 'definition-name', text: `${symbol.kind} ${symbol.qualifiedName}`, range: symbol.range });
    }
  }
  const parser = new Parser();
  parser.setLanguage(await pythonLanguage());
  try {
    const tree = parser.parse(analysis.unit.source);
    if (!tree) throw new Error('Python detector did not produce a syntax tree.');
    try {
      function scan(body: Node, inherited: Bindings, parameters?: Node | null, lexicalParent?: Bindings): void {
        const env = bindingsFor(body, inherited, parameters);
        function visit(node: Node, currentEnv = env): void {
          if (node.type === 'decorated_definition') {
            const declaration = node.namedChildren.find(child => child.type === 'function_definition' || child.type === 'class_definition');
            if (declaration) {
              const declarationEnv = bindingsFor(body, inherited, parameters, declaration);
              for (const child of node.namedChildren) if (child.id !== declaration.id) visit(child, declarationEnv);
              visit(declaration, currentEnv);
              return;
            }
          }
          if (node.type === 'function_definition' || node.type === 'class_definition') {
            const childBody = node.childForFieldName('body');
            const declarationEnv = bindingsFor(body, inherited, parameters, node);
            for (const name of typeParameterBinders(node.childForFieldName('type_parameters'))) declarationEnv.set(name, null);
            for (const child of node.namedChildren) if (child.id !== childBody?.id) visit(child, declarationEnv);
            if (childBody) {
              const postBindingParent = new Map(lexicalParent ?? currentEnv);
              for (const name of typeParameterBinders(node.childForFieldName('type_parameters'))) postBindingParent.set(name, null);
              if (node.type === 'class_definition') scan(childBody, declarationEnv, node.childForFieldName('parameters'), postBindingParent);
              else scan(childBody, postBindingParent, node.childForFieldName('parameters'));
            }
            return;
          }
          if (skippedExpressions.has(node.type)) return;
          if (node.type === 'call') {
            const canonical = importedName(node.childForFieldName('function'), currentEnv);
            if (canonical) for (const rule of conceptRegistry) if (rule.calls.includes(canonical)) {
              add(rule, { kind: 'imported-call', text: canonical, range: sourceRange(node) });
            }
          }
          node.namedChildren.forEach(child => visit(child, currentEnv));
        }
        body.namedChildren.forEach(child => visit(child));
      }
      scan(tree.rootNode, new Map());
    } finally { tree.delete(); }
  } finally { parser.delete(); }
  return [...suggestions.values()];
}
