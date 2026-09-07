export interface ScanPublication<T> { audit?: T; error?: string }

export function publishScan<T>(state: ScanPublication<T>, audit: T): void {
  state.audit = audit;
  delete state.error;
}

export function failScan<T>(state: ScanPublication<T>, error: unknown): void {
  delete state.audit;
  state.error = String(error);
}
