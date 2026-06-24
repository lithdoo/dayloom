import type { ReviseDraft, RevisePayload } from './types';

function extractBlock(text: string, label: string): string | null {
  const m = text.match(new RegExp('```(?:json\\s+)?' + label + '\\s*\\n([\\s\\S]*?)```', 'i'));
  return m ? m[1].trim() : null;
}

export function parseReviseStatus(text: string): ReviseDraft | undefined {
  const raw = extractBlock(text, 'revise-status');
  if (!raw) return undefined;
  const parsed = JSON.parse(raw) as ReviseDraft;
  if (!parsed || !Array.isArray(parsed.pending_changes)) {
    throw new Error('revise-status pending_changes must be an array');
  }
  for (const [index, item] of parsed.pending_changes.entries()) {
    if (!item || typeof item !== 'object' || typeof item.instruction !== 'string' || !item.instruction.trim()) {
      throw new Error(`revise-status pending_changes[${index}] is invalid`);
    }
    if (!item.target || typeof item.target !== 'object' || Array.isArray(item.target)) {
      throw new Error(`revise-status pending_changes[${index}].target is invalid`);
    }
  }
  return parsed;
}

export function parseRevisePayload(text: string): RevisePayload {
  const raw = extractBlock(text, 'revise-payload');
  if (!raw) throw new Error('Assistant response missing revise-payload JSON block');
  try {
    return JSON.parse(raw) as RevisePayload;
  } catch (err) {
    throw new Error(`Failed to parse revise-payload JSON: ${err instanceof Error ? err.message : err}`);
  }
}

export function stripReviseStatus(text: string): string {
  return text.replace(/```(?:json\s+)?revise-status\s*\n[\s\S]*?```/gi, '').trim();
}
