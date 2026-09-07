import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { auditProject } from '../../core/src/audit.js';
import { scanInWorker } from '../src/transport.js';
let root: string;
const distribution = fileURLToPath(new URL('../dist', import.meta.url));
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'citetrace-worker-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test('bundled worker matches the core on saved Python and notebook content outside the workspace', async () => {
  const install = join(root, 'isolated-extension');
  await cp(distribution, install, { recursive: true });
  await writeFile(join(root, 'model.py'), 'raise RuntimeError("must never run")\nclass RMSNorm: pass\n');
  await writeFile(join(root, 'n.ipynb'), JSON.stringify({ nbformat: 4, metadata: { language_info: { name: 'python' } }, cells: [{ cell_type: 'code', id: 'a', source: 'import peft\nx=peft.LoraConfig()\n' }] }));
  const result = await scanInWorker(join(install, 'worker.cjs'), root, [], new AbortController().signal);
  const direct = await auditProject(root);
  expect(result).toEqual(direct);
  expect(result.suggestions.map(s => s.conceptId).sort()).toEqual(['lora', 'rmsnorm']);
});

test('a cancelled worker request terminates instead of publishing a result', async () => {
  const controller = new AbortController();
  const request = scanInWorker(join(distribution, 'worker.cjs'), root, [], controller.signal);
  controller.abort();
  await expect(request).rejects.toMatchObject({ name: 'AbortError' });
});
