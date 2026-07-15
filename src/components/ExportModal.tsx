import React from 'react';
import { AIResultData } from '../types';
import { VerificationResponse } from '../services/verificationService';
import { X, Download, FileJson, Printer } from 'lucide-react';

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

  const options = [
    { onClick: handleDownloadJson, Icon: FileJson, iconClass: 'text-amber-400', title: 'Full session (JSON)', desc: 'Raw AI generation payload + C# execution check output' },
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
          <button onClick={onClose} className="btn-primary px-4 py-2 text-xs">Done</button>
        </div>
      </div>
    </div>
  );
};
