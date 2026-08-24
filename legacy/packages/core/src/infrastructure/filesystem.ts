/** 文件写入选项。 */
export interface FileWriteOptions {
  /** 覆盖已存在文件；默认由具体实现决定。 */
  overwrite?: boolean;
  /** 在返回前将文件内容同步到稳定存储。 */
  flush?: boolean;
}

/** ArchiveRepository 使用的异步文件系统边界。 */
export interface CoreFileSystem {
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  writeText(path: string, content: string, options?: FileWriteOptions): Promise<void>;
  writeBytes(path: string, content: Uint8Array, options?: FileWriteOptions): Promise<void>;
  makeDirectory(path: string): Promise<void>;
  listDirectory(path: string): Promise<string[]>;
  rename(source: string, target: string): Promise<void>;
  /** Atomically creates target as a hard link; fails with EEXIST when claimed. */
  link(source: string, target: string): Promise<void>;
  realPath(path: string): Promise<string>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  syncDirectory(path: string): Promise<void>;
}
