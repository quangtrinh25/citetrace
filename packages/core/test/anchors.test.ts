import { describe, expect, test } from 'vitest';
import { analyzePython } from '../src/python.js';
import { createAnchor, resolveAnchor } from '../src/anchors.js';
import type { SourceUnit, UnitAnalysis } from '../src/types.js';

const source = 'def normalize(x):\n    return x / 2\n';
const py = (artifact: string, text = source) => analyzePython({ artifact, kind: 'file', source: text });
const cell = (index: number, id?: string, text = source, artifact = 'demo.ipynb') => analyzePython({ artifact, kind: 'cell', source: text, cell: { index, ...(id ? { id } : {}) } });
const first = (analysis: UnitAnalysis) => {
  const symbol = analysis.symbols[0];
  if (!symbol) throw new Error('Expected fixture symbol');
  return symbol;
};
const named = (analysis: UnitAnalysis, qualifiedName: string) => {
  const symbol = analysis.symbols.find(candidate => candidate.qualifiedName === qualifiedName);
  if (!symbol) throw new Error(`Expected fixture symbol ${qualifiedName}`);
  return symbol;
};

describe('conservative code anchors', () => {
  test('round-trips a serializable anchor and ignores changed line numbers', async () => {
    const before = await py('a.py');
    const anchor = JSON.parse(JSON.stringify(createAnchor(before, first(before))));
    const after = await py('a.py', `# header\n\n${source}`);
    expect(resolveAnchor(anchor, [after])).toMatchObject({ status: 'resolved', needsReview: false, target: { artifact: 'a.py', range: { start: { line: 2 } } } });
  });

  test('finds a unique symbol after rename and file move', async () => {
    const before = await py('a.py');
    const after = await py('models/b.py', source.replace('normalize', 'rescale'));
    expect(resolveAnchor(createAnchor(before, first(before)), [after])).toMatchObject({ status: 'resolved', needsReview: false, target: { artifact: 'models/b.py', symbol: 'rescale' } });
  });

  test('does not pick arbitrarily between duplicate implementations after a move', async () => {
    const before = await py('a.py');
    const after = await Promise.all([py('b.py'), py('c.py')]);
    const result = resolveAnchor(createAnchor(before, first(before)), after);
    expect(result.status).toBe('ambiguous');
    expect(result.candidates).toHaveLength(2);
  });

  test('marks a method ambiguous when its enclosing class is duplicated', async () => {
    const before = await py('a.py', 'class C:\n    def f(self):\n        return 1\n');
    const after = await py('a.py', 'class C:\n    pass\n\nclass C:\n    def f(self):\n        return 1\n');

    const result = resolveAnchor(createAnchor(before, named(before, 'C.f')), [after]);

    expect(result.status).toBe('ambiguous');
    expect(result.candidates).toEqual([
      expect.objectContaining({ artifact: 'a.py', symbol: 'C.f' }),
    ]);
  });

  test('marks a nested function ambiguous when its outer function is duplicated', async () => {
    const before = await py('a.py', 'def outer():\n    def inner():\n        return 1\n    return inner()\n');
    const after = await py('a.py', 'def outer():\n    pass\n\ndef outer():\n    def inner():\n        return 1\n    return inner()\n');

    const result = resolveAnchor(createAnchor(before, named(before, 'outer.inner')), [after]);

    expect(result.status).toBe('ambiguous');
    expect(result.candidates).toEqual([
      expect.objectContaining({ artifact: 'a.py', symbol: 'outer.inner' }),
    ]);
  });

  test('marks structural relocation into a duplicated enclosing scope ambiguous', async () => {
    const before = await py('a.py', 'class C:\n    def f(self):\n        return 1\n');
    const after = await py('b.py', 'class Renamed:\n    pass\n\nclass Renamed:\n    def moved(self):\n        return 1\n');

    const result = resolveAnchor(createAnchor(before, named(before, 'C.f')), [after]);

    expect(result.status).toBe('ambiguous');
    expect(result.candidates).toEqual([
      expect.objectContaining({ artifact: 'b.py', symbol: 'Renamed.moved' }),
    ]);
  });

  test('flags edits to an existing symbol for review', async () => {
    const before = await py('a.py');
    const after = await py('a.py', source.replace('/ 2', '/ 3'));
    expect(resolveAnchor(createAnchor(before, first(before)), [after])).toMatchObject({ status: 'resolved', needsReview: true });
  });

  test('reports deleted code as missing', async () => {
    const before = await py('a.py');
    expect(resolveAnchor(createAnchor(before, first(before)), [await py('a.py', '')]).status).toBe('missing');
  });

  test('does not resolve a function through malformed enclosing syntax', async () => {
    const before = await py('a.py', 'def f():\n    return 1\n');
    const after = await py('a.py', 'if :\n    def f():\n        return 1\n');

    expect(resolveAnchor(createAnchor(before, first(before)), [after]).status).toBe('missing');
  });

  test('uses stable cell IDs after reorder, even if another cell has identical content', async () => {
    const before = await cell(0, 'original');
    const after = await Promise.all([cell(0, 'copy'), cell(4, 'original')]);
    expect(resolveAnchor(createAnchor(before, first(before)), after)).toMatchObject({ status: 'resolved', target: { cell: { index: 4, id: 'original' } } });
  });

  test('does not attach a deleted ID-bearing cell to an identical cell with a different ID', async () => {
    const before = await cell(0, 'original');
    expect(resolveAnchor(createAnchor(before, first(before)), [await cell(0, 'copy')]).status).toBe('missing');
  });

  test('supports whole-cell anchors without IDs through reorder by unique content', async () => {
    const before = await cell(0);
    const after = await Promise.all([cell(0, undefined, 'value = 42\n'), cell(3)]);
    expect(resolveAnchor(createAnchor(before), after)).toMatchObject({ status: 'resolved', target: { cell: { index: 3 } } });
  });

  test('marks identical cells without IDs ambiguous instead of following the old index', async () => {
    const before = await cell(0);
    const after = await Promise.all([cell(0), cell(2)]);
    expect(resolveAnchor(createAnchor(before), after).status).toBe('ambiguous');
  });

  test('finds symbols in an ID-less cell only if its containing cell is unambiguous', async () => {
    const before = await cell(0);
    const after = await Promise.all([cell(0), cell(2)]);
    expect(resolveAnchor(createAnchor(before, first(before)), after).status).toBe('ambiguous');
  });

  test('supports notebook file rename when cell ID and fingerprint both match uniquely', async () => {
    const before = await cell(0, 'original');
    const after = await cell(3, 'original', source, 'renamed.ipynb');
    expect(resolveAnchor(createAnchor(before), [after])).toMatchObject({ status: 'resolved', target: { artifact: 'renamed.ipynb', cell: { index: 3 } } });
  });

  test('keeps whole-file anchors and marks changed content for review', async () => {
    const before = await py('a.py');
    expect(resolveAnchor(createAnchor(before), [await py('a.py', 'value = 4\n')])).toMatchObject({ status: 'resolved', needsReview: true });
  });
});
