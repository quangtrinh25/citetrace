import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const cli = fileURLToPath(new URL('../dist/main.js', import.meta.url));
let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'citetrace-cli-')); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: directory, encoding: 'utf8' });
const runIn = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });

describe('installed CLI entrypoint', () => {
  test('provides help without opening project files', () => {
    const result = run('--help');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('inspect');
    expect(result.stdout).toContain('add and paper refresh perform metadata lookup');
    expect(result.stderr).toBe('');
  });

  test('inspects real Python without executing code and emits structured JSON', () => {
    writeFileSync(join(directory, 'sample.py'), 'raise RuntimeError("must never run")\ndef scale(x):\n    return x / 2\n');
    const result = run('inspect', 'sample.py', '--json');
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.schemaVersion).toBe(1);
    expect(output.files[0].units[0].symbols[0]).toMatchObject({ name: 'scale', qualifiedName: 'scale' });
    expect(output.files[0].units[0]).not.toHaveProperty('source');
    expect(result.stderr).toBe('');
  });

  test('reads notebooks with cell identity and never modifies input bytes', () => {
    const notebook = JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { language_info: { name: 'python' } }, cells: [
      { cell_type: 'code', id: 'research', source: ['def scale(x):\n', '    return x / 2\n'], metadata: {}, outputs: [], execution_count: null },
    ] });
    writeFileSync(join(directory, 'demo.ipynb'), notebook);
    const output = JSON.parse(execFileSync(process.execPath, [cli, 'inspect', 'demo.ipynb', '--json'], { cwd: directory, encoding: 'utf8' }));
    expect(output.files[0].units[0].cell).toEqual({ id: 'research', index: 0 });
    expect(output.files[0].units[0].symbols[0].name).toBe('scale');
    expect(readFileSync(join(directory, 'demo.ipynb'), 'utf8')).toBe(notebook);
  });

  test('includes diagnostics and a failing exit status for malformed inputs', () => {
    writeFileSync(join(directory, 'broken.ipynb'), '{');
    const result = run('inspect', 'broken.ipynb', '--json');
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).files[0].diagnostics[0].code).toBe('invalid-notebook');
  });

  test('returns an input failure for malformed notebook cell entries', () => {
    const notebook = JSON.stringify({
      nbformat: 4,
      metadata: { language_info: { name: 'python' } },
      cells: [null, { cell_type: 'code', source: 'def good():\n    pass\n' }],
    });
    writeFileSync(join(directory, 'malformed-cell.ipynb'), notebook);

    const result = run('inspect', 'malformed-cell.ipynb', '--json');

    expect(result.status).toBe(1);
    const output = JSON.parse(result.stdout);
    expect(output.files[0].diagnostics).toEqual([
      expect.objectContaining({ code: 'invalid-cell', cellIndex: 0, severity: 'error' }),
    ]);
    expect(output.files[0].units[0].symbols[0].name).toBe('good');
  });

  test('continues across files and reports IO errors in JSON', () => {
    writeFileSync(join(directory, 'good.py'), 'def good():\n    pass\n');
    const result = run('inspect', 'missing.py', 'good.py', '--json');
    expect(result.status).toBe(1);
    const output = JSON.parse(result.stdout);
    expect(output.files).toHaveLength(2);
    expect(output.files[0].diagnostics[0].code).toBe('read-error');
    expect(output.files[1].units[0].symbols[0].name).toBe('good');
  });

  test('reports partial parsing rather than claiming a complete scan', () => {
    writeFileSync(join(directory, 'broken.py'), 'def bad(:\n');
    const result = run('inspect', 'broken.py', '--json');
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).files[0].diagnostics[0].code).toBe('syntax-error');
  });

  test('rejects unsupported extensions, unknown options and absent filenames', () => {
    writeFileSync(join(directory, 'plain.txt'), 'hello');
    expect(run('inspect', 'plain.txt').status).toBe(1);
    expect(run('inspect', '--unexpected').status).toBe(1);
    expect(run('inspect').status).toBe(1);
  });

  test('runs the durable init, add, list, link, audit, export and unlink workflow', () => {
    writeFileSync(join(directory, 'model.py'), 'def scale(x):\n    return x / 2\n');
    const initialized = run('init', '--json');
    expect(initialized.status).toBe(0);
    expect(JSON.parse(initialized.stdout)).toMatchObject({ initialized: true, schemaVersion: 1 });

    const added = run('add', '--title', 'Scaling & Models', '--author', 'Ada Lovelace', '--author', 'Grace Hopper', '--year', '2024', '--json');
    expect(added.status).toBe(0);
    const paper = JSON.parse(added.stdout).paper;
    expect(paper).toMatchObject({ title: 'Scaling & Models', authors: ['Ada Lovelace', 'Grace Hopper'], year: 2024 });
    expect(JSON.parse(run('papers', '--json').stdout).papers).toHaveLength(1);

    const linked = run('link', paper.id, 'model.py', '--symbol', 'scale', '--relation', 'implements', '--note', 'Core operation', '--json');
    expect(linked.status).toBe(0);
    const link = JSON.parse(linked.stdout).link;
    expect(link).toMatchObject({ paperId: paper.id, relation: 'implements', note: 'Core operation', anchor: { artifact: 'model.py', symbol: { qualifiedName: 'scale' } } });

    const audit = JSON.parse(run('audit', '--json').stdout);
    expect(audit.counts).toMatchObject({ confirmed: 1, needsReview: 0, ambiguous: 0, missing: 0, unresolved: 0, exempt: 0 });
    expect(audit.diagnostics).toEqual([]);
    expect(run('export', '--json').status).toBe(0);
    expect(readFileSync(join(directory, 'references.citetrace.bib'), 'utf8')).toContain('Scaling \\& Models');
    writeFileSync(join(directory, 'references.citetrace.bib'), 'user owned');
    expect(run('export').status).toBe(1);
    expect(run('export', '--force').status).toBe(0);

    expect(run('unlink', link.id, '--json').status).toBe(0);
    expect(JSON.parse(run('audit', '--json').stdout).counts.confirmed).toBe(0);
  });

  test('reopens a copied project in a fresh process and exports its confirmed paper', () => {
    expect(run('init').status).toBe(0);
    const paper = JSON.parse(run('add', '--title', 'Portable Paper', '--json').stdout).paper;
    writeFileSync(join(directory, 'portable.py'), 'value = 1\n');
    expect(run('link', paper.id, 'portable.py', '--relation', 'background-reference').status).toBe(0);
    const clone = join(directory, 'clone'); mkdirSync(clone); cpSync(join(directory, '.citetrace'), join(clone, '.citetrace'), { recursive: true }); cpSync(join(directory, 'portable.py'), join(clone, 'portable.py'));
    expect(JSON.parse(runIn(clone, 'papers', '--json').stdout).papers[0].title).toBe('Portable Paper');
    expect(runIn(clone, 'export').status).toBe(0);
    expect(readFileSync(join(clone, 'references.citetrace.bib'), 'utf8')).toContain('Portable Paper');
  });

  test('requires initialization and never turns corrupt data into an empty ledger', () => {
    expect(run('papers', '--json').status).toBe(1);
    expect(run('papers', '--json').stderr).toMatch(/init/i);
    writeFileSync(join(directory, '.gitignore'), '');
    expect(run('init').status).toBe(0);
    writeFileSync(join(directory, '.citetrace', 'ledger.json'), '{bad');
    expect(run('papers').status).toBe(1);
    expect(readFileSync(join(directory, '.citetrace', 'ledger.json'), 'utf8')).toBe('{bad');
  });

  test('links a whole notebook cell with magic and rejects ambiguous symbols', () => {
    expect(run('init').status).toBe(0);
    const paper = JSON.parse(run('add', '--title', 'Notebook Paper', '--json').stdout).paper;
    const notebook = JSON.stringify({ nbformat: 4, metadata: { language_info: { name: 'python' } }, cells: [
      { cell_type: 'code', id: 'magic-cell', source: '%time value = work()\n' },
    ] });
    writeFileSync(join(directory, 'demo.ipynb'), notebook);
    const cellLink = run('link', paper.id, 'demo.ipynb', '--cell', 'magic-cell', '--relation', 'background-reference', '--json');
    expect(cellLink.status).toBe(0);
    expect(JSON.parse(cellLink.stdout).link.anchor).toMatchObject({ unitKind: 'cell', cellId: 'magic-cell' });

    writeFileSync(join(directory, 'duplicate.py'), 'def same():\n    pass\n\ndef same():\n    pass\n');
    const ambiguous = run('link', paper.id, 'duplicate.py', '--symbol', 'same', '--relation', 'implements');
    expect(ambiguous.status).toBe(1);
    expect(ambiguous.stderr).toMatch(/ambiguous/i);
  });

  test('syncs a uniquely moved unchanged symbol while edited code requires explicit relink', () => {
    expect(run('init').status).toBe(0);
    const paper = JSON.parse(run('add', '--title', 'Move Paper', '--json').stdout).paper;
    writeFileSync(join(directory, 'old.py'), 'def scale(x):\n    return x / 2\n');
    const link = JSON.parse(run('link', paper.id, 'old.py', '--symbol', 'scale', '--relation', 'implements', '--json').stdout).link;
    writeFileSync(join(directory, 'new.py'), readFileSync(join(directory, 'old.py'), 'utf8'));
    rmSync(join(directory, 'old.py'));
    const before = JSON.parse(run('audit', '--json').stdout);
    expect(before.links[0]).toMatchObject({ id: link.id, status: 'confirmed', relocated: true });
    expect(JSON.parse(run('sync', '--json').stdout).updated).toEqual([link.id]);
    writeFileSync(join(directory, 'new.py'), 'def scale(x):\n    return x / 3\n');
    expect(JSON.parse(run('audit', '--json').stdout).counts.needsReview).toBe(1);
    expect(JSON.parse(run('sync', '--json').stdout).updated).toEqual([]);
    expect(run('relink', link.id, 'new.py', '--symbol', 'scale', '--json').status).toBe(0);
    expect(JSON.parse(run('audit', '--json').stdout).counts.confirmed).toBe(1);
  });

  test('updates, merges, refreshes and explicitly removes linked papers', () => {
    expect(run('init').status).toBe(0);
    const keep = JSON.parse(run('add', '--title', 'Keep', '--json').stdout).paper;
    const merged = JSON.parse(run('add', '--title', 'Merge', '--author', 'Ada', '--arxiv', '2501.00001v2', '--json').stdout).paper;
    expect(run('paper', 'update', keep.id, '--title', 'Canonical', '--year', '2026', '--json').status).toBe(0);
    const updated = JSON.parse(run('papers', '--json').stdout).papers.find((paper: { id: string }) => paper.id === keep.id);
    expect(updated).toMatchObject({ title: 'Canonical', year: 2026, citationKey: keep.citationKey });
    expect(run('paper', 'refresh', keep.id).status).toBe(1);
    writeFileSync(join(directory, 'model.py'), 'value = 1\n');
    expect(run('link', merged.id, 'model.py', '--relation', 'background-reference').status).toBe(0);
    expect(run('paper', 'merge', keep.id, merged.id, '--json').status).toBe(0);
    expect(JSON.parse(run('papers', '--json').stdout).papers).toHaveLength(1);
    expect(run('paper', 'remove', keep.id).status).toBe(1);
    expect(run('paper', 'remove', keep.id, '--remove-links', '--json').status).toBe(0);
    expect(JSON.parse(run('papers', '--json').stdout).papers).toEqual([]);
  });

  test('audits suggestions and records, lists, reopens and accepts decisions', () => {
    expect(run('init').status).toBe(0);
    writeFileSync(join(directory, 'model.py'), 'class LayerNorm:\n    pass\n');
    const firstAudit = JSON.parse(run('audit', '--json').stdout);
    expect(firstAudit.counts.unresolved).toBe(1);
    const suggestion = firstAudit.suggestions[0];
    const ignored = JSON.parse(run('decide', suggestion.id, 'ignore', '--json').stdout).decision;
    expect(run('audit').stdout).toContain('Ignored: 1');
    expect(run('reopen', ignored.id).status).toBe(0);
    expect(run('decide', suggestion.id, 'exempt').status).toBe(1);
    const decided = JSON.parse(run('decide', suggestion.id, 'exempt', '--reason', 'Teaching example', '--json').stdout).decision;
    expect(JSON.parse(run('decisions', '--json').stdout).decisions).toEqual([expect.objectContaining({ id: decided.id, kind: 'exempt' })]);
    expect(JSON.parse(run('audit', '--json').stdout).counts.exempt).toBe(1);
    expect(run('reopen', decided.id, '--json').status).toBe(0);
    expect(JSON.parse(run('audit', '--json').stdout).counts.unresolved).toBe(1);
    const accepted = run('decide', suggestion.id, 'accept', '--relation', 'uses-method', '--json');
    expect(accepted.status).toBe(0);
    expect(JSON.parse(accepted.stdout).link).toMatchObject({ conceptId: 'layernorm', relation: 'uses-method', actor: 'human' });
    expect(JSON.parse(run('audit', '--json').stdout).counts.confirmed).toBe(1);
  });
});
