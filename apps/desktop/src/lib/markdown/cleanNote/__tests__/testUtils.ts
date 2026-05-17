import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  cleanNoteMarkdownBody,
  type CleanNoteOptions,
} from '..';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function readFixture(relPath: string): string {
  return readFileSync(join(__dirname, 'fixtures', relPath), 'utf8');
}

export function clean(
  input: string,
  filepath = '/tmp/Doc.md',
  options?: CleanNoteOptions,
): string {
  return cleanNoteMarkdownBody(input, filepath, options);
}
