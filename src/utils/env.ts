import Constants from 'expo-constants';

type PublicEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  sentryDsn: string;
  termsVersion: string;
  privacyVersion: string;
  webBaseUrl: string;
  termsUrl: string;
  privacyUrl: string;
  appStoreUrl: string;
  playStoreUrl: string;
};

type ExpoExtra = {
  publicEnv?: Partial<PublicEnv>;
};

const expoExtra = (Constants.expoConfig?.extra ?? {}) as ExpoExtra;

function resolvePublicEnvValue(envKey: keyof PublicEnv, processValue: string | undefined): string {
  return expoExtra.publicEnv?.[envKey] ?? processValue ?? '';
}

export const publicEnv: PublicEnv = {
  supabaseUrl: resolvePublicEnvValue('supabaseUrl', process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: resolvePublicEnvValue(
    'supabaseAnonKey',
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  ),
  sentryDsn: resolvePublicEnvValue('sentryDsn', process.env.EXPO_PUBLIC_SENTRY_DSN),
  termsVersion: resolvePublicEnvValue('termsVersion', process.env.EXPO_PUBLIC_TERMS_VERSION),
  privacyVersion: resolvePublicEnvValue('privacyVersion', process.env.EXPO_PUBLIC_PRIVACY_VERSION),
  webBaseUrl: resolvePublicEnvValue('webBaseUrl', process.env.EXPO_PUBLIC_WEB_BASE_URL),
  termsUrl: resolvePublicEnvValue('termsUrl', undefined),
  privacyUrl: resolvePublicEnvValue('privacyUrl', undefined),
  appStoreUrl: resolvePublicEnvValue('appStoreUrl', process.env.EXPO_PUBLIC_APP_STORE_URL),
  playStoreUrl: resolvePublicEnvValue('playStoreUrl', process.env.EXPO_PUBLIC_PLAY_STORE_URL),
};

export function requirePublicEnvValue(key: keyof PublicEnv): string {
  const value = publicEnv[key];

  if (!value) {
    throw new Error(`Missing required public environment value: ${key}`);
  }

  return value;
}

const configuredScheme = Constants.expoConfig?.scheme;

export const appMetadata = {
  version: Constants.expoConfig?.version ?? '1.0.0',
  scheme:
    typeof configuredScheme === 'string' ? configuredScheme : (configuredScheme?.[0] ?? 'hrayem'),
  iosBundleIdentifier: Constants.expoConfig?.ios?.bundleIdentifier ?? 'app.hrayem',
  androidPackage: Constants.expoConfig?.android?.package ?? 'app.hrayem',
};

const normalizedWebBaseUrl = (publicEnv.webBaseUrl || 'https://www.hrayem.cz').replace(/\/+$/, '');

export const publicSiteLinks = {
  webBaseUrl: normalizedWebBaseUrl,
  termsUrl: publicEnv.termsUrl || `${normalizedWebBaseUrl}/terms`,
  privacyUrl: publicEnv.privacyUrl || `${normalizedWebBaseUrl}/privacy`,
  appStoreUrl: publicEnv.appStoreUrl || 'https://apps.apple.com/app/id6761645539',
  playStoreUrl: publicEnv.playStoreUrl || '',
};
