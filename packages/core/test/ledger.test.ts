import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  addLink,
  addPaper,
  emptyLedger,
  readLedger,
  removePaper,
  removeLink,
  mergePapers,
  updatePaper,
  validateLedger,
  writeLedger,
  type CodeAnchor,
} from '../src/index.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'citetrace-ledger-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const anchor: CodeAnchor = {
  schemaVersion: 1,
  artifact: 'src/model.py',
  unitKind: 'file',
  unitFingerprint: 'a'.repeat(64),
};

describe('durable ledger', () => {
  test('rejects non-string artifact paths without coercing persisted values', async () => {
    const ledger = emptyLedger();
    const paper = addPaper(ledger, { title: 'Typed anchor', authors: [], metadataSource: 'manual' });
    addLink(ledger, { paperId: paper.id, anchor, relation: 'implements', actor: 'human' });
    await mkdir(join(root, '.citetrace'));
    for (const artifact of [123, true, ['model.py'], { path: 'model.py' }]) {
      const candidate = structuredClone(ledger);
      (candidate.links[0]!.anchor as unknown as Record<string, unknown>)['artifact'] = artifact;
      const contents = JSON.stringify(candidate);
      await writeFile(join(root, '.citetrace/ledger.json'), contents);
      await expect(readLedger(root)).rejects.toThrow(/artifact.*string/i);
      expect(await readFile(join(root, '.citetrace/ledger.json'), 'utf8')).toBe(contents);
    }
  });

  test('rejects unknown persisted fields at every schema object boundary', async () => {
    const ledger = emptyLedger();
    const paper = addPaper(ledger, { title: 'Strict schema', authors: [], metadataSource: 'manual' });
    addLink(ledger, { paperId: paper.id, anchor, relation: 'implements', actor: 'human' });
    ledger.decisions.push({ id: 'decision-1', kind: 'ignore', conceptId: 'strict', anchor, fingerprint: 'a'.repeat(64), createdAt: '2026-09-07T00:00:00.000Z' });
    const withUnknown = (path: 'ledger' | 'paper' | 'link' | 'decision' | 'anchor' | 'symbol') => {
      const candidate = structuredClone(ledger) as unknown as Record<string, unknown>;
      if (path === 'ledger') candidate['source'] = 'SECRET = 1';
      if (path === 'paper') (candidate['papers'] as Array<Record<string, unknown>>)[0]!['source'] = 'SECRET = 1';
      if (path === 'link') (candidate['links'] as Array<Record<string, unknown>>)[0]!['source'] = 'SECRET = 1';
      if (path === 'decision') (candidate['decisions'] as Array<Record<string, unknown>>)[0]!['source'] = 'SECRET = 1';
      if (path === 'anchor') ((candidate['links'] as Array<Record<string, unknown>>)[0]!['anchor'] as Record<string, unknown>)['source'] = 'SECRET = 1';
      if (path === 'symbol') {
        const savedAnchor = (candidate['links'] as Array<Record<string, unknown>>)[0]!['anchor'] as Record<string, unknown>;
        savedAnchor['symbol'] = { kind: 'function', qualifiedName: 'train', fingerprint: 'b'.repeat(64), source: 'SECRET = 1' };
      }
      return candidate;
    };
    for (const path of ['ledger', 'paper', 'link', 'decision', 'anchor', 'symbol'] as const) {
      const candidate = withUnknown(path);
      expect(() => validateLedger(candidate)).toThrow(/unknown|source/i);
      await expect(writeLedger(root, candidate as never, null)).rejects.toThrow(/unknown|source/i);
    }
    expect(await readLedger(root)).toEqual({ ledger: null, revision: null });
  });

  test('keeps missing state explicit and round-trips a validated ledger', async () => {
    expect(await readLedger(root)).toEqual({ ledger: null, revision: null });
    const ledger = emptyLedger();
    const revision = await writeLedger(root, ledger, null);
    expect(revision).toMatch(/^[a-f0-9]{64}$/);
    expect(await readLedger(root)).toEqual({ ledger, revision });
  });

  test('rejects malformed data without replacing it', async () => {
    await mkdir(join(root, '.citetrace'));
    await writeFile(join(root, '.citetrace', 'ledger.json'), '{broken');
    await expect(readLedger(root)).rejects.toThrow(/corrupt/i);
    expect(await readFile(join(root, '.citetrace', 'ledger.json'), 'utf8')).toBe('{broken');
  });

  test('detects competing writers by revision', async () => {
    const revision = await writeLedger(root, emptyLedger(), null);
    const first = await readLedger(root);
    const second = await readLedger(root);
    const changed = structuredClone(first.ledger!);
    addPaper(changed, { title: 'First', authors: ['A. One'], metadataSource: 'manual' });
    await writeLedger(root, changed, revision);
    await expect(writeLedger(root, second.ledger!, second.revision)).rejects.toThrow(/changed|revision/i);
  });

  test('serializes simultaneous writers so only one stale revision can commit', async () => {
    const revision = await writeLedger(root, emptyLedger(), null);
    const left = emptyLedger(); const right = emptyLedger();
    addPaper(left, { title: 'Left', authors: [], metadataSource: 'manual' });
    addPaper(right, { title: 'Right', authors: [], metadataSource: 'manual' });
    const results = await Promise.allSettled([writeLedger(root, left, revision), writeLedger(root, right, revision)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await readLedger(root)).ledger?.papers).toHaveLength(1);
  });

  test('does not steal an existing lock or follow a .citetrace symlink', async () => {
    await mkdir(join(root, '.citetrace'));
    await writeFile(join(root, '.citetrace', 'ledger.lock'), 'owner');
    await expect(writeLedger(root, emptyLedger(), null)).rejects.toThrow(/locked/i);
    expect(await readFile(join(root, '.citetrace', 'ledger.lock'), 'utf8')).toBe('owner');

    const otherRoot = await mkdtemp(join(tmpdir(), 'citetrace-ledger-outside-'));
    const linkedRoot = await mkdtemp(join(tmpdir(), 'citetrace-ledger-linked-'));
    await symlink(otherRoot, join(linkedRoot, '.citetrace'));
    try {
      await expect(writeLedger(linkedRoot, emptyLedger(), null)).rejects.toThrow(/symlink|outside/i);
      await expect(readFile(join(otherRoot, 'ledger.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await rm(otherRoot, { recursive: true, force: true }); await rm(linkedRoot, { recursive: true, force: true }); }
  });

  test('validates referential integrity and anchor paths on write', async () => {
    const ledger = emptyLedger();
    ledger.links.push({
      id: 'link-x', paperId: 'missing', anchor, relation: 'implements', actor: 'human', createdAt: '2026-01-01T00:00:00.000Z',
    });
    await expect(writeLedger(root, ledger, null)).rejects.toThrow(/paper/i);
    const paper = addPaper(ledger, { title: 'Paper', authors: [], metadataSource: 'manual' });
    ledger.links[0]!.paperId = paper.id;
    ledger.links[0]!.anchor = { ...anchor, artifact: '../outside.py' };
    await expect(writeLedger(root, ledger, null)).rejects.toThrow(/artifact/i);
  });

  test('adds stable papers and permits multiple papers on one scope', () => {
    const ledger = emptyLedger();
    const first = addPaper(ledger, { title: 'A Study', authors: ['Ada Lovelace'], year: 2024, doi: 'https://doi.org/10.1000/ABC', metadataSource: 'manual' });
    expect(first).toMatchObject({ doi: '10.1000/abc', citationKey: 'lovelace2024study' });
    expect(() => addPaper(ledger, { title: 'Other title', authors: ['X'], doi: 'doi:10.1000/ABC', metadataSource: 'manual' })).toThrow(/identifier/i);
    const second = addPaper(ledger, { title: 'A Study', authors: ['Ada Lovelace'], metadataSource: 'manual' });
    expect(second.id).not.toBe(first.id);
    expect(second.citationKey).toBe('lovelacestudy');
    const colliding = addPaper(ledger, { title: 'A Study', authors: ['Ada Lovelace'], year: 2024, metadataSource: 'manual' });
    expect(colliding.citationKey).toBe('lovelace2024study2');

    const link = addLink(ledger, { paperId: first.id, anchor, relation: 'implements', actor: 'human', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(addLink(ledger, { paperId: second.id, anchor, relation: 'uses-method', actor: 'human' }).paperId).toBe(second.id);
    expect(() => addLink(ledger, { paperId: first.id, anchor, relation: 'uses-method', actor: 'human' })).toThrow(/scope/i);
    expect(removeLink(ledger, link.id)).toEqual(link);
    expect(ledger.links).toHaveLength(1);
  });

  test('distinguishes ID-less notebook cells by fingerprint when checking duplicate scopes', () => {
    const ledger = emptyLedger();
    const paper = addPaper(ledger, { title: 'Paper', authors: [], metadataSource: 'manual' });
    const firstCell = { ...anchor, artifact: 'n.ipynb', unitKind: 'cell' as const, unitFingerprint: '1'.repeat(64) };
    const secondCell = { ...firstCell, unitFingerprint: '2'.repeat(64) };
    addLink(ledger, { paperId: paper.id, anchor: firstCell, relation: 'implements', actor: 'human' });
    expect(addLink(ledger, { paperId: paper.id, anchor: secondCell, relation: 'implements', actor: 'human' }).anchor.unitFingerprint).toBe('2'.repeat(64));
  });

  test('treats concept as part of duplicate link identity', () => {
    const ledger = emptyLedger();
    const paper = addPaper(ledger, { title: 'Paper', authors: [], metadataSource: 'manual' });
    addLink(ledger, { paperId: paper.id, anchor, relation: 'implements', conceptId: 'rope', actor: 'human' });
    expect(addLink(ledger, { paperId: paper.id, anchor, relation: 'uses-method', conceptId: 'lora', actor: 'human' }).conceptId).toBe('lora');
    expect(() => addLink(ledger, { paperId: paper.id, anchor, relation: 'adapted-from', conceptId: 'rope', actor: 'human' })).toThrow(/scope/i);
  });

  test('updates paper metadata without changing its stable id or citation key', () => {
    const ledger = emptyLedger();
    const paper = addPaper(ledger, { title: 'Draft', authors: ['A. Author'], doi: '10.1000/draft', metadataSource: 'manual' });
    const other = addPaper(ledger, { title: 'Other', authors: [], doi: '10.1000/other', metadataSource: 'manual' });
    const updated = updatePaper(ledger, paper.id, { title: 'Published', year: 2026, authors: ['Ada Author'] });
    expect(updated).toMatchObject({ id: paper.id, citationKey: paper.citationKey, title: 'Published', year: 2026, doi: '10.1000/draft' });
    expect(() => updatePaper(ledger, paper.id, { doi: other.doi! })).toThrow(/identifier/i);
    expect(ledger.papers.find(item => item.id === paper.id)?.doi).toBe('10.1000/draft');
  });

  test('refuses to orphan links on paper removal unless explicitly requested', () => {
    const ledger = emptyLedger(); const paper = addPaper(ledger, { title: 'Linked', authors: [], metadataSource: 'manual' });
    const link = addLink(ledger, { paperId: paper.id, anchor, relation: 'implements', actor: 'human' });
    expect(() => removePaper(ledger, paper.id)).toThrow(/link|orphan/i);
    expect(removePaper(ledger, paper.id, { removeLinks: true })).toEqual({ paper, links: [link] });
    expect(ledger).toMatchObject({ papers: [], links: [] });
  });

  test('merges papers without losing stable target metadata or creating duplicate links', () => {
    const ledger = emptyLedger();
    const keep = addPaper(ledger, { title: 'Canonical', authors: [], doi: '10.1000/paper', metadataSource: 'manual' });
    const remove = addPaper(ledger, { title: 'Preprint', authors: ['Ada'], year: 2025, arxiv: '2501.00001v2', metadataSource: 'arxiv' });
    const link = addLink(ledger, { paperId: remove.id, anchor, relation: 'implements', actor: 'human' });
    const merged = mergePapers(ledger, keep.id, remove.id);
    expect(merged).toMatchObject({ id: keep.id, citationKey: keep.citationKey, title: 'Canonical', authors: ['Ada'], doi: '10.1000/paper', arxiv: '2501.00001v2' });
    expect(ledger.papers).toHaveLength(1); expect(ledger.links[0]).toMatchObject({ id: link.id, paperId: keep.id });

    const duplicate = addPaper(ledger, { title: 'Duplicate', authors: [], metadataSource: 'manual' });
    addLink(ledger, { paperId: duplicate.id, anchor, relation: 'uses-method', actor: 'human' });
    expect(() => mergePapers(ledger, keep.id, duplicate.id)).toThrow(/duplicate|scope/i);
    expect(ledger.papers).toHaveLength(2);
  });
});
