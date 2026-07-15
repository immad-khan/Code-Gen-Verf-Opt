import React, { useState } from 'react';
import { AIResultData } from '../types';
import { VerificationResponse } from '../services/verificationService';
import { X, Download, FileJson, FileText, Printer, Check, Copy } from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  result: AIResultData;
  backendVerification: VerificationResponse | null;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  result,
  backendVerification
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleDownloadJson = () => {
    const exportPayload = {
      ai_result: result,
      verification_result: backendVerification
    };
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportPayload, null, 2));
    const a = document.createElement('a');
    a.setAttribute('href', dataStr);
    a.setAttribute('download', `MACI_Verification_Report_${Date.now()}.json`);
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const getMarkdownText = () => {
    const verdict = backendVerification?.overallVerdict || 'UNVERIFIED';
    const duration = backendVerification?.totalDurationMs ?? 0;
    const passed = backendVerification?.totalPassed ?? 0;
    const total = backendVerification?.techniques?.length ?? 5;

    return `# MACI Execution & Verification Report

## Metadata
- **Prompt:** ${result.prompt}
- **Model Used:** ${result.modelUsed}
- **Timestamp:** ${result.timestamp}

## Verification Summary
- **Overall Verdict:** ${verdict}
- **Verification Duration:** ${duration}ms
- **Passed Checks:** ${passed} / ${total}

## Verification Techniques Details
${backendVerification ? backendVerification.techniques.map(t => {
  let issuesMd = '';
  if (t.issues.length > 0) {
    issuesMd = '\n\n**Issues Found:**\n' + t.issues.map(i => `* ${i.file ? `${i.file}${i.line ? `:${i.line}` : ''} - ` : ''}${i.message}`).join('\n');
  }
  return `### [${t.status}] ${t.name}
- **Status:** ${t.status}
- **Duration:** ${t.durationMs}ms
- **Details:** ${t.details}${issuesMd}
`;
}).join('\n') : '*No backend verification data available.*'}

## pytest Execution Terminal Logs
\`\`\`
${backendVerification?.techniques.find(t => t.id === 3)?.details || 'No pytest output available.'}
\`\`\`

## Generated Python Code
${result.generatedCode.map(file => `
### File: ${file.path || file.name}
*Category: ${file.category || 'other'} · Description: ${file.description || 'No description'}*

\`\`\`python
${file.content}
\`\`\`
`).join('\n\n')}
`;
  };

  const handleDownloadMarkdown = () => {
    const blob = new Blob([getMarkdownText()], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MACI_Verification_Report_${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyMarkdown = () => {
    navigator.clipboard.writeText(getMarkdownText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const options = [
    { onClick: handleDownloadJson, Icon: FileJson, iconClass: 'text-amber-400', title: 'Full session (JSON)', desc: 'Raw AI generation payload + C# execution check output' },
    { onClick: handleDownloadMarkdown, Icon: FileText, iconClass: 'text-sky-400', title: 'Verification report (Markdown)', desc: 'Formatted docs detailing python execution status' },
    { onClick: () => window.print(), Icon: Printer, iconClass: 'text-emerald-400', title: 'Print / Save PDF', desc: 'Browser print dialog for verification records' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b0c10]/80 backdrop-blur-md p-4" onClick={onClose}>
      <div className="card max-w-md w-full p-6 relative animate-fade-up" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-[color:var(--color-ink-faint)] hover:text-[color:var(--color-ink)] transition cursor-pointer">
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-[#7c6cff]/12 text-[color:var(--color-brand-soft)] flex items-center justify-center">
            <Download className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-[color:var(--color-ink)] text-base">Export report package</h3>
            <p className="text-xs text-[color:var(--color-ink-muted)]">Python code &amp; execution check details</p>
          </div>
        </div>

        <div className="space-y-2.5 mb-5">
          {options.map((opt, i) => (
            <button key={i} onClick={opt.onClick} className="card-quiet w-full p-3.5 text-left flex items-center justify-between hover:border-[#33384a] transition group cursor-pointer">
              <div className="flex items-center gap-3">
                <opt.Icon className={`w-5 h-5 ${opt.iconClass}`} />
                <div>
                  <div className="font-medium text-[color:var(--color-ink)] text-sm">{opt.title}</div>
                  <div className="text-[11px] text-[color:var(--color-ink-faint)]">{opt.desc}</div>
                </div>
              </div>
              <Download className="w-4 h-4 text-[color:var(--color-ink-faint)] group-hover:text-[color:var(--color-brand-soft)]" />
            </button>
          ))}
        </div>

        <div className="flex gap-2 justify-end border-t border-[color:var(--color-hairline)] pt-4">
          <button onClick={handleCopyMarkdown} className="btn-ghost px-3 py-2 text-xs flex items-center gap-1.5 cursor-pointer">
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy Markdown'}</span>
          </button>
          <button onClick={onClose} className="btn-primary px-4 py-2 text-xs">Done</button>
        </div>
      </div>
    </div>
  );
};
