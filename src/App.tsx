import { useState, useEffect } from 'react';
import { PipelineStep, AIResultData, ApiSettings, AgentLog, PythonAuditFinding, OptimizationResponse, GeneratedCodeFile } from './types';
import { processPromptWithAgents } from './services/aiService';
import { analyzePythonCode } from './analyzer';
import { runBackendVerification, VerificationResponse } from './services/verificationService';
import { runBackendOptimization } from './services/optimizationService';
import { Header } from './components/Header';
import { PipelineNav } from './components/PipelineNav';
import { Step1Input } from './components/Step1Input';
import { Step2CodeOutput } from './components/Step2CodeOutput';
import { Step3Verification } from './components/Step3Verification';
import { Step4Optimization } from './components/Step4Optimization';
import { Step8FinalResults } from './components/Step8FinalResults';
import { ProcessingOverlay } from './components/ProcessingOverlay';
import { ExportModal } from './components/ExportModal';
import { ApiSettingsModal } from './components/ApiSettingsModal';
import { PrintReport } from './components/PrintReport';
import LandingPage from '../landing-page/src/App';
import '../landing-page/src/index.css';

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
      temperature: 0.1
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
  const envKeys: Record<string, string | undefined> = {
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
  const [showLanding, setShowLanding] = useState<boolean>(() => {
    return window.location.hash !== '#app' && window.location.hash !== '#pipeline';
  });
  const [currentStep, setCurrentStep] = useState<PipelineStep>(1);
  const [prompt, setPrompt] = useState<string>(DEFAULT_PROMPT);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentLog, setCurrentLog] = useState<AgentLog | null>(null);
  const [allLogs, setAllLogs] = useState<AgentLog[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const temperature = 0.1;
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [resultData, setResultData] = useState<AIResultData>(createInitialResultData());
  const [hasGeneratedResult, setHasGeneratedResult] = useState(false);
  const [apiSettings, setApiSettings] = useState<ApiSettings>(loadSettings);
  const [backendVerification, setBackendVerification] = useState<VerificationResponse | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResponse | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);

  // Intercept clicking "Try it out" anywhere inside the landing page
  const handleLandingClick = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest('a, button');
    if (target) {
      const href = target.getAttribute('href') || '';
      const text = target.textContent?.toLowerCase() || '';
      if (href === '#try' || href.includes('try') || text.includes('try it out')) {
        e.preventDefault();
        setShowLanding(false);
        window.location.hash = '#app';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  };

  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash === '#app' || window.location.hash === '#try') {
        setShowLanding(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (window.location.hash === '#landing' || !window.location.hash) {
        setShowLanding(true);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

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
    setOptimizationResult(null);

    try {
      const data = await processPromptWithAgents(prompt, apiSettings, (pct, log) => {
        setProgress(pct);
        setCurrentLog(log);
        setAllLogs(prev => [...prev, log]);
      }, temperature);

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
          temperature: 0.1,
        },
        metrics: {
          ...data.metrics,
          linterWarnings: analysis.findings.filter(f => f.severity === 'LOW').length,
          securityVulnerabilitiesCount: analysis.findings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH').length,
        },
      };

      const fileNames = data.generatedCode.map(f => f.name).join(', ');
      setProgress(100);
      const completionLog: AgentLog = {
        agentName: 'Pipeline',
        role: 'Complete',
        status: 'active',
        message: `Successfully synthesized and parsed: ${fileNames}`,
        timestamp: new Date().toLocaleTimeString(),
      };
      setCurrentLog(completionLog);
      setAllLogs(prev => [...prev, completionLog]);

      setResultData(enriched);
      setHasGeneratedResult(true);
      setCurrentStep(2);
      setIsProcessing(false);

      // Run real backend verification in background (AST, imports, pytest, runtime, mypy)
      setIsVerifying(true);
      setBackendVerification(null);
      setVerificationError(null);
      runBackendVerification(data.generatedCode)
        .then(verification => {
          setBackendVerification(verification);
          console.log('Backend verification succeeded:', verification);
        })
        .catch(verifyErr => {
          const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
          console.warn('Backend verification failed:', verifyErr);
          setVerificationError(msg);
        })
        .finally(() => {
          setIsVerifying(false);
        });
    } catch (err) {
      console.error('Processing failed:', err);
      setErrorMessage(err instanceof Error ? err.message : 'An unknown error occurred');
      setIsProcessing(false);
    }
  };

  const handleRetryVerification = async () => {
    if (!resultData?.generatedCode || resultData.generatedCode.length === 0) return;
    setIsVerifying(true);
    setVerificationError(null);
    try {
      const verification = await runBackendVerification(resultData.generatedCode);
      setBackendVerification(verification);
      console.log('Backend verification retry succeeded:', verification);
    } catch (verifyErr) {
      const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
      console.warn('Backend verification retry failed:', verifyErr);
      setVerificationError(msg);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleRunOptimization = async () => {
    if (!resultData?.generatedCode || resultData.generatedCode.length === 0) return;
    setIsOptimizing(true);
    try {
      const res = await runBackendOptimization({
        files: resultData.generatedCode,
        originalPrompt: prompt,
        apiSettings,
        verificationResult: backendVerification,
        maxIterations: 2,
      });
      setOptimizationResult(res);
    } catch (err) {
      console.error('Optimization error:', err);
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleApplyRepairedCode = (repairedFiles: GeneratedCodeFile[]) => {
    setResultData(prev => ({
      ...prev,
      generatedCode: repairedFiles,
    }));
    alert('Repaired codebase applied successfully!');
  };

  const handleUpdateFindings = (updatedFindings: PythonAuditFinding[]) => {
    setResultData(prev => ({ ...prev, findings: updatedFindings }));
  };

  const round1Iteration = optimizationResult?.iterations.find(it => it.iterationNumber === 1);
  const round1Verification = round1Iteration?.reVerification || null;

  const round2Iteration = optimizationResult?.iterations.find(it => it.iterationNumber === 2);
  const round2Verification = round2Iteration?.reVerification || null;

  const maxUnlockedStep: PipelineStep = optimizationResult
    ? 8
    : backendVerification
    ? 4
    : hasGeneratedResult
    ? 3
    : 1;

  if (showLanding) {
    return (
      <div onClickCapture={handleLandingClick}>
        <LandingPage />
      </div>
    );
  }

  return (
    <div className="app-shell min-h-screen text-[color:var(--color-ink)] font-sans flex flex-col antialiased selection:bg-[#7c6cff] selection:text-white">
      <Header
        hasApiKey={hasApiKey}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onGoToLanding={() => {
          setShowLanding(true);
          window.location.hash = '';
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
      <PipelineNav
        currentStep={currentStep}
        onSelectStep={(step) => setCurrentStep(step)}
        hasResult={hasGeneratedResult}
        maxUnlockedStep={maxUnlockedStep}
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
        {/* Step 3: Initial Verification (Round 0) */}
        {currentStep === 3 && (
          <Step3Verification
            result={resultData}
            title="Initial Verification (Round 0)"
            stepBadge="Phase 3 · Pre-Repair Diagnostics"
            backButtonLabel="Back to Code"
            nextButtonLabel="Proceed to Round 1 Repair →"
            onUpdateFindings={handleUpdateFindings}
            onBackToCode={() => setCurrentStep(2)}
            onBackToPrompt={() => setCurrentStep(1)}
            onExport={() => setIsExportModalOpen(true)}
            onProceedToOptimization={async () => {
              if (!optimizationResult && !isOptimizing) {
                await handleRunOptimization();
              }
              setCurrentStep(4);
            }}
            backendVerification={backendVerification}
            verificationError={verificationError}
            isVerifying={isVerifying}
            onRetryVerification={handleRetryVerification}
          />
        )}
        {/* Step 4: Optimization Round 1 (Dou et al. Iteration 1) */}
        {currentStep === 4 && (
          <Step4Optimization
            result={resultData}
            backendVerification={backendVerification}
            optimizationResult={optimizationResult}
            isOptimizing={isOptimizing}
            onRunOptimization={handleRunOptimization}
            forcedIteration={1}
            title="Optimization — Round 1 Repair"
            stepBadge="Phase 4 · Dou et al. Iteration 1"
            backButtonLabel="Back to Initial Verification"
            nextButtonLabel="Proceed to Round 1 Verification →"
            onProceedNext={() => setCurrentStep(5)}
            onBackToVerification={() => setCurrentStep(3)}
            onApplyRepairedCode={handleApplyRepairedCode}
          />
        )}
        {/* Step 5: Round 1 Verification (Post-Iteration 1 checks) */}
        {currentStep === 5 && (
          <Step3Verification
            result={{
              ...resultData,
              generatedCode: round1Iteration?.repairedFiles || resultData.generatedCode,
            }}
            title="Round 1 Verification"
            stepBadge="Phase 5 · Post-Round 1 Checks"
            backButtonLabel="Back to Round 1 Repair"
            nextButtonLabel={round2Iteration ? "Proceed to Round 2 Repair →" : "Proceed to Final Results →"}
            onUpdateFindings={handleUpdateFindings}
            onBackToCode={() => setCurrentStep(4)}
            onBackToPrompt={() => setCurrentStep(1)}
            onExport={() => setIsExportModalOpen(true)}
            onProceedToOptimization={() => setCurrentStep(round2Iteration ? 6 : 8)}
            backendVerification={round1Verification}
            verificationError={null}
            isVerifying={isOptimizing}
          />
        )}
        {/* Step 6: Optimization Round 2 (Dou et al. Iteration 2 with Episodic Memory) */}
        {currentStep === 6 && (
          <Step4Optimization
            result={resultData}
            backendVerification={round1Verification}
            optimizationResult={optimizationResult}
            isOptimizing={isOptimizing}
            onRunOptimization={handleRunOptimization}
            forcedIteration={2}
            title="Optimization — Round 2 Repair"
            stepBadge="Phase 6 · Dou et al. Iteration 2 (Episodic Memory)"
            backButtonLabel="Back to Round 1 Verification"
            nextButtonLabel="Proceed to Round 2 Verification →"
            onProceedNext={() => setCurrentStep(7)}
            onBackToVerification={() => setCurrentStep(5)}
            onApplyRepairedCode={handleApplyRepairedCode}
          />
        )}
        {/* Step 7: Round 2 Verification (Post-Iteration 2 checks) */}
        {currentStep === 7 && (
          <Step3Verification
            result={{
              ...resultData,
              generatedCode: round2Iteration?.repairedFiles || round1Iteration?.repairedFiles || resultData.generatedCode,
            }}
            title="Round 2 Verification"
            stepBadge="Phase 7 · Post-Round 2 Checks"
            backButtonLabel="Back to Round 2 Repair"
            nextButtonLabel="View Final Results Tab →"
            onUpdateFindings={handleUpdateFindings}
            onBackToCode={() => setCurrentStep(6)}
            onBackToPrompt={() => setCurrentStep(1)}
            onExport={() => setIsExportModalOpen(true)}
            onProceedToOptimization={() => setCurrentStep(8)}
            backendVerification={round2Verification || round1Verification}
            verificationError={null}
            isVerifying={isOptimizing}
          />
        )}
        {/* Step 8: Final Results Tab */}
        {currentStep === 8 && (
          <Step8FinalResults
            result={resultData}
            initialVerification={backendVerification}
            round1Verification={round1Verification}
            round2Verification={round2Verification}
            optimizationResult={optimizationResult}
            onStartNewPrompt={() => setCurrentStep(1)}
            onBackToVerification={() => setCurrentStep(round2Iteration ? 7 : 5)}
            onApplyFinalCode={handleApplyRepairedCode}
          />
        )}
      </main>

      <footer className="py-5 px-6 border-t border-[color:var(--color-hairline)] mt-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-[color:var(--color-ink-faint)]">
          <span>© {new Date().getFullYear()} Veriflow — Multi-Agent Code Intelligence</span>
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
      {hasGeneratedResult && (
        <PrintReport result={resultData} backendVerification={backendVerification} />
      )}
    </div>
  );
}

export default App;
