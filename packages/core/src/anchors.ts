import type { CodeSymbol, SourceRange, SourceUnit, UnitAnalysis } from './types.js';

/** A serializable snapshot. Contains no source text and never relies on line numbers. */
export interface CodeAnchor {
  schemaVersion: 1;
  artifact: string;
  unitKind: SourceUnit['kind'];
  unitFingerprint: string;
  cellId?: string;
  symbol?: Pick<CodeSymbol, 'kind' | 'qualifiedName' | 'fingerprint'>;
}

export interface AnchorTarget {
  artifact: string;
  kind: SourceUnit['kind'];
  cell?: { index: number; id?: string };
  symbol?: string;
  range?: SourceRange;
}

export type AnchorResolution =
  | { status: 'resolved'; target: AnchorTarget; needsReview: boolean; candidates: AnchorTarget[] }
  | { status: 'ambiguous' | 'missing'; candidates: AnchorTarget[] };

interface Candidate {
  analysis: UnitAnalysis;
  symbol?: CodeSymbol;
}

export function createAnchor(analysis: UnitAnalysis, symbol?: CodeSymbol): CodeAnchor {
  return {
    schemaVersion: 1,
    artifact: analysis.unit.artifact,
    unitKind: analysis.unit.kind,
    unitFingerprint: analysis.fingerprint,
    ...(analysis.unit.cell?.id ? { cellId: analysis.unit.cell.id } : {}),
    ...(symbol ? { symbol: { kind: symbol.kind, qualifiedName: symbol.qualifiedName, fingerprint: symbol.fingerprint } } : {}),
  };
}

function target(candidate: Candidate): AnchorTarget {
  const unit = candidate.analysis.unit;
  return {
    artifact: unit.artifact,
    kind: unit.kind,
    ...(unit.cell ? { cell: { ...unit.cell } } : {}),
    ...(candidate.symbol ? { symbol: candidate.symbol.qualifiedName, range: candidate.symbol.range } : {}),
  };
}

function resolution(anchor: CodeAnchor, candidates: Candidate[]): AnchorResolution {
  const targets = candidates.map(target);
  const only = candidates.length === 1 ? candidates[0] : undefined;
  if (!only) return { status: candidates.length > 1 ? 'ambiguous' : 'missing', candidates: targets };
  const current = only.symbol?.fingerprint ?? only.analysis.fingerprint;
  const original = anchor.symbol?.fingerprint ?? anchor.unitFingerprint;
  return { status: 'resolved', target: target(only), needsReview: current !== original, candidates: targets };
}

function symbolCandidates(analyses: UnitAnalysis[], kind: CodeSymbol['kind']): Candidate[] {
  return analyses.flatMap(analysis => analysis.symbols.filter(symbol => symbol.kind === kind).map(symbol => ({ analysis, symbol })));
}

function hasDuplicateAncestor(candidate: Candidate): boolean {
  const qualifiedName = candidate.symbol?.qualifiedName;
  if (!qualifiedName) return false;
  const parts = qualifiedName.split('.');
  for (let length = 1; length < parts.length; length += 1) {
    const ancestor = parts.slice(0, length).join('.');
    if (candidate.analysis.symbols.filter(symbol => symbol.qualifiedName === ancestor).length > 1) {
      return true;
    }
  }
  return false;
}

function symbolResolution(anchor: CodeAnchor, candidates: Candidate[]): AnchorResolution {
  if (candidates.some(hasDuplicateAncestor)) {
    return { status: 'ambiguous', candidates: candidates.map(target) };
  }
  return resolution(anchor, candidates);
}

/** Conservative relocation: prefer identity, then unique structural matches; never cell index. */
export function resolveAnchor(anchor: CodeAnchor, analyses: UnitAnalysis[]): AnchorResolution {
  let units = analyses.filter(analysis => analysis.unit.kind === anchor.unitKind);
  if (anchor.unitKind === 'cell') {
    const sameNotebook = units.filter(analysis => analysis.unit.artifact === anchor.artifact);
    if (anchor.cellId) {
      units = sameNotebook.length > 0
        ? sameNotebook.filter(analysis => analysis.unit.cell?.id === anchor.cellId)
        : units.filter(analysis => analysis.unit.cell?.id === anchor.cellId && analysis.fingerprint === anchor.unitFingerprint);
    } else {
      units = (sameNotebook.length > 0 ? sameNotebook : units).filter(analysis => analysis.fingerprint === anchor.unitFingerprint);
    }
    // Even a unique symbol cannot disambiguate duplicated notebook containers.
    if (units.length !== 1) return resolution(anchor, units.map(analysis => ({ analysis })));
  }

  if (!anchor.symbol) {
    const exact = units.filter(analysis => analysis.unit.artifact === anchor.artifact);
    const candidates = exact.length > 0 ? exact : units.filter(analysis => analysis.fingerprint === anchor.unitFingerprint);
    return resolution(anchor, candidates.map(analysis => ({ analysis })));
  }

  const saved = anchor.symbol;
  const candidates = symbolCandidates(units, saved.kind);
  const named = candidates.filter(candidate => candidate.symbol?.qualifiedName === saved.qualifiedName &&
    (anchor.unitKind === 'cell' || candidate.analysis.unit.artifact === anchor.artifact));
  // A repeated qualified name in one scope is ambiguous, even if one body matches.
  if (named.length > 0) return symbolResolution(anchor, named);
  return symbolResolution(anchor, candidates.filter(candidate => candidate.symbol?.fingerprint === saved.fingerprint));
}
