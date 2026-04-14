import * as ExpoLinking from 'expo-linking';

import { appMetadata, publicSiteLinks } from '../utils/env';

export type EventDeepLinkTarget = {
  eventId: string;
  normalizedUrl: string;
  screen: 'detail' | 'chat';
};

export type DeveloperSurfaceTarget = 'foundation';

export type PublicWebsiteRouteTarget =
  | {
      kind: 'event';
      eventId: string;
      normalizedUrl: string;
      screen: 'detail' | 'chat';
    }
  | {
      kind: 'terms';
      normalizedUrl: string;
    }
  | {
      kind: 'privacy';
      normalizedUrl: string;
    };

const publicWebsiteHost = (() => {
  try {
    return new URL(publicSiteLinks.webBaseUrl).hostname.toLowerCase();
  } catch {
    return 'www.hrayem.cz';
  }
})();

const recognizedWebsiteHosts = new Set([publicWebsiteHost, 'hrayem.cz', 'hrayem.app']);

function normalizeDeepLinkUrl(url: string): string {
  const trimmedUrl = url.trim();

  if (/^[a-z]+:\/\//i.test(trimmedUrl)) {
    return trimmedUrl;
  }

  if ([...recognizedWebsiteHosts].some((host) => trimmedUrl.startsWith(`${host}/`))) {
    return `https://${trimmedUrl}`;
  }

  return trimmedUrl;
}

export function buildEventSchemeUrl(eventId: string): string {
  return `${appMetadata.scheme}://event/${eventId}`;
}

export function buildEventWebUrl(eventId: string): string {
  return `${publicSiteLinks.webBaseUrl}/event/${eventId}`;
}

export function buildChatSchemeUrl(eventId: string): string {
  return `${appMetadata.scheme}://event/${eventId}?screen=chat`;
}

export function buildChatWebUrl(eventId: string): string {
  return `${publicSiteLinks.webBaseUrl}/event/${eventId}?screen=chat`;
}

export function parseEventDeepLink(url: string): EventDeepLinkTarget | null {
  const normalizedUrl = normalizeDeepLinkUrl(url);
  const parsedUrl = ExpoLinking.parse(normalizedUrl);
  const scheme = parsedUrl.scheme?.toLowerCase() ?? null;
  const hostname = parsedUrl.hostname?.toLowerCase() ?? null;
  const screenParam = parsedUrl.queryParams?.screen;
  const screen =
    screenParam === 'chat' || parsedUrl.path?.endsWith('/chat') ? ('chat' as const) : 'detail';
  const pathSegments = (parsedUrl.path ?? '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (scheme === appMetadata.scheme && hostname === 'event' && pathSegments[0]) {
    return {
      eventId: decodeURIComponent(pathSegments[0]),
      normalizedUrl,
      screen,
    };
  }

  if (
    hostname &&
    recognizedWebsiteHosts.has(hostname) &&
    pathSegments[0] === 'event' &&
    pathSegments[1]
  ) {
    return {
      eventId: decodeURIComponent(pathSegments[1]),
      normalizedUrl,
      screen:
        screenParam === 'chat' || pathSegments[2] === 'chat'
          ? ('chat' as const)
          : ('detail' as const),
    };
  }

  return null;
}

export function isEventDeepLinkUrl(url: string): boolean {
  return parseEventDeepLink(url) !== null;
}

export function parsePublicWebsiteRoute(url: string): PublicWebsiteRouteTarget | null {
  const normalizedUrl = normalizeDeepLinkUrl(url);
  const parsedUrl = ExpoLinking.parse(normalizedUrl);
  const scheme = parsedUrl.scheme?.toLowerCase() ?? null;
  const pathSegments = (parsedUrl.path ?? '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  const screenParam = parsedUrl.queryParams?.screen;

  if (scheme !== 'http' && scheme !== 'https') {
    return null;
  }

  if (pathSegments[0] === 'terms') {
    return {
      kind: 'terms',
      normalizedUrl,
    };
  }

  if (pathSegments[0] === 'privacy') {
    return {
      kind: 'privacy',
      normalizedUrl,
    };
  }

  if (pathSegments[0] === 'event' && pathSegments[1]) {
    return {
      kind: 'event',
      eventId: decodeURIComponent(pathSegments[1]),
      normalizedUrl,
      screen:
        screenParam === 'chat' || pathSegments[2] === 'chat'
          ? ('chat' as const)
          : ('detail' as const),
    };
  }

  return null;
}

export function parseDeveloperSurfaceUrl(url: string): DeveloperSurfaceTarget | null {
  if (!__DEV__) {
    return null;
  }

  const normalizedUrl = normalizeDeepLinkUrl(url);
  const parsedUrl = ExpoLinking.parse(normalizedUrl);
  const scheme = parsedUrl.scheme?.toLowerCase() ?? null;
  const hostname = parsedUrl.hostname?.toLowerCase() ?? null;
  const pathSegments = (parsedUrl.path ?? '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (scheme === appMetadata.scheme && hostname === 'dev' && pathSegments[0] === 'foundation') {
    return 'foundation';
  }

  return null;
}
