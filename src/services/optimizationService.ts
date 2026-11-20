import type { ApiSettings, GeneratedCodeFile, OptimizationResponse, CompareRepairResponse, ImprovedRepairSources } from '../types';
import type { VerificationResponse } from './verificationService';
import { backendBaseUrl } from '../api/client';

export interface RunOptimizationParams {
  files: GeneratedCodeFile[];
  originalPrompt: string;
  apiSettings: ApiSettings;
  verificationResult?: VerificationResponse | null;
  maxIterations?: number;
  lockedTestHash?: string;
  mode?: 'dou' | 'improved' | 'compare';
  improvedSources?: ImprovedRepairSources;
}

async function requestRepair<T>(path: 'repair' | 'compare', params: RunOptimizationParams): Promise<T> {
  const { mode, ...request } = params;
  const res = await fetch(`${backendBaseUrl()}/api/optimization/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...request, maxIterations: params.maxIterations ?? 2,
      ...(path === 'repair' ? { repairMode: mode ?? 'dou' } : {}) }),
  });
  if (!res.ok) throw new Error(`Repair failed (${res.status}): ${await res.text()}`);
  return await res.json();
}

export const runBackendOptimization = (params: RunOptimizationParams) => requestRepair<OptimizationResponse>('repair', params);
export const runCompareOptimization = (params: RunOptimizationParams) => requestRepair<CompareRepairResponse>('compare', params);
