#!/usr/bin/env node
import path from 'node:path';
import { migrateLegacyWorldProfileV1 } from './migrate';

async function main(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv.includes('--help')) { process.stdout.write('Usage: dayloom-core2 archive migrate-world-profile-v1 --source <legacy-world> --target <archive-v2-world>\n'); return; }
  if (argv[0] !== 'archive' || argv[1] !== 'migrate-world-profile-v1') throw new Error('Unknown command. Use --help for usage.');
  const source = option(argv, '--source'), target = option(argv, '--target');
  const result = await migrateLegacyWorldProfileV1(path.resolve(source), path.resolve(target));
  process.stdout.write(`${JSON.stringify({ status: 'migrated', worldId: result.world.manifest.worldId, revision: result.world.commit.revision, sourceFileCount: result.report.sourceFileCount, warnings: result.report.warnings }, null, 2)}\n`);
}
function option(argv: string[], name: string): string { const index = argv.indexOf(name); if (index < 0 || index + 1 >= argv.length || argv[index + 1].startsWith('--')) throw new Error(`${name} is required.`); return argv[index + 1]; }
main(process.argv.slice(2)).catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
