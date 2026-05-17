/* eslint-disable sonarjs/slow-regex -- Markdown normalization patterns are bounded per-line and required for syntax transforms. */
import {remark} from 'remark';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import {defaultHandlers} from 'mdast-util-to-markdown';
import type {VFile} from 'vfile';

import type {ResolvedCleanNoteOptions} from './types';

type AnyNode = {
  type: string;
  value?: string;
  depth?: number;
  children?: AnyNode[];
};

function trimLinkPadding(node: AnyNode): void {
  const children = node.children;
  if (!children || children.length === 0) {
    return;
  }
  const first = children[0]!;
  const last = children[children.length - 1]!;
  if (first.type === 'text' && typeof first.value === 'string') {
    first.value = first.value.replace(/^\s+/, '');
  }
  if (last.type === 'text' && typeof last.value === 'string') {
    last.value = last.value.replace(/\s+$/, '');
  }
}

function hasMeaningfulContent(node: AnyNode): boolean {
  if (typeof node.value === 'string' && node.value.trim().length > 0) {
    return true;
  }
  if (!node.children || node.children.length === 0) {
    return false;
  }
  for (const child of node.children) {
    if (hasMeaningfulContent(child)) {
      return true;
    }
  }
  return false;
}

function normalizeAst(tree: AnyNode, fileStem: string, resolved: ResolvedCleanNoteOptions): void {
  let hasH1 = false;
  walkTree(tree, node => {
    if (node.type === 'heading' && Number(node.depth ?? 1) === 1) {
      hasH1 = true;
    }
  });

  if (resolved.insertH1FromFilename && !hasH1 && tree.type === 'root') {
    if (!Array.isArray(tree.children)) {
      tree.children = [];
    }
    tree.children.unshift({
      type: 'heading',
      depth: 1,
      children: [{type: 'text', value: fileStem}],
    });
  }

  let previousHeadingDepth: number | null = null;
  walkTree(tree, (node, parent) => {
    if (node.type === 'heading') {
      const depth = Number(node.depth ?? 1);
      if (
        resolved.capHeadingDepthJumps
        && previousHeadingDepth !== null
        && depth > previousHeadingDepth + 1
      ) {
        node.depth = previousHeadingDepth + 1;
      }
      previousHeadingDepth = Number(node.depth ?? depth);
    }

    if (node.type === 'link' || node.type === 'linkReference') {
      trimLinkPadding(node);
    }

    if (
      resolved.removeEmptyListItems
      && parent
      && parent.children
      && parent.children.length > 0
    ) {
      parent.children = parent.children.filter(child => {
        return !(child.type === 'listItem' && !hasMeaningfulContent(child));
      });
    }
  });
}

function walkTree(
  node: AnyNode,
  visit: (node: AnyNode, parent: AnyNode | null) => void,
  parent: AnyNode | null = null,
): void {
  visit(node, parent);
  if (!node.children) {
    return;
  }
  for (const child of node.children) {
    walkTree(child, visit, node);
  }
}

function getSingleTextLinkValue(node: {children?: unknown[]}): string | null {
  if (!node || !Array.isArray(node.children) || node.children.length !== 1) {
    return null;
  }
  const [child] = node.children;
  const c = child as {type?: string; value?: unknown};
  if (!c || c.type !== 'text' || typeof c.value !== 'string') {
    return null;
  }
  return c.value;
}

function shouldSerializeAsPlainAutolink(node: {title?: unknown; url?: unknown}, text: string): boolean {
  if (!text || node?.title != null || typeof node?.url !== 'string') {
    return false;
  }
  const isHttpUrl = /^https?:\/\/\S+$/.test(text);
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
  if (!isHttpUrl && !isEmail) {
    return false;
  }
  if (isHttpUrl) {
    return node.url === text;
  }
  return node.url === text || node.url === `mailto:${text}`;
}

function unescapeAmpersandsInSerializedUrl(markdown: string): string {
  return markdown.replace(/\\&/g, '&');
}

const processorCache = new Map<string, ReturnType<typeof remark>>();

function createMarkdownProcessor(resolved: ResolvedCleanNoteOptions): ReturnType<typeof remark> {
  return remark()
    .use(remarkParse)
    .use(remarkGfm)
    .use(() => (tree: AnyNode, file: VFile) => {
      const fileStem = String((file.data as {fileStem?: string} | undefined)?.fileStem ?? '');
      normalizeAst(tree, fileStem, resolved);
    })
    .use(remarkStringify, {
      bullet: resolved.bullet,
      bulletOrdered: resolved.bulletOrdered,
      incrementListMarker: true,
      emphasis: resolved.emphasis,
      strong: resolved.strong,
      fence: '`',
      fences: true,
      rule: '-',
      setext: false,
      listItemIndent: resolved.listItemIndent,
      handlers: {
        link(node: unknown, parent: unknown, state: unknown, info: unknown): string {
          const n = node as {children?: unknown[]; title?: unknown; url?: unknown};
          const text = getSingleTextLinkValue(n);
          if (text && shouldSerializeAsPlainAutolink(n, text)) {
            return text;
          }
          return unescapeAmpersandsInSerializedUrl(
            defaultHandlers.link(node as never, parent as never, state as never, info as never),
          );
        },
        image(node: unknown, parent: unknown, state: unknown, info: unknown): string {
          return unescapeAmpersandsInSerializedUrl(
            defaultHandlers.image(node as never, parent as never, state as never, info as never),
          );
        },
        definition(node: unknown, parent: unknown, state: unknown, info: unknown): string {
          return unescapeAmpersandsInSerializedUrl(
            defaultHandlers.definition(node as never, parent as never, state as never, info as never),
          );
        },
      },
    });
}

export function getMarkdownProcessor(resolved: ResolvedCleanNoteOptions): ReturnType<typeof remark> {
  const key = JSON.stringify(resolved);
  let p = processorCache.get(key);
  if (!p) {
    p = createMarkdownProcessor(resolved);
    processorCache.set(key, p);
  }
  return p;
}

export function resetMarkdownProcessorCache(): void {
  processorCache.clear();
}
