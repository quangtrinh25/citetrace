import { addLink, addPaper, auditProject, createAnchor, emptyLedger, exportBibliography, readLedger, resolveAnchor, writeLedger, type CodeAnchor, type LinkRelation, type SourceOverride, type PaperInput, type ProjectAudit, type Ledger } from '@citetrace/core';
export interface LinkDetails { conceptId?: string; note?: string; referenceUrl?: string }
export class ProjectService {
  constructor(readonly root: string, readonly autoExport = false, private readonly scanner?: (overrides: SourceOverride[]) => Promise<ProjectAudit>) {}
  scan(overrides: SourceOverride[] = []): Promise<ProjectAudit> { return this.scanner ? this.scanner(overrides) : auditProject(this.root, overrides); }
  async initialize(): Promise<void> {
    if (!(await readLedger(this.root)).ledger) await writeLedger(this.root, emptyLedger(), null);
  }
  async commit(ledger: Ledger, revision: string | null, linkChange = false): Promise<void> {
    await writeLedger(this.root, ledger, revision);
    if (linkChange && this.autoExport) {
      try { await exportBibliography(this.root, ledger); }
      catch (error) { throw new Error(`Provenance saved, but auto-export failed: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  async add(input: PaperInput): Promise<string> {
    const state = await readLedger(this.root);
    if (!state.ledger) throw new Error('Initialize this project first.');
    const paper = addPaper(state.ledger, input);
    await this.commit(state.ledger, state.revision);
    return paper.id;
  }
  async link(paperId: string, anchor: CodeAnchor, relation: LinkRelation, details: LinkDetails = {}, overrides: SourceOverride[] = []): Promise<string> {
    const audit = await this.scan(overrides);
    if (!audit.initialized) throw new Error('Initialize this project first.');
    const resolution = resolveAnchor(anchor, audit.analyses);
    if (resolution.status !== 'resolved' || resolution.needsReview) throw new Error('Code selection changed or became ambiguous. Choose the scope again.');
    const unit = audit.analyses.find(a => a.unit.artifact === resolution.target.artifact && a.unit.kind === resolution.target.kind && a.unit.cell?.index === resolution.target.cell?.index)!;
    const symbol = unit.symbols.find(s => s.qualifiedName === resolution.target.symbol);
    const link = addLink(audit.ledger, { paperId, anchor: createAnchor(unit, symbol), relation, actor: 'human',
      ...(details.conceptId?.trim() ? { conceptId: details.conceptId.trim() } : {}),
      ...(details.note?.trim() ? { note: details.note.trim() } : {}),
      ...(details.referenceUrl?.trim() ? { referenceUrl: details.referenceUrl.trim() } : {}),
    });
    await this.commit(audit.ledger, audit.revision, true);
    return link.id;
  }
}
