import { Worker } from 'node:worker_threads';
import type { ProjectAudit, SourceOverride } from '@citetrace/core';

/** One isolated worker per scan; abort, failure and success all release it. */
export function scanInWorker(workerPath: string, root: string, overrides: SourceOverride[], signal: AbortSignal): Promise<ProjectAudit> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { const error = new Error('Scan cancelled.'); error.name = 'AbortError'; reject(error); return; }
    const worker = new Worker(workerPath);
    let settled = false;
    const finish = (error?: Error, result?: ProjectAudit) => {
      if (settled) return; settled = true;
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      void worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => { const error = new Error('Scan cancelled.'); error.name = 'AbortError'; finish(error); };
    const timer = setTimeout(() => finish(new Error('Project scan exceeded 30 seconds. Narrow the project using .gitignore.')), 30_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.once('error', error => finish(error));
    worker.once('exit', code => { if (!settled) finish(new Error(`Scanner exited before returning a result (${code}).`)); });
    worker.once('message', (message: { result?: ProjectAudit; error?: string }) => {
      if (message.error) finish(new Error(message.error));
      else if (message.result) finish(undefined, message.result);
      else finish(new Error('Invalid scanner response.'));
    });
    worker.postMessage({ root, overrides });
  });
}
