# Claude Code plugin and other agents

## Install (Claude Code)

```text
/plugin marketplace add cihantopac/jourilo
/plugin install jourilo@jourilo
```

Until the repository is public, load it locally: `claude --plugin-dir /path/to/jourilo/plugin`.

On install, Claude Code installs the plugin's only runtime dependency (`playwright-core`, exact version) from
`plugin/package.json`. The first browser run asks you to approve downloading Chromium (`jourilo setup`).

## Commands

Claude Code namespaces plugin skills as `/<plugin>:<skill>`:

| Command                  | What it does                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `/jourilo:jourilo`       | Full workflow: understand → run → audit → journeys → judge → prioritize → fix → verify → report |
| `/jourilo:discover`      | Product intelligence for a repository or website                                                |
| `/jourilo:audit`         | Full browser audit with evidence and root causes                                                |
| `/jourilo:journeys`      | Suggest, edit, run user journeys                                                                |
| `/jourilo:accessibility` | WCAG 2.2 AA automated checks and the manual-review list                                         |
| `/jourilo:conversion`    | Funnel defects first, then conversion hypotheses and experiment plans                           |
| `/jourilo:optimize`      | Root causes → minimal fixes (with checkpoint) → checks → verify                                 |
| `/jourilo:compare`       | Before/after comparison of two runs                                                             |
| `/jourilo:report`        | HTML / Markdown / SARIF / JSON reports                                                          |
| `/jourilo:experiment`    | Sample size, experiment plans, analysis of real results                                         |

A bare `/jourilo` is not available for marketplace plugins. To get it, install the personal skill:

```bash
jourilo agent install claude-skill --write
```

It writes `~/.claude/skills/jourilo/SKILL.md`, which defers to `/jourilo:jourilo` when the plugin is installed.

The plugin also ships a `ux-reviewer` agent that looks at a run's screenshots and records design judgments with
`jourilo finding add --by agent`, tied to a screenshot and labelled as inference.

## How the plugin calls the toolchain

Every skill pre-approves exactly `node "${CLAUDE_PLUGIN_ROOT}/dist/jourilo.mjs" *` and instructs Claude to run each
command as its own Bash call with `--json`. Nothing is simulated in prompts: findings come from the CLI's real browser
runs. `tests/unit/plugin.test.ts` checks that every command a skill mentions exists.

## Other agents

| Agent                               | Command                                      | Writes                                                       |
| ----------------------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| Codex and other `AGENTS.md` readers | `jourilo agent install codex --write`        | a marked section in `AGENTS.md` (replaced, never duplicated) |
| Cursor                              | `jourilo agent install cursor --write`       | `.cursor/rules/jourilo.mdc`                                  |
| Claude Code (personal skill)        | `jourilo agent install claude-skill --write` | `~/.claude/skills/jourilo/SKILL.md`                          |

All adapters share one instruction body (`src/agents/adapters.ts`) with the same workflow and safety rules. Without
`--write` they print the content and destination only. `--command "npx jourilo"` sets how the agent should invoke
Jourilo.
