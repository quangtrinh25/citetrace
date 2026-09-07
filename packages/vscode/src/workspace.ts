import { resolve } from 'node:path';

/** Resolve harmless path segments while requiring the caller to use a path
 * that names an open workspace directly. Filesystem aliases are not accepted. */
export function knownWorkspaceRoot(requested: string, roots: Iterable<string>): string {
  const normalized = resolve(requested);
  for (const root of roots) if (resolve(root) === normalized) return root;
  throw new Error('Unknown workspace. Open the local workspace folder before auditing it.');
}
