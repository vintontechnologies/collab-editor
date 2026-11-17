import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage } from '../services/api';
import type { DocumentItem, LinkRole, Member, MembersResponse, PendingInvite } from '../types';

interface Props {
  doc: DocumentItem;
  onClose: () => void;
}

export default function ShareDialog({ doc, onClose }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isOwner = doc.my_role === 'owner';

  const [members, setMembers] = useState<Member[]>([]);
  const [pending, setPending] = useState<PendingInvite[]>([]);
  const [linkRole, setLinkRole] = useState<LinkRole>(doc.link_role);
  const [linkUrl, setLinkUrl] = useState('');
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('viewer');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // Bumping this counter re-runs the load effect after every change
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<MembersResponse>(`/documents/${doc.id}/members/`),
      api.get<{ link_role: LinkRole; url: string }>(`/documents/${doc.id}/link/`),
    ])
      .then(([m, l]) => {
        if (cancelled) return;
        setMembers(m.data.members);
        setPending(m.data.pending_invites);
        setLinkRole(l.data.link_role);
        setLinkUrl(l.data.url);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [doc.id, reloadKey]);

  // Run an API call, show the result, and refresh the lists
  async function act(fn: () => Promise<unknown>, ok = ''): Promise<boolean> {
    try {
      await fn();
      setError('');
      setNotice(ok);
      setReloadKey((k) => k + 1);
      return true;
    } catch (err) {
      setNotice('');
      setError(errorMessage(err));
      return false;
    }
  }

  async function invite(e: FormEvent) {
    e.preventDefault();
    const sent = email.trim();
    if (!sent) return;
    const ok = await act(
      () => api.post(`/documents/${doc.id}/members/`, { email: sent, role: inviteRole }),
      `Invitation sent to ${sent}`,
    );
    if (ok) setEmail('');
  }

  async function removeMember(m: Member) {
    const leaving = m.user_id === user?.id;
    const question = leaving ? 'Leave this document?' : `Remove ${m.name || m.email}?`;
    if (!window.confirm(question)) return;
    const ok = await act(() => api.delete(`/documents/${doc.id}/members/${m.user_id}/`));
    if (ok && leaving) navigate('/');
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(linkUrl);
      setError('');
      setNotice('Link copied to the clipboard.');
    } catch {
      setNotice('');
      setError('Could not copy automatically. Select the link and copy it by hand.');
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Share &ldquo;{doc.title}&rdquo;</h2>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>

        {error && <div className="alert">{error}</div>}
        {notice && <div className="notice">{notice}</div>}

        {isOwner && (
          <form className="invite-row" onSubmit={invite}>
            <input
              type="email"
              placeholder="Invite by email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'editor' | 'viewer')}
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
            <button className="btn primary">Invite</button>
          </form>
        )}

        <h3>People with access</h3>
        <ul className="member-list">
          {members.map((m) => (
            <li key={m.user_id}>
              <div>
                <strong>{m.name || m.email}</strong>
                {m.user_id === user?.id && <span className="muted"> (you)</span>}
                <div className="muted small">{m.email}</div>
              </div>
              <div className="member-actions">
                {m.role === 'owner' && <span className="badge role-owner">owner</span>}
                {m.role !== 'owner' && isOwner && (
                  <>
                    <select
                      value={m.role}
                      onChange={(e) =>
                        void act(() =>
                          api.patch(`/documents/${doc.id}/members/${m.user_id}/`, {
                            role: e.target.value,
                          }),
                        )
                      }
                    >
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                    </select>
                    <button className="btn danger" onClick={() => void removeMember(m)}>
                      Remove
                    </button>
                  </>
                )}
                {m.role !== 'owner' && !isOwner && (
                  <>
                    <span className={`badge role-${m.role}`}>{m.role}</span>
                    {m.user_id === user?.id && (
                      <button className="btn danger" onClick={() => void removeMember(m)}>
                        Leave
                      </button>
                    )}
                  </>
                )}
              </div>
            </li>
          ))}
          {pending.map((p) => (
            <li key={p.email}>
              <div>
                <strong>{p.email}</strong>
                <div className="muted small">Invited, no account yet</div>
              </div>
              <span className={`badge role-${p.role}`}>{p.role} (pending)</span>
            </li>
          ))}
        </ul>

        {isOwner && (
          <>
            <h3>Share link</h3>
            <p className="muted small">
              Anyone signed in who opens the link joins with the role you choose.
            </p>
            <div className="link-row">
              <select
                value={linkRole}
                onChange={(e) =>
                  void act(() => api.put(`/documents/${doc.id}/link/`, { role: e.target.value }))
                }
              >
                <option value="off">Link sharing off</option>
                <option value="viewer">Anyone with the link: Viewer</option>
                <option value="editor">Anyone with the link: Editor</option>
              </select>
              {linkRole !== 'off' && (
                <>
                  <input readOnly value={linkUrl} onFocus={(e) => e.target.select()} />
                  <button className="btn" onClick={() => void copyLink()}>
                    Copy
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
