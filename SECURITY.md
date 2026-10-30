# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub's "Report a vulnerability" (Security → Advisories) on the
Jourilo repository, or by e-mail to the maintainer listed on the GitHub profile. Do not open a public issue. You will get
an acknowledgement within 7 days. Coordinated disclosure: we aim to fix confirmed issues within 30 days and credit
reporters who want it.

## Scope

In scope: the CLI and plugin in this repository — for example SSRF or path traversal through targets or run ids,
command execution, leaking secrets into reports, script execution from audited page content in reports, bypasses of
the journey safety policy, or plugin permissions that allow more than the bundled toolchain.

Out of scope: vulnerabilities in sites you audit with Jourilo (report those to their owners), and issues that need a
malicious local user who can already run arbitrary commands.

## Security design

- Targets: http(s) only; private-network and metadata addresses refused unless `--allow-private`; DNS results checked;
  crawling restricted to the target origin; `robots.txt` respected by default.
- Files: every path built from run ids, evidence or journey references is resolved inside its root (`resolveInside`,
  symlink-aware). The static server binds to 127.0.0.1 and refuses traversal.
- Processes: git and browser installs are spawned without a shell, with argument arrays.
- Journeys: element-level safety policy (no payments/deletions/cancellations on non-local hosts; form submission on
  non-local hosts needs `--allow-submit`).
- Reports: all page-derived text is escaped; only relative run files and http(s) links are allowed in attributes; a CSP
  meta tag restricts the report to its own inline script and local images.
- Secrets: URLs, console text and excerpts are redacted; sensitive inputs are masked in screenshots; traces are opt-in.
- Supply chain: one runtime dependency (`playwright-core`, exact pin); axe-core bundled at a pinned version.

See [docs/PRIVACY.md](docs/PRIVACY.md) for data handling.
