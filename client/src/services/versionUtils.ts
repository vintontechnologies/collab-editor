import * as Y from 'yjs';
import type { DocType } from '../types';

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Rebuild an old version of a document by replaying its stored edits
export function buildDoc(updates: string[]): Y.Doc {
  const doc = new Y.Doc();
  for (const u of updates) Y.applyUpdate(doc, fromBase64(u));
  return doc;
}

/**
 * Make `live` look like `old`, as one normal edit. Because it is an ordinary Yjs edit,
 * it syncs to everyone and is stored like any other change: history is never rewritten.
 */
export function replaceContent(live: Y.Doc, old: Y.Doc, docType: DocType) {
  live.transact(() => {
    if (docType === 'code') {
      const text = live.getText('code');
      text.delete(0, text.length);
      text.insert(0, old.getText('code').toString());
      const language = old.getMap<string>('meta').get('language');
      if (language) live.getMap<string>('meta').set('language', language);
    } else {
      // Whiteboard: shapes are plain objects in a map keyed by shape id
      const shapes = live.getMap<unknown>('shapes');
      const oldShapes = old.getMap<unknown>('shapes');
      for (const key of Array.from(shapes.keys())) {
        if (!oldShapes.has(key)) shapes.delete(key);
      }
      oldShapes.forEach((value, key) => shapes.set(key, value));
    }
  });
}
