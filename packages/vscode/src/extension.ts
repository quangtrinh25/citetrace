import * as vscode from 'vscode';
import { relative, resolve, sep, extname } from 'node:path';
import {
  acceptSuggestion, conceptRegistry, createAnchor, exportBibliography, lookupPaperMetadata,
  normalizeArxivId, normalizeDoi, readLedger, recordDecision, removeLink, reopenDecision, resolveAnchor,
  type CodeAnchor, type LinkRelation, type PaperInput, type ProjectAudit, type SourceOverride,
} from '@citetrace/core';
import { LatestScan } from './coordinator.js';
import { notebookText, savedNotebookEnvelope, scopeDescription } from './snapshot.js';
import { ProjectService } from './service.js';
import { failScan, publishScan, type ScanPublication } from './scan-state.js';
import { scanInWorker } from './transport.js';
import { knownWorkspaceRoot } from './workspace.js';

interface Entry { root: string; kind: 'project' | 'group' | 'paper' | 'link' | 'suggestion' | 'decision' | 'message'; label: string; description?: string; tooltip?: string; children?: Entry[]; anchor?: CodeAnchor; recordId?: string }
interface ProjectState extends ScanPublication<ProjectAudit> { folder: vscode.WorkspaceFolder; scanner: LatestScan<ProjectAudit> }
const relations: LinkRelation[] = ['implements', 'adapted-from', 'uses-method', 'background-reference'];
function within(root: string, path: string): string | undefined {
  const artifact = relative(root, path);
  if (!artifact || artifact === '..' || artifact.startsWith(`..${sep}`) || /^[A-Za-z]:/.test(artifact)) return undefined;
  return artifact.split(sep).join('/');
}
function asRange(range: { start: { line: number; character: number }; end: { line: number; character: number } }): vscode.Range {
  return new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character);
}
function entry(value: unknown): Entry | undefined {
  return value && typeof value === 'object' && 'root' in value && typeof value.root === 'string' ? value as Entry : undefined;
}

export function activate(context: vscode.ExtensionContext) {
  const states = new Map<string, ProjectState>();
  const pythonNotebooks = new Set<string>();
  const changed = new vscode.EventEmitter<Entry | undefined>();
  const diagnosticCollection = vscode.languages.createDiagnosticCollection('citetrace');
  const output = vscode.window.createOutputChannel('CiteTrace');
  const workerPath = context.asAbsolutePath('dist/worker.cjs');
  context.subscriptions.push(changed, diagnosticCollection, output);

  async function snapshots(root: string): Promise<SourceOverride[]> {
    const replacements: SourceOverride[] = [];
    for (const document of vscode.workspace.textDocuments) {
      const artifact = document.uri.scheme === 'file' ? within(root, document.uri.fsPath) : undefined;
      if (artifact && document.isDirty && extname(artifact).toLowerCase() === '.py') replacements.push({ artifact, source: document.getText() });
    }
    for (const notebook of vscode.workspace.notebookDocuments) {
      const artifact = notebook.uri.scheme === 'file' ? within(root, notebook.uri.fsPath) : undefined;
      const override = pythonNotebooks.has(notebook.uri.toString());
      if (artifact && (notebook.isDirty || override)) {
        let saved = { metadata: {} };
        try { saved = savedNotebookEnvelope(new TextDecoder().decode(await vscode.workspace.fs.readFile(notebook.uri))); }
        catch { /* Missing or invalid saved metadata cannot authorize Python analysis. */ }
        replacements.push({ artifact, source: notebookText(notebook, override, saved) });
      }
    }
    return replacements;
  }

  function uriFor(root: string, anchor: CodeAnchor, cellIndex?: number): vscode.Uri | undefined {
    const file = vscode.Uri.file(resolve(root, anchor.artifact));
    if (!within(root, file.fsPath)) return undefined;
    if (anchor.unitKind === 'file') return file;
    const notebook = vscode.workspace.notebookDocuments.find(n => n.uri.toString() === file.toString());
    return notebook && cellIndex !== undefined && cellIndex < notebook.cellCount ? notebook.cellAt(cellIndex).document.uri : undefined;
  }

  function diagnostics(): void {
    diagnosticCollection.clear();
    for (const [root, state] of states) {
      if (!state.audit) continue;
      const collected = new Map<string, { uri: vscode.Uri; values: vscode.Diagnostic[] }>();
      const add = (uri: vscode.Uri | undefined, diagnostic: vscode.Diagnostic) => {
        if (!uri) return;
        diagnostic.source = 'CiteTrace';
        const group = collected.get(uri.toString()) ?? { uri, values: [] };
        group.values.push(diagnostic); collected.set(uri.toString(), group);
      };
      for (const suggestion of state.audit.suggestions.filter(s => s.status === 'unresolved')) {
        const resolution = resolveAnchor(suggestion.anchor, state.audit.analyses);
        if (resolution.status !== 'resolved') continue;
        const evidence = suggestion.evidence[0]; if (!evidence) continue;
        const name = conceptRegistry.find(c => c.id === suggestion.conceptId)?.name ?? suggestion.conceptId;
        add(uriFor(root, suggestion.anchor, resolution.target.cell?.index), new vscode.Diagnostic(asRange(evidence.range), `${name}: review the research source in CiteTrace. Evidence: ${evidence.text}.`, vscode.DiagnosticSeverity.Information));
      }
      for (const diagnostic of state.audit.diagnostics) {
        const anchor: CodeAnchor = { schemaVersion: 1, artifact: diagnostic.artifact, unitKind: diagnostic.cellIndex === undefined ? 'file' : 'cell', unitFingerprint: '' };
        add(uriFor(root, anchor, diagnostic.cellIndex), new vscode.Diagnostic(diagnostic.range ? asRange(diagnostic.range) : new vscode.Range(0, 0, 0, 0), diagnostic.message, diagnostic.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning));
      }
      for (const group of collected.values()) diagnosticCollection.set(group.uri, group.values);
    }
  }

  function ensureStates(): void {
    const folders = (vscode.workspace.workspaceFolders ?? []).filter(folder => folder.uri.scheme === 'file');
    for (const [root, state] of states) if (!folders.some(f => f.uri.fsPath === root)) { state.scanner.dispose(); states.delete(root); }
    for (const folder of folders) {
      const root = folder.uri.fsPath;
      if (states.has(root)) continue;
      const state: ProjectState = { folder, scanner: new LatestScan(async signal => scanInWorker(workerPath, root, await snapshots(root), signal), audit => { publishScan(state, audit); changed.fire(undefined); diagnostics(); }, error => { failScan(state, error); output.appendLine(`${folder.name}: ${String(error)}`); changed.fire(undefined); diagnostics(); }) };
      states.set(root, state); state.scanner.schedule();
    }
  }

  function treeEntries(root: string, state: ProjectState): Entry[] {
    if (state.error) return [{ root, kind: 'message', label: 'Audit failed', tooltip: state.error }];
    const audit = state.audit;
    if (!audit) return [{ root, kind: 'message', label: 'Reading project…' }];
    if (!audit.initialized) return [{ root, kind: 'message', label: 'Initialize with “CiteTrace: Initialize Project”' }];
    const papers: Entry[] = audit.ledger.papers.map(p => ({ root, kind: 'paper', recordId: p.id, label: p.title, description: p.citationKey, tooltip: `${p.authors.join(', ')}${p.year ? ` (${p.year})` : ''}\nMetadata: ${p.metadataSource}\n${p.doi ?? p.arxiv ?? ''}` }));
    const links: Entry[] = audit.links.map(({ link, resolution }) => ({ root, kind: 'link', recordId: link.id, anchor: link.anchor, label: audit.ledger.papers.find(p => p.id === link.paperId)?.title ?? link.paperId, description: `${link.anchor.symbol?.qualifiedName ?? link.anchor.artifact} · ${resolution.status === 'resolved' ? resolution.needsReview ? 'needs review' : link.relation : resolution.status}`, tooltip: `Human confirmed: ${link.relation}\n${link.anchor.artifact}${link.note ? `\n${link.note}` : ''}` }));
    const broken = links.filter(l => { const r = audit.links.find(a => a.link.id === l.recordId)!.resolution; return r.status !== 'resolved' || r.needsReview; });
    const suggestions: Entry[] = audit.suggestions.filter(s => s.status === 'unresolved').map(s => ({ root, kind: 'suggestion', recordId: s.id, anchor: s.anchor, label: conceptRegistry.find(c => c.id === s.conceptId)?.name ?? s.conceptId, description: `${s.anchor.symbol?.qualifiedName ?? s.anchor.artifact}${s.candidateIds.length ? '' : ' · choose another paper'}`, tooltip: s.evidence.map(e => `${e.kind}: ${e.text}`).join('\n') }));
    const decisions: Entry[] = audit.ledger.decisions.map(d => ({ root, kind: 'decision', recordId: d.id, label: `${d.kind}: ${d.conceptId}`, description: d.anchor.symbol?.qualifiedName ?? d.anchor.artifact, tooltip: d.reason ?? 'Reopen to review this suggestion again.' }));
    const errors: Entry[] = audit.diagnostics.map(d => ({ root, kind: 'message', label: `${d.artifact}: ${d.code}`, tooltip: d.message }));
    return [['Papers', papers], ['Confirmed Links', links], ['Suggestions', suggestions], ['Needs Attention', [...broken, ...errors]], ['Decisions', decisions]].map(([label, children]) => ({ root, kind: 'group', label: `${label as string} (${(children as Entry[]).length})`, children: children as Entry[] }));
  }

  const provider: vscode.TreeDataProvider<Entry> = {
    onDidChangeTreeData: changed.event,
    getChildren: item => item?.children ?? (item?.kind === 'project' ? treeEntries(item.root, states.get(item.root)!) : item ? [] : states.size === 1 ? treeEntries([...states.keys()][0]!, [...states.values()][0]!) : [...states].map(([root, state]) => ({ root, kind: 'project', label: state.folder.name }))),
    getTreeItem: item => {
      const tree = new vscode.TreeItem(item.label, item.children || item.kind === 'project' ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
      tree.contextValue = item.kind; if (item.description) tree.description = item.description; if (item.tooltip) tree.tooltip = item.tooltip;
      if (item.anchor) tree.command = { command: 'citetrace.open', title: 'Open Code', arguments: [item] };
      return tree;
    },
  };
  context.subscriptions.push(vscode.window.registerTreeDataProvider('citetrace', provider));

  async function rootFor(value?: unknown): Promise<string | undefined> {
    const explicit = entry(value)?.root;
    if (explicit && states.has(explicit)) return explicit;
    const uri = value instanceof vscode.Uri ? value : vscode.window.activeTextEditor?.document.uri.scheme === 'file' ? vscode.window.activeTextEditor.document.uri : vscode.window.activeNotebookEditor?.notebook.uri;
    const folder = uri ? vscode.workspace.getWorkspaceFolder(uri) : undefined;
    if (folder && states.has(folder.uri.fsPath)) return folder.uri.fsPath;
    if (states.size === 1) return [...states.keys()][0];
    if (!states.size) throw new Error('Open a local workspace folder first.');
    return (await vscode.window.showQuickPick([...states].map(([root, state]) => ({ label: state.folder.name, root })), { placeHolder: 'Choose a CiteTrace project' }))?.root;
  }
  function service(root: string): ProjectService {
    return new ProjectService(root, vscode.workspace.getConfiguration('citetrace', vscode.Uri.file(root)).get<boolean>('autoExport', false), overrides => scanInWorker(workerPath, root, overrides, new AbortController().signal));
  }
  const requireTrust = () => { if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before changing provenance. Read-only audit remains available.'); };
  async function chooseRelation(): Promise<LinkRelation | undefined> { const selected = await vscode.window.showQuickPick(relations, { placeHolder: 'How does this code relate to the paper?' }); return relations.find(relation => relation === selected); }

  async function chooseAnchor(root: string, value?: unknown): Promise<CodeAnchor | undefined> {
    const audit = await service(root).scan(await snapshots(root));
    const cellContext = value && typeof value === 'object' && 'notebook' in value && 'index' in value ? value as vscode.NotebookCell : undefined;
    const editor = vscode.window.activeTextEditor;
    const notebook = cellContext?.notebook ?? vscode.workspace.notebookDocuments.find(n => n.getCells().some(c => c.document.uri.toString() === editor?.document.uri.toString())) ?? vscode.window.activeNotebookEditor?.notebook;
    const cellIndex = cellContext?.index ?? notebook?.getCells().find(c => c.document.uri.toString() === editor?.document.uri.toString())?.index ?? vscode.window.activeNotebookEditor?.selection.start;
    const filename = editor?.document.uri.scheme === 'file' && extname(editor.document.uri.fsPath).toLowerCase() === '.py' ? editor.document.uri.fsPath : notebook?.uri.fsPath;
    const artifact = filename ? within(root, filename) : undefined;
    const units = artifact ? audit.analyses.filter(a => a.unit.artifact === artifact && (a.unit.kind === 'file' || a.unit.cell?.index === cellIndex)) : audit.analyses;
    const dirtyArtifacts = new Set<string>();
    for (const document of vscode.workspace.textDocuments) {
      const openArtifact = document.uri.scheme === 'file' ? within(root, document.uri.fsPath) : undefined;
      if (openArtifact && document.isDirty) dirtyArtifacts.add(openArtifact);
    }
    for (const openNotebook of vscode.workspace.notebookDocuments) {
      const openArtifact = openNotebook.uri.scheme === 'file' ? within(root, openNotebook.uri.fsPath) : undefined;
      if (openArtifact && openNotebook.isDirty) dirtyArtifacts.add(openArtifact);
    }
    const choices = units.flatMap(a => [
      { label: a.unit.kind === 'file' ? `File: ${a.unit.artifact}` : `Cell ${(a.unit.cell?.index ?? 0) + 1}: ${a.unit.artifact}`, description: scopeDescription(a.diagnostics.length ? 'Partial parsing; whole-scope manual link is available' : 'Whole scope', dirtyArtifacts.has(a.unit.artifact)), anchor: createAnchor(a) },
      ...a.symbols.map(s => ({ label: `${s.kind}: ${s.qualifiedName}`, description: scopeDescription(a.unit.artifact, dirtyArtifacts.has(a.unit.artifact)), anchor: createAnchor(a, s) })),
    ]).filter(choice => resolveAnchor(choice.anchor, audit.analyses).status === 'resolved');
    if (!choices.length) throw new Error('No unambiguous Python scope is available. Save the file, check .gitignore, or identify the notebook language.');
    return (await vscode.window.showQuickPick(choices, { placeHolder: units.some(a => dirtyArtifacts.has(a.unit.artifact)) ? 'Choose code scope; unsaved choices require saving or may need relinking if edits are discarded' : 'Choose code scope' }))?.anchor;
  }

  function command(id: string, handler: (value?: unknown) => Promise<void>, writes = false): void {
    context.subscriptions.push(vscode.commands.registerCommand(`citetrace.${id}`, async (value?: unknown) => {
      try { if (writes) requireTrust(); await handler(value); }
      catch (error) { if (error instanceof Error && error.name === 'AbortError') return; output.appendLine(String(error)); await vscode.window.showErrorMessage(`CiteTrace: ${error instanceof Error ? error.message : String(error)}`); }
      finally { if (writes) for (const state of states.values()) state.scanner.schedule(); }
    }));
  }
  command('init', async value => { const root = await rootFor(value); if (root) await service(root).initialize(); }, true);
  command('refresh', async value => { const root = await rootFor(value); if (root) await states.get(root)!.scanner.run(); });
  command('addPaper', async value => {
    const root = await rootFor(value); if (!root) return;
    const kind = await vscode.window.showQuickPick(['DOI / arXiv', 'Manual metadata'], { placeHolder: 'Add research paper' }); if (!kind) return;
    let metadata: PaperInput;
    if (kind === 'Manual metadata') {
      const title = await vscode.window.showInputBox({ prompt: 'Paper title', ignoreFocusOut: true }); if (!title?.trim()) return;
      const authors = await vscode.window.showInputBox({ prompt: 'Authors separated by semicolons (optional)', ignoreFocusOut: true }); if (authors === undefined) return;
      const yearText = await vscode.window.showInputBox({ prompt: 'Year (optional)', validateInput: s => s && !/^\d{1,4}$/.test(s) ? 'Enter a year.' : undefined }); if (yearText === undefined) return;
      metadata = { title, authors: authors.split(';').map(s => s.trim()).filter(Boolean), metadataSource: 'manual', ...(yearText ? { year: Number(yearText) } : {}) };
    } else {
      const raw = await vscode.window.showInputBox({ prompt: 'DOI, arXiv ID, or URL', ignoreFocusOut: true }); if (!raw) return;
      let identifier: { kind: 'doi' | 'arxiv'; identifier: string };
      try { identifier = { kind: 'doi', identifier: normalizeDoi(raw) }; } catch { identifier = { kind: 'arxiv', identifier: normalizeArxivId(raw) }; }
      metadata = await lookupPaperMetadata(root, identifier, { offline: vscode.workspace.getConfiguration('citetrace', vscode.Uri.file(root)).get<boolean>('offline', false) });
    }
    const accept = await vscode.window.showQuickPick([{ label: 'Add this paper', description: metadata.title }, { label: 'Cancel' }], { title: `${metadata.authors.join(', ')}${metadata.year ? ` (${metadata.year})` : ''}`, placeHolder: `Metadata: ${metadata.metadataSource}. Review before adding.` });
    if (accept?.label === 'Add this paper') await service(root).add(metadata);
  }, true);
  command('link', async value => {
    const root = await rootFor(value); if (!root) return;
    const scope = await chooseAnchor(root, value); if (!scope) return;
    const state = await readLedger(root); if (!state.ledger) throw new Error('Initialize this project first.');
    const paper = await vscode.window.showQuickPick(state.ledger.papers.map(p => ({ label: p.title, description: p.citationKey, id: p.id })), { placeHolder: 'Choose a paper (use Add Paper if the list is empty)' }); if (!paper) return;
    const relation = await chooseRelation(); if (!relation) return;
    const concept = await vscode.window.showQuickPick([{ label: 'No detector concept', id: '' }, ...conceptRegistry.map(c => ({ label: c.name, id: c.id }))], { placeHolder: 'Optional concept: this link covers only the chosen method' }); if (!concept) return;
    const note = await vscode.window.showInputBox({ prompt: 'Note about how this code uses the paper (optional)', ignoreFocusOut: true }); if (note === undefined) return;
    const referenceUrl = await vscode.window.showInputBox({ prompt: 'Repository reference URL for this code (optional)', ignoreFocusOut: true, validateInput: value => {
      if (!value.trim()) return undefined;
      try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? undefined : 'Use an http or https URL.'; }
      catch { return 'Enter a valid URL.'; }
    } }); if (referenceUrl === undefined) return;
    await service(root).link(paper.id, scope, relation, { ...(concept.id ? { conceptId: concept.id } : {}), ...(note.trim() ? { note } : {}), ...(referenceUrl.trim() ? { referenceUrl } : {}) }, await snapshots(root));
  }, true);
  command('export', async value => {
    const root = await rootFor(value); if (!root) return;
    const state = await readLedger(root); if (!state.ledger) throw new Error('Initialize this project first.');
    const file = await exportBibliography(root, state.ledger);
    await vscode.window.showTextDocument(vscode.Uri.file(resolve(root, file)));
  }, true);
  command('open', async value => {
    const item = entry(value); if (!item?.anchor) return;
    const audit = await service(item.root).scan(await snapshots(item.root));
    const result = resolveAnchor(item.anchor, audit.analyses);
    if (result.status !== 'resolved') throw new Error(`Link is ${result.status}; use Relink to choose the current code.`);
    const file = vscode.Uri.file(resolve(item.root, result.target.artifact));
    if (!within(item.root, file.fsPath)) throw new Error('Code path is outside the workspace.');
    if (result.target.kind === 'cell') {
      const notebook = await vscode.workspace.openNotebookDocument(file);
      const index = result.target.cell!.index;
      const editor = await vscode.window.showNotebookDocument(notebook, { selections: [new vscode.NotebookRange(index, index + 1)] });
      editor.revealRange(new vscode.NotebookRange(index, index + 1));
      if (result.target.range) await vscode.window.showTextDocument(notebook.cellAt(index).document, { selection: asRange(result.target.range) });
    } else await vscode.window.showTextDocument(file, result.target.range ? { selection: asRange(result.target.range) } : {});
  });
  async function pickRecord(root: string, kind: 'link' | 'decision', value: unknown): Promise<string | undefined> {
    const selected = entry(value); if (selected?.kind === kind) return selected.recordId;
    const audit = await service(root).scan(await snapshots(root));
    const choices = kind === 'link' ? audit.ledger.links.map(l => ({ label: `${l.anchor.artifact}: ${l.anchor.symbol?.qualifiedName ?? 'whole scope'}`, description: audit.ledger.papers.find(p => p.id === l.paperId)?.title ?? '', id: l.id })) : audit.ledger.decisions.map(d => ({ label: `${d.kind}: ${d.conceptId}`, description: d.anchor.artifact, id: d.id }));
    return (await vscode.window.showQuickPick(choices, { placeHolder: `Choose ${kind}` }))?.id;
  }
  command('unlink', async value => {
    const root = await rootFor(value); if (!root) return; const id = await pickRecord(root, 'link', value); if (!id) return;
    const state = await readLedger(root); if (!state.ledger) return;
    removeLink(state.ledger, id); await service(root).commit(state.ledger, state.revision, true);
  }, true);
  command('relink', async value => {
    const root = await rootFor(value); if (!root) return; const id = await pickRecord(root, 'link', value); if (!id) return;
    const anchor = await chooseAnchor(root); if (!anchor) return;
    const audit = await service(root).scan(await snapshots(root));
    const resolution = resolveAnchor(anchor, audit.analyses);
    if (resolution.status !== 'resolved' || resolution.needsReview) throw new Error('Code changed. Choose the scope again.');
    const link = audit.ledger.links.find(l => l.id === id); if (!link) throw new Error('Link no longer exists.');
    link.anchor = anchor; await service(root).commit(audit.ledger, audit.revision, true);
  }, true);
  command('sync', async value => {
    const root = await rootFor(value); if (!root) return;
    const audit = await service(root).scan(await snapshots(root)); if (!audit.initialized) throw new Error('Initialize this project first.');
    for (const { link, resolution } of audit.links) if (resolution.status === 'resolved' && !resolution.needsReview) {
      const analysis = audit.analyses.find(a => a.unit.artifact === resolution.target.artifact && a.unit.cell?.index === resolution.target.cell?.index)!;
      link.anchor = createAnchor(analysis, analysis.symbols.find(s => s.qualifiedName === resolution.target.symbol));
    }
    await service(root).commit(audit.ledger, audit.revision);
  }, true);
  for (const action of ['accept', 'ignore', 'exempt', 'reject'] as const) command(action, async value => {
    const root = await rootFor(value); if (!root) return;
    const initial = await service(root).scan(await snapshots(root));
    let id = entry(value)?.kind === 'suggestion' ? entry(value)?.recordId : undefined;
    if (!id) id = (await vscode.window.showQuickPick(initial.suggestions.filter(s => s.status === 'unresolved').map(s => ({ label: `${s.conceptId}: ${s.anchor.symbol?.qualifiedName ?? s.anchor.artifact}`, id: s.id })), { placeHolder: 'Choose suggestion' }))?.id;
    if (!id) return;
    const suggestion = initial.suggestions.find(s => s.id === id); if (!suggestion) throw new Error('Suggestion changed. Refresh and choose it again.');
    let reason: string | undefined; let paperId: string | undefined; let candidateId: string | undefined; let relation: LinkRelation | undefined;
    if (action === 'exempt') { reason = await vscode.window.showInputBox({ prompt: 'Why is no source link needed for this scope?', validateInput: s => s.trim() ? undefined : 'A reason is required.' }); if (!reason) return; }
    if (action === 'accept' || action === 'reject') {
      const candidates = conceptRegistry.filter(c => suggestion.candidateIds.includes(c.paper.id)).map(c => ({ label: c.paper.title, description: `${c.paper.authors.join(', ')} (${c.paper.year}) · candidate`, candidateId: c.paper.id, paperId: '' }));
      const existing = action === 'accept' ? initial.ledger.papers.map(p => ({ label: p.title, description: `${p.citationKey} · existing paper`, candidateId: '', paperId: p.id })) : [];
      const picked = await vscode.window.showQuickPick([...candidates, ...existing], { placeHolder: action === 'accept' ? 'Review and choose the paper for this code' : 'Which candidate is the wrong paper?' }); if (!picked) return;
      candidateId = picked.candidateId || undefined; paperId = picked.paperId || undefined;
      if (action === 'accept') { relation = await chooseRelation(); if (!relation) return; }
    }
    const current = await service(root).scan(await snapshots(root)); if (!current.initialized) throw new Error('Initialize this project first.');
    const fresh = current.suggestions.find(s => s.id === id && s.status === 'unresolved'); if (!fresh) throw new Error('Suggestion changed or was already handled. Refresh and choose again.');
    if (action === 'accept') acceptSuggestion(current.ledger, fresh, { relation: relation!, ...(paperId ? { paperId } : {}), ...(candidateId ? { candidateId } : {}) });
    else recordDecision(current.ledger, fresh, action === 'reject' ? 'reject-paper' : action, { ...(reason ? { reason } : {}), ...(candidateId ? { paperId: candidateId } : {}) });
    await service(root).commit(current.ledger, current.revision, action === 'accept');
  }, true);
  command('reopen', async value => {
    const root = await rootFor(value); if (!root) return; const id = await pickRecord(root, 'decision', value); if (!id) return;
    const state = await readLedger(root); if (!state.ledger) return;
    reopenDecision(state.ledger, id); await service(root).commit(state.ledger, state.revision);
  }, true);
  command('pythonNotebook', async () => {
    const notebook = vscode.window.activeNotebookEditor?.notebook;
    if (!notebook) throw new Error('Open the notebook first.');
    pythonNotebooks.add(notebook.uri.toString());
    for (const state of states.values()) state.scanner.schedule();
  });

  context.subscriptions.push(vscode.languages.registerHoverProvider([{ language: 'python', scheme: 'file' }, { language: 'python', scheme: 'vscode-notebook-cell' }], {
    provideHover(document, position) {
      for (const [root, state] of states) if (state.audit) {
        const parts: string[] = [];
        for (const { link, resolution } of state.audit.links) if (resolution.status === 'resolved') {
          const uri = uriFor(root, { ...link.anchor, artifact: resolution.target.artifact }, resolution.target.cell?.index);
          if (uri?.toString() === document.uri.toString() && (!resolution.target.range || asRange(resolution.target.range).contains(position))) {
            const paper = state.audit.ledger.papers.find(p => p.id === link.paperId);
            parts.push(`${paper?.title ?? link.paperId}\nHuman confirmed: ${link.relation}${resolution.needsReview ? ' · code needs review' : ''}`);
          }
        }
        if (parts.length) { const text = new vscode.MarkdownString(); text.appendText(parts.join('\n\n')); return new vscode.Hover(text); }
      }
      return undefined;
    },
  }));
  const rescan = () => { for (const state of states.values()) state.scanner.schedule(); };
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => { ensureStates(); changed.fire(undefined); diagnostics(); }), vscode.workspace.onDidOpenTextDocument(rescan), vscode.workspace.onDidChangeTextDocument(e => { if (e.document.languageId === 'python' || e.document.uri.scheme === 'vscode-notebook-cell') rescan(); }), vscode.workspace.onDidSaveTextDocument(rescan), vscode.workspace.onDidOpenNotebookDocument(rescan), vscode.workspace.onDidChangeNotebookDocument(rescan), vscode.workspace.onDidCloseNotebookDocument(rescan));
  for (const glob of ['**/*.py', '**/*.ipynb', '**/.gitignore', '**/.citetrace/ledger.json']) {
    const watcher = vscode.workspace.createFileSystemWatcher(glob);
    context.subscriptions.push(watcher, watcher.onDidCreate(rescan), watcher.onDidChange(rescan), watcher.onDidDelete(rescan));
  }
  context.subscriptions.push({ dispose: () => { for (const state of states.values()) state.scanner.dispose(); states.clear(); } });
  ensureStates();
  // Public API for automation and integration tests; UI commands use the same service.
  return {
    audit: async (requested: string) => { ensureStates(); const root = knownWorkspaceRoot(requested, states.keys()); return service(root).scan(await snapshots(root)); },
    service: (requested: string) => { requireTrust(); ensureStates(); const root = knownWorkspaceRoot(requested, states.keys()); return service(root); },
  };
}

export function deactivate(): void {}
