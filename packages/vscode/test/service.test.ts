import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createAnchor } from '../../core/src/anchors.js';
import { ProjectService } from '../src/service.js';
let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'citetrace-editor-')); await writeFile(join(root, 'model.py'), 'def build():\n    return 1\n'); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test('editor command service initializes, adds, links and auto-exports without modifying source', async () => {
  const service = new ProjectService(root, true);
  await service.initialize();
  const paperId = await service.add({ title: 'Method paper', authors: ['Ada Lovelace'], year: 2024, metadataSource: 'manual' });
  const analysis = (await service.scan()).analyses[0]!;
  const id = await service.link(paperId, createAnchor(analysis, analysis.symbols[0]), 'implements');
  expect(id).toMatch(/^link-/);
  const reopened = await new ProjectService(root).scan();
  expect(reopened.links[0]?.resolution.status).toBe('resolved');
  expect(await readFile(join(root, 'references.citetrace.bib'), 'utf8')).toContain('Method paper');
  expect(await readFile(join(root, 'model.py'), 'utf8')).toBe('def build():\n    return 1\n');
});

test('editor rejects stale selection when code changes during a picker', async () => {
  const service = new ProjectService(root);
  await service.initialize();
  const id = await service.add({ title: 'Paper', authors: [], metadataSource: 'manual' });
  const analysis = (await service.scan()).analyses[0]!;
  await writeFile(join(root, 'model.py'), 'def build():\n    return 2\n');
  await expect(service.link(id, createAnchor(analysis, analysis.symbols[0]), 'implements')).rejects.toThrow(/changed|stale/i);
  expect((await service.scan()).links).toEqual([]);
});

test('editor link service stores optional provenance detail', async () => {
  const service = new ProjectService(root);
  await service.initialize();
  const paperId = await service.add({ title: 'Paper', authors: [], metadataSource: 'manual' });
  const analysis = (await service.scan()).analyses[0]!;
  await service.link(paperId, createAnchor(analysis, analysis.symbols[0]), 'adapted-from', {
    conceptId: 'adapter', note: 'Changed the projection layout', referenceUrl: 'https://github.com/example/research/blob/main/model.py',
  });
  expect((await service.scan()).ledger.links[0]).toMatchObject({
    conceptId: 'adapter', note: 'Changed the projection layout', referenceUrl: 'https://github.com/example/research/blob/main/model.py',
  });
});
