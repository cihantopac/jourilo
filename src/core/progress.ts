// Structured progress (F35): what the audit pipeline reports while it works. The CLI prints `message` as a plain
// line, or with --json the whole event as one JSON line on stderr.

export type ProgressPhase =
  | 'launch'
  | 'discover'
  | 'setup'
  | 'capture'
  | 'metrics'
  | 'forms'
  | 'rules'
  | 'report';

export interface ProgressEvent {
  phase: ProgressPhase;
  /** The text of the plain progress line. */
  message: string;
  /** Steps of this phase finished before this one started; absent when the engine cannot count them exactly. */
  done?: number;
  /** Steps this phase will take in all; absent when not known exactly. */
  total?: number;
  /** The page this step works on (redacted). */
  url?: string;
  /** The viewport this step works in. */
  viewport?: string;
}
