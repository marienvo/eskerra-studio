/**
 * MediaSession artwork is ultimately handed to GNOME over MPRIS. Internal Tauri
 * asset URLs and raw file URLs can produce a broken empty artwork slot there, so
 * only pass through web URLs that the shell or WebKit can fetch directly.
 */
export function resolveArtworkSrcForMediaSession(
  artworkUrl: string | null | undefined,
): string | null {
  if (artworkUrl == null) {
    return null;
  }
  const trimmed = artworkUrl.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed;
  }
  return null;
}

export function buildMediaSessionArtwork(
  artworkUrl: string | null | undefined,
): MediaImage[] {
  const src = resolveArtworkSrcForMediaSession(artworkUrl);
  if (src == null) {
    return [];
  }
  return [{src, sizes: '512x512'} as MediaImage];
}
