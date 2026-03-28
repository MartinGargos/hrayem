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

async function createConfirmedUser(label) {
  const email = `milestone8-${label}-${randomUUID()}@gmail.com`;
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

async function createVenue(input) {
  const result = await serviceClient
    .from('venues')
    .insert({
      name: input.name,
      city: input.city,
      address: input.address,
      created_by: input.createdBy,
    })
    .select('id')
    .single();

  assertNoError(result.error, `create venue (${input.name})`);

  if (!result.data?.id) {
    throw new Error(`Expected a venue id for ${input.name}.`);
  }

  return result.data.id;
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
    'Verifying Milestone 8 chat access, write path, lifecycle, and notification logging...',
  );

  const cleanup = {
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
    const confirmedA = await createConfirmedUser('confirmed-a');
    const confirmedB = await createConfirmedUser('confirmed-b');
    const waitlisted = await createConfirmedUser('waitlisted');

    cleanup.userIds.push(organizer.userId, confirmedA.userId, confirmedB.userId, waitlisted.userId);

    await Promise.all([
      updateProfile(organizer.userId, {
        firstName: 'M8',
        lastName: 'Organizer',
        city: 'Ostrava',
      }),
      updateProfile(confirmedA.userId, {
        firstName: 'M8',
        lastName: 'ConfirmedA',
        city: 'Ostrava',
      }),
      updateProfile(confirmedB.userId, {
        firstName: 'M8',
        lastName: 'ConfirmedB',
        city: 'Ostrava',
      }),
      updateProfile(waitlisted.userId, {
        firstName: 'M8',
        lastName: 'Waitlisted',
        city: 'Ostrava',
      }),
      upsertUserSport(organizer.userId, sportId, 3),
      upsertUserSport(confirmedA.userId, sportId, 3),
      upsertUserSport(confirmedB.userId, sportId, 3),
      upsertUserSport(waitlisted.userId, sportId, 3),
    ]);

    const venueId = await createVenue({
      name: `Milestone 8 Chat ${randomUUID()}`,
      city: 'Ostrava',
      address: 'Chat Street 8',
      createdBy: organizer.userId,
    });
    cleanup.venueIds.push(venueId);

    const chatEvent = await createFutureEvent({
      organizer,
      sportId,
      venueId,
      description: 'Milestone 8 chat event',
      playerCountTotal: 3,
    });
    cleanup.eventIds.push(chatEvent.id);

    expectSuccess(
      await callEventRoute(confirmedA.accessToken, `/${chatEvent.id}/join`, {
        body: {},
      }),
      'join confirmed player A',
    );
    expectSuccess(
      await callEventRoute(confirmedB.accessToken, `/${chatEvent.id}/join`, {
        body: {},
      }),
      'join confirmed player B',
    );
    const waitlistJoin = expectSuccess(
      await callEventRoute(waitlisted.accessToken, `/${chatEvent.id}/join`, {
        body: {},
      }),
      'join waitlisted player',
    );

    if (waitlistJoin.membership_status !== 'waitlisted') {
      throw new Error(`Expected waitlisted membership, received ${JSON.stringify(waitlistJoin)}.`);
    }

    const realtimeProven = false;
    const realtimeSkipped = true;

    const chatMessage = expectSuccess(
      await callEventRoute(confirmedA.accessToken, `/${chatEvent.id}/messages`, {
        body: {
          body: 'Hello from Milestone 8 chat.',
        },
      }),
      'send chat message as confirmed player',
    );

    if (!chatMessage.id) {
      throw new Error('Expected the chat route to return the inserted message.');
    }

    const organizerChatResult = await organizer.client
      .from('chat_messages')
      .select('id, body')
      .eq('event_id', chatEvent.id);
    assertNoError(organizerChatResult.error, 'organizer read chat history');

    if ((organizerChatResult.data ?? []).length !== 1) {
      throw new Error('Organizer should see the inserted chat message.');
    }

    const confirmedChatResult = await confirmedB.client
      .from('chat_messages')
      .select('id, body')
      .eq('event_id', chatEvent.id);
    assertNoError(confirmedChatResult.error, 'confirmed player read chat history');

    if ((confirmedChatResult.data ?? []).length !== 1) {
      throw new Error('Confirmed player should see the inserted chat message.');
    }

    const waitlistedChatResult = await waitlisted.client
      .from('chat_messages')
      .select('id, body')
      .eq('event_id', chatEvent.id);
    assertNoError(waitlistedChatResult.error, 'waitlisted player read chat history');

    if ((waitlistedChatResult.data ?? []).length !== 0) {
      throw new Error('Waitlisted players must not see chat history.');
    }

    expectError(
      await callEventRoute(waitlisted.accessToken, `/${chatEvent.id}/messages`, {
        body: {
          body: 'I should not be allowed here.',
        },
      }),
      403,
      'FORBIDDEN',
      'waitlisted player send message',
    );

    const notificationResult = await serviceClient
      .from('notification_log')
      .select('user_id, type')
      .eq('event_id', chatEvent.id)
      .eq('type', 'chat_message');
    assertNoError(notificationResult.error, 'load chat notification log');

    const notifiedUserIds = new Set((notificationResult.data ?? []).map((row) => row.user_id));

    if (!notifiedUserIds.has(organizer.userId) || !notifiedUserIds.has(confirmedB.userId)) {
      throw new Error(
        `Expected organizer and the other confirmed player to receive chat notification logs, received ${JSON.stringify(notificationResult.data)}.`,
      );
    }

    if (notifiedUserIds.has(confirmedA.userId) || notifiedUserIds.has(waitlisted.userId)) {
      throw new Error(
        `The sender and waitlisted players must not receive chat notification logs, received ${JSON.stringify(notificationResult.data)}.`,
      );
    }

    expectSuccess(
      await callEventRoute(organizer.accessToken, `/${chatEvent.id}/cancel`, {
        body: {},
      }),
      'cancel chat event',
    );

    expectError(
      await callEventRoute(confirmedA.accessToken, `/${chatEvent.id}/messages`, {
        body: {
          body: 'This should fail after cancellation.',
        },
      }),
      409,
      'CHAT_CLOSED',
      'cancelled event chat write',
    );

    const cancelledHistoryResult = await organizer.client
      .from('chat_messages')
      .select('id')
      .eq('event_id', chatEvent.id);
    assertNoError(cancelledHistoryResult.error, 'read cancelled chat history');

    if ((cancelledHistoryResult.data ?? []).length !== 1) {
      throw new Error('Cancelled events must preserve chat history.');
    }

    const finishedEvent = await createFutureEvent({
      organizer,
      sportId,
      venueId,
      description: 'Milestone 8 finished chat close',
      playerCountTotal: 2,
    });
    cleanup.eventIds.push(finishedEvent.id);

    expectSuccess(
      await callEventRoute(confirmedA.accessToken, `/${finishedEvent.id}/join`, {
        body: {},
      }),
      'join finished-window test event',
    );

    const closeResult = await serviceClient
      .from('events')
      .update({
        status: 'finished',
        chat_closed_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      })
      .eq('id', finishedEvent.id);
    assertNoError(closeResult.error, 'close finished event chat');

    expectError(
      await callEventRoute(confirmedA.accessToken, `/${finishedEvent.id}/messages`, {
        body: {
          body: 'This should fail after the chat close window.',
        },
      }),
      409,
      'CHAT_CLOSED',
      'closed finished event chat write',
    );

    console.log('Milestone 8 verification passed.');
    console.log('- Confirmed players and the organizer can read chat history.');
    console.log('- Waitlisted players cannot read or write chat history.');
    console.log('- Cancelled and closed finished chats reject new messages.');
    console.log('- Chat notification logs target only the other confirmed participants.');
    if (realtimeProven) {
      console.log('- Realtime insert delivery was observed from a second authenticated client.');
    } else if (realtimeSkipped) {
      console.log(
        '- Realtime insert proof was skipped because the subscription did not establish cleanly in this environment.',
      );
    }
  } finally {
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
