import type { SessionCapability, SessionCommand } from './types.js';

const BLOCKED_HUB_COMMANDS: SessionCapability['blockedHubCommands'] = [
  'status',
  'help',
  'next',
  'revise',
];

export function getSessionCapability(command: SessionCommand): SessionCapability {
  switch (command) {
    case 'init':
    case 'daily':
    case 'revise':
      return {
        canExit: true,
        canCancel: true,
        canSave: true,
        canQuit: true,
        blockedHubCommands: BLOCKED_HUB_COMMANDS,
      };
    case 'play':
      return {
        canExit: true,
        canCancel: false,
        canSave: false,
        canQuit: true,
        blockedHubCommands: BLOCKED_HUB_COMMANDS,
      };
  }
}
