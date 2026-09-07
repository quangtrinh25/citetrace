import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Install the actual tarball offline, with normal lifecycle behavior, then use
 * the installed entrypoint. No monorepo module resolution or Python is needed. */
export async function smokeCli(tarball) {
  const directory = await mkdtemp(join(tmpdir(), 'citetrace-install-'));
  try {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const prefix = join(directory, 'install');
    const env = { ...process.env, npm_config_cache: join(directory, 'npm-cache') };
    delete env.npm_config_ignore_scripts;
    execFileSync(npm, ['install', '--prefix', prefix, '--offline', '--no-audit', '--no-fund', tarball], { env, encoding: 'utf8' });
    const cli = join(prefix, 'node_modules/citetrace/main.js');
    const project = join(directory, 'project'); await mkdir(project);
    const run = (...args) => {
      const result = spawnSync(process.execPath, [cli, ...args], { cwd: project, env, encoding: 'utf8' });
      assert.equal(result.status, 0, `Installed CLI failed: ${args.join(' ')}\n${result.stderr}\n${result.error ?? ''}`);
      return JSON.parse(result.stdout);
    };
    run('init', '--json');
    await writeFile(join(project, 'model.py'), 'raise RuntimeError("never execute")\nclass RMSNorm: pass\n');
    const { paper } = run('add', '--title', 'Installed paper', '--author', 'Ada Lovelace', '--json');
    run('link', paper.id, 'model.py', '--symbol', 'RMSNorm', '--relation', 'implements', '--concept', 'rmsnorm', '--json');
    const audit = run('audit', '--json');
    assert.equal(audit.counts.confirmed, 1);
    assert.equal(audit.counts.unresolved, 0);
    run('export', '--json');
    assert.match(await readFile(join(project, 'references.citetrace.bib'), 'utf8'), /Installed paper/);
    return { success: true, node: process.version, installation: 'npm install tarball --offline, fresh prefix/cache, lifecycle scripts enabled', confirmedLinks: audit.counts.confirmed };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
