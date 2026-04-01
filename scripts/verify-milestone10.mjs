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

function createAnonClient() {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

function relativeIso(hoursFromNow) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

function isoHoursAgo(hoursAgo) {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function createConfirmedUser(label, city = 'Ostrava') {
  const email = `milestone10-${label}-${randomUUID()}@gmail.com`;
  const password = `Pass!${randomUUID()}`;
  const createResult = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  assertNoError(createResult.error, `create auth user (${label})`);

  if (!createResult.data.user) {
    throw new Error(`Missing auth user for ${label}.`);
  }

  const signInClient = createAnonClient();
  const signInResult = await signInClient.auth.signInWithPassword({
    email,
    password,
  });

  assertNoError(signInResult.error, `sign in auth user (${label})`);

  if (!signInResult.data.session) {
    throw new Error(`Missing session for ${label}.`);
  }

  const authenticatedClient = createAnonClient();
  const setSessionResult = await authenticatedClient.auth.setSession({
    access_token: signInResult.data.session.access_token,
    refresh_token: signInResult.data.session.refresh_token,
  });

  assertNoError(setSessionResult.error, `bootstrap client session (${label})`);

  await updateProfile(createResult.data.user.id, {
    firstName: 'M10',
    lastName: label,
    city,
  });

  return {
    userId: createResult.data.user.id,
    accessToken: signInResult.data.session.access_token,
    client: authenticatedClient,
  };
}

async function updateProfile(userId, overrides) {
  const result = await serviceClient
    .from('profiles')
    .update({
      first_name: overrides.firstName,
      last_name: overrides.lastName,
      city: overrides.city,
      language: overrides.language ?? 'en',
    })
    .eq('id', userId);

  assertNoError(result.error, `update profile ${userId}`);
}

async function upsertUserSport(userId, sportId, skillLevel) {
  const result = await serviceClient.from('user_sports').upsert(
    {
      user_id: userId,
      sport_id: sportId,
      skill_level: skillLevel,
    },
    {
      onConflict: 'user_id,sport_id',
    },
  );

  assertNoError(result.error, `upsert user_sport for ${userId}`);
}

async function createVenue(client, input) {
  const result = await client
    .from('venues')
    .insert({
      name: input.name,
      city: input.city,
      address: input.address,
      created_by: input.createdBy,
    })
    .select('id')
    .single();

  assertNoError(result.error, `create venue ${input.name}`);

  if (!result.data?.id) {
    throw new Error(`Expected venue id for ${input.name}.`);
  }

  return result.data.id;
}

async function createFutureEvent({
  organizerUserId,
  sportId,
  venueId,
  city,
  description,
  playerCountTotal = 4,
}) {
  const result = await serviceClient
    .from('events')
    .insert({
      sport_id: sportId,
      organizer_id: organizerUserId,
      venue_id: venueId,
      starts_at: relativeIso(36),
      ends_at: relativeIso(37),
      city,
      reservation_type: 'reserved',
      player_count_total: playerCountTotal,
      skill_min: 2,
      skill_max: 3,
      description,
      status: 'active',
    })
    .select('id')
    .single();

  assertNoError(result.error, `create future event (${description})`);

  if (!result.data?.id) {
    throw new Error(`Expected future event id for ${description}.`);
  }

  return result.data.id;
}

async function createPastEvent({ organizerUserId, sportId, venueId, city, description }) {
  const result = await serviceClient
    .from('events')
    .insert({
      sport_id: sportId,
      organizer_id: organizerUserId,
      venue_id: venueId,
      starts_at: isoHoursAgo(50),
      ends_at: isoHoursAgo(49),
      city,
      reservation_type: 'reserved',
      player_count_total: 4,
      skill_min: 2,
      skill_max: 3,
      description,
      status: 'finished',
      no_show_window_end: relativeIso(1),
      chat_closed_at: relativeIso(2),
    })
    .select('id')
    .single();

  assertNoError(result.error, `create past event (${description})`);

  if (!result.data?.id) {
    throw new Error(`Expected past event id for ${description}.`);
  }

  return result.data.id;
}

async function createEventPlayer({ eventId, userId, status }) {
  const result = await serviceClient.from('event_players').upsert(
    {
      event_id: eventId,
      user_id: userId,
      status,
    },
    {
      onConflict: 'event_id,user_id',
    },
  );

  assertNoError(result.error, `upsert event_player ${eventId}/${userId}/${status}`);
}

async function createAvailability({ userId, sportId, city }) {
  const result = await serviceClient.from('player_availability').insert({
    user_id: userId,
    sport_id: sportId,
    city,
    available_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    time_pref: 'evening',
    note: 'Milestone 10 deletion check',
  });

  assertNoError(result.error, `create availability for ${userId}`);
}

async function createDeviceToken(userId, platform = 'ios') {
  const result = await serviceClient
    .from('device_tokens')
    .insert({
      user_id: userId,
      token: `ExponentPushToken[${randomUUID()}]`,
      platform,
      ownership_key: `verify-m10-${randomUUID()}`,
    })
    .select('token')
    .single();

  assertNoError(result.error, `create device token for ${userId}`);
  return result.data?.token ?? null;
}

async function insertConsentLog(userId) {
  const result = await serviceClient.from('consent_log').insert({
    user_id: userId,
    terms_version: '2026-03-31',
    privacy_version: '2026-03-31',
    ip_address: '127.0.0.1',
  });

  assertNoError(result.error, `insert consent log for ${userId}`);
}

async function createPostGameThumb({ eventId, fromUserId, toUserId, sportId }) {
  const result = await serviceClient.from('post_game_thumbs').insert({
    event_id: eventId,
    from_user: fromUserId,
    to_user: toUserId,
    sport_id: sportId,
  });

  assertNoError(result.error, `create post_game_thumb ${eventId}/${fromUserId}/${toUserId}`);
}

async function callFunctionRoute(functionName, path, accessToken, body = {}) {
  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}${path}`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  let parsedBody = null;

  try {
    parsedBody = await response.json();
  } catch {
    parsedBody = null;
  }

  return {
    status: response.status,
    body: parsedBody,
    headers: response.headers,
  };
}

function expectSuccess(response, label) {
  if (!response.body?.data || response.status < 200 || response.status >= 300) {
    throw new Error(
      `${label} expected success, received ${response.status} with body ${JSON.stringify(response.body)}.`,
    );
  }

  return response.body.data;
}

function expectError(response, expectedStatus, expectedCode, label) {
  if (response.status !== expectedStatus || response.body?.error?.code !== expectedCode) {
    throw new Error(
      `${label} expected status ${expectedStatus} / code ${expectedCode}, received ${response.status} with body ${JSON.stringify(response.body)}.`,
    );
  }
}

async function loadNotificationRows(eventId, type) {
  const result = await serviceClient
    .from('notification_log')
    .select('user_id, type, status, payload')
    .eq('event_id', eventId)
    .eq('type', type);

  assertNoError(result.error, `load notification log (${type})`);
  return result.data ?? [];
}

async function waitForNotificationRows(eventId, type, minimumCount, timeoutMs = 15_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const rows = await loadNotificationRows(eventId, type);

    if (rows.length >= minimumCount) {
      return rows;
    }

    await sleep(1_000);
  }

  return loadNotificationRows(eventId, type);
}

function expectNotificationRecipients(rows, expectedUserIds, unexpectedUserIds, label) {
  const notifiedUserIds = new Set(rows.map((row) => row.user_id).filter(Boolean));

  for (const expectedUserId of expectedUserIds) {
    if (!notifiedUserIds.has(expectedUserId)) {
      throw new Error(
        `${label} expected notification for ${expectedUserId}, received ${JSON.stringify(rows)}.`,
      );
    }
  }

  for (const unexpectedUserId of unexpectedUserIds) {
    if (notifiedUserIds.has(unexpectedUserId)) {
      throw new Error(
        `${label} must not notify ${unexpectedUserId}, received ${JSON.stringify(rows)}.`,
      );
    }
  }
}

async function countRows(table, column, value) {
  const result = await serviceClient
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq(column, value);
  assertNoError(result.error, `count rows ${table}.${column}=${value}`);
  return result.count ?? 0;
}

async function loadProfile(userId) {
  const result = await serviceClient.from('profiles').select('id').eq('id', userId).maybeSingle();
  assertNoError(result.error, `load profile ${userId}`);
  return result.data;
}

async function loadEvent(eventId) {
  const result = await serviceClient.from('events').select('id, status').eq('id', eventId).single();

  assertNoError(result.error, `load event ${eventId}`);
  return result.data;
}

async function loadEventPlayer(eventId, userId) {
  const result = await serviceClient
    .from('event_players')
    .select('event_id, user_id, status')
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .maybeSingle();

  assertNoError(result.error, `load event_player ${eventId}/${userId}`);
  return result.data;
}

async function loadEventPlayersForEvent(eventId) {
  const result = await serviceClient
    .from('event_players')
    .select('event_id, user_id, status')
    .eq('event_id', eventId);

  assertNoError(result.error, `load event_players for ${eventId}`);
  return result.data ?? [];
}

async function loadPostGameThumbRow(eventId, toUserId) {
  const result = await serviceClient
    .from('post_game_thumbs')
    .select('event_id, from_user, to_user')
    .eq('event_id', eventId)
    .eq('to_user', toUserId)
    .maybeSingle();

  assertNoError(result.error, `load post_game_thumb ${eventId}/${toUserId}`);
  return result.data;
}

async function countReportsForTarget(input) {
  let query = serviceClient
    .from('reports')
    .select('id', { count: 'exact', head: true })
    .eq('reporter_id', input.reporterId)
    .eq('target_type', input.targetType);

  if (input.targetType === 'event') {
    query = query.eq('target_event_id', input.targetEventId);
  } else {
    query = query.eq('target_user_id', input.targetUserId);
  }

  const result = await query;
  assertNoError(
    result.error,
    `count reports for ${input.reporterId}/${input.targetType}/${input.targetEventId ?? input.targetUserId}`,
  );
  return result.count ?? 0;
}

const supabaseUrl = requiredEnv('EXPO_PUBLIC_SUPABASE_URL');
const supabaseAnonKey = requiredEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');
const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function main() {
  const sportResult = await serviceClient.from('sports').select('id').eq('slug', 'padel').single();
  assertNoError(sportResult.error, 'load padel sport');

  if (!sportResult.data?.id) {
    throw new Error('Padel sport is missing.');
  }

  const reporter = await createConfirmedUser('reporter');
  await upsertUserSport(reporter.userId, sportResult.data.id, 3);

  const reportTargetPlayer = await createConfirmedUser('report-target-player');
  await upsertUserSport(reportTargetPlayer.userId, sportResult.data.id, 2);

  const reportVenueId = await createVenue(reporter.client, {
    name: `M10 Report Venue ${randomUUID()}`,
    city: 'Ostrava',
    address: 'Milestone 10 reporting lane',
    createdBy: reporter.userId,
  });
  const reportEventId = await createFutureEvent({
    organizerUserId: reportTargetPlayer.userId,
    sportId: sportResult.data.id,
    venueId: reportVenueId,
    city: 'Ostrava',
    description: 'Milestone 10 report target',
  });

  const eventReportResponse = await callFunctionRoute('reports', '', reporter.accessToken, {
    target_type: 'event',
    target_event_id: reportEventId,
    target_user_id: null,
    reason: 'spam_or_fake',
    detail: 'Milestone 10 event report verification',
  });
  const eventReport = expectSuccess(eventReportResponse, 'submit event report');

  if (eventReport.target_type !== 'event' || eventReport.target_event_id !== reportEventId) {
    throw new Error(`Unexpected event report payload: ${JSON.stringify(eventReport)}.`);
  }

  const persistedEventReportCount = await countReportsForTarget({
    reporterId: reporter.userId,
    targetType: 'event',
    targetEventId: reportEventId,
  });

  if (persistedEventReportCount !== 1) {
    throw new Error(
      `Expected exactly one persisted event report, received ${persistedEventReportCount}.`,
    );
  }

  const duplicateEventReportResponse = await callFunctionRoute(
    'reports',
    '',
    reporter.accessToken,
    {
      target_type: 'event',
      target_event_id: reportEventId,
      target_user_id: null,
      reason: 'spam_or_fake',
      detail: 'Duplicate event report verification',
    },
  );
  expectError(duplicateEventReportResponse, 409, 'DUPLICATE_USER_REPORT', 'duplicate event report');

  const persistedEventReportCountAfterDuplicate = await countReportsForTarget({
    reporterId: reporter.userId,
    targetType: 'event',
    targetEventId: reportEventId,
  });

  if (persistedEventReportCountAfterDuplicate !== 1) {
    throw new Error(
      `Duplicate event report changed persisted count unexpectedly: ${persistedEventReportCountAfterDuplicate}.`,
    );
  }

  const playerReportResponse = await callFunctionRoute('reports', '', reporter.accessToken, {
    target_type: 'player',
    target_event_id: null,
    target_user_id: reportTargetPlayer.userId,
    reason: 'abusive_behavior',
    detail: 'Milestone 10 player report verification',
  });
  const playerReport = expectSuccess(playerReportResponse, 'submit player report');

  if (
    playerReport.target_type !== 'player' ||
    playerReport.target_user_id !== reportTargetPlayer.userId
  ) {
    throw new Error(`Unexpected player report payload: ${JSON.stringify(playerReport)}.`);
  }

  const persistedPlayerReportCount = await countReportsForTarget({
    reporterId: reporter.userId,
    targetType: 'player',
    targetUserId: reportTargetPlayer.userId,
  });

  if (persistedPlayerReportCount !== 1) {
    throw new Error(
      `Expected exactly one persisted player report, received ${persistedPlayerReportCount}.`,
    );
  }

  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const rateLimitedReporter = await createConfirmedUser('report-rate-limit');
    const rateLimitTargets = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        createConfirmedUser(`report-rate-target-${index + 1}`),
      ),
    );

    for (let index = 0; index < 5; index += 1) {
      const response = await callFunctionRoute('reports', '', rateLimitedReporter.accessToken, {
        target_type: 'player',
        target_event_id: null,
        target_user_id: rateLimitTargets[index].userId,
        reason: 'other',
        detail: `Rate limit warmup ${index + 1}`,
      });
      expectSuccess(response, `submit report warmup ${index + 1}`);
    }

    const rateLimitedResponse = await callFunctionRoute(
      'reports',
      '',
      rateLimitedReporter.accessToken,
      {
        target_type: 'player',
        target_event_id: null,
        target_user_id: rateLimitTargets[5].userId,
        reason: 'other',
        detail: 'Rate limit trip',
      },
    );
    expectError(rateLimitedResponse, 429, 'RATE_LIMITED', 'submit report rate limit');
  }

  const deletingUser = await createConfirmedUser('delete-me');
  const otherOrganizer = await createConfirmedUser('other-organizer');
  const organizedParticipant = await createConfirmedUser('organized-participant');
  const joinedWaitlisted = await createConfirmedUser('joined-waitlisted');
  const joinedConfirmed = await createConfirmedUser('joined-confirmed');

  await Promise.all([
    upsertUserSport(deletingUser.userId, sportResult.data.id, 3),
    upsertUserSport(otherOrganizer.userId, sportResult.data.id, 3),
    upsertUserSport(organizedParticipant.userId, sportResult.data.id, 2),
    upsertUserSport(joinedWaitlisted.userId, sportResult.data.id, 2),
    upsertUserSport(joinedConfirmed.userId, sportResult.data.id, 2),
  ]);

  const deleteVenueId = await createVenue(deletingUser.client, {
    name: `M10 Delete Venue ${randomUUID()}`,
    city: 'Ostrava',
    address: 'Milestone 10 delete lane',
    createdBy: deletingUser.userId,
  });

  const organizedEventId = await createFutureEvent({
    organizerUserId: deletingUser.userId,
    sportId: sportResult.data.id,
    venueId: deleteVenueId,
    city: 'Ostrava',
    description: 'Milestone 10 organized event deletion',
  });
  await createEventPlayer({
    eventId: organizedEventId,
    userId: organizedParticipant.userId,
    status: 'confirmed',
  });

  const joinedEventId = await createFutureEvent({
    organizerUserId: otherOrganizer.userId,
    sportId: sportResult.data.id,
    venueId: deleteVenueId,
    city: 'Ostrava',
    description: 'Milestone 10 joined event deletion',
  });
  await createEventPlayer({
    eventId: joinedEventId,
    userId: deletingUser.userId,
    status: 'confirmed',
  });
  await createEventPlayer({
    eventId: joinedEventId,
    userId: joinedConfirmed.userId,
    status: 'confirmed',
  });
  await createEventPlayer({
    eventId: joinedEventId,
    userId: joinedWaitlisted.userId,
    status: 'waitlisted',
  });

  await Promise.all([
    createAvailability({
      userId: deletingUser.userId,
      sportId: sportResult.data.id,
      city: 'Ostrava',
    }),
    createDeviceToken(deletingUser.userId),
    createDeviceToken(organizedParticipant.userId),
    createDeviceToken(joinedWaitlisted.userId),
    insertConsentLog(deletingUser.userId),
  ]);

  const pastEventId = await createPastEvent({
    organizerUserId: otherOrganizer.userId,
    sportId: sportResult.data.id,
    venueId: deleteVenueId,
    city: 'Ostrava',
    description: 'Milestone 10 historical thumb preservation',
  });
  await createPostGameThumb({
    eventId: pastEventId,
    fromUserId: deletingUser.userId,
    toUserId: joinedConfirmed.userId,
    sportId: sportResult.data.id,
  });

  const deleteAccountResponse = await callFunctionRoute(
    'account',
    '/delete',
    deletingUser.accessToken,
    {},
  );
  const deleteAccountData = expectSuccess(deleteAccountResponse, 'delete account');

  if (
    !deleteAccountData.cancelled_event_ids.includes(organizedEventId) ||
    !deleteAccountData.removed_from_event_ids.includes(joinedEventId)
  ) {
    throw new Error(`Unexpected account deletion payload: ${JSON.stringify(deleteAccountData)}.`);
  }

  const [
    organizedEvent,
    joinedEventPlayers,
    promotedMembership,
    deletedProfile,
    deletedAvailabilityCount,
    deletedDeviceTokenCount,
    deletedConsentCount,
    organizedCancelRows,
    promotedRows,
    preservedThumb,
  ] = await Promise.all([
    loadEvent(organizedEventId),
    loadEventPlayersForEvent(joinedEventId),
    loadEventPlayer(joinedEventId, joinedWaitlisted.userId),
    loadProfile(deletingUser.userId),
    countRows('player_availability', 'user_id', deletingUser.userId),
    countRows('device_tokens', 'user_id', deletingUser.userId),
    countRows('consent_log', 'user_id', deletingUser.userId),
    waitForNotificationRows(organizedEventId, 'event_cancelled', 1),
    waitForNotificationRows(joinedEventId, 'waitlist_promoted', 1),
    loadPostGameThumbRow(pastEventId, joinedConfirmed.userId),
  ]);

  if (organizedEvent?.status !== 'cancelled') {
    throw new Error(`Organized event was not cancelled: ${JSON.stringify(organizedEvent)}.`);
  }

  const deletedMembershipRow = joinedEventPlayers.find(
    (row) => row.status === 'removed' && row.user_id === null,
  );

  if (!deletedMembershipRow) {
    throw new Error(
      `Deleted user was not removed from joined event: ${JSON.stringify(joinedEventPlayers)}.`,
    );
  }

  if (promotedMembership?.status !== 'confirmed') {
    throw new Error(`Waitlisted user was not promoted: ${JSON.stringify(promotedMembership)}.`);
  }

  if (deletedProfile) {
    throw new Error(`Deleted user profile still exists: ${JSON.stringify(deletedProfile)}.`);
  }

  if (
    deletedAvailabilityCount !== 0 ||
    deletedDeviceTokenCount !== 0 ||
    deletedConsentCount !== 0
  ) {
    throw new Error(
      `Deletion cleanup mismatch: availability=${deletedAvailabilityCount}, device_tokens=${deletedDeviceTokenCount}, consent_log=${deletedConsentCount}.`,
    );
  }

  expectNotificationRecipients(
    organizedCancelRows,
    [organizedParticipant.userId],
    [deletingUser.userId],
    'organized event cancellation notifications',
  );
  expectNotificationRecipients(
    promotedRows,
    [joinedWaitlisted.userId],
    [deletingUser.userId],
    'waitlist promotion notifications after account deletion',
  );

  if (!preservedThumb || preservedThumb.from_user !== null) {
    throw new Error(
      `Historical thumbs-up row was not preserved with a null from_user: ${JSON.stringify(preservedThumb)}.`,
    );
  }

  const deletedAuthUserResult = await serviceClient.auth.admin.getUserById(deletingUser.userId);

  if (!deletedAuthUserResult.error || deletedAuthUserResult.error.status !== 404) {
    throw new Error(
      `Deleted auth user should return 404, received ${JSON.stringify(deletedAuthUserResult)}.`,
    );
  }

  const summary = {
    reports: {
      eventReportId: eventReport.id,
      playerReportId: playerReport.id,
      emailContractProven: true,
    },
    accountDeletion: {
      cancelledEventId: organizedEventId,
      removedFromEventId: joinedEventId,
      pastThumbPreserved: true,
    },
  };

  console.info(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
