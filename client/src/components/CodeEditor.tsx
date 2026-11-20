import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { Compartment, EditorState } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { useAuth } from '../context/AuthContext';
import { userColor } from '../data/colors';
import { LANGUAGES, languageExtension } from '../data/languages';
import { CollabProvider } from '../services/collabProvider';
import type { ConnectionStatus } from '../services/collabProvider';
import { api } from '../services/api';
import type { OnlineUser } from '../types';
import CodePreview from './CodePreview';
import VersionPanel from './VersionPanel';
import type { PreviewData } from './VersionPanel';

interface Props {
  docId: string;
  initialLanguage: string;
  canWrite: boolean;
}

export default function CodeEditor({ docId, initialLanguage, canWrite }: Props) {
  const { user } = useAuth();
  const userId = user?.id;
  const userName = user?.name || user?.email || 'Anonymous';

  const host = useRef<HTMLDivElement>(null);
  const metaRef = useRef<Y.Map<string> | null>(null);
  const liveDocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<CollabProvider | null>(null);
  const [language, setLanguage] = useState(initialLanguage);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [pending, setPending] = useState(0);
  const [notice, setNotice] = useState('');
  const [online, setOnline] = useState<OnlineUser[]>([]);
  const [versionTick, setVersionTick] = useState(0);
  const [preview, setPreview] = useState<PreviewData | null>(null);

  useEffect(() => {
    if (userId === undefined || !host.current) return;

    // The shared document: "code" holds the text, "meta" holds settings like the language
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('code');
    const meta = ydoc.getMap<string>('meta');
    metaRef.current = meta;
    liveDocRef.current = ydoc;

    // Awareness = who is here and where their cursor is (not stored in the document)
    const awareness = new Awareness(ydoc);
    const { color, light } = userColor(userId);
    awareness.setLocalStateField('user', { id: userId, name: userName, color, colorLight: light });

    const languageSlot = new Compartment(); // lets us swap the language without rebuilding
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          foldGutter(),
          drawSelection(),
          indentOnInput(),
          indentUnit.of('    '),
          bracketMatching(),
          closeBrackets(),
          highlightActiveLine(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          keymap.of([
            ...closeBracketsKeymap,
            ...yUndoManagerKeymap,
            ...defaultKeymap,
            indentWithTab,
          ]),
          languageSlot.of(languageExtension(initialLanguage)),
          // Viewers get a read-only editor (the server also rejects their edits)
          EditorState.readOnly.of(!canWrite),
          EditorView.editable.of(canWrite),
          yCollab(ytext, awareness),
        ],
      }),
    });

    const refreshOnline = () => {
      const seen = new Map<number, OnlineUser>();
      awareness.getStates().forEach((state) => {
        const u = state.user as OnlineUser | undefined;
        if (u) seen.set(u.id, u);
      });
      setOnline(Array.from(seen.values()));
    };
    awareness.on('change', refreshOnline);

    // Fires on every language change, local or from another user
    const applyLanguage = () => {
      const lang = meta.get('language') ?? initialLanguage;
      setLanguage(lang);
      view.dispatch({ effects: languageSlot.reconfigure(languageExtension(lang)) });
    };
    meta.observe(applyLanguage);

    const provider = new CollabProvider({
      docId,
      ydoc,
      awareness,
      onStatus: (s) => {
        setStatus(s);
        refreshOnline();
      },
      onPending: setPending,
      onVersion: () => setVersionTick((n) => n + 1), // a snapshot was taken: refresh the timeline
      onError: (message) =>
        setNotice(
          message === 'read-only'
            ? 'You have view-only access, so your changes were not saved.'
            : message,
        ),
    });
    providerRef.current = provider;

    return () => {
      meta.unobserve(applyLanguage);
      awareness.off('change', refreshOnline);
      provider.destroy();
      view.destroy();
      awareness.destroy();
      ydoc.destroy();
      metaRef.current = null;
      liveDocRef.current = null;
      providerRef.current = null;
    };
  }, [docId, userId, userName, canWrite, initialLanguage]);

  function changeLanguage(next: string) {
    metaRef.current?.set('language', next); // syncs to everyone in real time
    api.patch(`/documents/${docId}/`, { language: next }).catch(() => {
      /* not critical: it only remembers the choice for the next time the file is opened */
    });
  }

  const statusText = {
    connecting: 'Connecting...',
    connected: 'Connected. Changes save automatically.',
    offline:
      pending > 0
        ? `Offline: ${pending} change${pending === 1 ? '' : 's'} will sync when you reconnect.`
        : 'Offline: reconnecting...',
    denied: 'Your access to this document was removed.',
  }[status];

  return (
    <div className="editor-layout">
      <div className="editor-main">
        <div className="editor-toolbar">
          <select
            value={language}
            onChange={(e) => changeLanguage(e.target.value)}
            disabled={!canWrite || preview !== null}
          >
            {LANGUAGES.map((l) => (
              <option key={l.key} value={l.key}>
                {l.label}
              </option>
            ))}
          </select>
          {!canWrite && <span className="badge role-viewer">View only</span>}
          <span className={`status status-${status}`}>{statusText}</span>
        </div>
        {notice && <div className="alert">{notice}</div>}

        {preview && (
          <div className="preview-banner">
            <span>Previewing version {preview.number} (read-only)</span>
            <button className="btn" onClick={() => setPreview(null)}>
              Back to live document
            </button>
          </div>
        )}

        {/* The live editor stays mounted (and connected) while a preview is shown */}
        <div ref={host} className="editor-host" style={{ display: preview ? 'none' : 'block' }} />
        {preview && (
          <CodePreview
            text={preview.doc.getText('code').toString()}
            language={preview.doc.getMap<string>('meta').get('language') ?? language}
          />
        )}
      </div>

      <div className="side-column">
        <aside className="card side-panel">
          <h3>Online ({online.length})</h3>
          <ul className="online-list">
            {online.map((u) => (
              <li key={u.id}>
                <span className="dot" style={{ background: u.color }} />
                {u.name}
                {u.id === userId && <span className="muted"> (you)</span>}
              </li>
            ))}
          </ul>
        </aside>
        <VersionPanel
          docId={docId}
          docType="code"
          canWrite={canWrite}
          refreshKey={versionTick}
          liveDocRef={liveDocRef}
          providerRef={providerRef}
          previewing={preview?.number ?? null}
          onPreview={setPreview}
        />
      </div>
    </div>
  );
}
