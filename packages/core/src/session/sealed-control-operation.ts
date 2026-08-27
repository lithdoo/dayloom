import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SessionFileServerV1 } from '../promptpile/session-file-runtime';

type ControlServerId = Extract<SessionFileServerV1['id'], 'turn_control' | 'change_plan'>;
type ControlMode = 'turn-verdict' | 'change-plan';
type ControlState = { schemaVersion: 1; status: 'open' | 'sealed' | 'violated'; calls: number; message: string | null };

export class SealedControlProtocolError extends Error {
  readonly name = 'SealedControlProtocolError';
  constructor(readonly code: 'RESULT_MISSING' | 'RESULT_INVALID' | 'PROTOCOL_INCOMPLETE', message: string, options?: ErrorOptions) { super(message, options); }
}

export interface SealedControlOperationV1<T> {
  readonly server: SessionFileServerV1;
  assertReadyForFinal(): void;
  finish(): Promise<Readonly<T>>;
}

export async function createSealedControlOperationV1<T>(input: {
  root: string;
  mode: ControlMode;
  serverId: ControlServerId;
  toolName: 'turn_verdict' | 'declare_change_plan';
  context: Record<string, unknown>;
  serverScript: string;
  parse(value: unknown): Readonly<T>;
}): Promise<SealedControlOperationV1<T>> {
  await mkdir(input.root, { recursive: true });
  const resultPath = path.join(input.root, 'sealed.json');
  const statePath = path.join(input.root, 'control-state.json');
  const contextPath = path.join(input.root, 'control-context.json');
  await writeFile(statePath, serializeState({ schemaVersion: 1, status: 'open', calls: 0, message: null }));
  await writeFile(contextPath, `${JSON.stringify({ mode: input.mode, resultPath, statePath, ...input.context }, null, 2)}\n`);
  const validate = () => {
    let state: ControlState;
    try { state = parseState(JSON.parse(readFileSync(statePath, 'utf8'))); }
    catch (error) { throw new SealedControlProtocolError('PROTOCOL_INCOMPLETE', 'Control operation state is invalid.', { cause: error }); }
    if (state.status !== 'sealed' || state.calls !== 1) throw new SealedControlProtocolError('PROTOCOL_INCOMPLETE', state.message ?? 'The required control result was not sealed exactly once.');
    try { return input.parse(JSON.parse(readFileSync(resultPath, 'utf8'))); }
    catch (error) { const code = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'RESULT_MISSING' : 'RESULT_INVALID'; throw new SealedControlProtocolError(code, code === 'RESULT_MISSING' ? 'The required control result was not produced.' : 'The sealed control result is invalid.', { cause: error }); }
  };
  return Object.freeze({
    server: Object.freeze({ id: input.serverId, root: input.root, writable: false, tools: [input.toolName], command: { command: process.execPath, argsPrefix: [input.serverScript, contextPath] } }),
    assertReadyForFinal() { validate(); },
    async finish() { await readFile(statePath); return validate(); },
  });
}

function parseState(value: unknown): ControlState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Control state must be an object.');
  const row = value as Record<string, unknown>, keys = Object.keys(row).sort(), expected = ['calls', 'message', 'schemaVersion', 'status'];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index]) || row.schemaVersion !== 1 || !['open', 'sealed', 'violated'].includes(String(row.status)) || !Number.isSafeInteger(row.calls) || (row.calls as number) < 0 || row.message !== null && typeof row.message !== 'string') throw new Error('Control state is invalid.');
  return row as unknown as ControlState;
}
function serializeState(value: ControlState): string { return `${JSON.stringify(value, null, 2)}\n`; }
