import * as Sentry from '@sentry/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { OfflineBanner } from './src/components/OfflineBanner';
import { FoundationScreen } from './src/features/foundation/FoundationScreen';
import i18n from './src/i18n';
import { bindAppStateToQueryFocus, queryClient } from './src/lib/query-client';
import { bootstrapSupabaseSession, registerSupabaseAuthListener } from './src/services/supabase';
import { useAuthStore } from './src/store/auth-store';
import { useUserStore } from './src/store/user-store';
import { publicEnv } from './src/utils/env';

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
  const language = useUserStore((state) => state.language);
  const userHasHydrated = useUserStore((state) => state.hasHydrated);
  const bootstrapStartedRef = useRef(false);

  useEffect(() => {
    const unsubscribe = registerSupabaseAuthListener();
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
          <FoundationScreen />
        </Sentry.ErrorBoundary>
      </SafeAreaView>
    </QueryClientProvider>
  );
}

export default Sentry.wrap(AppShell);

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
