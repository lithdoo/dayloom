import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';

export interface CommandBoundaryV1 {
  command: string;
  argsPrefix: readonly string[];
}

export interface PromptpileBoundariesV1 {
  promptpileBin: string;
  reactBin: string;
  promptpileMcpBin: string;
  filesystemMcp: CommandBoundaryV1;
  validateProcessPile: ValidateFunction;
}

const localRequire = createRequire(import.meta.url);

async function packageRootV1(name: string): Promise<{ root: string; metadata: Record<string, unknown> }> {
  const packageJson = localRequire.resolve(`${name}/package.json`);
  return { root: path.dirname(packageJson), metadata: JSON.parse(await readFile(packageJson, 'utf8')) as Record<string, unknown> };
}

function binV1(metadata: Record<string, unknown>, name: string, root: string): string {
  const bins = metadata.bin;
  if (!bins || typeof bins !== 'object' || typeof (bins as Record<string, unknown>)[name] !== 'string') throw new Error(`${name} packaged binary is missing.`);
  return path.resolve(root, (bins as Record<string, string>)[name]!);
}

function commandBoundaryV1(metadata: Record<string, unknown>, name: string, root: string): CommandBoundaryV1 {
  const target = binV1(metadata, name, root);
  return /\.[cm]?js$/i.test(target)
    ? Object.freeze({ command: process.execPath, argsPrefix: Object.freeze([target]) })
    : Object.freeze({ command: target, argsPrefix: Object.freeze([]) });
}

export async function resolvePromptpileBoundariesV1(): Promise<PromptpileBoundariesV1> {
  const promptpile = await packageRootV1('promptpile');
  const react = await packageRootV1('promptpile-react');
  const mcp = await packageRootV1('promptpile-mcp');
  const filesystem = await packageRootV1('@rustmcp/rust-mcp-filesystem');
  const processSchema = JSON.parse(await readFile(path.join(react.root, 'schema', 'process-pile-v1.schema.json'), 'utf8'));
  const ajv = new Ajv2020({ strict: true, strictRequired: false });
  return Object.freeze({
    promptpileBin: binV1(promptpile.metadata, 'promptpile', promptpile.root),
    reactBin: binV1(react.metadata, 'promptpile-react', react.root),
    promptpileMcpBin: binV1(mcp.metadata, 'promptpile-mcp', mcp.root),
    filesystemMcp: commandBoundaryV1(filesystem.metadata, 'rust-mcp-filesystem', filesystem.root),
    validateProcessPile: ajv.compile(processSchema),
  });
}
