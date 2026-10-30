// Run storage. Every run lives in <workspace>/runs/<id>/ with run.json, screenshots/ and report files.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { JouriloError } from './errors.js';
import { resolveInside } from './fs-safety.js';
import { RUN_SCHEMA_VERSION, type Run } from './types.js';

export interface RunListing {
  id: string;
  target: string;
  startedAt: string;
  findings: number;
  defects: Run['summary']['findings'];
  kinds: Run['summary']['byKind'];
  pages: number;
  journeys: number;
}

export class Workspace {
  readonly root: string;

  constructor(root?: string) {
    this.root = resolve(root ?? process.env.JOURILO_WORKSPACE ?? '.jourilo');
  }

  get runsDir(): string {
    return join(this.root, 'runs');
  }

  ensure(): void {
    mkdirSync(this.runsDir, { recursive: true });
    const ignore = join(this.root, '.gitignore');
    // Run data contains screenshots of real pages; keep it out of git even if the project forgets.
    if (!existsSync(ignore)) writeFileSync(ignore, '*\n');
  }

  runDir(id: string): string {
    return resolveInside(this.runsDir, id);
  }

  createRunDir(id: string): string {
    this.ensure();
    const dir = this.runDir(id);
    mkdirSync(join(dir, 'screenshots'), { recursive: true });
    return dir;
  }

  saveRun(run: Run): string {
    const dir = this.createRunDir(run.id);
    const file = join(dir, 'run.json');
    writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`);
    return file;
  }

  listRuns(): RunListing[] {
    if (!existsSync(this.runsDir)) return [];
    const out: RunListing[] = [];
    for (const id of readdirSync(this.runsDir).sort()) {
      const file = join(this.runsDir, id, 'run.json');
      if (!existsSync(file)) continue;
      try {
        const run = JSON.parse(readFileSync(file, 'utf8')) as Run;
        out.push({
          id,
          target: run.target,
          startedAt: run.startedAt,
          findings: run.findings.length,
          defects: run.summary.findings,
          kinds: run.summary.byKind,
          pages: run.summary.pages,
          journeys: run.summary.journeys,
        });
      } catch {
        // A half-written run is skipped, not fatal.
      }
    }
    return out;
  }

  /** Accepts a run id, "latest", "previous", or a path to a run directory / run.json. */
  loadRun(ref: string): { run: Run; dir: string } {
    let file: string;
    if (ref === 'latest' || ref === 'previous') {
      const runs = this.listRuns();
      const pick = runs[runs.length - (ref === 'latest' ? 1 : 2)];
      if (!pick) throw new JouriloError('NOT_FOUND', `No ${ref} run in ${this.runsDir}.`);
      file = join(this.runsDir, pick.id, 'run.json');
    } else if (ref.endsWith('.json') && existsSync(ref)) {
      file = resolve(ref);
    } else if (existsSync(join(ref, 'run.json'))) {
      file = resolve(ref, 'run.json');
    } else {
      file = join(this.runDir(ref), 'run.json');
    }
    if (!existsSync(file)) throw new JouriloError('NOT_FOUND', `Run not found: ${ref}`);
    const run = JSON.parse(readFileSync(file, 'utf8')) as Run;
    if (run.schemaVersion !== RUN_SCHEMA_VERSION) {
      throw new JouriloError(
        'SCHEMA_MISMATCH',
        `Run ${ref} uses schema v${run.schemaVersion}; this Jourilo reads v${RUN_SCHEMA_VERSION}.`,
      );
    }
    return { run, dir: dirname(file) };
  }
}
