import React, { useState, useEffect } from 'react';
import { ApiSettings } from '../types';
import { X, Key, Check, Shield, AlertTriangle } from 'lucide-react';

export interface ApiSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ApiSettings;
  onSave: (s: ApiSettings) => void;
}

export const PROVIDERS: Array<{ id: ApiSettings['provider']; name: string; models: string[]; envVar: string; baseUrl: string }> = [
  {
    id: 'openai',
    name: 'OpenAI',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini'],
    envVar: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'],
    envVar: 'ANTHROPIC_API_KEY',
    baseUrl: 'https://api.anthropic.com/v1',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    models: ['gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    envVar: 'GEMINI_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
  {
    id: 'groq',
    name: 'Groq',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
    envVar: 'GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai/v1',
  },
];

export const ApiSettingsModal: React.FC<ApiSettingsModalProps> = ({ isOpen, onClose, settings, onSave }) => {
  const [provider, setProvider] = useState<ApiSettings['provider']>(settings.provider);
  
  // Get environment variable for the selected provider
  const getEnvKey = (p: ApiSettings['provider']) => {
    const providerMeta = PROVIDERS.find(x => x.id === p)!;
    if (providerMeta.envVar) {
      return import.meta.env[`VITE_${providerMeta.envVar}`] || '';
    }
    return '';
  };

  const [apiKey, setApiKey] = useState<string>(() => {
    // First use settings, then fall back to env var
    if (settings.apiKey) return settings.apiKey;
    return getEnvKey(settings.provider);
  });
  
  const [model, setModel] = useState(settings.model);

  useEffect(() => {
    const p = PROVIDERS.find(x => x.id === provider)!;
    if (!p.models.includes(model)) setModel(p.models[0]);
    
    // Auto-fill API key from env var when provider changes, always overwrite with env var if available
    const envKey = getEnvKey(provider);
    if (envKey) {
      setApiKey(envKey);
    }
  }, [provider]);

  // Update state when settings change (e.g., when modal reopens)
  useEffect(() => {
    setProvider(settings.provider);
    const envKey = getEnvKey(settings.provider);
    if (settings.apiKey) {
      setApiKey(settings.apiKey);
    } else if (envKey) {
      setApiKey(envKey);
    } else {
      setApiKey('');
    }
    setModel(settings.model);
  }, [settings]);

  if (!isOpen) return null;

  const providerMeta = PROVIDERS.find(p => p.id === provider)!;
  const active = apiKey.trim().length > 8;

  const handleSave = () => {
    onSave({ provider, apiKey, model });
    onClose();
  };

  const handleClear = () => {
    setApiKey('');
    const defaultProvider = PROVIDERS[0];
    onSave({ provider: defaultProvider.id, apiKey: '', model: defaultProvider.models[0] });
    setProvider(defaultProvider.id);
    setModel(defaultProvider.models[0]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b0c10]/80 backdrop-blur-md p-4" onClick={onClose}>
      <div className="card max-w-xl w-full p-6 relative animate-fade-up" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-[color:var(--color-ink-faint)] hover:text-[color:var(--color-ink)] transition cursor-pointer">
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-start gap-3 mb-6 pr-6">
          <div className="w-10 h-10 rounded-xl bg-[#7c6cff]/12 text-[color:var(--color-brand-soft)] flex items-center justify-center">
            <Key className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-[color:var(--color-ink)] text-base">Connect your AI provider</h3>
            <p className="text-xs text-[color:var(--color-ink-muted)] mt-0.5">
              Your API key stays in your browser's localStorage. Nothing leaves your device except the actual API call.
            </p>
          </div>
        </div>

        {/* Provider grid */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-5">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => setProvider(p.id)}
              className={`card-quiet p-3 text-center transition cursor-pointer ${
                provider === p.id ? 'border-[#7c6cff]/50 bg-[#7c6cff]/10' : 'hover:border-[#33384a]'
              }`}
            >
              <div className={`text-xs font-semibold ${provider === p.id ? 'text-[color:var(--color-ink)]' : 'text-[color:var(--color-ink-muted)]'}`}>{p.name}</div>
            </button>
          ))}
        </div>

        {/* API key */}
        <div className="mb-4">
          <label className="eyebrow mb-1.5 block">API Key</label>
          <div className="relative">
            <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--color-ink-faint)]" />
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={`${providerMeta.envVar} — paste your key here or set VITE_${providerMeta.envVar} in .env`}
              className="input-field w-full pl-10 pr-3 py-2.5 text-sm font-mono"
              autoComplete="off"
            />
          </div>
          <p className="text-[10px] text-[color:var(--color-ink-faint)] mt-1.5 flex items-center gap-1">
            <Shield className="w-3 h-3" />
            Stored locally · Sent only to {providerMeta.name}
          </p>
        </div>

        {/* Model */}
        <div className="mb-4">
          <label className="eyebrow mb-1.5 block">Model</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="input-field w-full px-3 py-2.5 text-sm cursor-pointer"
          >
            {providerMeta.models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        {/* Status */}
        <div className={`card-quiet p-3 flex items-center gap-2.5 mb-5 ${active ? 'border-emerald-500/25' : 'border-amber-500/25'}`}>
          {active
            ? <><Check className="w-4 h-4 text-emerald-400" /><span className="text-xs text-emerald-300">Ready — key set</span></>
            : <><AlertTriangle className="w-4 h-4 text-amber-400" /><span className="text-xs text-amber-300">Enter a key to enable live generation</span></>
          }
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-2 border-t border-[color:var(--color-hairline)] pt-4">
          <button onClick={handleClear} className="text-xs text-[color:var(--color-ink-faint)] hover:text-rose-400 transition cursor-pointer">
            Clear saved key
          </button>
          <div className="flex gap-2 ml-auto">
            <button onClick={onClose} className="btn-ghost px-3.5 py-2 text-sm cursor-pointer">Cancel</button>
            <button onClick={handleSave} className="btn-primary px-4 py-2 text-sm">Save</button>
          </div>
        </div>
      </div>
    </div>
  );
};
