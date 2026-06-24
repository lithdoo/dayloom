export interface FilteredStreamOutput {
  push(chunk: string): void;
  flush(): void;
}

export function createFilteredStreamOutput(options: {
  hiddenBlocks: string[];
  write?: (text: string) => void;
}): FilteredStreamOutput {
  const write = options.write ?? (text => process.stdout.write(text));
  const hidden = new Set(options.hiddenBlocks.map(label => label.toLowerCase()));
  let buffer = '';
  let suppressing = false;

  const handleLine = (line: string, newline: boolean): void => {
    const trimmed = line.trim();
    if (suppressing) {
      if (trimmed.startsWith('```')) suppressing = false;
      return;
    }
    const match = trimmed.match(/^```(?:json\s+)?([a-z0-9_-]+)/i);
    if (match && hidden.has(match[1].toLowerCase())) {
      suppressing = true;
      return;
    }
    write(line);
    if (newline) write('\n');
  };

  return {
    push(chunk: string): void {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) handleLine(line, true);
    },
    flush(): void {
      if (buffer !== '') {
        const line = buffer;
        buffer = '';
        handleLine(line, false);
      }
    }
  };
}
