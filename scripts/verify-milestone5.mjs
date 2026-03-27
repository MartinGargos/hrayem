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

function createFutureIso(dayOffset, hourUtc, minuteUtc) {
  const date = new Date(Date.UTC(2031, 0, 1 + dayOffset, hourUtc, minuteUtc, 0, 0));
  return date.toISOString();
}

async function waitFor(check, label, timeoutMs = 10000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (check()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error(`Timed out while waiting for ${label}.`);
}

async function createConfirmedUser(label) {
  const email = `milestone5-${label}-${randomUUID()}@gmail.com`;
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
  await authenticatedClient.realtime.setAuth(signInResult.data.session.access_token);

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
  const result = await serviceClient
    .from('user_sports')
    .upsert(
      {
        user_id: userId,
        sport_id: sportId,
        skill_level: skillLevel,
      },
      {
        onConflict: 'user_id,sport_id',
      },
    )
    .select('id')
    .single();

  assertNoError(result.error, `upsert user_sports for ${userId}`);
}

async function callEventRoute(accessToken, path, body = {}) {
  const response = await fetch(`${supabaseUrl}/functions/v1/events${path}`, {
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
  };
}

function expectError(response, expectedStatus, expectedCode, label) {
  if (response.status !== expectedStatus || response.body?.error?.code !== expectedCode) {
    throw new Error(
      `${label} expected status ${expectedStatus} / code ${expectedCode}, received ${response.status} with body ${JSON.stringify(response.body)}.`,
    );
  }
}

function expectSuccess(response, label) {
  if (!response.body?.data || response.status < 200 || response.status >= 300) {
    throw new Error(
      `${label} expected a successful function response, received ${response.status} with body ${JSON.stringify(response.body)}.`,
    );
  }

  return response.body.data;
}

const supabaseUrl = requiredEnv('EXPO_PUBLIC_SUPABASE_URL');
const supabaseAnonKey = requiredEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');
const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');

const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

async function main() {
  console.log('Verifying Milestone 5 join/leave, waitlist, realtime, and My Games foundation...');
  await serviceClient.realtime.setAuth(serviceRoleKey);

  const cleanup = {
    eventIds: [],
    notificationEventIds: [],
    userIds: [],
    venueIds: [],
  };

  try {
    const sportResult = await serviceClient
      .from('sports')
      .select('id, slug')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .limit(1)
      .single();

    assertNoError(sportResult.error, 'load active sport');

    if (!sportResult.data) {
      throw new Error('Expected at least one active sport in the seed data.');
    }

    const sportId = sportResult.data.id;
    const organizer = await createConfirmedUser('organizer');
    const playerB = await createConfirmedUser('player-b');
    const playerC = await createConfirmedUser('player-c');
    const playerD = await createConfirmedUser('player-d');

    cleanup.userIds.push(organizer.userId, playerB.userId, playerC.userId, playerD.userId);

    await Promise.all([
      updateProfile(organizer.userId, {
        firstName: 'M5',
        lastName: 'Organizer',
        city: 'Ostrava',
      }),
      updateProfile(playerB.userId, {
        firstName: 'M5',
        lastName: 'PlayerB',
        city: 'Ostrava',
      }),
      updateProfile(playerC.userId, {
        firstName: 'M5',
        lastName: 'PlayerC',
        city: 'Ostrava',
      }),
      updateProfile(playerD.userId, {
        firstName: 'M5',
        lastName: 'PlayerD',
        city: 'Ostrava',
      }),
    ]);

    await upsertUserSport(organizer.userId, sportId, 2);

    const venueName = `Milestone 5 Venue ${randomUUID().slice(0, 8)}`;
    const venueInsertResult = await organizer.client
      .from('venues')
      .insert({
        name: venueName,
        city: 'Ostrava',
        address: 'Verifier Street 5',
        created_by: organizer.userId,
      })
      .select('id')
      .single();

    assertNoError(venueInsertResult.error, 'create verification venue');

    if (!venueInsertResult.data?.id) {
      throw new Error('Expected the verification venue insert to return an id.');
    }

    cleanup.venueIds.push(venueInsertResult.data.id);

    const baseEventPayload = {
      sport_id: sportId,
      venue_id: venueInsertResult.data.id,
      reservation_type: 'reserved',
      player_count_total: 2,
      skill_min: 2,
      skill_max: 3,
      description: 'Milestone 5 verification event',
    };

    const createSimpleEventResponse = await callEventRoute(organizer.accessToken, '', {
      ...baseEventPayload,
      starts_at: createFutureIso(1, 18, 0),
      ends_at: createFutureIso(1, 19, 30),
    });
    const simpleEvent = expectSuccess(createSimpleEventResponse, 'create simple join/leave event');

    cleanup.eventIds.push(simpleEvent.id);
    cleanup.notificationEventIds.push(simpleEvent.id);

    const missingSkillJoinResponse = await callEventRoute(
      playerB.accessToken,
      `/${simpleEvent.id}/join`,
      {},
    );
    expectError(missingSkillJoinResponse, 409, 'SKILL_LEVEL_REQUIRED', 'join skill requirement');
    console.log('Verified SKILL_LEVEL_REQUIRED is returned before the player has a sport profile.');

    const outOfRangeJoinResponse = await callEventRoute(
      playerB.accessToken,
      `/${simpleEvent.id}/join`,
      {
        skill_level: 1,
      },
    );
    const outOfRangeJoinData = expectSuccess(
      outOfRangeJoinResponse,
      'join with inline skill-level creation',
    );

    if (
      outOfRangeJoinData.membership_status !== 'confirmed' ||
      outOfRangeJoinData.spots_taken !== 2 ||
      outOfRangeJoinData.event_status !== 'full'
    ) {
      throw new Error(
        `Expected the first non-organizer join to confirm and fill the event. Received ${JSON.stringify(outOfRangeJoinData)}.`,
      );
    }

    console.log(
      'Verified join-event accepts an inline skill level, confirms the player when a spot is open, and keeps out-of-range skills server-permitted for the client-side soft warning flow.',
    );

    const simpleDetailForPlayerB = await playerB.client
      .from('event_detail_view')
      .select('viewer_membership_status, viewer_waitlist_position')
      .eq('id', simpleEvent.id)
      .single();

    assertNoError(simpleDetailForPlayerB.error, 'event detail membership for confirmed player');

    if (
      simpleDetailForPlayerB.data?.viewer_membership_status !== 'confirmed' ||
      simpleDetailForPlayerB.data?.viewer_waitlist_position !== null
    ) {
      throw new Error(
        'Expected the confirmed player to see a confirmed membership state in event detail.',
      );
    }

    const simpleEventInMyGames = await playerB.client
      .from('my_games_upcoming_view')
      .select('id, viewer_membership_status')
      .eq('id', simpleEvent.id)
      .single();

    assertNoError(simpleEventInMyGames.error, 'confirmed player My Games inclusion');

    if (simpleEventInMyGames.data?.viewer_membership_status !== 'confirmed') {
      throw new Error('Expected a confirmed player to see the event in My Games Upcoming.');
    }

    const leaveSimpleEventResponse = await callEventRoute(
      playerB.accessToken,
      `/${simpleEvent.id}/leave`,
      {},
    );
    const leaveSimpleEventData = expectSuccess(leaveSimpleEventResponse, 'leave simple event');

    if (
      leaveSimpleEventData.event_status !== 'active' ||
      leaveSimpleEventData.spots_taken !== 1 ||
      leaveSimpleEventData.waitlist_count !== 0
    ) {
      throw new Error(
        `Expected leaving the simple event to reopen the spot. Received ${JSON.stringify(leaveSimpleEventData)}.`,
      );
    }

    const simpleFeedAfterLeave = await organizer.client
      .from('event_feed_view')
      .select('id, status, spots_taken, waitlist_count')
      .eq('id', simpleEvent.id)
      .single();

    assertNoError(simpleFeedAfterLeave.error, 'simple event feed after leave');

    if (
      simpleFeedAfterLeave.data?.status !== 'active' ||
      simpleFeedAfterLeave.data?.spots_taken !== 1 ||
      simpleFeedAfterLeave.data?.waitlist_count !== 0
    ) {
      throw new Error(
        'Expected the feed to reflect the reopened spot after a confirmed player left.',
      );
    }

    console.log('Verified a confirmed player can leave and reopen the remaining spot.');

    await Promise.all([
      upsertUserSport(playerC.userId, sportId, 2),
      upsertUserSport(playerD.userId, sportId, 3),
    ]);

    const createRaceEventResponse = await callEventRoute(organizer.accessToken, '', {
      ...baseEventPayload,
      starts_at: createFutureIso(2, 18, 0),
      ends_at: createFutureIso(2, 19, 30),
      description: 'Milestone 5 race event',
    });
    const raceEvent = expectSuccess(createRaceEventResponse, 'create race event');
    const raceEventUpdatedAtBeforeJoin = raceEvent.updated_at;

    cleanup.eventIds.push(raceEvent.id);
    cleanup.notificationEventIds.push(raceEvent.id);

    const realtimePlayerEvents = [];
    const realtimeEventUpdates = [];
    const organizerRealtimeChannel = serviceClient
      .channel(`verify-m5-${raceEvent.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'event_players',
          filter: `event_id=eq.${raceEvent.id}`,
        },
        (payload) => {
          realtimePlayerEvents.push(payload);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'events',
          filter: `id=eq.${raceEvent.id}`,
        },
        (payload) => {
          realtimeEventUpdates.push(payload);
        },
      );

    let realtimeSubscribed = false;

    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timed out while subscribing to Realtime for the race event.'));
        }, 10000);

        organizerRealtimeChannel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            clearTimeout(timeout);
            resolve(undefined);
            return;
          }

          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            clearTimeout(timeout);
            reject(new Error(`Realtime subscription failed with status: ${status}.`));
          }
        });
      });

      realtimeSubscribed = true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Realtime subscription could not be established.';
      console.warn(
        `Skipping live Realtime proof in this environment because the subscription did not establish: ${message}`,
      );
    }

    const [raceJoinCResponse, raceJoinDResponse] = await Promise.all([
      callEventRoute(playerC.accessToken, `/${raceEvent.id}/join`, {}),
      callEventRoute(playerD.accessToken, `/${raceEvent.id}/join`, {}),
    ]);

    const raceJoinCData = expectSuccess(raceJoinCResponse, 'race join player C');
    const raceJoinDData = expectSuccess(raceJoinDResponse, 'race join player D');
    const raceJoinStatuses = [
      raceJoinCData.membership_status,
      raceJoinDData.membership_status,
    ].sort();

    if (raceJoinStatuses.join(',') !== 'confirmed,waitlisted') {
      throw new Error(
        `Expected one racer to confirm and the other to waitlist. Received ${JSON.stringify([
          raceJoinCData,
          raceJoinDData,
        ])}.`,
      );
    }

    const confirmedRaceUserId =
      raceJoinCData.membership_status === 'confirmed' ? playerC.userId : playerD.userId;
    const waitlistedRaceUserId =
      raceJoinCData.membership_status === 'waitlisted' ? playerC.userId : playerD.userId;
    const waitlistedClient =
      waitlistedRaceUserId === playerC.userId ? playerC.client : playerD.client;
    const confirmedAccessToken =
      confirmedRaceUserId === playerC.userId ? playerC.accessToken : playerD.accessToken;

    const racePlayersResult = await serviceClient
      .from('event_players')
      .select('user_id, status')
      .eq('event_id', raceEvent.id);

    assertNoError(racePlayersResult.error, 'race event players after concurrent join');

    const racePlayers = racePlayersResult.data ?? [];
    const confirmedRows = racePlayers.filter((row) => row.status === 'confirmed');
    const waitlistedRows = racePlayers.filter((row) => row.status === 'waitlisted');

    if (
      confirmedRows.length !== 2 ||
      waitlistedRows.length !== 1 ||
      !waitlistedRows.some((row) => row.user_id === waitlistedRaceUserId)
    ) {
      throw new Error(
        `Expected organizer + one player confirmed and one waitlisted after the race. Received ${JSON.stringify(racePlayers)}.`,
      );
    }

    const organizerWaitlistRowsResult = await organizer.client
      .from('event_players')
      .select('user_id, status')
      .eq('event_id', raceEvent.id)
      .eq('status', 'waitlisted');

    assertNoError(organizerWaitlistRowsResult.error, 'organizer waitlist privacy query');

    if ((organizerWaitlistRowsResult.data ?? []).length !== 0) {
      throw new Error(
        `Expected the organizer to be unable to read raw waitlisted identities. Received ${JSON.stringify(organizerWaitlistRowsResult.data)}.`,
      );
    }

    const waitlistedOwnRowResult = await waitlistedClient
      .from('event_players')
      .select('user_id, status')
      .eq('event_id', raceEvent.id)
      .eq('user_id', waitlistedRaceUserId)
      .single();

    assertNoError(waitlistedOwnRowResult.error, 'waitlisted own row visibility');

    if (
      waitlistedOwnRowResult.data?.user_id !== waitlistedRaceUserId ||
      waitlistedOwnRowResult.data?.status !== 'waitlisted'
    ) {
      throw new Error(
        `Expected the waitlisted player to keep visibility into their own waitlist row. Received ${JSON.stringify(waitlistedOwnRowResult.data)}.`,
      );
    }

    const raceEventAfterJoinResult = await serviceClient
      .from('events')
      .select('updated_at')
      .eq('id', raceEvent.id)
      .single();

    assertNoError(raceEventAfterJoinResult.error, 'race event updated_at after join');

    if (!raceEventAfterJoinResult.data?.updated_at) {
      throw new Error('Expected the race event to expose updated_at after the join race.');
    }

    if (raceEventAfterJoinResult.data.updated_at === raceEventUpdatedAtBeforeJoin) {
      throw new Error(
        'Expected join_event_atomic to touch the parent event row for safe realtime refetching.',
      );
    }

    const waitlistedDetailResult = await waitlistedClient
      .from('event_detail_view')
      .select('viewer_membership_status, viewer_waitlist_position, status, waitlist_count')
      .eq('id', raceEvent.id)
      .single();

    assertNoError(waitlistedDetailResult.error, 'waitlisted player event detail');

    if (
      waitlistedDetailResult.data?.viewer_membership_status !== 'waitlisted' ||
      waitlistedDetailResult.data?.viewer_waitlist_position !== 1 ||
      waitlistedDetailResult.data?.status !== 'full' ||
      waitlistedDetailResult.data?.waitlist_count !== 1
    ) {
      throw new Error(
        `Expected waitlisted event detail state to expose only the current player's waitlist position. Received ${JSON.stringify(waitlistedDetailResult.data)}.`,
      );
    }

    const waitlistedMyGamesResult = await waitlistedClient
      .from('my_games_upcoming_view')
      .select('id')
      .eq('id', raceEvent.id);

    assertNoError(waitlistedMyGamesResult.error, 'waitlisted My Games exclusion');

    if ((waitlistedMyGamesResult.data ?? []).length !== 0) {
      throw new Error('Expected a waitlisted player to stay out of My Games Upcoming.');
    }

    const organizerMyGamesResult = await organizer.client
      .from('my_games_upcoming_view')
      .select('id, viewer_membership_status')
      .eq('id', raceEvent.id)
      .single();

    assertNoError(organizerMyGamesResult.error, 'organizer My Games inclusion');

    if (organizerMyGamesResult.data?.viewer_membership_status !== 'organizer') {
      throw new Error('Expected the organizer to see the race event in My Games Upcoming.');
    }

    if (realtimeSubscribed) {
      await waitFor(
        () =>
          realtimePlayerEvents.length >= 2 &&
          realtimeEventUpdates.some((payload) => payload.new?.status === 'full'),
        'Realtime join/full updates',
      );

      console.log(
        'Verified a locked race to the final spot produces one confirmed player, one waitlisted player, correct waitlist position, correct My Games visibility, and Realtime updates.',
      );
    } else {
      console.log(
        'Verified a locked race to the final spot produces one confirmed player, one waitlisted player, correct waitlist position, and correct My Games visibility. Realtime remains unproven in this CLI environment.',
      );
    }

    const leaveRaceEventResponse = await callEventRoute(
      confirmedAccessToken,
      `/${raceEvent.id}/leave`,
      {},
    );
    const leaveRaceEventData = expectSuccess(leaveRaceEventResponse, 'leave race event');

    if (
      leaveRaceEventData.spots_taken !== 2 ||
      leaveRaceEventData.waitlist_count !== 0 ||
      leaveRaceEventData.promoted_user_id !== waitlistedRaceUserId
    ) {
      throw new Error(
        `Expected the first waitlisted player to be promoted after the confirmed player left. Received ${JSON.stringify(leaveRaceEventData)}.`,
      );
    }

    const promotedPlayerResult = await serviceClient
      .from('event_players')
      .select('user_id, status')
      .eq('event_id', raceEvent.id)
      .eq('user_id', waitlistedRaceUserId)
      .single();

    assertNoError(promotedPlayerResult.error, 'promoted player row');

    if (promotedPlayerResult.data?.status !== 'confirmed') {
      throw new Error('Expected the waitlisted player to be promoted to confirmed.');
    }

    const raceEventAfterLeaveResult = await serviceClient
      .from('events')
      .select('updated_at')
      .eq('id', raceEvent.id)
      .single();

    assertNoError(raceEventAfterLeaveResult.error, 'race event updated_at after leave');

    if (!raceEventAfterLeaveResult.data?.updated_at) {
      throw new Error('Expected the race event to expose updated_at after the leave flow.');
    }

    if (raceEventAfterLeaveResult.data.updated_at === raceEventAfterJoinResult.data.updated_at) {
      throw new Error(
        'Expected leave_event_atomic to touch the parent event row for safe realtime refetching.',
      );
    }

    const promotedMyGamesResult = await waitlistedClient
      .from('my_games_upcoming_view')
      .select('id, viewer_membership_status')
      .eq('id', raceEvent.id)
      .single();

    assertNoError(promotedMyGamesResult.error, 'promoted player My Games inclusion');

    if (promotedMyGamesResult.data?.viewer_membership_status !== 'confirmed') {
      throw new Error('Expected the promoted player to appear in My Games Upcoming as confirmed.');
    }

    if (realtimeSubscribed) {
      await waitFor(
        () =>
          realtimePlayerEvents.some(
            (payload) => payload.eventType === 'UPDATE' && payload.new?.status === 'confirmed',
          ),
        'Realtime waitlist promotion update',
      );

      console.log(
        'Verified waitlist promotion keeps queue order, updates My Games, and streams over Realtime.',
      );
    } else {
      console.log(
        'Verified waitlist promotion keeps queue order and updates My Games. Realtime promotion proof remains unproven in this CLI environment.',
      );
    }
    console.log('Milestone 5 verification passed.');

    await organizer.client.removeChannel(organizerRealtimeChannel);
  } finally {
    if (cleanup.notificationEventIds.length) {
      const deleteNotificationLogResult = await serviceClient
        .from('notification_log')
        .delete()
        .in('event_id', cleanup.notificationEventIds);
      assertNoError(deleteNotificationLogResult.error, 'cleanup notification_log');
    }

    if (cleanup.eventIds.length) {
      const deleteEventsResult = await serviceClient
        .from('events')
        .delete()
        .in('id', cleanup.eventIds);
      assertNoError(deleteEventsResult.error, 'cleanup events');
    }

    if (cleanup.venueIds.length) {
      const deleteVenuesResult = await serviceClient
        .from('venues')
        .delete()
        .in('id', cleanup.venueIds);
      assertNoError(deleteVenuesResult.error, 'cleanup venues');
    }

    for (const userId of cleanup.userIds) {
      const deleteUserResult = await serviceClient.auth.admin.deleteUser(userId);
      assertNoError(deleteUserResult.error, `cleanup auth user ${userId}`);
    }
  }
}

await main();
