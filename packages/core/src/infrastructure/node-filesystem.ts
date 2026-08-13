import { promises as fs } from 'fs';
import path from 'path';
import type { CoreFileSystem, FileWriteOptions } from './filesystem';

/** 基于 Node.js fs 的 Core 文件系统实现。 */
export class NodeCoreFileSystem implements CoreFileSystem {
  async exists(target: string): Promise<boolean> {
    try {
      await fs.access(target);
      return true;
    } catch {
      return false;
    }
  }

  async readText(target: string): Promise<string> {
    return fs.readFile(target, 'utf8');
  }

  async readBytes(target: string): Promise<Uint8Array> {
    return fs.readFile(target);
  }

  async writeText(target: string, content: string, options: FileWriteOptions = {}): Promise<void> {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const handle = await fs.open(target, options.overwrite === false ? 'wx' : 'w');
    try {
      await handle.writeFile(content, 'utf8');
      if (options.flush) await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async writeBytes(target: string, content: Uint8Array, options: FileWriteOptions = {}): Promise<void> {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const handle = await fs.open(target, options.overwrite === false ? 'wx' : 'w');
    try {
      await handle.writeFile(content);
      if (options.flush) await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async makeDirectory(target: string): Promise<void> {
    await fs.mkdir(target, { recursive: true });
  }

  async listDirectory(target: string): Promise<string[]> {
    try {
      return await fs.readdir(target);
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return [];
      throw error;
    }
  }

  async rename(source: string, target: string): Promise<void> {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(source, target);
  }

  async link(source: string, target: string): Promise<void> {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.link(source, target);
  }

  async realPath(target: string): Promise<string> {
    return fs.realpath(target);
  }

  async remove(target: string, options: { recursive?: boolean } = {}): Promise<void> {
    await fs.rm(target, { recursive: options.recursive ?? false, force: true });
  }

  async syncDirectory(target: string): Promise<void> {
    let handle;
    try {
      handle = await fs.open(target, 'r');
    } catch (error) {
      if (process.platform === 'win32' && isUnsupportedDirectorySync(error)) return;
      throw error;
    }
    try {
      try {
        await handle.sync();
      } catch (error) {
        // Windows does not provide portable directory fsync semantics.  Only
        // suppress the errors produced for a directory handle; file fsync
        // failures still propagate from writeText.
        if (!(process.platform === 'win32' && isUnsupportedDirectorySync(error))) throw error;
      }
    } finally {
      await handle.close();
    }
  }
}

/** 创建默认 Node.js 文件系统。 */
export function createNodeCoreFileSystem(): CoreFileSystem {
  return new NodeCoreFileSystem();
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code;
}

function isUnsupportedDirectorySync(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && ['EPERM', 'EACCES', 'EINVAL', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '');
}
