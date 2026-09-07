import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run after pnpm build. The project is new on every run; existing source and
// ledger files are never replaced. The reference below is deliberately fictional.
const examples = fileURLToPath(new URL('./', import.meta.url));
const cli = fileURLToPath(new URL('../packages/cli/dist/main.js', import.meta.url));
const project = await mkdtemp(join(tmpdir(), 'citetrace-demo-'));
for (const name of ['model.py', 'research.ipynb']) await copyFile(join(examples, name), join(project, name));
const notebookBefore = await readFile(join(project, 'research.ipynb'));
const run = (...args) => {
  const result = spawnSync(process.execPath, [cli, ...args, '--json'], { cwd: project, encoding: 'utf8' });
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stderr}\n${result.error ?? ''}`);
  return JSON.parse(result.stdout);
};
run('init');
const { paper } = run('add', '--title', 'CiteTrace demo reference (synthetic)', '--author', 'Demo Author');
run('link', paper.id, 'model.py', '--symbol', 'ResearchModel.normalize', '--relation', 'background-reference');
run('link', paper.id, 'research.ipynb', '--cell', 'normalization', '--symbol', 'normalize', '--relation', 'background-reference');
const before = run('audit');
assert.equal(before.counts.confirmed, 2);
await rename(join(project, 'model.py'), join(project, 'moved-model.py'));
run('sync');
const after = run('audit');
assert.equal(after.counts.missing, 0);
assert.equal(after.counts.ambiguous, 0);
run('export');
assert.deepEqual(await readFile(join(project, 'research.ipynb')), notebookBefore);
console.log(JSON.stringify({ project, links: after.counts.confirmed, sourceMovedTo: 'moved-model.py', notebookUnchanged: true, bibliography: join(project, 'references.citetrace.bib') }, null, 2));
