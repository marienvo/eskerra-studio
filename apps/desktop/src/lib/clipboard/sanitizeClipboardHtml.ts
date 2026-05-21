import DOMPurify, {type UponSanitizeAttributeHook} from 'dompurify';

const TRANSIENT_IMAGE_SRC_REGEXP = /^(?:blob:|data:image\/)/i;

function sanitizeClipboardHtmlWithDefaultUris(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: {html: true},
  });
}

const keepTransientImageSrc: UponSanitizeAttributeHook = (node, hookEvent) => {
  if (
    hookEvent.attrName === 'src'
    && node.nodeName.toLowerCase() === 'img'
    && TRANSIENT_IMAGE_SRC_REGEXP.test(hookEvent.attrValue.trim())
  ) {
    hookEvent.forceKeepAttr = true;
  }
};

/**
 * Sanitize untrusted clipboard HTML before any module-owned `DOMParser` use.
 * Matches the profile used for HTML-to-Markdown paste conversion.
 */
export function sanitizeClipboardHtml(html: string): string {
  return sanitizeClipboardHtmlWithDefaultUris(html);
}

/**
 * Sanitize clipboard HTML before parsing for `<img src>` extraction only.
 * Allows `blob:` and `data:image/…` sources needed for transient pasted images;
 * other URI schemes on `src` are stripped by DOMPurify.
 */
export function sanitizeClipboardHtmlForImgSrcExtraction(html: string): string {
  DOMPurify.addHook('uponSanitizeAttribute', keepTransientImageSrc);
  try {
    return sanitizeClipboardHtmlWithDefaultUris(html);
  } finally {
    DOMPurify.removeHook('uponSanitizeAttribute', keepTransientImageSrc);
  }
}
