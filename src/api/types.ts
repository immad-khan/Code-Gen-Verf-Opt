// DTOs for the MACI backend API (design §Data Models: "Experiments API" and
// "Web verification and repair DTOs").
//
// Backend envelopes are camelCase. Manifest, Run_Summary, and trajectory
// objects produced by TIVR are passed through unchanged, so they keep their
// snake_case keys here.

import type { ApiSettings, GeneratedCodeFile } from '../types';

export type { ApiSettings, GeneratedCodeFile };

// ─────────────────────────────────────────────────────────────
// Shared vocabulary
// ─────────────────────────────────────────────────────────────

/** Repair modes accepted by the web repair endpoint (22.1), case-sensitive. */
export type RepairMode = 'dou' | 'dou_no_bt' | 'generic' | 'evidence_only' | 'taxonomy_only' | 'full';

/** Repair modes accepted by the benchmark runner (adds the optional intervenor modes). */
export type RepairModeAll = RepairMode | 'intervenor' | 'dou_intervenor';

export type FeedbackRegime = 'dou' | 'strict';
export type GenerationPromptStyle = 'dou' | 'tivr';
export type LlmMode = 'mock' | 'live';

/** Failing Primary_State. */
export type PrimaryType = 'A' | 'B' | 'C';
/** Primary_State including the passing state. */
export type PrimaryState = PrimaryType | 'PASS';

/** Field-level validation error returned with 400 responses. */
export interface InvalidField {
  field: string;
  message: string;
}

/** Generic backend error envelope. Every error response carries `error`. */
export interface ApiErrorBody {
  error: string;
  invalidFields?: InvalidField[];
  activeRunId?: string;
}

// ─────────────────────────────────────────────────────────────
// Health
// ─────────────────────────────────────────────────────────────

export interface HealthResponse {
  status: 'ok';
  taxonomyVersion: string;
  time: string;
}

// ─────────────────────────────────────────────────────────────
// Verification
// ─────────────────────────────────────────────────────────────

export type CorrectnessTechnique = 'syntax' | 'imports' | 'tests' | 'runtime';
export type AdvisoryTechnique = 'types' | 'quality' | 'security';
export type TechniqueStatusValue = 'pass' | 'fail' | 'skipped_upstream' | 'no_tests' | 'error';

export interface FindingLocation {
  file: string;
  line: number | null;
}

export interface MappedFinding {
  technique: CorrectnessTechnique;
  signal: string;
  exception: string | null;
  message: string;
  evidence: string;
  location: FindingLocation | null;
  /** 'A.1'..'C.4' or 'UNMAPPED'. */
  category: string;
  primaryType: PrimaryType | null;
  categoryName: string | null;
  repairHint: string | null;
  confidence: number | null;
  occurrences: number;
}

export interface AdvisoryFinding {
  technique: AdvisoryTechnique;
  message: string;
  file: string | null;
  line: number | null;
}

export interface TechniqueStatus {
  id: string;
  name: string;
  status: TechniqueStatusValue;
  complete: boolean;
  details: string;
}

export interface VerificationRequest {
  files: GeneratedCodeFile[];
}

export interface VerificationResult {
  techniques: TechniqueStatus[];
  correctnessFindings: MappedFinding[];
  advisoryFindings: AdvisoryFinding[];
  gatePassed: boolean;
  complete: boolean;
  incompleteTechniques: string[];
  primaryState: PrimaryState;
  testsPassed: number;
  testsFailed: number;
  durationMs: number;
}

// ─────────────────────────────────────────────────────────────
// Repair sessions
// ─────────────────────────────────────────────────────────────

export interface RepairSessionRequest {
  files: GeneratedCodeFile[];
  originalPrompt: string;
  apiSettings: ApiSettings;
  /** Validated server-side; null/omitted means the default ('dou'). */
  repairMode?: string | null;
  /** Validated server-side (integer 1–3); null/omitted means 2. */
  k?: unknown;
  /** Validated server-side (number 0.0–1.0); null/omitted means 0.1. */
  temperature?: unknown;
}

export interface EffectiveRepairConfig {
  repairMode: RepairMode;
  k: number;
  temperature: number;
}

/** 202 response of POST /api/optimization/repair-sessions. */
export interface CreateRepairSessionResponse {
  sessionId: string;
  effectiveConfig: EffectiveRepairConfig;
}

export interface IterationTransition {
  from: PrimaryType;
  to: PrimaryState | null;
  available: boolean;
  failure: string | null;
}

export interface RepairIteration {
  iteration: number;
  prompt: string;
  rawResponse: string;
  critiqueText: string | null;
  noExtractableCode: boolean;
  filesBefore: GeneratedCodeFile[];
  filesAfter: GeneratedCodeFile[];
  verification: VerificationResult;
  verificationComplete: boolean;
  transition: IterationTransition;
  categoriesBefore: string[];
  categoriesAfter: string[];
  introduced: string[];
  resolved: string[];
  durationMs: number;
}

export type RepairSuccess = 'repaired' | 'not_repaired' | 'not_applicable';

export interface BugCounts {
  foundInitially: number;
  resolved: number;
  remaining: number;
  introduced: number;
}

export interface RepairTransition {
  iteration: number;
  from: string;
  to: string | null;
  count: number;
  available: boolean;
}

export interface RepairResult {
  effectiveConfig: EffectiveRepairConfig;
  iterationsPerformed: number;
  initial: VerificationResult;
  iterations: RepairIteration[];
  repairSuccess: RepairSuccess;
  /** Length k; null when repair was not applicable. */
  passedByIteration: boolean[] | null;
  bugCounts: BugCounts;
  transitions: RepairTransition[];
  incompleteVerifications: ('initial' | number)[];
  finalFiles: GeneratedCodeFile[];
}

export type RepairSessionStatus = 'running' | 'completed' | 'failed';

export interface OperationError {
  operation: string;
  reason: string;
}

export interface RepairSessionView {
  sessionId: string;
  status: RepairSessionStatus;
  effectiveConfig: EffectiveRepairConfig;
  iterationsCompleted: number;
  partial: Pick<RepairResult, 'initial' | 'iterations'> | null;
  result: RepairResult | null;
  error: OperationError | null;
}

// ─────────────────────────────────────────────────────────────
// Experiments
// ─────────────────────────────────────────────────────────────

export type RunStatusValue = 'running' | 'completed' | 'failed' | 'cancelled';
export type RunProvenance = 'manifest' | 'legacy';
export type RunPhase = 'generation' | 'repair' | 'summary' | 'done';

export interface DatasetInfo {
  fileName: string;
  taskCount: number;
  sha256: string;
}

export interface CacheInfo {
  path: string;
  datasetSha256: string;
  model: string;
  llmMode: LlmMode;
  generationPromptStyle: GenerationPromptStyle;
}

export interface StartRunRequest {
  /** File name relative to Experiments:DataDir (required). */
  dataset: string;
  repairMode?: RepairModeAll;
  feedbackRegime?: FeedbackRegime;
  /** 1..10, default 2. */
  k?: number;
  /** 0.0..2.0, default 0.1. */
  temperature?: number;
  generationPromptStyle?: GenerationPromptStyle;
  /** 1..10000, default 120. */
  sampleSize?: number;
  /** 0..2147483647, default 0. */
  seed?: number;
  /** Relative to the data directory. */
  generationCache?: string | null;
  mock?: boolean;
}

/** 202 response of POST /api/experiments/runs. */
export interface StartRunResponse {
  runId: string;
}

/** Rate object from Run_Summary; `pct` is null when `den == 0` (14.9). */
export interface Rate {
  num: number;
  den: number;
  pct: number | null;
}

export interface RateWithIteration extends Rate {
  iteration: number;
}

export interface RunListItem {
  runId: string;
  provenance: RunProvenance;
  status: RunStatusValue;
  startTime: string | null;
  repairMode: string | null;
  feedbackRegime: string | null;
  k: number | null;
  model: string | null;
  sampleSize: number | null;
  llmMode: LlmMode | null;
  datasetSha256: string | null;
  generationCacheSha256: string | null;
  seed: number | null;
  /** null when the run has no summary. */
  rsr: RateWithIteration[] | null;
}

export interface Decoding {
  temperature: number;
  top_p: number | null;
  max_tokens: number | null;
}

/** manifest.json, passed through unchanged (snake_case). */
export interface RunManifest {
  schema: string;
  run_id: string;
  dataset_path: string;
  dataset_sha256: string;
  task_count: number;
  repair_mode: string;
  feedback_regime: string;
  k: number;
  model: string;
  api_host: string | null;
  decoding: Decoding;
  generation_prompt_style: string;
  sample_size: number;
  seed: number;
  llm_mode: LlmMode;
  taxonomy_version: string;
  tivr_version: string;
  python_version: string;
  advisory_techniques: boolean;
  generation_cache: { path: string; sha256: string; reused: boolean } | null;
  repair_sample: {
    requested: number;
    actual: number;
    seed: number;
    cache_dataset_sha256: string;
    task_ids: string[];
  } | null;
  start_time: string;
  end_time: string | null;
  completed: boolean;
  termination: 'llm_error' | 'interrupted' | 'error' | null;
  error: string | null;
}

export interface PerPrimaryTypeRates {
  iteration: number;
  A: Rate;
  B: Rate;
  C: Rate;
}

export interface BugEvolutionMatrix {
  iteration: number;
  states: PrimaryState[];
  /** 4×4 counts, rows/columns in `states` order. */
  counts: number[][];
  /** 4×4 unrounded row percentages; a row is all null when its row total is 0. */
  row_percentages: (number | null)[][];
}

export interface RunCost {
  llm_calls: number;
  calls_without_usage: number;
  prompt_tokens: number;
  completion_tokens: number;
  per_program: {
    llm_calls: number | null;
    prompt_tokens: number | null;
    completion_tokens: number | null;
  } | null;
}

/** summary.json, passed through unchanged (snake_case). */
export interface RunSummary {
  schema: string;
  run_id: string;
  llm_mode: LlmMode;
  taxonomy_version: string;
  dataset: { path: string; sha256: string; task_count: number };
  config: {
    repair_mode: string;
    feedback_regime: string;
    k: number;
    model: string;
    api_host: string | null;
    temperature: number;
    top_p: number | null;
    max_tokens: number | null;
    generation_prompt_style: string;
    seed: number;
  };
  sample: { requested: number; actual: number };
  pass_at_1: { before: Rate; after: Rate };
  rsr: RateWithIteration[];
  conditional_repair_rate: RateWithIteration[];
  per_primary_type: PerPrimaryTypeRates[];
  /** Keys: 'A.1'..'C.4' and 'UNMAPPED'. */
  per_category: Record<string, Rate>;
  bug_evolution: BugEvolutionMatrix[];
  unmapped_as_c_by_iteration: number[];
  empty_visible_suite_programs: number;
  cost: RunCost;
}

/** GET /api/experiments/runs/{id}. Legacy runs may lack manifest and/or summary. */
export interface RunDetail {
  runId: string;
  provenance: RunProvenance;
  status: RunStatusValue;
  manifest: RunManifest | null;
  summary: RunSummary | null;
}

/** GET /api/experiments/runs/{id}/status. */
export interface RunStatus {
  runId: string;
  status: RunStatusValue;
  phase: RunPhase | null;
  completed: number | null;
  total: number | null;
  /** Last ≤200 lines of runner output. */
  outputTail: string[];
  exitCode: number | null;
  launchError: string | null;
}

/** POST /api/experiments/runs/{id}/cancel. */
export interface CancelRunResponse {
  runId: string;
  status: 'cancelled';
}

export interface HiddenResultSummary {
  passed: boolean;
  primary_state: PrimaryState;
  categories: string[];
  unmapped_as_c: boolean;
}

export interface TokenUsage {
  prompt_tokens: number | null;
  completion_tokens: number | null;
}

/** trajectories.jsonl entry, passed through unchanged (snake_case). */
export interface TrajectoryEntry {
  schema: string;
  run_id: string;
  task_id: string;
  iteration: number;
  llm_mode: LlmMode;
  repair_mode: string;
  feedback_regime: string;
  prompt: string;
  raw_response: string;
  critique_text: string;
  extracted_code: string;
  had_code_block: boolean;
  code_before: string;
  feedback_report: {
    suite: 'visible' | 'hidden';
    gate_passed: boolean;
    correctness: unknown[];
    diagnoses: unknown[];
  } | null;
  hidden_result: HiddenResultSummary;
  primary_state_before: PrimaryState;
  primary_state: PrimaryState;
  empty_visible_suite: boolean;
  usage: TokenUsage | null;
}

/** GET /api/experiments/runs/{id}/trajectories?page=N. */
export interface TrajectoryPage {
  page: number;
  pageSize: number;
  total: number;
  entries: TrajectoryEntry[];
}
