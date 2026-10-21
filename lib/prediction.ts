export type PredictionPoint = { month: string; horizon: number; predicted: number; lower80: number; upper80: number; lower95: number; upper95: number };
export type Score = { count: number; mae: number | null; wape: number | null; byHorizon?: (Score & { horizon: number })[] };
export type PredictionReport = {
  format: "revlens-prediction"; schemaVersion: 1; methodVersion: string; generatedAt: string; dataHash: string;
  source: string; target: string; currency: string; revision: number; asOf: string | null;
  status: "ready" | "insufficient_history" | "model_error"; message?: string;
  coverage: { confirmed: boolean; completeMonths: number; requiredMonths: number; start: string | null; end: string | null };
  history: { month: string; value: number }[]; forecast: PredictionPoint[]; warnings: string[];
  selectedModel?: string; selectedLabel?: string; intervalMethod?: string;
  validation?: { initialTrainingMonths: number; developmentEnd: string; selection: string;
    candidates: (Score & { model: string; label: string; status: string; failures: { origin: string; reason: string }[] })[] };
  test?: { start: string; end: string; selected: Score; baseline: Score;
    intervalCoverage: { horizon: number; count: number; coverage80: number; coverage95: number }[];
    predictions: (PredictionPoint & { origin: string; actual: number })[] };
};
