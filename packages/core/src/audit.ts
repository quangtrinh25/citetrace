import { resolveAnchor, type AnchorResolution } from './anchors.js';
import { readLedger, emptyLedger, type Ledger, type ResearchLink } from './ledger.js';
import { auditSuggestions, type SuggestionState } from './suggestions.js';
import type { SourceDiagnostic, UnitAnalysis } from './types.js';
import { readProject } from './project.js';
import { readNotebook } from './notebook.js';
import { analyzePython } from './python.js';

export interface SourceOverride { artifact: string; source: string }
export interface ProjectAudit {
  initialized: boolean; ledger: Ledger; revision: string | null;
  analyses: UnitAnalysis[]; diagnostics: SourceDiagnostic[];
  links: Array<{ link: ResearchLink; resolution: AnchorResolution }>;
  suggestions: SuggestionState[];
  counts: { confirmed: number; unresolved: number; exempt: number; ignored: number; missing: number; ambiguous: number; needsReview: number };
}
export async function auditProject(root: string, overrides: SourceOverride[] = []): Promise<ProjectAudit> {
  const state = await readLedger(root);
  const ledger = state.ledger ?? emptyLedger();
  const project = await readProject(root);
  const replacements = new Map(overrides.map(override => [override.artifact, override.source]));
  const replaced = new Set(project.artifacts.filter(a => replacements.has(a.artifact)).map(a => a.artifact));
  const diagnostics = project.diagnostics.filter(d => !replaced.has(d.artifact));
  const analyses: UnitAnalysis[] = [];
  for (const artifact of project.artifacts) {
    const source = replacements.get(artifact.artifact);
    const input = source === undefined ? artifact : artifact.artifact.toLowerCase().endsWith('.ipynb')
      ? readNotebook(artifact.artifact, source)
      : { units: [{ artifact: artifact.artifact, kind: 'file' as const, source }], diagnostics: [] };
    if (source !== undefined) diagnostics.push(...input.diagnostics);
    for (const unit of input.units) {
      const analysis = await analyzePython(unit);
      analyses.push(analysis);
      diagnostics.push(...analysis.diagnostics);
    }
  }
  const links = ledger.links.map(link => ({ link, resolution: resolveAnchor(link.anchor, analyses) }));
  const suggestions = await auditSuggestions(ledger, analyses);
  return { initialized: state.ledger !== null, ledger, revision: state.revision, analyses, diagnostics, links, suggestions,
    counts: { confirmed: ledger.links.length, unresolved: suggestions.filter(s => s.status === 'unresolved').length,
      exempt: suggestions.filter(s => s.status === 'exempt').length, ignored: suggestions.filter(s => s.status === 'ignored').length,
      missing: links.filter(l => l.resolution.status === 'missing').length,
      ambiguous: links.filter(l => l.resolution.status === 'ambiguous').length,
      needsReview: links.filter(l => l.resolution.status === 'resolved' && l.resolution.needsReview).length },
  };
}
