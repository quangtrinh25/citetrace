import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCliArgsFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';

// Supply an existing desktop executable: no VS Code download or machine-profile
// modification. On Linux this runs the actual Electron host in headless mode.
const executable = process.argv[2];
if (!executable) throw new Error('Usage: node scripts/smoke-vscode.mjs /absolute/path/to/VSCode [artifact.vsix]');
const root = fileURLToPath(new URL('../', import.meta.url));
const artifact = resolve(process.argv[3] ?? join(root, 'dist/release/citetrace-0.1.0-alpha.1.vsix'));
const directory = await mkdtemp(join(tmpdir(), 'citetrace-vsix-'));
const project = join(directory, 'project');
const secondary = join(directory, 'secondary');
const workspace = join(directory, 'smoke.code-workspace');
const extensions = join(directory, 'extensions');
const profile = join(directory, 'user-data');
await mkdir(project);
await mkdir(secondary);
await writeFile(workspace, JSON.stringify({ folders: [{ path: project }, { path: secondary }] }));
for (const name of ['model.py', 'research.ipynb']) await copyFile(join(root, 'examples', name), join(project, name));
// Electron's CLI wrapper sets this only for its own subprocess; the GUI host
// must not inherit a caller's Node-only Electron setting.
delete process.env.ELECTRON_RUN_AS_NODE;
const [cli, ...args] = resolveCliArgsFromVSCodeExecutablePath(resolve(executable), { reuseMachineInstall: true });
await new Promise((done, fail) => {
  const child = spawn(cli, [...args, '--user-data-dir', profile, '--extensions-dir', extensions, '--install-extension', artifact], { stdio: 'inherit', timeout: 60_000 });
  child.once('error', fail);
  child.once('exit', code => code === 0 ? done() : fail(new Error(`VSIX installation exited ${code}`)));
});
const installed = (await readdir(extensions)).filter(name => name.startsWith('citetrace.citetrace-'));
assert.equal(installed.length, 1, 'Exactly one installed CiteTrace extension');
const installedRoot = join(extensions, installed[0]);
const manifest = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8'));
assert.equal(`${manifest.publisher}.${manifest.name}`, 'citetrace.citetrace');
await runTests({
  vscodeExecutablePath: resolve(executable), reuseMachineInstall: true,
  extensionDevelopmentPath: installedRoot,
  extensionTestsPath: join(root, 'packages/vscode/test/host-smoke.cjs'),
  launchArgs: [workspace, '--user-data-dir', profile, '--extensions-dir', extensions,
    '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
    '--disable-gpu', ...(process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=headless'] : [])],
});
const result = { ...JSON.parse(await readFile(join(project, 'host-result.json'), 'utf8')), artifact,
  extensionId: `${manifest.publisher}.${manifest.name}`, extensionVersion: manifest.version,
  installation: 'VSIX installed by VS Code CLI into fresh profile; host loads only installed extension files',
  scope: 'Automated host/API smoke; not a timed human pilot or full interactive picker test',
  evidenceDirectory: directory };
await mkdir(join(root, 'dist/release'), { recursive: true });
await writeFile(join(root, 'dist/release/vscode-install-smoke.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
