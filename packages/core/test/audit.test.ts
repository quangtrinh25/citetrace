import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { auditProject } from '../src/audit.js';
import { addLink, addPaper, emptyLedger, writeLedger } from '../src/ledger.js';
import { analyzePython } from '../src/python.js';
import { createAnchor } from '../src/anchors.js';
let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'citetrace-audit-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test('audits uninitialized projects offline without creating ledger or executing code', async () => {
  await writeFile(join(root, 'model.py'), 'raise RuntimeError("never run")\nclass RMSNorm: pass\n');
  const result = await auditProject(root);
  expect(result.initialized).toBe(false);
  expect(result.suggestions.map(s => s.conceptId)).toEqual(['rmsnorm']);
  await expect(readFile(join(root, '.citetrace/ledger.json'))).rejects.toThrow();
});

test('uses dirty source overrides while preserving saved files and ignore rules', async () => {
  await writeFile(join(root, 'model.py'), 'x=1\n');
  await writeFile(join(root, '.gitignore'), 'ignored.py\n');
  await writeFile(join(root, 'ignored.py'), 'class RMSNorm: pass\n');
  const result = await auditProject(root, [{ artifact: 'model.py', source: 'class LayerNorm: pass\n' }, { artifact: 'ignored.py', source: 'class GELU: pass\n' }]);
  expect(result.suggestions.map(s => s.conceptId)).toEqual(['layernorm']);
  expect(await readFile(join(root, 'model.py'), 'utf8')).toBe('x=1\n');
});

test(' reports parse/read diagnostics and preserves broken and changed links separately', async () => {
  const ledger = emptyLedger();
  const paper = addPaper(ledger, { title: 'A paper', authors: [], metadataSource: 'manual' });
  for (const artifact of ['gone.py', 'changed.py']) {
    const analysis = await analyzePython({ artifact, kind: 'file', source: 'def f(): return 1\n' });
    addLink(ledger, { paperId: paper.id, anchor: createAnchor(analysis), relation: 'implements', actor: 'human' });
  }
  await writeLedger(root, ledger, null);
  await writeFile(join(root, 'changed.py'), 'def f(): return 2\n');
  await writeFile(join(root, 'broken.py'), 'def broken(:\n');
  const before = await readFile(join(root, '.citetrace/ledger.json'), 'utf8');
  const result = await auditProject(root);
  expect(result.counts).toMatchObject({ confirmed: 2, missing: 1, needsReview: 1 });
  expect(result.diagnostics.some(d => d.code === 'syntax-error')).toBe(true);
  expect(await readFile(join(root, '.citetrace/ledger.json'), 'utf8')).toBe(before);
});

test('never substitutes an empty ledger for corrupt provenance', async () => {
  await mkdir(join(root, '.citetrace'));
  await writeFile(join(root, '.citetrace/ledger.json'), '<<<<<<< merge conflict');
  await expect(auditProject(root)).rejects.toThrow(/corrupt/i);
});
