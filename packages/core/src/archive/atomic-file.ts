import path from 'path';
import type { CoreFileSystem } from '../infrastructure/filesystem';

/** 稳定 JSON 编码：两空格缩进并以换行结束。 */
export function encodeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** 写入临时文件、flush、原子 rename 并同步父目录。 */
export async function writeAtomicText(
  filesystem: CoreFileSystem,
  target: string,
  temporary: string,
  content: string,
): Promise<void> {
  await filesystem.writeText(temporary, content, { overwrite: true, flush: true });
  await filesystem.rename(temporary, target);
  await filesystem.syncDirectory(path.dirname(target));
}

/** 写入 JSON 文件并可选 flush。 */
export async function writeJson(
  filesystem: CoreFileSystem,
  target: string,
  value: unknown,
  flush = false,
): Promise<void> {
  await filesystem.writeText(target, encodeJson(value), { overwrite: true, flush });
}
