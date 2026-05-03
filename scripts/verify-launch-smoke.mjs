import fs from 'node:fs/promises';
import path from 'node:path';

import { createClient } from '@supabase/supabase-js';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const iosBundleIdentifier = 'com.martingargos.hrayem';
const androidPackage = 'app.hrayem';
const canonicalWebBaseUrl = 'https://www.hrayem.cz';
const hostingConfigCandidates = [
  'vercel.json',
  'netlify.toml',
  'public/_redirects',
  'firebase.json',
  'staticwebapp.config.json',
];

function readEnv(name) {
  return process.env[name]?.trim() ?? '';
}

function normalizeUrl(value) {
  return value.trim().replace(/\/+$/, '');
}

function parseFingerprints(rawValue) {
  return rawValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isFinalAppStoreUrl(value) {
  return (
    value.startsWith('https://apps.apple.com/') &&
    /\/id\d+/.test(value) &&
    !value.includes('/search?')
  );
}

function isFinalPlayStoreUrl(value) {
  return (
    value.startsWith('https://play.google.com/store/apps/details?id=') &&
    !value.includes('/store/search?')
  );
}

async function fileExists(relativePath) {
  try {
    await fs.access(path.join(projectRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function firstExistingPath(relativePaths) {
  for (const relativePath of relativePaths) {
    if (await fileExists(relativePath)) {
      return relativePath;
    }
  }

  return null;
}

async function readJsonFile(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  const rawContents = await fs.readFile(absolutePath, 'utf8');
  return JSON.parse(rawContents);
}

async function fetchPage(url, headers = {}) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers,
    });
    const body = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      body: '',
      error: error instanceof Error ? error.message : 'Unknown fetch error.',
    };
  }
}

function parseJson(text) {
  try {
    return {
      data: JSON.parse(text),
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Invalid JSON.',
    };
  }
}

function addCheck(checks, { id, surface, status, detail, metadata = {} }) {
  checks.push({
    id,
    surface,
    status,
    detail,
    ...metadata,
  });
}

function buildLaunchStatus() {
  const webBaseUrl = readEnv('EXPO_PUBLIC_WEB_BASE_URL');
  const appStoreUrl = readEnv('EXPO_PUBLIC_APP_STORE_URL');
  const appleTeamId = readEnv('HRAYEM_APPLE_TEAM_ID');
  const playStoreUrl = readEnv('EXPO_PUBLIC_PLAY_STORE_URL');
  const androidFingerprints = parseFingerprints(readEnv('HRAYEM_ANDROID_SHA256_CERT_FINGERPRINTS'));

  let androidMode = 'configured';

  if (!playStoreUrl || !androidFingerprints.length) {
    androidMode = 'deferred';
  } else if (!isFinalPlayStoreUrl(playStoreUrl)) {
    androidMode = 'blocked';
  }

  return {
    iphoneWeb: {
      webBaseUrl: webBaseUrl ? normalizeUrl(webBaseUrl) : '',
      appStoreUrl,
      appleTeamId,
    },
    android: {
      mode: androidMode,
      playStoreUrl,
      expectedFingerprints: androidFingerprints,
    },
  };
}

function appleAssociationMatches(document, expectedAppleAppId) {
  const details = document?.applinks?.details;

  if (!Array.isArray(details)) {
    return false;
  }

  return details.some(
    (detail) =>
      Array.isArray(detail?.appIDs) &&
      detail.appIDs.includes(expectedAppleAppId) &&
      Array.isArray(detail?.components) &&
      detail.components.some((component) => component?.['/'] === '/event/*'),
  );
}

function assetLinksMatch(document, expectedFingerprints) {
  if (!Array.isArray(document)) {
    return {
      ok: false,
      missingFingerprints: expectedFingerprints,
      reason: 'assetlinks.json must contain a JSON array.',
    };
  }

  const androidAppLinkEntry = document.find(
    (entry) =>
      entry?.target?.namespace === 'android_app' &&
      entry?.target?.package_name === androidPackage,
  );

  if (!androidAppLinkEntry) {
    return {
      ok: false,
      missingFingerprints: expectedFingerprints,
      reason: `assetlinks.json must contain an android_app entry for ${androidPackage}.`,
    };
  }

  if (
    !Array.isArray(androidAppLinkEntry.relation) ||
    !androidAppLinkEntry.relation.includes('delegate_permission/common.handle_all_urls')
  ) {
    return {
      ok: false,
      missingFingerprints: expectedFingerprints,
      reason: 'assetlinks.json is missing the handle_all_urls relation.',
    };
  }

  const actualFingerprints = Array.isArray(androidAppLinkEntry.target?.sha256_cert_fingerprints)
    ? androidAppLinkEntry.target.sha256_cert_fingerprints
    : [];
  const missingFingerprints = expectedFingerprints.filter(
    (fingerprint) => !actualFingerprints.includes(fingerprint),
  );

  return {
    ok: missingFingerprints.length === 0,
    missingFingerprints,
    reason:
      missingFingerprints.length === 0
        ? null
        : `assetlinks.json is missing expected fingerprint(s): ${missingFingerprints.join(', ')}`,
  };
}

function summarizeSurface(checks, surface, deferred = false) {
  const surfaceChecks = checks.filter((check) => check.surface === surface);
  const blockers = surfaceChecks
    .filter((check) => check.status === 'failed')
    .map((check) => check.detail);

  let status = 'passed';

  if (deferred) {
    status = blockers.length > 0 ? 'blocked' : 'deferred';
  } else if (blockers.length > 0) {
    status = 'blocked';
  }

  return {
    status,
    blockers,
    checks: surfaceChecks,
  };
}

function createAnonClient(supabaseUrl, anonKey) {
  return createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

async function main() {
  const checks = [];
  const supabaseUrl = readEnv('EXPO_PUBLIC_SUPABASE_URL');
  const anonKey = readEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  const smokeEventId = readEnv('HRAYEM_SMOKE_EVENT_ID');
  const launch = buildLaunchStatus();
  const expectedAppleAppId = launch.iphoneWeb.appleTeamId
    ? `${launch.iphoneWeb.appleTeamId}.${iosBundleIdentifier}`
    : null;

  addCheck(checks, {
    id: 'web_base_url',
    surface: 'iphone_web',
    status:
      launch.iphoneWeb.webBaseUrl && launch.iphoneWeb.webBaseUrl === canonicalWebBaseUrl
        ? 'passed'
        : 'failed',
    detail: launch.iphoneWeb.webBaseUrl
      ? launch.iphoneWeb.webBaseUrl === canonicalWebBaseUrl
        ? `EXPO_PUBLIC_WEB_BASE_URL is pinned to ${canonicalWebBaseUrl}.`
        : `EXPO_PUBLIC_WEB_BASE_URL must be ${canonicalWebBaseUrl}. Got ${launch.iphoneWeb.webBaseUrl}.`
      : 'Missing EXPO_PUBLIC_WEB_BASE_URL.',
  });

  addCheck(checks, {
    id: 'app_store_url',
    surface: 'iphone_web',
    status: launch.iphoneWeb.appStoreUrl && isFinalAppStoreUrl(launch.iphoneWeb.appStoreUrl) ? 'passed' : 'failed',
    detail: launch.iphoneWeb.appStoreUrl
      ? isFinalAppStoreUrl(launch.iphoneWeb.appStoreUrl)
        ? 'EXPO_PUBLIC_APP_STORE_URL points at a final App Store listing.'
        : 'EXPO_PUBLIC_APP_STORE_URL must be a final App Store listing URL.'
      : 'Missing EXPO_PUBLIC_APP_STORE_URL.',
  });

  addCheck(checks, {
    id: 'apple_team_id',
    surface: 'iphone_web',
    status: /^[A-Z0-9]{10}$/i.test(launch.iphoneWeb.appleTeamId) ? 'passed' : 'failed',
    detail: launch.iphoneWeb.appleTeamId
      ? /^[A-Z0-9]{10}$/i.test(launch.iphoneWeb.appleTeamId)
        ? 'HRAYEM_APPLE_TEAM_ID looks valid.'
        : 'HRAYEM_APPLE_TEAM_ID must look like a 10-character Apple Team ID.'
      : 'Missing HRAYEM_APPLE_TEAM_ID.',
  });

  addCheck(checks, {
    id: 'supabase_public_env',
    surface: 'iphone_web',
    status: supabaseUrl && anonKey ? 'passed' : 'failed',
    detail:
      supabaseUrl && anonKey
        ? 'Public Supabase URL and anon key are available for read-only smoke checks.'
        : 'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY.',
  });

  addCheck(checks, {
    id: 'smoke_event_id',
    surface: 'iphone_web',
    status: isUuid(smokeEventId) ? 'passed' : 'failed',
    detail: smokeEventId
      ? isUuid(smokeEventId)
        ? 'HRAYEM_SMOKE_EVENT_ID is configured.'
        : 'HRAYEM_SMOKE_EVENT_ID must be a UUID for a stable public upcoming event.'
      : 'Missing HRAYEM_SMOKE_EVENT_ID for shared-environment share/fallback checks.',
  });

  const [termsPageExists, privacyPageExists, hostingConfigPath, appleAssociationExists] =
    await Promise.all([
      fileExists('public/terms/index.html'),
      fileExists('public/privacy/index.html'),
      firstExistingPath(hostingConfigCandidates),
      fileExists('public/.well-known/apple-app-site-association'),
    ]);

  addCheck(checks, {
    id: 'local_terms_page',
    surface: 'iphone_web',
    status: termsPageExists ? 'passed' : 'failed',
    detail: termsPageExists
      ? 'public/terms/index.html exists.'
      : 'Missing public/terms/index.html.',
  });

  addCheck(checks, {
    id: 'local_privacy_page',
    surface: 'iphone_web',
    status: privacyPageExists ? 'passed' : 'failed',
    detail: privacyPageExists
      ? 'public/privacy/index.html exists.'
      : 'Missing public/privacy/index.html.',
  });

  addCheck(checks, {
    id: 'hosting_config',
    surface: 'iphone_web',
    status: hostingConfigPath ? 'passed' : 'failed',
    detail: hostingConfigPath
      ? `Hosting config present at ${hostingConfigPath}.`
      : 'No committed hosting target/config found for the public website deployment.',
  });

  if (!appleAssociationExists) {
    addCheck(checks, {
      id: 'local_apple_association',
      surface: 'iphone_web',
      status: 'failed',
      detail: 'Missing public/.well-known/apple-app-site-association.',
    });
  } else if (!expectedAppleAppId) {
    addCheck(checks, {
      id: 'local_apple_association',
      surface: 'iphone_web',
      status: 'failed',
      detail: 'Cannot validate apple-app-site-association without HRAYEM_APPLE_TEAM_ID.',
    });
  } else {
    const localAppleAssociation = await readJsonFile('public/.well-known/apple-app-site-association');

    addCheck(checks, {
      id: 'local_apple_association',
      surface: 'iphone_web',
      status: appleAssociationMatches(localAppleAssociation, expectedAppleAppId) ? 'passed' : 'failed',
      detail: appleAssociationMatches(localAppleAssociation, expectedAppleAppId)
        ? `Local apple-app-site-association contains ${expectedAppleAppId} for /event/*.`
        : `Local apple-app-site-association must contain ${expectedAppleAppId} for /event/*.`,
    });
  }

  const assetLinksExists = await fileExists('public/.well-known/assetlinks.json');

  if (launch.android.mode === 'deferred') {
    addCheck(checks, {
      id: 'android_app_links',
      surface: 'android',
      status: 'skipped',
      detail: assetLinksExists
        ? 'Android launch proof is deferred; assetlinks.json is present but not part of the current MVP gate.'
        : 'Android launch proof is deferred; no assetlinks.json is required yet.',
    });
  } else if (launch.android.mode === 'blocked') {
    addCheck(checks, {
      id: 'android_app_links',
      surface: 'android',
      status: 'failed',
      detail:
        'EXPO_PUBLIC_PLAY_STORE_URL must be a final Google Play listing URL when Android launch proof is configured.',
    });
  } else if (!assetLinksExists) {
    addCheck(checks, {
      id: 'android_app_links',
      surface: 'android',
      status: 'failed',
      detail: 'Missing public/.well-known/assetlinks.json for configured Android launch proof.',
    });
  } else {
    const localAssetLinks = await readJsonFile('public/.well-known/assetlinks.json');
    const localAssetLinksResult = assetLinksMatch(
      localAssetLinks,
      launch.android.expectedFingerprints,
    );

    addCheck(checks, {
      id: 'android_app_links',
      surface: 'android',
      status: localAssetLinksResult.ok ? 'passed' : 'failed',
      detail: localAssetLinksResult.ok
        ? 'Local assetlinks.json matches the configured Android fingerprints.'
        : localAssetLinksResult.reason,
    });
  }

  if (launch.iphoneWeb.webBaseUrl) {
    const liveChecks = await Promise.all([
      fetchPage(`${launch.iphoneWeb.webBaseUrl}/privacy`),
      fetchPage(`${launch.iphoneWeb.webBaseUrl}/terms`),
      fetchPage(`${launch.iphoneWeb.webBaseUrl}/.well-known/apple-app-site-association`),
      isUuid(smokeEventId) ? fetchPage(`${launch.iphoneWeb.webBaseUrl}/event/${smokeEventId}`) : null,
    ]);
    const [livePrivacyPage, liveTermsPage, liveAppleAssociationPage, liveEventFallbackPage] =
      liveChecks;

    addCheck(checks, {
      id: 'live_privacy_page',
      surface: 'iphone_web',
      status: livePrivacyPage.ok ? 'passed' : 'failed',
      detail: livePrivacyPage.ok
        ? `Live ${launch.iphoneWeb.webBaseUrl}/privacy is serving correctly.`
        : `Live ${launch.iphoneWeb.webBaseUrl}/privacy is not serving correctly (${livePrivacyPage.status ?? livePrivacyPage.error}).`,
    });

    addCheck(checks, {
      id: 'live_terms_page',
      surface: 'iphone_web',
      status: liveTermsPage.ok ? 'passed' : 'failed',
      detail: liveTermsPage.ok
        ? `Live ${launch.iphoneWeb.webBaseUrl}/terms is serving correctly.`
        : `Live ${launch.iphoneWeb.webBaseUrl}/terms is not serving correctly (${liveTermsPage.status ?? liveTermsPage.error}).`,
    });

    if (!liveAppleAssociationPage.ok) {
      addCheck(checks, {
        id: 'live_apple_association',
        surface: 'iphone_web',
        status: 'failed',
        detail: `Live ${launch.iphoneWeb.webBaseUrl}/.well-known/apple-app-site-association is not serving correctly (${liveAppleAssociationPage.status ?? liveAppleAssociationPage.error}).`,
      });
    } else if (!expectedAppleAppId) {
      addCheck(checks, {
        id: 'live_apple_association',
        surface: 'iphone_web',
        status: 'failed',
        detail: 'Cannot validate live apple-app-site-association without HRAYEM_APPLE_TEAM_ID.',
      });
    } else {
      const liveAppleAssociation = parseJson(liveAppleAssociationPage.body);
      const liveAppleAssociationMatches =
        liveAppleAssociation.data &&
        appleAssociationMatches(liveAppleAssociation.data, expectedAppleAppId);

      addCheck(checks, {
        id: 'live_apple_association',
        surface: 'iphone_web',
        status:
          liveAppleAssociation.error || !liveAppleAssociationMatches ? 'failed' : 'passed',
        detail: liveAppleAssociation.error
          ? 'Live apple-app-site-association is not valid JSON.'
          : liveAppleAssociationMatches
            ? `Live apple-app-site-association contains ${expectedAppleAppId} for /event/*.`
            : `Live apple-app-site-association must contain ${expectedAppleAppId} for /event/*.`,
      });
    }

    if (liveEventFallbackPage) {
      addCheck(checks, {
        id: 'live_event_fallback',
        surface: 'iphone_web',
        status: liveEventFallbackPage.ok ? 'passed' : 'failed',
        detail: liveEventFallbackPage.ok
          ? `Live ${launch.iphoneWeb.webBaseUrl}/event/${smokeEventId} is serving correctly.`
          : `Live ${launch.iphoneWeb.webBaseUrl}/event/${smokeEventId} is not serving correctly (${liveEventFallbackPage.status ?? liveEventFallbackPage.error}).`,
      });
    }
  }

  if (supabaseUrl && anonKey && isUuid(smokeEventId)) {
    const anon = createAnonClient(supabaseUrl, anonKey);
    const appConfigResult = await anon
      .from('app_config')
      .select('key, value')
      .in('key', ['minimum_app_version_ios', 'minimum_app_version_android'])
      .order('key', { ascending: true });

    addCheck(checks, {
      id: 'anon_app_config_read',
      surface: 'iphone_web',
      status:
        !appConfigResult.error && (appConfigResult.data ?? []).length === 2 ? 'passed' : 'failed',
      detail: appConfigResult.error
        ? `Anon app_config read failed: ${appConfigResult.error.message}`
        : (appConfigResult.data ?? []).length === 2
          ? 'Anon app_config launch reads are available.'
          : 'Expected minimum_app_version_ios and minimum_app_version_android to be readable by anon.',
    });

    const shareResponse = await fetchPage(`${supabaseUrl}/functions/v1/share/event/${smokeEventId}`, {
      apikey: anonKey,
    });

    if (!shareResponse.ok) {
      addCheck(checks, {
        id: 'public_share_route',
        surface: 'iphone_web',
        status: 'failed',
        detail: `Public share route returned ${shareResponse.status ?? shareResponse.error} for the smoke event.`,
      });
    } else {
      const sharePayload = parseJson(shareResponse.body);
      const shareEvent = sharePayload.data?.data;
      const shareEventStartsAt = shareEvent?.starts_at ? Date.parse(shareEvent.starts_at) : Number.NaN;
      const shareEventIsUpcoming = Number.isFinite(shareEventStartsAt) && shareEventStartsAt > Date.now();
      const shareEventHasLaunchFields =
        typeof shareEvent?.sport_slug === 'string' &&
        shareEvent.sport_slug.length > 0 &&
        typeof shareEvent?.venue_name === 'string' &&
        shareEvent.venue_name.length > 0 &&
        typeof shareEvent?.city === 'string' &&
        shareEvent.city.length > 0;
      const shareEventStatusReady = shareEvent?.status === 'active' || shareEvent?.status === 'full';
      const shareRouteOk =
        !sharePayload.error &&
        shareEvent?.id === smokeEventId &&
        shareEventHasLaunchFields &&
        shareEventStatusReady &&
        shareEventIsUpcoming;

      addCheck(checks, {
        id: 'public_share_route',
        surface: 'iphone_web',
        status: shareRouteOk ? 'passed' : 'failed',
        detail: shareRouteOk
          ? 'Public share route returned the configured upcoming event with launch-ready fields.'
          : sharePayload.error
            ? `Public share route returned invalid JSON: ${sharePayload.error}`
            : shareEvent?.id !== smokeEventId
              ? 'Public share route did not return the configured smoke event.'
              : !shareEventHasLaunchFields
                ? 'Public share route response is missing sport, venue, or city fields.'
                : !shareEventStatusReady
                  ? `Smoke event must be active or full. Got ${shareEvent?.status ?? 'unknown'}.`
                  : 'Smoke event must still be upcoming for launch-day fallback checks.',
        metadata: shareEvent
          ? {
              eventId: shareEvent.id,
              eventStatus: shareEvent.status,
              eventCity: shareEvent.city,
              startsAt: shareEvent.starts_at,
            }
          : {},
      });
    }
  }

  const iphoneWeb = summarizeSurface(checks, 'iphone_web');
  const android = summarizeSurface(checks, 'android', launch.android.mode === 'deferred');
  const launchSmokePassed =
    iphoneWeb.blockers.length === 0 &&
    (launch.android.mode === 'deferred' || android.blockers.length === 0);

  const manualValidationStillRequired = [
    'Real iPhone install/open proof from an App Store or TestFlight build.',
    'On-device universal-link opening from Safari/Messages into the installed app.',
    'On-device force-update, terms re-consent, and push-notification delivery behavior.',
    'Any Android app-link proof until EXPO_PUBLIC_PLAY_STORE_URL and release fingerprints are final.',
  ];

  const summary = {
    scope: 'iphone_web_mvp_shared_environment',
    launchSmokePassed,
    iphoneWeb: {
      status: iphoneWeb.status,
      canonicalWebBaseUrl: launch.iphoneWeb.webBaseUrl || null,
      appStoreUrl: launch.iphoneWeb.appStoreUrl || null,
      smokeEventId: smokeEventId || null,
      blockers: iphoneWeb.blockers,
    },
    android: {
      status: android.status,
      playStoreUrl: launch.android.playStoreUrl || null,
      expectedFingerprintCount: launch.android.expectedFingerprints.length,
      blockers: android.blockers,
    },
    checks,
    manualValidationStillRequired,
  };

  for (const check of checks) {
    const prefix =
      check.status === 'passed' ? 'PASS' : check.status === 'skipped' ? 'SKIP' : 'FAIL';
    console.log(`${prefix} ${check.id}: ${check.detail}`);
  }

  console.log(JSON.stringify(summary, null, 2));

  if (!launchSmokePassed) {
    process.exitCode = 1;
  }
}

await main();
