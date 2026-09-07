import { randomUUID } from 'node:crypto';
import type { UnitAnalysis } from './types.js';
import { addLink, addPaper, validateLedger, type Decision, type DecisionKind, type Ledger, type LinkRelation, type ResearchLink } from './ledger.js';
import { detectConcepts, type Suggestion } from './detector.js';
import { resolveAnchor, type AnchorTarget, type CodeAnchor } from './anchors.js';
import { conceptRegistry } from './registry.js';

export interface SuggestionState extends Suggestion { status: 'unresolved' | 'confirmed' | 'exempt' | 'ignored'; coveredBy: string[] }

function contains(scope: AnchorTarget, target: AnchorTarget, anchor: CodeAnchor): boolean {
  if (scope.artifact !== target.artifact || scope.kind !== target.kind || scope.cell?.index !== target.cell?.index) return false;
  if (!scope.symbol) return true;
  return scope.symbol === target.symbol || (anchor.symbol?.kind === 'class' && target.symbol?.startsWith(`${scope.symbol}.`) === true);
}

/** Pure read-time classification: never changes stored anchors or decisions. */
export async function auditSuggestions(ledger: Ledger, analyses: UnitAnalysis[]): Promise<SuggestionState[]> {
  validateLedger(ledger);
  const suggestions = (await Promise.all(analyses.map(detectConcepts))).flat();
  const links = ledger.links.map(link => ({ link, resolution: resolveAnchor(link.anchor, analyses) }));
  const decisions = ledger.decisions.map(decision => ({ decision, resolution: resolveAnchor(decision.anchor, analyses) }));
  return suggestions.map(suggestion => {
    const target = resolveAnchor(suggestion.anchor, analyses);
    const state: SuggestionState = { ...suggestion, candidateIds: [...suggestion.candidateIds], status: 'unresolved', coveredBy: [] };
    if (target.status !== 'resolved') return state;
    state.coveredBy = links.filter(({ link, resolution }) => link.conceptId === suggestion.conceptId && resolution.status === 'resolved' && !resolution.needsReview && contains(resolution.target, target.target, link.anchor)).map(({ link }) => link.id);
    const applicable = decisions.filter(({ decision, resolution }) => decision.conceptId === suggestion.conceptId && resolution.status === 'resolved' && !resolution.needsReview && decision.fingerprint === (decision.anchor.symbol?.fingerprint ?? decision.anchor.unitFingerprint) && contains(resolution.target, target.target, decision.anchor)).map(({ decision }) => decision);
    const rejected = new Set(applicable.filter(d => d.kind === 'reject-paper').map(d => d.paperId));
    state.candidateIds = state.candidateIds.filter(id => !rejected.has(id));
    if (state.coveredBy.length > 0) state.status = 'confirmed';
    else if (applicable.some(d => d.kind === 'exempt')) state.status = 'exempt';
    else if (applicable.some(d => d.kind === 'ignore')) state.status = 'ignored';
    return state;
  });
}

export function recordDecision(ledger: Ledger, suggestion: Suggestion, kind: DecisionKind, options: { reason?: string; paperId?: string } = {}): Decision {
  if (kind === 'exempt' && !options.reason?.trim()) throw new Error('An exemption requires a reason.');
  if (kind === 'reject-paper' && (!options.paperId || !suggestion.candidateIds.includes(options.paperId))) throw new Error('Choose a current paper candidate to reject.');
  const decision: Decision = {
    id: `decision-${randomUUID()}`, kind, conceptId: suggestion.conceptId,
    anchor: structuredClone(suggestion.anchor), fingerprint: suggestion.fingerprint,
    createdAt: new Date().toISOString(),
    ...(options.reason?.trim() ? { reason: options.reason.trim() } : {}),
    ...(kind === 'reject-paper' && options.paperId ? { paperId: options.paperId } : {}),
  };
  validateLedger({ ...ledger, decisions: [...ledger.decisions, decision] });
  ledger.decisions.push(decision);
  return decision;
}

export function reopenDecision(ledger: Ledger, id: string): void {
  const index = ledger.decisions.findIndex(d => d.id === id);
  if (index < 0) throw new Error(`Unknown decision: ${id}`);
  ledger.decisions.splice(index, 1);
}

export function acceptSuggestion(ledger: Ledger, suggestion: Suggestion, options: { relation: LinkRelation; paperId?: string; candidateId?: string; note?: string }): ResearchLink {
  // Work on a copy so invalid relation/candidate/duplicate never leaves a stray paper.
  const next = structuredClone(ledger);
  let paperId = options.paperId;
  if (!paperId) {
    const candidateId = options.candidateId ?? suggestion.candidateIds[0];
    if (!candidateId || !suggestion.candidateIds.includes(candidateId)) throw new Error('Choose a current candidate or an existing paper.');
    const candidate = conceptRegistry.find(rule => rule.id === suggestion.conceptId && rule.paper.id === candidateId)?.paper;
    if (!candidate) throw new Error('Paper candidate is not in the registry.');
    const existing = next.papers.find(paper => paper.arxiv === candidate.arxiv);
    paperId = existing?.id ?? addPaper(next, { title: candidate.title, authors: [...candidate.authors], year: candidate.year, arxiv: candidate.arxiv, url: candidate.url, metadataSource: 'registry' }).id;
  }
  const link = addLink(next, { paperId, anchor: structuredClone(suggestion.anchor), conceptId: suggestion.conceptId, relation: options.relation, actor: 'human', ...(options.note?.trim() ? { note: options.note.trim() } : {}) });
  validateLedger(next);
  ledger.papers = next.papers;
  ledger.links = next.links;
  return link;
}
