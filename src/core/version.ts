declare const __JOURILO_VERSION__: string | undefined;

/** Replaced at build time by scripts/build.mjs; falls back to a dev marker when running from source. */
export const VERSION: string = typeof __JOURILO_VERSION__ === 'string' ? __JOURILO_VERSION__ : '0.0.0-dev';
