import { useState, useEffect } from 'react';
import { PipelineStep, AIResultData, ApiSettings, AgentLog, PythonAuditFinding, OptimizationResponse, GeneratedCodeFile, InterfaceDefinition, LockedTestSuite, CompareRepairResponse, ImprovedRepairSources } from './types';
import { processPromptWithAgents, generateCodeFromBackend } from './services/aiService';
import { analyzePythonCode } from './analyzer';
import { runBackendVerification, VerificationResponse } from './services/verificationService';
import { runBackendOptimization, runCompareOptimization } from './services/optimizationService';
import { Header } from './components/Header';
import { PipelineNav } from './components/PipelineNav';
import { Step1Input } from './components/Step1Input';
import { Step2Interface } from './components/Step2Interface';
import { StepTestsReview } from './components/StepTestsReview';
import { Step2CodeOutput } from './components/Step2CodeOutput';
import { Step3Verification } from './components/Step3Verification';
import { Step4Optimization } from './components/Step4Optimization';
import { Step8FinalResults } from './components/Step8FinalResults';
import { ProcessingOverlay } from './components/ProcessingOverlay';
import { ExportModal } from './components/ExportModal';
import { ApiSettingsModal } from './components/ApiSettingsModal';
import { PrintReport } from './components/PrintReport';
import { LeftNavbar } from './components/LeftNavbar';
import { HistoryPage, type HistoryItem } from './components/HistoryPage';
import { ProfilePage } from './components/ProfilePage';
import LandingPage from '../landing_page/src/App';
import { clearSession, getSession, type SessionUser } from '../landing_page/src/auth';
import '../landing_page/src/index.css';

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
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(() => getSession());

  useEffect(() => {
    setCurrentUser(getSession());
  }, [showLanding]);

  const [currentStep, setCurrentStep] = useState<PipelineStep>(1);
  const [prompt, setPrompt] = useState<string>(DEFAULT_PROMPT);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentLog, setCurrentLog] = useState<AgentLog | null>(null);
  const [allLogs, setAllLogs] = useState<AgentLog[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rawErrorResponse, setRawErrorResponse] = useState<string | null>(null);

  const temperature = 0.1;
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  type ActiveView = 'pipeline' | 'history' | 'profile';
  const [activeView, setActiveView] = useState<ActiveView>('pipeline');
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>(() => {
    try {
      const raw = localStorage.getItem('veriflow_history');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const handleSelectHistoryPrompt = (selectedPrompt: string) => {
    setPrompt(selectedPrompt);
    setCurrentStep(1);
    setActiveView('pipeline');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleClearHistory = () => {
    setHistoryItems([]);
    try {
      localStorage.removeItem('veriflow_history');
    } catch {}
  };

  const handleDeleteHistoryItem = (id: string) => {
    setHistoryItems(prev => {
      const next = prev.filter(item => item.id !== id);
      try {
        localStorage.setItem('veriflow_history', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const handleUserUpdated = (updatedUser: SessionUser) => {
    setCurrentUser(updatedUser);
  };

  const [resultData, setResultData] = useState<AIResultData>(createInitialResultData());
  const [hasGeneratedResult, setHasGeneratedResult] = useState(false);
  const [apiSettings, setApiSettings] = useState<ApiSettings>(loadSettings);
  const [backendVerification, setBackendVerification] = useState<VerificationResponse | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResponse | null>(null);
  const [compareResult, setCompareResult] = useState<CompareRepairResponse | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [confirmedInterface, setConfirmedInterface] = useState<InterfaceDefinition | null>(null);
  const [lockedTestSuite, setLockedTestSuite] = useState<LockedTestSuite | null>(null);
  const [benchmarkInfo, setBenchmarkInfo] = useState<{ benchmark: string; problemId: string } | null>(null);

  // Intercept navigation to the app from the landing page
  const handleLandingClick = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest('a, button');
    if (target) {
      const href = target.getAttribute('href') || '';
      const text = target.textContent?.toLowerCase() || '';
      if (
        href === '#app' ||
        text.includes('open veriflow') ||
        text.includes('continue to veriflow')
      ) {
        e.preventDefault();
        setShowLanding(false);
        window.location.hash = '#app';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  };

  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash === '#app' || window.location.hash === '#pipeline') {
        setShowLanding(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (
        window.location.hash === '#landing' ||
        window.location.hash === '#auth' ||
        window.location.hash === '#verified' ||
        !window.location.hash
      ) {
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

  const handleProcessQuery = async (confirmedInterface?: InterfaceDefinition) => {
    if (!prompt.trim()) return;
    setIsProcessing(true);
    setProgress(5);
    setAllLogs([]);
    setCurrentLog(null);
    setErrorMessage(null);
    setRawErrorResponse(null);
    setOptimizationResult(null);
    setCompareResult(null);

    try {
      let codeFiles: GeneratedCodeFile[] = [];
      try {
        codeFiles = await generateCodeFromBackend(prompt, apiSettings, confirmedInterface);
      } catch (backendErr: any) {
        if (backendErr.rawResponse) {
          setRawErrorResponse(backendErr.rawResponse);
          throw backendErr;
        }
        console.warn('Backend generation failed, trying browser agent:', backendErr);
        const data = await processPromptWithAgents(prompt, apiSettings, (pct, log) => {
          setProgress(pct);
          setCurrentLog(log);
          setAllLogs(prev => [...prev, log]);
        }, temperature);
        codeFiles = data.generatedCode;
      }

      // Check if LLM returned an error (non-code request)
      if (!codeFiles || codeFiles.length === 0) {
        setErrorMessage('I can only generate Python code. Please describe a Python project or program you would like me to create.');
        setIsProcessing(false);
        return;
      }

      // Run client-side code quality analysis (patterns, style, security hints)
      const analysis = analyzePythonCode(codeFiles);

      const baseResult = createInitialResultData();
      const enriched: AIResultData = {
        ...baseResult,
        prompt,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        modelUsed: `${apiSettings.provider.toUpperCase()} · ${apiSettings.model}`,
        generatedCode: codeFiles,
        findings: analysis.findings,
        techniqueMatrix: analysis.techniqueMatrix,
        securityChecklist: analysis.securityChecklist,
        executiveSummary: {
          ...baseResult.executiveSummary,
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
          ...baseResult.metrics,
          linterWarnings: analysis.findings.filter(f => f.severity === 'LOW').length,
          securityVulnerabilitiesCount: analysis.findings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH').length,
        },
      };

      const fileNames = codeFiles.map(f => f.name).join(', ');
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

      // Record to history
      const newHistoryItem: HistoryItem = {
        id: Date.now().toString(),
        prompt: prompt.trim(),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }),
        provider: apiSettings.provider,
        model: apiSettings.model,
        verdict: enriched.mergeGate.verdict === 'APPROVED' ? 'Verified ✓' : 'Analyzed',
      };
      setHistoryItems(prev => {
        const next = [newHistoryItem, ...prev.filter(p => p.prompt !== prompt.trim())].slice(0, 30);
        try { localStorage.setItem('veriflow_history', JSON.stringify(next)); } catch {}
        return next;
      });

      setCurrentStep(4);
      setIsProcessing(false);

      // Run real backend verification in background (AST, imports, pytest, runtime, mypy)
      setIsVerifying(true);
      setBackendVerification(null);
      setVerificationError(null);
      runBackendVerification(codeFiles, lockedTestSuite?.hash)
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
      const verification = await runBackendVerification(resultData.generatedCode, lockedTestSuite?.hash);
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

  const handleRunOptimization = async (
    mode: 'dou' | 'improved' | 'compare' = 'dou',
    sources?: ImprovedRepairSources
  ) => {
    if (!resultData?.generatedCode || resultData.generatedCode.length === 0) return;
    setIsOptimizing(true);
    try {
      if (mode === 'compare') {
        const compRes = await runCompareOptimization({
          files: resultData.generatedCode,
          originalPrompt: prompt,
          apiSettings,
          verificationResult: backendVerification,
          maxIterations: 2,
          lockedTestHash: lockedTestSuite?.hash,
          improvedSources: sources,
        });
        setCompareResult(compRes);
        setOptimizationResult(compRes.improvedResult);
      } else {
        setCompareResult(null);
        const res = await runBackendOptimization({
          files: resultData.generatedCode,
          originalPrompt: prompt,
          apiSettings,
          verificationResult: backendVerification,
          maxIterations: 2,
          lockedTestHash: lockedTestSuite?.hash,
          mode,
          improvedSources: sources,
        });
        setOptimizationResult(res);
      }
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
    ? 6
    : backendVerification
    ? 6
    : hasGeneratedResult
    ? 5
    : lockedTestSuite?.isLocked
    ? 4
    : confirmedInterface
    ? 3
    : 2;

  const handleSignOut = () => {
    clearSession();
    setCurrentUser(null);
    setShowLanding(true);
    window.location.hash = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (showLanding) {
    return (
      <div onClickCapture={handleLandingClick}>
        <LandingPage />
      </div>
    );
  }

  return (
    <div className="app-shell min-h-screen text-[color:var(--color-ink)] font-sans flex flex-col antialiased selection:bg-[#7c3aed] selection:text-white">
      <Header
        hasApiKey={hasApiKey}
        user={currentUser}
        apiSettings={apiSettings}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onSignOut={handleSignOut}
        onGoToLanding={() => {
          if (activeView !== 'pipeline') {
            setActiveView('pipeline');
          } else {
            setShowLanding(true);
            window.location.hash = '';
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        }}
      />
      {activeView === 'pipeline' && (
        <PipelineNav
          currentStep={currentStep}
          onSelectStep={(step) => setCurrentStep(step)}
          hasResult={hasGeneratedResult}
          maxUnlockedStep={maxUnlockedStep}
        />
      )}

      {activeView === 'pipeline' && (
        <main className="flex-1 flex flex-col justify-start">
        {/* Step 1: Prompt / Benchmark Picker */}
        {currentStep === 1 && (
          <Step1Input
            prompt={prompt}
            onPromptChange={(newPrompt) => {
              setPrompt(newPrompt);
              setBenchmarkInfo(null);
              setConfirmedInterface(null);
              setLockedTestSuite(null);
              setHasGeneratedResult(false);
            }}
            onProceedToInterface={(iface) => {
              setConfirmedInterface(iface);
              setCurrentStep(2);
            }}
            onSelectBenchmarkProblem={(payload) => {
              setPrompt(payload.prompt);
              setConfirmedInterface(payload.interface);
              setLockedTestSuite(payload.lockedTestSuite);
              setBenchmarkInfo({ benchmark: payload.benchmark, problemId: payload.problemId });
              setCurrentStep(3);
            }}
            isProcessing={isProcessing}
            apiSettings={apiSettings}
            errorMessage={errorMessage}
            rawErrorResponse={rawErrorResponse}
          />
        )}

        {/* Step 2: Interface Contract Review (NAME, SIGNATURE, DOC, or stdin/stdout) */}
        {currentStep === 2 && (
          <Step2Interface
            prompt={prompt}
            initialInterface={confirmedInterface || undefined}
            apiSettings={apiSettings}
            isBenchmarkProblem={Boolean(benchmarkInfo)}
            benchmarkId={benchmarkInfo?.problemId}
            onConfirmInterface={(iface) => {
              setConfirmedInterface(iface);
              setCurrentStep(3);
            }}
            onBackToPrompt={() => setCurrentStep(1)}
          />
        )}

        {/* Step 3: Pytest Tests Review & Lock (SHA-256 integrity, Docker sanity checks) */}
        {currentStep === 3 && (
          <StepTestsReview
            prompt={prompt}
            interfaceDef={confirmedInterface || { name: 'solution', signature: 'def solution(*args, **kwargs):', docstring: '', isStdinStdout: false }}
            apiSettings={apiSettings}
            lockedTestSuite={lockedTestSuite}
            isBenchmarkProblem={Boolean(benchmarkInfo)}
            benchmarkId={benchmarkInfo?.problemId}
            onLockTests={(suite) => {
              setLockedTestSuite(suite);
            }}
            onUnlockTests={() => {
              setLockedTestSuite(null);
              setHasGeneratedResult(false);
            }}
            onProceedToCode={async () => {
              setCurrentStep(4);
              if (!hasGeneratedResult && !isProcessing) {
                await handleProcessQuery(confirmedInterface || undefined);
              }
            }}
            onBackToInterface={() => setCurrentStep(2)}
          />
        )}

        {/* Step 4: Code Synthesis (Prompt + Interface only, never tests; fenced code blocks) */}
        {currentStep === 4 && (
          <Step2CodeOutput
            result={resultData}
            onProceedToVerification={() => {
              if (!backendVerification && !isVerifying && resultData.generatedCode.length > 0) {
                handleRetryVerification();
              }
              setCurrentStep(5);
            }}
            onBackToPrompt={() => setCurrentStep(3)}
            onRegenerate={() => handleProcessQuery(confirmedInterface || undefined)}
          />
        )}

        {/* Step 5: Verification (Round 0 Diagnostics against locked tests) */}
        {currentStep === 5 && (
          <Step3Verification
            result={resultData}
            title="Verification (Round 0 Diagnostics)"
            stepBadge="Step 5 · Multi-Check Verification"
            backButtonLabel="Back to Code"
            nextButtonLabel="Proceed to Step 6 (Repair) →"
            onUpdateFindings={handleUpdateFindings}
            onBackToCode={() => setCurrentStep(4)}
            onBackToPrompt={() => setCurrentStep(1)}
            onExport={() => setIsExportModalOpen(true)}
            onProceedToOptimization={async () => {
              if (!optimizationResult && !isOptimizing) {
                await handleRunOptimization();
              }
              setCurrentStep(6);
            }}
            backendVerification={backendVerification}
            verificationError={verificationError}
            isVerifying={isVerifying}
            onRetryVerification={handleRetryVerification}
          />
        )}

        {/* Step 6: Repair & Comparison Pipeline (Dou / Improved / Compare modes, R1 & R2) */}
        {currentStep === 6 && (
          <Step4Optimization
            result={resultData}
            backendVerification={backendVerification}
            optimizationResult={optimizationResult}
            compareResult={compareResult}
            isOptimizing={isOptimizing}
            onRunOptimization={handleRunOptimization}
            onBackToVerification={() => setCurrentStep(5)}
            onApplyRepairedCode={handleApplyRepairedCode}
            title="Repair & Comparison Pipeline"
            stepBadge="Step 6 · Automated Synthesis Repair"
            apiSettings={apiSettings}
          />
        )}
      </main>
      )}

      {activeView === 'history' && (
        <HistoryPage
          history={historyItems}
          onSelectPrompt={handleSelectHistoryPrompt}
          onClearHistory={handleClearHistory}
          onDeleteHistoryItem={handleDeleteHistoryItem}
          onBackToPipeline={() => setActiveView('pipeline')}
        />
      )}

      {activeView === 'profile' && (
        <ProfilePage
          user={currentUser}
          apiSettings={apiSettings}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onSignOut={handleSignOut}
          onBackToPipeline={() => setActiveView('pipeline')}
          onUserUpdated={handleUserUpdated}
        />
      )}

      <footer className="py-5 px-6 border-t border-[color:var(--color-hairline)] mt-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-[color:var(--color-ink-faint)]">
          <span>© {new Date().getFullYear()} Veriflow — Multi-Agent Code Intelligence</span>
          <span className="font-mono">
            {hasApiKey ? `Using ${apiSettings.provider.toUpperCase()} · ${apiSettings.model}` : 'Please configure an API key to generate code'}
          </span>
        </div>
      </footer>

      {/* Floating Left Navbar */}
      <LeftNavbar
        activeView={activeView}
        onNavigate={setActiveView}
      />

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
