# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub's "Report a vulnerability" (Security → Advisories) on the
Jourilo repository, or by e-mail to the maintainer listed on the GitHub profile. Do not open a public issue. You will get
an acknowledgement within 7 days. Coordinated disclosure: we aim to fix confirmed issues within 30 days and credit
reporters who want it.

## Supported versions

Security fixes are made for the latest 1.x release. 0.1.0 is not supported: it lacked the network guard and the
conflict-safe rollback described below; upgrade to 1.0.0 or later.

## Scope

In scope: the CLI and plugin in this repository — for example SSRF or path traversal through targets or run ids,
command execution, leaking secrets into reports, script execution from audited page content in reports, bypasses of
the journey safety policy, or plugin permissions that allow more than the bundled toolchain.

Out of scope: vulnerabilities in sites you audit with Jourilo (report those to their owners), and issues that need a
malicious local user who can already run arbitrary commands.

## Security design

- Targets: http(s) only; a host is refused when any DNS answer is non-public unless `--allow-private` (metadata and
  reserved addresses always); crawling restricted to the target origin; `robots.txt` respected by default.
- Network guard: every browser request goes through a local proxy that resolves names itself and connects only to
  allowed addresses (subresources, redirects, iframes, WebSockets; no DNS-rebinding window). WebRTC and QUIC are off.
- Files: every path built from run ids, evidence or journey references is resolved inside its root (`resolveInside`,
  symlink-aware, also for files that do not exist yet). The static server binds to 127.0.0.1, refuses traversal and
  never serves hidden files.
- Repairs: fixes are transactions (backups and hashes first, atomic writes); rollback never overwrites a file changed
  after the fix.
- Processes: git and browser installs are spawned without a shell, with argument arrays.
- Journeys and audits: the safety policy is checked on the element about to be activated (name, identifiers, link and
  form targets) and on every request the page sends; audits never send data-changing requests without
  `--allow-submit`. No payments, deletions or cancellations on non-local hosts.
- Reports: all page-derived text is escaped; only relative run files and http(s) links are allowed in attributes; a CSP
  meta tag restricts the report to its own inline script and local images.
- Secrets: URLs, console text and excerpts are redacted; sensitive inputs are masked in screenshots; traces are opt-in.
- Supply chain: one runtime dependency (`playwright-core`, exact pin); axe-core bundled at a pinned version.

See [docs/SECURITY-REVIEW.md](docs/SECURITY-REVIEW.md) for the 1.0 review, its tests and the residual risks, and
[docs/PRIVACY.md](docs/PRIVACY.md) for data handling.
