import * as WebBrowser from 'expo-web-browser';
import * as Sentry from '@sentry/react-native';

import { throwIfSupabaseError } from '../utils/supabase';
import { queryClient } from '../lib/query-client';
import { useAuthStore } from '../store/auth-store';
import { useUIStore } from '../store/ui-store';
import { useUserStore } from '../store/user-store';
import {
  getAuthRedirectUrl,
  handleSupabaseAuthCallback,
  retrySupabaseOperationOnce,
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

function resetClientAfterLogout() {
  queryClient.clear();
  useUserStore.getState().reset();
  useUIStore.getState().reset();
}

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

  const consentResult = await retrySupabaseOperationOnce(() =>
    supabase.from('consent_log').insert({
      user_id: createdUser.id,
      terms_version: input.termsVersion,
      privacy_version: input.privacyVersion,
    }),
  );

  throwIfSupabaseError(consentResult.error, 'Unable to record consent.');

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

  const handled = await handleSupabaseAuthCallback(result.url);

  if (!handled) {
    throw new Error('The sign-in callback was not recognized.');
  }
}

export async function signOutAndClearState(): Promise<void> {
  const pushToken = useAuthStore.getState().pushToken;
  const userId = useAuthStore.getState().userId;

  if (pushToken && userId) {
    const deleteResult = await retrySupabaseOperationOnce(() =>
      supabase.from('device_tokens').delete().eq('token', pushToken).eq('user_id', userId),
    );

    if (deleteResult.error) {
      Sentry.captureException(deleteResult.error);
    }
  }

  const { error } = await supabase.auth.signOut();
  throwIfSupabaseError(error, 'Unable to sign out.');

  useAuthStore.getState().setPushToken(null);
  resetClientAfterLogout();
}
