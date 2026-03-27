import { randomUUID } from 'node:crypto';

import { createClient, FunctionsHttpError } from '@supabase/supabase-js';

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

async function createConfirmedUser(label) {
  const email = `milestone4-${label}-${randomUUID()}@gmail.com`;
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

async function callCreateEvent(client, accessToken, body) {
  const result = await client.functions.invoke('events', {
    body,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (result.error) {
    if (result.error instanceof FunctionsHttpError) {
      const parsed = await result.error.context.json();
      return {
        status: result.error.context.status,
        body: parsed,
      };
    }

    throw new Error(
      `Edge Function invoke failed before the server responded: ${result.error.message}`,
    );
  }

  return {
    status: 201,
    body: result.data,
  };
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
  console.log('Verifying Milestone 4 venue, event creation, feed, and sharing foundation...');

  const cleanup = {
    userIds: [],
    venueIds: [],
    eventIds: [],
  };

  try {
    const sportsResult = await serviceClient
      .from('sports')
      .select('id, slug')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .limit(1)
      .single();

    assertNoError(sportsResult.error, 'load active sport');

    if (!sportsResult.data) {
      throw new Error('Expected at least one active sport in the seed data.');
    }

    const sportId = sportsResult.data.id;

    const primaryUser = await createConfirmedUser('primary');
    cleanup.userIds.push(primaryUser.userId);

    const secondaryUser = await createConfirmedUser('secondary');
    cleanup.userIds.push(secondaryUser.userId);

    const profileUpdateResult = await serviceClient
      .from('profiles')
      .update({
        first_name: 'Milestone',
        last_name: 'Creator',
        city: 'Ostrava',
        language: 'en',
      })
      .eq('id', primaryUser.userId);

    assertNoError(profileUpdateResult.error, 'prepare primary profile');

    const uniqueVenueStem = `Milestone 4 Venue ${randomUUID().slice(0, 8)}`;
    const venueName = `${uniqueVenueStem} Ostrava`;
    const shadowVenueName = `${uniqueVenueStem} Brno`;

    const venueInsertResult = await primaryUser.client
      .from('venues')
      .insert({
        name: venueName,
        city: 'Ostrava',
        address: 'Verifier Street 1',
        created_by: primaryUser.userId,
      })
      .select('id, name, city, address')
      .single();

    assertNoError(venueInsertResult.error, 'authenticated venue insert');

    if (!venueInsertResult.data) {
      throw new Error('Expected the authenticated venue insert to return the new row.');
    }

    cleanup.venueIds.push(venueInsertResult.data.id);

    const shadowVenueInsertResult = await serviceClient
      .from('venues')
      .insert({
        name: shadowVenueName,
        city: 'Brno',
        address: 'Shadow Street 9',
      })
      .select('id')
      .single();

    assertNoError(shadowVenueInsertResult.error, 'shadow venue insert');

    if (!shadowVenueInsertResult.data) {
      throw new Error('Expected the shadow venue insert to return the new row.');
    }

    cleanup.venueIds.push(shadowVenueInsertResult.data.id);

    const mismatchedVenueInsertResult = await primaryUser.client.from('venues').insert({
      name: `${uniqueVenueStem} Spoofed`,
      city: 'Ostrava',
      address: 'Verifier Street 2',
      created_by: secondaryUser.userId,
    });

    if (!mismatchedVenueInsertResult.error) {
      throw new Error(
        'Expected venue insert to reject a created_by value that does not match the authenticated user.',
      );
    }

    console.log('Verified venue insert provenance rejects mismatched created_by values.');

    const venueSearchResult = await primaryUser.client
      .from('venues')
      .select('id, name, city')
      .eq('city', 'Ostrava')
      .ilike('name', `%${uniqueVenueStem}%`)
      .order('name', { ascending: true });

    assertNoError(venueSearchResult.error, 'venue search by city');

    const venueMatches = venueSearchResult.data ?? [];

    if (
      venueMatches.length !== 1 ||
      venueMatches[0]?.id !== venueInsertResult.data.id ||
      venueMatches[0]?.city !== 'Ostrava'
    ) {
      throw new Error('Expected venue search to return only the matching venue in the user city.');
    }

    console.log(
      'Verified city-filtered venue search returns only matching venues in the active city.',
    );

    const baseEventPayload = {
      sport_id: sportId,
      venue_id: venueInsertResult.data.id,
      reservation_type: 'reserved',
      player_count_total: 4,
      skill_min: 2,
      skill_max: 3,
      description: 'Milestone 4 verification event',
    };

    const missingSkillResponse = await callCreateEvent(
      primaryUser.client,
      primaryUser.accessToken,
      {
        ...baseEventPayload,
        starts_at: createFutureIso(1, 18, 0),
        ends_at: createFutureIso(1, 19, 30),
      },
    );

    if (
      missingSkillResponse.status !== 409 ||
      missingSkillResponse.body?.error?.code !== 'SKILL_LEVEL_REQUIRED'
    ) {
      throw new Error(
        `Expected create-event to return SKILL_LEVEL_REQUIRED before a user_sports row exists. Received status ${missingSkillResponse.status} with body ${JSON.stringify(missingSkillResponse.body)}.`,
      );
    }

    console.log('Verified SKILL_LEVEL_REQUIRED is returned before the user has a sport profile.');

    const userSportUpsertResult = await primaryUser.client
      .from('user_sports')
      .upsert(
        {
          user_id: primaryUser.userId,
          sport_id: sportId,
          skill_level: 2,
        },
        {
          onConflict: 'user_id,sport_id',
        },
      )
      .select('id')
      .single();

    assertNoError(userSportUpsertResult.error, 'own user_sports insert');

    const createdEvents = [];

    for (let index = 0; index < 25; index += 1) {
      const startsAt = createFutureIso(1 + Math.floor(index / 8), 8 + (index % 8), 0);
      const endsAt = createFutureIso(1 + Math.floor(index / 8), 9 + (index % 8), 30);
      const createResponse = await callCreateEvent(primaryUser.client, primaryUser.accessToken, {
        ...baseEventPayload,
        description: `Milestone 4 verification event #${index + 1}`,
        starts_at: startsAt,
        ends_at: endsAt,
      });

      if (createResponse.status !== 201 || !createResponse.body?.data?.id) {
        throw new Error(
          `Expected create-event to succeed after setting the sport profile (event ${index + 1}).`,
        );
      }

      cleanup.eventIds.push(createResponse.body.data.id);
      createdEvents.push(createResponse.body.data);
    }

    const firstCreatedEvent = createdEvents[0];

    if (
      firstCreatedEvent.venue_id !== venueInsertResult.data.id ||
      firstCreatedEvent.city !== 'Ostrava'
    ) {
      throw new Error(
        'Expected the created event to denormalize the venue city and keep the chosen venue.',
      );
    }

    console.log(
      'Verified the Edge Function creates events with venue_id and city denormalized from the venue.',
    );

    const feedPageOneResult = await primaryUser.client
      .from('event_feed_view')
      .select(
        'id, venue_id, venue_name, venue_address, city, starts_at, reservation_type, spots_taken, waitlist_count',
      )
      .eq('city', 'Ostrava')
      .eq('venue_id', venueInsertResult.data.id)
      .gte('starts_at', createFutureIso(1, 0, 0))
      .lte('starts_at', createFutureIso(5, 23, 59))
      .order('starts_at', { ascending: true })
      .order('created_at', { ascending: true })
      .range(0, 19);

    assertNoError(feedPageOneResult.error, 'event feed page one');

    const feedPageTwoResult = await primaryUser.client
      .from('event_feed_view')
      .select(
        'id, venue_id, venue_name, venue_address, city, starts_at, reservation_type, spots_taken, waitlist_count',
      )
      .eq('city', 'Ostrava')
      .eq('venue_id', venueInsertResult.data.id)
      .gte('starts_at', createFutureIso(1, 0, 0))
      .lte('starts_at', createFutureIso(5, 23, 59))
      .order('starts_at', { ascending: true })
      .order('created_at', { ascending: true })
      .range(20, 39);

    assertNoError(feedPageTwoResult.error, 'event feed page two');

    const firstPageRows = feedPageOneResult.data ?? [];
    const secondPageRows = feedPageTwoResult.data ?? [];

    if (firstPageRows.length !== 20 || secondPageRows.length !== 5) {
      throw new Error(
        'Expected event_feed_view pagination to return 20 rows on page one and the remaining 5 on page two.',
      );
    }

    if (!firstPageRows.concat(secondPageRows).some((row) => row.id === firstCreatedEvent.id)) {
      throw new Error('Expected the created event to appear in the feed view.');
    }

    console.log('Verified event_feed_view pagination and feed visibility for the created events.');

    const markEventFinishedResult = await serviceClient
      .from('events')
      .update({
        status: 'finished',
        no_show_window_end: createFutureIso(2, 0, 0),
        chat_closed_at: createFutureIso(3, 0, 0),
      })
      .eq('id', firstCreatedEvent.id)
      .select('id, status')
      .single();

    assertNoError(markEventFinishedResult.error, 'mark event finished for detail verification');

    const finishedEventFeedResult = await primaryUser.client
      .from('event_feed_view')
      .select('id')
      .eq('id', firstCreatedEvent.id);

    assertNoError(finishedEventFeedResult.error, 'finished event feed visibility');

    if ((finishedEventFeedResult.data ?? []).length !== 0) {
      throw new Error('Expected a finished event to drop out of event_feed_view.');
    }

    const eventDetailResult = await primaryUser.client
      .from('event_detail_view')
      .select(
        'id, venue_name, venue_address, city, reservation_type, spots_taken, waitlist_count, player_count_total, skill_min, skill_max, status',
      )
      .eq('id', firstCreatedEvent.id)
      .single();

    assertNoError(eventDetailResult.error, 'event detail view query');

    if (
      !eventDetailResult.data ||
      eventDetailResult.data.venue_name !== venueName ||
      eventDetailResult.data.venue_address !== 'Verifier Street 1' ||
      eventDetailResult.data.city !== 'Ostrava' ||
      eventDetailResult.data.status !== 'finished' ||
      eventDetailResult.data.spots_taken !== 1 ||
      eventDetailResult.data.waitlist_count !== 0
    ) {
      throw new Error(
        'Expected event detail data to stay readable after the event leaves the feed and still expose the venue info and organizer-confirmed spot count.',
      );
    }

    const confirmedPlayersResult = await primaryUser.client
      .from('event_players')
      .select('user_id, status')
      .eq('event_id', firstCreatedEvent.id)
      .eq('status', 'confirmed');

    assertNoError(confirmedPlayersResult.error, 'confirmed players query');

    const confirmedPlayers = confirmedPlayersResult.data ?? [];

    if (confirmedPlayers.length !== 1 || confirmedPlayers[0]?.user_id !== primaryUser.userId) {
      throw new Error(
        'Expected the organizer to be inserted as the only confirmed player on event creation.',
      );
    }

    console.log(
      'Verified read-only event detail data survives non-feed states and confirmed-player insertion for the organizer.',
    );
    console.log('Milestone 4 verification passed.');
  } finally {
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
