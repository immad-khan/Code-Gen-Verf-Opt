import { useState, useEffect } from 'react';
import { PipelineStep, AIResultData, ApiSettings, AgentLog, PythonAuditFinding } from './types';
import { processPromptWithAgents } from './services/aiService';
import { analyzePythonCode } from './analyzer';
import { runBackendVerification, VerificationResponse } from './services/verificationService';
import { Header } from './components/Header';
import { PipelineNav } from './components/PipelineNav';
import { Step1Input } from './components/Step1Input';
import { Step2CodeOutput } from './components/Step2CodeOutput';
import { Step3Verification } from './components/Step3Verification';
import { ProcessingOverlay } from './components/ProcessingOverlay';
import { ExportModal } from './components/ExportModal';
import { ApiSettingsModal } from './components/ApiSettingsModal';

const DEFAULT_PROMPT = '';

function createInitialResultData(): AIResultData {
  return {
    prompt: '',
    timestamp: '',
    modelUsed: '',
    executiveSummary: {
      overallRisk: 'LOW',
      totalFindings: 0,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      topMustFixes: [],
      confidence: 'High',
      confidenceReason: ''
    },
    mergeGate: {
      verdict: 'APPROVED',
      reason: '',
      temperature: 0.2
    },
    metrics: {
      processingTimeMs: 0,
      tokenCount: 0,
      qualityScore: 0,
      coverageRate: 0,
      agentConsensus: 0,
      specAlignment: 0,
      linterWarnings: 0,
      securityVulnerabilitiesCount: 0
    },
    generatedCode: [],
    findings: [],
    techniqueMatrix: [],
    securityChecklist: [],
    verificationCoverage: [],
    dependencyTable: [],
    recommendedTests: {
      unitPytest: '',
      propertyBased: '',
      fuzz: '',
      mutationWeakSpots: [],
      mutationTargetScore: 0
    },
    recommendedCiCdYaml: '',
    strengthsObserved: [],
    reviewerNotes: [],
    agentLogs: [],
    radarMetrics: [],
    specComparison: []
  };
}

function loadSettings(): ApiSettings {
  // Check for API keys in environment variables (prioritize Groq first!)
  const envKeys = {
    groq: import.meta.env.VITE_GROQ_API_KEY,
    gemini: import.meta.env.VITE_GEMINI_API_KEY,
    openai: import.meta.env.VITE_OPENAI_API_KEY,
    anthropic: import.meta.env.VITE_ANTHROPIC_API_KEY,
  };

  // Try to load from localStorage
  try {
    const raw = localStorage.getItem('maci_api_settings_v2');
    if (raw) {
      const saved = JSON.parse(raw);
      // If saved settings have a valid API key, use them
      if (saved.apiKey && saved.apiKey.trim().length > 8) {
        return saved;
      }
      // If saved settings don't have a valid key, try to use the env key for that provider
      if (envKeys[saved.provider]) {
        return {
          ...saved,
          apiKey: envKeys[saved.provider]
        };
      }
    }
  } catch {}

  // Find the first provider with an API key in env vars (Groq first)
  const models: Record<string, string> = {
    groq: 'llama-3.1-8b-instant',
    gemini: 'gemini-1.5-flash',
    openai: 'gpt-4o-mini',
    anthropic: 'claude-3-5-sonnet-latest',
  };
  for (const [provider, key] of Object.entries(envKeys)) {
    if (key && key.trim().length > 8) {
      return { 
        provider: provider as any, 
        apiKey: key, 
        model: models[provider] 
      };
    }
  }

  // Default to Groq even if no key is set
  return { provider: 'groq', apiKey: '', model: 'llama-3.1-8b-instant' };
}

export function App() {
  const [currentStep, setCurrentStep] = useState<PipelineStep>(1);
  const [prompt, setPrompt] = useState<string>(DEFAULT_PROMPT);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentLog, setCurrentLog] = useState<AgentLog | null>(null);
  const [allLogs, setAllLogs] = useState<AgentLog[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [temperature, setTemperature] = useState(0.6);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [resultData, setResultData] = useState<AIResultData>(createInitialResultData());
  const [hasGeneratedResult, setHasGeneratedResult] = useState(false);
  const [apiSettings, setApiSettings] = useState<ApiSettings>(loadSettings);
  const [backendVerification, setBackendVerification] = useState<VerificationResponse | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  // Reset localStorage on initial load to use the latest .env keys
  useEffect(() => {
    try {
      localStorage.removeItem('maci_api_settings_v2');
      // Reload settings after clearing localStorage
      const freshSettings = loadSettings();
      setApiSettings(freshSettings);
    } catch {}
  }, []);

  const hasApiKey = apiSettings.apiKey.trim().length > 8;

  const handleSaveSettings = (s: ApiSettings) => {
    setApiSettings(s);
    try { localStorage.setItem('maci_api_settings_v2', JSON.stringify(s)); } catch {}
  };

  const handleProcessQuery = async () => {
    if (!prompt.trim()) return;
    setIsProcessing(true);
    setProgress(5);
    setAllLogs([]);
    setCurrentLog(null);
    setErrorMessage(null);

    try {
      const data = await processPromptWithAgents(prompt, apiSettings, (pct, log) => {
        setProgress(pct);
        setCurrentLog(log);
        setAllLogs(prev => [...prev, log]);
      });

      // Check if LLM returned an error (non-code request)
      if (data.generatedCode.length === 0) {
        setErrorMessage('I can only generate Python code. Please describe a Python project or program you would like me to create.');
        setIsProcessing(false);
        return;
      }

      // Run client-side code quality analysis (patterns, style, security hints)
      const analysis = analyzePythonCode(data.generatedCode);

      const enriched: AIResultData = {
        ...data,
        findings: analysis.findings,
        techniqueMatrix: analysis.techniqueMatrix,
        securityChecklist: analysis.securityChecklist,
        executiveSummary: {
          ...data.executiveSummary,
          totalFindings: analysis.findings.length,
          criticalCount: analysis.findings.filter(f => f.severity === 'CRITICAL').length,
          highCount: analysis.findings.filter(f => f.severity === 'HIGH').length,
          mediumCount: analysis.findings.filter(f => f.severity === 'MEDIUM').length,
          lowCount: analysis.findings.filter(f => f.severity === 'LOW').length,
          overallRisk: analysis.findings.some(f => f.severity === 'CRITICAL') ? 'CRITICAL'
            : analysis.findings.some(f => f.severity === 'HIGH') ? 'HIGH'
            : analysis.findings.some(f => f.severity === 'MEDIUM') ? 'MEDIUM' : 'LOW',
          topMustFixes: analysis.findings
            .filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH')
            .slice(0, 3)
            .map(f => f.title),
          confidence: 'High',
          confidenceReason: `Live code from ${apiSettings.provider.toUpperCase()} + real verification on backend.`,
        },
        mergeGate: {
          verdict: analysis.findings.some(f => f.severity === 'CRITICAL') ? 'BLOCKED'
            : analysis.findings.some(f => f.severity === 'HIGH') ? 'PASS_WITH_WARNINGS' : 'APPROVED',
          reason: analysis.findings.some(f => f.severity === 'CRITICAL')
            ? `Analyzer found ${analysis.findings.filter(f => f.severity === 'CRITICAL').length} CRITICAL issue(s).`
            : analysis.findings.some(f => f.severity === 'HIGH')
            ? `Analyzer found HIGH-severity issues — address before merge.`
            : `Analyzer cleared all CRITICAL/HIGH checks. Safe to merge.`,
          temperature: 0.2,
        },
        metrics: {
          ...data.metrics,
          linterWarnings: analysis.findings.filter(f => f.severity === 'LOW').length,
          securityVulnerabilitiesCount: analysis.findings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH').length,
        },
      };

      setResultData(enriched);
      setHasGeneratedResult(true);
      setCurrentStep(2);

      // Run real backend verification in parallel (AST, imports, pytest, runtime, mypy)
      setIsVerifying(true);
      setBackendVerification(null);
      try {
        const verification = await runBackendVerification(data.generatedCode);
        setBackendVerification(verification);
        console.log('Backend verification:', verification);
      } catch (verifyErr) {
        console.warn('Backend verification failed (backend may be offline):', verifyErr);
      } finally {
        setIsVerifying(false);
      }
    } catch (err) {
      console.error('Processing failed:', err);
      setErrorMessage(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpdateFindings = (updatedFindings: PythonAuditFinding[]) => {
    setResultData(prev => ({ ...prev, findings: updatedFindings }));
  };

  return (
    <div className="app-shell min-h-screen text-[color:var(--color-ink)] font-sans flex flex-col antialiased selection:bg-[#7c6cff] selection:text-white">
      <Header
        temperature={temperature}
        onTemperatureChange={setTemperature}
        hasApiKey={hasApiKey}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />
      <PipelineNav
        currentStep={currentStep}
        onSelectStep={(step) => setCurrentStep(step)}
        hasResult={hasGeneratedResult}
      />

      <main className="flex-1 flex flex-col justify-start">
        {currentStep === 1 && (
          <>
            {errorMessage && (
              <div className="max-w-3xl mx-auto px-4 md:px-6 py-4 mt-4">
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-300 text-sm">
                  <strong>Error:</strong> {errorMessage}
                </div>
              </div>
            )}
            <Step1Input
              prompt={prompt}
              onPromptChange={setPrompt}
              onProcess={handleProcessQuery}
              isProcessing={isProcessing}
              temperature={temperature}
            />
          </>
        )}
        {currentStep === 2 && (
          <Step2CodeOutput
            result={resultData}
            onProceedToVerification={() => setCurrentStep(3)}
            onBackToPrompt={() => setCurrentStep(1)}
            onRegenerate={handleProcessQuery}
          />
        )}
        {currentStep === 3 && (
          <Step3Verification
            result={resultData}
            onUpdateFindings={handleUpdateFindings}
            onBackToCode={() => setCurrentStep(2)}
            onBackToPrompt={() => setCurrentStep(1)}
            onExport={() => setIsExportModalOpen(true)}
            backendVerification={backendVerification}
            isVerifying={isVerifying}
          />
        )}
      </main>

      <footer className="py-5 px-6 border-t border-[color:var(--color-hairline)] mt-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-[color:var(--color-ink-faint)]">
          <span>© {new Date().getFullYear()} MACI — Multi-Agent Code Intelligence</span>
          <span className="font-mono">
            {hasApiKey ? `Using ${apiSettings.provider.toUpperCase()} · ${apiSettings.model}` : 'Please configure an API key to generate code'}
          </span>
        </div>
      </footer>

      {isProcessing && <ProcessingOverlay progress={progress} currentLog={currentLog} allLogs={allLogs} />}
      {hasGeneratedResult && (
        <ExportModal 
          isOpen={isExportModalOpen} 
          onClose={() => setIsExportModalOpen(false)} 
          result={resultData} 
          backendVerification={backendVerification}
        />
      )}
      <ApiSettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} settings={apiSettings} onSave={handleSaveSettings} />
    </div>
  );
}

export default App;
