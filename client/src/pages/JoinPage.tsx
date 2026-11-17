import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../services/api';

// Opened from a share link: joins the document, then opens it.
export default function JoinPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .post(`/documents/join/${id}/`)
      .then(() => {
        if (!cancelled) navigate(`/documents/${id}`, { replace: true });
      })
      .catch(() => {
        if (!cancelled) setError('This link is not active, or the document no longer exists.');
      });
    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  if (error) {
    return (
      <div className="auth-page">
        <div className="card auth-card">
          <h2>Can&rsquo;t open this link</h2>
          <p className="muted">{error}</p>
          <Link to="/">Go to my documents</Link>
        </div>
      </div>
    );
  }
  return <p className="center-note">Joining document...</p>;
}
