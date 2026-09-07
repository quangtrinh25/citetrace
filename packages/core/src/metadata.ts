import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { updatePaper, type Ledger, type MetadataSource, type Paper, type PaperInput } from './ledger.js';

export type MetadataIdentifier = { kind: 'doi' | 'arxiv'; identifier: string };
export interface MetadataLookupOptions {
  offline?: boolean;
  fetch?: typeof globalThis.fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  retries?: number;
}

export function normalizeDoi(value: string): string {
  let normalized = value.trim().replace(/^doi:\s*/i, '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').toLowerCase();
  try { normalized = decodeURIComponent(normalized); } catch { /* validation below reports malformed input */ }
  normalized = normalized.replace(/[.,;]$/, '');
  if (!/^10\.\d{4,9}\/\S+$/i.test(normalized) || /[\s<>]/.test(normalized)) throw new Error(`Invalid DOI: ${value}`);
  return normalized;
}

export function normalizeArxivId(value: string): string {
  const normalized = value.trim().replace(/^arxiv:\s*/i, '').replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, '').replace(/\.pdf$/i, '');
  if (!/^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i.test(normalized)) throw new Error(`Invalid arXiv ID: ${value}`);
  return normalized;
}

const defaultSleep = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
function cacheFilename(input: MetadataIdentifier): string { return `${input.kind}-${createHash('sha256').update(input.identifier).digest('hex')}.json`; }

async function safeChildDirectory(parent: string, name: string, create: boolean): Promise<string | undefined> {
  const directory = join(parent, name);
  try {
    const stat = await lstat(directory);
    if (stat.isSymbolicLink()) throw new Error(`${name} cache path must not be a symlink.`);
    if (!stat.isDirectory()) throw new Error(`${name} cache path must be a directory.`);
    const actual = await realpath(directory);
    if (actual !== parent && !actual.startsWith(`${parent}${sep}`)) throw new Error(`${name} cache path resolves outside the project.`);
    return directory;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (!create) return undefined;
    try { await mkdir(directory, { mode: 0o700 }); return directory; }
    catch (mkdirError) {
      if ((mkdirError as NodeJS.ErrnoException).code === 'EEXIST') return safeChildDirectory(parent, name, false);
      throw mkdirError;
    }
  }
}

async function cacheDirectory(root: string, create: boolean): Promise<string | undefined> {
  const actualRoot = await realpath(root); const citetrace = await safeChildDirectory(actualRoot, '.citetrace', create); if (!citetrace) return undefined;
  return safeChildDirectory(citetrace, 'cache', create);
}

async function cachePath(root: string, input: MetadataIdentifier, create: boolean): Promise<string | undefined> {
  const cache = await cacheDirectory(root, create); if (!cache) return undefined;
  const target = join(cache, cacheFilename(input));
  try { const stat = await lstat(target); if (stat.isSymbolicLink()) throw new Error('Metadata cache entry must not be a symlink.'); if (!stat.isFile()) throw new Error('Metadata cache entry must be a file.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return target;
}

function isObject(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function validateMetadata(value: unknown, input: MetadataIdentifier): asserts value is PaperInput {
  if (!isObject(value) || typeof value['title'] !== 'string' || value['title'].trim() === '' || !Array.isArray(value['authors']) || !value['authors'].every(author => typeof author === 'string' && author.trim() !== '')) throw new Error('Cached metadata is invalid; reconnect or add the paper manually.');
  if (value['metadataSource'] !== input.kind) throw new Error('Cached metadata provider does not match the requested identifier.');
  if (input.kind === 'doi' && (typeof value['doi'] !== 'string' || normalizeDoi(value['doi']) !== input.identifier)) throw new Error('Cached DOI metadata does not match the requested identifier.');
  if (input.kind === 'arxiv' && (typeof value['arxiv'] !== 'string' || normalizeArxivId(value['arxiv']) !== input.identifier)) throw new Error('Cached arXiv metadata does not match the requested identifier.');
  if (value['year'] !== undefined && !Number.isInteger(value['year'])) throw new Error('Cached metadata year is invalid.');
}

async function readCache(root: string, input: MetadataIdentifier): Promise<PaperInput | undefined> {
  const target = await cachePath(root, input, false); if (!target) return undefined;
  try { const parsed: unknown = JSON.parse(await readFile(target, 'utf8')); validateMetadata(parsed, input); return parsed; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error('Metadata cache is corrupt or invalid; reconnect or add the paper manually.', { cause: error });
  }
}

async function writeCache(root: string, input: MetadataIdentifier, metadata: PaperInput): Promise<void> {
  validateMetadata(metadata, input); const target = (await cachePath(root, input, true))!; const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600); try { await file.writeFile(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8'); await file.sync(); } finally { await file.close(); }
    await rename(temporary, target);
  } finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim() || undefined;
  return undefined;
}
function metadata(source: MetadataSource, title: string, authors: string[], fields: Partial<PaperInput>): PaperInput { return { title, authors, metadataSource: source, ...fields }; }

function cslMetadata(value: unknown, doi: string): PaperInput {
  if (!isObject(value)) throw new Error('DOI provider returned malformed CSL JSON; add the paper manually.');
  const title = stringValue(value['title']); if (!title) throw new Error('DOI metadata has no title; add this paper manually.');
  const rawAuthors = Array.isArray(value['author']) ? value['author'] : [];
  const authors = rawAuthors.flatMap(raw => {
    if (!isObject(raw)) return []; const literal = stringValue(raw['literal']); const combined = [stringValue(raw['given']), stringValue(raw['family'])].filter(Boolean).join(' '); return literal ? [literal] : combined ? [combined] : [];
  });
  const issued = value['issued']; let year: number | undefined;
  if (isObject(issued)) { const parts = issued['date-parts']; const candidate = Array.isArray(parts) && Array.isArray(parts[0]) ? parts[0][0] : undefined; if (Number.isInteger(candidate)) year = Number(candidate); }
  const url = stringValue(value['URL']); return metadata('doi', title, authors, { doi, ...(year !== undefined ? { year } : {}), ...(url ? { url } : {}) });
}

const xmlParser = new XMLParser({ ignoreAttributes: false, trimValues: true, parseTagValue: false });
function array<T>(value: T | T[] | undefined): T[] { return value === undefined ? [] : Array.isArray(value) ? value : [value]; }
function arxivMetadata(xml: string, requested: string): PaperInput {
  let parsed: unknown; try { parsed = xmlParser.parse(xml) as unknown; } catch { throw new Error('arXiv returned malformed Atom XML; add the paper manually.'); }
  if (!isObject(parsed) || !isObject(parsed['feed'])) throw new Error('arXiv returned malformed Atom metadata; add the paper manually.');
  const feed = parsed['feed'];
  if (isObject(feed['opensearch:totalResults']) && feed['opensearch:totalResults']['#text'] === '0') throw new Error('arXiv did not find that identifier; add the paper manually.');
  const entries = array(feed['entry']); if (entries.length !== 1 || !isObject(entries[0])) throw new Error('arXiv metadata did not contain exactly one paper; add it manually.');
  const entry = entries[0]; const responseId = stringValue(entry['id']); const title = stringValue(entry['title']);
  if (!responseId || !title) throw new Error('arXiv metadata is missing an identifier or title; add the paper manually.');
  const returned = normalizeArxivId(responseId); const versionRequested = /v\d+$/.test(requested);
  if (versionRequested ? returned !== requested : returned.replace(/v\d+$/, '') !== requested) throw new Error('arXiv returned an entry that does not match the requested identifier; add the paper manually.');
  const authors = array(entry['author']).flatMap(author => isObject(author) && stringValue(author['name']) ? [stringValue(author['name'])!] : []);
  const published = stringValue(entry['published']); const year = published && /^\d{4}/.test(published) ? Number(published.slice(0, 4)) : undefined;
  return metadata('arxiv', title, authors, { arxiv: requested, url: `https://arxiv.org/abs/${requested}`, ...(year !== undefined ? { year } : {}) });
}

async function readThrottleState(path: string): Promise<number> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('arXiv throttle state must be a regular file.');
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!isObject(value) || !Number.isFinite(value['nextRequestAt']) || Number(value['nextRequestAt']) < 0) throw new Error('arXiv throttle state is invalid.');
    return Number(value['nextRequestAt']);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}

async function writeThrottleState(path: string, nextRequestAt: number): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(`${JSON.stringify({ nextRequestAt })}\n`, 'utf8'); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
}

async function reserveProvider(root: string, provider: string, interval: number, now: () => number, sleep: (milliseconds: number) => Promise<void>): Promise<void> {
  if (interval === 0) return;
  const directory = (await cacheDirectory(root, true))!;
  const lockPath = join(directory, `${provider}-throttle.lock`); const statePath = join(directory, `${provider}-throttle.json`);
  let lock;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { lock = await open(lockPath, 'wx', 0o600); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (attempt === 99) throw new Error(`The ${provider} throttle is locked by another process. Verify that no metadata lookup is running, then remove ${lockPath} manually.`);
      await defaultSleep(20);
    }
  }
  if (!lock) throw new Error(`Could not reserve the ${provider} metadata provider.`);
  let scheduled: number;
  const current = now();
  try {
    await lock.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`, 'utf8');
    scheduled = Math.max(current, await readThrottleState(statePath));
    await writeThrottleState(statePath, scheduled + interval);
  } finally {
    try { await lock.close(); }
    finally { await unlink(lockPath).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
  }
  if (scheduled > current) await sleep(scheduled - current);
}

async function fetchText(root: string, url: string, provider: string, accept: string, options: MetadataLookupOptions): Promise<string> {
  const fetcher = options.fetch ?? globalThis.fetch; const sleep = options.sleep ?? defaultSleep; const now = options.now ?? Date.now; const retries = options.retries ?? 2; const interval = provider === 'arxiv' ? 3_000 : 0;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    await reserveProvider(root, provider, interval, now, sleep);
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const operation = (async () => { const response = await fetcher(url, { headers: { accept, 'user-agent': 'CiteTrace/0.1 (local research provenance tool)' }, signal: controller.signal }); const body = await response.text(); return { response, body }; })();
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error(`${provider} metadata request timed out.`)); }, options.timeoutMs ?? 10_000); });
      const { response, body } = await Promise.race([operation, timeout]);
      if (response.ok) return body;
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        const seconds = Number(response.headers.get('retry-after')); await sleep(Number.isFinite(seconds) ? Math.min(10_000, Math.max(0, seconds * 1000)) : 500 * 2 ** attempt); continue;
      }
      throw new Error(`${provider} metadata request failed with HTTP ${response.status}; retry or add the paper manually.`);
    } catch (error) {
      if (attempt >= retries || (error instanceof Error && /HTTP 4\d\d/.test(error.message) && !/HTTP 429/.test(error.message))) throw new Error(`${provider} metadata lookup failed; retry, use --offline cache, or add the paper manually.`, { cause: error });
      await sleep(500 * 2 ** attempt);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
  throw new Error(`${provider} metadata lookup failed; add the paper manually.`);
}

export async function lookupPaperMetadata(root: string, raw: MetadataIdentifier, options: MetadataLookupOptions = {}): Promise<PaperInput> {
  const identifier = raw.kind === 'doi' ? normalizeDoi(raw.identifier) : normalizeArxivId(raw.identifier); const input = { kind: raw.kind, identifier } satisfies MetadataIdentifier;
  let cached: PaperInput | undefined;
  try { cached = await readCache(root, input); } catch (error) { if (options.offline) throw error; }
  if (options.offline) { if (cached) return cached; throw new Error(`No valid cached ${raw.kind} metadata is available; add the paper manually while offline.`); }
  try {
    const body = raw.kind === 'doi'
      ? await fetchText(root, `https://doi.org/${encodeURIComponent(identifier)}`, 'doi', 'application/vnd.citationstyles.csl+json', options)
      : await fetchText(root, `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(identifier)}`, 'arxiv', 'application/atom+xml', options);
    let result: PaperInput;
    if (raw.kind === 'doi') {
      let parsed: unknown; try { parsed = JSON.parse(body) as unknown; } catch { throw new Error('DOI provider returned malformed JSON; add the paper manually.'); }
      result = cslMetadata(parsed, identifier);
    } else result = arxivMetadata(body, identifier);
    await writeCache(root, input, result); return result;
  } catch (error) { if (cached) return cached; throw error; }
}

export async function refreshPaper(root: string, ledger: Ledger, id: string, options: MetadataLookupOptions = {}): Promise<Paper> {
  const paper = ledger.papers.find(item => item.id === id); if (!paper) throw new Error(`Paper ${id} does not exist.`);
  const identifier: MetadataIdentifier | undefined = paper.doi ? { kind: 'doi', identifier: paper.doi } : paper.arxiv ? { kind: 'arxiv', identifier: paper.arxiv } : undefined;
  if (!identifier) throw new Error('Paper has no DOI or arXiv identifier to refresh.');
  const fresh = await lookupPaperMetadata(root, identifier, options);
  return updatePaper(ledger, id, fresh);
}
