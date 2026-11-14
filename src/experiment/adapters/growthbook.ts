// GrowthBook, read-only. Synthesized fixtures follow docs.growthbook.io/api (REST API v1):
//   GET /api/v1/experiments/:id                       the experiment (variations, goal metrics)
//   GET /api/v1/experiments?limit=100&offset=N        the list, followed through hasMore/nextOffset, for a tracking key
//   GET /api/v1/experiments/:id/results               the latest analysis: users and numerator per variation
//   GET /api/v1/metrics/:id or /api/v1/fact-metrics/:id the metric definition: only `binomial` (legacy) and
//                                                       `proportion` (fact) metrics count converted users
// For a proportion (binomial) metric, `users` is the exposed users and the analysis `numerator` the converted users.
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

interface GbExperiment {
  id: string;
  trackingKey?: string;
  variations?: { variationId: string; key?: string; name?: string }[];
  settings?: { goals?: { metricId: string }[] };
}
interface GbVariationResult {
  variationId: string;
  users?: number;
  analyses?: { numerator?: number; denominator?: number; errorMessage?: string | null }[];
}
interface GbSlice {
  dimension?: string;
  dimensionValue?: string;
  metrics?: { metricId: string; metricName?: string; variations?: GbVariationResult[] }[];
}

export function growthbookAdapter(deps: AdapterDeps): AnalyticsAdapter {
  const key = requireEnv(deps.env, 'GROWTHBOOK_API_KEY', 'a GrowthBook secret API key with read access');
  const host = hostFrom(deps.env, 'GROWTHBOOK_HOST', 'https://api.growthbook.io');
  const base = `${host.href.replace(/\/$/, '')}/api/v1`;
  const http = client('GrowthBook', deps, {
    header: `Bearer ${key}`,
    keyVars: 'GROWTHBOOK_API_KEY',
    secrets: [key],
  });

  async function find(trackingKey: string): Promise<GbExperiment> {
    let offset: number | null = 0;
    for (let page = 0; offset !== null && page < MAX_PAGES; page++) {
      const body = (await http.get(`${base}/experiments?limit=100&offset=${offset}`)) as {
        experiments?: GbExperiment[];
        hasMore?: boolean;
        nextOffset?: number | null;
      };
      const hit = body.experiments?.find((e) => e.trackingKey === trackingKey);
      if (hit) return hit;
      offset = body.hasMore && typeof body.nextOffset === 'number' ? body.nextOffset : null;
    }
    if (offset !== null)
      throw new IncompleteData(
        `GrowthBook listed more than ${MAX_PAGES} pages of experiments; ${trackingKey} was not among them.`,
      );
    throw new JouriloError('NOT_FOUND', `GrowthBook has no experiment with the tracking key ${trackingKey}.`);
  }

  /**
   * Only metrics that count converted users can feed the conversion-rate test: legacy `binomial` metrics and fact
   * metrics of type `proportion`. Counts, durations, revenue, means and ratios are refused.
   */
  async function requireProportion(metricId: string, label: string, names: string[]): Promise<void> {
    const fact = metricId.startsWith('fact__');
    const body = (await http.get(
      `${base}/${fact ? 'fact-metrics' : 'metrics'}/${encodeURIComponent(metricId)}`,
    )) as { metric?: { type?: string }; factMetric?: { metricType?: string } };
    const type = fact ? body.factMetric?.metricType : body.metric?.type;
    if (type === undefined)
      throw new IncompleteData(`GrowthBook sent the metric ${metricId} without its type.`);
    if (type !== (fact ? 'proportion' : 'binomial'))
      throw new JouriloError(
        'INVALID_INPUT',
        `"${label}" is a ${type} metric; analyze needs a conversion metric (${fact ? 'a proportion fact metric' : 'a binomial metric'}) that counts converted users.`,
        names.length > 1
          ? `Pick a conversion metric with --metric (metrics in the results: ${names.join(', ')}).`
          : 'Add a proportion (binomial) goal metric to the experiment in GrowthBook.',
      );
  }

  return {
    name: 'growthbook',
    experiment: (id) =>
      collect(
        'GrowthBook',
        id,
        async (state) => {
          state.metric = deps.metric ?? '';
          const exp = id.startsWith('exp_')
            ? (
                (await http.get(`${base}/experiments/${encodeURIComponent(id)}`)) as {
                  experiment: GbExperiment;
                }
              ).experiment
            : await find(id);
          if (!exp?.id) throw new IncompleteData('GrowthBook sent an experiment without an id.');
          const raw = (await http.get(`${base}/experiments/${encodeURIComponent(exp.id)}/results`)) as {
            result?: { results?: GbSlice[] };
            results?: GbSlice[];
          };
          const slices = raw.result?.results ?? raw.results ?? [];
          const overall = slices.find((s) => !(s.dimensionValue ?? s.dimension)) ?? slices[0];
          if (!overall)
            throw new JouriloError(
              'INVALID_INPUT',
              `GrowthBook has no analysis for experiment ${id} yet.`,
              'Update the results in GrowthBook (or wait for the scheduled update), then rerun.',
            );
          const goal = exp.settings?.goals?.[0]?.metricId;
          const wanted = deps.metric ?? goal;
          const metric = wanted
            ? overall.metrics?.find((m) => m.metricId === wanted || m.metricName === wanted)
            : overall.metrics?.[0];
          const names = (overall.metrics ?? []).map((m) => m.metricName || m.metricId);
          if (!metric)
            throw deps.metric
              ? new JouriloError(
                  'USAGE',
                  `GrowthBook experiment ${id} has no results for a metric "${deps.metric}".`,
                  names.length
                    ? `Metrics in its results: ${names.join(', ')}.`
                    : 'Its results contain no metric.',
                )
              : new JouriloError(
                  'INVALID_INPUT',
                  `GrowthBook experiment ${id} has no results for ${goal ? `its goal metric ${goal}` : 'any metric'} yet.`,
                  'Update the results in GrowthBook, or pick a metric with --metric.',
                );
          await requireProportion(metric.metricId, metric.metricName || metric.metricId, names);
          state.metric = metric.metricName || metric.metricId;
          const variations = exp.variations ?? [];
          const nameOf = (variationId: string) => {
            const v = variations.find((x) => x.variationId === variationId);
            return v?.name || v?.key || variationId;
          };
          for (const v of metric.variations ?? []) {
            const a = v.analyses?.[0];
            if (a?.errorMessage) {
              state.incomplete(`Variant ${nameOf(v.variationId)}: GrowthBook reported an analysis error.`);
              continue;
            }
            pushVariant(state, nameOf(v.variationId), v.users ?? a?.denominator, a?.numerator);
          }
          settleVariants(
            'GrowthBook',
            state,
            variations.map((v) => nameOf(v.variationId)),
          );
        },
        [key],
      ),
  };
}
