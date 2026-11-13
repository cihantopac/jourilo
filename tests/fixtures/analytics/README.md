# Analytics adapter fixtures

These files are **synthesized**, not live recordings: Jourilo has no vendor accounts or keys for testing. Each file
follows the response shape the vendor documents for a read-only endpoint, and each carries a `_synthesized` field that
says so. Ids are placeholders and no file contains a key. `tests/unit/adapters.test.ts` serves them through a stubbed
fetch.

| File                                                      | Endpoint (method)                                                                                       | Documentation                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `posthog/experiment.json`                                 | `GET /api/projects/:project_id/experiments/:id/`                                                        | posthog.com/docs/api/experiments (Retrieve experiments)                         |
| `posthog/experiments-page-1.json`, `-page-2.json`         | `GET /api/projects/:project_id/experiments/` with `next` pagination                                     | posthog.com/docs/api/experiments (List), posthog.com/docs/api (Pagination)      |
| `posthog/query-funnel.json`, `query-missing-variant.json` | `POST /api/projects/:project_id/query/` with an `ExperimentQuery` (documented read-only query endpoint) | posthog.com/docs/api/queries; `NewExperimentQueryResponse` in posthog/schema.py |
| `posthog/rate-limited.json`                               | 429 body of the query endpoint (`api_queries_budget_exceeded`, `Retry-After`)                           | posthog.com/docs/api/queries (Rate limits)                                      |
| `growthbook/experiment.json`                              | `GET /api/v1/experiments/:id`                                                                           | docs.growthbook.io/api (Experiments)                                            |
| `growthbook/experiments-page-1.json`, `-page-2.json`      | `GET /api/v1/experiments?limit&offset` (`hasMore`, `nextOffset`)                                        | docs.growthbook.io/api (Pagination)                                             |
| `growthbook/results.json`, `results-missing-variant.json` | `GET /api/v1/experiments/:id/results`                                                                   | docs.growthbook.io/api/experiments/operation/getExperimentResults               |
| `amplitude/funnels.json`, `funnels-missing-control.json`  | `GET /api/2/funnels` grouped by a user property (`g`)                                                   | amplitude.com/docs/apis/analytics/dashboard-rest (Funnel analysis)              |

Mapping assumptions, to be checked against a live account when one is available:

- PostHog funnel metric: `number_of_samples` = exposed users, `sum` = users who reached the last step.
- GrowthBook proportion metric: `users` = exposed users, the first analysis's `numerator` = converted users.
- Amplitude grouped funnel: one `data` element per group with `groupValue`; `cumulativeRaw[0]` = exposed users, the
  last element = converted users. `(none)` is the group of users without the variant property.
