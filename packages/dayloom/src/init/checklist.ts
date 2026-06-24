import type { InitPayload } from './types';

const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;

function nonEmpty(s: string | undefined): boolean {
  return typeof s === 'string' && s.trim().length > 0;
}

export function getInterviewMissingFromTranscript(transcript: string): string[] {
  const missing: string[] = [];
  const lower = transcript.toLowerCase();

  if (transcript.trim().length < 80) {
    missing.push('premise');
  }
  if (!/规则|边界|constraint|rule/i.test(transcript)) {
    missing.push('rules');
  }
  if (!/风格|文风|style|tone/i.test(transcript)) {
    missing.push('style');
  }
  if (!/主角|你扮演|user|protagonist|我/i.test(transcript)) {
    missing.push('user_role');
  }
  if (!/npc|人物|角色|同伴|朋友|同事|char_/i.test(lower)) {
    missing.push('npc');
  }

  return missing;
}

export function isPayloadComplete(payload: InitPayload): string[] {
  const missing: string[] = [];

  if (!nonEmpty(payload.manifest?.id)) {
    missing.push('manifest.id');
  }
  if (!nonEmpty(payload.manifest?.title)) {
    missing.push('manifest.title');
  }
  if (!nonEmpty(payload.canon?.['premise.md'])) {
    missing.push('canon.premise');
  }
  if (!nonEmpty(payload.canon?.['rules.md'])) {
    missing.push('canon.rules');
  }
  if (!nonEmpty(payload.canon?.['style.md'])) {
    missing.push('canon.style');
  }
  if (!nonEmpty(payload.canon?.['user_role.md'])) {
    missing.push('canon.user_role');
  }
  if (!nonEmpty(payload.state?.['world.yaml'])) {
    missing.push('state.world');
  }
  if (!payload.characters?.length) {
    missing.push('characters.min_one');
  } else {
    for (const c of payload.characters) {
      if (!SNAKE_CASE.test(c.id)) {
        missing.push(`characters.invalid_id:${c.id}`);
      }
      if (!nonEmpty(c.profileMd)) {
        missing.push(`characters.profile:${c.id}`);
      }
    }
  }

  return missing;
}

export function isInterviewReady(
  status: { status: string; missing: string[] },
  transcript: string
): boolean {
  if (status.status !== 'ready') {
    return false;
  }
  const transcriptMissing = getInterviewMissingFromTranscript(transcript);
  return status.missing.length === 0 && transcriptMissing.length === 0;
}
