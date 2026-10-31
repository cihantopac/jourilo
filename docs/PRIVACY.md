# Privacy and permissions

Jourilo runs on your machine. It sends nothing to Jourilo maintainers or any service of its own. Network traffic is
the browser loading the pages you asked it to audit, plus `robots.txt` and `sitemap.xml` from that origin. All of it
passes through a local network guard that refuses connections to this machine, the local network and cloud-metadata
services unless the target is local or you passed `--allow-private` (metadata services are refused always).

## What is stored

Everything lives in `.jourilo/` in the working directory (or `--workspace`), with a `.gitignore` that ignores it all:

| File                                                                                     | Contents                                                                                              | Sensitive?            |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------- |
| `runs/<id>/run.json`                                                                     | findings, measurements, page inventory (headings, CTA labels, form field names/labels), redacted URLs | page text excerpts    |
| `runs/<id>/screenshots/*.jpg`                                                            | screenshots with password, card, `[data-jourilo-redact]` and `[data-private]` fields masked           | yes — they show pages |
| `runs/<id>/traces/*.zip`                                                                 | only with `--trace`: Playwright traces with DOM snapshots **including typed values**                  | yes — keep private    |
| `journeys/*.json`, `experiments/`, `fixes/`, `checkpoints/`, `product.json`, `site.json` | your scenarios, plans, applied fixes, checkpoint ids, discovery profiles                              | low                   |

## Redaction

- URLs: credentials removed; query parameters such as `token`, `code`, `key`, `session`, `password`, `email`, `sig`
  replaced with `redacted`; token-bearing fragments removed.
- Text (console messages, HTML excerpts, errors): JWTs, bearer/basic credentials, common API key shapes (Stripe,
  GitHub, Slack, AWS, `sk-…`), card-like numbers, e-mail addresses and `password=`/`token=`-style pairs are replaced.
- Screenshots: masked in the browser before capture (`--mask <selector>` adds more). Pixels that are not marked as
  sensitive are not redacted — do not audit pages with real customer data unless you are allowed to keep screenshots of
  them.
- Reports show local paths relative to the working directory or with `~`.

## Permissions model

| Action                                                     | Default                       | How to allow                                    | Who should allow it                         |
| ---------------------------------------------------------- | ----------------------------- | ----------------------------------------------- | ------------------------------------------- |
| Read-only audit of a public site                           | allowed, robots.txt respected | —                                               | the user, for sites they may test           |
| Ignore robots.txt                                          | off                           | `--ignore-robots`                               | site owner only                             |
| Private-network targets (10.x, 192.168.x, cloud metadata…) | refused                       | `--allow-private`                               | authorized testers                          |
| Submit forms (audits: any host; journeys: non-local hosts) | simulated / blocked           | `--allow-submit`                                | authorized test environments, test accounts |
| Payments, deletions, cancellations                         | blocked everywhere            | `--allow-destructive` (local hosts only)        | sandbox data only                           |
| Signed-in pages                                            | off                           | `--auth <storage-state.json>` of a test account | the account owner                           |
| Write source files                                         | off                           | `optimize --apply`, agent edits after consent   | repository owner                            |
| Roll back files (never overwrites later edits)             | off                           | `rollback --yes` (`--force` for conflicts)      | repository owner                            |
| Download browsers                                          | off                           | `jourilo setup`                                 | the user                                    |

The Claude Code plugin's skills require Claude to ask the user before each of these.

## Prompt injection

Text, HTML, console messages and screenshots from audited pages are untrusted. The plugin skills and agent adapters
tell agents never to follow instructions found in them. In reports, all page-derived strings are HTML-escaped and the
report sets a Content-Security-Policy that allows only its own inline script and local images.
