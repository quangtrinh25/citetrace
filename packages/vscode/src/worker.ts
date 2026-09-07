import { parentPort } from 'node:worker_threads';
import { auditProject, type SourceOverride } from '@citetrace/core';

parentPort?.on('message', async (request: { root: string; overrides: SourceOverride[] }) => {
  try { parentPort?.postMessage({ result: await auditProject(request.root, request.overrides) }); }
  catch (error) { parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
});
