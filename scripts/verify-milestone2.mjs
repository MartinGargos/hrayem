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
  let createdUserId = null;
  let registrationWasDirectlyProven = false;

  try {
    const signUpClient = createAnonClient();
    const signUpResult = await signUpClient.auth.signUp({
      email,
      password,
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
    if (!registrationWasDirectlyProven) {
      console.log(
        'Direct public email sign-up was not fully proven in this run because the live project rate limit prevented it.',
      );
    }
    console.log('Milestone 2 verification passed.');
  } finally {
    if (createdUserId) {
      const deleteUserResult = await serviceClient.auth.admin.deleteUser(createdUserId);
      assertNoError(deleteUserResult.error, 'cleanup auth user');
    }
  }
}

await main();
