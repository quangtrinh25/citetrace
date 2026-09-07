import { mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { addPaper, emptyLedger, lookupPaperMetadata, normalizeArxivId, normalizeDoi, refreshPaper } from '../src/index.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'citetrace-meta-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('paper metadata', () => {
  test('coordinates arXiv reservations across separate processes sharing a project cache', async () => {
    const fixture = fileURLToPath(new URL('./fixtures/metadata-process.ts', import.meta.url));
    const runProcess = (identifier: string, marker: string) => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', fixture, root, identifier, marker], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr += String(chunk); });
      child.on('error', reject);
      child.on('exit', code => code === 0 ? resolve() : reject(new Error(`metadata fixture exited ${code}: ${stderr}`)));
    });
    const firstMarker = join(root, 'first-request.txt'); const secondMarker = join(root, 'second-request.txt');
    await runProcess('2401.00001', firstMarker);
    await runProcess('2401.00002', secondMarker);
    const first = Number(await readFile(firstMarker, 'utf8')); const second = Number(await readFile(secondMarker, 'utf8'));
    expect(second - first).toBeGreaterThanOrEqual(2_900);
  }, 10_000);

  test('normalizes DOI and arXiv inputs exactly, preserving arXiv versions', () => {
    expect(normalizeDoi(' https://doi.org/10.5555/AbC.1 ')).toBe('10.5555/abc.1');
    expect(normalizeArxivId('https://arxiv.org/abs/2401.01234v2')).toBe('2401.01234v2');
    expect(normalizeArxivId('arXiv:hep-th/9901001v3')).toBe('hep-th/9901001v3');
    expect(() => normalizeDoi('not a doi')).toThrow(/DOI/);
  });

  test('uses DOI content negotiation and maps CSL JSON', async () => {
    const urls: string[] = [];
    const result = await lookupPaperMetadata(root, { kind: 'doi', identifier: '10.1000/ABC' }, {
      fetch: async (input, init) => {
        urls.push(String(input));
        expect(new Headers(init?.headers).get('accept')).toContain('citationstyles');
        return new Response(JSON.stringify({ title: 'Paper', author: [{ given: 'Ada', family: 'Lovelace' }], issued: { 'date-parts': [[2024]] }, URL: 'https://example.test' }), { status: 200 });
      },
      sleep: async () => {},
    });
    expect(urls).toEqual(['https://doi.org/10.1000%2Fabc']);
    expect(result).toMatchObject({ title: 'Paper', authors: ['Ada Lovelace'], year: 2024, doi: '10.1000/abc', metadataSource: 'doi' });
  });

  test('retries 429 with bounded delay and uses cache offline', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const options = {
      fetch: async () => {
        calls += 1;
        if (calls === 1) return new Response('', { status: 429, headers: { 'retry-after': '99' } });
        return new Response(JSON.stringify({ title: 'Cached', author: [{ literal: 'Team' }] }), { status: 200 });
      },
      sleep: async (milliseconds: number) => { sleeps.push(milliseconds); },
    };
    await lookupPaperMetadata(root, { kind: 'doi', identifier: '10.1000/cache' }, options);
    expect(calls).toBe(2);
    expect(sleeps).toEqual([10_000]);
    const cached = await lookupPaperMetadata(root, { kind: 'doi', identifier: '10.1000/cache' }, { offline: true });
    expect(cached.title).toBe('Cached');
    await expect(lookupPaperMetadata(root, { kind: 'arxiv', identifier: '2401.00001' }, { offline: true })).rejects.toThrow(/manual|cache/i);
  });

  test('throttles every arXiv retry and verifies the returned entry identity', async () => {
    let now = Date.now() + 60_000; const requestTimes: number[] = []; let calls = 0;
    const metadata = await lookupPaperMetadata(root, { kind: 'arxiv', identifier: '2401.00001v2' }, {
      now: () => now,
      sleep: async milliseconds => { now += milliseconds; },
      fetch: async () => {
        requestTimes.push(now); calls += 1;
        if (calls === 1) return new Response('', { status: 429, headers: { 'retry-after': '0' } });
        return new Response('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2401.00001v2</id><title>Exact Paper</title><published>2024-01-01T00:00:00Z</published><author><name>Ada Lovelace</name></author></entry></feed>', { status: 200 });
      },
    });
    expect(requestTimes[1]! - requestTimes[0]!).toBeGreaterThanOrEqual(3_000);
    expect(metadata).toMatchObject({ arxiv: '2401.00001v2', title: 'Exact Paper' });

    await expect(lookupPaperMetadata(root, { kind: 'arxiv', identifier: '2401.00002' }, {
      now: () => now, sleep: async milliseconds => { now += milliseconds; }, retries: 0,
      fetch: async () => new Response('<feed><entry><id>http://arxiv.org/abs/2401.99999</id><title>Wrong</title><author><name>A</name></author></entry></feed>', { status: 200 }),
    })).rejects.toThrow(/manual|match|identifier/i);
  });

  test('bounds response body reads and rejects malformed cached metadata', async () => {
    const pending = lookupPaperMetadata(root, { kind: 'doi', identifier: '10.1000/hangs' }, {
      timeoutMs: 5, retries: 0,
      fetch: async () => ({ ok: true, status: 200, headers: new Headers(), text: () => new Promise(() => {}) }) as Response,
    });
    const outcome = await Promise.race([pending.then(() => 'resolved', error => error instanceof Error ? error.message : String(error)), new Promise<string>(resolve => setTimeout(() => resolve('still-pending'), 50))]);
    expect(outcome).toMatch(/timeout|manual|failed/i);
    expect(outcome).not.toBe('still-pending');

    await lookupPaperMetadata(root, { kind: 'doi', identifier: '10.1000/cache-shape' }, {
      fetch: async () => new Response(JSON.stringify({ title: 'Valid', author: [] }), { status: 200 }), sleep: async () => {},
    });
    const cacheDirectory = join(root, '.citetrace', 'cache'); const [cacheFile] = await readdir(cacheDirectory);
    await writeFile(join(cacheDirectory, cacheFile!), '{}');
    await expect(lookupPaperMetadata(root, { kind: 'doi', identifier: '10.1000/cache-shape' }, { offline: true })).rejects.toThrow(/cache|manual|invalid/i);
    await writeFile(join(cacheDirectory, cacheFile!), '{');
    await expect(lookupPaperMetadata(root, { kind: 'doi', identifier: '10.1000/cache-shape' }, { offline: true })).rejects.toThrow(/cache|manual|invalid/i);
    await expect(lookupPaperMetadata(root, { kind: 'doi', identifier: '10.1000/bad-json' }, { retries: 0, fetch: async () => new Response('{', { status: 200 }) })).rejects.toThrow(/manual|malformed/i);
  });

  test('does not read a cache entry through a symlink', async () => {
    const identifier = { kind: 'doi' as const, identifier: '10.1000/cache-link' };
    await lookupPaperMetadata(root, identifier, { fetch: async () => new Response(JSON.stringify({ title: 'Valid', author: [] }), { status: 200 }), sleep: async () => {} });
    const cacheDirectory = join(root, '.citetrace', 'cache'); const [cacheFile] = await readdir(cacheDirectory); const cachePath = join(cacheDirectory, cacheFile!);
    const valid = await readFile(cachePath, 'utf8'); const outside = join(root, 'outside-cache.json'); await writeFile(outside, valid); await unlink(cachePath); await symlink(outside, cachePath);
    await expect(lookupPaperMetadata(root, identifier, { offline: true })).rejects.toThrow(/symlink|cache/i);
  });

  test('refreshes identifier-backed metadata while preserving paper identity', async () => {
    const ledger = emptyLedger(); const paper = addPaper(ledger, { title: 'Old', authors: [], doi: '10.1000/refresh', metadataSource: 'manual' });
    const refreshed = await refreshPaper(root, ledger, paper.id, { fetch: async () => new Response(JSON.stringify({ title: 'New', author: [{ literal: 'Team' }], issued: { 'date-parts': [[2026]] } }), { status: 200 }), sleep: async () => {} });
    expect(refreshed).toMatchObject({ id: paper.id, citationKey: paper.citationKey, title: 'New', authors: ['Team'], year: 2026, metadataSource: 'doi' });
    const manual = addPaper(ledger, { title: 'Manual', authors: [], metadataSource: 'manual' });
    await expect(refreshPaper(root, ledger, manual.id)).rejects.toThrow(/identifier/i);
  });
});
