import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Hrayem',
  slug: 'hrayem',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: 'hrayem',
  userInterfaceStyle: 'light',
  assetBundlePatterns: ['**/*'],
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#ffffff',
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'app.hrayem',
    buildNumber: '1',
    associatedDomains: ['applinks:hrayem.app'],
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Hrayem uses your location to suggest the nearest city during profile setup and help you find nearby games.',
      NSCameraUsageDescription: 'Hrayem uses the camera so you can take a profile photo.',
      NSPhotoLibraryUsageDescription:
        'Hrayem uses your photo library so you can choose a profile photo.',
      NSCalendarsFullAccessUsageDescription:
        'Hrayem uses calendar access so you can save games to your device calendar.',
    },
  },
  android: {
    package: 'app.hrayem',
    versionCode: 1,
    permissions: ['POST_NOTIFICATIONS'],
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          {
            scheme: 'https',
            host: 'hrayem.app',
            pathPrefix: '/event',
          },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
    predictiveBackGestureEnabled: false,
  },
  plugins: ['@sentry/react-native/expo'],
  extra: {
    publicEnv: {
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
      sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
      termsVersion: process.env.EXPO_PUBLIC_TERMS_VERSION ?? '',
      privacyVersion: process.env.EXPO_PUBLIC_PRIVACY_VERSION ?? '',
    },
  },
  web: {
    favicon: './assets/favicon.png',
  },
};

export default config;
