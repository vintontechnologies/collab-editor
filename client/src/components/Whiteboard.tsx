import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { useAuth } from '../context/AuthContext';
import { userColor } from '../data/colors';
import {
  bounds,
  handlesFor,
  moveShape,
  newId,
  oppositeCorner,
  readShapes,
  rectFrom,
  resizeShape,
  sortShapes,
} from '../data/shapes';
import type { Point, Shape, ShapeKind } from '../data/shapes';
import { CollabProvider } from '../services/collabProvider';
import type { ConnectionStatus } from '../services/collabProvider';
import type { OnlineUser } from '../types';
import ShapeView from './ShapeView';
import VersionPanel from './VersionPanel';
import type { PreviewData } from './VersionPanel';
import WhiteboardPreview from './WhiteboardPreview';

type Tool = 'select' | ShapeKind;
interface View {
  x: number;
  y: number;
  k: number; // zoom
}
interface RemoteCursor {
  id: number;
  name: string;
  color: string;
  x: number;
  y: number;
}
// What the pointer is doing right now
type Drag =
  | { type: 'draw'; shape: Shape; start: Point }
  | { type: 'move'; id: string; last: Point }
  | { type: 'resize'; handle: string; fixed: Point; orig: Shape }
  | { type: 'pan'; startX: number; startY: number; view: View };

const TOOLS: { tool: Tool; label: string }[] = [
  { tool: 'select', label: 'Select' },
  { tool: 'pen', label: 'Pen' },
  { tool: 'rect', label: 'Rectangle' },
  { tool: 'ellipse', label: 'Circle' },
  { tool: 'arrow', label: 'Arrow' },
  { tool: 'text', label: 'Text' },
];
const WIDTHS = [2, 4, 8, 12];
const HANDLE_CURSOR: Record<string, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  start: 'move',
  end: 'move',
};
const WRITE_INTERVAL_MS = 30; // how often a drag is sent to the other users

interface Props {
  docId: string;
  canWrite: boolean;
}

export default function Whiteboard({ docId, canWrite }: Props) {
  const { user } = useAuth();
  const userId = user?.id;
  const userName = user?.name || user?.email || 'Anonymous';

  const svgRef = useRef<SVGSVGElement>(null);
  const liveDocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<CollabProvider | null>(null);
  const awarenessRef = useRef<Awareness | null>(null);
  const shapesRef = useRef<Y.Map<Shape> | null>(null);
  const undoRef = useRef<Y.UndoManager | null>(null);
  const drag = useRef<Drag | null>(null);
  const lastWrite = useRef(0);
  const lastCursor = useRef(0);

  const [shapes, setShapes] = useState<Shape[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [pending, setPending] = useState(0);
  const [notice, setNotice] = useState('');
  const [online, setOnline] = useState<OnlineUser[]>([]);
  const [cursors, setCursors] = useState<RemoteCursor[]>([]);
  const [versionTick, setVersionTick] = useState(0);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [color, setColor] = useState('#1c2333');
  const [width, setWidth] = useState(4);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });

  useEffect(() => {
    if (userId === undefined) return;

    // The shared document: "shapes" maps shape id -> shape
    const ydoc = new Y.Doc();
    const map = ydoc.getMap<Shape>('shapes');
    const awareness = new Awareness(ydoc);
    const { color: userCol, light } = userColor(userId);
    awareness.setLocalStateField('user', {
      id: userId,
      name: userName,
      color: userCol,
      colorLight: light,
    });
    // Undo only reverts this user's own changes (remote edits arrive with another origin)
    const undo = new Y.UndoManager(map);

    liveDocRef.current = ydoc;
    shapesRef.current = map;
    awarenessRef.current = awareness;
    undoRef.current = undo;

    const onShapes = () => setShapes(sortShapes(Array.from(map.values())));
    map.observe(onShapes);

    const refreshPeople = () => {
      const seen = new Map<number, OnlineUser>();
      const others: RemoteCursor[] = [];
      awareness.getStates().forEach((state, clientId) => {
        const u = state.user as OnlineUser | undefined;
        if (!u) return;
        seen.set(u.id, u);
        const c = state.cursor as { x: number; y: number } | null | undefined;
        if (clientId !== awareness.clientID && c) {
          others.push({ id: clientId, name: u.name, color: u.color, x: c.x, y: c.y });
        }
      });
      setOnline(Array.from(seen.values()));
      setCursors(others);
    };
    awareness.on('change', refreshPeople);

    const provider = new CollabProvider({
      docId,
      ydoc,
      awareness,
      onStatus: (s) => {
        setStatus(s);
        refreshPeople();
      },
      onPending: setPending,
      onVersion: () => setVersionTick((n) => n + 1),
      onError: (message) =>
        setNotice(
          message === 'read-only'
            ? 'You have view-only access, so your changes were not saved.'
            : message,
        ),
    });
    providerRef.current = provider;

    return () => {
      map.unobserve(onShapes);
      awareness.off('change', refreshPeople);
      provider.destroy();
      undo.destroy();
      awareness.destroy();
      ydoc.destroy();
      liveDocRef.current = null;
      shapesRef.current = null;
      awarenessRef.current = null;
      undoRef.current = null;
      providerRef.current = null;
    };
  }, [docId, userId, userName]);

  // Keyboard: Delete, undo, redo, Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const mod = e.ctrlKey || e.metaKey;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && canWrite) {
        e.preventDefault();
        shapesRef.current?.delete(selectedId);
        setSelectedId(null);
      } else if (mod && e.key.toLowerCase() === 'z' && canWrite) {
        e.preventDefault();
        if (e.shiftKey) undoRef.current?.redo();
        else undoRef.current?.undo();
      } else if (mod && e.key.toLowerCase() === 'y' && canWrite) {
        e.preventDefault();
        undoRef.current?.redo();
      } else if (e.key === 'Escape') {
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, canWrite]);

  // Zoom around a point (screen coordinates inside the board)
  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setView((v) => {
      const k = Math.min(8, Math.max(0.1, v.k * factor));
      const wx = (cx - v.x) / v.k;
      const wy = (cy - v.y) / v.k;
      return { k, x: cx - wx * k, y: cy - wy * k };
    });
  }, []);

  // The wheel listener must be non-passive so the page doesn't scroll while zooming
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  function zoomButton(factor: number) {
    const r = svgRef.current?.getBoundingClientRect();
    zoomAt(factor, (r?.width ?? 0) / 2, (r?.height ?? 0) / 2);
  }

  // Screen position -> position on the board
  function toWorld(e: { clientX: number; clientY: number }): Point {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k };
  }

  const put = (s: Shape) => shapesRef.current?.set(s.id, s);

  function addText(p: Point) {
    const text = window.prompt('Text to add')?.trim();
    setTool('select');
    if (!text) return;
    const s: Shape = {
      id: newId(),
      kind: 'text',
      color,
      width,
      z: Date.now(),
      x: p.x,
      y: p.y,
      w: 0,
      h: 0,
      text,
      size: 16 + width * 2,
    };
    put(s);
    setSelectedId(s.id);
  }

  function onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (preview) return;
    const p = toWorld(e);
    const target = e.target as Element;
    const shapeId = target.closest('[data-shape]')?.getAttribute('data-shape') ?? null;
    const handle = target.closest('[data-handle]')?.getAttribute('data-handle') ?? null;

    if (canWrite && tool === 'text') {
      addText(p);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    undoRef.current?.stopCapturing(); // each gesture becomes one undo step

    if (e.button === 1 || tool === 'select' || !canWrite) {
      const selected = shapes.find((s) => s.id === selectedId);
      if (e.button !== 1 && handle && selected && canWrite) {
        drag.current = {
          type: 'resize',
          handle,
          fixed: oppositeCorner(bounds(selected), handle),
          orig: selected,
        };
      } else if (e.button !== 1 && shapeId) {
        setSelectedId(shapeId);
        if (canWrite) drag.current = { type: 'move', id: shapeId, last: p };
      } else {
        // empty space (or middle mouse button): pan the board
        if (e.button !== 1) setSelectedId(null);
        drag.current = { type: 'pan', startX: e.clientX, startY: e.clientY, view };
      }
      return;
    }

    // Drawing tools: create the shape now and grow it while the pointer moves
    setSelectedId(null);
    const base: Shape = {
      id: newId(),
      kind: tool,
      color,
      width,
      z: Date.now(),
      x: p.x,
      y: p.y,
      w: 0,
      h: 0,
    };
    const shape = tool === 'pen' ? { ...base, points: [p.x, p.y, p.x, p.y] } : base;
    drag.current = { type: 'draw', shape, start: p };
    put(shape);
  }

  function onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    const p = toWorld(e);
    const now = performance.now();
    if (now - lastCursor.current > 50) {
      awarenessRef.current?.setLocalStateField('cursor', p); // shown to the other users
      lastCursor.current = now;
    }
    const d = drag.current;
    if (!d) return;

    if (d.type === 'pan') {
      setView({
        ...d.view,
        x: d.view.x + e.clientX - d.startX,
        y: d.view.y + e.clientY - d.startY,
      });
      return;
    }

    // Immutable updates: a shape stored in the shared map is never modified in place
    if (d.type === 'draw') {
      const s = d.shape;
      if (s.kind === 'pen') d.shape = { ...s, points: [...(s.points ?? []), p.x, p.y] };
      else if (s.kind === 'arrow') d.shape = { ...s, w: p.x - d.start.x, h: p.y - d.start.y };
      else d.shape = { ...s, ...rectFrom(d.start, p) };
    }
    if (now - lastWrite.current < WRITE_INTERVAL_MS) return; // throttle network updates
    lastWrite.current = now;

    if (d.type === 'draw') {
      put(d.shape);
    } else if (d.type === 'move') {
      const cur = shapesRef.current?.get(d.id);
      if (cur) put(moveShape(cur, p.x - d.last.x, p.y - d.last.y));
      d.last = p;
    } else {
      put(resizeShape(d.orig, d.handle, d.fixed, p));
    }
  }

  function onPointerUp(e: ReactPointerEvent<SVGSVGElement>) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const p = toWorld(e);

    if (d.type === 'draw') {
      const s = d.shape;
      const tiny =
        s.kind === 'rect' || s.kind === 'ellipse'
          ? s.w < 3 || s.h < 3
          : s.kind === 'arrow'
            ? Math.hypot(s.w, s.h) < 3
            : false;
      if (tiny)
        shapesRef.current?.delete(s.id); // a plain click, not a drag
      else put(s);
    } else if (d.type === 'move') {
      const cur = shapesRef.current?.get(d.id);
      if (cur && (p.x !== d.last.x || p.y !== d.last.y)) {
        put(moveShape(cur, p.x - d.last.x, p.y - d.last.y));
      }
    } else if (d.type === 'resize') {
      put(resizeShape(d.orig, d.handle, d.fixed, p));
    }
  }

  function onDoubleClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!canWrite) return;
    const id = (e.target as Element).closest('[data-shape]')?.getAttribute('data-shape');
    const s = shapes.find((x) => x.id === id);
    if (s?.kind !== 'text') return;
    const text = window.prompt('Edit text', s.text)?.trim();
    if (text) put({ ...s, text });
  }

  function updateSelected(patch: Partial<Shape>) {
    const s = shapes.find((x) => x.id === selectedId);
    if (s && canWrite) put({ ...s, ...patch });
  }

  function changeColor(c: string) {
    setColor(c);
    updateSelected({ color: c });
  }

  function changeWidth(w: number) {
    setWidth(w);
    updateSelected({ width: w });
  }

  function deleteSelected() {
    if (!selectedId || !canWrite) return;
    shapesRef.current?.delete(selectedId);
    setSelectedId(null);
  }

  const selected = shapes.find((s) => s.id === selectedId);
  const sb = selected ? bounds(selected) : null;
  const pad = 4 / view.k;
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
        <div className="board-toolbar">
          <div className="tool-group">
            {TOOLS.map((t) => (
              <button
                key={t.tool}
                className={`tool ${tool === t.tool ? 'active' : ''}`}
                disabled={(!canWrite && t.tool !== 'select') || preview !== null}
                onClick={() => setTool(t.tool)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="inline-field">
            <span>Color</span>
            <input
              type="color"
              value={color}
              disabled={!canWrite}
              onChange={(e) => changeColor(e.target.value)}
            />
          </div>
          <div className="inline-field">
            <span>Stroke</span>
            <select
              value={width}
              disabled={!canWrite}
              onChange={(e) => changeWidth(Number(e.target.value))}
            >
              {WIDTHS.map((w) => (
                <option key={w} value={w}>
                  {w}px
                </option>
              ))}
            </select>
          </div>
          <div className="tool-group">
            <button className="tool" disabled={!canWrite} onClick={() => undoRef.current?.undo()}>
              Undo
            </button>
            <button className="tool" disabled={!canWrite} onClick={() => undoRef.current?.redo()}>
              Redo
            </button>
            <button className="tool" disabled={!selectedId || !canWrite} onClick={deleteSelected}>
              Delete
            </button>
          </div>
          <div className="tool-group">
            <button className="tool" onClick={() => zoomButton(1 / 1.2)}>
              &minus;
            </button>
            <button className="tool" onClick={() => setView({ x: 0, y: 0, k: 1 })}>
              {Math.round(view.k * 100)}%
            </button>
            <button className="tool" onClick={() => zoomButton(1.2)}>
              +
            </button>
          </div>
          {!canWrite && <span className="badge role-viewer">View only</span>}
        </div>
        <div className={`status status-${status}`} style={{ marginBottom: 8 }}>
          {statusText}
        </div>
        {notice && <div className="alert">{notice}</div>}

        {preview && (
          <div className="preview-banner">
            <span>Previewing version {preview.number} (read-only)</span>
            <button className="btn" onClick={() => setPreview(null)}>
              Back to live board
            </button>
          </div>
        )}

        {/* The live board stays mounted (and connected) while a preview is shown */}
        <div className="board-wrap" style={{ display: preview ? 'none' : 'block' }}>
          <svg
            ref={svgRef}
            className="board"
            style={{ cursor: tool === 'select' || !canWrite ? 'default' : 'crosshair' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => awarenessRef.current?.setLocalStateField('cursor', null)}
            onDoubleClick={onDoubleClick}
          >
            <defs>
              <pattern
                id="grid"
                width={24 * view.k}
                height={24 * view.k}
                x={view.x}
                y={view.y}
                patternUnits="userSpaceOnUse"
              >
                <circle cx="1" cy="1" r="1" fill="#d5d9e5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              {shapes.map((s) => (
                <ShapeView key={s.id} shape={s} />
              ))}
              {selected && sb && (
                <>
                  <rect
                    x={sb.x - pad}
                    y={sb.y - pad}
                    width={sb.w + 2 * pad}
                    height={sb.h + 2 * pad}
                    fill="none"
                    stroke="#3b5bdb"
                    strokeWidth={1 / view.k}
                    strokeDasharray={`${4 / view.k} ${3 / view.k}`}
                    pointerEvents="none"
                  />
                  {canWrite &&
                    handlesFor(selected).map((h) => (
                      <rect
                        key={h.name}
                        data-handle={h.name}
                        x={h.x - 5 / view.k}
                        y={h.y - 5 / view.k}
                        width={10 / view.k}
                        height={10 / view.k}
                        fill="#fff"
                        stroke="#3b5bdb"
                        strokeWidth={1.5 / view.k}
                        style={{ cursor: HANDLE_CURSOR[h.name] }}
                      />
                    ))}
                </>
              )}
            </g>
          </svg>
          {cursors.map((c) => (
            <div
              key={c.id}
              className="remote-cursor"
              style={{
                transform: `translate(${c.x * view.k + view.x}px, ${c.y * view.k + view.y}px)`,
              }}
            >
              <svg width="14" height="18" viewBox="0 0 14 18">
                <path d="M1 1l11 8-5 1-3 6z" fill={c.color} />
              </svg>
              <span style={{ background: c.color }}>{c.name}</span>
            </div>
          ))}
        </div>
        {preview && <WhiteboardPreview shapes={readShapes(preview.doc.getMap<Shape>('shapes'))} />}
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
          docType="whiteboard"
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
