// Amplitude, read-only. Synthesized fixtures follow amplitude.com/docs/apis/analytics/dashboard-rest (Funnel analysis):
//   GET /api/2/funnels?e=<exposure>&e=<conversion>&start&end&g=gp:[Experiment] <flag>&limit=1000
// Basic auth with AMPLITUDE_API_KEY:AMPLITUDE_SECRET_KEY. Step one is Amplitude Experiment's `$exposure` event for the
// flag, step two the conversion event (`--metric`); the funnel is grouped by the `[Experiment] <flag>` user property,
// so each group is a variant: `cumulativeRaw[0]` the exposed users, the last element the converted users. The funnel
// endpoint has no pages; a grouped answer is capped by `limit`, so a full page means variants may be cut off.
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

const GROUP_LIMIT = 1000;
const NO_VALUE = '(none)';

function day(value: string | undefined, flag: string): string {
  const m = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m)
    throw new JouriloError('USAGE', `${flag} must be a date as YYYY-MM-DD (Amplitude needs the date range).`);
  return `${m[1]}${m[2]}${m[3]}`;
}

export function amplitudeAdapter(deps: AdapterDeps): AnalyticsAdapter {
  const apiKey = requireEnv(deps.env, 'AMPLITUDE_API_KEY', "the Amplitude project's API key");
  const secret = requireEnv(deps.env, 'AMPLITUDE_SECRET_KEY', "the Amplitude project's secret key");
  const host = hostFrom(deps.env, 'AMPLITUDE_HOST', 'https://amplitude.com');
  if (!deps.metric)
    throw new JouriloError(
      'USAGE',
      'Amplitude needs --metric EVENT: the conversion event to count after exposure.',
    );
  const event = deps.metric;
  const start = day(deps.start, '--start');
  const end = deps.end ? day(deps.end, '--end') : new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const basic = Buffer.from(`${apiKey}:${secret}`).toString('base64');
  const http = client('Amplitude', deps, {
    header: `Basic ${basic}`,
    keyVars: 'AMPLITUDE_API_KEY / AMPLITUDE_SECRET_KEY',
    secrets: [apiKey, secret, basic],
  });

  return {
    name: 'amplitude',
    experiment: (flagKey) =>
      collect(
        flagKey,
        async (state) => {
          state.metric = event;
          const q = new URLSearchParams();
          q.append(
            'e',
            JSON.stringify({
              event_type: '$exposure',
              filters: [
                {
                  subprop_type: 'event',
                  subprop_key: 'flag_key',
                  subprop_op: 'is',
                  subprop_value: [flagKey],
                },
              ],
            }),
          );
          q.append('e', JSON.stringify({ event_type: event }));
          q.set('start', start);
          q.set('end', end);
          q.set('g', `gp:[Experiment] ${flagKey}`);
          q.set('limit', String(GROUP_LIMIT));
          const body = (await http.get(`${host.href.replace(/\/$/, '')}/api/2/funnels?${q}`)) as {
            data?: { groupValue?: string; cumulativeRaw?: number[] }[];
          };
          const groups = body.data ?? [];
          if (groups.length >= GROUP_LIMIT)
            throw new IncompleteData(
              `Amplitude returned ${GROUP_LIMIT} groups, its limit; variants may be cut off.`,
            );
          let unassigned = 0;
          for (const g of groups) {
            const name = g.groupValue ?? NO_VALUE;
            const raw = g.cumulativeRaw ?? [];
            if (name === NO_VALUE) {
              unassigned += raw[0] ?? 0;
              continue;
            }
            pushVariant(state, name, raw[0], raw.length > 1 ? raw.at(-1) : undefined);
          }
          if (unassigned)
            state.notes.push(
              `${unassigned} exposed user(s) had no [Experiment] ${flagKey} property and were left out.`,
            );
          if (!state.variants.some((v) => v.name === 'control'))
            state.incomplete(
              'Amplitude returned no numbers for the control variant; a comparison without it would be partial.',
            );
          const others = state.variants.filter((v) => v.name !== 'control').map((v) => v.name);
          settleVariants(
            'Amplitude',
            state,
            state.variants.some((v) => v.name === 'control') ? ['control', ...others] : [],
          );
        },
        [apiKey, secret, basic],
      ),
  };
}
