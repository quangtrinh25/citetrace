import { describe, expect, test } from 'vitest';
import { analyzePython } from '../src/python.js';
import type { SourceUnit } from '../src/types.js';

const file = (source: string): SourceUnit => ({ artifact: 'src/model.py', kind: 'file', source });

describe('Python analysis', () => {
  test('extracts decorated classes, methods and nested async functions with source ranges', async () => {
    const result = await analyzePython(file('@decorator\nclass Model:\n    async def forward(self, x):\n        def normalize(y):\n            return y / 2\n        return normalize(x)\n'));
    expect(result.symbols.map(s => [s.kind, s.qualifiedName])).toEqual([
      ['class', 'Model'], ['method', 'Model.forward'], ['function', 'Model.forward.normalize'],
    ]);
    expect(result.symbols[0]?.range.start).toEqual({ line: 0, character: 0 });
    expect(result.symbols[1]?.range.start).toEqual({ line: 2, character: 4 });
    expect(result.diagnostics).toEqual([]);
  });

  test('keeps fingerprints stable through formatting, comments and declaration rename', async () => {
    const a = await analyzePython(file('def normalize(x):\n    return x / 2\n'));
    const b = await analyzePython(file('# moved\ndef rescale( x ):\n  # explanation\n  return x/2\n'));
    expect(a.symbols[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(b.symbols[0]?.fingerprint).toBe(a.symbols[0]?.fingerprint);
  });

  test('detects meaningful operator, literal and decorator changes', async () => {
    const texts = ['def f(x):\n return x / 2\n', 'def f(x):\n return x * 2\n', 'def f(x):\n return x / 3\n', '@cache\ndef f(x):\n return x / 2\n'];
    const results = await Promise.all(texts.map(text => analyzePython(file(text))));
    expect(new Set(results.map(r => r.symbols[0]?.fingerprint)).size).toBe(4);
  });

  test('does not extract definitions from string contents or comments', async () => {
    const result = await analyzePython(file('text = "def fake(): pass"\n# class Fake: pass\ndef real():\n    return "hi"\n'));
    expect(result.symbols.map(s => s.name)).toEqual(['real']);
  });

  test('reports syntax errors and skips affected definitions while preserving valid symbols', async () => {
    const result = await analyzePython(file('def good(x):\n    return x\n\ndef broken(x):\n    return (\n'));
    expect(result.diagnostics.some(d => d.code === 'syntax-error')).toBe(true);
    expect(result.symbols.map(s => s.name)).toContain('good');
    expect(result.symbols.map(s => s.name)).not.toContain('broken');
  });

  test.each([
    [
      'an invalid enclosing statement',
      'def good():\n    return 1\n\nif :\n    def affected():\n        return 2\n',
    ],
    [
      'an invalid decorator argument',
      'def good():\n    return 1\n\n@dec(x=)\ndef affected():\n    return 2\n',
    ],
    [
      'an incomplete decorator recovered as an undecorated function',
      'def good():\n    return 1\n\n@broken(\ndef affected():\n    return 2\n',
    ],
    [
      'an incomplete decorator separated by comments and blank lines',
      'def good():\n    return 1\n\n@broken(\n# research note\n\n# another note\ndef affected():\n    return 2\n',
    ],
  ])('skips definitions under %s while retaining independent top-level definitions', async (_description, text) => {
    const result = await analyzePython(file(text));

    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'syntax-error' }),
    ]);
    expect(result.symbols.map(symbol => symbol.qualifiedName)).toEqual(['good']);
  });

  test('skips unsupported magic cells with an explicit diagnostic', async () => {
    const result = await analyzePython({ artifact: 'demo.ipynb', kind: 'cell', cell: { index: 2, id: 'x' }, source: '%%bash\ndef f():\n    pass\n' });
    expect(result.symbols).toEqual([]);
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'unsupported-magic', cellIndex: 2 })]);
  });

  test('does not mistake modulo operators or string contents for notebook magic', async () => {
    const result = await analyzePython({ artifact: 'demo.ipynb', kind: 'cell', cell: { index: 0 }, source: 'def f(x):\n    text = """\n%not_a_magic\n"""\n    return x % 2\n' });
    expect(result.diagnostics).toEqual([]);
    expect(result.symbols.map(s => s.name)).toEqual(['f']);
  });

  test('uses source coordinates compatible with Unicode text', async () => {
    const result = await analyzePython(file('label = "🔬"\ndef chuẩn_hóa(x):\n    return x\n'));
    expect(result.symbols[0]?.name).toBe('chuẩn_hóa');
    expect(result.symbols[0]?.range.start).toEqual({ line: 1, character: 0 });
  });
});
