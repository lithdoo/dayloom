import { runProcess, type RunResult } from '../revise/process-run';
import { createPromptpileStreamConsumer } from './promptpile-stream';

export async function runPromptpileWithStream(options: {
  command: string;
  args: string[];
  cwd: string;
  quiet?: boolean;
  onDelta: (text: string) => void;
}): Promise<RunResult> {
  const consumer = createPromptpileStreamConsumer({
    onDelta: options.onDelta,
    onError: message => {
      throw new Error('promptpile stream error: ' + message);
    }
  });

  const result = await runProcess(
    options.command,
    [
      ...options.args,
      '--output-pile-fd',
      '3',
      '--output-pile-format',
      'json'
    ],
    {
      cwd: options.cwd,
      quiet: options.quiet,
      outputPile: {
        fd: 3,
        onData: chunk => consumer.push(chunk)
      }
    }
  );

  try {
    consumer.flush();
  } catch (e) {
    return { ...result, error: e instanceof Error ? e : new Error(String(e)) };
  }

  return result;
}
