import * as ExpoLinking from 'expo-linking';
import * as Sentry from '@sentry/react-native';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { OfflineBanner } from './src/components/OfflineBanner';
import { AuthFlowScreen } from './src/features/auth/AuthFlowScreen';
import { BlockingMessageScreen } from './src/features/auth/BlockingMessageScreen';
import { ForceUpdateScreen } from './src/features/auth/ForceUpdateScreen';
import { LoadingScreen } from './src/features/auth/LoadingScreen';
import { ProfileSetupScreen } from './src/features/auth/ProfileSetupScreen';
import { TermsReconsentScreen } from './src/features/auth/TermsReconsentScreen';
import { HomeEntryScreen } from './src/features/home/HomeEntryScreen';
import i18n from './src/i18n';
import { bindAppStateToQueryFocus, queryClient } from './src/lib/query-client';
import {
  fetchCurrentUserProfile,
  fetchMinimumSupportedVersion,
  hasAcceptedConsentVersions,
} from './src/services/app-bootstrap';
import { registerPushTokenIfNeeded } from './src/services/push-notifications';
import {
  bindSupabaseAuthAutoRefresh,
  bootstrapSupabaseSession,
  handleSupabaseAuthCallback,
  registerSupabaseAuthListener,
} from './src/services/supabase';
import { useAuthStore } from './src/store/auth-store';
import { useUIStore } from './src/store/ui-store';
import { useUserStore } from './src/store/user-store';
import { appMetadata, publicEnv } from './src/utils/env';
import { compareVersions } from './src/utils/version';

Sentry.init({
  dsn: publicEnv.sentryDsn || undefined,
  enabled: Boolean(publicEnv.sentryDsn),
  sendDefaultPii: false,
  beforeSend: (event) => {
    if (event.user) {
      delete event.user;
    }

    return event;
  },
});

function AppShell() {
  const authHasHydrated = useAuthStore((state) => state.hasHydrated);
  const authStatus = useAuthStore((state) => state.status);
  const userId = useAuthStore((state) => state.userId);
  const userHasHydrated = useUserStore((state) => state.hasHydrated);
  const language = useUserStore((state) => state.language);
  const setProfile = useUserStore((state) => state.setProfile);
  const setSelectedCity = useUserStore((state) => state.setSelectedCity);
  const setLanguagePreference = useUserStore((state) => state.setLanguage);
  const authScreen = useUIStore((state) => state.authScreen);
  const setAuthNotice = useUIStore((state) => state.setAuthNotice);
  const bootstrapStartedRef = useRef(false);

  useEffect(() => {
    const unsubscribe = registerSupabaseAuthListener();
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = bindSupabaseAuthAutoRefresh();
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = bindAppStateToQueryFocus();
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!userHasHydrated) {
      return;
    }

    void i18n.changeLanguage(language);
  }, [language, userHasHydrated]);

  useEffect(() => {
    if (!authHasHydrated || bootstrapStartedRef.current) {
      return;
    }

    bootstrapStartedRef.current = true;
    void bootstrapSupabaseSession();
  }, [authHasHydrated]);

  useEffect(() => {
    let isActive = true;

    async function maybeHandleAuthUrl(url: string | null) {
      if (!url) {
        return;
      }

      try {
        const handled = await handleSupabaseAuthCallback(url);

        if (!handled || !isActive) {
          return;
        }
      } catch {
        if (!isActive) {
          return;
        }

        setAuthNotice({
          messageKey: 'auth.errors.callback',
          tone: 'error',
        });
      }
    }

    const subscription = ExpoLinking.addEventListener('url', ({ url }) => {
      void maybeHandleAuthUrl(url);
    });

    void ExpoLinking.getInitialURL().then((url) => maybeHandleAuthUrl(url));

    return () => {
      isActive = false;
      subscription.remove();
    };
  }, [setAuthNotice]);

  const minimumVersionQuery = useQuery({
    queryKey: ['app-config', 'minimum-version'],
    queryFn: fetchMinimumSupportedVersion,
    enabled: authHasHydrated && userHasHydrated,
    staleTime: 86_400_000,
    retry: 1,
  });

  const profileQuery = useQuery({
    queryKey: ['profile', userId],
    queryFn: () => fetchCurrentUserProfile(userId ?? ''),
    enabled: authStatus === 'authenticated' && Boolean(userId),
    staleTime: 300_000,
  });

  const consentQuery = useQuery({
    queryKey: ['consent', userId, publicEnv.termsVersion, publicEnv.privacyVersion],
    queryFn: () =>
      hasAcceptedConsentVersions(userId ?? '', publicEnv.termsVersion, publicEnv.privacyVersion),
    enabled:
      authStatus === 'authenticated' &&
      Boolean(userId) &&
      Boolean(publicEnv.termsVersion) &&
      Boolean(publicEnv.privacyVersion),
    staleTime: 300_000,
  });

  useEffect(() => {
    if (!profileQuery.data) {
      return;
    }

    setProfile(profileQuery.data);
    setSelectedCity(profileQuery.data.city);
    setLanguagePreference(profileQuery.data.language);
  }, [profileQuery.data, setLanguagePreference, setProfile, setSelectedCity]);

  useEffect(() => {
    if (authStatus !== 'authenticated' || !userId) {
      return;
    }

    let isActive = true;

    void registerPushTokenIfNeeded().catch(() => {
      if (!isActive) {
        return;
      }

      setAuthNotice({
        messageKey: 'auth.errors.pushToken',
        tone: 'error',
      });
    });

    return () => {
      isActive = false;
    };
  }, [authStatus, setAuthNotice, userId]);

  const isStoresHydrating = !authHasHydrated || !userHasHydrated;
  const isAuthBootstrapping = authStatus === 'idle' || authStatus === 'loading';
  const isAuthenticatedLoading =
    authStatus === 'authenticated' &&
    (profileQuery.isPending ||
      consentQuery.isPending ||
      (!profileQuery.data && !profileQuery.isError));

  if (
    isStoresHydrating ||
    isAuthBootstrapping ||
    minimumVersionQuery.isPending ||
    isAuthenticatedLoading
  ) {
    return <LoadingScreen />;
  }

  if (minimumVersionQuery.isError) {
    return (
      <BlockingMessageScreen
        actionLabelKey="auth.launchError.retry"
        onAction={() => {
          void minimumVersionQuery.refetch();
        }}
        subtitleKey="auth.launchError.subtitle"
        titleKey="auth.launchError.title"
      />
    );
  }

  if (
    minimumVersionQuery.data &&
    compareVersions(appMetadata.version, minimumVersionQuery.data) < 0
  ) {
    return <ForceUpdateScreen />;
  }

  if (authStatus !== 'authenticated' || !userId) {
    return <AuthFlowScreen />;
  }

  if (authScreen === 'reset-password') {
    return <AuthFlowScreen />;
  }

  if (profileQuery.isError) {
    return (
      <BlockingMessageScreen
        actionLabelKey="auth.launchError.retry"
        onAction={() => {
          void profileQuery.refetch();
        }}
        subtitleKey="auth.profileError.subtitle"
        titleKey="auth.profileError.title"
      />
    );
  }

  if (consentQuery.isError) {
    return (
      <BlockingMessageScreen
        actionLabelKey="auth.launchError.retry"
        onAction={() => {
          void consentQuery.refetch();
        }}
        subtitleKey="auth.consentError.subtitle"
        titleKey="auth.consentError.title"
      />
    );
  }

  if (!consentQuery.data) {
    return (
      <TermsReconsentScreen
        onAccepted={async () => {
          await consentQuery.refetch();
        }}
        userId={userId}
      />
    );
  }

  if (!profileQuery.data?.profileComplete) {
    return (
      <ProfileSetupScreen
        onCompleted={async () => {
          await profileQuery.refetch();
        }}
        profile={
          profileQuery.data ?? {
            id: userId,
            firstName: null,
            lastName: null,
            photoUrl: null,
            city: null,
            language,
            latitude: null,
            longitude: null,
            profileComplete: false,
          }
        }
        userId={userId}
      />
    );
  }

  return <HomeEntryScreen profile={profileQuery.data} />;
}

export default Sentry.wrap(function RootApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <OfflineBanner />
        <Sentry.ErrorBoundary
          fallback={
            <View style={styles.errorFallback}>
              <Text style={styles.errorTitle}>{i18n.t('foundation.errorFallbackTitle')}</Text>
              <Text style={styles.errorBody}>{i18n.t('foundation.errorFallbackBody')}</Text>
            </View>
          }
        >
          <AppShell />
        </Sentry.ErrorBoundary>
      </SafeAreaView>
    </QueryClientProvider>
  );
});

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f7f0e6',
  },
  errorFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#f7f0e6',
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#183153',
  },
  errorBody: {
    marginTop: 12,
    textAlign: 'center',
    fontSize: 16,
    lineHeight: 24,
    color: '#395065',
  },
});
