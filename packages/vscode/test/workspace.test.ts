import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { knownWorkspaceRoot } from '../src/workspace.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

test('public API roots are restricted to the normalized current workspace set', async () => {
  const root = await mkdtemp(join(tmpdir(), 'citetrace-known-root-')); temporary.push(root);
  const sibling = await mkdtemp(join(tmpdir(), 'citetrace-sibling-')); temporary.push(sibling);
  const alias = `${root}-alias`; temporary.push(alias); await symlink(root, alias);
  expect(knownWorkspaceRoot(join(root, '.'), [root])).toBe(root);
  expect(() => knownWorkspaceRoot(sibling, [root])).toThrow(/unknown workspace/i);
  expect(() => knownWorkspaceRoot(dirname(root), [root])).toThrow(/unknown workspace/i);
  expect(() => knownWorkspaceRoot(alias, [root])).toThrow(/unknown workspace/i);
  expect(() => knownWorkspaceRoot(root, [])).toThrow(/unknown workspace/i);
});
