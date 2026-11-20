import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import { api, tokens } from './api';

// Message types: the first byte of every binary message (must match consumers.py)
const MSG_UPDATE = 0; // a Yjs edit
const MSG_AWARENESS = 1; // cursor / presence
const MSG_SYNCED = 2; // server has sent every stored edit
const MSG_ERROR = 3; // text reason
const MSG_JOIN = 4;
const MSG_LEAVE = 5;
const MSG_VERSION = 6; // to server: take a snapshot. From server: a new version exists

export type ConnectionStatus = 'connecting' | 'connected' | 'offline' | 'denied';

interface Options {
  docId: string;
  ydoc: Y.Doc;
  awareness: Awareness;
  onStatus?: (status: ConnectionStatus) => void;
  onPending?: (count: number) => void;
  onError?: (message: string) => void;
  onVersion?: () => void;
  onPresence?: (event: 'join' | 'leave', info: { user_id: number; name: string }) => void;
}

/**
 * Connects a Yjs document to the Django WebSocket. Local edits are sent immediately,
 * or queued while offline and sent after reconnecting. Remote edits are applied
 * with `this` as the origin so they are never echoed back to the server.
 */
export class CollabProvider {
  private opts: Options;
  private ws: WebSocket | null = null;
  private synced = false;
  private destroyed = false;
  private retry = 0;
  private timer = 0;
  private pending: Uint8Array[] = [];

  constructor(opts: Options) {
    this.opts = opts;
    opts.ydoc.on('update', this.onDocUpdate);
    opts.awareness.on('update', this.onAwarenessUpdate);
    void this.connect();
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return; // it came from the server
    if (this.ws?.readyState === WebSocket.OPEN && this.synced) {
      this.send(MSG_UPDATE, update);
    } else {
      this.pending.push(update); // offline: keep it until we reconnect
      this.opts.onPending?.(this.pending.length);
    }
  };

  private onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === this || this.ws?.readyState !== WebSocket.OPEN) return;
    const changed = added.concat(updated, removed);
    this.send(MSG_AWARENESS, encodeAwarenessUpdate(this.opts.awareness, changed));
  };

  private async connect() {
    this.opts.onStatus?.(this.retry === 0 ? 'connecting' : 'offline');
    try {
      // Any authenticated call refreshes an expired access token first (see api.ts)
      await api.get('/auth/me/');
    } catch {
      this.scheduleReconnect();
      return;
    }
    if (this.destroyed) return;

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws/documents/${this.opts.docId}/?token=${tokens.access ?? ''}`;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
    };
    ws.onmessage = (e) => {
      if (ws === this.ws) this.onMessage(new Uint8Array(e.data as ArrayBuffer));
    };
    ws.onclose = (e) => {
      if (ws !== this.ws || this.destroyed) return;
      this.synced = false;
      // Nobody else is reachable now, so drop their cursors
      const { awareness } = this.opts;
      const remote = Array.from(awareness.getStates().keys()).filter(
        (id) => id !== awareness.clientID,
      );
      removeAwarenessStates(awareness, remote, this);
      if (e.code === 4403) {
        this.opts.onStatus?.('denied'); // the server removed our access
        return;
      }
      this.opts.onStatus?.('offline');
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.destroyed) return;
    const delay = Math.min(1000 * 2 ** this.retry, 10000); // 1s, 2s, 4s ... max 10s
    this.retry += 1;
    this.timer = window.setTimeout(() => void this.connect(), delay);
  }

  private onMessage(data: Uint8Array) {
    const payload = data.subarray(1);
    const { ydoc, awareness } = this.opts;
    switch (data[0]) {
      case MSG_UPDATE:
        Y.applyUpdate(ydoc, payload, this);
        break;
      case MSG_AWARENESS:
        applyAwarenessUpdate(awareness, payload, this);
        break;
      case MSG_SYNCED:
        this.synced = true;
        this.opts.onStatus?.('connected');
        // Send edits made while offline (Yjs merges them with whatever others did)
        for (const update of this.pending) this.send(MSG_UPDATE, update);
        this.pending = [];
        this.opts.onPending?.(0);
        this.sendOwnAwareness();
        break;
      case MSG_ERROR:
        this.opts.onError?.(new TextDecoder().decode(payload));
        break;
      case MSG_VERSION:
        this.opts.onVersion?.();
        break;
      case MSG_JOIN:
      case MSG_LEAVE: {
        const info = JSON.parse(new TextDecoder().decode(payload));
        const joined = data[0] === MSG_JOIN;
        if (joined) {
          this.sendOwnAwareness(); // so the newcomer sees our cursor straight away
        } else {
          for (const [id, state] of awareness.getStates()) {
            if (id !== awareness.clientID && state.user?.id === info.user_id) {
              removeAwarenessStates(awareness, [id], this);
            }
          }
        }
        this.opts.onPresence?.(joined ? 'join' : 'leave', info);
        break;
      }
    }
  }

  private sendOwnAwareness() {
    const { awareness } = this.opts;
    if (awareness.getLocalState() !== null) {
      this.send(MSG_AWARENESS, encodeAwarenessUpdate(awareness, [awareness.clientID]));
    }
  }

  get connected() {
    return this.synced && this.ws?.readyState === WebSocket.OPEN;
  }

  // Ask the server for a snapshot. kind "restore" marks the version created by a restore.
  requestSnapshot(label: string, kind: 'auto' | 'restore' = 'auto') {
    if (!this.connected) return;
    this.send(MSG_VERSION, new TextEncoder().encode(JSON.stringify({ label, kind })));
  }

  private send(type: number, payload: Uint8Array) {
    const frame = new Uint8Array(payload.length + 1);
    frame[0] = type;
    frame.set(payload, 1);
    this.ws?.send(frame);
  }

  destroy() {
    this.destroyed = true;
    window.clearTimeout(this.timer);
    const { ydoc, awareness } = this.opts;
    // Tell the others that our cursor is gone, then disconnect
    removeAwarenessStates(awareness, [awareness.clientID], 'destroy');
    ydoc.off('update', this.onDocUpdate);
    awareness.off('update', this.onAwarenessUpdate);
    this.ws?.close();
  }
}
