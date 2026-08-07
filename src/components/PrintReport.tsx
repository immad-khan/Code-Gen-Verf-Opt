import React from 'react';
import { AIResultData } from '../types';
import { VerificationResponse } from '../services/verificationService';

interface PrintReportProps {
  result: AIResultData;
  backendVerification: VerificationResponse | null;
}

export const PrintReport: React.FC<PrintReportProps> = ({ result, backendVerification }) => {
  const m = backendVerification?.metrics;
  const overallVerdict = backendVerification?.overallVerdict ?? 'UNVERIFIED';

  return (
    <div className="print-report-container bg-white text-gray-900 p-8 font-sans">
      {/* Cover / Header Section */}
      <div className="border-b-4 border-indigo-600 pb-6 mb-8">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">MACI Audit Report</h1>
            <p className="text-sm text-gray-500 mt-1">Multi-Agent Code Intelligence &amp; Verification Pipeline</p>
          </div>
          <div className="text-right">
            <span className={`inline-block px-3 py-1 text-xs font-bold rounded-full ${
              overallVerdict === 'PASS' ? 'bg-emerald-100 text-emerald-800'
              : overallVerdict === 'FAIL' ? 'bg-rose-100 text-rose-800'
              : 'bg-amber-100 text-amber-800'
            }`}>
              VERDICT: {overallVerdict}
            </span>
            <p className="text-xs text-gray-400 mt-1">{result.timestamp || new Date().toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* SECTION 1: AUDIT PROMPT */}
      <div className="mb-8 page-break-inside-avoid">
        <h2 className="text-lg font-bold text-indigo-700 border-b border-gray-200 pb-1 mb-3">1. Audit Request &amp; Prompt</h2>
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1">User Prompt Input:</p>
          <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{result.prompt || "No prompt provided."}</p>
          <div className="mt-4 pt-3 border-t border-gray-200 flex gap-6 text-xs text-gray-500">
            <div>
              <span className="font-semibold text-gray-700">Model Used:</span> {result.modelUsed || "Auto"}
            </div>
            {backendVerification && (
              <div>
                <span className="font-semibold text-gray-700">Audit Duration:</span> {backendVerification.totalDurationMs}ms
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 2: VERIFICATION RESULTS */}
      <div className="mb-8 page-break-inside-avoid">
        <h2 className="text-lg font-bold text-indigo-700 border-b border-gray-200 pb-1 mb-3">2. Execution Verification &amp; Code Quality</h2>
        
        {/* Verification Metrics Grid */}
        {m ? (
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
              <span className="text-[10px] text-gray-500 uppercase font-semibold block">Test Pass Rate</span>
              <span className="text-lg font-extrabold text-gray-900">{m.passRate}%</span>
              <span className="text-[10px] text-gray-400 block">{m.passedTests} / {m.totalTests} tests passed</span>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
              <span className="text-[10px] text-gray-500 uppercase font-semibold block">Maintainability Index</span>
              <span className="text-lg font-extrabold text-gray-900">{m.maintainabilityIndex >= 0 ? m.maintainabilityIndex.toFixed(1) : 'N/A'}</span>
              <span className="text-[10px] text-gray-400 block">/ 100 (Radon MI)</span>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
              <span className="text-[10px] text-gray-500 uppercase font-semibold block">Security Findings</span>
              <span className="text-lg font-extrabold text-gray-900">{m.semgrepFindingCount >= 0 ? m.semgrepFindingCount : 0}</span>
              <span className="text-[10px] text-gray-400 block">Semgrep findings</span>
            </div>
          </div>
        ) : (
          <div className="text-xs text-gray-500 italic mb-4">No metrics available.</div>
        )}

        {/* Individual Verification Techniques */}
        {backendVerification ? (
          <div className="space-y-3 mb-6">
            {backendVerification.techniques.map((t) => {
              const isPass = t.status === 'PASS';
              const isFail = t.status === 'FAIL';
              let displayDetails = t.details;
              if (t.id === 6) {
                try {
                  const parsed = JSON.parse(t.details);
                  displayDetails = parsed.summary ?? t.details;
                } catch { /* keep raw */ }
              }
              return (
                <div key={t.id} className="p-3 bg-white rounded-lg border border-gray-200 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-gray-900 block">{t.name}</span>
                    <span className="text-[11px] text-gray-500">{displayDetails}</span>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    isPass ? 'bg-emerald-100 text-emerald-800'
                    : isFail ? 'bg-rose-100 text-rose-800'
                    : 'bg-amber-100 text-amber-800'
                  }`}>
                    {t.status}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-gray-500 italic mb-6">Execution verification results unavailable.</div>
        )}

        {/* Verification Issues */}
        {backendVerification && backendVerification.techniques.some(t => t.issues.length > 0) && (
          <div className="mt-4">
            <h3 className="text-xs uppercase tracking-wider font-bold text-gray-700 mb-2">Flagged Execution Issues</h3>
            <div className="space-y-3">
              {backendVerification.techniques.flatMap(t => t.issues).map((issue, idx) => (
                <div key={idx} className="p-3 bg-red-50/50 rounded-lg border border-red-200 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-800">
                      {issue.severity}
                    </span>
                    {issue.file && (
                      <span className="text-[11px] font-mono text-gray-700">
                        {issue.file}{issue.line ? `:${issue.line}` : ''}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-mono text-gray-800 whitespace-pre-wrap leading-relaxed">{issue.message}</p>
                  {issue.codeSnippet && (
                    <pre className="mt-2 p-2 bg-gray-900 text-gray-100 text-[10px] font-mono rounded overflow-x-auto leading-relaxed border border-gray-800">
                      {issue.codeSnippet}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* SECTION 3: GENERATED CODE */}
      <div className="page-break-before">
        <h2 className="text-lg font-bold text-indigo-700 border-b border-gray-200 pb-1 mb-4">3. Generated Program Files &amp; Implementation</h2>
        <div className="space-y-6">
          {result.generatedCode && result.generatedCode.length > 0 ? (
            result.generatedCode.map((file, idx) => (
              <div key={idx} className="space-y-2 page-break-inside-avoid">
                <div className="flex justify-between items-center bg-gray-100 px-3 py-1.5 rounded border border-gray-200">
                  <span className="text-xs font-bold text-gray-800 font-mono">{file.path}</span>
                  <span className="text-[10px] text-gray-500 uppercase font-semibold">{file.category}</span>
                </div>
                {file.description && (
                  <p className="text-[11px] text-gray-600 leading-relaxed italic">{file.description}</p>
                )}
                <pre className="p-4 bg-gray-50 text-gray-800 text-xs font-mono rounded border border-gray-200 overflow-x-auto leading-relaxed whitespace-pre">
                  <code>{file.content}</code>
                </pre>
              </div>
            ))
          ) : (
            <div className="text-xs text-gray-500 italic">No generated files available.</div>
          )}
        </div>
      </div>
    </div>
  );
};
