/**
 * Generic polling loop with exponential backoff (2×, capped) and
 * pause-while-hidden, so a background tab costs nobody any bandwidth.
 */

export interface PollerOptions {
  intervalMs: number;
  maxBackoffMs: number;
  /** Does one poll; throw to signal failure. */
  run: () => Promise<void>;
  onError?: (err: unknown) => void;
  /** Pause while `document.hidden`. Default true in browsers. */
  pauseWhenHidden?: boolean;
  now?: () => number;
}

/** Delay before the next poll after `failures` consecutive failures. */
export function nextDelay(failures: number, intervalMs: number, maxBackoffMs: number): number {
  if (failures <= 0) return intervalMs;
  return Math.min(intervalMs * 2 ** failures, maxBackoffMs);
}

export interface Poller {
  start(): void;
  stop(): void;
}

export function createPoller(opts: PollerOptions): Poller {
  const now = opts.now ?? Date.now;
  const canHide = typeof document !== 'undefined' && (opts.pauseWhenHidden ?? true);
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let nextAt = 0;
  let running = false;
  let stopped = true;

  const schedule = (delay: number) => {
    clearTimeout(timer);
    nextAt = now() + delay;
    if (canHide && document.hidden) return; // resumed by the visibility handler
    timer = setTimeout(tick, delay);
  };

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await opts.run();
      failures = 0;
    } catch (err) {
      failures += 1;
      opts.onError?.(err);
    } finally {
      running = false;
    }
    if (!stopped) schedule(nextDelay(failures, opts.intervalMs, opts.maxBackoffMs));
  };

  const onVisibility = () => {
    if (stopped) return;
    if (document.hidden) {
      clearTimeout(timer);
    } else if (!running) {
      clearTimeout(timer);
      timer = setTimeout(tick, Math.max(0, nextAt - now()));
    }
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      if (canHide) document.addEventListener('visibilitychange', onVisibility);
      nextAt = now();
      void tick();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      if (canHide) document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
