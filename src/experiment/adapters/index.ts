import { JouriloError } from '../../core/errors.js';
import { amplitudeAdapter } from './amplitude.js';
import type { AdapterDeps } from './common.js';
import { growthbookAdapter } from './growthbook.js';
import { posthogAdapter } from './posthog.js';
import type { AnalyticsAdapter } from './types.js';

export const ADAPTERS = ['posthog', 'growthbook', 'amplitude'] as const;

export function adapterFor(name: string, deps: AdapterDeps): AnalyticsAdapter {
  switch (name) {
    case 'posthog':
      return posthogAdapter(deps);
    case 'growthbook':
      return growthbookAdapter(deps);
    case 'amplitude':
      return amplitudeAdapter(deps);
    default:
      throw new JouriloError('USAGE', `Unknown adapter "${name}".`, `Use one of: ${ADAPTERS.join(', ')}.`);
  }
}
