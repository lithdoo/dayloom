import type { SessionIO, StreamWriter } from './types';

export interface AiDisplayStreamOptions {
  hiddenBlocks?: string[];
}

export function createAiDisplayStream(
  io: SessionIO,
  options: AiDisplayStreamOptions = {},
): StreamWriter {
  return io.createStreamWriter({
    hiddenBlocks: options.hiddenBlocks ?? [],
  });
}

export async function runWithAiDisplayStream<T>(
  io: SessionIO,
  options: AiDisplayStreamOptions,
  task: (stream: StreamWriter) => Promise<T>,
): Promise<T> {
  const stream = createAiDisplayStream(io, options);
  try {
    return await task(stream);
  } finally {
    stream.flush();
  }
}
