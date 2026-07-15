import { GeneratedCodeFile } from '../types';

export interface VerificationIssue {
  file: string;
  line?: number;
  message: string;
  severity: string;
}

export interface VerificationTechnique {
  id: number;
  name: string;
  status: string; // PASS, FAIL, ERROR, SKIP
  details: string;
  issues: VerificationIssue[];
  durationMs: number;
}

export interface VerificationResponse {
  techniques: VerificationTechnique[];
  totalPassed: number;
  totalFailed: number;
  totalSkipped: number;
  overallVerdict: string;
  totalDurationMs: number;
}

const BACKEND_URL = 'http://localhost:5000';

export async function runBackendVerification(files: GeneratedCodeFile[]): Promise<VerificationResponse> {
  const response = await fetch(`${BACKEND_URL}/api/verification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Verification API error: ${response.status} - ${errorText}`);
  }

  return await response.json();
}
