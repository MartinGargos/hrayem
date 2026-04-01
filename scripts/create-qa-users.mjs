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
  { email: 'qa.iphone1@example.com', password: 'Hrayem-QA-2026!' },
  { email: 'qa.iphone2@example.com', password: 'Hrayem-QA-2026!' },
];

for (const user of users) {
  const { data: existing } = await supabase.auth.admin.listUsers();
  const found = existing.users.find((u) => u.email === user.email);

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
    continue;
  }

  const { error } = await supabase.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
  });

  if (error) {
    console.error(`Create failed for ${user.email}:`, error.message);
  } else {
    console.log(`Created user: ${user.email}`);
  }
}
