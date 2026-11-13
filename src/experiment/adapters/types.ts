// The contract between `experiment analyze --from <adapter>:<id>` and the read-only analytics adapters.

export interface AnalyticsAdapter {
  name: 'posthog' | 'growthbook' | 'amplitude';
  experiment(id: string): Promise<ExperimentData>;
}

export interface ExperimentData {
  id: string;
  metric: string;
  variants: { name: string; exposures: number; conversions: number }[];
  /** False when any number may be partial (rate limit, missing variant, a failed page); analyze then refuses. */
  complete: boolean;
  notes: string[];
}
