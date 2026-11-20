import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import CodeEditor from '../components/CodeEditor';
import Header from '../components/Header';
import ShareDialog from '../components/ShareDialog';
import { api } from '../services/api';
import type { DocumentItem } from '../types';

export default function DocumentPage() {
  const { id } = useParams();
  const [doc, setDoc] = useState<DocumentItem | null>(null);
  const [error, setError] = useState('');
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    api
      .get<DocumentItem>(`/documents/${id}/`)
      .then((r) => setDoc(r.data))
      .catch(() => setError('Document not found, or you do not have access.'));
  }, [id]);

  return (
    <>
      <Header />
      <main className="container wide">
        <div className="toolbar">
          <Link to="/" className="back-link">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Back to documents
          </Link>
          {doc && (
            <div className="toolbar-right">
              <span className={`badge role-${doc.my_role}`}>{doc.my_role}</span>
              <button className="btn primary" onClick={() => setSharing(true)}>
                Share
              </button>
            </div>
          )}
        </div>
        {error && <div className="alert">{error}</div>}
        {doc && <h2 style={{ marginTop: 12 }}>{doc.title}</h2>}

        {doc?.doc_type === 'code' && (
          <CodeEditor
            key={doc.id}
            docId={doc.id}
            initialLanguage={doc.language}
            canWrite={doc.my_role !== 'viewer'}
          />
        )}
        {doc?.doc_type === 'whiteboard' && (
          <div className="card" style={{ marginTop: 16 }}>
            <p>The whiteboard is coming next.</p>
          </div>
        )}
      </main>
      {sharing && doc && <ShareDialog doc={doc} onClose={() => setSharing(false)} />}
    </>
  );
}
