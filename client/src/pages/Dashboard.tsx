import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import { api, errorMessage } from '../services/api';
import type { DocType, DocumentItem } from '../types';

type Filter = 'all' | 'owned' | 'shared';

export default function Dashboard() {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState<DocType>('code');

  // Bumping this counter re-runs the fetch effect below (used after rename, delete, etc.)
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false; // ignore late responses if the component unmounts
    api
      .get<DocumentItem[]>('/documents/')
      .then(({ data }) => {
        if (!cancelled) setDocs(data);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Run an action, then refresh the list
  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      setError('');
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const { data } = await api.post<DocumentItem>('/documents/', {
        title: title.trim() || 'Untitled',
        doc_type: docType,
      });
      navigate(`/documents/${data.id}`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function rename(doc: DocumentItem) {
    const next = window.prompt('New name', doc.title)?.trim();
    if (!next || next === doc.title) return;
    await act(() => api.patch(`/documents/${doc.id}/`, { title: next }));
  }

  async function remove(doc: DocumentItem) {
    if (!window.confirm(`Delete "${doc.title}"? This cannot be undone.`)) return;
    await act(() => api.delete(`/documents/${doc.id}/`));
  }

  const visible = docs.filter((d) =>
    filter === 'all' ? true : filter === 'owned' ? d.my_role === 'owner' : d.my_role !== 'owner',
  );

  return (
    <>
      <Header />
      <main className="container">
        <form className="card create-bar" onSubmit={create}>
          <input
            placeholder="Document title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <select value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
            <option value="code">Code</option>
            <option value="whiteboard">Whiteboard</option>
          </select>
          <button className="btn primary">New document</button>
        </form>

        <div className="tabs">
          {(['all', 'owned', 'shared'] as Filter[]).map((f) => (
            <button
              key={f}
              className={`tab ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f === 'owned' ? 'Owned by me' : 'Shared with me'}
            </button>
          ))}
        </div>

        {error && <div className="alert">{error}</div>}
        {loading && <p className="muted">Loading documents...</p>}
        {!loading && visible.length === 0 && <p className="muted">No documents here yet.</p>}

        <div className="grid">
          {visible.map((doc) => (
            <article key={doc.id} className="card doc-card">
              <h3>{doc.title}</h3>
              <div className="badges">
                <span className="badge">{doc.doc_type}</span>
                <span className={`badge role-${doc.my_role}`}>{doc.my_role}</span>
              </div>
              <p className="muted small">
                By {doc.owner_name || 'unknown'}
                <br />
                Updated {new Date(doc.updated_at).toLocaleString()}
              </p>
              <div className="actions">
                <button className="btn primary" onClick={() => navigate(`/documents/${doc.id}`)}>
                  Open
                </button>
                {doc.my_role === 'owner' && (
                  <button className="btn" onClick={() => void rename(doc)}>
                    Rename
                  </button>
                )}
                <button
                  className="btn"
                  onClick={() => void act(() => api.post(`/documents/${doc.id}/duplicate/`))}
                >
                  Duplicate
                </button>
                {doc.my_role === 'owner' && (
                  <button className="btn danger" onClick={() => void remove(doc)}>
                    Delete
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </main>
    </>
  );
}
