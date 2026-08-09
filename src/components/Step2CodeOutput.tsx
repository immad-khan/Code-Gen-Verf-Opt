import React, { useState } from 'react';
import { AIResultData, GeneratedCodeFile } from '../types';
import { Code2, Check, Copy, Download, ArrowRight, ArrowLeft, RefreshCw, Server, Terminal, FolderTree } from 'lucide-react';
import { VisualFileTree } from './VisualFileTree';
import { PythonApiHarness } from './PythonApiHarness';

interface Step2CodeOutputProps {
  result: AIResultData;
  onProceedToVerification: () => void;
  onBackToPrompt: () => void;
  onRegenerate: () => void;
}

export const Step2CodeOutput: React.FC<Step2CodeOutputProps> = ({
  result,
  onProceedToVerification,
  onBackToPrompt,
  onRegenerate
}) => {
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<'tree' | 'code' | 'sandbox' | 'logs'>('tree');
  const [copied, setCopied] = useState(false);

  const activeFile: GeneratedCodeFile = result.generatedCode[activeFileIndex] || result.generatedCode[0];

  const handleCopyCode = () => {
    navigator.clipboard.writeText(activeFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadFile = () => {
    const blob = new Blob([activeFile.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFile.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const tabs = [
    { id: 'tree' as const, label: 'File Tree', Icon: FolderTree },
    { id: 'code' as const, label: 'Source', Icon: Code2 },
    { id: 'sandbox' as const, label: 'Sandbox', Icon: Server },
    { id: 'logs' as const, label: 'Agent Logs', Icon: Terminal },
  ];

  const stats: { label: string; value: string; warn?: boolean }[] = [
    { label: 'Generation time', value: `${(result.metrics.processingTimeMs / 1000).toFixed(1)}s` },
    { label: 'Files', value: String(result.generatedCode.length) },
  ];

  return (
    <div className="flex-1 max-w-6xl w-full mx-auto px-4 md:px-6 py-8 flex flex-col gap-6 animate-fade-up">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button onClick={onBackToPrompt} className="inline-flex items-center gap-1.5 text-xs text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)] transition mb-2 cursor-pointer">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to prompt
          </button>
          <h1 className="text-xl font-bold tracking-tight text-[color:var(--color-ink)]">Generated Python project</h1>
          <p className="text-sm text-[color:var(--color-ink-muted)] mt-0.5">
            FastAPI · Pydantic · pytest — ready to review, then audit.
          </p>
        </div>
        <button onClick={onProceedToVerification} className="btn-primary px-5 py-2.5 text-sm flex items-center gap-2">
          <span>View Verification</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="card-quiet p-4">
            <div className="eyebrow mb-1.5">{s.label}</div>
            <div className={`text-2xl font-bold tracking-tight tabular-nums ${s.warn ? 'text-amber-400' : 'text-[color:var(--color-ink)]'}`}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Workspace */}
      <div className="card overflow-hidden">
        {/* Tabs */}
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-b border-[color:var(--color-hairline)]">
          <div className="flex items-center gap-1 bg-[color:var(--color-surface-2)] rounded-xl p-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${activeTab === t.id
                    ? 'bg-[color:var(--color-surface-3)] text-[color:var(--color-ink)] shadow-sm'
                    : 'text-[color:var(--color-ink-faint)] hover:text-[color:var(--color-ink-muted)]'
                  }`}
              >
                <t.Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </div>

          {activeTab === 'code' && (
            <div className="flex items-center gap-1.5">
              <button onClick={handleCopyCode} className="btn-ghost px-2.5 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer">
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
              </button>
              <button onClick={handleDownloadFile} className="btn-ghost px-2.5 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer">
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Download</span>
              </button>
            </div>
          )}
        </div>

        {/* Tab: File tree */}
        {activeTab === 'tree' && (
          <div className="p-4 md:p-5">
            <VisualFileTree
              files={result.generatedCode}
              activeFileIndex={activeFileIndex}
              onSelectFile={(idx) => setActiveFileIndex(idx)}
            />
          </div>
        )}

        {/* Tab: Code */}
        {activeTab === 'code' && (
          <div className="flex flex-col">
            {activeFile?.description && (
              <div className="px-4 py-3 border-b border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)]/40">
                <span className="eyebrow text-[color:var(--color-brand-soft)]">What this file does</span>
                <p className="text-xs text-[color:var(--color-ink-muted)] mt-1 leading-relaxed">{activeFile.description}</p>
              </div>
            )}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-[color:var(--color-hairline)]">
              <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
              <span className="ml-2 text-xs font-mono text-[color:var(--color-ink-faint)]">{activeFile.path}</span>
            </div>
            <div className="p-4 font-mono text-xs overflow-x-auto max-h-[520px] bg-[#0a0b0f]">
              <table className="border-collapse">
                <tbody>
                  {activeFile.content.split('\n').map((line, idx) => (
                    <tr key={idx} className="hover:bg-white/[0.02]">
                      <td className="w-10 select-none text-[color:var(--color-ink-faint)]/60 text-right pr-4 py-[1px] align-top">{idx + 1}</td>
                      <td className="pl-4 py-[1px] whitespace-pre text-[color:var(--color-ink-muted)]">{line || ' '}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab: Sandbox */}
        {activeTab === 'sandbox' && (
          <div className="p-4 md:p-5">
            <PythonApiHarness />
          </div>
        )}

        {/* Tab: Logs */}
        {activeTab === 'logs' && (
          <div className="p-4 md:p-5 space-y-2.5">
            {result.agentLogs.map((log, idx) => (
              <div key={idx} className="card-quiet p-3.5 flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-[#7c6cff]/12 text-[color:var(--color-brand-soft)] flex items-center justify-center shrink-0 mt-0.5">
                    <Terminal className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-[color:var(--color-ink)]">{log.agentName}</span>
                      <span className="chip text-[10px] px-2 py-0.5">{log.role}</span>
                    </div>
                    <p className="text-xs text-[color:var(--color-ink-muted)] mt-0.5">{log.message}</p>
                  </div>
                </div>
                <span className="text-[10px] font-mono text-[color:var(--color-ink-faint)] shrink-0">{log.timestamp}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={onRegenerate} className="btn-ghost px-4 py-2.5 text-sm flex items-center gap-2 cursor-pointer">
          <RefreshCw className="w-4 h-4" /> Regenerate
        </button>
      </div>
    </div>
  );
};
