#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import {
  acceptSuggestion, addLink, addPaper, analyzePython, auditProject, createAnchor, emptyLedger, exportBibliography,
  lookupPaperMetadata, normalizeArxivId, normalizeDoi, readArtifact, readLedger,
  readNotebook, recordDecision, refreshPaper, removeLink, removePaper, mergePapers,
  reopenDecision, updatePaper, writeLedger,
  type AnchorResolution, type CodeAnchor, type LinkRelation,
  type PaperInput, type PaperPatch, type SourceDiagnostic, type SourceUnit,
} from '@citetrace/core';

const help = `CiteTrace — durable research provenance

Usage:
  citetrace inspect <file.py|notebook.ipynb>... [--json]
  citetrace init [--json]
  citetrace add <DOI|arXiv> [--offline] [--json]
  citetrace add --title <title> [--author <name>]... [--year <year>] [--doi <doi>] [--arxiv <id>] [--json]
  citetrace papers [--json]
  citetrace paper update <paperId> [--title <title>] [--author <name>]... [--year <year>] [--doi <doi>] [--arxiv <id>] [--url <url>] [--json]
  citetrace paper refresh <paperId> [--offline] [--json]
  citetrace paper remove <paperId> [--remove-links] [--json]
  citetrace paper merge <keepPaperId> <removePaperId> [--json]
  citetrace link <paperId> <path> [--symbol <qualifiedName>] [--cell <id|one-based-index>] --relation <relation> [--concept <id>] [--note <text>] [--json]
  citetrace unlink <linkId> [--json]
  citetrace audit [--json]
  citetrace export [--output <path>] [--force] [--json]
  citetrace sync [--json]
  citetrace relink <linkId> <path> [--symbol <qualifiedName>] [--cell <id|one-based-index>] [--json]
  citetrace decide <suggestionId> <accept|ignore|exempt|reject-paper> [--reason <text>] [--paper <id>] [--relation <relation>] [--json]
  citetrace decisions [--json]
  citetrace reopen <decisionId> [--json]

Relations: implements, adapted-from, uses-method, background-reference.
No command sends source code over the network; add and paper refresh perform metadata lookup only when explicitly requested.
`;

interface ParsedArgs { positional: string[]; options: Map<string, string[]>; flags: Set<string> }
function parseArgs(args: string[], valueOptions: string[], booleanOptions: string[] = ['json']): ParsedArgs {
  const values = new Set(valueOptions); const booleans = new Set(booleanOptions);
  const result: ParsedArgs = { positional: [], options: new Map(), flags: new Set() };
  let positionalOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (!positionalOnly && argument === '--') { positionalOnly = true; continue; }
    if (positionalOnly || !argument.startsWith('-')) { result.positional.push(argument); continue; }
    if (!argument.startsWith('--')) throw new Error(`Unknown option: ${argument}`);
    const name = argument.slice(2);
    if (booleans.has(name)) { result.flags.add(name); continue; }
    if (!values.has(name)) throw new Error(`Unknown option: ${argument}`);
    const value = args[++index];
    if (value === undefined || value.startsWith('--')) throw new Error(`Option ${argument} requires a value.`);
    result.options.set(name, [...(result.options.get(name) ?? []), value]);
  }
  return result;
}
function one(parsed: ParsedArgs, name: string): string | undefined {
  const values = parsed.options.get(name);
  if ((values?.length ?? 0) > 1 && name !== 'author') throw new Error(`Option --${name} may only be used once.`);
  return values?.[0];
}
function output(json: boolean, value: unknown, message: string): void { process.stdout.write(json ? `${JSON.stringify(value, null, 2)}\n` : `${message}\n`); }
function exactly(values: string[], count: number, usage: string): void { if (values.length !== count) throw new Error(usage); }
async function requireLedger(root: string) {
  const result = await readLedger(root);
  if (!result.ledger) throw new Error('CiteTrace is not initialized. Run `citetrace init` first.');
  return { ledger: result.ledger, revision: result.revision };
}

async function inspect(filename: string) {
  const absolute = resolve(filename); const artifact = relative(process.cwd(), absolute).split(sep).join('/');
  const diagnostics: SourceDiagnostic[] = []; const units = [];
  try {
    if (artifact === '..' || artifact.startsWith('../')) throw new Error('Choose a file inside the current project directory.');
    const extension = extname(filename).toLowerCase();
    if (extension !== '.py' && extension !== '.ipynb') throw new Error('Only .py and Python .ipynb inputs are supported.');
    const source = await readFile(absolute, 'utf8');
    const input = extension === '.ipynb' ? readNotebook(artifact, source) : { units: [{ artifact, kind: 'file', source } satisfies SourceUnit], diagnostics: [] };
    diagnostics.push(...input.diagnostics);
    for (const unit of input.units) {
      const analysis = await analyzePython(unit); diagnostics.push(...analysis.diagnostics);
      units.push({ kind: unit.kind, ...(unit.cell ? { cell: unit.cell } : {}), fingerprint: analysis.fingerprint, anchor: createAnchor(analysis), symbols: analysis.symbols.map(symbol => ({ ...symbol, anchor: createAnchor(analysis, symbol) })) });
    }
  } catch (error) { diagnostics.push({ artifact, code: 'read-error', severity: 'error', message: error instanceof Error ? error.message : String(error) }); }
  return { artifact, units, diagnostics };
}

async function inspectCommand(args: string[]): Promise<number> {
  const parsed = parseArgs(args, []); if (parsed.positional.length === 0) throw new Error('Provide at least one .py or .ipynb file.');
  const files = []; for (const filename of parsed.positional) files.push(await inspect(filename));
  if (parsed.flags.has('json')) process.stdout.write(`${JSON.stringify({ schemaVersion: 1, files }, null, 2)}\n`);
  else for (const file of files) {
    process.stdout.write(`${file.artifact}: ${file.units.length} code unit(s)\n`);
    for (const unit of file.units) {
      const cell = unit.cell ? `cell ${unit.cell.index + 1}${unit.cell.id ? ` (${unit.cell.id})` : ''} · ` : '';
      for (const symbol of unit.symbols) process.stdout.write(`  ${cell}${symbol.kind} ${symbol.qualifiedName} · line ${symbol.range.start.line + 1}\n`);
    }
    for (const diagnostic of file.diagnostics) process.stdout.write(`  ${diagnostic.severity}: ${diagnostic.message}\n`);
  }
  if (files.some(file => file.diagnostics.some(diagnostic => diagnostic.severity === 'error'))) return 1;
  return files.some(file => file.diagnostics.length > 0) ? 2 : 0;
}

async function selectAnchor(root: string, filename: string, cellSelector?: string, qualifiedName?: string): Promise<CodeAnchor> {
  const artifact = relative(resolve(root), resolve(root, filename)).split(sep).join('/');
  if (artifact === '..' || artifact.startsWith('../')) throw new Error('Choose a file inside the current project directory.');
  const source = await readArtifact(root, artifact); let units = source.units;
  if (units.length === 0) throw new Error(source.diagnostics[0]?.message ?? 'Artifact has no linkable Python code units.');
  if (cellSelector !== undefined) {
    if (extname(artifact).toLowerCase() !== '.ipynb') throw new Error('--cell is only valid for notebooks.');
    const numeric = /^\d+$/.test(cellSelector) ? Number(cellSelector) : undefined;
    if (numeric !== undefined && numeric < 1) throw new Error('Cell index must be one-based.');
    units = units.filter(unit => numeric === undefined ? unit.cell?.id === cellSelector : unit.cell?.index === numeric - 1);
    if (units.length !== 1) throw new Error(`Notebook cell ${cellSelector} is missing or ambiguous.`);
  } else if (units.length !== 1) throw new Error('Choose a notebook cell with --cell <id|one-based-index>.');
  const analysis = await analyzePython(units[0]!);
  if (qualifiedName === undefined) return createAnchor(analysis);
  const symbols = analysis.symbols.filter(symbol => symbol.qualifiedName === qualifiedName);
  if (symbols.length !== 1) throw new Error(`Symbol ${qualifiedName} is missing or ambiguous.`);
  return createAnchor(analysis, symbols[0]);
}

interface AuditedLink {
  id: string; paperId: string; status: 'confirmed' | 'needs-review' | 'ambiguous' | 'missing'; relocated: boolean; resolution: AnchorResolution; replacement?: CodeAnchor;
}
async function auditLedger(root: string) {
  const audit = await auditProject(root); if (!audit.initialized) throw new Error('CiteTrace is not initialized. Run `citetrace init` first.');
  const links: AuditedLink[] = audit.links.map(({ link, resolution }) => {
    let replacement: CodeAnchor | undefined;
    if (resolution.status === 'resolved') {
      const match = audit.analyses.find(item => item.unit.artifact === resolution.target.artifact && item.unit.kind === resolution.target.kind && item.unit.cell?.index === resolution.target.cell?.index);
      const symbol = match?.symbols.find(item => item.qualifiedName === resolution.target.symbol);
      if (match) replacement = createAnchor(match, symbol);
    }
    const relocated = replacement !== undefined && (replacement.artifact !== link.anchor.artifact || replacement.cellId !== link.anchor.cellId || replacement.symbol?.qualifiedName !== link.anchor.symbol?.qualifiedName);
    const status: AuditedLink['status'] = resolution.status === 'resolved' ? resolution.needsReview ? 'needs-review' : 'confirmed' : resolution.status;
    return { id: link.id, paperId: link.paperId, status, relocated, resolution, ...(replacement ? { replacement } : {}) };
  });
  return { links, suggestions: audit.suggestions, diagnostics: audit.diagnostics, counts: audit.counts };
}

async function initCommand(root: string, args: string[]): Promise<number> {
  const parsed = parseArgs(args, []); exactly(parsed.positional, 0, 'Usage: citetrace init [--json]'); const current = await readLedger(root);
  if (current.ledger) { output(parsed.flags.has('json'), { initialized: false, schemaVersion: 1 }, 'CiteTrace is already initialized.'); return 0; }
  await writeLedger(root, emptyLedger(), null); output(parsed.flags.has('json'), { initialized: true, schemaVersion: 1 }, 'Initialized .citetrace/ledger.json'); return 0;
}

async function addCommand(root: string, args: string[]): Promise<number> {
  const parsed = parseArgs(args, ['title', 'author', 'year', 'doi', 'arxiv', 'url'], ['json', 'offline']);
  if (parsed.positional.length > 1) throw new Error('Provide one DOI/arXiv identifier or manual metadata options.');
  const state = await requireLedger(root); const identifier = parsed.positional[0]; let metadata: PaperInput;
  const title = one(parsed, 'title'); const doi = one(parsed, 'doi'); const arxiv = one(parsed, 'arxiv');
  if (identifier || (!title && (doi || arxiv))) {
    if (identifier && (doi || arxiv || title)) throw new Error('Use either one identifier or manual metadata options.');
    const raw = identifier ?? doi ?? arxiv!; let lookup: { kind: 'doi' | 'arxiv'; identifier: string };
    if (arxiv) lookup = { kind: 'arxiv', identifier: raw };
    else if (doi) lookup = { kind: 'doi', identifier: raw };
    else { try { normalizeDoi(raw); lookup = { kind: 'doi', identifier: raw }; } catch { normalizeArxivId(raw); lookup = { kind: 'arxiv', identifier: raw }; } }
    metadata = await lookupPaperMetadata(root, lookup, { offline: parsed.flags.has('offline') });
  } else {
    if (!title) throw new Error('Manual paper metadata requires --title.');
    const yearText = one(parsed, 'year'); const year = yearText === undefined ? undefined : Number(yearText);
    if (yearText !== undefined && !Number.isInteger(year)) throw new Error('--year must be an integer.');
    const url = one(parsed, 'url');
    metadata = { title, authors: parsed.options.get('author') ?? [], metadataSource: 'manual', ...(year !== undefined ? { year } : {}), ...(doi ? { doi } : {}), ...(arxiv ? { arxiv } : {}), ...(url ? { url } : {}) };
  }
  const paper = addPaper(state.ledger, metadata); await writeLedger(root, state.ledger, state.revision);
  output(parsed.flags.has('json'), { paper }, `Added ${paper.id}: ${paper.title}`); return 0;
}

async function papersCommand(root: string, args: string[]): Promise<number> {
  const parsed = parseArgs(args, []); exactly(parsed.positional, 0, 'Usage: citetrace papers [--json]'); const { ledger } = await requireLedger(root);
  output(parsed.flags.has('json'), { papers: ledger.papers }, ledger.papers.length ? ledger.papers.map(paper => `${paper.id}  ${paper.citationKey}  ${paper.title}`).join('\n') : 'No papers.'); return 0;
}

async function paperCommand(root: string, args: string[]): Promise<number> {
  const action = args[0]; if (!action) throw new Error('Usage: citetrace paper <update|refresh|remove|merge> ...'); const rest = args.slice(1); const state = await requireLedger(root);
  if (action === 'update') {
    const parsed = parseArgs(rest, ['title', 'author', 'year', 'doi', 'arxiv', 'url']); exactly(parsed.positional, 1, 'Usage: citetrace paper update <paperId> [metadata options]');
    const patch: PaperPatch = { metadataSource: 'manual' }; const title = one(parsed, 'title'); const yearText = one(parsed, 'year'); const doi = one(parsed, 'doi'); const arxiv = one(parsed, 'arxiv'); const url = one(parsed, 'url');
    if (title !== undefined) patch.title = title; if (parsed.options.has('author')) patch.authors = parsed.options.get('author')!;
    if (yearText !== undefined) { const year = Number(yearText); if (!Number.isInteger(year)) throw new Error('--year must be an integer.'); patch.year = year; }
    if (doi !== undefined) patch.doi = doi; if (arxiv !== undefined) patch.arxiv = arxiv; if (url !== undefined) patch.url = url;
    if (Object.keys(patch).length === 1) throw new Error('Provide at least one metadata field to update.');
    const paper = updatePaper(state.ledger, parsed.positional[0]!, patch); await writeLedger(root, state.ledger, state.revision); output(parsed.flags.has('json'), { paper }, `Updated ${paper.id}.`); return 0;
  }
  if (action === 'refresh') {
    const parsed = parseArgs(rest, [], ['json', 'offline']); exactly(parsed.positional, 1, 'Usage: citetrace paper refresh <paperId> [--offline]');
    const paper = await refreshPaper(root, state.ledger, parsed.positional[0]!, { offline: parsed.flags.has('offline') }); await writeLedger(root, state.ledger, state.revision); output(parsed.flags.has('json'), { paper }, `Refreshed ${paper.id}.`); return 0;
  }
  if (action === 'remove') {
    const parsed = parseArgs(rest, [], ['json', 'remove-links']); exactly(parsed.positional, 1, 'Usage: citetrace paper remove <paperId> [--remove-links]');
    const removed = removePaper(state.ledger, parsed.positional[0]!, { removeLinks: parsed.flags.has('remove-links') }); await writeLedger(root, state.ledger, state.revision); output(parsed.flags.has('json'), { removed }, `Removed ${removed.paper.id}${removed.links.length ? ` and ${removed.links.length} link(s)` : ''}.`); return 0;
  }
  if (action === 'merge') {
    const parsed = parseArgs(rest, []); exactly(parsed.positional, 2, 'Usage: citetrace paper merge <keepPaperId> <removePaperId>');
    const paper = mergePapers(state.ledger, parsed.positional[0]!, parsed.positional[1]!); await writeLedger(root, state.ledger, state.revision); output(parsed.flags.has('json'), { paper, removedPaperId: parsed.positional[1] }, `Merged ${parsed.positional[1]} into ${paper.id}.`); return 0;
  }
  throw new Error('Unknown paper action. Use update, refresh, remove or merge.');
}

async function linkCommand(root: string, args: string[]): Promise<number> {
  const parsed = parseArgs(args, ['symbol', 'cell', 'relation', 'concept', 'note', 'reference-url']); exactly(parsed.positional, 2, 'Usage: citetrace link <paperId> <path> --relation <relation>');
  const relation = one(parsed, 'relation') as LinkRelation | undefined;
  if (!relation || !['implements', 'adapted-from', 'uses-method', 'background-reference'].includes(relation)) throw new Error('Choose a valid --relation.');
  const state = await requireLedger(root); const anchor = await selectAnchor(root, parsed.positional[1]!, one(parsed, 'cell'), one(parsed, 'symbol'));
  const concept = one(parsed, 'concept'); const note = one(parsed, 'note'); const referenceUrl = one(parsed, 'reference-url');
  const link = addLink(state.ledger, { paperId: parsed.positional[0]!, anchor, relation, actor: 'human', ...(concept ? { conceptId: concept } : {}), ...(note ? { note } : {}), ...(referenceUrl ? { referenceUrl } : {}) });
  await writeLedger(root, state.ledger, state.revision); output(parsed.flags.has('json'), { link }, `Linked ${link.paperId} to ${link.anchor.artifact}.`); return 0;
}

async function unlinkCommand(root: string, args: string[]): Promise<number> {
  const parsed = parseArgs(args, []); exactly(parsed.positional, 1, 'Usage: citetrace unlink <linkId>'); const state = await requireLedger(root); const link = removeLink(state.ledger, parsed.positional[0]!);
  await writeLedger(root, state.ledger, state.revision); output(parsed.flags.has('json'), { link }, `Removed ${link.id}.`); return 0;
}

async function auditCommand(root: string, args: string[]): Promise<number> {
  const parsed = parseArgs(args, []); exactly(parsed.positional, 0, 'Usage: citetrace audit [--json]'); const result = await auditLedger(root);
  output(parsed.flags.has('json'), result, `Confirmed: ${result.counts.confirmed}\nUnresolved: ${result.counts.unresolved}\nExempt: ${result.counts.exempt}\nIgnored: ${result.counts.ignored}\nNeeds review: ${result.counts.needsReview}\nAmbiguous: ${result.counts.ambiguous}\nMissing: ${result.counts.missing}\nDiagnostics: ${result.diagnostics.length}`); return 0;
}

async function exportCommand(root: string, args: string[]): Promise<number> {
  const parsed = parseArgs(args, ['output'], ['json', 'force']); exactly(parsed.positional, 0, 'Usage: citetrace export [--output <path>] [--force]'); const { ledger } = await requireLedger(root); const target = one(parsed, 'output');
  const exported = await exportBibliography(root, ledger, { ...(target ? { output: target } : {}), force: parsed.flags.has('force') }); output(parsed.flags.has('json'), { output: exported }, `Exported ${exported}.`); return 0;
}

async function syncCommand(root: string, args: string[]): Promise<number> {
  const parsed = parseArgs(args, []); exactly(parsed.positional, 0, 'Usage: citetrace sync [--json]'); const state = await requireLedger(root); const audit = await auditLedger(root); const updated: string[] = [];
  for (const item of audit.links) if (item.status === 'confirmed' && item.relocated && item.replacement) {
    const link = state.ledger.links.find(candidate => candidate.id === item.id); if (link) { link.anchor = item.replacement; updated.push(item.id); }
  }
  if (updated.length) await writeLedger(root, state.ledger, state.revision);
  output(parsed.flags.has('json'), { updated, skipped: audit.links.length - updated.length }, updated.length ? `Updated ${updated.length} link location(s).` : 'No unambiguous unchanged locations to sync.'); return 0;
}

async function decideCommand(root: string, args: string[]): Promise<number> {
  const parsed = parseArgs(args, ['reason', 'paper', 'relation']); exactly(parsed.positional, 2, 'Usage: citetrace decide <suggestionId> <accept|ignore|exempt|reject-paper>');
  const state = await requireLedger(root); const audit = await auditProject(root); const suggestion = audit.suggestions.find(item => item.id === parsed.positional[0]);
  if (!suggestion) throw new Error(`Suggestion ${parsed.positional[0]} is not currently available.`);
  const action = parsed.positional[1]!; const reason = one(parsed, 'reason'); const selectedPaper = one(parsed, 'paper');
  if (action === 'accept') {
    const relation = (one(parsed, 'relation') ?? 'uses-method') as LinkRelation;
    if (!['implements', 'adapted-from', 'uses-method', 'background-reference'].includes(relation)) throw new Error('Choose a valid --relation.');
    const existing = selectedPaper ? state.ledger.papers.some(paper => paper.id === selectedPaper) : false;
    const selection: { paperId?: string; candidateId?: string } = {};
    if (selectedPaper !== undefined) { if (existing) selection.paperId = selectedPaper; else selection.candidateId = selectedPaper; }
    const link = acceptSuggestion(state.ledger, suggestion, { relation, ...selection, ...(reason ? { note: reason } : {}) });
    await writeLedger(root, state.ledger, state.revision); output(parsed.flags.has('json'), { link }, `Accepted ${suggestion.id} as ${link.id}.`); return 0;
  }
  if (!['ignore', 'exempt', 'reject-paper'].includes(action)) throw new Error('Decision must be accept, ignore, exempt or reject-paper.');
  if (one(parsed, 'relation') !== undefined) throw new Error('--relation is only valid when accepting a suggestion.');
  const decision = recordDecision(state.ledger, suggestion, action as 'ignore' | 'exempt' | 'reject-paper', { ...(reason ? { reason } : {}), ...(selectedPaper ? { paperId: selectedPaper } : {}) });
  await writeLedger(root, state.ledger, state.revision); output(parsed.flags.has('json'), { decision }, `Recorded ${decision.kind} decision ${decision.id}.`); return 0;
}

async function decisionsCommand(root: string, args: string[]): Promise<number> {
  const parsed = parseArgs(args, []); exactly(parsed.positional, 0, 'Usage: citetrace decisions [--json]'); const { ledger } = await requireLedger(root);
  output(parsed.flags.has('json'), { decisions: ledger.decisions }, ledger.decisions.length ? ledger.decisions.map(decision => `${decision.id}  ${decision.kind}  ${decision.conceptId}`).join('\n') : 'No decisions.'); return 0;
}

async function reopenCommand(root: string, args: string[]): Promise<number> {
  const parsed = parseArgs(args, []); exactly(parsed.positional, 1, 'Usage: citetrace reopen <decisionId>'); const state = await requireLedger(root); reopenDecision(state.ledger, parsed.positional[0]!); await writeLedger(root, state.ledger, state.revision);
  output(parsed.flags.has('json'), { reopened: parsed.positional[0] }, `Reopened ${parsed.positional[0]}.`); return 0;
}

async function relinkCommand(root: string, args: string[]): Promise<number> {
  const parsed = parseArgs(args, ['symbol', 'cell']); exactly(parsed.positional, 2, 'Usage: citetrace relink <linkId> <path>'); const state = await requireLedger(root);
  const link = state.ledger.links.find(item => item.id === parsed.positional[0]); if (!link) throw new Error(`Link ${parsed.positional[0]} does not exist.`);
  link.anchor = await selectAnchor(root, parsed.positional[1]!, one(parsed, 'cell'), one(parsed, 'symbol')); await writeLedger(root, state.ledger, state.revision);
  output(parsed.flags.has('json'), { link }, `Relinked ${link.id} to ${link.anchor.artifact}.`); return 0;
}

async function main(args: string[]): Promise<number> {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h' || args[1] === '--help') { process.stdout.write(help); return 0; }
  const root = process.cwd(); const rest = args.slice(1);
  switch (args[0]) {
    case 'inspect': return inspectCommand(rest); case 'init': return initCommand(root, rest); case 'add': return addCommand(root, rest); case 'papers': return papersCommand(root, rest); case 'paper': return paperCommand(root, rest);
    case 'link': return linkCommand(root, rest); case 'unlink': return unlinkCommand(root, rest); case 'audit': return auditCommand(root, rest); case 'export': return exportCommand(root, rest);
    case 'sync': return syncCommand(root, rest); case 'relink': return relinkCommand(root, rest); case 'decide': return decideCommand(root, rest); case 'decisions': return decisionsCommand(root, rest); case 'reopen': return reopenCommand(root, rest); default: throw new Error('Unknown command. Use citetrace --help.');
  }
}

try { process.exitCode = await main(process.argv.slice(2)); }
catch (error) { process.stderr.write(`CiteTrace: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
