export type PipelineStep = 1 | 2 | 3;

export type SeverityLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type IssueCategory = 'correct' | 'incorrect' | 'overspecified' | 'missing';

export interface PythonAuditFinding {
  id: string;
  number: number;
  title: string;
  severity: SeverityLevel;
  category: IssueCategory;
  filePath: string;
  lineRange: string;
  codeSnippet: string;
  cwe?: string; // e.g. "CWE-89"
  ruleId?: string; // e.g. "B608" (Bandit), "S608" (Ruff), "E501" (pycodestyle)
  detectionTechnique: string; // e.g. "Technique 3 — Taint & Data-Flow Analysis"
  whyItMatters: string;
  sourceSinkPath?: string;
  pythonFix: string;
  resolved?: boolean;
}

// Backwards-compat alias so older references keep compiling
export type CSharpAuditFinding = PythonAuditFinding;

export interface DependencyVerificationItem {
  packageOrApi: string;
  version: string;
  status: 'VERIFIED' | 'UNVERIFIED' | 'HALLUCINATED' | 'VULNERABLE';
  evidence: string;
  action: string;
}

// One row per audit technique (1–12). Models Core Principle #6:
// techniques with no findings report PASS; others carry their finding count.
export interface TechniqueResult {
  id: number;
  name: string;
  focus: string;
  status: 'PASS' | 'FINDINGS' | 'UNVERIFIED';
  findingCount: number;
  toolMapping: string; // e.g. "SCS0002 / CodeQL cs/sql-injection"
}

// Technique 3's 15-item verifiable security checklist
export interface SecurityChecklistItem {
  label: string;
  passed: boolean;
  note?: string;
}

// Honest coverage report of what the current verifier actually checks
export interface VerificationCoverageItem {
  id: number;
  name: string;
  automationLevel: 'AUTOMATED' | 'PARTIAL' | 'MANUAL' | 'DISPLAY_ONLY';
  verdict: 'COMPLETE' | 'PARTIAL' | 'MISSING';
  implementedChecks: string[];
  missingChecks: string[];
  evidence: string;
}

// Structured recommended-test blocks (unit / property / fuzz / mutation)
export interface RecommendedTests {
  unitPytest: string;      // pytest unit tests
  propertyBased: string;   // Hypothesis property-based tests
  fuzz: string | null;     // Atheris fuzz harness; null when no parsers/regex present
  mutationWeakSpots: string[];
  mutationTargetScore: number;
}

// Merge-gate verdict — auto-fail on any Critical finding
export interface MergeGate {
  verdict: 'BLOCKED' | 'PASS_WITH_WARNINGS' | 'APPROVED';
  reason: string;
  temperature: number; // audit determinism (0.1–0.2 recommended)
}

export interface GeneratedCodeFile {
  name: string;
  path: string; // e.g. "app/routers/library.py"
  language: string; // "python", "toml", "ini", "yaml", "text"
  content: string;
  description: string; // Plain English breakdown for non-tech users
  category: 'router' | 'service' | 'model' | 'schema' | 'data' | 'test' | 'config' | 'utils' | 'other';
}

export interface ProcessingMetrics {
  processingTimeMs: number;
  tokenCount: number;
  qualityScore: number; // 0 - 10
  coverageRate: number; // percentage 0 - 100
  agentConsensus: number; // percentage 0 - 100
  specAlignment: number; // percentage 0 - 100
  linterWarnings: number; // Ruff / flake8 warnings
  securityVulnerabilitiesCount: number;
}

export interface AgentLog {
  agentName: string;
  role: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
  message: string;
  timestamp: string;
}

export interface ExecutiveSummaryData {
  overallRisk: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  totalFindings: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  topMustFixes: string[];
  confidence: 'High' | 'Medium' | 'Low';
  confidenceReason: string;
}

export interface AIResultData {
  prompt: string;
  timestamp: string;
  modelUsed: string;
  executiveSummary: ExecutiveSummaryData;
  mergeGate: MergeGate;
  metrics: ProcessingMetrics;
  generatedCode: GeneratedCodeFile[];
  findings: PythonAuditFinding[];
  techniqueMatrix: TechniqueResult[];
  securityChecklist: SecurityChecklistItem[];
  verificationCoverage: VerificationCoverageItem[];
  dependencyTable: DependencyVerificationItem[];
  recommendedTests: RecommendedTests;
  recommendedCiCdYaml: string;
  strengthsObserved: string[];
  reviewerNotes: string[];
  agentLogs: AgentLog[];
  radarMetrics: {
    subject: string;
    score: number;
    benchmark: number;
  }[];
  specComparison: {
    category: string;
    ruppSpecCount: number;
    aiSpecCount: number;
  }[];
}

export interface ApiSettings {
  provider: 'openai' | 'anthropic' | 'gemini' | 'groq';
  apiKey: string;
  model: string;
  customEndpoint?: string;
}
