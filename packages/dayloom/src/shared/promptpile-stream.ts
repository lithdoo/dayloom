export interface PromptpileStreamConsumer {
  push(chunk: string): void;
  flush(): void;
}

export function createPromptpileStreamConsumer(options: {
  onDelta: (text: string) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
}): PromptpileStreamConsumer {
  let buffer = '';

  const handleLine = (rawLine: string): void => {
    const line = rawLine.trim();
    if (!line) {
      return;
    }

    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new Error('Invalid promptpile stream JSON: ' + detail + ': ' + line);
    }

    if (!event || typeof event !== 'object') {
      throw new Error('Invalid promptpile stream event: ' + line);
    }

    const payload = event as Record<string, unknown>;
    const type = payload.type;
    if (type === 'assistant_delta') {
      if (typeof payload.content !== 'string') {
        throw new Error('Invalid promptpile assistant_delta event: ' + line);
      }
      options.onDelta(payload.content);
      return;
    }
    if (type === 'assistant_done') {
      options.onDone?.();
      return;
    }
    if (type === 'error') {
      const message = typeof payload.message === 'string' ? payload.message : line;
      options.onError?.(message);
      return;
    }

    throw new Error('Unknown promptpile stream event type: ' + String(type));
  };

  return {
    push(chunk: string): void {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        handleLine(line);
      }
    },
    flush(): void {
      if (buffer.trim() !== '') {
        const line = buffer;
        buffer = '';
        handleLine(line);
      }
    }
  };
}
