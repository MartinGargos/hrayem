import assert from 'node:assert/strict';
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

function requiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }

  return value;
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

function normalizeUrl(value) {
  return value.trim().replace(/\/+$/, '');
}

function parseFingerprints(rawValue) {
  return rawValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
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

function buildLaunchStatus() {
  const webBaseUrl = process.env.EXPO_PUBLIC_WEB_BASE_URL?.trim() ?? '';
  const appStoreUrl = process.env.EXPO_PUBLIC_APP_STORE_URL?.trim() ?? '';
  const appleTeamId = process.env.HRAYEM_APPLE_TEAM_ID?.trim() ?? '';
  const playStoreUrl = process.env.EXPO_PUBLIC_PLAY_STORE_URL?.trim() ?? '';
  const androidFingerprintValue = process.env.HRAYEM_ANDROID_SHA256_CERT_FINGERPRINTS?.trim() ?? '';
  const androidFingerprints = parseFingerprints(androidFingerprintValue);

  const iphoneWebBlockers = [];
  const androidBlockers = [];
  const normalizedWebBaseUrl = webBaseUrl ? normalizeUrl(webBaseUrl) : '';

  if (!webBaseUrl) {
    iphoneWebBlockers.push('Missing EXPO_PUBLIC_WEB_BASE_URL.');
  } else if (normalizedWebBaseUrl !== canonicalWebBaseUrl) {
    iphoneWebBlockers.push(
      `EXPO_PUBLIC_WEB_BASE_URL must be ${canonicalWebBaseUrl}. Got ${normalizedWebBaseUrl}.`,
    );
  }

  if (!appStoreUrl) {
    iphoneWebBlockers.push('Missing EXPO_PUBLIC_APP_STORE_URL.');
  } else if (!isFinalAppStoreUrl(appStoreUrl)) {
    iphoneWebBlockers.push(
      'EXPO_PUBLIC_APP_STORE_URL must be a final App Store listing URL, not a search fallback.',
    );
  }

  if (!appleTeamId) {
    iphoneWebBlockers.push('Missing HRAYEM_APPLE_TEAM_ID.');
  } else if (!/^[A-Z0-9]{10}$/i.test(appleTeamId)) {
    iphoneWebBlockers.push('HRAYEM_APPLE_TEAM_ID must look like a 10-character Apple Team ID.');
  }

  let androidStatus = 'configured';

  if (!playStoreUrl || !androidFingerprints.length) {
    androidStatus = 'deferred';
  } else if (!isFinalPlayStoreUrl(playStoreUrl)) {
    androidStatus = 'blocked';
    androidBlockers.push(
      'EXPO_PUBLIC_PLAY_STORE_URL must be a final Google Play listing URL when Android launch proof is configured.',
    );
  }

  return {
    iphoneWeb: {
      webBaseUrl: normalizedWebBaseUrl || null,
      appStoreUrl: appStoreUrl || null,
      appleTeamId: appleTeamId || null,
      blockers: iphoneWebBlockers,
    },
    android: {
      status: androidStatus,
      playStoreUrl: playStoreUrl || null,
      fingerprintCount: androidFingerprints.length,
      expectedFingerprints: androidFingerprints,
      blockers: androidBlockers,
    },
  };
}

async function readJsonFile(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  const rawContents = await fs.readFile(absolutePath, 'utf8');
  return JSON.parse(rawContents);
}

async function fetchLivePage(url) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
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
      error: error instanceof Error ? error.message : 'Unknown live fetch error.',
    };
  }
}

async function main() {
  const supabaseUrl = requiredEnv('EXPO_PUBLIC_SUPABASE_URL');
  const anonKey = requiredEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const launch = buildLaunchStatus();
  const iphoneWebBlockers = [...launch.iphoneWeb.blockers];
  const androidBlockers = [...launch.android.blockers];

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const [termsPageExists, privacyPageExists, hostingConfigPath] = await Promise.all([
    fileExists('public/terms/index.html'),
    fileExists('public/privacy/index.html'),
    firstExistingPath(hostingConfigCandidates),
  ]);

  if (!termsPageExists) {
    iphoneWebBlockers.push('Missing public/terms/index.html.');
  }

  if (!privacyPageExists) {
    iphoneWebBlockers.push('Missing public/privacy/index.html.');
  }

  if (!hostingConfigPath) {
    iphoneWebBlockers.push(
      'No committed hosting target/config found for the public website deployment.',
    );
  }

  const appleAssociationPath = 'public/.well-known/apple-app-site-association';
  const assetLinksPath = 'public/.well-known/assetlinks.json';
  const appleAssociationExists = await fileExists(appleAssociationPath);
  const assetLinksExists = await fileExists(assetLinksPath);

  let appleAssociationMatches = false;
  let assetLinksMatch = false;

  if (!appleAssociationExists) {
    iphoneWebBlockers.push('Missing public/.well-known/apple-app-site-association.');
  } else if (launch.iphoneWeb.appleTeamId) {
    const appleAssociation = await readJsonFile(appleAssociationPath);
    const expectedAppleAppId = `${launch.iphoneWeb.appleTeamId}.${iosBundleIdentifier}`;
    const appleDetails = appleAssociation?.applinks?.details;

    if (!Array.isArray(appleDetails)) {
      iphoneWebBlockers.push('apple-app-site-association is missing applinks.details.');
    } else {
      appleAssociationMatches = appleDetails.some(
        (detail) =>
          Array.isArray(detail?.appIDs) &&
          detail.appIDs.includes(expectedAppleAppId) &&
          Array.isArray(detail?.components) &&
          detail.components.some((component) => component?.['/'] === '/event/*'),
      );

      if (!appleAssociationMatches) {
        iphoneWebBlockers.push(
          `apple-app-site-association must contain ${expectedAppleAppId} for /event/*.`,
        );
      }
    }
  }

  const liveWebsiteBaseUrl = launch.iphoneWeb.webBaseUrl;
  let livePrivacyPageOk = false;
  let liveTermsPageOk = false;
  let liveAppleAssociationOk = false;

  if (liveWebsiteBaseUrl) {
    const [livePrivacyResult, liveTermsResult, liveAppleAssociationResult] = await Promise.all([
      fetchLivePage(`${liveWebsiteBaseUrl}/privacy`),
      fetchLivePage(`${liveWebsiteBaseUrl}/terms`),
      fetchLivePage(`${liveWebsiteBaseUrl}/.well-known/apple-app-site-association`),
    ]);

    livePrivacyPageOk = livePrivacyResult.ok;
    liveTermsPageOk = liveTermsResult.ok;

    if (!livePrivacyResult.ok) {
      iphoneWebBlockers.push(
        `Live ${liveWebsiteBaseUrl}/privacy is not serving correctly (${livePrivacyResult.status ?? livePrivacyResult.error}).`,
      );
    }

    if (!liveTermsResult.ok) {
      iphoneWebBlockers.push(
        `Live ${liveWebsiteBaseUrl}/terms is not serving correctly (${liveTermsResult.status ?? liveTermsResult.error}).`,
      );
    }

    if (!liveAppleAssociationResult.ok) {
      iphoneWebBlockers.push(
        `Live ${liveWebsiteBaseUrl}/.well-known/apple-app-site-association is not serving correctly (${liveAppleAssociationResult.status ?? liveAppleAssociationResult.error}).`,
      );
    } else if (launch.iphoneWeb.appleTeamId) {
      try {
        const liveAppleAssociation = JSON.parse(liveAppleAssociationResult.body);
        const expectedAppleAppId = `${launch.iphoneWeb.appleTeamId}.${iosBundleIdentifier}`;
        const liveAppleDetails = liveAppleAssociation?.applinks?.details;

        liveAppleAssociationOk =
          Array.isArray(liveAppleDetails) &&
          liveAppleDetails.some(
            (detail) =>
              Array.isArray(detail?.appIDs) &&
              detail.appIDs.includes(expectedAppleAppId) &&
              Array.isArray(detail?.components) &&
              detail.components.some((component) => component?.['/'] === '/event/*'),
          );

        if (!liveAppleAssociationOk) {
          iphoneWebBlockers.push(
            `Live apple-app-site-association does not contain ${expectedAppleAppId} for /event/*.`,
          );
        }
      } catch {
        iphoneWebBlockers.push('Live apple-app-site-association is not valid JSON.');
      }
    }
  }

  if (launch.android.status === 'configured') {
    if (!assetLinksExists) {
      androidBlockers.push(
        'Missing public/.well-known/assetlinks.json for configured Android launch proof.',
      );
    } else {
      const assetLinks = await readJsonFile(assetLinksPath);

      if (!Array.isArray(assetLinks)) {
        androidBlockers.push('assetlinks.json must contain a JSON array.');
      } else {
        const androidAppLinkEntry = assetLinks.find(
          (entry) =>
            entry?.target?.namespace === 'android_app' &&
            entry?.target?.package_name === androidPackage,
        );

        if (!androidAppLinkEntry) {
          androidBlockers.push(
            `assetlinks.json must contain an android_app entry for ${androidPackage}.`,
          );
        } else if (
          !Array.isArray(androidAppLinkEntry.relation) ||
          !androidAppLinkEntry.relation.includes('delegate_permission/common.handle_all_urls')
        ) {
          androidBlockers.push('assetlinks.json is missing the handle_all_urls relation.');
        } else {
          const actualFingerprints = Array.isArray(
            androidAppLinkEntry.target?.sha256_cert_fingerprints,
          )
            ? androidAppLinkEntry.target.sha256_cert_fingerprints
            : [];
          const missingFingerprints = launch.android.expectedFingerprints.filter(
            (fingerprint) => !actualFingerprints.includes(fingerprint),
          );

          assetLinksMatch = missingFingerprints.length === 0;

          if (!assetLinksMatch) {
            androidBlockers.push(
              `assetlinks.json is missing expected fingerprint(s): ${missingFingerprints.join(', ')}`,
            );
          }
        }
      }
    }
  } else if (assetLinksExists) {
    androidBlockers.push(
      'public/.well-known/assetlinks.json exists even though Android launch proof is currently deferred.',
    );
  }

  const [
    { data: sportRow, error: sportError },
    { data: venueRow, error: venueError },
    profileResult,
  ] = await Promise.all([
    service.from('sports').select('id').eq('slug', 'badminton').single(),
    service.from('venues').select('id, city').limit(1).single(),
    service
      .from('profiles')
      .select('id')
      .eq('is_deleted', false)
      .not('first_name', 'is', null)
      .limit(1)
      .single(),
  ]);

  if (sportError || !sportRow?.id) {
    iphoneWebBlockers.push(
      `Unable to load sport for Milestone 11 verifier: ${sportError?.message}`,
    );
  }

  if (venueError || !venueRow?.id || !venueRow.city) {
    iphoneWebBlockers.push(
      `Unable to load venue for Milestone 11 verifier: ${venueError?.message}`,
    );
  }

  if (profileResult.error || !profileResult.data?.id) {
    iphoneWebBlockers.push(
      `Unable to load organizer profile for Milestone 11 verifier: ${profileResult.error?.message}`,
    );
  }

  let publicRouteProven = false;
  let liveEventFallbackOk = false;
  let eventId = null;

  if (sportRow?.id && venueRow?.id && venueRow.city && profileResult.data?.id) {
    const startsAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    const endsAt = new Date(Date.now() + 74 * 60 * 60 * 1000).toISOString();

    const insertEventResult = await service
      .from('events')
      .insert({
        sport_id: sportRow.id,
        organizer_id: profileResult.data.id,
        venue_id: venueRow.id,
        starts_at: startsAt,
        ends_at: endsAt,
        city: venueRow.city,
        reservation_type: 'reserved',
        player_count_total: 4,
        skill_min: 2,
        skill_max: 4,
        description: 'Milestone 11 public share verification event.',
        status: 'active',
      })
      .select('id')
      .single();

    if (insertEventResult.error || !insertEventResult.data?.id) {
      iphoneWebBlockers.push(
        `Unable to insert Milestone 11 verifier event: ${insertEventResult.error?.message}`,
      );
    } else {
      eventId = insertEventResult.data.id;

      try {
        const insertPlayerResult = await service.from('event_players').insert({
          event_id: eventId,
          user_id: profileResult.data.id,
          status: 'confirmed',
        });

        if (insertPlayerResult.error) {
          iphoneWebBlockers.push(
            `Unable to insert verifier organizer membership: ${insertPlayerResult.error.message}`,
          );
        } else {
          const shareResponse = await fetch(`${supabaseUrl}/functions/v1/share/event/${eventId}`, {
            method: 'GET',
            headers: {
              apikey: anonKey,
            },
          });
          const shareBody = await shareResponse.json().catch(() => null);

          if (shareResponse.status !== 200) {
            iphoneWebBlockers.push(`Expected share route 200, got ${shareResponse.status}.`);
          } else if (shareBody?.data?.id !== eventId) {
            iphoneWebBlockers.push('Expected share route to return the created event.');
          } else {
            publicRouteProven = true;

            if (liveWebsiteBaseUrl) {
              const liveEventResult = await fetchLivePage(`${liveWebsiteBaseUrl}/event/${eventId}`);

              liveEventFallbackOk = liveEventResult.ok;

              if (!liveEventResult.ok) {
                iphoneWebBlockers.push(
                  `Live ${liveWebsiteBaseUrl}/event/{id} fallback is not serving correctly (${liveEventResult.status ?? liveEventResult.error}).`,
                );
              }
            }
          }
        }
      } finally {
        await service.from('events').delete().eq('id', eventId);
      }
    }
  }

  const androidStatus =
    launch.android.status === 'deferred'
      ? 'deferred'
      : androidBlockers.length > 0
        ? 'blocked'
        : 'configured';

  console.log(
    JSON.stringify(
      {
        iphoneWeb: {
          status: iphoneWebBlockers.length === 0 ? 'proven' : 'blocked',
          canonicalWebBaseUrl: launch.iphoneWeb.webBaseUrl,
          appStoreUrl: launch.iphoneWeb.appStoreUrl,
          appleTeamIdPresent: Boolean(launch.iphoneWeb.appleTeamId),
          staticPages: {
            termsPageExists,
            privacyPageExists,
          },
          hosting: {
            configPresent: Boolean(hostingConfigPath),
            configPath: hostingConfigPath,
          },
          liveWebsite: {
            privacyPageOk: livePrivacyPageOk,
            termsPageOk: liveTermsPageOk,
            appleAssociationOk: liveAppleAssociationOk,
            eventFallbackOk: liveEventFallbackOk,
          },
          appleAssociation: {
            fileExists: appleAssociationExists,
            matchesConfiguredTeamId: appleAssociationMatches,
          },
          shareFallback: {
            eventId,
            publicRouteProven,
          },
          blockers: iphoneWebBlockers,
        },
        android: {
          status: androidStatus,
          playStoreUrl: launch.android.playStoreUrl,
          fingerprintCount: launch.android.fingerprintCount,
          assetLinksFileExists: assetLinksExists,
          assetLinksMatch,
          blockers: androidBlockers,
        },
        fullMilestoneReady: iphoneWebBlockers.length === 0 && androidStatus === 'configured',
      },
      null,
      2,
    ),
  );

  assert.equal(
    iphoneWebBlockers.length,
    0,
    `Milestone 11 iPhone/web blockers: ${iphoneWebBlockers.join('; ')}`,
  );
}

await main();
