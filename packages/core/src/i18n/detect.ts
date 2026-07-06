import type { Locale } from './messages';

export function detectLocale(argv: string[] = process.argv, env: NodeJS.ProcessEnv = process.env): Locale {
  return normalizeLocale(readArgLocale(argv) ?? env.DAYLOOM_LANG ?? env.LC_ALL ?? env.LC_MESSAGES ?? env.LANG);
}

export function normalizeLocale(value: string | undefined): Locale {
  const normalized = (value ?? '').trim().toLowerCase().replace('_', '-');
  if (normalized === 'zh' || normalized.startsWith('zh-') || normalized.includes('chinese')) return 'zh';
  return 'en';
}

function readArgLocale(argv: string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--lang') return argv[index + 1];
    if (arg.startsWith('--lang=')) return arg.slice('--lang='.length);
  }
  return undefined;
}
