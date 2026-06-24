import type { Writable } from 'stream';

export interface Loading {
  update(label: string): void;
  stop(): void;
}

export interface LoadingOptions {
  delayMs?: number;
  intervalMs?: number;
  stream?: Writable & { isTTY?: boolean };
}

const FRAMES = ['|', '/', '-', '\\'];

export function startLoading(label: string, options: LoadingOptions = {}): Loading {
  const stream = options.stream ?? process.stdout;
  if (!stream.isTTY) return { update: () => undefined, stop: () => undefined };

  const delayMs = options.delayMs ?? 300;
  const intervalMs = options.intervalMs ?? 100;
  let currentLabel = label;
  let frameIndex = 0;
  let visible = false;
  let stopped = false;
  let interval: NodeJS.Timeout | undefined;

  const render = (): void => {
    if (stopped) return;
    visible = true;
    const text = `${currentLabel} ${FRAMES[frameIndex++ % FRAMES.length]}`;
    stream.write(`\r\u001b[2K${text}`);
  };

  const delay = setTimeout(() => {
    render();
    interval = setInterval(render, intervalMs);
  }, delayMs);

  return {
    update(nextLabel: string): void {
      currentLabel = nextLabel;
      if (visible) render();
    },
    stop(): void {
      if (stopped) return;
      stopped = true;
      clearTimeout(delay);
      if (interval) clearInterval(interval);
      if (visible) stream.write('\r\u001b[2K');
    },
  };
}

export async function withLoading<T>(
  label: string,
  task: (loading: Loading) => Promise<T> | T,
  options: LoadingOptions = {},
): Promise<T> {
  const loading = startLoading(label, options);
  try {
    return await task(loading);
  } finally {
    loading.stop();
  }
}
