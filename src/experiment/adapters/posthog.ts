// PostHog, read-only. Synthesized fixtures follow posthog.com/docs/api/experiments and posthog.com/docs/api/queries:
//   GET  /api/projects/:project/experiments/:id/          the experiment (flag variants, metrics)
//   GET  /api/projects/:project/experiments/?limit=100    the list, followed through `next`, to find a flag key
//   POST /api/projects/:project/query/                    the documented read-only query endpoint (ExperimentQuery)
// For a funnel metric, `number_of_samples` is the exposed users and `sum` the users who reached the last step.
import { JouriloError } from '../../core/errors.js';
import {
  type AdapterDeps,
  client,
  collect,
  hostFrom,
  IncompleteData,
  pushVariant,
  requireEnv,
  settleVariants,
} from './common.js';
import type { AnalyticsAdapter } from './types.js';

const MAX_PAGES = 50;

interface PhMetric {
  name?: string | null;
  uuid?: string | null;
  metric_type?: string;
  series?: { event?: string | null; name?: string | null }[];
  source?: { event?: string | null };
}
interface PhExperiment {
  id: number;
  name?: string;
  feature_flag_key?: string;
  feature_flag?: { filters?: { multivariate?: { variants?: { key: string }[] } } };
  parameters?: { feature_flag_variants?: { key: string }[] } | null;
  excluded_variants?: string[] | null;
  metrics?: PhMetric[] | null;
}
interface PhStats {
  key: string;
  number_of_samples?: number;
  sum?: number;
}

export function posthogAdapter(deps: AdapterDeps): AnalyticsAdapter {
  const key = requireEnv(
    deps.env,
    'POSTHOG_API_KEY',
    'a PostHog personal API key with experiment:read and query:read',
  );
  const host = hostFrom(deps.env, 'POSTHOG_HOST', 'https://us.posthog.com');
  const project = deps.env.POSTHOG_PROJECT_ID?.trim() || '@current';
  if (!/^(@current|\d+)$/.test(project))
    throw new JouriloError(
      'USAGE',
      'POSTHOG_PROJECT_ID must be a numeric project id (or unset for @current).',
    );
  const base = `${host.href.replace(/\/$/, '')}/api/projects/${project}`;
  const http = client('PostHog', deps, {
    header: `Bearer ${key}`,
    keyVars: 'POSTHOG_API_KEY',
    secrets: [key],
  });

  async function find(flagKey: string): Promise<PhExperiment> {
    let url: string | null = `${base}/experiments/?limit=100`;
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const body = (await http.get(url)) as { next?: string | null; results?: PhExperiment[] };
      const hit = body.results?.find((e) => e.feature_flag_key === flagKey);
      if (hit) return hit;
      url = body.next ?? null;
      if (url && new URL(url, base).origin !== host.origin)
        throw new IncompleteData(
          'PostHog pointed the next page of experiments at another host; it was not followed.',
        );
      if (url) url = new URL(url, base).href;
    }
    if (url)
      throw new IncompleteData(
        `PostHog listed more than ${MAX_PAGES} pages of experiments; ${flagKey} was not among them.`,
      );
    throw new JouriloError('NOT_FOUND', `PostHog has no experiment with the feature flag key ${flagKey}.`);
  }

  return {
    name: 'posthog',
    experiment: (id) =>
      collect(
        'PostHog',
        id,
        async (state) => {
          state.metric = deps.metric ?? '';
          const exp = /^\d+$/.test(id)
            ? ((await http.get(`${base}/experiments/${id}/`)) as PhExperiment)
            : await find(id);
          const metrics = exp.metrics ?? [];
          const metric = deps.metric
            ? metrics.find((m) => m.name === deps.metric || m.uuid === deps.metric)
            : metrics[0];
          const names = metrics.map((m) => m.name || m.uuid).filter(Boolean);
          if (!metric)
            throw deps.metric
              ? new JouriloError(
                  'USAGE',
                  `PostHog experiment ${id} has no primary metric named "${deps.metric}".`,
                  names.length ? `Its primary metrics: ${names.join(', ')}.` : 'It has no primary metrics.',
                )
              : new JouriloError(
                  'INVALID_INPUT',
                  `PostHog experiment ${id} has no primary metric to analyze.`,
                  'Add a funnel metric to the experiment in PostHog, then rerun.',
                );
          state.metric =
            metric.name ||
            metric.series?.at(-1)?.name ||
            metric.series?.at(-1)?.event ||
            metric.source?.event ||
            'primary metric';
          if (metric.metric_type !== 'funnel')
            throw new JouriloError(
              'INVALID_INPUT',
              `"${state.metric}" is a ${metric.metric_type ?? 'unknown'} metric; analyze needs a conversion (funnel) metric.`,
              names.length > 1
                ? `Pick a funnel metric with --metric (primary metrics: ${names.join(', ')}).`
                : 'Add a funnel metric to the experiment in PostHog.',
            );
          const res = (await http.post(`${base}/query/`, {
            query: { kind: 'ExperimentQuery', experiment_id: exp.id, metric },
          })) as { baseline?: PhStats; variant_results?: PhStats[] };
          if (!res.baseline)
            throw new JouriloError(
              'INVALID_INPUT',
              `PostHog has no results for "${state.metric}" in experiment ${id} yet.`,
              'Wait until the experiment has exposures and PostHog has computed the metric, then rerun.',
            );
          for (const r of [res.baseline, ...(res.variant_results ?? [])])
            pushVariant(state, r.key, r.number_of_samples, r.sum);
          const excluded = new Set(exp.excluded_variants ?? []);
          const flagVariants = (
            exp.feature_flag?.filters?.multivariate?.variants ??
            exp.parameters?.feature_flag_variants ??
            []
          )
            .map((v) => v.key)
            .filter((k) => !excluded.has(k));
          // The baseline is PostHog's control arm: it goes first, as analyze reads the first arm as control.
          const baseline = res.baseline.key;
          settleVariants('PostHog', state, [
            ...flagVariants.filter((k) => k === baseline),
            ...flagVariants.filter((k) => k !== baseline),
          ]);
        },
        [key],
      ),
  };
}
