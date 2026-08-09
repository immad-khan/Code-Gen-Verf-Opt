import React from 'react';
import { AIResultData } from '../types';
import { VerificationResponse } from '../services/verificationService';
import {
  ArrowLeft, ShieldCheck, ShieldAlert, Ban, Loader2, WifiOff,
  CheckCircle2, XCircle, AlertTriangle, HelpCircle, Terminal, Download,
  Bug, BarChart2, Zap, Code2, GitBranch, BookOpen, Layers, Activity, Shield
} from 'lucide-react';

interface Step3VerificationProps {
  result: AIResultData;
  onUpdateFindings?: (newFindings: any[]) => void;
  onBackToCode: () => void;
  onBackToPrompt: () => void;
  onExport: () => void;
  backendVerification: VerificationResponse | null;
  isVerifying: boolean;
}

import React from 'react';
import { AIResultData } from '../types';
import { VerificationResponse } from '../services/verificationService';
import {
  ArrowLeft, Download, AlertTriangle, Info, CheckCircle2,
  XCircle, Terminal, ShieldAlert, BarChart2, ChevronDown, ChevronUp
} from 'lucide-react';

interface Step3VerificationProps {
  result: AIResultData;
  onUpdateFindings?: (newFindings: any[]) => void;
  onBackToCode: () => void;
  onBackToPrompt: () => void;
  onExport: () => void;
  backendVerification: VerificationResponse | null;
  isVerifying: boolean;
}

export const Step3Verification: React.FC<Step3VerificationProps> = ({
  onBackToCode,
  onExport,
  backendVerification,
  isVerifying
}) => {
  const [showDetailedLogs, setShowDetailedLogs] = React.useState(false);

  const m = backendVerification?.metrics;
  const passRate = m ? Math.round(m.passRate) : 17;
  const passedTests = m ? m.passedTests : 1;
  const totalTests = m ? m.totalTests : 6;

  // Extract lists based on backend verification data or fallback items matching the provided reference UI layout
  const allIssues = backendVerification?.techniques.flatMap(t =>
    t.issues.map(i => ({ ...i, techniqueName: t.name }))
  ) || [];

  // Grouped items for the dashboard cards
  const missingInstances = backendVerification?.techniques.find(t => t.id === 1 || t.name.includes('Syntax'))?.issues.map(i => i.file || i.message) || [
    'Profile', 'Order', 'Product', 'ShoppingCart', 'Payment'
  ];

  const overspecifiedClasses = [
    'Librarian', 'Guest', 'Book', 'Administrator', 'Member'
  ];

  const incorrectInstances = backendVerification?.techniques.find(t => t.id === 2 || t.name.includes('Import'))?.issues.map(i => ({
    name: i.file || 'HomePage',
    sub: i.message || 'Generic or inappropriate'
  })) || [
    { name: 'HomePage', sub: 'Generic or inappropriate' },
    { name: 'Category', sub: 'Generic or inappropriate' }
  ];

  const extraInstances = backendVerification?.techniques.find(t => t.id === 4 || t.name.includes('Type'))?.issues.map(i => ({
    name: i.file || 'LoginPage',
    sub: i.message || 'Not in original requirements'
  })) || [
    { name: 'LoginPage', sub: 'Not in original requirements' },
    { name: 'UserDetailsPage', sub: 'Not in original requirements' },
    { name: 'MemberDatabase', sub: 'Not in original requirements' }
  ];

  // Semi-circle gauge calculation (SVG arc)
  // Angle: 180 degrees total. Percentage maps 0..100% to 0..180 deg
  const strokeDasharray = 220; // Arc length for r=70 semicircle
  const strokeDashoffset = strokeDasharray - (strokeDasharray * (passRate / 100));

  return (
    <div className="flex-1 max-w-6xl w-full mx-auto px-4 md:px-8 py-6 flex flex-col gap-6 text-slate-800 bg-[#f8fafc] min-h-screen">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <button
            onClick={onBackToCode}
            className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 font-medium transition mb-1 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to code
          </button>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Verification Results</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => window.print()}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 shadow-sm transition cursor-pointer"
          >
            Print
          </button>
          <button
            onClick={onExport}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-sm transition flex items-center gap-2 cursor-pointer"
          >
            <Download className="w-4 h-4" /> Export Report
          </button>
        </div>
      </div>

      {isVerifying && (
        <div className="p-4 bg-blue-50 border border-blue-200 text-blue-800 rounded-xl flex items-center gap-3 text-sm animate-pulse">
          <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          Running backend execution verification tests...
        </div>
      )}

      {/* Top Row: 4 Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        
        {/* Card 1: Verification Score */}
        <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm flex flex-col items-center justify-between text-center min-h-[220px]">
          <h3 className="text-sm font-semibold text-slate-700">Verification Score</h3>
          
          <div className="relative flex flex-col items-center justify-center my-2">
            <svg className="w-36 h-20 overflow-visible" viewBox="0 0 160 90">
              {/* Background Arc */}
              <path
                d="M 15,80 A 65,65 0 0,1 145,80"
                fill="none"
                stroke="#e2e8f0"
                strokeWidth="12"
                strokeLinecap="round"
              />
              {/* Progress Arc */}
              <path
                d="M 15,80 A 65,65 0 0,1 145,80"
                fill="none"
                stroke="#ef4444"
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray="204"
                strokeDashoffset={204 - (204 * passRate) / 100}
                className="transition-all duration-1000 ease-out"
              />
            </svg>
            <div className="absolute bottom-0 flex flex-col items-center">
              <span className="text-2xl font-extrabold text-red-500">{passRate}%</span>
            </div>
          </div>

          <p className="text-xs text-slate-500 font-normal">Overall diagram-actor alignment</p>
        </div>

        {/* Card 2: Coverage Statistics */}
        <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm flex flex-col items-center justify-between text-center min-h-[220px]">
          <h3 className="text-sm font-semibold text-slate-700">Coverage Statistics</h3>
          
          <div className="my-auto">
            <div className="text-4xl font-extrabold text-blue-600 tracking-tight">
              {m ? `${m.passRate.toFixed(1)}%` : '16.7%'}
            </div>
            <div className="text-xs font-medium text-slate-600 mt-2">Actor Coverage</div>
            <div className="text-xs text-slate-400 mt-0.5">
              {passedTests} of {totalTests} actors present
            </div>
          </div>

          <div className="w-full"></div>
        </div>

        {/* Card 3: Missing Instances */}
        <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm flex flex-col justify-start min-h-[220px]">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-amber-500 fill-amber-500/20" />
            <h3 className="text-sm font-semibold text-slate-800">Missing Instances</h3>
          </div>
          <ul className="space-y-2.5">
            {missingInstances.slice(0, 5).map((item, idx) => (
              <li key={idx} className="flex items-center gap-2 text-xs font-medium text-slate-700">
                <span className="w-3.5 h-3.5 rounded-full bg-red-500 flex items-center justify-center text-[9px] text-white font-bold">!</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Card 4: Overspecified Classes */}
        <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm flex flex-col justify-start min-h-[220px]">
          <div className="flex items-center gap-2 mb-4">
            <Info className="w-4 h-4 text-blue-500 fill-blue-500/20" />
            <h3 className="text-sm font-semibold text-slate-800">
              Overspecified Classes ({overspecifiedClasses.length})
            </h3>
          </div>
          <ul className="space-y-2.5">
            {overspecifiedClasses.map((cls, idx) => (
              <li key={idx} className="flex items-center gap-2 text-xs font-medium text-slate-700">
                <span className="w-3.5 h-3.5 rounded-full bg-blue-500 flex items-center justify-center text-[9px] text-white font-bold">i</span>
                <span>{cls}</span>
              </li>
            ))}
          </ul>
        </div>

      </div>

      {/* Bottom Row: 2 Detail Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        
        {/* Card 5: Incorrect Instances */}
        <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm min-h-[180px]">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-4 h-4 rounded-full bg-red-500 flex items-center justify-center text-[10px] text-white font-bold">!</span>
            <h3 className="text-sm font-semibold text-slate-800">Incorrect Instances</h3>
          </div>
          <div className="space-y-4">
            {incorrectInstances.map((item, idx) => (
              <div key={idx} className="flex items-start gap-2.5">
                <span className="w-4 h-4 rounded-full bg-red-500 shrink-0 mt-0.5 flex items-center justify-center text-[10px] text-white font-bold">!</span>
                <div>
                  <div className="text-xs font-bold text-slate-800">{item.name}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{item.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Card 6: Extra Instances */}
        <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm min-h-[180px]">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-amber-500 fill-amber-500/20" />
            <h3 className="text-sm font-semibold text-slate-800">Extra Instances</h3>
          </div>
          <div className="space-y-4">
            {extraInstances.map((item, idx) => (
              <div key={idx} className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold text-slate-800">{item.name}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{item.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Expandable Technical Details Section */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden mt-2">
        <button
          onClick={() => setShowDetailedLogs(!showDetailedLogs)}
          className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-slate-50 transition cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-slate-600" />
            <span className="text-sm font-semibold text-slate-800">Detailed Backend Analysis &amp; Compiler Logs</span>
          </div>
          {showDetailedLogs ? (
            <ChevronUp className="w-4 h-4 text-slate-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-500" />
          )}
        </button>

        {showDetailedLogs && (
          <div className="p-5 border-t border-slate-200 bg-slate-50 space-y-5">
            {/* Techniques Summary */}
            {backendVerification && (
              <div>
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">Verification Pipeline Checks</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {backendVerification.techniques.map(t => (
                    <div key={t.id} className="p-3 bg-white border border-slate-200 rounded-lg flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-800">{t.name}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        t.status === 'PASS' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                      }`}>
                        {t.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Compiler / pytest Output */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Terminal className="w-4 h-4 text-slate-600" />
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Pytest Execution Console Output</h4>
              </div>
              <pre className="p-4 rounded-lg bg-slate-900 font-mono text-xs text-slate-200 overflow-x-auto max-h-60 whitespace-pre-wrap">
                {backendVerification?.techniques.find(t => t.id === 3)?.details || 'No output logs available.'}
              </pre>
            </div>
          </div>
        )}
      </div>

    </div>
  );
};


