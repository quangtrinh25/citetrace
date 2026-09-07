import { build } from 'esbuild';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const coreRequire = createRequire(join(root, 'packages/core/package.json'));
export const alphaVersion = '0.1.0-alpha.1';

// Keep the upstream WASM loader beside its own runtime files. These dependencies
// are copied into each artifact, so installation needs no network or compiler.
async function copyParserRuntime(destination) {
  const runtime = dirname(coreRequire.resolve('web-tree-sitter'));
  const target = join(destination, 'node_modules/web-tree-sitter');
  await mkdir(target, { recursive: true });
  for (const filename of ['package.json', 'web-tree-sitter.js', 'web-tree-sitter.cjs', 'web-tree-sitter.wasm', 'LICENSE']) {
    await copyFile(join(runtime, filename), join(target, filename));
  }
  const grammar = dirname(coreRequire.resolve('tree-sitter-python/tree-sitter-python.wasm'));
  const grammarTarget = join(destination, 'node_modules/tree-sitter-python');
  await mkdir(grammarTarget, { recursive: true });
  for (const filename of ['package.json', 'tree-sitter-python.wasm', 'LICENSE']) {
    await copyFile(join(grammar, filename), join(grammarTarget, filename));
  }
  const grammarInfo = JSON.parse(await readFile(join(grammar, 'package.json'), 'utf8'));
  // This distribution vendors only the MIT WASM artifact, not native bindings.
  // Removing native installation hooks keeps normal npm installation compiler-free.
  await writeFile(join(grammarTarget, 'package.json'), JSON.stringify({ name: grammarInfo.name, version: grammarInfo.version, license: grammarInfo.license, repository: grammarInfo.repository, files: ['tree-sitter-python.wasm', 'LICENSE'] }, null, 2) + '\n');
}

async function bundle(entry, outfile, format) {
  const result = await build({ entryPoints: [join(root, entry)], outfile, bundle: true, platform: 'node', target: 'node20', format, metafile: true,
    external: ['vscode', 'web-tree-sitter'], alias: { '@citetrace/core': join(root, 'packages/core/src/index.ts') },
    sourcemap: false, legalComments: 'eof', logLevel: 'warning',
    ...(format === 'cjs' ? { define: { 'import.meta.url': '__citetraceModuleUrl' }, banner: { js: 'var __citetraceModuleUrl = require("node:url").pathToFileURL(__filename).href;' } } : {}),
  });
  const packages = new Map();
  for (const input of Object.keys(result.metafile.inputs)) {
    if (!input.includes('node_modules/')) continue;
    let directory = dirname(resolve(input));
    while (directory !== dirname(directory)) {
      try {
        const info = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
        if (!packages.has(info.name)) {
          let license = '';
          for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE-MIT', 'license', 'license.md']) {
            try { license = await readFile(join(directory, name), 'utf8'); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
          }
          if (!license && info.name === '@nodable/entities') license = await readFile(join(root, 'docs/licenses/nodable-MIT.txt'), 'utf8');
          if (!license) throw new Error(`Missing bundled dependency license: ${info.name}`);
          packages.set(info.name, `${info.name}@${info.version}\n${license}`);
        }
        break;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      directory = dirname(directory);
    }
  }
  await writeFile(join(dirname(outfile), 'THIRD_PARTY_NOTICES.txt'), [...packages.values()].join('\n\n----------------------------------------\n\n') + '\n');
}

export async function buildCli() {
  const destination = join(root, 'dist/release/cli');
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await bundle('packages/cli/src/main.ts', join(destination, 'main.js'), 'esm');
  await copyParserRuntime(destination);
  await copyFile(join(root, 'LICENSE'), join(destination, 'LICENSE'));
  await writeFile(join(destination, 'README.md'), '# CiteTrace CLI alpha\n\nLocal research provenance for Python and notebooks.\n\nRun `citetrace --help`. No Python runtime, account or network is required for manual paper linking and audit.\n\nThis is an alpha; see the source release documentation for limitations and pilot status.\n');
  const runtimePackage = JSON.parse(await readFile(join(destination, 'node_modules/web-tree-sitter/package.json'), 'utf8'));
  const grammarPackage = JSON.parse(await readFile(join(destination, 'node_modules/tree-sitter-python/package.json'), 'utf8'));
  await writeFile(join(destination, 'package.json'), JSON.stringify({ name: 'citetrace', version: alphaVersion, description: 'Local research provenance for Python and notebooks', license: 'MIT', repository: { type: 'git', url: 'https://github.com/quangtrinh25/citetrace.git' }, type: 'module', bin: { citetrace: './main.js' }, engines: { node: '>=22.12.0' }, files: ['main.js', 'node_modules', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.txt'], dependencies: { 'web-tree-sitter': runtimePackage.version, 'tree-sitter-python': grammarPackage.version }, bundledDependencies: ['web-tree-sitter', 'tree-sitter-python'] }, null, 2) + '\n');
  return destination;
}

export async function buildExtension() {
  const destination = join(root, 'packages/vscode/dist');
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await bundle('packages/vscode/src/extension.ts', join(destination, 'extension.cjs'), 'cjs');
  await bundle('packages/vscode/src/worker.ts', join(destination, 'worker.cjs'), 'cjs');
  await copyParserRuntime(destination);
  return destination;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] ?? 'all';
  if (mode !== 'extension') console.log(`CLI bundle: ${await buildCli()}`);
  if (mode !== 'cli') console.log(`Extension bundle: ${await buildExtension()}`);
}
