// Leveled logging for the build. `quiet` prints only warnings and the final summary,
// the default prints progress, `verbose` also prints every retry and per-unit detail.

/** @typedef {'quiet'|'info'|'verbose'} LogLevel */

/**
 * @param {LogLevel} level
 * @param {(line: string) => void} [sink]
 */
export function createLogger(level = 'info', sink = (line) => console.error(line)) {
  const rank = { quiet: 0, info: 1, verbose: 2 }[level] ?? 1;
  const out = { warnings: [] };
  out.warn = (m) => { out.warnings.push(m); sink(`warning: ${m}`); };
  out.info = (m) => { if (rank >= 1) sink(m); };
  out.verbose = (m) => { if (rank >= 2) sink(m); };
  out.summary = (m) => sink(m);
  return out;
}

/** Wraps a logger with a prefix, e.g. "[tashma] ". */
export function prefixed(log, prefix) {
  return {
    ...log,
    info: (m) => log.info(prefix + m),
    verbose: (m) => log.verbose(prefix + m),
    warn: (m) => log.warn(prefix + m),
  };
}
