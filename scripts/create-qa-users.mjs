import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const users = [
  {
    email: 'qa.iphone1@example.com',
    password: 'Hrayem-QA-2026!',
    firstName: 'QA',
    lastName: 'Hráč 1',
  },
  {
    email: 'qa.iphone2@example.com',
    password: 'Hrayem-QA-2026!',
    firstName: 'QA',
    lastName: 'Hráč 2',
  },
  {
    email: 'qa.iphone3@example.com',
    password: 'Hrayem-QA-2026!',
    firstName: 'QA',
    lastName: 'Hráč 3',
  },
  {
    email: 'qa.iphone4@example.com',
    password: 'Hrayem-QA-2026!',
    firstName: 'QA',
    lastName: 'Hráč 4',
  },
];

const termsVersion = process.env.EXPO_PUBLIC_TERMS_VERSION;
const privacyVersion = process.env.EXPO_PUBLIC_PRIVACY_VERSION;

async function upsertQaProfile(userId, user) {
  const { error } = await supabase.from('profiles').upsert(
    {
      id: userId,
      first_name: user.firstName,
      last_name: user.lastName,
      city: 'Ostrava',
      language: 'cs',
      profile_complete: true,
    },
    {
      onConflict: 'id',
    },
  );

  if (error) {
    console.error(`Profile upsert failed for ${user.email}:`, error.message);
  }
}

async function ensureCurrentConsent(userId, email) {
  if (!termsVersion || !privacyVersion) {
    console.log(`Skipped consent seed for ${email}: missing terms/privacy env`);
    return;
  }

  const { data, error } = await supabase
    .from('consent_log')
    .select('id')
    .eq('user_id', userId)
    .eq('terms_version', termsVersion)
    .eq('privacy_version', privacyVersion)
    .limit(1);

  if (error) {
    console.error(`Consent check failed for ${email}:`, error.message);
    return;
  }

  if (data?.length) {
    return;
  }

  const { error: insertError } = await supabase.from('consent_log').insert({
    user_id: userId,
    terms_version: termsVersion,
    privacy_version: privacyVersion,
  });

  if (insertError) {
    console.error(`Consent insert failed for ${email}:`, insertError.message);
  }
}

const { data: existingUsers, error: listError } = await supabase.auth.admin.listUsers({
  page: 1,
  perPage: 1000,
});

if (listError) {
  throw listError;
}

for (const user of users) {
  const found = existingUsers.users.find((u) => u.email === user.email);
  let userId = found?.id ?? null;

  if (found) {
    const { error } = await supabase.auth.admin.updateUserById(found.id, {
      password: user.password,
      email_confirm: true,
    });
    if (error) {
      console.error(`Update failed for ${user.email}:`, error.message);
    } else {
      console.log(`Updated existing user: ${user.email}`);
    }
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: user.email,
      password: user.password,
      email_confirm: true,
    });

    if (error) {
      console.error(`Create failed for ${user.email}:`, error.message);
    } else {
      userId = data.user?.id ?? null;
      console.log(`Created user: ${user.email}`);
    }
  }

  if (userId) {
    await upsertQaProfile(userId, user);
    await ensureCurrentConsent(userId, user.email);
  }
}
