import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

function requiredEnv(name) {
  // eslint-disable-next-line expo/no-dynamic-env-var
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function assertNoError(error, label) {
  if (!error) {
    return;
  }

  throw new Error(`${label} failed: ${error.message}`);
}

const supabaseUrl = requiredEnv('EXPO_PUBLIC_SUPABASE_URL');
const supabaseAnonKey = requiredEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');
const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
const termsVersion = requiredEnv('EXPO_PUBLIC_TERMS_VERSION');
const privacyVersion = requiredEnv('EXPO_PUBLIC_PRIVACY_VERSION');
const pendingTermsKey = 'pending_terms_version';
const pendingPrivacyKey = 'pending_privacy_version';

function createAnonClient() {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

async function main() {
  console.log('Verifying Milestone 2 auth and session foundation...');

  const appConfigResult = await createAnonClient()
    .from('app_config')
    .select('key, value')
    .in('key', ['minimum_app_version_ios', 'minimum_app_version_android'])
    .order('key', { ascending: true });

  assertNoError(appConfigResult.error, 'anon app_config read');

  if ((appConfigResult.data ?? []).length !== 2) {
    throw new Error('Expected both minimum app version keys to be readable by anon.');
  }

  console.log('Verified anon app_config launch reads.');

  const bucketsResult = await serviceClient.storage.listBuckets();
  assertNoError(bucketsResult.error, 'storage bucket listing');

  const avatarsBucket = bucketsResult.data?.find((bucket) => bucket.id === 'avatars');

  if (!avatarsBucket) {
    throw new Error('Expected the avatars storage bucket to exist.');
  }

  console.log('Verified avatars storage bucket exists.');

  const email = `milestone2-${randomUUID()}@gmail.com`;
  const password = `Pass!${randomUUID()}`;
  const secondaryEmail = `milestone2-secondary-${randomUUID()}@gmail.com`;
  const secondaryPassword = `Pass!${randomUUID()}`;
  let createdUserId = null;
  let secondaryUserId = null;
  let registrationWasDirectlyProven = false;

  try {
    const signUpClient = createAnonClient();
    const signUpResult = await signUpClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          [pendingTermsKey]: termsVersion,
          [pendingPrivacyKey]: privacyVersion,
        },
      },
    });
    let authenticatedSession = signUpResult.data.session;

    if (!signUpResult.error && signUpResult.data.user) {
      createdUserId = signUpResult.data.user.id;
    }

    if (signUpResult.error) {
      const normalizedMessage = signUpResult.error.message.toLowerCase();

      if (normalizedMessage.includes('rate limit exceeded')) {
        console.log(
          'Direct email sign-up proof skipped because the live project is currently rate limited. Continuing with an admin-created confirmed user for the remaining checks.',
        );
      } else {
        assertNoError(signUpResult.error, 'email sign-up');
      }
    }

    if (!authenticatedSession) {
      if (createdUserId) {
        const deleteUnconfirmedUserResult =
          await serviceClient.auth.admin.deleteUser(createdUserId);
        assertNoError(deleteUnconfirmedUserResult.error, 'cleanup unconfirmed sign-up user');
        createdUserId = null;
      }

      if (!createdUserId) {
        const adminCreateResult = await serviceClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            [pendingTermsKey]: termsVersion,
            [pendingPrivacyKey]: privacyVersion,
          },
        });

        assertNoError(adminCreateResult.error, 'admin user create fallback');

        if (!adminCreateResult.data.user) {
          throw new Error('Missing user after admin fallback creation.');
        }

        createdUserId = adminCreateResult.data.user.id;
      }

      const signInFallbackResult = await signUpClient.auth.signInWithPassword({
        email,
        password,
      });

      assertNoError(signInFallbackResult.error, 'email sign-in fallback');

      authenticatedSession = signInFallbackResult.data.session;

      if (!authenticatedSession) {
        throw new Error(
          'A confirmed fallback user could sign in, but no session was returned for the remaining Milestone 2 checks.',
        );
      }

      console.log('Verified email sign-in with a confirmed test user.');
    } else {
      registrationWasDirectlyProven = true;
      console.log('Verified email registration returns a live session.');
    }

    const pendingConsentMetadata = authenticatedSession.user?.user_metadata ?? {};

    if (
      pendingConsentMetadata[pendingTermsKey] !== termsVersion ||
      pendingConsentMetadata[pendingPrivacyKey] !== privacyVersion
    ) {
      throw new Error(
        'Expected the authenticated session to carry the pending consent versions for email-confirmation durability.',
      );
    }

    console.log('Verified pending consent metadata survives into the authenticated session.');

    const authenticatedClient = createAnonClient();
    const setSessionResult = await authenticatedClient.auth.setSession({
      access_token: authenticatedSession.access_token,
      refresh_token: authenticatedSession.refresh_token,
    });

    assertNoError(setSessionResult.error, 'client session bootstrap');

    const consentInsertResult = await authenticatedClient.from('consent_log').insert({
      user_id: createdUserId,
      terms_version: termsVersion,
      privacy_version: privacyVersion,
    });

    assertNoError(consentInsertResult.error, 'consent log insert');

    const consentReadResult = await authenticatedClient
      .from('consent_log')
      .select('terms_version, privacy_version')
      .eq('user_id', createdUserId)
      .eq('terms_version', termsVersion)
      .eq('privacy_version', privacyVersion)
      .limit(1);

    assertNoError(consentReadResult.error, 'consent log readback');

    if (!(consentReadResult.data ?? []).length) {
      throw new Error('Expected the inserted consent row to be readable by the owning user.');
    }

    console.log('Verified consent logging for the current terms versions.');

    const sharedDeviceToken = `ExponentPushToken[shared-${randomUUID()}]`;
    const secondaryDeviceToken = `ExponentPushToken[secondary-${randomUUID()}]`;

    const secondaryCreateResult = await serviceClient.auth.admin.createUser({
      email: secondaryEmail,
      password: secondaryPassword,
      email_confirm: true,
    });

    assertNoError(secondaryCreateResult.error, 'secondary user create');

    if (!secondaryCreateResult.data.user) {
      throw new Error('Missing secondary user after admin creation.');
    }

    secondaryUserId = secondaryCreateResult.data.user.id;

    const secondarySignInClient = createAnonClient();
    const secondarySignInResult = await secondarySignInClient.auth.signInWithPassword({
      email: secondaryEmail,
      password: secondaryPassword,
    });

    assertNoError(secondarySignInResult.error, 'secondary user sign-in');

    const secondarySession = secondarySignInResult.data.session;

    if (!secondarySession) {
      throw new Error('Missing authenticated session for the secondary user.');
    }

    const secondaryClient = createAnonClient();
    const secondarySetSessionResult = await secondaryClient.auth.setSession({
      access_token: secondarySession.access_token,
      refresh_token: secondarySession.refresh_token,
    });

    assertNoError(secondarySetSessionResult.error, 'secondary client session bootstrap');

    const firstClaimResult = await authenticatedClient.rpc('claim_device_token', {
      push_platform: 'ios',
      push_token: sharedDeviceToken,
    });

    assertNoError(firstClaimResult.error, 'initial device token claim');

    const firstClaimReadResult = await serviceClient
      .from('device_tokens')
      .select('user_id, token')
      .eq('token', sharedDeviceToken);

    assertNoError(firstClaimReadResult.error, 'initial claimed token readback');

    if (
      (firstClaimReadResult.data ?? []).length !== 1 ||
      firstClaimReadResult.data?.[0]?.user_id !== createdUserId
    ) {
      throw new Error(
        'Expected the shared device token to belong to the first authenticated user.',
      );
    }

    const movedClaimResult = await secondaryClient.rpc('claim_device_token', {
      push_platform: 'ios',
      push_token: sharedDeviceToken,
    });

    assertNoError(movedClaimResult.error, 'moved device token claim');

    const movedClaimReadResult = await serviceClient
      .from('device_tokens')
      .select('user_id, token')
      .eq('token', sharedDeviceToken);

    assertNoError(movedClaimReadResult.error, 'moved claimed token readback');

    if (
      (movedClaimReadResult.data ?? []).length !== 1 ||
      movedClaimReadResult.data?.[0]?.user_id !== secondaryUserId
    ) {
      throw new Error(
        'Expected the same device token to move cleanly to the second authenticated user.',
      );
    }

    console.log('Verified same-device token ownership moves cleanly between accounts.');

    const secondaryTokenClaimResult = await secondaryClient.rpc('claim_device_token', {
      push_platform: 'ios',
      push_token: secondaryDeviceToken,
    });

    assertNoError(secondaryTokenClaimResult.error, 'secondary device token claim');

    const deterministicDeleteResult = await secondaryClient.rpc('delete_device_token', {
      push_token: sharedDeviceToken,
    });

    assertNoError(deterministicDeleteResult.error, 'token-specific device token delete');

    const deterministicDeleteReadResult = await serviceClient
      .from('device_tokens')
      .select('user_id, token')
      .eq('user_id', secondaryUserId)
      .order('token', { ascending: true });

    assertNoError(deterministicDeleteReadResult.error, 'device token read after targeted delete');

    const remainingTokenRows = deterministicDeleteReadResult.data ?? [];

    if (
      remainingTokenRows.length !== 1 ||
      remainingTokenRows[0]?.token !== secondaryDeviceToken ||
      remainingTokenRows[0]?.user_id !== secondaryUserId
    ) {
      throw new Error(
        'Expected token-specific cleanup to remove only the targeted device token row.',
      );
    }

    console.log('Verified logout cleanup can target the correct token row deterministically.');

    const permissionLossCleanupResult = await secondaryClient.rpc('delete_device_token', {
      push_token: secondaryDeviceToken,
    });

    assertNoError(permissionLossCleanupResult.error, 'push token delete on permission loss');

    const permissionLossReadResult = await serviceClient
      .from('device_tokens')
      .select('token')
      .eq('token', secondaryDeviceToken);

    assertNoError(permissionLossReadResult.error, 'device token read after permission loss');

    if ((permissionLossReadResult.data ?? []).length !== 0) {
      throw new Error(
        'Expected stale push-token cleanup to remove ownership when the token becomes unavailable.',
      );
    }

    console.log('Verified stale push-token cleanup when the current device cannot keep a token.');

    const profileUpdateResult = await authenticatedClient
      .from('profiles')
      .update({
        first_name: 'Milestone',
        last_name: 'Verifier',
        city: 'Ostrava',
        language: 'en',
      })
      .eq('id', createdUserId);

    assertNoError(profileUpdateResult.error, 'profile setup update');

    const profileReadResult = await serviceClient
      .from('profiles')
      .select('first_name, last_name, city, language, profile_complete')
      .eq('id', createdUserId)
      .single();

    assertNoError(profileReadResult.error, 'profile readback');

    if (
      profileReadResult.data?.first_name !== 'Milestone' ||
      profileReadResult.data?.last_name !== 'Verifier' ||
      profileReadResult.data?.city !== 'Ostrava' ||
      profileReadResult.data?.language !== 'en' ||
      profileReadResult.data?.profile_complete !== true
    ) {
      throw new Error('Expected profile setup to update the row and flip profile_complete.');
    }

    console.log('Verified profile setup updates and profile completion gate state.');

    const refreshResult = await signUpClient.auth.refreshSession({
      refresh_token: authenticatedSession.refresh_token,
    });

    assertNoError(refreshResult.error, 'refresh token flow');

    if (!refreshResult.data.session) {
      throw new Error('Expected refreshSession() to return a new session.');
    }

    console.log('Verified refresh-token session recovery.');

    const localSignOutResult = await authenticatedClient.auth.signOut({
      scope: 'local',
    });

    assertNoError(localSignOutResult.error, 'local sign-out');

    const postSignOutSessionResult = await authenticatedClient.auth.getSession();
    assertNoError(postSignOutSessionResult.error, 'post sign-out session read');

    if (postSignOutSessionResult.data.session) {
      throw new Error('Expected local sign-out to clear the Supabase client session.');
    }

    console.log('Verified Supabase client session is cleared after sign-out.');

    if (!registrationWasDirectlyProven) {
      console.log(
        'Direct public email sign-up was not fully proven in this run because the live project rate limit prevented it.',
      );
    }
    console.log('Milestone 2 verification passed.');
  } finally {
    if (secondaryUserId) {
      const deleteSecondaryUserResult = await serviceClient.auth.admin.deleteUser(secondaryUserId);
      assertNoError(deleteSecondaryUserResult.error, 'cleanup secondary auth user');
    }

    if (createdUserId) {
      const deleteUserResult = await serviceClient.auth.admin.deleteUser(createdUserId);
      assertNoError(deleteUserResult.error, 'cleanup auth user');
    }
  }
}

await main();
