import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { Doc } from 'yjs';
import { api, errorMessage } from '../services/api';
import type { CollabProvider } from '../services/collabProvider';
import { buildDoc, replaceContent } from '../services/versionUtils';
import type { DocType, VersionDetail, VersionInfo } from '../types';

export interface PreviewData {
  number: number;
  doc: Doc;
}

interface Props {
  docId: string;
  docType: DocType;
  canWrite: boolean;
  refreshKey: number; // changes whenever the server announces a new version
  liveDocRef: RefObject<Doc | null>;
  providerRef: RefObject<CollabProvider | null>;
  previewing: number | null;
  onPreview: (preview: PreviewData | null) => void;
}

export default function VersionPanel(props: Props) {
  const { docId, docType, canWrite, refreshKey, liveDocRef, providerRef, previewing, onPreview } =
    props;
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .get<VersionInfo[]>(`/documents/${docId}/versions/`)
      .then((r) => {
        if (!cancelled) setVersions(r.data);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [docId, refreshKey]);

  async function load(number: number): Promise<Doc> {
    const { data } = await api.get<VersionDetail>(`/documents/${docId}/versions/${number}/`);
    return buildDoc(data.updates);
  }

  async function preview(v: VersionInfo) {
    try {
      onPreview({ number: v.number, doc: await load(v.number) });
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function restore(v: VersionInfo) {
    const provider = providerRef.current;
    const live = liveDocRef.current;
    if (!provider || !live || !provider.connected) {
      setError('Reconnect before restoring a version.');
      return;
    }
    const question = `Restore version ${v.number}? The current content is saved in the history first.`;
    if (!window.confirm(question)) return;
    try {
      const old = await load(v.number);
      // 1. Bookmark the current state so nothing is lost
      provider.requestSnapshot(`Before restoring version ${v.number}`);
      // 2. Apply the old content as a normal edit (the server checks our role)
      replaceContent(live, old, docType);
      // 3. Bookmark the result as a new version
      provider.requestSnapshot(`Restored from version ${v.number}`, 'restore');
      onPreview(null);
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <aside className="card side-panel">
      <h3>Version history</h3>
      {error && <div className="alert">{error}</div>}
      {versions.length === 0 && (
        <p className="muted small">
          No versions yet. Snapshots are taken automatically every 30 seconds or 50 changes.
        </p>
      )}
      <ul className="version-list">
        {versions.map((v) => (
          <li key={v.number} className={previewing === v.number ? 'active' : ''}>
            <div>
              <strong>Version {v.number}</strong>
              {v.kind === 'restore' && <span className="badge"> restore</span>}
              {v.label && <div className="small">{v.label}</div>}
              <div className="muted small">
                {v.author_name}
                <br />
                {new Date(v.created_at).toLocaleString()}
              </div>
            </div>
            <div className="version-actions">
              <button className="btn" onClick={() => void preview(v)}>
                Preview
              </button>
              {canWrite && (
                <button className="btn" onClick={() => void restore(v)}>
                  Restore
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
