import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

test('manifest uses the required persistent extension identity', async () => {
  const manifest = JSON.parse(await readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { name?: string; publisher?: string };
  expect(manifest).toMatchObject({ name: 'citetrace', publisher: 'citetrace' });
});
