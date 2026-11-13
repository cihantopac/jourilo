// GrowthBook, read-only. Synthesized fixtures follow docs.growthbook.io/api (REST API v1):
//   GET /api/v1/experiments/:id                       the experiment (variations, goal metrics)
//   GET /api/v1/experiments?limit=100&offset=N        the list, followed through hasMore/nextOffset, for a tracking key
//   GET /api/v1/experiments/:id/results               the latest analysis: users and numerator per variation
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

  return {
    name: 'growthbook',
    experiment: (id) =>
      collect(
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
          const raw = (await http.get(`${base}/experiments/${encodeURIComponent(exp.id)}/results`)) as {
            result?: { results?: GbSlice[] };
            results?: GbSlice[];
          };
          const slices = raw.result?.results ?? raw.results ?? [];
          const overall = slices.find((s) => !(s.dimensionValue ?? s.dimension)) ?? slices[0];
          if (!overall) throw new IncompleteData('GrowthBook has no analysis for this experiment yet.');
          const wanted = deps.metric ?? exp.settings?.goals?.[0]?.metricId;
          const metric = wanted
            ? overall.metrics?.find((m) => m.metricId === wanted || m.metricName === wanted)
            : overall.metrics?.[0];
          if (!metric)
            throw new IncompleteData(
              wanted
                ? `Metric "${wanted}" is not in the experiment's results.`
                : 'The results contain no metric.',
            );
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
