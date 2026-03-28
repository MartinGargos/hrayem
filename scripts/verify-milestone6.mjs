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
  const date = new Date(Date.UTC(2031, 1, 1 + dayOffset, hourUtc, minuteUtc, 0, 0));
  return date.toISOString();
}

async function createConfirmedUser(label) {
  const email = `milestone6-${label}-${randomUUID()}@gmail.com`;
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
  console.log('Verifying Milestone 6 organizer edit, cancel, and remove-player flow...');

  const cleanup = {
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
      throw new Error('Expected at least one active sport in the seed data.');
    }

    const sportId = sportResult.data.id;
    const organizer = await createConfirmedUser('organizer');
    const playerB = await createConfirmedUser('player-b');
    const playerC = await createConfirmedUser('player-c');

    cleanup.userIds.push(organizer.userId, playerB.userId, playerC.userId);

    await Promise.all([
      updateProfile(organizer.userId, {
        firstName: 'M6',
        lastName: 'Organizer',
        city: 'Ostrava',
      }),
      updateProfile(playerB.userId, {
        firstName: 'M6',
        lastName: 'PlayerB',
        city: 'Ostrava',
      }),
      updateProfile(playerC.userId, {
        firstName: 'M6',
        lastName: 'PlayerC',
        city: 'Ostrava',
      }),
    ]);

    await Promise.all([
      upsertUserSport(organizer.userId, sportId, 2),
      upsertUserSport(playerB.userId, sportId, 2),
      upsertUserSport(playerC.userId, sportId, 3),
    ]);

    const venueA = await createVenue(organizer.client, {
      name: `Milestone 6 Venue A ${randomUUID().slice(0, 8)}`,
      city: 'Ostrava',
      address: 'Verifier Street 6A',
      createdBy: organizer.userId,
    });
    const venueB = await createVenue(organizer.client, {
      name: `Milestone 6 Venue B ${randomUUID().slice(0, 8)}`,
      city: 'Brno',
      address: 'Verifier Street 6B',
      createdBy: organizer.userId,
    });

    cleanup.venueIds.push(venueA.id, venueB.id);

    const baseEventPayload = {
      sport_id: sportId,
      venue_id: venueA.id,
      reservation_type: 'reserved',
      player_count_total: 3,
      skill_min: 2,
      skill_max: 3,
      description: 'Milestone 6 verification event',
    };

    const createEditableEventResponse = await callEventRoute(organizer.accessToken, '', {
      body: {
        ...baseEventPayload,
        starts_at: createFutureIso(1, 18, 0),
        ends_at: createFutureIso(1, 19, 30),
      },
    });
    const editableEvent = expectSuccess(createEditableEventResponse, 'create editable event');

    cleanup.eventIds.push(editableEvent.id);
    cleanup.notificationEventIds.push(editableEvent.id);

    const joinEditableEventResponse = await callEventRoute(
      playerB.accessToken,
      `/${editableEvent.id}/join`,
      {
        body: {},
      },
    );
    expectSuccess(joinEditableEventResponse, 'join editable event as confirmed player');

    const editResponse = await callEventRoute(organizer.accessToken, `/${editableEvent.id}`, {
      method: 'PATCH',
      body: {
        venue_id: venueB.id,
        starts_at: createFutureIso(2, 19, 0),
        ends_at: createFutureIso(2, 20, 30),
        reservation_type: 'to_be_arranged',
        player_count_total: 4,
        skill_min: 1,
        skill_max: 4,
        description: 'Edited milestone 6 verification event',
      },
    });
    const editedEvent = expectSuccess(editResponse, 'edit event');

    if (
      editedEvent.venue_id !== venueB.id ||
      editedEvent.city !== venueB.city ||
      editedEvent.reservation_type !== 'to_be_arranged' ||
      editedEvent.player_count_total !== 4 ||
      editedEvent.skill_min !== 1 ||
      editedEvent.skill_max !== 4 ||
      editedEvent.description !== 'Edited milestone 6 verification event'
    ) {
      throw new Error(
        `Expected the edited event to reflect the new venue, city, capacity, and rules. Received ${JSON.stringify(editedEvent)}.`,
      );
    }

    const editedDetailResult = await organizer.client
      .from('event_detail_view')
      .select(
        'venue_id, city, reservation_type, player_count_total, skill_min, skill_max, description',
      )
      .eq('id', editableEvent.id)
      .single();

    assertNoError(editedDetailResult.error, 'edited event detail view');

    if (
      editedDetailResult.data?.venue_id !== venueB.id ||
      editedDetailResult.data?.city !== venueB.city ||
      editedDetailResult.data?.player_count_total !== 4
    ) {
      throw new Error(
        `Expected event_detail_view to reflect the edited event state. Received ${JSON.stringify(editedDetailResult.data)}.`,
      );
    }

    console.log('Verified organizer edit updates editable fields and denormalized city correctly.');

    expectSuccess(
      await callEventRoute(playerC.accessToken, `/${editableEvent.id}/join`, {
        body: {},
      }),
      'player C joins editable event',
    );

    const reduceBelowConfirmedResponse = await callEventRoute(
      organizer.accessToken,
      `/${editableEvent.id}`,
      {
        method: 'PATCH',
        body: {
          player_count_total: 2,
        },
      },
    );
    expectError(
      reduceBelowConfirmedResponse,
      409,
      'PLAYER_COUNT_TOO_LOW',
      'edit below confirmed player count',
    );
    console.log('Verified organizer cannot reduce player_count_total below the confirmed count.');

    const createRemovalEventResponse = await callEventRoute(organizer.accessToken, '', {
      body: {
        ...baseEventPayload,
        player_count_total: 2,
        starts_at: createFutureIso(3, 18, 0),
        ends_at: createFutureIso(3, 19, 30),
        description: 'Milestone 6 remove-player event',
      },
    });
    const removalEvent = expectSuccess(createRemovalEventResponse, 'create remove-player event');

    cleanup.eventIds.push(removalEvent.id);
    cleanup.notificationEventIds.push(removalEvent.id);

    expectSuccess(
      await callEventRoute(playerB.accessToken, `/${removalEvent.id}/join`, {
        body: {},
      }),
      'player B joins removal event',
    );
    const waitlistJoinResponse = await callEventRoute(
      playerC.accessToken,
      `/${removalEvent.id}/join`,
      {
        body: {},
      },
    );
    const waitlistJoinData = expectSuccess(
      waitlistJoinResponse,
      'player C waitlists on removal event',
    );

    if (
      waitlistJoinData.membership_status !== 'waitlisted' ||
      waitlistJoinData.waitlist_position !== 1
    ) {
      throw new Error(
        `Expected player C to land on the waitlist before remove-player promotion. Received ${JSON.stringify(waitlistJoinData)}.`,
      );
    }

    const removePlayerResponse = await callEventRoute(
      organizer.accessToken,
      `/${removalEvent.id}/remove-player`,
      {
        body: {
          target_user_id: playerB.userId,
        },
      },
    );
    const removePlayerData = expectSuccess(
      removePlayerResponse,
      'organizer removes confirmed player',
    );

    if (
      removePlayerData.promoted_user_id !== playerC.userId ||
      removePlayerData.spots_taken !== 2 ||
      removePlayerData.waitlist_count !== 0 ||
      removePlayerData.event_status !== 'full'
    ) {
      throw new Error(
        `Expected confirmed-player removal to promote the first waitlisted player and keep the event full. Received ${JSON.stringify(removePlayerData)}.`,
      );
    }

    const removalPlayersResult = await serviceClient
      .from('event_players')
      .select('user_id, status')
      .eq('event_id', removalEvent.id);

    assertNoError(removalPlayersResult.error, 'event players after organizer removal');

    const removalPlayers = removalPlayersResult.data ?? [];
    const playerBRow = removalPlayers.find((row) => row.user_id === playerB.userId);
    const playerCRow = removalPlayers.find((row) => row.user_id === playerC.userId);

    if (playerBRow?.status !== 'removed' || playerCRow?.status !== 'confirmed') {
      throw new Error(
        `Expected the removed player to become removed and the waitlisted player to promote to confirmed. Received ${JSON.stringify(removalPlayers)}.`,
      );
    }

    const removalNotificationsResult = await serviceClient
      .from('notification_log')
      .select('user_id, type')
      .eq('event_id', removalEvent.id);

    assertNoError(removalNotificationsResult.error, 'remove-player notification log');

    const removalNotifications = removalNotificationsResult.data ?? [];

    if (
      !removalNotifications.some(
        (row) => row.user_id === playerB.userId && row.type === 'player_removed',
      ) ||
      !removalNotifications.some(
        (row) => row.user_id === playerC.userId && row.type === 'waitlist_promoted',
      )
    ) {
      throw new Error(
        `Expected remove-player to notify the removed player and the promoted waitlisted player. Received ${JSON.stringify(removalNotifications)}.`,
      );
    }

    const removeOrganizerResponse = await callEventRoute(
      organizer.accessToken,
      `/${removalEvent.id}/remove-player`,
      {
        body: {
          target_user_id: organizer.userId,
        },
      },
    );
    expectError(
      removeOrganizerResponse,
      409,
      'ORGANIZER_CANNOT_LEAVE',
      'organizer cannot remove themselves',
    );

    const nonOrganizerRemoveResponse = await callEventRoute(
      playerC.accessToken,
      `/${removalEvent.id}/remove-player`,
      {
        body: {
          target_user_id: organizer.userId,
        },
      },
    );
    expectError(
      nonOrganizerRemoveResponse,
      403,
      'FORBIDDEN',
      'non-organizer remove-player rejection',
    );
    console.log(
      'Verified organizer remove-player promotes the waitlist correctly and cannot target the organizer.',
    );

    const createCancelledEventResponse = await callEventRoute(organizer.accessToken, '', {
      body: {
        ...baseEventPayload,
        player_count_total: 2,
        starts_at: createFutureIso(4, 18, 0),
        ends_at: createFutureIso(4, 19, 30),
        description: 'Milestone 6 cancel event',
      },
    });
    const cancelledEvent = expectSuccess(createCancelledEventResponse, 'create cancellable event');

    cleanup.eventIds.push(cancelledEvent.id);
    cleanup.notificationEventIds.push(cancelledEvent.id);

    expectSuccess(
      await callEventRoute(playerB.accessToken, `/${cancelledEvent.id}/join`, {
        body: {},
      }),
      'player B joins cancellable event',
    );
    expectSuccess(
      await callEventRoute(playerC.accessToken, `/${cancelledEvent.id}/join`, {
        body: {},
      }),
      'player C waitlists cancellable event',
    );

    const cancelResponse = await callEventRoute(
      organizer.accessToken,
      `/${cancelledEvent.id}/cancel`,
      {
        body: {},
      },
    );
    const cancelledEventData = expectSuccess(cancelResponse, 'cancel event');

    if (cancelledEventData.status !== 'cancelled' || !cancelledEventData.chat_closed_at) {
      throw new Error(
        `Expected cancel-event to set cancelled status and close chat immediately. Received ${JSON.stringify(cancelledEventData)}.`,
      );
    }

    const cancelledDetailForConfirmedResult = await playerB.client
      .from('event_detail_view')
      .select('id, status, viewer_membership_status')
      .eq('id', cancelledEvent.id)
      .single();

    assertNoError(cancelledDetailForConfirmedResult.error, 'cancelled event detail view');

    if (
      cancelledDetailForConfirmedResult.data?.status !== 'cancelled' ||
      cancelledDetailForConfirmedResult.data?.viewer_membership_status !== 'confirmed'
    ) {
      throw new Error(
        `Expected event detail to remain available for a cancelled event with the viewer's membership preserved. Received ${JSON.stringify(cancelledDetailForConfirmedResult.data)}.`,
      );
    }

    const cancelledFeedResult = await organizer.client
      .from('event_feed_view')
      .select('id')
      .eq('id', cancelledEvent.id);

    assertNoError(cancelledFeedResult.error, 'cancelled event feed visibility');

    if ((cancelledFeedResult.data ?? []).length !== 0) {
      throw new Error('Expected a cancelled event to drop out of the home feed.');
    }

    const organizerCancelledMyGamesResult = await organizer.client
      .from('my_games_upcoming_view')
      .select('id')
      .eq('id', cancelledEvent.id);
    const playerBCancelledMyGamesResult = await playerB.client
      .from('my_games_upcoming_view')
      .select('id')
      .eq('id', cancelledEvent.id);

    assertNoError(organizerCancelledMyGamesResult.error, 'cancelled organizer My Games exclusion');
    assertNoError(playerBCancelledMyGamesResult.error, 'cancelled player My Games exclusion');

    if (
      (organizerCancelledMyGamesResult.data ?? []).length !== 0 ||
      (playerBCancelledMyGamesResult.data ?? []).length !== 0
    ) {
      throw new Error('Expected a cancelled event to drop out of My Games Upcoming.');
    }

    const cancelledNotificationsResult = await serviceClient
      .from('notification_log')
      .select('user_id, type')
      .eq('event_id', cancelledEvent.id);

    assertNoError(cancelledNotificationsResult.error, 'cancel-event notification log');

    const cancelledNotifications = cancelledNotificationsResult.data ?? [];

    if (
      !cancelledNotifications.some(
        (row) => row.user_id === playerB.userId && row.type === 'event_cancelled',
      ) ||
      !cancelledNotifications.some(
        (row) => row.user_id === playerC.userId && row.type === 'event_cancelled',
      )
    ) {
      throw new Error(
        `Expected cancel-event to notify confirmed and waitlisted players. Received ${JSON.stringify(cancelledNotifications)}.`,
      );
    }

    const editCancelledResponse = await callEventRoute(
      organizer.accessToken,
      `/${cancelledEvent.id}`,
      {
        method: 'PATCH',
        body: {
          description: 'This edit should fail',
        },
      },
    );
    expectError(editCancelledResponse, 409, 'EVENT_NOT_EDITABLE', 'edit cancelled event');

    console.log(
      'Verified organizer cancel updates detail/feed/my-games correctly and notifies confirmed plus waitlisted players.',
    );
    console.log('Milestone 6 verification passed.');
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
