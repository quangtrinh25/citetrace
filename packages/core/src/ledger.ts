import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { join, posix, sep } from 'node:path';
import type { CodeAnchor } from './anchors.js';
import { normalizeArxivId, normalizeDoi } from './metadata.js';

export const LEDGER_SCHEMA_VERSION = 1 as const;
export type MetadataSource = 'manual' | 'doi' | 'arxiv' | 'registry';
export type LinkRelation = 'implements' | 'adapted-from' | 'uses-method' | 'background-reference';
export type DecisionKind = 'ignore' | 'exempt' | 'reject-paper';

export interface Paper {
  id: string;
  citationKey: string;
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  arxiv?: string;
  url?: string;
  metadataSource: MetadataSource;
}

export interface ResearchLink {
  id: string;
  paperId: string;
  anchor: CodeAnchor;
  relation: LinkRelation;
  conceptId?: string;
  actor: 'human';
  createdAt: string;
  note?: string;
  referenceUrl?: string;
}

export interface Decision {
  id: string;
  kind: DecisionKind;
  conceptId: string;
  anchor: CodeAnchor;
  fingerprint: string;
  createdAt: string;
  reason?: string;
  paperId?: string;
}

export interface Ledger {
  schemaVersion: 1;
  papers: Paper[];
  links: ResearchLink[];
  decisions: Decision[];
}

export type PaperInput = Omit<Paper, 'id' | 'citationKey'> & { id?: string; citationKey?: string };
export type PaperPatch = Partial<Omit<Paper, 'id' | 'citationKey'>>;
export type LinkInput = Omit<ResearchLink, 'id' | 'createdAt'> & { id?: string; createdAt?: string };
export interface RemovedPaper { paper: Paper; links: ResearchLink[] }
export interface LedgerReadResult { ledger: Ledger | null; revision: string | null }

export class LedgerError extends Error {}
export class LedgerCorruptError extends LedgerError {}
export class LedgerConflictError extends LedgerError {}
export class LedgerLockedError extends LedgerError {}

const RELATIONS = new Set<LinkRelation>(['implements', 'adapted-from', 'uses-method', 'background-reference']);
const SOURCES = new Set<MetadataSource>(['manual', 'doi', 'arxiv', 'registry']);
const DECISIONS = new Set<DecisionKind>(['ignore', 'exempt', 'reject-paper']);

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const known = new Set(allowed);
  const unknown = Object.keys(value).filter(key => !known.has(key));
  if (unknown.length > 0) throw new LedgerCorruptError(`${label} contains unknown field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`);
}

function requiredString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new LedgerCorruptError(`${label} must be a non-empty string.`);
}
function validTimestamp(value: string): boolean { const time = Date.parse(value); return Number.isFinite(time) && new Date(time).toISOString() === value; }

export function validateArtifactPath(artifact: string): void {
  requiredString(artifact, 'Anchor artifact');
  const normalized = artifact.replaceAll('\\', '/');
  if (normalized !== artifact || posix.normalize(artifact) !== artifact || artifact === '.' || posix.isAbsolute(artifact) || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../') || normalized.includes('\0')) {
    throw new LedgerCorruptError('Anchor artifact must be a normalized project-relative path.');
  }
}

function validateAnchor(value: unknown): asserts value is CodeAnchor {
  if (!object(value) || value['schemaVersion'] !== 1) throw new LedgerCorruptError('Anchor schemaVersion must be 1.');
  exactKeys(value, ['schemaVersion', 'artifact', 'unitKind', 'unitFingerprint', 'cellId', 'symbol'], 'Anchor');
  requiredString(value['artifact'], 'Anchor artifact');
  validateArtifactPath(value['artifact']);
  if (value['unitKind'] !== 'file' && value['unitKind'] !== 'cell') throw new LedgerCorruptError('Anchor unitKind is invalid.');
  requiredString(value['unitFingerprint'], 'Anchor fingerprint');
  if (!/^[a-f0-9]{64}$/.test(value['unitFingerprint'])) throw new LedgerCorruptError('Anchor fingerprint must be a SHA-256 digest.');
  if (value['cellId'] !== undefined) requiredString(value['cellId'], 'Anchor cellId');
  if (typeof value['cellId'] === 'string' && !/^[A-Za-z0-9_-]{1,64}$/.test(value['cellId'])) throw new LedgerCorruptError('Anchor cellId is invalid.');
  if (value['unitKind'] === 'file' && value['cellId'] !== undefined) throw new LedgerCorruptError('File anchors cannot contain a cellId.');
  if (value['symbol'] !== undefined) {
    const symbol = value['symbol'];
    if (!object(symbol) || !['class', 'function', 'method'].includes(String(symbol['kind']))) throw new LedgerCorruptError('Anchor symbol is invalid.');
    exactKeys(symbol, ['kind', 'qualifiedName', 'fingerprint'], 'Anchor symbol');
    requiredString(symbol['qualifiedName'], 'Anchor symbol qualifiedName');
    requiredString(symbol['fingerprint'], 'Anchor symbol fingerprint');
    if (!/^[a-f0-9]{64}$/.test(symbol['fingerprint'])) throw new LedgerCorruptError('Anchor symbol fingerprint must be a SHA-256 digest.');
  }
}

function validatePaper(value: unknown): asserts value is Paper {
  if (!object(value)) throw new LedgerCorruptError('Paper must be an object.');
  exactKeys(value, ['id', 'citationKey', 'title', 'authors', 'year', 'doi', 'arxiv', 'url', 'metadataSource'], 'Paper');
  requiredString(value['id'], 'Paper id'); requiredString(value['citationKey'], 'Paper citationKey'); requiredString(value['title'], 'Paper title');
  if (!/^[A-Za-z0-9:._-]+$/.test(value['citationKey'])) throw new LedgerCorruptError('Paper citationKey contains unsafe characters.');
  if (!Array.isArray(value['authors']) || !value['authors'].every(author => typeof author === 'string' && author.trim() !== '')) throw new LedgerCorruptError('Paper authors must be strings.');
  if (value['year'] !== undefined && (!Number.isInteger(value['year']) || Number(value['year']) < 0)) throw new LedgerCorruptError('Paper year is invalid.');
  if (!SOURCES.has(value['metadataSource'] as MetadataSource)) throw new LedgerCorruptError('Paper metadataSource is invalid.');
  if (value['doi'] !== undefined && normalizeDoi(String(value['doi'])) !== value['doi']) throw new LedgerCorruptError('Paper DOI is not normalized.');
  if (value['arxiv'] !== undefined && normalizeArxivId(String(value['arxiv'])) !== value['arxiv']) throw new LedgerCorruptError('Paper arXiv ID is not normalized.');
  if (value['url'] !== undefined) requiredString(value['url'], 'Paper URL');
}

export function validateLedger(value: unknown): asserts value is Ledger {
  if (!object(value) || value['schemaVersion'] !== 1 || !Array.isArray(value['papers']) || !Array.isArray(value['links']) || !Array.isArray(value['decisions'])) {
    throw new LedgerCorruptError('Ledger must use schemaVersion 1 with papers, links and decisions arrays.');
  }
  exactKeys(value, ['schemaVersion', 'papers', 'links', 'decisions'], 'Ledger');
  value['papers'].forEach(validatePaper);
  const paperIds = new Set(value['papers'].map(paper => paper.id));
  if (paperIds.size !== value['papers'].length) throw new LedgerCorruptError('Paper ids must be unique.');
  if (new Set(value['papers'].map(paper => paper.citationKey)).size !== value['papers'].length) throw new LedgerCorruptError('Paper citation keys must be unique.');
  const dois = value['papers'].flatMap(paper => paper.doi ? [paper.doi] : []);
  const arxivs = value['papers'].flatMap(paper => paper.arxiv ? [paper.arxiv] : []);
  if (new Set(dois).size !== dois.length || new Set(arxivs).size !== arxivs.length) throw new LedgerCorruptError('Paper identifiers must be unique.');
  const ids = new Set<string>();
  for (const link of value['links']) {
    if (!object(link)) throw new LedgerCorruptError('Link must be an object.');
    exactKeys(link, ['id', 'paperId', 'anchor', 'relation', 'conceptId', 'actor', 'createdAt', 'note', 'referenceUrl'], 'Link');
    requiredString(link['id'], 'Link id'); requiredString(link['paperId'], 'Link paperId'); requiredString(link['createdAt'], 'Link createdAt');
    if (!validTimestamp(link['createdAt'])) throw new LedgerCorruptError('Link createdAt must be an ISO timestamp.');
    if (ids.has(link['id'])) throw new LedgerCorruptError('Link ids must be unique.'); ids.add(link['id']);
    if (!paperIds.has(link['paperId'])) throw new LedgerCorruptError(`Link references missing paper ${link['paperId']}.`);
    if (!RELATIONS.has(link['relation'] as LinkRelation) || link['actor'] !== 'human') throw new LedgerCorruptError('Link relation or actor is invalid.');
    validateAnchor(link['anchor']);
    for (const field of ['conceptId', 'note', 'referenceUrl'] as const) if (link[field] !== undefined) requiredString(link[field], `Link ${field}`);
  }
  for (const decision of value['decisions']) {
    if (!object(decision)) throw new LedgerCorruptError('Decision must be an object.');
    exactKeys(decision, ['id', 'kind', 'conceptId', 'anchor', 'fingerprint', 'createdAt', 'reason', 'paperId'], 'Decision');
    requiredString(decision['id'], 'Decision id'); requiredString(decision['conceptId'], 'Decision conceptId'); requiredString(decision['fingerprint'], 'Decision fingerprint'); requiredString(decision['createdAt'], 'Decision createdAt');
    if (!validTimestamp(decision['createdAt'])) throw new LedgerCorruptError('Decision createdAt must be an ISO timestamp.');
    if (!/^[a-f0-9]{64}$/.test(decision['fingerprint'])) throw new LedgerCorruptError('Decision fingerprint must be a SHA-256 digest.');
    if (ids.has(decision['id'])) throw new LedgerCorruptError('Ledger ids must be unique.'); ids.add(decision['id']);
    if (!DECISIONS.has(decision['kind'] as DecisionKind)) throw new LedgerCorruptError('Decision kind is invalid.');
    validateAnchor(decision['anchor']);
    if (decision['paperId'] !== undefined) requiredString(decision['paperId'], 'Decision paperId');
    if (decision['reason'] !== undefined) requiredString(decision['reason'], 'Decision reason');
  }
  const links = value['links'] as ResearchLink[];
  for (let index = 0; index < links.length; index += 1) for (let other = index + 1; other < links.length; other += 1) {
    const left = links[index]!; const right = links[other]!;
    if (left.paperId === right.paperId && left.conceptId === right.conceptId && sameScope(left.anchor, right.anchor)) throw new LedgerCorruptError('Duplicate paper, concept and code scope link.');
  }
}

export function emptyLedger(): Ledger { return { schemaVersion: 1, papers: [], links: [], decisions: [] }; }

function hash(contents: string | Buffer): string { return createHash('sha256').update(contents).digest('hex'); }
async function citetraceDirectory(root: string, create: boolean): Promise<string | undefined> {
  const actualRoot = await realpath(root); const directory = join(actualRoot, '.citetrace');
  try {
    const stat = await lstat(directory);
    if (stat.isSymbolicLink()) throw new LedgerError('.citetrace must not be a symlink.');
    if (!stat.isDirectory()) throw new LedgerError('.citetrace must be a directory.');
    const actualDirectory = await realpath(directory);
    if (!actualDirectory.startsWith(`${actualRoot}${sep}`)) throw new LedgerError('.citetrace resolves outside the project.');
    return directory;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (!create) return undefined;
    await mkdir(directory, { mode: 0o700 }); return directory;
  }
}

async function checkedLedgerPath(root: string, createDirectory: boolean): Promise<string | undefined> {
  const directory = await citetraceDirectory(root, createDirectory); if (!directory) return undefined;
  const target = join(directory, 'ledger.json');
  try { if ((await lstat(target)).isSymbolicLink()) throw new LedgerError('ledger.json must not be a symlink.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return target;
}

export async function readLedger(root: string): Promise<LedgerReadResult> {
  const target = await checkedLedgerPath(root, false); if (!target) return { ledger: null, revision: null };
  let contents: string;
  try { contents = await readFile(target, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ledger: null, revision: null };
    throw error;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(contents); }
  catch { throw new LedgerCorruptError('CiteTrace ledger is corrupt JSON; repair it before continuing.'); }
  validateLedger(parsed);
  return { ledger: parsed, revision: hash(contents) };
}

export async function writeLedger(root: string, ledger: Ledger, expectedRevision: string | null): Promise<string> {
  validateLedger(ledger);
  const target = (await checkedLedgerPath(root, true))!; const directory = join(target, '..');
  const lockPath = join(directory, 'ledger.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new LedgerLockedError('Ledger is locked by another writer; retry after it finishes.');
    throw error;
  }
  const temporary = join(directory, `.ledger.${process.pid}.${randomUUID()}.tmp`);
  try {
    const current = await readLedger(root);
    if (current.revision !== expectedRevision) throw new LedgerConflictError('Ledger changed since it was read; reload and retry.');
    const contents = `${JSON.stringify(ledger, null, 2)}\n`;
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(contents, 'utf8'); await file.sync(); } finally { await file.close(); }
    await rename(temporary, target);
    if (process.platform !== 'win32') {
      const directoryHandle = await open(directory, 'r');
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    }
    return hash(contents);
  } finally {
    try { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
    finally {
      try { await lock.close(); }
      finally { await unlink(lockPath).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
    }
  }
}

function slug(value: string): string { return value.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '').toLowerCase(); }
function familyName(author: string): string { return author.includes(',') ? author.split(',')[0]!.trim() : author.trim().split(/\s+/).at(-1)!; }
function citationKey(input: PaperInput, used: Set<string>): string {
  const word = input.title.split(/\s+/).map(slug).find(part => part.length > 2) ?? 'paper';
  const base = `${slug(familyName(input.authors[0] ?? 'anon')) || 'anon'}${input.year ?? ''}${word}`;
  let candidate = base; let suffix = 2;
  while (used.has(candidate)) candidate = `${base}${suffix++}`;
  return candidate;
}

export function addPaper(ledger: Ledger, input: PaperInput): Paper {
  if (!object(input)) throw new LedgerCorruptError('Paper input must be an object.');
  exactKeys(input, ['id', 'citationKey', 'title', 'authors', 'year', 'doi', 'arxiv', 'url', 'metadataSource'], 'Paper input');
  requiredString(input.title, 'Paper title');
  const doi = input.doi === undefined ? undefined : normalizeDoi(input.doi);
  const arxiv = input.arxiv === undefined ? undefined : normalizeArxivId(input.arxiv);
  if ((doi && ledger.papers.some(paper => paper.doi === doi)) || (arxiv && ledger.papers.some(paper => paper.arxiv === arxiv))) throw new LedgerConflictError('A paper with that identifier already exists.');
  const paper: Paper = {
    id: input.id ?? `paper-${randomUUID()}`,
    citationKey: input.citationKey ?? citationKey(input, new Set(ledger.papers.map(item => item.citationKey))),
    title: input.title.trim(), authors: input.authors.map(author => author.trim()), metadataSource: input.metadataSource,
    ...(input.year !== undefined ? { year: input.year } : {}), ...(doi ? { doi } : {}), ...(arxiv ? { arxiv } : {}),
    ...(input.url ? { url: input.url } : {}),
  };
  validatePaper(paper);
  if (ledger.papers.some(item => item.id === paper.id || item.citationKey === paper.citationKey)) throw new LedgerConflictError('Paper id or citation key already exists.');
  ledger.papers.push(paper); return paper;
}

export function updatePaper(ledger: Ledger, id: string, patch: PaperPatch): Paper {
  if (!object(patch)) throw new LedgerCorruptError('Paper patch must be an object.');
  exactKeys(patch, ['title', 'authors', 'year', 'doi', 'arxiv', 'url', 'metadataSource'], 'Paper patch');
  const next = structuredClone(ledger); const paper = next.papers.find(item => item.id === id);
  if (!paper) throw new LedgerConflictError(`Paper ${id} does not exist.`);
  if (patch.title !== undefined) paper.title = patch.title.trim();
  if (patch.authors !== undefined) paper.authors = patch.authors.map(author => author.trim());
  if (patch.year !== undefined) paper.year = patch.year;
  if (patch.doi !== undefined) paper.doi = normalizeDoi(patch.doi);
  if (patch.arxiv !== undefined) paper.arxiv = normalizeArxivId(patch.arxiv);
  if (patch.url !== undefined) paper.url = patch.url.trim();
  if (patch.metadataSource !== undefined) paper.metadataSource = patch.metadataSource;
  validateLedger(next);
  ledger.papers = next.papers; return ledger.papers.find(item => item.id === id)!;
}

export function removePaper(ledger: Ledger, id: string, options: { removeLinks?: boolean } = {}): RemovedPaper {
  const index = ledger.papers.findIndex(paper => paper.id === id); if (index < 0) throw new LedgerConflictError(`Paper ${id} does not exist.`);
  const links = ledger.links.filter(link => link.paperId === id);
  if (links.length > 0 && !options.removeLinks) throw new LedgerConflictError(`Paper ${id} has ${links.length} link(s); pass removeLinks explicitly to avoid orphaning them.`);
  const paper = ledger.papers.splice(index, 1)[0]!;
  if (links.length > 0) ledger.links = ledger.links.filter(link => link.paperId !== id);
  return { paper, links };
}

export function mergePapers(ledger: Ledger, keepId: string, removeId: string): Paper {
  if (keepId === removeId) throw new LedgerConflictError('Choose two different papers to merge.');
  const next = structuredClone(ledger); const keep = next.papers.find(paper => paper.id === keepId); const removed = next.papers.find(paper => paper.id === removeId);
  if (!keep || !removed) throw new LedgerConflictError('Both papers must exist before they can be merged.');
  if (keep.doi && removed.doi && keep.doi !== removed.doi) throw new LedgerConflictError('Cannot merge papers with conflicting DOI identifiers.');
  if (keep.arxiv && removed.arxiv && keep.arxiv !== removed.arxiv) throw new LedgerConflictError('Cannot merge papers with conflicting arXiv identifiers.');
  if (!keep.doi && removed.doi) keep.doi = removed.doi;
  if (!keep.arxiv && removed.arxiv) keep.arxiv = removed.arxiv;
  if (!keep.url && removed.url) keep.url = removed.url;
  if (keep.year === undefined && removed.year !== undefined) keep.year = removed.year;
  if (keep.authors.length === 0 && removed.authors.length > 0) keep.authors = [...removed.authors];
  next.links.forEach(link => { if (link.paperId === removeId) link.paperId = keepId; });
  next.papers = next.papers.filter(paper => paper.id !== removeId); validateLedger(next);
  ledger.papers = next.papers; ledger.links = next.links; return ledger.papers.find(paper => paper.id === keepId)!;
}

function sameScope(a: CodeAnchor, b: CodeAnchor): boolean {
  const sameUnit = a.unitKind === 'cell' && a.cellId === undefined && b.cellId === undefined
    ? a.unitFingerprint === b.unitFingerprint
    : a.cellId === b.cellId;
  return a.artifact === b.artifact && a.unitKind === b.unitKind && sameUnit && a.symbol?.qualifiedName === b.symbol?.qualifiedName;
}

export function addLink(ledger: Ledger, input: LinkInput): ResearchLink {
  if (!object(input)) throw new LedgerCorruptError('Link input must be an object.');
  exactKeys(input, ['id', 'paperId', 'anchor', 'relation', 'conceptId', 'actor', 'createdAt', 'note', 'referenceUrl'], 'Link input');
  if (!ledger.papers.some(paper => paper.id === input.paperId)) throw new LedgerConflictError('Cannot link a missing paper.');
  if (ledger.links.some(link => link.paperId === input.paperId && link.conceptId === input.conceptId && sameScope(link.anchor, input.anchor))) throw new LedgerConflictError('That paper and concept are already linked to this code scope.');
  const link: ResearchLink = { ...input, id: input.id ?? `link-${randomUUID()}`, createdAt: input.createdAt ?? new Date().toISOString() };
  validateLedger({ ...ledger, links: [...ledger.links, link] });
  ledger.links.push(link); return link;
}

export function removeLink(ledger: Ledger, id: string): ResearchLink {
  const index = ledger.links.findIndex(link => link.id === id);
  if (index < 0) throw new LedgerConflictError(`Link ${id} does not exist.`);
  return ledger.links.splice(index, 1)[0]!;
}
