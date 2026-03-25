import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { createClient } from '@supabase/supabase-js';

const url = requireEnv('EXPO_PUBLIC_SUPABASE_URL');
const anonKey = requireEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');
const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

const serviceClient = createClient(url, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const createdUserIds = [];
const createdEventIds = [];
const createdAppConfigKeys = [];
let insertedVenue = null;

async function main() {
  console.log('Verifying Milestone 1 Supabase foundation...');

  await verifyCuratedCitySourcesStayInSync();

  const userOne = await createTestUser('milestone1-user-one');
  const userTwo = await createTestUser('milestone1-user-two');
  const userThree = await createTestUser('milestone1-user-three');

  createdUserIds.push(userOne.id, userTwo.id, userThree.id);

  const anonClient = createAnonClient();
  const userOneClient = await signInTestUser(userOne.email, userOne.password);
  const userTwoClient = await signInTestUser(userTwo.email, userTwo.password);
  const sport = await getFirstSport(userOneClient);

  await verifyProfileCreatedIncomplete(userOne.id);
  await verifyProfileInvalidCityWrite(userOneClient, userOne.id);
  await verifyProfileCompletion(userOneClient, userOne.id);
  await verifyPlayerAvailabilityInvalidCityWrite(userOneClient, userOne.id, sport.id);
  await verifyUserSportsRls(userOneClient, userOne.id, sport);
  await verifyVenueInvalidCityWrite(userOneClient, userOne.id);
  insertedVenue = await verifyVenueInsertOnly(userOneClient, userOne.id);
  await verifyAppConfigPolicies(userOneClient);
  await verifyConsentLogPolicies(userOneClient, userTwoClient, userOne.id, userTwo.id);
  await verifyEventInvalidCityWrite(sport.id, userOne.id, insertedVenue.id);
  await verifyEventFeedView({
    anonClient,
    viewerClient: userTwoClient,
    sport,
    organizerId: userOne.id,
    confirmedPlayerId: userTwo.id,
    waitlistedPlayerId: userThree.id,
    venue: insertedVenue,
  });

  console.log('Milestone 1 verification passed.');
}

function createAnonClient() {
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function createTestUser(prefix) {
  const suffix = randomUUID();
  const email = `${prefix}-${suffix}@example.com`;
  const password = `M1-${suffix.slice(0, 8)}-Aa1!`;

  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  assertNoError(error, 'create auth user');

  if (!data.user) {
    throw new Error('Auth admin createUser returned no user.');
  }

  return {
    id: data.user.id,
    email,
    password,
  };
}

async function signInTestUser(email, password) {
  const client = createAnonClient();

  const { error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  assertNoError(error, `sign in ${email}`);

  return client;
}

async function verifyCuratedCitySourcesStayInSync() {
  const clientCities = await readQuotedStrings(
    './src/constants/cities.ts',
    /export const CURATED_CITIES = \[(?<body>[\s\S]*?)\] as const;/,
  );
  const replaySeedCities = await readQuotedStrings(
    './supabase/migrations/202603250001_profiles_device_tokens_sports_venues_user_sports.sql',
    /insert into private\.cities \(name, sort_order\)\s+values(?<body>[\s\S]*?);/i,
    /\('([^']+)',\s*\d+\)/g,
  );
  const correctiveSeedCities = await readQuotedStrings(
    './supabase/migrations/202603250012_harden_feed_access_and_city_integrity.sql',
    /insert into private\.cities \(name, sort_order\)\s+values(?<body>[\s\S]*?)on conflict/i,
    /\('([^']+)',\s*\d+\)/g,
  );

  assertEqualJson(
    clientCities,
    replaySeedCities,
    'Expected src/constants/cities.ts to stay in sync with the authoritative private.cities seed in migration 202603250001.',
  );
  assertEqualJson(
    replaySeedCities,
    correctiveSeedCities,
    'Expected the corrective private.cities seed in migration 202603250012 to stay in sync with the fresh-replay seed in migration 202603250001.',
  );

  console.log('Verified curated city definitions stay in sync across client and migrations.');
}

async function verifyProfileCreatedIncomplete(userId) {
  const profile = await waitForSingleRow(
    () =>
      serviceClient
        .from('profiles')
        .select('id, profile_complete, first_name, last_name, city')
        .eq('id', userId)
        .maybeSingle(),
    'profile auto-creation',
  );

  assert(
    profile.profile_complete === false &&
      profile.first_name === null &&
      profile.last_name === null &&
      profile.city === null,
    'Expected new profile row with nullable names/city and profile_complete = false.',
  );

  console.log('Verified profile auto-created with profile_complete = false.');
}

async function verifyProfileInvalidCityWrite(userClient, userId) {
  const invalidCity = `Invalid City ${randomUUID().slice(0, 8)}`;

  const { error } = await userClient
    .from('profiles')
    .update({
      first_name: 'Invalid',
      last_name: 'City',
      city: invalidCity,
    })
    .eq('id', userId);

  assertForeignKeyViolation(error, 'reject invalid profiles.city write');

  const { data, error: readError } = await serviceClient
    .from('profiles')
    .select('first_name, last_name, city, profile_complete')
    .eq('id', userId)
    .single();

  assertNoError(readError, 'read profile after blocked invalid city write');
  assert(
    data.first_name === null &&
      data.last_name === null &&
      data.city === null &&
      data.profile_complete === false,
    'Expected blocked invalid profiles.city write to leave the profile unchanged.',
  );

  console.log('Verified invalid profiles.city writes are rejected.');
}

async function verifyProfileCompletion(userClient, userId) {
  const { error } = await userClient
    .from('profiles')
    .update({
      first_name: 'Test',
      last_name: 'Player',
      city: 'Ostrava',
    })
    .eq('id', userId);

  assertNoError(error, 'update profile completeness fields');

  const { data, error: readError } = await serviceClient
    .from('profiles')
    .select('profile_complete, first_name, last_name, city')
    .eq('id', userId)
    .single();

  assertNoError(readError, 'read completed profile');
  assert(
    data.profile_complete === true &&
      data.first_name === 'Test' &&
      data.last_name === 'Player' &&
      data.city === 'Ostrava',
    'Expected profile_complete to flip to true after first_name, last_name, and city were set.',
  );

  console.log('Verified profile_complete trigger.');
}

async function verifyPlayerAvailabilityInvalidCityWrite(userClient, userId, sportId) {
  const invalidCity = `Invalid City ${randomUUID().slice(0, 8)}`;
  const availableDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { error } = await userClient.from('player_availability').insert({
    user_id: userId,
    sport_id: sportId,
    city: invalidCity,
    available_date: availableDate,
    time_pref: 'evening',
  });

  assertForeignKeyViolation(error, 'reject invalid player_availability.city write');

  const { data, error: readError } = await serviceClient
    .from('player_availability')
    .select('id')
    .eq('user_id', userId)
    .eq('sport_id', sportId)
    .eq('available_date', availableDate);

  assertNoError(readError, 'read player_availability after blocked invalid city write');
  assert(
    Array.isArray(data) && data.length === 0,
    'Expected blocked invalid player_availability.city write to leave no row behind.',
  );

  console.log('Verified invalid player_availability.city writes are rejected.');
}

async function verifyUserSportsRls(userClient, userId, sport) {
  const { data: insertedRow, error: insertError } = await userClient
    .from('user_sports')
    .insert({
      user_id: userId,
      sport_id: sport.id,
      skill_level: 2,
    })
    .select('id, games_played, hours_played, no_shows')
    .single();

  assertNoError(insertError, 'insert own user_sports row');
  assert(
    insertedRow.games_played === 0 &&
      Number(insertedRow.hours_played) === 0 &&
      insertedRow.no_shows === 0,
    'Expected a client-created user_sports row to start with server-controlled counters at zero.',
  );

  const { data: blockedUpdate, error: blockedError } = await userClient
    .from('user_sports')
    .update({ games_played: 99 })
    .eq('id', insertedRow.id)
    .select('id, games_played');

  const { data: persistedRow, error: persistedError } = await serviceClient
    .from('user_sports')
    .select('games_played')
    .eq('id', insertedRow.id)
    .single();

  assertNoError(persistedError, 'read user_sports after blocked update');
  assertBlockedWrite(
    blockedError,
    blockedUpdate,
    'Expected authenticated update of games_played to be rejected by RLS.',
  );
  assert(
    persistedRow.games_played === 0,
    'Expected the blocked user_sports update to leave games_played unchanged.',
  );

  console.log('Verified user_sports server-controlled columns are protected.');
}

async function verifyVenueInvalidCityWrite(userClient, userId) {
  const invalidCity = `Invalid City ${randomUUID().slice(0, 8)}`;
  const invalidVenueName = `Milestone 1 Invalid Venue ${randomUUID().slice(0, 8)}`;

  const { error } = await userClient.from('venues').insert({
    name: invalidVenueName,
    city: invalidCity,
    address: 'Blocked invalid city venue',
    created_by: userId,
  });

  assertForeignKeyViolation(error, 'reject invalid venues.city write');

  const { data, error: readError } = await serviceClient
    .from('venues')
    .select('id')
    .eq('name', invalidVenueName);

  assertNoError(readError, 'read venues after blocked invalid city write');
  assert(
    Array.isArray(data) && data.length === 0,
    'Expected blocked invalid venues.city write to leave no row behind.',
  );

  console.log('Verified invalid venues.city writes are rejected.');
}

async function verifyVenueInsertOnly(userClient, userId) {
  const { data: insertedRow, error: insertError } = await userClient
    .from('venues')
    .insert({
      name: `Milestone 1 Test Venue ${randomUUID().slice(0, 8)}`,
      city: 'Ostrava',
      address: 'Milestone 1 Test Address',
      created_by: userId,
    })
    .select('id, name, city')
    .single();

  assertNoError(insertError, 'insert venue as authenticated user');

  const { data: blockedUpdate, error: blockedUpdateError } = await userClient
    .from('venues')
    .update({ name: 'Blocked Venue Update' })
    .eq('id', insertedRow.id)
    .select('id, name');

  const { data: afterUpdate, error: afterUpdateError } = await serviceClient
    .from('venues')
    .select('name')
    .eq('id', insertedRow.id)
    .single();

  assertNoError(afterUpdateError, 'read venue after blocked update');
  assertBlockedWrite(
    blockedUpdateError,
    blockedUpdate,
    'Expected authenticated venue update to be blocked.',
  );
  assert(
    afterUpdate.name === insertedRow.name,
    'Expected venue name to stay unchanged after blocked update.',
  );

  const { data: blockedDelete, error: blockedDeleteError } = await userClient
    .from('venues')
    .delete()
    .eq('id', insertedRow.id)
    .select('id');

  const { data: afterDelete, error: afterDeleteError } = await serviceClient
    .from('venues')
    .select('id')
    .eq('id', insertedRow.id)
    .maybeSingle();

  assertNoError(afterDeleteError, 'read venue after blocked delete');
  assertBlockedWrite(
    blockedDeleteError,
    blockedDelete,
    'Expected authenticated venue delete to be blocked.',
  );
  assert(afterDelete?.id === insertedRow.id, 'Expected venue row to remain after blocked delete.');

  console.log('Verified venues are insert-only for authenticated users.');
  return insertedRow;
}

async function verifyEventInvalidCityWrite(sportId, organizerId, venueId) {
  const invalidCity = `Invalid City ${randomUUID().slice(0, 8)}`;
  const description = `Milestone 1 invalid event city ${randomUUID().slice(0, 8)}`;
  const startsAt = new Date(Date.now() + 30 * 60 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);

  const { error } = await serviceClient.from('events').insert({
    sport_id: sportId,
    organizer_id: organizerId,
    venue_id: venueId,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    city: invalidCity,
    reservation_type: 'reserved',
    player_count_total: 4,
    skill_min: 1,
    skill_max: 3,
    description,
    status: 'active',
  });

  assertForeignKeyViolation(error, 'reject invalid events.city write');

  const { data, error: readError } = await serviceClient
    .from('events')
    .select('id')
    .eq('description', description);

  assertNoError(readError, 'read events after blocked invalid city write');
  assert(
    Array.isArray(data) && data.length === 0,
    'Expected blocked invalid events.city write to leave no row behind.',
  );

  console.log('Verified invalid events.city writes are rejected.');
}

async function verifyAppConfigPolicies(userClient) {
  const { data: rows, error: readError } = await userClient
    .from('app_config')
    .select('key, value')
    .in('key', ['minimum_app_version_ios', 'minimum_app_version_android'])
    .order('key', { ascending: true });

  assertNoError(readError, 'read app_config');
  assert(rows.length === 2, 'Expected authenticated user to read both minimum app version rows.');

  const minimumIosRow = rows.find((row) => row.key === 'minimum_app_version_ios');
  assert(minimumIosRow, 'Expected minimum_app_version_ios row to exist.');

  const { data: blockedUpdate, error: blockedUpdateError } = await userClient
    .from('app_config')
    .update({ value: '9.9.9' })
    .eq('key', 'minimum_app_version_ios')
    .select('key, value');

  const { data: persistedRow, error: persistedError } = await serviceClient
    .from('app_config')
    .select('value')
    .eq('key', 'minimum_app_version_ios')
    .single();

  assertNoError(persistedError, 'read app_config after blocked update');
  assertBlockedWrite(
    blockedUpdateError,
    blockedUpdate,
    'Expected authenticated app_config update to be blocked.',
  );
  assert(
    persistedRow.value === minimumIosRow.value,
    'Expected app_config value to remain unchanged after blocked update.',
  );

  const probeKey = `milestone1-probe-${randomUUID().slice(0, 8)}`;
  createdAppConfigKeys.push(probeKey);

  const { data: blockedInsert, error: blockedInsertError } = await userClient
    .from('app_config')
    .insert({ key: probeKey, value: '1.2.3' })
    .select('key');

  const { data: insertedRow, error: insertedRowError } = await serviceClient
    .from('app_config')
    .select('key')
    .eq('key', probeKey)
    .maybeSingle();

  assertNoError(insertedRowError, 'read app_config after blocked insert');
  assertBlockedWrite(
    blockedInsertError,
    blockedInsert,
    'Expected authenticated app_config insert to be blocked.',
  );
  assert(insertedRow === null, 'Expected blocked app_config insert to leave no new row behind.');

  const { data: blockedDelete, error: blockedDeleteError } = await userClient
    .from('app_config')
    .delete()
    .eq('key', 'minimum_app_version_ios')
    .select('key');

  const { data: afterDelete, error: afterDeleteError } = await serviceClient
    .from('app_config')
    .select('value')
    .eq('key', 'minimum_app_version_ios')
    .single();

  assertNoError(afterDeleteError, 'read app_config after blocked delete');
  assertBlockedWrite(
    blockedDeleteError,
    blockedDelete,
    'Expected authenticated app_config delete to be blocked.',
  );
  assert(
    afterDelete.value === minimumIosRow.value,
    'Expected minimum_app_version_ios row to remain after blocked delete.',
  );

  console.log('Verified app_config is readable but client writes and deletes are blocked.');
}

async function verifyConsentLogPolicies(userOneClient, userTwoClient, userOneId, userTwoId) {
  const acceptedTermsVersion = '2025-06-01';
  const acceptedPrivacyVersion = '2025-06-01';

  const { error: ownInsertError } = await userOneClient.from('consent_log').insert({
    user_id: userOneId,
    terms_version: acceptedTermsVersion,
    privacy_version: acceptedPrivacyVersion,
  });

  assertNoError(ownInsertError, 'insert own consent_log row');

  const { error: otherInsertError } = await userOneClient.from('consent_log').insert({
    user_id: userTwoId,
    terms_version: acceptedTermsVersion,
    privacy_version: acceptedPrivacyVersion,
  });

  assert(
    otherInsertError,
    "Expected authenticated user to be blocked from inserting another user's consent row.",
  );

  const { error: secondOwnInsertError } = await userTwoClient.from('consent_log').insert({
    user_id: userTwoId,
    terms_version: acceptedTermsVersion,
    privacy_version: acceptedPrivacyVersion,
  });

  assertNoError(secondOwnInsertError, 'insert second user consent_log row');

  const { data: visibleOwnRows, error: visibleOwnRowsError } = await userOneClient
    .from('consent_log')
    .select('user_id');

  assertNoError(visibleOwnRowsError, 'read own consent_log rows');
  assert(
    visibleOwnRows.every((row) => row.user_id === userOneId),
    'Expected authenticated user to read only their own consent_log rows.',
  );

  const { data: blockedRows, error: blockedRowsError } = await userOneClient
    .from('consent_log')
    .select('id, user_id')
    .eq('user_id', userTwoId);

  assertNoError(blockedRowsError, 'attempt to read another user consent_log rows');
  assert(blockedRows.length === 0, "Expected other users' consent_log rows to be hidden by RLS.");

  const { data: blockedUpdate, error: blockedUpdateError } = await userOneClient
    .from('consent_log')
    .update({ privacy_version: '2099-01-01' })
    .eq('user_id', userOneId)
    .select('id, privacy_version');

  const { data: persistedRow, error: persistedRowError } = await serviceClient
    .from('consent_log')
    .select('privacy_version')
    .eq('user_id', userOneId)
    .single();

  assertNoError(persistedRowError, 'read consent_log after blocked update');
  assertBlockedWrite(
    blockedUpdateError,
    blockedUpdate,
    'Expected authenticated consent_log update to be blocked.',
  );
  assert(
    persistedRow.privacy_version === acceptedPrivacyVersion,
    'Expected consent_log privacy_version to remain unchanged after blocked update.',
  );

  const { data: blockedDelete, error: blockedDeleteError } = await userOneClient
    .from('consent_log')
    .delete()
    .eq('user_id', userOneId)
    .select('id');

  const { data: afterDelete, error: afterDeleteError } = await serviceClient
    .from('consent_log')
    .select('id')
    .eq('user_id', userOneId)
    .single();

  assertNoError(afterDeleteError, 'read consent_log after blocked delete');
  assertBlockedWrite(
    blockedDeleteError,
    blockedDelete,
    'Expected authenticated consent_log delete to be blocked.',
  );
  assert(afterDelete.id, 'Expected own consent_log row to remain after blocked delete.');

  console.log(
    'Verified consent_log own-row insert, read isolation, and no update/delete behavior.',
  );
}

async function verifyEventFeedView({
  anonClient,
  viewerClient,
  sport,
  organizerId,
  confirmedPlayerId,
  waitlistedPlayerId,
  venue,
}) {
  const startsAt = new Date(Date.now() + 36 * 60 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + 90 * 60 * 1000);

  const { data: eventRow, error: eventError } = await serviceClient
    .from('events')
    .insert({
      sport_id: sport.id,
      organizer_id: organizerId,
      venue_id: venue.id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      city: venue.city,
      reservation_type: 'reserved',
      player_count_total: 4,
      skill_min: 1,
      skill_max: 3,
      description: 'Milestone 1 feed verification event',
      status: 'active',
    })
    .select(
      [
        'id',
        'sport_id',
        'organizer_id',
        'venue_id',
        'starts_at',
        'ends_at',
        'city',
        'reservation_type',
        'player_count_total',
        'skill_min',
        'skill_max',
        'description',
        'status',
        'created_at',
      ].join(','),
    )
    .single();

  assertNoError(eventError, 'insert feed verification event');
  createdEventIds.push(eventRow.id);

  const { error: eventPlayersError } = await serviceClient.from('event_players').insert([
    {
      event_id: eventRow.id,
      user_id: organizerId,
      status: 'confirmed',
    },
    {
      event_id: eventRow.id,
      user_id: confirmedPlayerId,
      status: 'confirmed',
    },
    {
      event_id: eventRow.id,
      user_id: waitlistedPlayerId,
      status: 'waitlisted',
    },
  ]);

  assertNoError(eventPlayersError, 'insert feed verification event_players rows');

  const { data: hiddenWaitlistRows, error: hiddenWaitlistError } = await viewerClient
    .from('event_players')
    .select('id, status, user_id')
    .eq('event_id', eventRow.id)
    .eq('status', 'waitlisted');

  assertNoError(hiddenWaitlistError, 'query waitlisted event_players as non-organizer');
  assert(
    hiddenWaitlistRows.length === 0,
    'Expected raw waitlisted event_players rows to remain hidden from non-organizers.',
  );

  const { error: anonFeedError } = await anonClient
    .from('event_feed_view')
    .select('id')
    .eq('id', eventRow.id);

  assert(anonFeedError, 'Expected anonymous access to event_feed_view to be rejected.');

  const selectedColumns = [
    'id',
    'sport_id',
    'sport_slug',
    'sport_name_cs',
    'sport_name_en',
    'sport_icon',
    'sport_color',
    'organizer_id',
    'organizer_first_name',
    'organizer_photo_url',
    'organizer_no_shows',
    'organizer_games_played',
    'venue_id',
    'venue_name',
    'venue_address',
    'starts_at',
    'ends_at',
    'city',
    'reservation_type',
    'player_count_total',
    'skill_min',
    'skill_max',
    'description',
    'status',
    'spots_taken',
    'waitlist_count',
    'created_at',
  ].join(',');

  const { data: feedRows, error: feedError } = await viewerClient
    .from('event_feed_view')
    .select(selectedColumns)
    .eq('id', eventRow.id);

  assertNoError(feedError, 'query event_feed_view for seeded event');
  assert(
    feedRows.length === 1,
    'Expected authenticated feed query to return exactly one matching row.',
  );

  const feedRow = feedRows[0];
  assert(
    feedRow.id === eventRow.id &&
      feedRow.sport_id === eventRow.sport_id &&
      feedRow.sport_slug === sport.slug &&
      feedRow.organizer_id === organizerId &&
      feedRow.organizer_first_name === 'Test' &&
      feedRow.organizer_photo_url === null &&
      feedRow.organizer_no_shows === 0 &&
      feedRow.organizer_games_played === 0 &&
      feedRow.venue_id === venue.id &&
      feedRow.venue_name === venue.name &&
      feedRow.venue_address === 'Milestone 1 Test Address' &&
      feedRow.starts_at === eventRow.starts_at &&
      feedRow.ends_at === eventRow.ends_at &&
      feedRow.city === venue.city &&
      feedRow.reservation_type === 'reserved' &&
      feedRow.player_count_total === 4 &&
      feedRow.skill_min === 1 &&
      feedRow.skill_max === 3 &&
      feedRow.description === 'Milestone 1 feed verification event' &&
      feedRow.status === 'active' &&
      Number(feedRow.spots_taken) === 2 &&
      Number(feedRow.waitlist_count) === 1 &&
      feedRow.created_at === eventRow.created_at,
    'Expected authenticated feed query to return the full event_feed_view shape with correct aggregate counts.',
  );

  const { data: emptyRows, error: emptyError } = await viewerClient
    .from('event_feed_view')
    .select(selectedColumns)
    .eq('city', '__milestone_1_no_match__');

  assertNoError(emptyError, 'query event_feed_view with no matches');
  assert(
    Array.isArray(emptyRows) && emptyRows.length === 0,
    'Expected event_feed_view query to return an empty array without errors when no events match.',
  );

  console.log(
    'Verified event_feed_view denies anonymous access, preserves hidden waitlist rows, and returns the expected authenticated shape and counts.',
  );
}

async function getFirstSport(userClient) {
  const { data, error } = await userClient
    .from('sports')
    .select('id, slug')
    .order('sort_order', { ascending: true })
    .limit(1)
    .single();

  assertNoError(error, 'read seeded sports');
  return data;
}

async function waitForSingleRow(runQuery, label) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data, error } = await runQuery();

    if (!error && data) {
      return data;
    }

    await sleep(300);
  }

  throw new Error(`Timed out waiting for ${label}.`);
}

async function readQuotedStrings(filePath, blockPattern, itemPattern = /'([^']+)'/g) {
  const fileContents = await readFile(filePath, 'utf8');
  const blockMatch = fileContents.match(blockPattern);

  if (!blockMatch?.groups?.body) {
    throw new Error(`Could not parse quoted string block from ${filePath}.`);
  }

  return Array.from(blockMatch.groups.body.matchAll(itemPattern), (match) => match[1]);
}

function requireEnv(name) {
  const value = process.env[name]?.trim();

  if (
    !value ||
    value.includes('your-project') ||
    value.includes('your-supabase') ||
    value.includes('examplePublicKey')
  ) {
    throw new Error(`${name} is missing or still using a placeholder value.`);
  }

  return value;
}

function assertNoError(error, label) {
  if (error) {
    throw new Error(`${label} failed: ${error.message}`);
  }
}

function assertForeignKeyViolation(error, label) {
  if (!error) {
    throw new Error(`${label} failed: expected a foreign key violation but the write succeeded.`);
  }

  if (error.code !== '23503') {
    throw new Error(
      `${label} failed: expected Postgres error code 23503, received ${error.code ?? 'unknown'}.`,
    );
  }
}

function assertBlockedWrite(error, data, message) {
  const blockedByPolicy = Boolean(error);
  const blockedByZeroRows = Array.isArray(data) && data.length === 0;
  const blockedByNoData = data === null;

  if (!blockedByPolicy && !blockedByZeroRows && !blockedByNoData) {
    throw new Error(message);
  }
}

function assertEqualJson(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

try {
  await main();
} finally {
  for (const eventId of createdEventIds) {
    await serviceClient.from('events').delete().eq('id', eventId);
  }

  if (insertedVenue?.id) {
    await serviceClient.from('venues').delete().eq('id', insertedVenue.id);
  }

  for (const appConfigKey of createdAppConfigKeys) {
    await serviceClient.from('app_config').delete().eq('key', appConfigKey);
  }

  for (const userId of createdUserIds) {
    await serviceClient.auth.admin.deleteUser(userId);
  }
}
