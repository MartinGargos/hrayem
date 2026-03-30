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

function isoDateDaysFromNow(daysFromNow) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

function hasUpstashConfig() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

async function createConfirmedUser(label, city = 'Ostrava') {
  const email = `milestone9-${label}-${randomUUID()}@gmail.com`;
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
    firstName: 'M9',
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
    .select('id')
    .single();

  assertNoError(result.error, `create venue ${input.name}`);

  if (!result.data?.id) {
    throw new Error(`Expected a venue id for ${input.name}.`);
  }

  return result.data.id;
}

async function createDeviceToken(userId, platform = 'ios') {
  const result = await serviceClient
    .from('device_tokens')
    .insert({
      user_id: userId,
      token: `ExponentPushToken[${randomUUID()}]`,
      platform,
    })
    .select('id')
    .single();

  assertNoError(result.error, `create device token for ${userId}`);

  if (!result.data?.id) {
    throw new Error(`Expected a device token id for ${userId}.`);
  }

  return result.data.id;
}

async function claimDeviceToken(client, token, ownershipKey, platform = 'ios') {
  return client.rpc('claim_device_token', {
    push_ownership_key: ownershipKey,
    push_platform: platform,
    push_token: token,
  });
}

async function deleteDeviceToken(client, token, ownershipKey) {
  return client.rpc('delete_device_token', {
    push_ownership_key: ownershipKey,
    push_token: token,
  });
}

async function loadDeviceTokenRow(token) {
  const result = await serviceClient
    .from('device_tokens')
    .select('id, user_id, ownership_key')
    .eq('token', token)
    .maybeSingle();

  assertNoError(result.error, `load device token row for ${token}`);
  return result.data;
}

function expectRpcFailure(result, expectedMessage, label) {
  if (!result.error || !result.error.message.includes(expectedMessage)) {
    throw new Error(
      `${label} expected RPC failure containing "${expectedMessage}", received ${JSON.stringify(result)}.`,
    );
  }
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

async function createFutureEvent({
  organizer,
  sportId,
  venueId,
  description,
  playerCountTotal = 3,
}) {
  const response = await callEventRoute(organizer.accessToken, '', {
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

  return expectSuccess(response, `create event (${description})`);
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

async function loadNotificationRows(eventId, type) {
  const result = await serviceClient
    .from('notification_log')
    .select('user_id, type, status, payload')
    .eq('event_id', eventId)
    .eq('type', type);

  assertNoError(result.error, `load notification log (${type})`);
  return result.data ?? [];
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
  console.log(
    'Verifying Milestone 9 notifications, notification preferences, rate limiting, and availability...',
  );

  const cleanup = {
    availabilityIds: [],
    deviceTokenIds: [],
    eventIds: [],
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
      throw new Error('Expected at least one active sport.');
    }

    const sportId = sportResult.data.id;
    const organizer = await createConfirmedUser('organizer');
    const playerA = await createConfirmedUser('player-a');
    const playerB = await createConfirmedUser('player-b');
    const playerC = await createConfirmedUser('player-c');
    const viewer = await createConfirmedUser('viewer');
    const outsider = await createConfirmedUser('outsider', 'Brno');
    const firstTimer = await createConfirmedUser('first-timer');

    cleanup.userIds.push(
      organizer.userId,
      playerA.userId,
      playerB.userId,
      playerC.userId,
      viewer.userId,
      outsider.userId,
      firstTimer.userId,
    );

    await Promise.all([
      upsertUserSport(organizer.userId, sportId, 3),
      upsertUserSport(playerA.userId, sportId, 3),
      upsertUserSport(playerB.userId, sportId, 3),
      upsertUserSport(playerC.userId, sportId, 3),
      upsertUserSport(viewer.userId, sportId, 3),
      upsertUserSport(outsider.userId, sportId, 3),
    ]);

    const venueId = await createVenue(organizer.client, {
      name: `Milestone 9 Venue ${randomUUID().slice(0, 8)}`,
      city: 'Ostrava',
      address: 'Verifier Street 9',
      createdBy: organizer.userId,
    });
    cleanup.venueIds.push(venueId);

    const sharedInstallToken = `ExponentPushToken[${randomUUID()}]`;
    const sharedInstallOwnershipKey = randomUUID();
    const attackerOwnershipKey = randomUUID();

    assertNoError(
      (await claimDeviceToken(organizer.client, sharedInstallToken, sharedInstallOwnershipKey))
        .error,
      'claim shared-install token as organizer',
    );

    let sharedInstallRow = await loadDeviceTokenRow(sharedInstallToken);

    if (sharedInstallRow?.user_id !== organizer.userId) {
      throw new Error('Expected the organizer to own the newly claimed shared-install token.');
    }

    assertNoError(
      (await claimDeviceToken(playerB.client, sharedInstallToken, sharedInstallOwnershipKey)).error,
      'move shared-install token to player B',
    );

    sharedInstallRow = await loadDeviceTokenRow(sharedInstallToken);

    if (sharedInstallRow?.user_id !== playerB.userId) {
      throw new Error(
        'Expected the same-install claim to move token ownership cleanly to player B.',
      );
    }

    expectRpcFailure(
      await claimDeviceToken(playerA.client, sharedInstallToken, attackerOwnershipKey),
      'another device installation',
      'claim device token from another install',
    );

    sharedInstallRow = await loadDeviceTokenRow(sharedInstallToken);

    if (sharedInstallRow?.user_id !== playerB.userId) {
      throw new Error(
        'Expected a failed cross-install claim to leave the shared-install token with player B.',
      );
    }

    expectRpcFailure(
      await deleteDeviceToken(playerA.client, sharedInstallToken, attackerOwnershipKey),
      'another device installation',
      'delete device token from another install',
    );

    sharedInstallRow = await loadDeviceTokenRow(sharedInstallToken);

    if (!sharedInstallRow) {
      throw new Error('Expected the shared-install token row to survive a failed delete attempt.');
    }

    assertNoError(
      (await deleteDeviceToken(playerB.client, sharedInstallToken, sharedInstallOwnershipKey))
        .error,
      'delete shared-install token as current owner',
    );

    if (await loadDeviceTokenRow(sharedInstallToken)) {
      throw new Error('Expected the shared-install token row to be deleted by the current owner.');
    }

    const organizerPreferenceResult = await organizer.client
      .from('notification_preferences')
      .upsert(
        {
          user_id: organizer.userId,
          type: 'player_joined',
          is_enabled: false,
        },
        {
          onConflict: 'user_id,type',
        },
      )
      .select('type, is_enabled')
      .single();

    assertNoError(organizerPreferenceResult.error, 'persist organizer notification preference');

    if (organizerPreferenceResult.data?.is_enabled !== false) {
      throw new Error('Expected the organizer notification preference to persist as disabled.');
    }

    const joinNotificationEvent = await createFutureEvent({
      organizer,
      sportId,
      venueId,
      description: 'Milestone 9 join notifications',
      playerCountTotal: 2,
    });
    cleanup.eventIds.push(joinNotificationEvent.id);

    const joinResult = expectSuccess(
      await callEventRoute(playerA.accessToken, `/${joinNotificationEvent.id}/join`, {
        body: {},
      }),
      'join notification event',
    );

    if (joinResult.membership_status !== 'confirmed') {
      throw new Error(`Expected confirmed join result, received ${JSON.stringify(joinResult)}.`);
    }

    const joinConfirmedRows = await loadNotificationRows(
      joinNotificationEvent.id,
      'join_confirmed',
    );
    expectNotificationRecipients(
      joinConfirmedRows,
      [playerA.userId],
      [organizer.userId],
      'join_confirmed notification',
    );

    const eventFullRows = await loadNotificationRows(joinNotificationEvent.id, 'event_full');
    expectNotificationRecipients(
      eventFullRows,
      [organizer.userId],
      [playerA.userId],
      'event_full notification',
    );

    const playerJoinedRows = await loadNotificationRows(joinNotificationEvent.id, 'player_joined');

    if (playerJoinedRows.length !== 0) {
      throw new Error(
        `Expected player_joined notifications to respect disabled preferences, received ${JSON.stringify(playerJoinedRows)}.`,
      );
    }

    if (
      !joinConfirmedRows[0]?.payload?.url ||
      !String(joinConfirmedRows[0].payload.url).includes(`/event/${joinNotificationEvent.id}`)
    ) {
      throw new Error('Expected join_confirmed notification log payload to contain the event URL.');
    }

    const removePlayerEvent = await createFutureEvent({
      organizer,
      sportId,
      venueId,
      description: 'Milestone 9 waitlist promotion',
      playerCountTotal: 2,
    });
    cleanup.eventIds.push(removePlayerEvent.id);

    expectSuccess(
      await callEventRoute(playerA.accessToken, `/${removePlayerEvent.id}/join`, {
        body: {},
      }),
      'join remove-player event as confirmed',
    );
    const waitlistJoin = expectSuccess(
      await callEventRoute(playerB.accessToken, `/${removePlayerEvent.id}/join`, {
        body: {},
      }),
      'join remove-player event as waitlisted',
    );

    if (waitlistJoin.membership_status !== 'waitlisted') {
      throw new Error(`Expected waitlisted join result, received ${JSON.stringify(waitlistJoin)}.`);
    }

    const removePlayerResult = expectSuccess(
      await callEventRoute(organizer.accessToken, `/${removePlayerEvent.id}/remove-player`, {
        body: {
          target_user_id: playerA.userId,
        },
      }),
      'remove confirmed player',
    );

    if (removePlayerResult.promoted_user_id !== playerB.userId) {
      throw new Error(
        `Expected waitlist promotion for ${playerB.userId}, received ${JSON.stringify(removePlayerResult)}.`,
      );
    }

    expectNotificationRecipients(
      await loadNotificationRows(removePlayerEvent.id, 'waitlist_promoted'),
      [playerB.userId],
      [playerA.userId],
      'waitlist_promoted notification',
    );
    expectNotificationRecipients(
      await loadNotificationRows(removePlayerEvent.id, 'player_removed'),
      [playerA.userId],
      [playerB.userId],
      'player_removed notification',
    );

    const cancelEvent = await createFutureEvent({
      organizer,
      sportId,
      venueId,
      description: 'Milestone 9 cancelled event',
      playerCountTotal: 2,
    });
    cleanup.eventIds.push(cancelEvent.id);

    expectSuccess(
      await callEventRoute(playerA.accessToken, `/${cancelEvent.id}/join`, {
        body: {},
      }),
      'join cancel event as confirmed',
    );
    expectSuccess(
      await callEventRoute(playerB.accessToken, `/${cancelEvent.id}/join`, {
        body: {},
      }),
      'join cancel event as waitlisted',
    );
    expectSuccess(
      await callEventRoute(organizer.accessToken, `/${cancelEvent.id}/cancel`, {
        body: {},
      }),
      'cancel event',
    );

    expectNotificationRecipients(
      await loadNotificationRows(cancelEvent.id, 'event_cancelled'),
      [playerA.userId, playerB.userId],
      [organizer.userId],
      'event_cancelled notification',
    );

    const chatEvent = await createFutureEvent({
      organizer,
      sportId,
      venueId,
      description: 'Milestone 9 chat notifications',
      playerCountTotal: 3,
    });
    cleanup.eventIds.push(chatEvent.id);

    expectSuccess(
      await callEventRoute(playerA.accessToken, `/${chatEvent.id}/join`, {
        body: {},
      }),
      'join chat event as player A',
    );
    expectSuccess(
      await callEventRoute(playerB.accessToken, `/${chatEvent.id}/join`, {
        body: {},
      }),
      'join chat event as player B',
    );

    const chatPreferenceResult = await playerB.client.from('notification_preferences').upsert(
      {
        user_id: playerB.userId,
        type: 'chat_message',
        is_enabled: false,
      },
      {
        onConflict: 'user_id,type',
      },
    );
    assertNoError(chatPreferenceResult.error, 'disable chat_message preference');

    expectSuccess(
      await callEventRoute(playerA.accessToken, `/${chatEvent.id}/messages`, {
        body: {
          body: 'Milestone 9 chat notification message',
        },
      }),
      'send chat message',
    );

    expectNotificationRecipients(
      await loadNotificationRows(chatEvent.id, 'chat_message'),
      [organizer.userId],
      [playerA.userId, playerB.userId],
      'chat_message notification',
    );

    const reminderEvent = await createFutureEvent({
      organizer,
      sportId,
      venueId,
      description: 'Milestone 9 reminder event',
      playerCountTotal: 3,
    });
    cleanup.eventIds.push(reminderEvent.id);

    expectSuccess(
      await callEventRoute(playerA.accessToken, `/${reminderEvent.id}/join`, {
        body: {},
      }),
      'join reminder event',
    );
    const reminderPreferenceResult = await organizer.client.from('notification_preferences').upsert(
      {
        user_id: organizer.userId,
        type: 'event_reminder',
        is_enabled: false,
      },
      {
        onConflict: 'user_id,type',
      },
    );
    assertNoError(reminderPreferenceResult.error, 'disable organizer event_reminder preference');

    cleanup.deviceTokenIds.push(await createDeviceToken(organizer.userId));
    cleanup.deviceTokenIds.push(await createDeviceToken(playerA.userId));
    await setEventTimes(reminderEvent.id, relativeIso(2), relativeIso(3));

    const reminderSweepResult = await serviceClient.rpc('finish_event_sweep');
    assertNoError(reminderSweepResult.error, 'run reminder sweep');

    const reminderRows = await waitForNotificationRows(
      reminderEvent.id,
      'event_reminder',
      1,
      60_000,
    );
    expectNotificationRecipients(
      reminderRows,
      [playerA.userId],
      [organizer.userId],
      'event_reminder log',
    );

    if (!reminderRows.every((row) => row.status === 'sent' || row.status === 'failed')) {
      throw new Error(
        `Expected event_reminder logs to store real delivery outcomes, received ${JSON.stringify(reminderRows)}.`,
      );
    }

    if (
      !reminderRows[0]?.payload?.url ||
      !String(reminderRows[0].payload.url).includes(`/event/${reminderEvent.id}`)
    ) {
      throw new Error('Expected event_reminder notification log payload to contain the event URL.');
    }

    const reminderEventRow = await serviceClient
      .from('events')
      .select('reminder_sent')
      .eq('id', reminderEvent.id)
      .single();
    assertNoError(reminderEventRow.error, 'load reminder event state');

    if (reminderEventRow.data?.reminder_sent !== true) {
      throw new Error('Expected reminder_sent to be true after the reminder sweep.');
    }

    const rateLimitProven = hasUpstashConfig();

    if (rateLimitProven) {
      const rateLimitedEvent = await createFutureEvent({
        organizer,
        sportId,
        venueId,
        description: 'Milestone 9 rate limit event',
        playerCountTotal: 4,
      });
      cleanup.eventIds.push(rateLimitedEvent.id);

      for (let attempt = 0; attempt < 10; attempt += 1) {
        expectSuccess(
          await callEventRoute(organizer.accessToken, `/${rateLimitedEvent.id}`, {
            method: 'PATCH',
            body: {
              description: `Edit rate limit attempt ${attempt}`,
            },
          }),
          `edit event rate-limit warmup ${attempt}`,
        );
      }

      const rateLimitedResponse = await callEventRoute(
        organizer.accessToken,
        `/${rateLimitedEvent.id}`,
        {
          method: 'PATCH',
          body: {
            description: 'Edit rate limit should fail now',
          },
        },
      );
      expectError(rateLimitedResponse, 429, 'RATE_LIMITED', 'edit event rate limit');

      if (!rateLimitedResponse.headers.get('Retry-After')) {
        throw new Error('Expected RATE_LIMITED responses to include Retry-After.');
      }
    }

    const playAgainEvent = await createFutureEvent({
      organizer: viewer,
      sportId,
      venueId,
      description: 'Milestone 9 play again event',
      playerCountTotal: 2,
    });
    cleanup.eventIds.push(playAgainEvent.id);

    expectSuccess(
      await callEventRoute(playerA.accessToken, `/${playAgainEvent.id}/join`, {
        body: {},
      }),
      'join play-again event',
    );

    await setEventTimes(playAgainEvent.id, isoHoursAgo(2), isoHoursAgo(1));
    const finishSweepResult = await serviceClient.rpc('finish_event_sweep');
    assertNoError(finishSweepResult.error, 'run finish sweep for play-again event');

    expectSuccess(
      await callEventRoute(viewer.accessToken, `/${playAgainEvent.id}/thumbs-up`, {
        body: {
          to_user_id: playerA.userId,
        },
      }),
      'viewer gives thumbs up',
    );
    expectSuccess(
      await callEventRoute(playerA.accessToken, `/${playAgainEvent.id}/thumbs-up`, {
        body: {
          to_user_id: viewer.userId,
        },
      }),
      'player A gives thumbs up',
    );

    const firstAvailabilityDate = isoDateDaysFromNow(1);
    const secondAvailabilityDate = isoDateDaysFromNow(2);
    const thirdAvailabilityDate = isoDateDaysFromNow(3);
    const fourthAvailabilityDate = isoDateDaysFromNow(4);

    await upsertUserSport(firstTimer.userId, sportId, 2);

    const firstTimerAvailabilityResult = await firstTimer.client
      .from('player_availability')
      .insert({
        user_id: firstTimer.userId,
        sport_id: sportId,
        city: 'Ostrava',
        available_date: fourthAvailabilityDate,
        time_pref: 'afternoon',
        note: 'First-time availability with a new skill profile',
      })
      .select('id')
      .single();
    assertNoError(firstTimerAvailabilityResult.error, 'create first-timer availability');

    if (!firstTimerAvailabilityResult.data?.id) {
      throw new Error('Expected an id for the first-timer availability row.');
    }

    cleanup.availabilityIds.push(firstTimerAvailabilityResult.data.id);

    const initialAvailabilityResult = await playerA.client
      .from('player_availability')
      .upsert(
        [
          {
            user_id: playerA.userId,
            sport_id: sportId,
            city: 'Ostrava',
            available_date: firstAvailabilityDate,
            time_pref: 'evening',
            note: 'Looking for a doubles partner',
          },
          {
            user_id: playerA.userId,
            sport_id: sportId,
            city: 'Ostrava',
            available_date: secondAvailabilityDate,
            time_pref: 'evening',
            note: 'Looking for a doubles partner',
          },
        ],
        {
          onConflict: 'user_id,sport_id,available_date',
        },
      )
      .select('id, available_date, time_pref, note');
    assertNoError(initialAvailabilityResult.error, 'create initial availability');

    cleanup.availabilityIds.push(...(initialAvailabilityResult.data ?? []).map((row) => row.id));

    const updatedAvailabilityResult = await playerA.client
      .from('player_availability')
      .upsert(
        {
          user_id: playerA.userId,
          sport_id: sportId,
          city: 'Ostrava',
          available_date: firstAvailabilityDate,
          time_pref: 'morning',
          note: 'Updated availability note',
        },
        {
          onConflict: 'user_id,sport_id,available_date',
        },
      )
      .select('id, available_date, time_pref, note')
      .single();
    assertNoError(updatedAvailabilityResult.error, 'update availability for same sport/date');

    if (
      updatedAvailabilityResult.data?.time_pref !== 'morning' ||
      updatedAvailabilityResult.data?.note !== 'Updated availability note'
    ) {
      throw new Error('Expected availability upsert to replace the existing sport/date row.');
    }

    const outsiderAvailabilityResult = await outsider.client
      .from('player_availability')
      .insert({
        user_id: outsider.userId,
        sport_id: sportId,
        city: 'Brno',
        available_date: thirdAvailabilityDate,
        time_pref: 'any',
        note: 'Other city should stay hidden',
      })
      .select('id')
      .single();
    assertNoError(outsiderAvailabilityResult.error, 'create outsider availability');

    if (outsiderAvailabilityResult.data?.id) {
      cleanup.availabilityIds.push(outsiderAvailabilityResult.data.id);
    }

    const sameCityAvailabilityResult = await viewer.client
      .from('player_availability')
      .select('id, user_id, city, available_date')
      .eq('city', 'Ostrava')
      .eq('sport_id', sportId)
      .gte('available_date', firstAvailabilityDate)
      .neq('user_id', viewer.userId);
    assertNoError(sameCityAvailabilityResult.error, 'query available players feed rows');

    const visibleUserIds = new Set(
      (sameCityAvailabilityResult.data ?? []).map((row) => row.user_id).filter(Boolean),
    );

    if (!visibleUserIds.has(playerA.userId) || visibleUserIds.has(outsider.userId)) {
      throw new Error(
        `Expected same-city availability filtering to include player A and exclude outsider, received ${JSON.stringify(sameCityAvailabilityResult.data)}.`,
      );
    }

    if (!visibleUserIds.has(firstTimer.userId)) {
      throw new Error(
        'Expected the first-time user availability row to be visible in the same city.',
      );
    }

    const firstTimerStatsResult = await viewer.client
      .from('player_profile_sport_stats_view')
      .select('user_id, sport_id, skill_level')
      .eq('user_id', firstTimer.userId)
      .eq('sport_id', sportId)
      .single();
    assertNoError(firstTimerStatsResult.error, 'load first-timer sport stats');

    if (firstTimerStatsResult.data?.skill_level !== 2) {
      throw new Error(
        `Expected the first-time user to expose the selected skill level, received ${JSON.stringify(firstTimerStatsResult.data)}.`,
      );
    }

    const playAgainStatsResult = await viewer.client
      .from('player_profile_sport_stats_view')
      .select('user_id, sport_id, is_play_again_connection')
      .eq('user_id', playerA.userId)
      .eq('sport_id', sportId)
      .single();
    assertNoError(playAgainStatsResult.error, 'load play-again availability stats');

    if (playAgainStatsResult.data?.is_play_again_connection !== true) {
      throw new Error('Expected the availability feed stats to show a play-again connection.');
    }

    const expiredAvailabilityResult = await viewer.client
      .from('player_availability')
      .insert({
        user_id: viewer.userId,
        sport_id: sportId,
        city: 'Ostrava',
        available_date: isoDateDaysFromNow(-1),
        time_pref: 'any',
        note: 'Expired availability row',
      })
      .select('id')
      .single();
    assertNoError(expiredAvailabilityResult.error, 'create expired availability');

    if (!expiredAvailabilityResult.data?.id) {
      throw new Error('Expected an id for the expired availability row.');
    }

    cleanup.availabilityIds.push(expiredAvailabilityResult.data.id);

    const cleanupSweepResult = await serviceClient.rpc('finish_event_sweep');
    assertNoError(cleanupSweepResult.error, 'run finish sweep for expired availability cleanup');

    const remainingExpiredAvailabilityResult = await serviceClient
      .from('player_availability')
      .select('id')
      .eq('id', expiredAvailabilityResult.data.id)
      .maybeSingle();
    assertNoError(
      remainingExpiredAvailabilityResult.error,
      'load expired availability after cleanup',
    );

    if (remainingExpiredAvailabilityResult.data) {
      throw new Error('Expected expired availability rows to be deleted by finish_event_sweep.');
    }

    const deleteAvailabilityResult = await playerA.client
      .from('player_availability')
      .delete()
      .in('id', cleanup.availabilityIds.filter(Boolean));
    assertNoError(deleteAvailabilityResult.error, 'delete own availability');

    const remainingAvailabilityResult = await playerA.client
      .from('player_availability')
      .select('id')
      .eq('user_id', playerA.userId)
      .eq('sport_id', sportId);
    assertNoError(remainingAvailabilityResult.error, 'load remaining availability rows');

    if ((remainingAvailabilityResult.data ?? []).length !== 0) {
      throw new Error('Expected delete own availability to remove all player A rows.');
    }

    console.log('Milestone 9 verification passed.');
    console.log(
      '- Same-install push token claim/delete still works, while a different authenticated user cannot steal or delete that token by raw value alone.',
    );
    console.log('- Notification preferences persist and suppress matching push/log deliveries.');
    console.log(
      '- Join, promotion, cancel, chat, and reminder notification logging works through the shared notification pipeline.',
    );
    if (rateLimitProven) {
      console.log('- Rate limiting returns HTTP 429 with RATE_LIMITED and Retry-After.');
    } else {
      console.log(
        '- Rate-limit proof was skipped because UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not configured in this environment.',
      );
    }
    console.log(
      '- Availability upsert, same-city feed visibility, expired cleanup, delete, and play-again signal work.',
    );
  } finally {
    for (const deviceTokenId of cleanup.deviceTokenIds) {
      await serviceClient.from('device_tokens').delete().eq('id', deviceTokenId);
    }

    for (const eventId of cleanup.eventIds) {
      await serviceClient.from('events').delete().eq('id', eventId);
    }

    for (const venueId of cleanup.venueIds) {
      await serviceClient.from('venues').delete().eq('id', venueId);
    }

    for (const userId of cleanup.userIds) {
      await serviceClient.auth.admin.deleteUser(userId);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
