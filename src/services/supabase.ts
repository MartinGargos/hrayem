import { createClient, type Session } from '@supabase/supabase-js';

import { useAuthStore } from '../store/auth-store';
import { useUIStore } from '../store/ui-store';
import { useUserStore } from '../store/user-store';
import { requirePublicEnvValue } from '../utils/env';

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

function syncSessionToStores(session: Session | null) {
  const authStore = useAuthStore.getState();
  authStore.applySession(session);

  if (!session) {
    useUserStore.getState().clearProfile();
    useUIStore.getState().clearPendingDeepLink();
    return;
  }

  const { language, profile, selectedCity } = useUserStore.getState();

  useUserStore.getState().setProfile({
    id: session.user.id,
    firstName: profile?.firstName ?? null,
    lastName: profile?.lastName ?? null,
    photoUrl: profile?.photoUrl ?? null,
    city: profile?.city ?? selectedCity ?? null,
    language,
  });
}

export function registerSupabaseAuthListener(): () => void {
  if (authListenerCleanup) {
    return authListenerCleanup;
  }

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      syncSessionToStores(session);
      return;
    }

    if (event === 'SIGNED_OUT') {
      useAuthStore.getState().clearSession();
      useUserStore.getState().clearProfile();
      useUIStore.getState().clearPendingDeepLink();
    }
  });

  authListenerCleanup = () => {
    data.subscription.unsubscribe();
    authListenerCleanup = null;
  };

  return authListenerCleanup;
}

export async function bootstrapSupabaseSession(): Promise<Session | null> {
  const authStore = useAuthStore.getState();
  authStore.beginBootstrap();

  if (!authStore.refreshToken) {
    authStore.clearSession();
    return null;
  }

  try {
    // We persist only the refresh token, so `setSession()` is not usable here:
    // Supabase requires both access and refresh tokens for that API.
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: authStore.refreshToken,
    });

    if (error || !data.session) {
      authStore.clearSession('foundation.sessionExpired');
      return null;
    }

    syncSessionToStores(data.session);
    return data.session;
  } catch {
    authStore.clearSession('foundation.sessionExpired');
    return null;
  }
}
