import {
  describeNextAction,
  formatNextStatus,
  type Translator,
} from '@dayloom/core-old';
import type {
  HubAction,
  HubHelpContent,
  HubRecentSummary,
  HubStatusContent,
} from './types.js';
import type { ResolvedHubActions } from './actions.js';

export interface ResolveHubContentOptions {
  worldDir: string;
  t: Translator;
  recent?: HubRecentSummary;
  resolved: ResolvedHubActions;
}

export function resolveHubStatus(options: ResolveHubContentOptions): HubStatusContent {
  const { worldDir, t, recent, resolved } = options;
  if (!resolved.state) {
    return {
      worldRoot: worldDir,
      initialized: false,
      nextLabel: '',
      nextSummary: '',
      actions: actionSummaries(resolved.actions),
      recent,
      error: resolved.error,
    };
  }

  const state = resolved.state;
  return {
    worldRoot: state.worldRoot,
    initialized: state.kind === 'initialized',
    day: state.kind === 'initialized' ? state.day : undefined,
    phase: state.kind === 'initialized' ? state.phase : undefined,
    nextLabel: state.action,
    nextSummary: describeNextAction(state, t),
    actions: actionSummaries(resolved.actions),
    recent,
    error: undefined,
  };
}

export function resolveHubHelp(t: Translator): HubHelpContent {
  return {
    hubCommands: [
      { label: t('shell.next.hint'), summary: t('shell.next.summary'), shortcut: 'n' },
      { label: t('shell.status.hint'), summary: t('shell.status.summary'), shortcut: 's' },
      { label: t('shell.help.hint'), summary: t('shell.help.summary'), shortcut: '?' },
      { label: t('shell.revise.hint'), summary: t('shell.revise.summary'), shortcut: 'r' },
      { label: t('shell.quit.hint'), summary: t('shell.quit.summary'), shortcut: 'q' },
    ],
    sessionCommands: [
      { command: '/exit', summary: t('commands.exit.summary') },
      { command: '/save', summary: t('commands.save.summary'), availability: 'init / daily / revise' },
      { command: '/cancel', summary: t('commands.cancel.summary'), availability: 'init / daily / revise' },
      { command: '/quit', summary: t('shell.quit.summary') },
    ],
  };
}

export function formatHubStatus(content: HubStatusContent, t: Translator): string {
  const lines = ['状态', ''];
  if (content.error) {
    lines.push(`World: ${content.worldRoot}`);
    lines.push(`Error: ${content.error}`);
  } else if (!content.initialized) {
    lines.push(`World: ${content.worldRoot}`);
    lines.push(t('next.currentUninitialized'));
  } else {
    lines.push(`World: ${content.worldRoot}`);
    if (content.day && content.phase) {
      lines.push(t('next.currentPhase', { day: content.day, phase: content.phase }));
    }
  }

  if (content.nextLabel) {
    lines.push('');
    lines.push(t('next.nextAction', { action: content.nextLabel }));
    if (content.nextSummary) lines.push(content.nextSummary);
  }

  if (content.actions.length > 0) {
    lines.push('');
    lines.push(t('commands.available'));
    for (const action of content.actions) {
      lines.push(`- ${action.label}`);
    }
  }

  if (content.recent) {
    lines.push('');
    lines.push(`${content.recent.label}${content.recent.detail ? `: ${content.recent.detail}` : ''}`);
  }

  return lines.join('\n');
}

export function formatHubHelp(content: HubHelpContent): string {
  const lines = ['帮助', '', '指令页'];
  for (const command of content.hubCommands) {
    const shortcut = command.shortcut ? ` (${command.shortcut})` : '';
    lines.push(`- ${command.label}${shortcut}: ${command.summary}`);
  }

  lines.push('', '对话页');
  for (const command of content.sessionCommands) {
    const availability = command.availability ? ` [${command.availability}]` : '';
    lines.push(`- ${command.command}${availability}: ${command.summary}`);
  }

  return lines.join('\n');
}

export function formatNextStatusForHub(options: ResolveHubContentOptions): string {
  return options.resolved.state
    ? formatNextStatus(options.resolved.state, options.t)
    : formatHubStatus(resolveHubStatus(options), options.t);
}

function actionSummaries(actions: readonly HubAction[]): HubStatusContent['actions'] {
  return actions.map((action) => ({
    id: action.id,
    label: action.label,
  }));
}
