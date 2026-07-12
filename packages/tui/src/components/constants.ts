export const TEXTAREA_ID = 'dayloom-textarea';

/** Fixed chrome rows: header + hints + prompt + footer + loading (calibrate after layout changes). */
export const CHROME_ROWS = 9;

/** Coalesce streaming UI updates so rapid AI chunks do not thrash layout/render. */
export const STREAM_THROTTLE_MS = 50;
