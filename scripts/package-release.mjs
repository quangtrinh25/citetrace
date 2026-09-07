import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVSIX } from '@vscode/vsce';
import { alphaVersion, buildCli, buildExtension } from './build-bundles.mjs';
import { smokeCli } from './smoke-cli.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const release = join(root, 'dist/release');
await mkdir(release, { recursive: true });
const cli = await buildCli();
await buildExtension();
await copyFile(join(root, 'LICENSE'), join(root, 'packages/vscode/LICENSE'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const packed = JSON.parse(execFileSync(npm, ['pack', '--ignore-scripts', '--json', '--offline', '--pack-destination', release], { cwd: cli, encoding: 'utf8' }));
const vsixName = `citetrace-${alphaVersion}.vsix`;
await createVSIX({ cwd: join(root, 'packages/vscode'), packagePath: join(release, vsixName), dependencies: false, allowMissingRepository: true, skipLicense: false });
const names = [packed[0].filename, vsixName];
const checksums = [];
for (const name of names) checksums.push(`${createHash('sha256').update(await readFile(join(release, name))).digest('hex')}  ${name}`);
await writeFile(join(release, 'SHA256SUMS'), checksums.join('\n') + '\n');
console.log(`Alpha artifacts: ${names.join(', ')}`);
if (process.argv.includes('--smoke')) {
  const result = await smokeCli(join(release, packed[0].filename));
  await writeFile(join(release, 'cli-install-smoke.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
}
