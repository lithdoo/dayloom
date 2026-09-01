import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';

export function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'dayloom-draft-assistant-test-'));
}

export async function llmConfig(root) {
  const target = path.join(root, 'llm.toml');
  await writeFile(target, '[[llm_api]]\nname = "test"\nmodel = "test"\nbase_url = "http://127.0.0.1:9"\napi_key_env = "DAYLOOM_ASSISTANT_TEST_KEY"\n\n[promptpile]\nllm_api = "test"\n', 'utf8');
  return target;
}

export function capture() {
  let stdout = '';
  let stderr = '';
  return {
    stdout: new Writable({ write(chunk, _encoding, callback) { stdout += chunk.toString(); callback(); } }),
    stderr: new Writable({ write(chunk, _encoding, callback) { stderr += chunk.toString(); callback(); } }),
    out: () => stdout,
    err: () => stderr,
  };
}
