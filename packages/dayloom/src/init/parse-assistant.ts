import type { InterviewStatus } from './types';

function extractFencedBlock(text: string, label: string): string | null {
  const re = new RegExp(
    '```(?:json\\s+)?' + label + '\\s*\\n([\\s\\S]*?)```',
    'i'
  );
  const m = text.match(re);
  if (m) {
    return m[1].trim();
  }
  const generic = text.match(/```json\s*\n([\s\S]*?)```/i);
  return generic ? generic[1].trim() : null;
}

export function parseInterviewStatus(assistantText: string): InterviewStatus {
  const raw =
    extractFencedBlock(assistantText, 'init-status') ??
    extractFencedBlock(assistantText, '');

  if (!raw) {
    return { status: 'continue', missing: ['init-status block'] };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<InterviewStatus>;
    const status = parsed.status === 'ready' ? 'ready' : 'continue';
    const missing = Array.isArray(parsed.missing)
      ? parsed.missing.map(String)
      : [];
    return { status, missing };
  } catch {
    return { status: 'continue', missing: ['invalid init-status JSON'] };
  }
}

export function parseInitPayload<T>(assistantText: string): T {
  const raw =
    extractFencedBlock(assistantText, 'init-payload') ??
    extractFencedBlock(assistantText, '');

  if (!raw) {
    throw new Error('Assistant response missing init-payload JSON block');
  }

  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    throw new Error(
      `Failed to parse init-payload JSON: ${e instanceof Error ? e.message : e}`
    );
  }
}

export function stripInitStatusBlock(text: string): string {
  return text
    .replace(/```(?:json\s+)?init-status\s*\n[\s\S]*?```/gi, '')
    .trim();
}
