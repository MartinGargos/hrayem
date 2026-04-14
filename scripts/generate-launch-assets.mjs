import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const outputDir = path.join(projectRoot, 'public', '.well-known');
const iosBundleIdentifier = 'com.martingargos.hrayem';
const androidPackage = 'app.hrayem';
const canonicalWebBaseUrl = 'https://www.hrayem.cz';

function requireEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required launch asset env: ${name}`);
  }

  return value;
}

function parseFingerprints(rawValue) {
  return rawValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeUrl(value) {
  return value.trim().replace(/\/+$/, '');
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

async function main() {
  const webBaseUrl = normalizeUrl(requireEnv('EXPO_PUBLIC_WEB_BASE_URL'));
  const appStoreUrl = requireEnv('EXPO_PUBLIC_APP_STORE_URL');
  const appleTeamId = requireEnv('HRAYEM_APPLE_TEAM_ID');
  const playStoreUrl = process.env.EXPO_PUBLIC_PLAY_STORE_URL?.trim() ?? '';
  const androidFingerprintValue = process.env.HRAYEM_ANDROID_SHA256_CERT_FINGERPRINTS?.trim() ?? '';
  const androidFingerprints = parseFingerprints(androidFingerprintValue);
  const androidDeferred = !playStoreUrl || !androidFingerprints.length;

  assert.equal(
    webBaseUrl,
    canonicalWebBaseUrl,
    `EXPO_PUBLIC_WEB_BASE_URL must be ${canonicalWebBaseUrl}. Got ${webBaseUrl}.`,
  );
  assert(
    isFinalAppStoreUrl(appStoreUrl),
    'EXPO_PUBLIC_APP_STORE_URL must be a final App Store listing URL, not a search fallback.',
  );
  assert(
    /^[A-Z0-9]{10}$/i.test(appleTeamId),
    'HRAYEM_APPLE_TEAM_ID must look like a 10-character Apple Team ID.',
  );

  if (!androidDeferred) {
    assert(
      isFinalPlayStoreUrl(playStoreUrl),
      'EXPO_PUBLIC_PLAY_STORE_URL must be a final Google Play listing URL when Android launch assets are generated.',
    );
  }

  const appleAssociation = {
    applinks: {
      apps: [],
      details: [
        {
          appIDs: [`${appleTeamId}.${iosBundleIdentifier}`],
          components: [
            {
              '/': '/event/*',
              comment: 'Hrayem shared event links',
            },
          ],
        },
      ],
    },
  };

  const assetLinks = androidDeferred
    ? null
    : [
        {
          relation: ['delegate_permission/common.handle_all_urls'],
          target: {
            namespace: 'android_app',
            package_name: androidPackage,
            sha256_cert_fingerprints: androidFingerprints,
          },
        },
      ];

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(
    path.join(outputDir, 'apple-app-site-association'),
    `${JSON.stringify(appleAssociation, null, 2)}\n`,
    'utf8',
  );

  const assetLinksPath = path.join(outputDir, 'assetlinks.json');

  if (assetLinks) {
    await fs.writeFile(assetLinksPath, `${JSON.stringify(assetLinks, null, 2)}\n`, 'utf8');
  } else {
    await fs.rm(assetLinksPath, { force: true });
  }

  console.log(
    JSON.stringify(
      {
        outputDir,
        iphoneWeb: {
          status: 'configured',
          webBaseUrl,
          appStoreUrl,
          iosBundleIdentifier,
          appleAppId: `${appleTeamId}.${iosBundleIdentifier}`,
          appleAssociationGenerated: true,
        },
        android: {
          status: androidDeferred ? 'deferred' : 'configured',
          playStoreUrl: playStoreUrl || null,
          assetLinksGenerated: Boolean(assetLinks),
          androidPackage,
          androidFingerprintCount: androidFingerprints.length,
        },
      },
      null,
      2,
    ),
  );
}

void main();
