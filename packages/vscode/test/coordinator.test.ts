import { expect, test, vi } from 'vitest';
import { LatestScan } from '../src/coordinator.js';

test('new edits cancel stale scans and only the current result is published', async () => {
  const pending: Array<{ signal: AbortSignal; resolve: (value: string) => void }> = [];
  const published: string[] = [];
  const coordinator = new LatestScan(signal => new Promise<string>(resolve => pending.push({ signal, resolve })), value => published.push(value), error => { throw error; });
  const first = coordinator.run().catch(() => undefined);
  const second = coordinator.run();
  expect(pending[0]?.signal.aborted).toBe(true);
  pending[1]!.resolve('current');
  await second;
  pending[0]!.resolve('stale');
  await first;
  expect(published).toEqual(['current']);
  coordinator.dispose();
});

test('debounces edits and disposal cancels scheduled work', async () => {
  vi.useFakeTimers();
  let calls = 0;
  const coordinator = new LatestScan(async () => ++calls, () => {}, () => {});
  coordinator.schedule();
  await vi.advanceTimersByTimeAsync(600);
  coordinator.schedule();
  await vi.advanceTimersByTimeAsync(600);
  expect(calls).toBe(0);
  await vi.advanceTimersByTimeAsync(400);
  expect(calls).toBe(1);
  coordinator.schedule();
  coordinator.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(calls).toBe(1);
  vi.useRealTimers();
});

test('a failed current run publishes one error for state invalidation', async () => {
  const errors: string[] = [];
  const coordinator = new LatestScan(async () => { throw new Error('ledger corrupt'); }, () => {}, error => errors.push(String(error)));
  await expect(coordinator.run()).rejects.toThrow('ledger corrupt');
  expect(errors).toEqual(['Error: ledger corrupt']);
  coordinator.dispose();
});
