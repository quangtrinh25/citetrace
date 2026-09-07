import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import ignore, { type Ignore } from 'ignore';
import { readNotebook } from './notebook.js';
import type { SourceDiagnostic, SourceReadResult, SourceUnit } from './types.js';

export interface ProjectArtifact extends SourceReadResult { artifact: string }
export interface ProjectReadResult { artifacts: ProjectArtifact[]; diagnostics: SourceDiagnostic[] }
export interface ProjectReadOptions { include?: (artifact: string) => boolean }
interface IgnoreContext { base: string; matcher: Ignore }

const STANDARD_IGNORES = new Set(['.git', '.citetrace', '.ipynb_checkpoints', 'node_modules', 'vendor', 'vendored', 'venv', '.venv', 'env', '.env', 'dist', 'build', 'out', 'target', '__pycache__']);
const slash = (value: string) => value.split(sep).join('/');

async function ignoreFile(directory: string, base: string): Promise<IgnoreContext | undefined> {
  try {
    const contents = await readFile(join(directory, '.gitignore'), 'utf8');
    return { base, matcher: ignore().add(contents) };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

function ignored(artifact: string, directory: boolean, contexts: IgnoreContext[]): boolean {
  const parts = artifact.split('/'); if (parts.some(part => STANDARD_IGNORES.has(part))) return true;
  let result = false;
  for (const context of contexts) {
    const candidate = context.base ? artifact.slice(context.base.length + 1) : artifact;
    if (candidate.startsWith('../') || (context.base !== '' && !artifact.startsWith(`${context.base}/`))) continue;
    const tested = context.matcher.test(`${candidate}${directory ? '/' : ''}`);
    if (tested.ignored) result = true;
    if (tested.unignored) result = false;
  }
  return result;
}

export async function readArtifact(root: string, artifact: string): Promise<ProjectArtifact> {
  const normalized = slash(artifact); const absolute = resolve(root, normalized); const rel = relative(resolve(root), absolute);
  if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Artifact path is outside the project.');
  const actualRoot = await realpath(root); const actual = await realpath(absolute);
  if (actual !== actualRoot && !actual.startsWith(`${actualRoot}${sep}`)) throw new Error('Artifact symlink resolves outside the project.');
  const source = await readFile(actual, 'utf8');
  if (extname(normalized).toLowerCase() === '.ipynb') return { artifact: normalized, ...readNotebook(normalized, source) };
  if (extname(normalized).toLowerCase() !== '.py') throw new Error('Only .py and .ipynb artifacts are supported.');
  return { artifact: normalized, units: [{ artifact: normalized, kind: 'file', source } satisfies SourceUnit], diagnostics: [] };
}

export async function readProject(root: string, options: ProjectReadOptions = {}): Promise<ProjectReadResult> {
  const artifacts: ProjectArtifact[] = []; const diagnostics: SourceDiagnostic[] = [];
  async function visit(directory: string, base: string, inherited: IgnoreContext[]): Promise<void> {
    let contexts = inherited;
    try { const local = await ignoreFile(directory, base); if (local) contexts = [...inherited, local]; }
    catch (error) { diagnostics.push({ artifact: base || '.', code: 'read-error', severity: 'error', message: error instanceof Error ? error.message : String(error) }); }
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { diagnostics.push({ artifact: base || '.', code: 'read-error', severity: 'error', message: error instanceof Error ? error.message : String(error) }); return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const artifact = base ? `${base}/${entry.name}` : entry.name;
      if (entry.name === '.gitignore' || ignored(artifact, entry.isDirectory(), contexts)) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { await visit(join(directory, entry.name), artifact, contexts); continue; }
      if (!entry.isFile() || !['.py', '.ipynb'].includes(extname(entry.name).toLowerCase()) || options.include?.(artifact) === false) continue;
      try {
        const result = await readArtifact(root, artifact); artifacts.push(result); diagnostics.push(...result.diagnostics);
      } catch (error) { diagnostics.push({ artifact, code: 'read-error', severity: 'error', message: error instanceof Error ? error.message : String(error) }); }
    }
  }
  await visit(resolve(root), '', []); return { artifacts, diagnostics };
}
