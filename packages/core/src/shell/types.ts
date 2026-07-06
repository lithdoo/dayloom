import type { Translator } from '../i18n';
import type { SessionIO } from '../session-io';

export interface GameShellOptions {
  worldDir: string;
  io: SessionIO;
  t?: Translator;
  autoStart?: boolean;
  quick?: boolean;
  id?: string;
  title?: string;
  maxRounds?: number;
  dryRun?: boolean;
  yes?: boolean;
  keepSession?: boolean;
  maxToolRounds?: number;
  maxEventRounds?: number;
  mcpBaseUrl?: string;
  mcpToken?: string;
}
