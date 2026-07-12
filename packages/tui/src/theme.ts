import type { Translator } from '@dayloom/core';
import type { TuiMessageRole } from './view-model.js';

export function roleLabel(role: TuiMessageRole): string {
  switch (role) {
    case 'warn':
      return 'WARN';
    case 'error':
      return 'ERR ';
    case 'system':
      return 'SYS ';
    case 'output':
      return 'OUT ';
    default: {
      const _exhaustive: never = role;
      return String(_exhaustive);
    }
  }
}

export function roleColor(role: TuiMessageRole): string {
  switch (role) {
    case 'warn':
      return 'yellow';
    case 'error':
      return 'red';
    case 'system':
      return 'cyan';
    case 'output':
      return 'white';
    default: {
      const _exhaustive: never = role;
      return String(_exhaustive);
    }
  }
}

/** Platform-aware Textarea submit hint (Windows/Linux vs macOS Meta+Enter). */
export function multilineInputHint(
  t: Translator,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === 'darwin'
    ? t('tui.input.multilineHint.darwin')
    : t('tui.input.multilineHint');
}

export function footerHint(
  t: Translator,
  loading: string | null,
  hint: string,
): string {
  if (loading) {
    return t('tui.footer.loadingDisabled');
  }
  return hint || t('tui.footer.idle');
}
