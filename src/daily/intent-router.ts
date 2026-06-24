import { runPromptpileUntilText } from './promptpile-loop';
import { cleanupSession, createIntentSession } from './session';
import type { DailyAction, DailyDraft, DailyIntent } from './types';

const ACTIONS = new Set<DailyAction>(['continue', 'pending', 'start', 'cancel', 'exit']);
const MIN_CONFIDENCE = 0.8;

export function parseExplicitDailyAction(input: string): DailyAction | 'help' | undefined {
  const actions: Record<string, DailyAction | 'help'> = {
    '/pending': 'pending',
    '/start': 'start',
    '/cancel': 'cancel',
    '/exit': 'exit',
    '/help': 'help',
  };
  return actions[input.trim().toLowerCase()];
}

export function parseDailyIntent(text: string): DailyIntent {
  const match = text.match(/```(?:json\s+)?daily-intent\s*\n([\s\S]*?)```/i);
  if (!match) throw new Error('Assistant response missing daily-intent JSON block');
  let parsed: DailyIntent;
  try { parsed = JSON.parse(match[1].trim()) as DailyIntent; }
  catch (error) { throw new Error(`Failed to parse daily-intent JSON: ${error instanceof Error ? error.message : error}`); }
  validateDailyIntent(parsed);
  return parsed;
}

export function validateDailyIntent(intent: DailyIntent): void {
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) throw new Error('Daily intent must be an object');
  if (!ACTIONS.has(intent.action)) throw new Error(`Unsupported daily intent action: ${String(intent.action)}`);
  if (typeof intent.confidence !== 'number' || !Number.isFinite(intent.confidence) || intent.confidence < 0 || intent.confidence > 1) {
    throw new Error('Daily intent confidence must be between 0 and 1');
  }
  if (typeof intent.reason !== 'string' || !intent.reason.trim()) throw new Error('Daily intent reason must be non-empty');
}

export function effectiveDailyAction(intent: DailyIntent): DailyAction {
  return intent.confidence >= MIN_CONFIDENCE ? intent.action : 'continue';
}

export async function routeDailyIntent(
  input: string,
  draft: DailyDraft,
  latestAssistantReply: string,
  baseUrl: string,
  token: string | undefined,
  maxToolRounds: number,
  keepSession = false,
): Promise<DailyIntent> {
  const session = createIntentSession({ input, draft, latestAssistantReply });
  try {
    return parseDailyIntent(await runPromptpileUntilText(session, baseUrl, token, maxToolRounds, () => undefined, true));
  } finally {
    if (keepSession) process.stderr.write(`Daily intent session preserved at: ${session.root}\n`);
    else cleanupSession(session);
  }
}

export function fallbackDailyIntent(reason: string): DailyIntent {
  return { action: 'continue', confidence: 0, reason };
}
