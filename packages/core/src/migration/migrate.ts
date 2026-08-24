import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { hashBlobV1, type ArchiveMediaTypeV1 } from '@dayloom/archive-protocol';
import { parse, stringify } from 'yaml';
import { buildInitMutationV1 } from '../world/builders/init';
import { publishMutation, type WorldChange } from '../world/publish';
import { classifyWorld, readPublishedWorld } from '../world/read';
import { inventoryLegacyWorldV1, type LegacyFileV1 } from './inventory';

export interface MigrationReportEntryV1 { sourcePath: string; sourceSha256: string; targetPath: string; targetSha256: string; mode: 'identity' | 'semantic-transform' | 'legacy-preserve' }
export interface MigrationReportV1 { schemaVersion: 1; sourceFormat: string; sourceFileCount: number; entries: MigrationReportEntryV1[]; warnings: string[] }
export interface MigrationResultV1 { world: Awaited<ReturnType<typeof readPublishedWorld>>; report: Readonly<MigrationReportV1> }

export async function migrateLegacyWorldProfileV1(source: string, target: string): Promise<MigrationResultV1> {
  const sourceRoot = await realpath(source), targetRoot = path.resolve(target), relative = path.relative(sourceRoot, targetRoot), reverse = path.relative(targetRoot, sourceRoot);
  if (sourceRoot === targetRoot || !relative.startsWith('..') || !reverse.startsWith('..')) throw new Error('Legacy source and migration target must be disjoint directories.');
  const classified = await classifyWorld(targetRoot); if (classified.state.status !== 'uninitialized') throw new Error('Migration target must be uninitialized.');
  const files = await inventoryLegacyWorldV1(sourceRoot), byPath = new Map(files.map((file) => [file.path, file]));
  const manifest = yaml(byPath.get('manifest.yaml')?.text), title = stringValue(manifest.title) ?? path.basename(sourceRoot), sourceWorldId = stringValue(manifest.id);
  const entityIds = directoryIds(files, 'characters'), locationIds = directoryIds(files, 'scenes'), arcIds = directoryIds(files, 'arcs');
  const baseline = buildInitMutationV1({ version: 2, title, canon: { premise: '', rules: '', style: '', userRole: '' }, worldState: { status: 'active', elapsed: null, variables: {} }, characters: entityIds.map((id) => ({ key: id, profile: '', relationships: [], status: 'active', locationKey: null, tags: [] })), locations: locationIds.map((id) => ({ key: id, profile: '', status: 'active', tags: [], triggers: [] })), arcs: arcIds.map((id) => ({ key: id, profile: '', status: 'inactive' as const, stage: '' })), initialFacts: [], unresolvedThreads: [], storySeeds: [] });
  const changes = new Map(baseline.filter((change): change is Extract<WorldChange, { op: 'put' }> => change.op === 'put').map((change) => [change.path, change]));
  // Preserve legacy ids instead of the Init builder's sequential ids.
  remapEntityBaseline(changes, 'characters', entityIds, 'character'); remapEntityBaseline(changes, 'locations', locationIds, 'location'); remapEntityBaseline(changes, 'arcs', arcIds, 'arc');
  const entries: MigrationReportEntryV1[] = [], usedTargets = new Set<string>(), warnings: string[] = [];
  for (const file of files) {
    const mapped = mapLegacy(file, entityIds, locationIds, arcIds);
    let targetPath = mapped.path;
    if (usedTargets.has(targetPath)) { targetPath = preservePath(file.path); warnings.push(`Target collision preserved instead: ${file.path}`); }
    usedTargets.add(targetPath); const bytes = mapped.bytes, mediaType = media(targetPath);
    changes.set(targetPath, { op: 'put', path: targetPath, mediaType, bytes });
    entries.push({ sourcePath: file.path, sourceSha256: file.sha256, targetPath, targetSha256: hashBlobV1(bytes), mode: mapped.mode });
  }
  const report: MigrationReportV1 = { schemaVersion: 1, sourceFormat: 'dayloom-filesystem-v0', sourceFileCount: files.length, entries, warnings };
  const reportBytes = encodeJson(report); changes.set('legacy/migration-report.json', { op: 'put', path: 'legacy/migration-report.json', mediaType: 'application/json', bytes: reportBytes });
  const world = await publishMutation(targetRoot, { operationType: 'migration', base: null, initialManifest: { worldId: validId(sourceWorldId) ? sourceWorldId! : `world_${randomUUID().replaceAll('-', '')}`, title }, changes: [...changes.values()], control: { phase: 'idle', day: null, lastSettledDay: null } });
  const readBack = await readPublishedWorld(targetRoot); if (readBack.commit.id !== world.commit.id || report.entries.length !== files.length || new Set(report.entries.map((entry) => entry.sourcePath)).size !== files.length) throw new Error('Migration read-back or inventory equality failed.');
  return { world: readBack, report: Object.freeze(report) };
}

function mapLegacy(file: LegacyFileV1, characters: string[], locations: string[], arcs: string[]): { path: string; bytes: Uint8Array; mode: MigrationReportEntryV1['mode'] } {
  const directCanon: Record<string, string> = { 'canon/premise.md': 'canon/premise.md', 'canon/rules.md': 'canon/rules.md', 'canon/style.md': 'canon/style.md', 'canon/user_role.md': 'canon/user-role.md' };
  if (directCanon[file.path]) return mapped(directCanon[file.path], file.bytes, directCanon[file.path] === file.path ? 'identity' : 'semantic-transform');
  let match = /^characters\/([^/]+)\/(profile|memory|timeline)\.md$/.exec(file.path); if (match && characters.includes(entityId(match[1]))) return mapped(`characters/${entityId(match[1])}/${match[2]}.md`, file.bytes, entityId(match[1]) === match[1] ? 'identity' : 'semantic-transform');
  match = /^characters\/([^/]+)\/relationships\.md$/.exec(file.path); if (match && characters.includes(entityId(match[1]))) return mapped(`characters/${entityId(match[1])}/legacy-relationships.md`, file.bytes, 'semantic-transform');
  match = /^scenes\/([^/]+)\/(profile|memory|timeline)\.md$/.exec(file.path); if (match && locations.includes(entityId(match[1]))) return mapped(`locations/${entityId(match[1])}/${match[2]}.md`, file.bytes, 'semantic-transform');
  match = /^arcs\/([^/]+)\/(profile|timeline)\.md$/.exec(file.path); if (match && arcs.includes(entityId(match[1]))) return mapped(`arcs/${entityId(match[1])}/${match[2]}.md`, file.bytes, entityId(match[1]) === match[1] ? 'identity' : 'semantic-transform');
  match = /^(characters|scenes|arcs)\/([^/]+)\/meta\.yaml$/.exec(file.path); if (match) { const kind = match[1] === 'scenes' ? 'locations' : match[1], value = yaml(file.text); return mapped(`${kind}/${entityId(match[2])}/state.yaml`, encodeYaml({ schemaVersion: 1, status: stringValue(value.status) ?? 'active', ...(kind === 'characters' ? { locationId: null, tags: stringList(value.tags) } : kind === 'locations' ? { tags: stringList(value.tags) } : { stage: '', progress: null }) }), 'semantic-transform'); }
  if (/^(characters|scenes|arcs)\/index\.yaml$/.test(file.path)) { const kind = file.path.split('/')[0], ids = kind === 'characters' ? characters : kind === 'scenes' ? locations : arcs; return mapped(`${kind === 'scenes' ? 'locations' : kind}/index.yaml`, encodeYaml({ schemaVersion: 1, ids }), 'semantic-transform'); }
  match = /^scenes\/([^/]+)\/triggers\.yaml$/.exec(file.path); if (match) return mapped(`locations/${entityId(match[1])}/triggers.yaml`, encodeYaml({ schemaVersion: 1, triggers: normalizeItems(yaml(file.text).triggers, 'trigger') }), 'semantic-transform');
  if (file.path === 'memory/short_term.md') return mapped('memory/short-term.md', file.bytes, 'semantic-transform');
  if (file.path === 'memory/long_term.md') return mapped('memory/long-term.md', file.bytes, 'semantic-transform');
  if (/^memory\/(facts|unresolved_threads|important_events)\.yaml$/.test(file.path)) { const name = file.path.slice(7, -5), key = name === 'unresolved_threads' ? 'threads' : name === 'important_events' ? 'events' : 'facts', target = `memory/${name.replaceAll('_', '-')}.yaml`; return mapped(target, encodeYaml({ schemaVersion: 1, [key]: normalizeMemory(yaml(file.text)[key] ?? yaml(file.text)[name], key) }), 'semantic-transform'); }
  if (/^state\/(world|calendar|progress|variables)\.yaml$/.test(file.path)) { const name = file.path.slice(6, -5), value = camelKeys(yaml(file.text)); const projected = name === 'world' ? { title: stringValue(value.title) ?? 'Migrated World', status: stringValue(value.status) ?? 'active' } : name === 'calendar' ? { currentDay: legacyDay(value.currentDay), elapsed: stringValue(value.elapsed) } : name === 'progress' ? { activeArcIds: stringList(value.activeArcIds).map(entityId).filter((id) => arcs.includes(id)) } : { variables: typeof value.variables === 'object' && value.variables !== null && !Array.isArray(value.variables) ? value.variables : {} }; return mapped(file.path, encodeYaml({ schemaVersion: 1, ...projected }), 'semantic-transform'); }
  if (/^\.loom\/init-transcript\//.test(file.path)) return mapped(`audit/legacy-init/${portable(file.path.slice('.loom/init-transcript/'.length))}.txt`, file.bytes, 'semantic-transform');
  if (/^days\/day_[0-9]+\//.test(file.path)) return mapped(`memory/legacy-days/${portable(file.path)}.preserved.txt`, file.bytes, 'semantic-transform');
  return mapped(preservePath(file.path), file.bytes, 'legacy-preserve');
}
function remapEntityBaseline(changes: Map<string, Extract<WorldChange, { op: 'put' }>>, namespace: string, ids: string[], prefix: string) { const original = [...changes]; for (const [path, change] of original) { const match = new RegExp(`^${namespace}/${prefix}([1-9][0-9]*)(/)`).exec(path); if (!match) continue; const id = ids[Number(match[1]) - 1]; changes.delete(path); if (id) changes.set(path.replace(`${prefix}${match[1]}`, id), { ...change, path: path.replace(`${prefix}${match[1]}`, id) }); } const index = changes.get(`${namespace}/index.yaml`); if (index) changes.set(`${namespace}/index.yaml`, { ...index, bytes: encodeYaml({ schemaVersion: 1, ids }) }); }
function directoryIds(files: readonly LegacyFileV1[], namespace: string): string[] { return [...new Set(files.map((file) => new RegExp(`^${namespace}/([^/]+)/`).exec(file.path)?.[1]).filter((id): id is string => id !== undefined).map(entityId))].sort(); }
function entityId(value: string): string { let result = value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, ''); if (!/^[a-z]/.test(result)) result = `entity-${result}`; return result || 'entity'; }
function preservePath(source: string) { return `legacy/files/${portable(source)}.preserved.txt`; }
function portable(value: string) { return value.split('/').map((part) => part.replace(/[^A-Za-z0-9._-]/g, '_')).join('/'); }
function mapped(path: string, bytes: Uint8Array, mode: MigrationReportEntryV1['mode']) { return { path, bytes, mode }; }
function media(target: string): ArchiveMediaTypeV1 { return target.endsWith('.md') ? 'text/markdown' : target.endsWith('.json') ? 'application/json' : target.endsWith('.yaml') ? 'application/yaml' : 'text/plain'; }
function yaml(text?: string): Record<string, unknown> { if (!text) return {}; const value = parse(text); return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}; }
function camelKeys(value: Record<string, unknown>) { const result: Record<string, unknown> = {}; for (const [key, item] of Object.entries(value)) result[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = item; return result; }
function normalizeItems(value: unknown, prefix: string) { return Array.isArray(value) ? value.map((item, index) => typeof item === 'object' && item !== null ? { id: `${prefix}${index + 1}`, ...item } : { id: `${prefix}${index + 1}`, value: String(item) }) : []; }
function normalizeMemory(value: unknown, key: string) { return Array.isArray(value) ? value.map((item, index) => typeof item === 'object' && item !== null ? { id: `${key.slice(0, -1)}${index + 1}`, origin: 'migration', sourceEventIds: [], ...item } : { id: `${key.slice(0, -1)}${index + 1}`, text: String(item), origin: 'migration', sourceEventIds: [] }) : []; }
function stringList(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
function stringValue(value: unknown): string | null { return typeof value === 'string' && value.trim() !== '' ? value : null; }
function validId(value: string | null): boolean { return value !== null && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value); }
function legacyDay(value: unknown): string | null { if (value === null || value === undefined) return null; const match = /^day_0*([1-9][0-9]*)$/.exec(String(value)); return match ? `day${match[1]}` : /^day[1-9][0-9]*$/.test(String(value)) ? String(value) : null; }
function encodeYaml(value: unknown) { return new TextEncoder().encode(stringify(value, { aliasDuplicateObjects: false, lineWidth: 0 })); }
function encodeJson(value: unknown) { return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`); }
