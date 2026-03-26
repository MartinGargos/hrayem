import * as WebBrowser from 'expo-web-browser';
import * as Sentry from '@sentry/react-native';

import { throwIfSupabaseError } from '../utils/supabase';
import { useUIStore } from '../store/ui-store';
import { buildPendingConsentMetadata } from '../utils/consent';
import { materializePendingConsent } from './app-bootstrap';
import { deleteRegisteredPushToken, restoreRegisteredPushToken } from './push-notifications';
import {
  getAuthRedirectUrl,
  isSupabaseAuthCallbackUrl,
  resetClientState,
  supabase,
} from './supabase';

WebBrowser.maybeCompleteAuthSession();

export type OAuthProvider = 'apple' | 'google';

export type EmailAuthCredentials = {
  email: string;
  password: string;
};

type RegistrationInput = EmailAuthCredentials & {
  termsVersion: string;
  privacyVersion: string;
};

export async function signInWithPassword(credentials: EmailAuthCredentials): Promise<void> {
  const { data, error } = await supabase.auth.signInWithPassword(credentials);
  throwIfSupabaseError(error, 'Unable to sign in.');

  if (!data.session) {
    throw new Error('Missing session after sign-in.');
  }

  useUIStore.getState().setAuthScreen('login');
}

export async function signUpWithEmail(input: RegistrationInput): Promise<{
  requiresEmailConfirmation: boolean;
}> {
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: getAuthRedirectUrl(),
      data: buildPendingConsentMetadata(input.termsVersion, input.privacyVersion),
    },
  });

  throwIfSupabaseError(error, 'Unable to create your account.');

  const createdUser = data.user;

  if (!createdUser) {
    throw new Error('Missing user after sign-up.');
  }

  if (!data.session) {
    return {
      requiresEmailConfirmation: true,
    };
  }

  try {
    await materializePendingConsent(createdUser.id, {
      termsVersion: input.termsVersion,
      privacyVersion: input.privacyVersion,
    });
  } catch (error) {
    Sentry.captureException(error);
  }

  return {
    requiresEmailConfirmation: false,
  };
}

export async function sendPasswordResetEmail(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: getAuthRedirectUrl(),
  });

  throwIfSupabaseError(error, 'Unable to send the reset email.');
}

export async function updatePassword(password: string): Promise<void> {
  const { data, error } = await supabase.auth.updateUser({
    password,
  });

  throwIfSupabaseError(error, 'Unable to update the password.');

  if (!data.user) {
    throw new Error('Missing user after password update.');
  }

  useUIStore.getState().setAuthScreen('login');
  useUIStore.getState().setAuthNotice({
    messageKey: 'auth.passwordUpdated',
    tone: 'success',
  });
}

export async function signInWithOAuth(provider: OAuthProvider): Promise<void> {
  const redirectTo = getAuthRedirectUrl();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  throwIfSupabaseError(error, `Unable to start ${provider} sign-in.`);

  if (!data.url) {
    throw new Error('Missing OAuth URL.');
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  if (result.type !== 'success' || !result.url) {
    throw new Error('The sign-in flow was cancelled before completion.');
  }

  if (!isSupabaseAuthCallbackUrl(result.url)) {
    throw new Error('The sign-in callback was not recognized.');
  }
}

async function ensureSupabaseClientSessionCleared(): Promise<void> {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  if (data.session) {
    throw new Error('Supabase client session is still active after sign-out.');
  }
}

async function clearSupabaseClientSession(): Promise<'global' | 'local'> {
  const globalSignOut = await supabase.auth.signOut({
    scope: 'global',
  });

  if (!globalSignOut.error) {
    return 'global';
  }

  Sentry.captureException(globalSignOut.error);

  const localSignOut = await supabase.auth.signOut({
    scope: 'local',
  });

  if (localSignOut.error) {
    throw localSignOut.error;
  }

  return 'local';
}

export async function signOutAndClearState(): Promise<void> {
  let removedPushToken: Awaited<ReturnType<typeof deleteRegisteredPushToken>> = null;
  let logoutWasPartial = false;

  try {
    removedPushToken = await deleteRegisteredPushToken();
  } catch (error) {
    logoutWasPartial = true;
    Sentry.captureException(error);
  }

  try {
    const clearedScope = await clearSupabaseClientSession();
    logoutWasPartial = logoutWasPartial || clearedScope === 'local';
    await ensureSupabaseClientSessionCleared();
  } catch (error) {
    Sentry.captureException(error);

    if (removedPushToken) {
      try {
        await restoreRegisteredPushToken(removedPushToken);
      } catch (restoreError) {
        Sentry.captureException(restoreError);
      }
    }

    useUIStore.getState().setAuthNotice({
      messageKey: 'auth.errors.logoutFailed',
      tone: 'error',
    });

    return;
  }

  resetClientState(null);

  if (logoutWasPartial) {
    useUIStore.getState().setAuthNotice({
      messageKey: 'auth.logoutPartial',
      tone: 'info',
    });
  }
}
