import * as ExpoLinking from 'expo-linking';

import { appMetadata } from '../utils/env';

export type EventDeepLinkTarget = {
  eventId: string;
  normalizedUrl: string;
};

function normalizeDeepLinkUrl(url: string): string {
  const trimmedUrl = url.trim();

  if (/^[a-z]+:\/\//i.test(trimmedUrl)) {
    return trimmedUrl;
  }

  if (trimmedUrl.startsWith('hrayem.app/')) {
    return `https://${trimmedUrl}`;
  }

  return trimmedUrl;
}

export function buildEventSchemeUrl(eventId: string): string {
  return `${appMetadata.scheme}://event/${eventId}`;
}

export function buildEventWebUrl(eventId: string): string {
  return `https://hrayem.app/event/${eventId}`;
}

export function parseEventDeepLink(url: string): EventDeepLinkTarget | null {
  const normalizedUrl = normalizeDeepLinkUrl(url);
  const parsedUrl = ExpoLinking.parse(normalizedUrl);
  const scheme = parsedUrl.scheme?.toLowerCase() ?? null;
  const hostname = parsedUrl.hostname?.toLowerCase() ?? null;
  const pathSegments = (parsedUrl.path ?? '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (scheme === appMetadata.scheme && hostname === 'event' && pathSegments[0]) {
    return {
      eventId: decodeURIComponent(pathSegments[0]),
      normalizedUrl,
    };
  }

  if (hostname === 'hrayem.app' && pathSegments[0] === 'event' && pathSegments[1]) {
    return {
      eventId: decodeURIComponent(pathSegments[1]),
      normalizedUrl,
    };
  }

  return null;
}

export function isEventDeepLinkUrl(url: string): boolean {
  return parseEventDeepLink(url) !== null;
}
