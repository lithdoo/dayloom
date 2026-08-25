import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';

export interface PackagedBoundaries {
  promptpileBin: string;
  reactBin: string;
  promptpileMcpBin: string;
  filesystemMcp: CommandBoundary;
  validateProcessPile: ValidateFunction;
}
export interface CommandBoundary { command: string; argsPrefix: readonly string[] }
const localRequire = createRequire(__filename);

async function packageRoot(name: string): Promise<{ root: string; metadata: Record<string, unknown> }> {
  const packageJson = localRequire.resolve(`${name}/package.json`);
  return { root: path.dirname(packageJson), metadata: JSON.parse(await readFile(packageJson, 'utf8')) };
}
function bin(metadata: Record<string, unknown>, name: string, root: string): string {
  const bins = metadata.bin;
  if (!bins || typeof bins !== 'object' || typeof (bins as Record<string, unknown>)[name] !== 'string') throw new Error(`${name} packaged binary is missing.`);
  return path.resolve(root, (bins as Record<string, string>)[name]);
}
function commandBoundary(metadata: Record<string, unknown>, name: string, root: string): CommandBoundary {
  const target = bin(metadata, name, root);
  return /\.[cm]?js$/i.test(target)
    ? Object.freeze({ command: process.execPath, argsPrefix: Object.freeze([target]) })
    : Object.freeze({ command: target, argsPrefix: Object.freeze([]) });
}
export async function resolvePackagedBoundaries(): Promise<PackagedBoundaries> {
  const promptpile = await packageRoot('promptpile');
  const react = await packageRoot('promptpile-react');
  const mcp = await packageRoot('promptpile-mcp');
  const filesystem = await packageRoot('@rustmcp/rust-mcp-filesystem');
  const processSchema = JSON.parse(await readFile(path.join(react.root, 'schema', 'process-pile-v1.schema.json'), 'utf8'));
  // The packaged normative schema intentionally uses `required` inside `not`
  // branches without redeclaring those properties in every branch.
  const ajv = new Ajv2020({ strict: true, strictRequired: false });
  return Object.freeze({
    promptpileBin: bin(promptpile.metadata, 'promptpile', promptpile.root),
    reactBin: bin(react.metadata, 'promptpile-react', react.root),
    promptpileMcpBin: bin(mcp.metadata, 'promptpile-mcp', mcp.root),
    filesystemMcp: commandBoundary(filesystem.metadata, 'rust-mcp-filesystem', filesystem.root),
    validateProcessPile: ajv.compile(processSchema),
  });
}
