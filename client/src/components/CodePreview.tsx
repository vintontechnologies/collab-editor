import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { languageExtension } from '../data/languages';

// A read-only view of an old version of a code document
export default function CodePreview({ text, language }: { text: string; language: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          languageExtension(language),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
        ],
      }),
    });
    return () => view.destroy();
  }, [text, language]);

  return <div ref={host} className="editor-host" />;
}
