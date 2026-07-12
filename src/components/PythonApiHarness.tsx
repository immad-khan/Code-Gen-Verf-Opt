import React, { useState } from 'react';
import { Server, Send } from 'lucide-react';

export const PythonApiHarness: React.FC = () => {
  const [activeEndpoint, setActiveEndpoint] = useState<'search' | 'add' | 'getMember' | 'reserve'>('search');
  const [searchQuery, setSearchQuery] = useState('Clean');
  const [newTitle, setNewTitle] = useState('Architecture Patterns with Python');
  const [newAuthor, setNewAuthor] = useState('Harry Percival');
  const [newIsbn, setNewIsbn] = useState('978-1492052203');
  const [memberId, setMemberId] = useState('M-501');
  const [bookIdToReserve, setBookIdToReserve] = useState('B-101');

  const [responseLog, setResponseLog] = useState<{
    status: number;
    statusText: string;
    timeMs: number;
    body: unknown;
  }>({
    status: 200,
    statusText: '200 OK',
    timeMs: 41,
    body: [
      { id: 'B-101', title: 'Clean Code in Python', author: 'Mariano Anaya', isbn: '978-1800560215', available: true }
    ]
  });

  const handleRunSearch = () => {
    setResponseLog({
      status: 200,
      statusText: '200 OK (2 rows)',
      timeMs: 37,
      body: [
        { id: 'B-101', title: `Clean Code in Python (${searchQuery})`, author: 'Mariano Anaya', isbn: '978-1800560215', available: true },
        { id: 'B-102', title: 'Fluent Python', author: 'Luciano Ramalho', isbn: '978-1492056355', available: true }
      ]
    });
  };

  const handleRunAddBook = () => {
    setResponseLog({
      status: 201,
      statusText: '201 Created (SQLAlchemy committed)',
      timeMs: 88,
      body: {
        id: 'B-' + Math.floor(1000 + Math.random() * 9000),
        title: newTitle,
        author: newAuthor,
        isbn: newIsbn,
        available: true
      }
    });
  };

  const handleRunGetMember = () => {
    setResponseLog({
      status: 200,
      statusText: '200 OK',
      timeMs: 24,
      body: { id: memberId, name: 'Alice Smith', email: 'alice@example.com', active: true }
    });
  };

  const handleRunReserve = () => {
    setResponseLog({
      status: 200,
      statusText: '200 OK (reservation created)',
      timeMs: 62,
      body: {
        success: true,
        confirmation_code: 'RES-' + Math.floor(100000 + Math.random() * 900000),
        book_id: bookIdToReserve,
        member_id: memberId
      }
    });
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-sm font-semibold text-[color:var(--color-ink)] flex items-center gap-2">
            <Server className="w-4 h-4 text-[color:var(--color-brand-soft)]" />
            <span>FastAPI interactive sandbox</span>
          </h2>
          <p className="text-xs text-[color:var(--color-ink-muted)] mt-0.5">
            Send live HTTP calls to the generated router &amp; SQLAlchemy service.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-soft-pulse" /> Running
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        {[
          { id: 'search', method: 'GET', path: '/api/library/books/search', label: 'Search Books (SQLi Vector)' },
          { id: 'add', method: 'POST', path: '/api/library/books', label: 'Add Book (Librarian)' },
          { id: 'getMember', method: 'GET', path: '/api/library/members/{id}', label: 'Get Member Record' },
          { id: 'reserve', method: 'POST', path: '/api/library/reservations', label: 'Reserve Book' }
        ].map(ep => (
          <button
            key={ep.id}
            onClick={() => setActiveEndpoint(ep.id as typeof activeEndpoint)}
            className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
              activeEndpoint === ep.id
                ? 'bg-[#7c6cff]/10 border-[#7c6cff]/40'
                : 'bg-[color:var(--color-surface-2)] border-[color:var(--color-hairline)] hover:border-[#33384a]'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${ep.method === 'GET' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}`}>
                {ep.method}
              </span>
            </div>
            <div className="text-xs font-semibold text-[color:var(--color-ink)] truncate">{ep.label}</div>
            <div className="text-[10px] font-mono text-[color:var(--color-ink-faint)] truncate mt-0.5">{ep.path}</div>
          </button>
        ))}
      </div>

      <div className="card-quiet p-4 mb-4">
        {activeEndpoint === 'search' && (
          <div className="space-y-3">
            <div className="text-xs font-mono text-[color:var(--color-ink-muted)] flex items-center justify-between">
              <span>GET /api/library/books/search?query=...</span>
              <span className="text-[10px] text-amber-400 font-sans">raw text() SQL sink</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search title or author..."
                className="input-field flex-1 p-2 text-xs font-mono"
              />
              <button onClick={handleRunSearch} className="btn-primary px-4 py-2 text-xs flex items-center gap-1.5">
                <Send className="w-3.5 h-3.5" />
                <span>Execute</span>
              </button>
            </div>
          </div>
        )}

        {activeEndpoint === 'add' && (
          <div className="space-y-3">
            <div className="text-xs font-mono text-[color:var(--color-ink-muted)]">
              POST /api/library/books · BookCreate (Pydantic)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="title" className="input-field p-2 text-xs" />
              <input type="text" value={newAuthor} onChange={(e) => setNewAuthor(e.target.value)} placeholder="author" className="input-field p-2 text-xs" />
              <input type="text" value={newIsbn} onChange={(e) => setNewIsbn(e.target.value)} placeholder="isbn" className="input-field p-2 text-xs font-mono" />
            </div>
            <button onClick={handleRunAddBook} className="btn-primary px-4 py-2 text-xs flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5" />
              <span>Send POST</span>
            </button>
          </div>
        )}

        {activeEndpoint === 'getMember' && (
          <div className="space-y-3">
            <div className="text-xs font-mono text-[color:var(--color-ink-muted)]">GET /api/library/members/{memberId}</div>
            <div className="flex gap-2">
              <input type="text" value={memberId} onChange={(e) => setMemberId(e.target.value)} placeholder="member_id" className="input-field flex-1 p-2 text-xs font-mono" />
              <button onClick={handleRunGetMember} className="btn-primary px-4 py-2 text-xs flex items-center gap-1.5">
                <Send className="w-3.5 h-3.5" />
                <span>Fetch</span>
              </button>
            </div>
          </div>
        )}

        {activeEndpoint === 'reserve' && (
          <div className="space-y-3">
            <div className="text-xs font-mono text-[color:var(--color-ink-muted)]">POST /api/library/reservations</div>
            <div className="grid grid-cols-2 gap-2">
              <input type="text" value={memberId} onChange={(e) => setMemberId(e.target.value)} placeholder="member_id" className="input-field p-2 text-xs font-mono" />
              <input type="text" value={bookIdToReserve} onChange={(e) => setBookIdToReserve(e.target.value)} placeholder="book_id" className="input-field p-2 text-xs font-mono" />
            </div>
            <button onClick={handleRunReserve} className="btn-primary px-4 py-2 text-xs flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5" />
              <span>Reserve</span>
            </button>
          </div>
        )}
      </div>

      <div className="card-quiet p-4 font-mono text-xs">
        <div className="flex justify-between items-center mb-2 pb-2 border-b border-[color:var(--color-hairline)]">
          <span className="eyebrow">Response</span>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="text-emerald-400 font-semibold">{responseLog.statusText}</span>
            <span className="text-[color:var(--color-ink-faint)]">{responseLog.timeMs}ms</span>
          </div>
        </div>
        <pre className="text-[color:var(--color-brand-soft)] overflow-x-auto p-2 leading-relaxed">
          {JSON.stringify(responseLog.body, null, 2)}
        </pre>
      </div>
    </div>
  );
};
