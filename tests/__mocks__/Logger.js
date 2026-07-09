/** @fileoverview Logger stub for Jest — silences all output during tests. */
export function createLogger(_component) {
  const noop = () => {};
  return { debug: noop, info: noop, warn: noop, error: noop };
}
