import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

export function loadMarkdownRuntime() {
  const marked = fs.readFileSync(path.join(ROOT, 'node_modules/marked/lib/marked.umd.js'), 'utf8');
  const dompurify = fs.readFileSync(path.join(ROOT, 'node_modules/dompurify/dist/purify.min.js'), 'utf8');
  return `${marked}\n${dompurify}`;
}
