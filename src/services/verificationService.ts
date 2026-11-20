import { backendBaseUrl } from '../api/client';
import { GeneratedCodeFile, IndependentChecksResult, InterfaceDefinition, ApiSettings } from '../types';

export interface VerificationIssue {
  file: string;
  line?: number;
  message: string;
  severity: string;
  codeSnippet?: string;
}

export interface VerificationTechnique {
  id: number;
  name: string;
  status: string; // PASS, FAIL, ERROR, SKIP
  details: string;
  issues: VerificationIssue[];
  durationMs: number;
}

export interface CodeMetrics {
  // Core verification metric
  passRate: number;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  // Code quality / complexity
  totalLinesOfCode: number;
  avgCyclomaticComplexity: number;
  maxCyclomaticComplexity: number;
  totalApiCount: number;
  commentCodeRatio: number;
  // Radon-specific
  maintainabilityIndex: number;    // 0–100, -1 = unavailable
  radonComplexFunctionCount: number; // functions graded C / D / E / F
  // Semgrep-specific
  semgrepFindingCount: number;     // 0 = clean; -1 = not run
  // Bug distribution
  syntaxBugCount: number;
  runtimeBugCount: number;
  functionalBugCount: number;
}

export interface VerificationResponse {
  techniques: VerificationTechnique[];
  totalPassed: number;
  totalFailed: number;
  totalSkipped: number;
  overallVerdict: string;
  totalDurationMs: number;
  metrics: CodeMetrics;
  independentChecks?: IndependentChecksResult;
}

export async function runBackendVerification(
  files: GeneratedCodeFile[],
  lockedTestHash?: string,
  prompt?: string,
  interfaceDef?: InterfaceDefinition,
  secondaryApiSettings?: ApiSettings | null
): Promise<VerificationResponse> {
  const response = await fetch(`${backendBaseUrl()}/api/verification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files,
      lockedTestHash,
      prompt,
      interface: interfaceDef,
      secondaryApiSettings: secondaryApiSettings || null,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Verification API error: ${response.status} - ${errorText}`);
  }

  return await response.json();
}
