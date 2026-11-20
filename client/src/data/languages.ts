import { cpp } from '@codemirror/lang-cpp';
import { html } from '@codemirror/lang-html';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import type { Extension } from '@codemirror/state';

// The keys match what the backend accepts (documents/serializers.py)
export const LANGUAGES: { key: string; label: string; extension: () => Extension }[] = [
  { key: 'javascript', label: 'JavaScript', extension: () => javascript() },
  { key: 'python', label: 'Python', extension: () => python() },
  { key: 'java', label: 'Java', extension: () => java() },
  { key: 'cpp', label: 'C++', extension: () => cpp() },
  { key: 'html', label: 'HTML', extension: () => html() },
];

export function languageExtension(key: string): Extension {
  return (LANGUAGES.find((l) => l.key === key) ?? LANGUAGES[0]).extension();
}
