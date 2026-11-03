// Findings a person or agent judged not to be a problem, kept in <workspace>/dismissed.json by fingerprint with the
// reason. A dismissal hides a finding from later runs; it never deletes evidence, and a finding whose fingerprint
// changes (another page or target) is a different finding and comes back.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JouriloError } from './errors.js';
import type { Finding } from './types.js';
import type { Workspace } from './workspace.js';

export interface Dismissal {
  fingerprint: string;
  ruleId: string;
  url: string;
  reason: string;
  by: 'user' | 'agent';
  at: string;
}

export type DismissedFinding = Finding & { dismissal: Dismissal };

const file = (ws: Workspace) => join(ws.root, 'dismissed.json');

export function loadDismissals(ws: Workspace): Dismissal[] {
  if (!existsSync(file(ws))) return [];
  try {
    const parsed = JSON.parse(readFileSync(file(ws), 'utf8')) as unknown;
    return Array.isArray(parsed) ? (parsed as Dismissal[]) : [];
  } catch {
    throw new JouriloError('INVALID_INPUT', `${file(ws)} is not valid JSON; fix or remove it.`);
  }
}

function write(ws: Workspace, list: Dismissal[]): void {
  ws.ensure();
  writeFileSync(file(ws), `${JSON.stringify(list, null, 2)}\n`);
}

export function saveDismissal(ws: Workspace, d: Dismissal): void {
  write(ws, [...loadDismissals(ws).filter((x) => x.fingerprint !== d.fingerprint), d]);
}

export function removeDismissal(ws: Workspace, fingerprint: string): boolean {
  const list = loadDismissals(ws);
  const rest = list.filter((x) => x.fingerprint !== fingerprint);
  if (rest.length === list.length) return false;
  write(ws, rest);
  return true;
}

export function applyDismissals(
  findings: Finding[],
  list: Dismissal[],
): { kept: Finding[]; dismissed: DismissedFinding[] } {
  const byFp = new Map(list.map((d) => [d.fingerprint, d]));
  const kept: Finding[] = [];
  const dismissed: DismissedFinding[] = [];
  for (const f of findings) {
    const dismissal = byFp.get(f.fingerprint);
    if (dismissal) dismissed.push({ ...f, dismissal });
    else kept.push(f);
  }
  return { kept, dismissed };
}

/** Resolves a full fingerprint or a unique prefix of at least 8 characters among the given fingerprints. */
export function resolveFingerprint(id: string, fingerprints: string[]): string {
  if (fingerprints.includes(id)) return id;
  if (id.length < 8)
    throw new JouriloError('INVALID_INPUT', `Finding id "${id}" is too short; use at least 8 characters.`);
  const hits = fingerprints.filter((fp) => fp.startsWith(id));
  if (hits.length === 1) return hits[0]!;
  throw new JouriloError(
    hits.length ? 'INVALID_INPUT' : 'NOT_FOUND',
    hits.length
      ? `Finding id "${id}" is ambiguous (${hits.join(', ')}); use more characters.`
      : `No finding with id "${id}".`,
  );
}
