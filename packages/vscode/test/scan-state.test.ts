import { expect, test } from 'vitest';
import { failScan, publishScan, type ScanPublication } from '../src/scan-state.js';

test('a failed scan invalidates the previously published audit', () => {
  const state: ScanPublication<{ links: string[] }> = {};
  publishScan(state, { links: ['old-link'] });
  expect(state.audit?.links).toEqual(['old-link']);
  failScan(state, new Error('ledger corrupt'));
  expect(state.audit).toBeUndefined();
  expect(state.error).toContain('ledger corrupt');
});
