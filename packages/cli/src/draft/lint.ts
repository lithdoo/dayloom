import { cliErrorV1 } from '../cli/errors.js';
import type { CapturedDraftSnapshotV1 } from './snapshot.js';

const MAX_DRAFT_FILE_BYTES_V1 = 1024 * 1024;
const MAX_DRAFT_TOTAL_BYTES_V1 = 4 * 1024 * 1024;

export function lintCapturedDraftV1(draft: CapturedDraftSnapshotV1): void {
  if (draft.totalBytes > MAX_DRAFT_TOTAL_BYTES_V1) {
    throw cliErrorV1('DRAFT_INVALID', `Draft exceeds the ${MAX_DRAFT_TOTAL_BYTES_V1}-byte total limit.`);
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (const entry of draft.snapshot.entries) {
    if (entry.bytes === 0) throw cliErrorV1('DRAFT_INVALID', `Draft file is empty: ${entry.path}.`);
    if (entry.bytes > MAX_DRAFT_FILE_BYTES_V1) {
      throw cliErrorV1('DRAFT_INVALID', `Draft file exceeds the ${MAX_DRAFT_FILE_BYTES_V1}-byte limit: ${entry.path}.`);
    }
    const bytes = draft.files.get(entry.path);
    if (!bytes) throw cliErrorV1('DRAFT_INVALID', `Draft snapshot bytes are missing: ${entry.path}.`);
    let text: string;
    try { text = decoder.decode(bytes); }
    catch { throw cliErrorV1('DRAFT_INVALID', `Draft file is not valid UTF-8: ${entry.path}.`); }
    if (text.includes('\0')) throw cliErrorV1('DRAFT_INVALID', `Draft file contains a NUL character: ${entry.path}.`);
    if (text.trim() === '') throw cliErrorV1('DRAFT_INVALID', `Draft file contains no meaningful text: ${entry.path}.`);
  }
}
