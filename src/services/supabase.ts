import * as ExpoLinking from 'expo-linking';
import { AppState, type AppStateStatus, Platform } from 'react-native';
import {
  AuthApiError,
  createClient,
  type AuthChangeEvent,
  type PostgrestError,
  type Session,
} from '@supabase/supabase-js';

import { queryClient } from '../lib/query-client';
import { useAuthStore } from '../store/auth-store';
import { useUIStore } from '../store/ui-store';
import { useUserStore } from '../store/user-store';
import { requirePublicEnvValue } from '../utils/env';
import { isSupabaseUnauthorizedError } from '../utils/supabase';

const supabaseUrl = requirePublicEnvValue('supabaseUrl');
const supabaseAnonKey = requirePublicEnvValue('supabaseAnonKey');

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

let authListenerCleanup: (() => void) | null = null;
let autoRefreshCleanup: (() => void) | null = null;

type SupabaseLikeResult<T> = {
  data: T | null;
  error: PostgrestError | AuthApiError | Error | null;
};

function clearClientState(errorMessageKey: string | null = null) {
  useAuthStore.getState().clearSession(errorMessageKey);
  useUserStore.getState().reset();
  useUIStore.getState().reset();
  queryClient.clear();
}

function syncSessionToStores(session: Session | null) {
  const authStore = useAuthStore.getState();
  const previousUserId = authStore.userId;

  authStore.applySession(session);

  if (!session) {
    useUserStore.getState().reset();
    useUIStore.getState().setAuthScreen('login');
    return;
  }

  if (previousUserId && previousUserId !== session.user.id) {
    useUserStore.getState().reset();
  }
}

async function refreshSessionWithToken(
  refreshToken: string | null,
  options?: {
    clearOnFailure?: boolean;
    errorMessageKey?: string | null;
  },
): Promise<Session | null> {
  if (!refreshToken) {
    if (options?.clearOnFailure) {
      clearClientState(options.errorMessageKey ?? null);
    }

    return null;
  }

  try {
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      if (options?.clearOnFailure) {
        clearClientState(options.errorMessageKey ?? 'auth.sessionExpired');
      }

      return null;
    }

    syncSessionToStores(data.session);
    return data.session;
  } catch {
    if (options?.clearOnFailure) {
      clearClientState(options.errorMessageKey ?? 'auth.sessionExpired');
    }

    return null;
  }
}

function handleAuthEvent(event: AuthChangeEvent, session: Session | null) {
  if (
    event === 'INITIAL_SESSION' ||
    event === 'SIGNED_IN' ||
    event === 'TOKEN_REFRESHED' ||
    event === 'PASSWORD_RECOVERY'
  ) {
    syncSessionToStores(session);

    if (event === 'PASSWORD_RECOVERY') {
      useUIStore.getState().setAuthScreen('reset-password');
      useUIStore.getState().setAuthNotice({
        messageKey: 'auth.passwordRecoveryReady',
        tone: 'info',
      });
    }

    return;
  }

  if (event === 'SIGNED_OUT') {
    clearClientState(null);
  }
}

export function registerSupabaseAuthListener(): () => void {
  if (authListenerCleanup) {
    return authListenerCleanup;
  }

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    handleAuthEvent(event, session);
  });

  authListenerCleanup = () => {
    data.subscription.unsubscribe();
    authListenerCleanup = null;
  };

  return authListenerCleanup;
}

export function bindSupabaseAuthAutoRefresh(): () => void {
  if (autoRefreshCleanup) {
    return autoRefreshCleanup;
  }

  const onAppStateChange = (status: AppStateStatus) => {
    if (Platform.OS === 'web') {
      return;
    }

    if (status === 'active') {
      supabase.auth.startAutoRefresh();
      return;
    }

    supabase.auth.stopAutoRefresh();
  };

  onAppStateChange(AppState.currentState);

  const subscription = AppState.addEventListener('change', onAppStateChange);

  autoRefreshCleanup = () => {
    subscription.remove();
    autoRefreshCleanup = null;
  };

  return autoRefreshCleanup;
}

export async function bootstrapSupabaseSession(): Promise<Session | null> {
  const authStore = useAuthStore.getState();
  authStore.beginBootstrap();

  return refreshSessionWithToken(authStore.refreshToken, {
    clearOnFailure: true,
    errorMessageKey: 'auth.sessionExpired',
  });
}

export async function refreshSupabaseSession(): Promise<Session | null> {
  return refreshSessionWithToken(useAuthStore.getState().refreshToken, {
    clearOnFailure: true,
    errorMessageKey: 'auth.sessionExpired',
  });
}

export async function retrySupabaseOperationOnce<T>(
  run: () => PromiseLike<SupabaseLikeResult<T>>,
): Promise<SupabaseLikeResult<T>> {
  const firstAttempt = await run();

  if (!isSupabaseUnauthorizedError(firstAttempt.error)) {
    return firstAttempt;
  }

  const refreshedSession = await refreshSupabaseSession();

  if (!refreshedSession) {
    return firstAttempt;
  }

  return run();
}

function readAuthParams(url: string): URLSearchParams {
  const hashIndex = url.indexOf('#');

  if (hashIndex >= 0) {
    return new URLSearchParams(url.slice(hashIndex + 1));
  }

  const queryIndex = url.indexOf('?');

  if (queryIndex >= 0) {
    return new URLSearchParams(url.slice(queryIndex + 1));
  }

  return new URLSearchParams();
}

function getParam(params: URLSearchParams, key: string): string | null {
  const value = params.get(key);

  return value ? value : null;
}

export function getAuthRedirectUrl(path = 'auth/callback'): string {
  return ExpoLinking.createURL(path, {
    scheme: 'hrayem',
  });
}

export async function handleSupabaseAuthCallback(url: string): Promise<boolean> {
  const params = readAuthParams(url);
  const errorDescription = getParam(params, 'error_description') ?? getParam(params, 'error');

  if (errorDescription) {
    throw new Error(errorDescription);
  }

  const authCode = getParam(params, 'code');

  if (authCode) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(authCode);

    if (error || !data.session) {
      throw error ?? new Error('Missing session in OAuth code exchange.');
    }

    if (getParam(params, 'type') === 'recovery') {
      useUIStore.getState().setAuthScreen('reset-password');
    }

    return true;
  }

  const accessToken = getParam(params, 'access_token');
  const refreshToken = getParam(params, 'refresh_token');

  if (!accessToken || !refreshToken) {
    return false;
  }

  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (error || !data.session) {
    throw error ?? new Error('Missing session in auth callback.');
  }

  if (getParam(params, 'type') === 'recovery') {
    useUIStore.getState().setAuthScreen('reset-password');
  }

  return true;
}

export async function clearSessionWithMessage(messageKey: string | null): Promise<void> {
  clearClientState(messageKey);
}
