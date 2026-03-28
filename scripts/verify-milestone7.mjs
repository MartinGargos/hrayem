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

function dateDaysAgo(daysAgo) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

async function createConfirmedUser(label) {
  const email = `milestone7-${label}-${randomUUID()}@gmail.com`;
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

async function createVenue(client, input) {
  const result = await client
    .from('venues')
    .insert({
      name: input.name,
      city: input.city,
      address: input.address,
      created_by: input.createdBy,
    })
    .select('id, city')
    .single();

  assertNoError(result.error, `create venue ${input.name}`);

  if (!result.data?.id) {
    throw new Error(`Expected a venue id for ${input.name}.`);
  }

  return result.data;
}

async function callEventRoute(accessToken, path, options = {}) {
  const response = await fetch(`${supabaseUrl}/functions/v1/events${path}`, {
    method: options.method ?? 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(options.body ?? {}),
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

async function createEventAndJoinPlayers({
  description,
  organizer,
  playerB,
  playerC,
  sportId,
  venueId,
  playerCountTotal = 3,
}) {
  const createResponse = await callEventRoute(organizer.accessToken, '', {
    body: {
      sport_id: sportId,
      venue_id: venueId,
      starts_at: relativeIso(24),
      ends_at: relativeIso(25),
      reservation_type: 'reserved',
      player_count_total: playerCountTotal,
      skill_min: 2,
      skill_max: 3,
      description,
    },
  });
  const event = expectSuccess(createResponse, `create event (${description})`);

  if (playerB) {
    expectSuccess(
      await callEventRoute(playerB.accessToken, `/${event.id}/join`, {
        body: {},
      }),
      `join event as player B (${description})`,
    );
  }

  if (playerC) {
    expectSuccess(
      await callEventRoute(playerC.accessToken, `/${event.id}/join`, {
        body: {},
      }),
      `join event as player C (${description})`,
    );
  }

  return event;
}

async function setEventTimes(eventId, startsAt, endsAt) {
  const result = await serviceClient
    .from('events')
    .update({
      starts_at: startsAt,
      ends_at: endsAt,
    })
    .eq('id', eventId);

  assertNoError(result.error, `set event times for ${eventId}`);
}

async function loadUserSport(userId, sportId) {
  const result = await serviceClient
    .from('user_sports')
    .select('games_played, hours_played, no_shows')
    .eq('user_id', userId)
    .eq('sport_id', sportId)
    .single();

  assertNoError(result.error, `load user_sports ${userId}`);

  return result.data;
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
  console.log('Verifying Milestone 7 lifecycle, past games, no-shows, and post-game feedback...');

  const cleanup = {
    availabilityIds: [],
    eventIds: [],
    notificationEventIds: [],
    userIds: [],
    venueIds: [],
  };

  try {
    const sportResult = await serviceClient
      .from('sports')
      .select('id')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .limit(1)
      .single();

    assertNoError(sportResult.error, 'load active sport');

    if (!sportResult.data?.id) {
      throw new Error('Expected at least one active sport in seed data.');
    }

    const sportId = sportResult.data.id;
    const organizer = await createConfirmedUser('organizer');
    const playerB = await createConfirmedUser('player-b');
    const playerC = await createConfirmedUser('player-c');

    cleanup.userIds.push(organizer.userId, playerB.userId, playerC.userId);

    await Promise.all([
      updateProfile(organizer.userId, {
        firstName: 'M7',
        lastName: 'Organizer',
        city: 'Ostrava',
      }),
      updateProfile(playerB.userId, {
        firstName: 'M7',
        lastName: 'PlayerB',
        city: 'Ostrava',
      }),
      updateProfile(playerC.userId, {
        firstName: 'M7',
        lastName: 'PlayerC',
        city: 'Ostrava',
      }),
    ]);

    await Promise.all([
      upsertUserSport(organizer.userId, sportId, 2),
      upsertUserSport(playerB.userId, sportId, 2),
      upsertUserSport(playerC.userId, sportId, 3),
    ]);

    const venue = await createVenue(organizer.client, {
      name: `Milestone 7 Venue ${randomUUID().slice(0, 8)}`,
      city: 'Ostrava',
      address: 'Verifier Street 7',
      createdBy: organizer.userId,
    });

    cleanup.venueIds.push(venue.id);

    const reminderEvent = await createEventAndJoinPlayers({
      description: 'Milestone 7 reminder event',
      organizer,
      playerB,
      sportId,
      venueId: venue.id,
      playerCountTotal: 4,
    });

    cleanup.eventIds.push(reminderEvent.id);
    cleanup.notificationEventIds.push(reminderEvent.id);

    const reminderUpdateResult = await serviceClient
      .from('events')
      .update({
        starts_at: relativeIso(2),
        ends_at: relativeIso(3),
      })
      .eq('id', reminderEvent.id);

    assertNoError(reminderUpdateResult.error, 'prepare reminder event timing');

    const reminderSweepResult = await serviceClient.rpc('finish_event_sweep');
    assertNoError(reminderSweepResult.error, 'run reminder sweep');

    const reminderEventResult = await serviceClient
      .from('events')
      .select('reminder_sent')
      .eq('id', reminderEvent.id)
      .single();

    assertNoError(reminderEventResult.error, 'load reminder event');

    if (!reminderEventResult.data?.reminder_sent) {
      throw new Error('Expected reminder sweep to set reminder_sent = true.');
    }

    const reminderNotificationsResult = await serviceClient
      .from('notification_log')
      .select('user_id, type')
      .eq('event_id', reminderEvent.id)
      .eq('type', 'event_reminder');

    assertNoError(reminderNotificationsResult.error, 'load reminder notifications');

    const reminderNotifications = reminderNotificationsResult.data ?? [];

    if (
      !reminderNotifications.some((row) => row.user_id === organizer.userId) ||
      !reminderNotifications.some((row) => row.user_id === playerB.userId)
    ) {
      throw new Error(
        `Expected reminder notifications for the organizer and confirmed player. Received ${JSON.stringify(reminderNotifications)}.`,
      );
    }

    console.log('Verified finish-event sweep sends reminders and flips reminder_sent.');

    const finishedEvents = [];

    for (let index = 0; index < 3; index += 1) {
      const event = await createEventAndJoinPlayers({
        description: `Milestone 7 finished event ${index + 1}`,
        organizer,
        playerB,
        playerC,
        sportId,
        venueId: venue.id,
      });

      finishedEvents.push(event);
      cleanup.eventIds.push(event.id);
      cleanup.notificationEventIds.push(event.id);
    }

    const availabilityInsertResult = await playerB.client
      .from('player_availability')
      .insert({
        user_id: playerB.userId,
        sport_id: sportId,
        city: 'Ostrava',
        available_date: dateDaysAgo(1),
        time_pref: 'evening',
        note: 'Milestone 7 expired availability',
      })
      .select('id')
      .single();

    assertNoError(availabilityInsertResult.error, 'insert expired availability');

    if (availabilityInsertResult.data?.id) {
      cleanup.availabilityIds.push(availabilityInsertResult.data.id);
    }

    await Promise.all([
      setEventTimes(finishedEvents[0].id, isoHoursAgo(3), isoHoursAgo(2)),
      setEventTimes(finishedEvents[1].id, isoHoursAgo(6), isoHoursAgo(5)),
      setEventTimes(finishedEvents[2].id, isoHoursAgo(9), isoHoursAgo(8)),
    ]);

    const finishSweepResult = await serviceClient.rpc('finish_event_sweep');
    assertNoError(finishSweepResult.error, 'run finish sweep');

    const finishSweepData = finishSweepResult.data ?? {};

    if (
      Number(finishSweepData.events_finished ?? 0) < 3 ||
      Number(finishSweepData.availability_deleted ?? 0) < 1
    ) {
      throw new Error(
        `Expected finish sweep to finish 3 events and delete expired availability. Received ${JSON.stringify(finishSweepData)}.`,
      );
    }

    const mainFinishedEventId = finishedEvents[0].id;
    const mainFinishedDetailResult = await organizer.client
      .from('event_detail_view')
      .select('id, status, ends_at, no_show_window_end, chat_closed_at, viewer_membership_status')
      .eq('id', mainFinishedEventId)
      .single();

    assertNoError(mainFinishedDetailResult.error, 'load finished event detail');

    const mainFinishedDetail = mainFinishedDetailResult.data;

    if (
      !mainFinishedDetail ||
      mainFinishedDetail.status !== 'finished' ||
      mainFinishedDetail.viewer_membership_status !== 'organizer' ||
      !mainFinishedDetail.no_show_window_end ||
      !mainFinishedDetail.chat_closed_at
    ) {
      throw new Error(
        `Expected finished event detail with post-game windows. Received ${JSON.stringify(mainFinishedDetail)}.`,
      );
    }

    const endsAtMs = new Date(mainFinishedDetail.ends_at).getTime();
    const noShowWindowEndMs = new Date(mainFinishedDetail.no_show_window_end).getTime();
    const chatClosedAtMs = new Date(mainFinishedDetail.chat_closed_at).getTime();

    if (
      noShowWindowEndMs !== endsAtMs + 24 * 60 * 60 * 1000 ||
      chatClosedAtMs !== endsAtMs + 48 * 60 * 60 * 1000
    ) {
      throw new Error(
        `Expected post-game windows to be 24h / 48h after ends_at. Received ${JSON.stringify(mainFinishedDetail)}.`,
      );
    }

    const finishedFeedResult = await organizer.client
      .from('event_feed_view')
      .select('id')
      .eq('id', mainFinishedEventId);

    assertNoError(finishedFeedResult.error, 'finished event feed exclusion');

    if ((finishedFeedResult.data ?? []).length !== 0) {
      throw new Error('Expected finished events to drop out of the home feed.');
    }

    const [organizerPastGamesResult, playerBPastGamesResult] = await Promise.all([
      organizer.client.from('my_games_past_view').select('id').eq('id', mainFinishedEventId),
      playerB.client.from('my_games_past_view').select('id').eq('id', mainFinishedEventId),
    ]);

    assertNoError(organizerPastGamesResult.error, 'organizer past games view');
    assertNoError(playerBPastGamesResult.error, 'confirmed player past games view');

    if (
      (organizerPastGamesResult.data ?? []).length !== 1 ||
      (playerBPastGamesResult.data ?? []).length !== 1
    ) {
      throw new Error(
        'Expected finished events to appear in My Games Past for organizer and confirmed players.',
      );
    }

    const [organizerSport, playerBSport, playerCSport] = await Promise.all([
      loadUserSport(organizer.userId, sportId),
      loadUserSport(playerB.userId, sportId),
      loadUserSport(playerC.userId, sportId),
    ]);

    const expectedGames = 3;
    const expectedHours = 3;

    if (
      Number(organizerSport?.games_played) !== expectedGames ||
      Number(playerBSport?.games_played) !== expectedGames ||
      Number(playerCSport?.games_played) !== expectedGames ||
      Number(organizerSport?.hours_played) !== expectedHours ||
      Number(playerBSport?.hours_played) !== expectedHours ||
      Number(playerCSport?.hours_played) !== expectedHours
    ) {
      throw new Error(
        `Expected finished-event sweep to increment games_played and hours_played for organizer and confirmed players. Received ${JSON.stringify({ organizerSport, playerBSport, playerCSport })}.`,
      );
    }

    const expiredAvailabilityResult = await serviceClient
      .from('player_availability')
      .select('id')
      .eq('user_id', playerB.userId)
      .eq('sport_id', sportId)
      .eq('available_date', dateDaysAgo(1));

    assertNoError(expiredAvailabilityResult.error, 'load expired availability after sweep');

    if ((expiredAvailabilityResult.data ?? []).length !== 0) {
      throw new Error('Expected finish-event sweep to delete expired availability rows.');
    }

    cleanup.availabilityIds.length = 0;

    console.log(
      'Verified finished lifecycle updates status, post-game windows, stats, My Games Past, and availability cleanup.',
    );

    const reportNoShowResponse = await callEventRoute(
      organizer.accessToken,
      `/${mainFinishedEventId}/no-show`,
      {
        body: {
          reported_user_id: playerB.userId,
        },
      },
    );
    expectSuccess(reportNoShowResponse, 'report no-show');

    const duplicateNoShowResponse = await callEventRoute(
      organizer.accessToken,
      `/${mainFinishedEventId}/no-show`,
      {
        body: {
          reported_user_id: playerB.userId,
        },
      },
    );
    expectError(duplicateNoShowResponse, 409, 'ALREADY_REPORTED', 'duplicate no-show rejection');

    const playerBStatsAfterNoShowResult = await organizer.client
      .from('player_profile_sport_stats_view')
      .select('no_shows')
      .eq('user_id', playerB.userId)
      .eq('sport_id', sportId)
      .single();

    assertNoError(playerBStatsAfterNoShowResult.error, 'load player B stats after no-show');

    if (Number(playerBStatsAfterNoShowResult.data?.no_shows) !== 1) {
      throw new Error(
        `Expected no-show reporting to increment the player profile count. Received ${JSON.stringify(playerBStatsAfterNoShowResult.data)}.`,
      );
    }

    console.log(
      'Verified organizer no-show reporting records once and increments the sport no-show counter.',
    );

    expectSuccess(
      await callEventRoute(playerB.accessToken, `/${finishedEvents[0].id}/thumbs-up`, {
        body: {
          to_user_id: playerC.userId,
        },
      }),
      'player B thumbs up player C on event 1',
    );
    expectSuccess(
      await callEventRoute(playerC.accessToken, `/${finishedEvents[0].id}/thumbs-up`, {
        body: {
          to_user_id: playerB.userId,
        },
      }),
      'player C thumbs up player B on event 1',
    );
    expectSuccess(
      await callEventRoute(playerC.accessToken, `/${finishedEvents[1].id}/thumbs-up`, {
        body: {
          to_user_id: playerB.userId,
        },
      }),
      'player C thumbs up player B on event 2',
    );
    expectSuccess(
      await callEventRoute(playerC.accessToken, `/${finishedEvents[2].id}/thumbs-up`, {
        body: {
          to_user_id: playerB.userId,
        },
      }),
      'player C thumbs up player B on event 3',
    );

    const duplicateThumbsResponse = await callEventRoute(
      playerC.accessToken,
      `/${finishedEvents[2].id}/thumbs-up`,
      {
        body: {
          to_user_id: playerB.userId,
        },
      },
    );
    expectError(
      duplicateThumbsResponse,
      409,
      'ALREADY_THUMBED_UP',
      'duplicate thumbs-up rejection',
    );

    const [playerBProfileStatsResult, playerCProfileStatsResult] = await Promise.all([
      serviceClient
        .from('player_profile_sport_stats_view')
        .select('games_played, thumbs_up_percentage')
        .eq('user_id', playerB.userId)
        .eq('sport_id', sportId)
        .single(),
      serviceClient
        .from('player_profile_sport_stats_view')
        .select('games_played, thumbs_up_percentage')
        .eq('user_id', playerC.userId)
        .eq('sport_id', sportId)
        .single(),
    ]);

    assertNoError(playerBProfileStatsResult.error, 'load player B thumbs-up stats');
    assertNoError(playerCProfileStatsResult.error, 'load player C thumbs-up stats');

    if (
      Number(playerBProfileStatsResult.data?.games_played) !== 3 ||
      Number(playerBProfileStatsResult.data?.thumbs_up_percentage) !== 100 ||
      Number(playerCProfileStatsResult.data?.games_played) !== 3 ||
      Number(playerCProfileStatsResult.data?.thumbs_up_percentage) !== 33
    ) {
      throw new Error(
        `Expected thumbs-up percentage to appear correctly after 3+ games. Received ${JSON.stringify({ playerB: playerBProfileStatsResult.data, playerC: playerCProfileStatsResult.data })}.`,
      );
    }

    const [playerBConnectionsResult, playerCConnectionsResult, eventSharedStatsResult] =
      await Promise.all([
        playerB.client
          .from('play_again_connections_view')
          .select('connection_user_id, sport_id')
          .eq('connection_user_id', playerC.userId)
          .eq('sport_id', sportId),
        playerC.client
          .from('play_again_connections_view')
          .select('connection_user_id, sport_id')
          .eq('connection_user_id', playerB.userId)
          .eq('sport_id', sportId),
        playerB.client
          .from('player_profile_sport_stats_view')
          .select('user_id, is_play_again_connection')
          .eq('user_id', playerC.userId)
          .eq('sport_id', sportId)
          .single(),
      ]);

    assertNoError(playerBConnectionsResult.error, 'load player B play-again connections');
    assertNoError(playerCConnectionsResult.error, 'load player C play-again connections');
    assertNoError(eventSharedStatsResult.error, 'load shared-event play-again indicator row');

    if (
      (playerBConnectionsResult.data ?? []).length !== 1 ||
      (playerCConnectionsResult.data ?? []).length !== 1 ||
      !eventSharedStatsResult.data?.is_play_again_connection
    ) {
      throw new Error(
        `Expected mutual thumbs-up to create play-again connections and shared-event indicators. Received ${JSON.stringify({ playerBConnections: playerBConnectionsResult.data, playerCConnections: playerCConnectionsResult.data, sharedStats: eventSharedStatsResult.data })}.`,
      );
    }

    console.log(
      'Verified thumbs-up persistence, percentage display after 3+ games, and play-again connections.',
    );
    console.log('Milestone 7 verification passed.');
  } finally {
    if (cleanup.availabilityIds.length) {
      const deleteAvailabilityResult = await serviceClient
        .from('player_availability')
        .delete()
        .in('id', cleanup.availabilityIds);
      assertNoError(deleteAvailabilityResult.error, 'cleanup player_availability');
    }

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
