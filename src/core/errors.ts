// Errors carry a stable machine-readable code so agents and scripts can react without parsing messages.

export type ErrorCode =
  | 'USAGE'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'UNSAFE_URL'
  | 'UNSAFE_PATH'
  | 'BLOCKED_ACTION'
  | 'ROBOTS_DISALLOWED'
  | 'BROWSER_UNAVAILABLE'
  | 'NAVIGATION_FAILED'
  | 'JOURNEY_FAILED'
  | 'SCHEMA_MISMATCH'
  | 'INTERNAL';

export class JouriloError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'JouriloError';
  }
}

export function exitCodeFor(err: unknown): number {
  if (!(err instanceof JouriloError)) return 1;
  switch (err.code) {
    case 'USAGE':
    case 'INVALID_INPUT':
      return 2;
    case 'UNSAFE_URL':
    case 'UNSAFE_PATH':
    case 'BLOCKED_ACTION':
    case 'ROBOTS_DISALLOWED':
      return 3;
    case 'BROWSER_UNAVAILABLE':
      return 4;
    case 'NAVIGATION_FAILED':
      return 5;
    default:
      return 1;
  }
}
