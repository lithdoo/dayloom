import type { Translator } from '../i18n';
import type { SettlementProposal } from './types';

const DIARY_PREVIEW_LINES = 8;

export function formatSettlementReview(
  proposal: SettlementProposal,
  changesDescription: string,
  t: Translator,
): string {
  const lines: string[] = [
    '--- Settlement proposal review ---',
    '',
    t('cli.settle.reviewSummary'),
    proposal.summary.trim(),
    '',
    t('cli.settle.reviewDiary'),
    ...previewDiary(proposal.diary),
    '',
    t('cli.settle.reviewChanges'),
    changesDescription.trim(),
    '',
    '---',
  ];
  return lines.join('\n');
}

function previewDiary(diary: string): string[] {
  const diaryLines = diary.trim().split('\n');
  if (diaryLines.length <= DIARY_PREVIEW_LINES) {
    return diaryLines;
  }
  return [
    ...diaryLines.slice(0, DIARY_PREVIEW_LINES),
    `... (${diaryLines.length - DIARY_PREVIEW_LINES} more lines)`,
  ];
}
