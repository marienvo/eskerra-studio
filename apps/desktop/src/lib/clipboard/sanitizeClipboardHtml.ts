import DOMPurify from 'dompurify';

/**
 * Sanitize untrusted clipboard HTML before any module-owned `DOMParser` use.
 * Matches the profile used for HTML-to-Markdown paste conversion.
 */
export function sanitizeClipboardHtml(html: string): string {
  return DOMPurify.sanitize(html, {USE_PROFILES: {html: true}});
}

/**
 * Sanitize clipboard HTML before parsing for `<img src>` extraction only.
 * Allows `blob:` and `data:image/…` sources needed for transient pasted images;
 * other URI schemes on `src` are stripped by DOMPurify.
 */
export function sanitizeClipboardHtmlForImgSrcExtraction(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: {html: true},
    ALLOWED_URI_REGEXP:
      /^(?:(?:https?|mailto|ftp|tel|file|blob|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  });
}
