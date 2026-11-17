import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Header from '../components/Header';
import ShareDialog from '../components/ShareDialog';
import { api } from '../services/api';
import type { DocumentItem } from '../types';

// Placeholder: the real editor and whiteboard are added in the next steps.
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
      <main className="container">
        <div className="toolbar">
          <Link to="/">&larr; Back to documents</Link>
          {doc && (
            <button className="btn primary" onClick={() => setSharing(true)}>
              Share
            </button>
          )}
        </div>
        {error && <div className="alert">{error}</div>}
        {doc && (
          <div className="card" style={{ marginTop: 16 }}>
            <h2>{doc.title}</h2>
            <p className="muted">
              {doc.doc_type} &middot; your role: <strong>{doc.my_role}</strong>
            </p>
            <p>The collaborative editor will appear here.</p>
          </div>
        )}
      </main>
      {sharing && doc && <ShareDialog doc={doc} onClose={() => setSharing(false)} />}
    </>
  );
}
