import { stringify } from 'yaml';
import type { WorldChange } from '../publish';

const encoder = new TextEncoder();
export function markdown(path: string, value: string): WorldChange { return { op: 'put', path, mediaType: 'text/markdown', bytes: encoder.encode(value) }; }
export function jsonDocument(path: string, value: unknown): WorldChange { return { op: 'put', path, mediaType: 'application/json', bytes: encoder.encode(`${JSON.stringify(value, null, 2)}\n`) }; }
export function yamlDocument(path: string, value: unknown): WorldChange { return { op: 'put', path, mediaType: 'application/yaml', bytes: encoder.encode(stringify(value, { aliasDuplicateObjects: false, lineWidth: 0 })) }; }
