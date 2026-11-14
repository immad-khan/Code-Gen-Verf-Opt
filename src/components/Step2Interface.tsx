import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, RefreshCw, Sparkles, Terminal, FileCode2 } from 'lucide-react';
import { ApiSettings, InterfaceDefinition } from '../types';
import { extractInterface } from '../services/aiService';

interface Step2InterfaceProps {
  prompt: string;
  initialInterface?: InterfaceDefinition;
  apiSettings: ApiSettings;
  isBenchmarkProblem?: boolean;
  benchmarkId?: string;
  onConfirmInterface: (iface: InterfaceDefinition) => void;
  onBackToPrompt: () => void;
}

export const Step2Interface: React.FC<Step2InterfaceProps> = ({
  prompt,
  initialInterface,
  apiSettings,
  isBenchmarkProblem,
  benchmarkId,
  onConfirmInterface,
  onBackToPrompt,
}) => {
  const [name, setName] = useState(initialInterface?.name || '');
  const [signature, setSignature] = useState(initialInterface?.signature || '');
  const [docstring, setDocstring] = useState(initialInterface?.docstring || '');
  const isStdinStdout = initialInterface?.isStdinStdout || false;

  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  const handleReExtract = async () => {
    if (isBenchmarkProblem || isStdinStdout) return;
    setIsExtracting(true);
    setExtractError(null);
    try {
      const res = await extractInterface(prompt, apiSettings);
      setName(res.name);
      setSignature(res.signature);
      setDocstring(res.docstring);
    } catch (err: any) {
      setExtractError(err.message || 'Interface extraction failed.');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleProceed = () => {
    onConfirmInterface({
      name: name.trim(),
      signature: signature.trim(),
      docstring: docstring.trim(),
      isStdinStdout
    });
  };

  return (
    <div className="flex-1 w-full max-w-4xl mx-auto px-4 md:px-6 py-10 space-y-6 animate-fade-up">
      {/* Header */}
      <div className="card p-6 border border-[color:var(--color-hairline)] bg-[color:var(--color-surface-1)] rounded-2xl shadow-lg space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#7c3aed]/15 text-[#7c3aed] flex items-center justify-center font-bold text-sm">
              2
            </div>
            <div>
              <h2 className="text-lg font-bold text-[color:var(--color-ink)]">Target Interface Specification</h2>
              <p className="text-xs text-[color:var(--color-ink-muted)]">
                Confirmed before tests and code are generated. This defines the contract.
              </p>
            </div>
          </div>
          {isBenchmarkProblem && benchmarkId && (
            <span className="chip text-xs px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/30 font-mono">
              Dataset: {benchmarkId}
            </span>
          )}
        </div>
      </div>

      {extractError && (
        <div className="card p-4 border border-rose-500/30 bg-rose-500/10 text-rose-300 rounded-xl text-xs">
          {extractError}
        </div>
      )}

      {/* Contract Editor */}
      <div className="card p-6 border-2 border-[#7c3aed]/30 bg-[color:var(--color-surface-1)] rounded-2xl shadow-xl space-y-5">
        {isStdinStdout ? (
          /* APPS+ Standard I/O interface */
          <div className="p-5 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-3">
            <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
              <Terminal className="w-4 h-4" />
              <span>Standard Input / Output (CLI Program)</span>
            </div>
            <p className="text-xs text-amber-200/80 leading-relaxed">
              This APPS+ task interacts via standard input and standard output. Function signatures are skipped; the solution must read from <code className="bg-slate-900 px-1 py-0.5 rounded text-amber-300">sys.stdin</code> and output to <code className="bg-slate-900 px-1 py-0.5 rounded text-amber-300">sys.stdout</code> (or <code className="bg-slate-900 px-1 py-0.5 rounded text-amber-300">print()</code>).
            </p>
            <div className="p-3 bg-slate-950 rounded-lg text-xs font-mono text-emerald-400 border border-slate-800">
              Contract: read stdin, print stdout
            </div>
          </div>
        ) : (
          /* Function signature fields */
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[color:var(--color-ink-muted)] flex items-center gap-1.5">
                <FileCode2 className="w-4 h-4 text-[#7c3aed]" /> Python Contract Fields
              </span>
              {!isBenchmarkProblem && (
                <button
                  type="button"
                  onClick={handleReExtract}
                  disabled={isExtracting}
                  className="text-xs text-[color:var(--color-brand)] hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-40"
                >
                  <RefreshCw className={`w-3 h-3 ${isExtracting ? 'animate-spin' : ''}`} />
                  <span>Re-extract from Prompt</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[color:var(--color-ink)] mb-1">
                  Target Function Name (NAME)
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. solve_problem"
                  className="input-field w-full px-3 py-2 text-xs font-mono rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[color:var(--color-ink)] mb-1">
                  Signature Header (SIGNATURE)
                </label>
                <input
                  type="text"
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  placeholder="e.g. def solve_problem(nums: list[int]) -> int:"
                  className="input-field w-full px-3 py-2 text-xs font-mono rounded-lg"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[color:var(--color-ink)] mb-1">
                Contract Description (DOC)
              </label>
              <textarea
                value={docstring}
                onChange={(e) => setDocstring(e.target.value)}
                placeholder="One-line docstring specifying expected input types, output types, and behavior."
                rows={2}
                className="input-field w-full px-3 py-2 text-xs font-mono rounded-lg resize-none"
              />
            </div>
          </div>
        )}

        {/* Task prompt summary reference */}
        <div className="p-3 bg-[color:var(--color-surface-2)] rounded-xl border border-[color:var(--color-hairline)] space-y-1">
          <span className="text-[10px] uppercase font-bold text-[color:var(--color-ink-faint)] tracking-wider">
            Original Task Prompt
          </span>
          <pre className="text-xs font-mono text-[color:var(--color-ink-muted)] max-h-24 overflow-y-auto whitespace-pre-wrap">
            {prompt}
          </pre>
        </div>

        {/* Navigation Action Buttons */}
        <div className="pt-4 border-t border-[color:var(--color-hairline)] flex items-center justify-between">
          <button
            type="button"
            onClick={onBackToPrompt}
            className="px-4 py-2 text-xs font-semibold rounded-xl border border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)] text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface-3)] flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Step 1 (Prompt)</span>
          </button>

          <button
            type="button"
            onClick={handleProceed}
            className="btn-primary px-6 py-2.5 text-xs flex items-center gap-2 shadow-lg"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Confirm Interface & Proceed to Step 3 (Tests)</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
