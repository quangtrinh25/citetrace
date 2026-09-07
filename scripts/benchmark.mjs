import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { analyzePython, detectConcepts } from '../packages/core/dist/index.js';

const source = 'import torch.nn as nn\n' + Array.from({ length: 180 }, (_, i) => `def build_${i}():\n    width = ${i + 1}\n    layer = nn.LayerNorm(width)\n    return layer\n\n`).join('');
const unit = { artifact: 'benchmark.py', kind: 'file', source };
const start = performance.now();
await detectConcepts(await analyzePython(unit));
const coldMs = performance.now() - start;
const samples = [];
for (let index = 0; index < 30; index += 1) {
  const start = performance.now();
  await detectConcepts(await analyzePython(unit));
  samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
const result = { date: new Date().toISOString(), cpu: cpus()[0].model, platform: platform(), arch: arch(), node: process.version, lines: source.split('\n').length - 1, symbols: 180, samples: samples.length, coldMs, medianMs: samples[15], p95Ms: samples[28], scope: 'Synthetic Python parser plus detector; excludes filesystem, network, worker startup and editor debounce.' };
await mkdir('docs/benchmarks', { recursive: true });
await writeFile('docs/benchmarks/local.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
