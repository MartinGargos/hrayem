import * as ExpoLinking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import * as Sentry from '@sentry/react-native';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { OfflineBanner } from './src/components/OfflineBanner';
import { AuthFlowScreen } from './src/features/auth/AuthFlowScreen';
import { BlockingMessageScreen } from './src/features/auth/BlockingMessageScreen';
import { ForceUpdateScreen } from './src/features/auth/ForceUpdateScreen';
import { LoadingScreen } from './src/features/auth/LoadingScreen';
import { ProfileSetupScreen } from './src/features/auth/ProfileSetupScreen';
import { TermsReconsentScreen } from './src/features/auth/TermsReconsentScreen';
import { FoundationScreen } from './src/features/foundation/FoundationScreen';
import { HomeEntryScreen } from './src/features/home/HomeEntryScreen';
import { PublicEventFallbackScreen } from './src/features/web/PublicEventFallbackScreen';
import i18n from './src/i18n';
import { bindAppStateToQueryFocus, queryClient } from './src/lib/query-client';
import {
  isEventDeepLinkUrl,
  parseDeveloperSurfaceUrl,
  parsePublicWebsiteRoute,
  type PublicWebsiteRouteTarget,
} from './src/navigation/deep-links';
import {
  fetchCurrentUserProfile,
  fetchMinimumSupportedVersion,
  hasAcceptedConsentVersions,
  materializePendingConsent,
} from './src/services/app-bootstrap';
import { registerPushTokenIfNeeded } from './src/services/push-notifications';
import {
  bindSupabaseAuthAutoRefresh,
  bootstrapSupabaseSession,
  handleSupabaseAuthCallback,
  isSupabaseAuthCallbackUrl,
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
  const pendingConsent = useAuthStore((state) => state.pendingConsent);
  const userHasHydrated = useUserStore((state) => state.hasHydrated);
  const language = useUserStore((state) => state.language);
  const setProfile = useUserStore((state) => state.setProfile);
  const setSelectedCity = useUserStore((state) => state.setSelectedCity);
  const setLanguagePreference = useUserStore((state) => state.setLanguage);
  const authScreen = useUIStore((state) => state.authScreen);
  const setAuthNotice = useUIStore((state) => state.setAuthNotice);
  const setPendingDeepLink = useUIStore((state) => state.setPendingDeepLink);
  const bootstrapStartedRef = useRef(false);
  const pendingConsentSyncRef = useRef<string | null>(null);
  const [developerSurface, setDeveloperSurface] = useState<'foundation' | null>(null);
  const [publicWebsiteRoute, setPublicWebsiteRoute] = useState<PublicWebsiteRouteTarget | null>(
    null,
  );
  const handledNotificationResponseIdsRef = useRef(new Set<string>());

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

    async function maybeHandleIncomingUrl(url: string | null) {
      if (!url) {
        return;
      }

      const developerSurfaceTarget = parseDeveloperSurfaceUrl(url);

      if (developerSurfaceTarget) {
        setDeveloperSurface(developerSurfaceTarget);
        return;
      }

      if (Platform.OS === 'web') {
        const publicWebsiteTarget = parsePublicWebsiteRoute(url);

        if (publicWebsiteTarget?.kind === 'event') {
          setPublicWebsiteRoute(publicWebsiteTarget);
          return;
        }
      }

      if (isSupabaseAuthCallbackUrl(url)) {
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

          return;
        }

        return;
      }

      if (isEventDeepLinkUrl(url)) {
        setPendingDeepLink(url);
      }
    }

    function readNotificationDeepLinkUrl(
      response: Notifications.NotificationResponse | null,
    ): string | null {
      if (!response) {
        return null;
      }

      const identifier = response.notification.request.identifier;

      if (handledNotificationResponseIdsRef.current.has(identifier)) {
        return null;
      }

      handledNotificationResponseIdsRef.current.add(identifier);

      const data = response.notification.request.content.data;
      const urlValue = typeof data?.url === 'string' ? data.url : null;

      if (urlValue) {
        return urlValue;
      }

      const eventId = typeof data?.eventId === 'string' ? data.eventId : null;
      const route = typeof data?.route === 'string' ? data.route : null;

      if (!eventId) {
        return null;
      }

      return route === 'chat'
        ? `${appMetadata.scheme}://event/${eventId}?screen=chat`
        : `${appMetadata.scheme}://event/${eventId}`;
    }

    const subscription = ExpoLinking.addEventListener('url', ({ url }) => {
      void maybeHandleIncomingUrl(url);
    });
    const notificationSubscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        void maybeHandleIncomingUrl(readNotificationDeepLinkUrl(response));
      },
    );

    void ExpoLinking.getInitialURL().then((url) => maybeHandleIncomingUrl(url));
    void Notifications.getLastNotificationResponseAsync().then((response) =>
      maybeHandleIncomingUrl(readNotificationDeepLinkUrl(response)),
    );

    return () => {
      isActive = false;
      subscription.remove();
      notificationSubscription.remove();
    };
  }, [setAuthNotice, setPendingDeepLink]);

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
  const consentAccepted = consentQuery.data;
  const isConsentPending = consentQuery.isPending;
  const refetchConsent = consentQuery.refetch;

  useEffect(() => {
    if (!profileQuery.data) {
      return;
    }

    setProfile(profileQuery.data);
    setSelectedCity(profileQuery.data.city);
    setLanguagePreference(profileQuery.data.language);
  }, [profileQuery.data, setLanguagePreference, setProfile, setSelectedCity]);

  useEffect(() => {
    if (authStatus !== 'authenticated' || !userId || !pendingConsent) {
      pendingConsentSyncRef.current = null;
      return;
    }

    if (isConsentPending || consentAccepted !== false) {
      return;
    }

    const syncKey = `${userId}:${pendingConsent.termsVersion}:${pendingConsent.privacyVersion}`;

    if (pendingConsentSyncRef.current === syncKey) {
      return;
    }

    pendingConsentSyncRef.current = syncKey;
    let isActive = true;

    void materializePendingConsent(userId, pendingConsent)
      .then(() => {
        if (!isActive) {
          return;
        }

        void refetchConsent();
      })
      .catch(() => {
        if (!isActive) {
          return;
        }
      });

    return () => {
      isActive = false;
    };
  }, [authStatus, consentAccepted, isConsentPending, pendingConsent, refetchConsent, userId]);

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
  if (isStoresHydrating) {
    return <LoadingScreen />;
  }

  if (__DEV__ && developerSurface === 'foundation') {
    return <FoundationScreen />;
  }

  if (Platform.OS === 'web' && publicWebsiteRoute?.kind === 'event') {
    return (
      <PublicEventFallbackScreen
        eventId={publicWebsiteRoute.eventId}
        screen={publicWebsiteRoute.screen}
      />
    );
  }

  const isAuthBootstrapping = authStatus === 'idle' || authStatus === 'loading';
  const isAuthenticatedLoading =
    authStatus === 'authenticated' &&
    (profileQuery.isPending ||
      consentQuery.isPending ||
      (!profileQuery.data && !profileQuery.isError));

  if (isAuthBootstrapping || minimumVersionQuery.isPending || isAuthenticatedLoading) {
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

  return <HomeEntryScreen />;
}

export default Sentry.wrap(function RootApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
          <StatusBar style="dark" />
          <OfflineBanner />
          <View style={styles.appBody}>
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
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
});

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f7f0e6',
  },
  appBody: {
    flex: 1,
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
