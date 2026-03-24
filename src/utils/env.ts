import Constants from 'expo-constants';

type PublicEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  sentryDsn: string;
  termsVersion: string;
  privacyVersion: string;
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
