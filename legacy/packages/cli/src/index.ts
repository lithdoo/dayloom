/**
 * @deprecated The legacy CLI depends on `@dayloom/core-old` and no longer
 * receives new features. Use `@dayloom/tui` and `@dayloom/core` instead.
 */
export { parseCli } from './cli';

/**
 * @deprecated This adapter belongs to the legacy `@dayloom/core-old` CLI.
 * New applications should integrate with the `@dayloom/core` Runtime API.
 */
export { createCliSessionIO } from './session-io/cli-io';
