import React, { useState, useEffect } from 'react';
import { ArrowLeft, ArrowRight, Lock, Unlock, ShieldCheck, AlertTriangle, AlertCircle, CheckCircle2, Play, RefreshCw, Sparkles, Hash, Eye } from 'lucide-react';
import { ApiSettings, InterfaceDefinition, LockedTestSuite } from '../types';
import { generateTests, validateTests, lockTests } from '../services/aiService';

interface StepTestsReviewProps {
  prompt: string;
  interfaceDef: InterfaceDefinition;
  apiSettings: ApiSettings;
  lockedTestSuite?: LockedTestSuite | null;
  isBenchmarkProblem?: boolean;
  benchmarkId?: string;
  onLockTests: (suite: LockedTestSuite) => void;
  onUnlockTests: () => void;
  onProceedToCode: () => void;
  onBackToInterface: () => void;
}

export const StepTestsReview: React.FC<StepTestsReviewProps> = ({
  prompt,
  interfaceDef,
  apiSettings,
  lockedTestSuite,
  isBenchmarkProblem,
  benchmarkId,
  onLockTests,
  onUnlockTests,
  onProceedToCode,
  onBackToInterface,
}) => {
  const [testCode, setTestCode] = useState<string>(lockedTestSuite?.testCode || '');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [rawGenerateResponse, setRawGenerateResponse] = useState<string | null>(null);
  const [showRawResponse, setShowRawResponse] = useState(false);

  // Validation state
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    testCount: number;
    warnings: string[];
    error?: string;
  } | null>(null);

  // Lock state
  const isLocked = lockedTestSuite?.isLocked ?? false;
  const currentHash = lockedTestSuite?.hash;
  const currentTestCount = lockedTestSuite?.testCount ?? 0;

  // Auto-generate tests on initial mount if freeform prompt and empty
  useEffect(() => {
    if (!isBenchmarkProblem && !testCode.trim() && !isLocked && !isGenerating) {
      handleAutoGenerate();
    }
  }, []);

  const handleAutoGenerate = async () => {
    setIsGenerating(true);
    setGenerateError(null);
    setRawGenerateResponse(null);
    try {
      const generated = await generateTests(prompt, interfaceDef, apiSettings);
      const clean = (generated || '').replace(/^\uFEFF/, '').trim();
      setTestCode(clean);
      // Run sanity check right away
      handleValidate(clean);
    } catch (err: any) {
      setGenerateError(err.message || 'Failed to generate tests.');
      setRawGenerateResponse(err.rawResponse || null);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleValidate = async (codeToValidate?: string) => {
    const code = codeToValidate ?? testCode;
    if (!code.trim() || isValidating) return;
    setIsValidating(true);
    try {
      const res = await validateTests(code, interfaceDef);
      setValidationResult(res);
    } catch (err: any) {
      setValidationResult({
        valid: false,
        testCount: 0,
        warnings: [],
        error: err.message || 'Docker validation check failed.'
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleLock = async () => {
    if (!testCode.trim() || isLocked) return;
    // Validate first if not already validated
    let count = validationResult?.testCount || 0;
    if (!validationResult || !validationResult.valid) {
      setIsValidating(true);
      try {
        const valRes = await validateTests(testCode, interfaceDef);
        setValidationResult(valRes);
        if (!valRes.valid) {
          setIsValidating(false);
          return;
        }
        count = valRes.testCount;
      } catch (err: any) {
        setValidationResult({ valid: false, testCount: 0, warnings: [], error: err.message });
        setIsValidating(false);
        return;
      }
      setIsValidating(false);
    }

    try {
      const res = await lockTests(testCode, count);
      onLockTests({
        testCode,
        hash: res.hash,
        testCount: res.testCount,
        isLocked: true,
        lockedAtUtc: res.lockedAtUtc,
        warnings: validationResult?.warnings
      });
    } catch (err: any) {
      setValidationResult(prev => ({
        valid: false,
        testCount: 0,
        warnings: prev?.warnings || [],
        error: err.message || 'Failed to lock tests.'
      }));
    }
  };

  const handleUnlockAndEdit = () => {
    onUnlockTests();
    setValidationResult(null);
  };

  return (
    <div className="flex-1 w-full max-w-5xl mx-auto px-4 md:px-6 py-10 space-y-6 animate-fade-up">
      {/* Step Header */}
      <div className="card p-6 border border-[color:var(--color-hairline)] bg-[color:var(--color-surface-1)] rounded-2xl shadow-lg space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#7c3aed]/15 text-[#7c3aed] flex items-center justify-center font-bold text-sm">
              3
            </div>
            <div>
              <h2 className="text-lg font-bold text-[color:var(--color-ink)]">Specification & Pytest Verification Tests</h2>
              <p className="text-xs text-[color:var(--color-ink-muted)]">
                Tests are generated from requirements & interface only (zero code access), then locked with SHA-256 integrity.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isLocked ? (
              <span className="chip text-xs px-3 py-1.5 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5 font-semibold">
                <Lock className="w-3.5 h-3.5" /> Tests Locked (Read-Only)
              </span>
            ) : (
              <span className="chip text-xs px-3 py-1.5 bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center gap-1.5 font-semibold">
                <Unlock className="w-3.5 h-3.5" /> Unlocked (Editable)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Lock SHA-256 Hash Display */}
      {isLocked && currentHash && (
        <div className="card p-4 border border-emerald-500/30 bg-emerald-500/5 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-mono text-xs text-emerald-300">
          <div className="flex items-center gap-2 truncate">
            <Hash className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-semibold text-emerald-200">Locked SHA-256:</span>
            <span className="truncate text-emerald-400">{currentHash}</span>
          </div>
          <span className="shrink-0 chip px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[11px]">
            {currentTestCount} tests verified
          </span>
        </div>
      )}

      {/* Generation Error banner */}
      {generateError && (
        <div className="card p-4 border border-rose-500/30 bg-rose-500/10 text-rose-300 rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400" />
              <span className="text-xs font-semibold">Test Generation Error</span>
            </div>
            {rawGenerateResponse && (
              <button
                type="button"
                onClick={() => setShowRawResponse(p => !p)}
                className="text-xs underline cursor-pointer"
              >
                {showRawResponse ? 'Hide Raw Response' : 'Show Raw Response'}
              </button>
            )}
          </div>
          <p className="text-xs">{generateError}</p>
          {showRawResponse && rawGenerateResponse && (
            <pre className="p-3 bg-slate-950 text-slate-200 text-xs rounded-lg overflow-auto max-h-48 border border-slate-800">
              {rawGenerateResponse}
            </pre>
          )}
        </div>
      )}

      {/* Validation Warnings / Errors */}
      {validationResult && (
        <div className="space-y-2">
          {validationResult.error && (
            <div className="card p-4 border border-rose-500/30 bg-rose-500/10 text-rose-300 rounded-xl text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Sanity Check Failed: </span>
                <span>{validationResult.error}</span>
              </div>
            </div>
          )}

          {validationResult.warnings && validationResult.warnings.length > 0 && (
            <div className="card p-4 border border-amber-500/30 bg-amber-500/10 text-amber-300 rounded-xl text-xs space-y-1">
              <div className="flex items-center gap-2 font-bold text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Stub Sanity Warning (Vacuous Tests Detected)</span>
              </div>
              <ul className="list-disc pl-5 space-y-1 text-amber-200/90 text-[11px]">
                {validationResult.warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
              <p className="text-[10px] text-amber-300/70 pt-1">
                Note: Tests that pass on the interface stub without calling the function may not exercise your implementation properly.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Test Code Editor / Viewer */}
      <div className="card p-5 border-2 border-[#7c3aed]/30 bg-[color:var(--color-surface-1)] rounded-2xl shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[color:var(--color-hairline)]">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[color:var(--color-ink-muted)]">
              test_solution.py (pytest suite)
            </span>
            {isBenchmarkProblem && (
              <span className="chip text-[10px] px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/30">
                Benchmark Preview
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!isBenchmarkProblem && !isLocked && (
              <button
                type="button"
                onClick={handleAutoGenerate}
                disabled={isGenerating}
                className="px-3 py-1.5 text-xs rounded-lg border border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)] text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface-3)] flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
                <span>Regenerate Tests</span>
              </button>
            )}

            {!isLocked && (
              <button
                type="button"
                onClick={() => handleValidate()}
                disabled={isValidating || !testCode.trim()}
                className="px-3 py-1.5 text-xs rounded-lg border border-[#7c3aed]/40 bg-[#7c3aed]/10 text-[#7c3aed] hover:bg-[#7c3aed]/20 flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
              >
                <ShieldCheck className={`w-3.5 h-3.5 ${isValidating ? 'animate-spin' : ''}`} />
                <span>Validate in Docker</span>
              </button>
            )}
          </div>
        </div>

        {/* Code Area */}
        <div className="relative">
          <textarea
            value={testCode}
            onChange={(e) => {
              if (!isLocked) {
                setTestCode(e.target.value);
                setValidationResult(null);
              }
            }}
            readOnly={isLocked}
            rows={14}
            placeholder="Writing pytest test functions (def test_...)..."
            className={`input-field w-full p-4 font-mono text-xs leading-relaxed resize-y ${
              isLocked
                ? 'bg-slate-950 text-emerald-300 border-emerald-500/30 cursor-not-allowed select-text'
                : 'bg-slate-950 text-slate-200 border-slate-800'
            }`}
          />
        </div>

        {/* Action Controls */}
        <div className="pt-4 border-t border-[color:var(--color-hairline)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <button
            type="button"
            onClick={onBackToInterface}
            className="px-4 py-2 text-xs font-semibold rounded-xl border border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)] text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface-3)] flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Step 2 (Interface)</span>
          </button>

          <div className="flex items-center gap-3 self-end sm:self-auto">
            {isLocked ? (
              <>
                {!isBenchmarkProblem && (
                  <button
                    type="button"
                    onClick={handleUnlockAndEdit}
                    className="px-4 py-2.5 text-xs font-semibold rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Unlock className="w-3.5 h-3.5" />
                    <span>Edit Tests (New Lock & New Run)</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={onProceedToCode}
                  className="btn-primary px-6 py-2.5 text-xs flex items-center gap-2 shadow-lg"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Proceed to Step 4 (Code Synthesis)</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleLock}
                disabled={isValidating || !testCode.trim()}
                className="btn-primary px-6 py-2.5 text-xs flex items-center gap-2 shadow-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500"
              >
                <Lock className="w-4 h-4" />
                <span>Lock Tests & Compute SHA-256</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
