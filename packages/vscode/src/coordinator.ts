export class LatestScan<T> {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;
  private generation = 0;
  private disposed = false;
  constructor(private readonly perform: (signal: AbortSignal) => Promise<T>, private readonly publish: (value: T) => void, private readonly onError: (error: unknown) => void, private readonly delay = 1000) {}
  private invalidate(): void {
    this.generation += 1;
    this.controller?.abort();
    clearTimeout(this.timer);
  }
  schedule(): void {
    if (this.disposed) return;
    this.invalidate();
    this.timer = setTimeout(() => { void this.run().catch(() => undefined); }, this.delay);
  }
  async run(): Promise<T> {
    this.invalidate();
    if (this.disposed) throw new Error('Scanner disposed.');
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    let result: T;
    try { result = await this.perform(controller.signal); }
    catch (error) {
      if (!controller.signal.aborted && generation === this.generation && !(error instanceof Error && error.name === 'AbortError')) this.onError(error);
      throw error;
    }
    if (controller.signal.aborted || generation !== this.generation) {
      const error = new Error('Scan superseded by newer editor content.'); error.name = 'AbortError'; throw error;
    }
    this.publish(result);
    return result;
  }
  dispose(): void { this.disposed = true; this.invalidate(); }
}
