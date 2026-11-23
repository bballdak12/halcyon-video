// Alt Video fork — hand Plex titles to the real Plex app on Android TV.
//
// Inside the Shield app (android-tv/), MainActivity exposes a JavaScript bridge
// named `HalcyonTV`. When it is present and the title came from a Plex server,
// playback goes to the Plex app — direct play, HDR, lossless audio and
// passthrough to the receiver — instead of this page's <video> player, which
// can do none of those. In any ordinary browser the bridge does not exist and
// nothing here changes behaviour.
import { activeProviderKind } from './providers/provider-registry';

interface HalcyonTvBridge {
  /** true when the Plex app was found and asked to play the item. */
  playInPlex(machineId: string, ratingKey: string): boolean;
}

function bridge(): HalcyonTvBridge | null {
  const b = (window as unknown as { HalcyonTV?: HalcyonTvBridge }).HalcyonTV;
  return b && typeof b.playInPlex === 'function' ? b : null;
}

const machineIds = new Map<string, string>();

/**
 * The server's machineIdentifier, which the Plex app needs to know WHICH
 * server the ratingKey belongs to. Asked of the server itself (/identity)
 * rather than trusting the session's userId, which is empty whenever the
 * plex.tv resource lookup failed (see PlexProvider.authenticate).
 */
async function machineIdFor(serverUrl: string, token: string, hint: string): Promise<string | null> {
  const base = serverUrl.replace(/\/+$/, '');
  const cached = machineIds.get(base);
  if (cached) return cached;
  try {
    const res = await fetch(`${base}/identity`, {
      headers: { Accept: 'application/json', 'X-Plex-Token': token },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const id = (await res.json())?.MediaContainer?.machineIdentifier;
      if (typeof id === 'string' && id) {
        machineIds.set(base, id);
        return id;
      }
    }
  } catch {
    // Fall through to the session's hint.
  }
  return hint || null;
}

/**
 * Try to play `ratingKey` in the Plex app. Resolves false — and the caller
 * falls back to the in-app player — outside the Shield app, for non-Plex
 * titles, or when the Plex app is not installed.
 */
export async function handOffToPlexApp(
  kind: string | undefined, serverUrl: string, token: string, hintMachineId: string, ratingKey: string,
): Promise<boolean> {
  const b = bridge();
  if (!b || (kind ?? activeProviderKind()) !== 'plex' || !ratingKey) return false;
  const machineId = await machineIdFor(serverUrl, token, hintMachineId);
  if (!machineId) return false;
  try {
    return b.playInPlex(machineId, ratingKey) === true;
  } catch {
    return false;
  }
}
