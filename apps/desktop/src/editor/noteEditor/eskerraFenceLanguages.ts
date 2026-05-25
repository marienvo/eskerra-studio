import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  type StreamParser,
} from '@codemirror/language';
import {languages as codeMirrorLanguages} from '@codemirror/language-data';

function legacy(parser: StreamParser<unknown>): LanguageSupport {
  return new LanguageSupport(StreamLanguage.define(parser));
}

const eskerraFenceLanguageOverrides: readonly LanguageDescription[] = [
  LanguageDescription.of({
    name: 'JavaScript',
    alias: ['ecmascript', 'js', 'node'],
    extensions: ['js', 'mjs', 'cjs'],
    load: () => import('@codemirror/lang-javascript').then(m => m.javascript()),
  }),
  LanguageDescription.of({
    name: 'JSX',
    extensions: ['jsx'],
    load: () => import('@codemirror/lang-javascript').then(m => m.javascript({jsx: true})),
  }),
  LanguageDescription.of({
    name: 'TypeScript',
    alias: ['ts'],
    extensions: ['ts', 'mts', 'cts'],
    load: () => import('@codemirror/lang-javascript').then(m => m.javascript({typescript: true})),
  }),
  LanguageDescription.of({
    name: 'TSX',
    extensions: ['tsx'],
    load: () =>
      import('@codemirror/lang-javascript').then(m =>
        m.javascript({jsx: true, typescript: true}),
      ),
  }),
  LanguageDescription.of({
    name: 'JSON',
    alias: ['json5'],
    extensions: ['json', 'map'],
    load: () => import('@codemirror/lang-json').then(m => m.json()),
  }),
  LanguageDescription.of({
    name: 'YAML',
    alias: ['yml'],
    extensions: ['yaml', 'yml'],
    load: () => import('@codemirror/lang-yaml').then(m => m.yaml()),
  }),
  LanguageDescription.of({
    name: 'Python',
    extensions: ['BUILD', 'bzl', 'py', 'pyw'],
    filename: /^(BUCK|BUILD)$/,
    load: () => import('@codemirror/lang-python').then(m => m.python()),
  }),
  LanguageDescription.of({
    name: 'Rust',
    extensions: ['rs'],
    load: () => import('@codemirror/lang-rust').then(m => m.rust()),
  }),
  LanguageDescription.of({
    name: 'Go',
    extensions: ['go'],
    load: () => import('@codemirror/lang-go').then(m => m.go()),
  }),
  LanguageDescription.of({
    name: 'SQL',
    alias: ['postgres', 'postgresql', 'mysql', 'sqlite'],
    extensions: ['sql'],
    load: () => import('@codemirror/lang-sql').then(m => m.sql({dialect: m.StandardSQL})),
  }),
  LanguageDescription.of({
    name: 'CSS',
    extensions: ['css'],
    load: () => import('@codemirror/legacy-modes/mode/css').then(m => legacy(m.css)),
  }),
  LanguageDescription.of({
    name: 'SCSS',
    extensions: ['scss'],
    load: () => import('@codemirror/lang-sass').then(m => m.sass()),
  }),
  LanguageDescription.of({
    name: 'Sass',
    extensions: ['sass'],
    load: () => import('@codemirror/lang-sass').then(m => m.sass({indented: true})),
  }),
  LanguageDescription.of({
    name: 'HTML',
    alias: ['xhtml'],
    extensions: ['html', 'htm'],
    load: () => import('@codemirror/lang-html').then(m => m.html()),
  }),
  LanguageDescription.of({
    name: 'XML',
    alias: ['rss', 'wsdl', 'xsd', 'svg'],
    extensions: ['xml', 'xsl', 'xsd', 'svg'],
    load: () => import('@codemirror/lang-xml').then(m => m.xml()),
  }),
  LanguageDescription.of({
    name: 'Angular Template',
    alias: ['angular', 'angular template'],
    load: () => import('@codemirror/lang-angular').then(m => m.angular()),
  }),
  LanguageDescription.of({
    name: 'WebAssembly',
    alias: ['webassembly', 'wast', 'wat'],
    extensions: ['wat', 'wast'],
    load: () => import('@codemirror/lang-wast').then(m => m.wast()),
  }),
  LanguageDescription.of({
    name: 'Shell',
    alias: ['bash', 'sh', 'zsh'],
    extensions: ['sh', 'ksh', 'bash'],
    filename: /^PKGBUILD$/,
    load: () => import('@codemirror/legacy-modes/mode/shell').then(m => legacy(m.shell)),
  }),
  LanguageDescription.of({
    name: 'Markdown',
    extensions: ['md', 'markdown', 'mkd'],
    load: () => import('@codemirror/lang-markdown').then(m => m.markdown()),
  }),
  LanguageDescription.of({
    name: 'diff',
    extensions: ['diff', 'patch'],
    load: () => import('@codemirror/legacy-modes/mode/diff').then(m => legacy(m.diff)),
  }),
  LanguageDescription.of({
    name: 'Dockerfile',
    filename: /^Dockerfile$/,
    load: () =>
      import('@codemirror/legacy-modes/mode/dockerfile').then(m => legacy(m.dockerFile)),
  }),
];

function mergeLanguageDescriptions(
  base: readonly LanguageDescription[],
  overrides: readonly LanguageDescription[],
): readonly LanguageDescription[] {
  const byName = new Map<string, LanguageDescription>();
  for (const language of base) {
    byName.set(language.name.toLowerCase(), language);
  }
  for (const language of overrides) {
    byName.set(language.name.toLowerCase(), language);
  }
  return [...byName.values()];
}

/**
 * Full fenced-code registry for markdown editors.
 *
 * We keep CodeMirror's broad language-data coverage so existing vault notes continue to resolve
 * common fence labels lazily, and only override a few entries where Eskerra wants explicit aliases
 * or loaders.
 */
export const eskerraFenceLanguages: readonly LanguageDescription[] =
  mergeLanguageDescriptions(codeMirrorLanguages, eskerraFenceLanguageOverrides);
