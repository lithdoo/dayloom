/** Runtime 和 archive 使用的可替换时间来源。 */
export interface RuntimeClock {
  /** 返回当前 UTC 时间。 */
  now(): Date;
}

/** 使用系统时间的默认时钟。 */
export const systemClock: RuntimeClock = {
  now: () => new Date(),
};
