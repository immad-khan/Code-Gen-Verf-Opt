import React, { useState } from 'react';
import { AIResultData, PythonAuditFinding, SeverityLevel } from '../types';
import {
  ChevronDown, Search, ShieldCheck, Download, ArrowLeft, ShieldAlert,
  CheckCircle2, XCircle, Copy, Check, Terminal, Package, FlaskConical, Bug, Ban
} from 'lucide-react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar
} from 'recharts';

interface Step3VerificationProps {
  result: AIResultData;
  onUpdateFindings: (newFindings: PythonAuditFinding[]) => void;
  onBackToCode: () => void;
  onBackToPrompt: () => void;
  onExport: () => void;
}

const SEV_META: Record<SeverityLevel, { label: string; dot: string; text: string; soft: string }> = {
  CRITICAL: { label: 'Critical', dot: 'bg-rose-500', text: 'text-rose-400', soft: 'bg-rose-500/10 border-rose-500/25 text-rose-400' },
  HIGH: { label: 'High', dot: 'bg-orange-500', text: 'text-orange-400', soft: 'bg-orange-500/10 border-orange-500/25 text-orange-400' },
  MEDIUM: { label: 'Medium', dot: 'bg-amber-500', text: 'text-amber-400', soft: 'bg-amber-500/10 border-amber-500/25 text-amber-400' },
  LOW: { label: 'Low', dot: 'bg-emerald-500', text: 'text-emerald-400', soft: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400' },
};

export const Step3Verification: React.FC<Step3VerificationProps> = ({
  result,
  onUpdateFindings,
  onBackToCode,
  onExport
}) => {
  const [findings, setFindings] = useState<PythonAuditFinding[]>(result.findings);
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(result.findings[0]?.id ?? null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleToggleResolved = (id: string) => {
    const updated = findings.map(f => f.id === id ? { ...f, resolved: !f.resolved } : f);
    setFindings(updated);
    onUpdateFindings(updated);
  };

  const handleCopyFix = (id: string, fixCode: string) => {
    navigator.clipboard.writeText(fixCode);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filtered = findings.filter(f => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = !q || f.title.toLowerCase().includes(q) || f.whyItMatters.toLowerCase().includes(q) ||
      (f.cwe?.toLowerCase().includes(q)) || (f.ruleId?.toLowerCase().includes(q));
    const matchesSev = severityFilter === 'all' || f.severity === severityFilter;
    return matchesSearch && matchesSev;
  });

  const counts: Record<SeverityLevel, number> = {
    CRITICAL: findings.filter(f => f.severity === 'CRITICAL').length,
    HIGH: findings.filter(f => f.severity === 'HIGH').length,
    MEDIUM: findings.filter(f => f.severity === 'MEDIUM').length,
    LOW: findings.filter(f => f.severity === 'LOW').length,
  };

  const pieData = [
    { name: 'Critical', value: counts.CRITICAL, color: '#f43f5e' },
    { name: 'High', value: counts.HIGH, color: '#f97316' },
    { name: 'Medium', value: counts.MEDIUM, color: '#f59e0b' },
    { name: 'Low', value: counts.LOW, color: '#10b981' },
  ].filter(d => d.value > 0);

  const gate = result.mergeGate;
  const gateBlocked = gate.verdict === 'BLOCKED';
  const gateWarn = gate.verdict === 'PASS_WITH_WARNINGS';

  const tooltipStyle = { backgroundColor: '#16181f', border: '1px solid #23262f', borderRadius: 12, color: '#e8eaf0', fontSize: 12 };

  return (
    <div className="flex-1 max-w-6xl w-full mx-auto px-4 md:px-6 py-8 flex flex-col gap-6 animate-fade-up">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button onClick={onBackToCode} className="inline-flex items-center gap-1.5 text-xs text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)] transition mb-2 cursor-pointer">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to code
          </button>
          <h1 className="text-xl font-bold tracking-tight text-[color:var(--color-ink)]">Security &amp; quality audit</h1>
          <p className="text-sm text-[color:var(--color-ink-muted)] mt-0.5">
            Zero-trust review · Ruff, Bandit, mypy &amp; pip-audit across 12 techniques.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => window.print()} className="btn-ghost px-3.5 py-2 text-sm cursor-pointer">Print</button>
          <button onClick={onExport} className="btn-primary px-4 py-2 text-sm flex items-center gap-2">
            <Download className="w-4 h-4" /> Export report
          </button>
        </div>
      </div>

      {/* Merge gate banner */}
      <div className={`card overflow-hidden ${gateBlocked ? 'border-rose-500/30' : gateWarn ? 'border-amber-500/30' : 'border-emerald-500/30'}`}>
        <div className="flex items-start gap-4 p-5">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
            gateBlocked ? 'bg-rose-500/12 text-rose-400' : gateWarn ? 'bg-amber-500/12 text-amber-400' : 'bg-emerald-500/12 text-emerald-400'
          }`}>
            {gateBlocked ? <Ban className="w-5 h-5" /> : gateWarn ? <ShieldAlert className="w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-bold ${gateBlocked ? 'text-rose-400' : gateWarn ? 'text-amber-400' : 'text-emerald-400'}`}>
                {gateBlocked ? 'Merge blocked' : gateWarn ? 'Pass with warnings' : 'Approved for merge'}
              </span>
              <span className="eyebrow">CI merge gate</span>
            </div>
            <p className="text-sm text-[color:var(--color-ink-muted)] mt-1 leading-relaxed">{gate.reason}</p>
          </div>
          <div className="hidden sm:flex items-center gap-5 pl-5 border-l border-[color:var(--color-hairline)] shrink-0">
            <div className="text-center">
              <div className="text-lg font-bold text-[color:var(--color-ink)] tabular-nums">{gate.temperature.toFixed(1)}</div>
              <div className="eyebrow">Temp</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-[color:var(--color-ink)]">{result.executiveSummary.confidence}</div>
              <div className="eyebrow">Confidence</div>
            </div>
          </div>
        </div>
      </div>

      {/* Severity summary + risk */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="card-quiet p-4 md:col-span-1 flex flex-col justify-center">
          <div className="eyebrow mb-1">Overall risk</div>
          <div className={`text-lg font-bold ${SEV_META[result.executiveSummary.overallRisk].text}`}>
            {result.executiveSummary.overallRisk}
          </div>
        </div>
        {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as SeverityLevel[]).map((sev) => (
          <div key={sev} className="card-quiet p-4">
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`w-1.5 h-1.5 rounded-full ${SEV_META[sev].dot}`} />
              <span className="eyebrow">{SEV_META[sev].label}</span>
            </div>
            <div className="text-2xl font-bold tabular-nums text-[color:var(--color-ink)]">{counts[sev]}</div>
          </div>
        ))}
      </div>

      {/* Top fixes */}
      <div className="card p-5">
        <div className="eyebrow mb-3">Top priority fixes</div>
        <div className="space-y-2.5">
          {result.executiveSummary.topMustFixes.map((item, idx) => (
            <div key={idx} className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-md bg-[#7c6cff]/12 text-[color:var(--color-brand-soft)] text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">{idx + 1}</span>
              <span className="text-sm text-[color:var(--color-ink-muted)] leading-relaxed">{item}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Technique matrix */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-[color:var(--color-ink)]">Detection coverage</h2>
            <p className="text-xs text-[color:var(--color-ink-faint)] mt-0.5">All 12 techniques applied · PASS = no findings</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {result.techniqueMatrix.map((t) => {
            const isPass = t.status === 'PASS';
            const isUnverified = t.status === 'UNVERIFIED';
            return (
              <div key={t.id} className="card-quiet p-3">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-5 h-5 rounded-md bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-faint)] text-[10px] font-mono font-bold flex items-center justify-center shrink-0">{t.id}</span>
                    <span className="text-xs font-medium text-[color:var(--color-ink)] leading-tight truncate">{t.name}</span>
                  </div>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-semibold shrink-0 border ${
                    isPass ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : isUnverified ? 'chip'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  }`}>
                    {t.status === 'FINDINGS' ? `${t.findingCount}` : t.status}
                  </span>
                </div>
                <p className="text-[10px] text-[color:var(--color-ink-faint)] leading-snug mb-1">{t.focus}</p>
                <p className="text-[9px] font-mono text-[color:var(--color-brand-soft)]/70 truncate">{t.toolMapping}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-[color:var(--color-ink)] mb-4">Findings by severity</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={58} outerRadius={84} paddingAngle={4} dataKey="value" stroke="none">
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend formatter={(v) => <span className="text-xs text-[color:var(--color-ink-muted)]">{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-[color:var(--color-ink)] mb-4">Quality vs. benchmark</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="72%" data={result.radarMetrics}>
                <PolarGrid stroke="#23262f" />
                <PolarAngleAxis dataKey="subject" stroke="#9aa1af" tick={{ fontSize: 10 }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} stroke="#3a3f4d" tick={{ fontSize: 9 }} />
                <Radar name="Your code" dataKey="score" stroke="#7c6cff" fill="#7c6cff" fillOpacity={0.35} />
                <Radar name="Benchmark" dataKey="benchmark" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.08} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend formatter={(v) => <span className="text-xs text-[color:var(--color-ink-muted)]">{v}</span>} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Findings list */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-sm font-semibold text-[color:var(--color-ink)]">Findings <span className="text-[color:var(--color-ink-faint)] font-normal">({filtered.length})</span></h2>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 input-field px-3 py-1.5">
              <Search className="w-3.5 h-3.5 text-[color:var(--color-ink-faint)]" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search CWE, rule, file…"
                className="bg-transparent border-0 outline-none text-xs text-[color:var(--color-ink)] w-40 placeholder:text-[color:var(--color-ink-faint)]"
              />
            </div>
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="input-field px-3 py-1.5 text-xs cursor-pointer"
            >
              <option value="all">All severities</option>
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
          </div>
        </div>

        <div className="space-y-2.5">
          {filtered.map((f) => {
            const meta = SEV_META[f.severity];
            const open = expandedId === f.id;
            return (
              <div key={f.id} className={`card overflow-hidden transition ${f.resolved ? 'opacity-55' : ''}`}>
                <button
                  onClick={() => setExpandedId(open ? null : f.id)}
                  className="w-full flex items-center gap-3 p-4 text-left cursor-pointer"
                >
                  <span className={`text-[10px] font-semibold px-2 py-1 rounded-md border shrink-0 ${meta.soft}`}>{meta.label}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[color:var(--color-ink)] truncate">{f.title}</div>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[color:var(--color-ink-faint)] font-mono">
                      <span className="truncate">{f.filePath}</span>
                      <span>·</span>
                      <span>{f.lineRange}</span>
                    </div>
                  </div>
                  {f.cwe && <span className="chip text-[10px] px-2 py-0.5 font-mono hidden sm:inline">{f.cwe}</span>}
                  <ChevronDown className={`w-4 h-4 text-[color:var(--color-ink-faint)] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>

                {open && (
                  <div className="px-4 pb-4 space-y-3 border-t border-[color:var(--color-hairline)] pt-4">
                    <div className="flex flex-wrap gap-2">
                      {f.ruleId && <span className="chip text-[10px] px-2 py-0.5 font-mono">{f.ruleId}</span>}
                      <span className="chip text-[10px] px-2 py-0.5">{f.detectionTechnique}</span>
                    </div>

                    <p className="text-sm text-[color:var(--color-ink-muted)] leading-relaxed">
                      <span className="text-[color:var(--color-ink)] font-medium">Why it matters. </span>{f.whyItMatters}
                    </p>

                    {f.sourceSinkPath && (
                      <div className="card-quiet p-3 font-mono text-[11px] text-rose-300/90">
                        <span className="eyebrow block mb-1 text-rose-400/70">Source → sink</span>
                        {f.sourceSinkPath}
                      </div>
                    )}

                    <div>
                      <span className="eyebrow block mb-1.5 text-rose-400/70">Vulnerable code</span>
                      <pre className="card-quiet p-3 font-mono text-[11px] text-rose-300/90 overflow-x-auto">{f.codeSnippet}</pre>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="eyebrow text-emerald-400/70">Recommended fix</span>
                        <button onClick={() => handleCopyFix(f.id, f.pythonFix)} className="btn-ghost px-2 py-1 text-[10px] flex items-center gap-1 cursor-pointer">
                          {copiedId === f.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          {copiedId === f.id ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <pre className="p-3 rounded-xl bg-emerald-500/[0.04] border border-emerald-500/15 font-mono text-[11px] text-emerald-200/90 overflow-x-auto">{f.pythonFix}</pre>
                    </div>

                    <button
                      onClick={() => handleToggleResolved(f.id)}
                      className="btn-ghost px-3 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      {f.resolved ? <XCircle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                      {f.resolved ? 'Mark unresolved' : 'Mark fixed'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Security checklist */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[color:var(--color-brand-soft)]" />
            <h2 className="text-sm font-semibold text-[color:var(--color-ink)]">Security checklist</h2>
          </div>
          <span className="text-xs font-mono">
            <span className="text-emerald-400">{result.securityChecklist.filter(c => c.passed).length} pass</span>
            <span className="text-[color:var(--color-ink-faint)]"> · </span>
            <span className="text-rose-400">{result.securityChecklist.filter(c => !c.passed).length} fail</span>
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
          {result.securityChecklist.map((item, idx) => (
            <div key={idx} className={`flex items-start gap-2.5 py-1.5 px-2 rounded-lg ${!item.passed ? 'bg-rose-500/[0.04]' : ''}`}>
              {item.passed
                ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                : <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />}
              <div className="min-w-0">
                <span className={`text-xs leading-snug ${item.passed ? 'text-[color:var(--color-ink-muted)]' : 'text-[color:var(--color-ink)]'}`}>{item.label}</span>
                {item.note && <span className="block text-[10px] text-rose-400/80 mt-0.5 font-mono">{item.note}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Dependency table */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Package className="w-4 h-4 text-[color:var(--color-brand-soft)]" />
          <h2 className="text-sm font-semibold text-[color:var(--color-ink)]">Dependencies &amp; supply chain</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[color:var(--color-ink-faint)] border-b border-[color:var(--color-hairline)]">
                <th className="py-2 pr-4 font-medium">Package</th>
                <th className="py-2 pr-4 font-medium">Version</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Evidence</th>
                <th className="py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {result.dependencyTable.map((d, i) => {
                const bad = d.status === 'VULNERABLE' || d.status === 'HALLUCINATED';
                const warn = d.status === 'UNVERIFIED';
                return (
                  <tr key={i} className="border-b border-[color:var(--color-hairline)]/60">
                    <td className="py-2.5 pr-4 font-mono text-[color:var(--color-ink)]">{d.packageOrApi}</td>
                    <td className="py-2.5 pr-4 font-mono text-[color:var(--color-ink-muted)]">{d.version}</td>
                    <td className="py-2.5 pr-4">
                      <span className={`text-[10px] px-2 py-0.5 rounded-md border font-semibold ${
                        bad ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                        : warn ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      }`}>{d.status}</span>
                    </td>
                    <td className="py-2.5 pr-4 text-[color:var(--color-ink-muted)]">{d.evidence}</td>
                    <td className="py-2.5 text-[color:var(--color-brand-soft)]">{d.action}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recommended tests */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <FlaskConical className="w-4 h-4 text-[color:var(--color-brand-soft)]" />
          <h2 className="text-sm font-semibold text-[color:var(--color-ink)]">Recommended tests</h2>
          <span className="ml-auto text-[11px] text-[color:var(--color-ink-faint)]">A finding isn't resolved until a test guards it</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TestBlock tag="UNIT" tagClass="bg-sky-500/10 text-sky-400 border-sky-500/20" label="pytest · parametrize" code={result.recommendedTests.unitPytest} />
          <TestBlock tag="PROPERTY" tagClass="bg-violet-500/10 text-violet-400 border-violet-500/20" label="Hypothesis invariants" code={result.recommendedTests.propertyBased} />
          <TestBlock tag="FUZZ" tagClass="bg-rose-500/10 text-rose-400 border-rose-500/20" label="Atheris (parser/regex sinks)" code={result.recommendedTests.fuzz ?? '# PASS — no parsers, deserializers, or user-controlled regex present.'} />
          <div>
            <div className="text-[11px] font-medium text-[color:var(--color-ink)] mb-1.5 flex items-center gap-1.5">
              <span className="text-[9px] px-1.5 py-0.5 rounded-md border bg-amber-500/10 text-amber-400 border-amber-500/20 font-mono">MUTATION</span>
              mutmut · target ≥ {result.recommendedTests.mutationTargetScore}%
            </div>
            <div className="card-quiet p-3 space-y-2">
              {result.recommendedTests.mutationWeakSpots.map((s, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px] text-[color:var(--color-ink-muted)]">
                  <Bug className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <span>{s}</span>
                </div>
              ))}
              <div className="pt-2 border-t border-[color:var(--color-hairline)] font-mono text-[10px] text-[color:var(--color-brand-soft)]">$ mutmut run</div>
            </div>
          </div>
        </div>
      </div>

      {/* CI/CD */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Terminal className="w-4 h-4 text-[color:var(--color-brand-soft)]" />
          <h2 className="text-sm font-semibold text-[color:var(--color-ink)]">CI/CD merge-gate pipeline</h2>
          <span className="ml-auto text-[11px] text-rose-400">Auto-fails on any critical</span>
        </div>
        <pre className="card-quiet p-3.5 font-mono text-[11px] text-[color:var(--color-ink-muted)] overflow-x-auto max-h-80">{result.recommendedCiCdYaml}</pre>
      </div>

      {/* Strengths + reviewer notes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-[color:var(--color-ink)]">Strengths</h2>
          </div>
          <ul className="space-y-2">
            {result.strengthsObserved.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-[color:var(--color-ink-muted)]">
                <span className="text-emerald-400 shrink-0 mt-0.5">+</span>{s}
              </li>
            ))}
          </ul>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-[color:var(--color-ink)]">Reviewer notes</h2>
          </div>
          <ul className="space-y-2">
            {result.reviewerNotes.map((n, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-[color:var(--color-ink-muted)]">
                <span className="text-amber-400 shrink-0 mt-0.5">•</span>{n}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

const TestBlock: React.FC<{ tag: string; tagClass: string; label: string; code: string }> = ({ tag, tagClass, label, code }) => (
  <div>
    <div className="text-[11px] font-medium text-[color:var(--color-ink)] mb-1.5 flex items-center gap-1.5">
      <span className={`text-[9px] px-1.5 py-0.5 rounded-md border font-mono ${tagClass}`}>{tag}</span>
      {label}
    </div>
    <pre className="card-quiet p-3 font-mono text-[11px] text-[color:var(--color-ink-muted)] overflow-x-auto max-h-64">{code}</pre>
  </div>
);
