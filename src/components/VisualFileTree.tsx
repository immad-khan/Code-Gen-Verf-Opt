import React, { useState } from 'react';
import { GeneratedCodeFile } from '../types';
import {
  Folder, FolderOpen, FileCode, Settings, Wrench, Server,
  ChevronRight, ChevronDown, Copy, Check, ShieldCheck, Database, Braces
} from 'lucide-react';

interface VisualFileTreeProps {
  files: GeneratedCodeFile[];
  activeFileIndex: number;
  onSelectFile: (index: number) => void;
}

interface TreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  children: Record<string, TreeNode>;
  fileIndex?: number;
  category?: string;
}

export const VisualFileTree: React.FC<VisualFileTreeProps> = ({
  files,
  activeFileIndex,
  onSelectFile
}) => {
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);

  const activeFile = files[activeFileIndex] || files[0];

  const handleCopyCode = () => {
    if (!activeFile) return;
    navigator.clipboard.writeText(activeFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleFolder = (folderPath: string) => {
    setOpenFolders(prev => ({ ...prev, [folderPath]: prev[folderPath] === false ? true : !prev[folderPath] }));
  };
  const isFolderOpen = (path: string) => openFolders[path] !== false;

  const root: Record<string, TreeNode> = {};
  files.forEach((file, index) => {
    const parts = (file.path || file.name).split('/');
    let current = root;
    let currentPath = '';
    parts.forEach((part, i) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLast = i === parts.length - 1;
      if (!current[part]) {
        current[part] = {
          name: part,
          path: currentPath,
          isFolder: !isLast,
          children: {},
          fileIndex: isLast ? index : undefined,
          category: isLast ? file.category : undefined
        };
      }
      current = current[part].children;
    });
  });

  const getCategoryMeta = (cat?: string) => {
    switch (cat) {
      case 'router':
        return { label: 'API router', color: 'text-[#7c6cff]', icon: Server, desc: 'Receives HTTP requests and routes them to services' };
      case 'service':
        return { label: 'Service logic', color: 'text-violet-400', icon: Wrench, desc: 'Business logic and database operations' };
      case 'model':
        return { label: 'ORM model', color: 'text-sky-400', icon: Database, desc: 'SQLAlchemy database table definitions' };
      case 'schema':
        return { label: 'Pydantic schema', color: 'text-cyan-400', icon: Braces, desc: 'Request/response validation shapes' };
      case 'data':
        return { label: 'Database', color: 'text-emerald-400', icon: Database, desc: 'Connection & session management' };
      case 'test':
        return { label: 'pytest', color: 'text-amber-400', icon: ShieldCheck, desc: 'Automated test assertions' };
      case 'config':
        return { label: 'Config', color: 'text-rose-400', icon: Settings, desc: 'App startup & project configuration' };
      default:
        return { label: 'Python file', color: 'text-[color:var(--color-ink-muted)]', icon: FileCode, desc: 'Python source file' };
    }
  };

  const renderTreeNodes = (nodes: Record<string, TreeNode>, depth = 0): React.ReactNode => {
    return Object.values(nodes).map(node => {
      if (node.isFolder) {
        const open = isFolderOpen(node.path);
        return (
          <div key={node.path} className="select-none">
            <button
              onClick={() => toggleFolder(node.path)}
              className="w-full flex items-center gap-1.5 py-1.5 px-2 hover:bg-white/[0.03] rounded-lg cursor-pointer transition text-xs"
              style={{ paddingLeft: `${depth * 14 + 8}px` }}
            >
              {open ? <ChevronDown className="w-3.5 h-3.5 text-[color:var(--color-ink-faint)] shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-[color:var(--color-ink-faint)] shrink-0" />}
              {open ? <FolderOpen className="w-4 h-4 text-[color:var(--color-brand-soft)] shrink-0" /> : <Folder className="w-4 h-4 text-[color:var(--color-brand-soft)] shrink-0" />}
              <span className="font-medium text-[color:var(--color-ink-muted)]">{node.name}</span>
            </button>
            {open && <div>{renderTreeNodes(node.children, depth + 1)}</div>}
          </div>
        );
      }
      const isSelected = node.fileIndex === activeFileIndex;
      const meta = getCategoryMeta(node.category);
      const IconComponent = meta.icon;
      return (
        <button
          key={node.path}
          onClick={() => typeof node.fileIndex === 'number' && onSelectFile(node.fileIndex)}
          className={`w-full flex items-center gap-2 py-1.5 px-2 my-0.5 rounded-lg cursor-pointer transition text-xs ${
            isSelected ? 'bg-[#7c6cff]/12 text-[color:var(--color-ink)]' : 'hover:bg-white/[0.03] text-[color:var(--color-ink-muted)]'
          }`}
          style={{ paddingLeft: `${depth * 14 + 20}px` }}
        >
          <IconComponent className={`w-4 h-4 shrink-0 ${isSelected ? 'text-[color:var(--color-brand-soft)]' : meta.color}`} />
          <span className="font-mono truncate">{node.name}</span>
        </button>
      );
    });
  };

  const activeMeta = getCategoryMeta(activeFile?.category);
  const ActiveIcon = activeMeta.icon;

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
      {/* Left: tree */}
      <div className="md:col-span-4 card-quiet p-2.5 flex flex-col">
        <div className="flex items-center justify-between px-2 py-1.5 mb-1">
          <span className="eyebrow">Project files</span>
          <span className="chip text-[10px] px-2 py-0.5 font-mono">{files.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto max-h-[460px]">
          {renderTreeNodes(root)}
        </div>
      </div>

      {/* Right: description + preview */}
      <div className="md:col-span-8 flex flex-col gap-4">
        {activeFile && (
          <div className="card-quiet p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[color:var(--color-surface-3)] flex items-center justify-center">
                  <ActiveIcon className={`w-5 h-5 ${activeMeta.color}`} />
                </div>
                <div>
                  <div className="font-mono text-sm font-semibold text-[color:var(--color-ink)]">{activeFile.name}</div>
                  <div className="text-[11px] font-mono text-[color:var(--color-ink-faint)]">{activeFile.path}</div>
                </div>
              </div>
              <span className="chip text-[10px] px-2.5 py-1 shrink-0">{activeMeta.label}</span>
            </div>
            <p className="text-xs text-[color:var(--color-ink-muted)] leading-relaxed mt-3">
              {activeFile.description || 'This file provides logic for your Python application.'}
            </p>
          </div>
        )}

        <div className="card-quiet overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 border-b border-[color:var(--color-hairline)]">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
            </div>
            <button onClick={handleCopyCode} className="btn-ghost px-2.5 py-1 text-xs flex items-center gap-1.5 cursor-pointer">
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
          <div className="p-4 font-mono text-xs overflow-x-auto max-h-[340px] bg-[#0a0b0f]">
            <table className="border-collapse">
              <tbody>
                {activeFile?.content.split('\n').map((line, idx) => (
                  <tr key={idx} className="hover:bg-white/[0.02]">
                    <td className="w-10 select-none text-[color:var(--color-ink-faint)]/60 text-right pr-4 py-[1px] align-top">{idx + 1}</td>
                    <td className="pl-4 py-[1px] whitespace-pre text-[color:var(--color-ink-muted)]">{line || ' '}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
