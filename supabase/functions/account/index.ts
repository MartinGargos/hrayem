import { createClient } from 'jsr:@supabase/supabase-js@2';

import {
  fanOutPushNotifications,
  type NotificationDelivery,
} from '../_shared/notification-utils.ts';

type ApiErrorCode = 'UNAUTHORIZED' | 'METHOD_NOT_ALLOWED' | 'INTERNAL_ERROR';

type DeleteAccountResponse = {
  cancelled_event_ids: string[];
  removed_from_event_ids: string[];
  deleted_availability_count: number;
  deleted_device_token_count: number;
};

type EventNotificationContext = {
  eventId: string;
  organizerId: string | null;
  sportNameEn: string;
  venueName: string;
};

type LeaveEventResult = {
  event_id: string;
  promoted_user_id: string | null;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
} as const;

class MissingAuthorizationHeaderError extends Error {
  constructor() {
    super('Missing Authorization header.');
    this.name = 'MissingAuthorizationHeaderError';
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function errorResponse(code: ApiErrorCode, message: string, status: number): Response {
  return jsonResponse(
    {
      error: {
        code,
        message,
      },
    },
    status,
  );
}

function createSupabaseClients(request: Request) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    throw new Error('Supabase environment is not configured.');
  }

  const authHeader = request.headers.get('Authorization');

  if (!authHeader) {
    throw new MissingAuthorizationHeaderError();
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return {
    authClient,
    adminClient: createAdminClient(),
  };
}

function createAdminClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Supabase environment is not configured.');
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function requireAuthenticatedUser(request: Request) {
  const { authClient, adminClient } = createSupabaseClients(request);
  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser();

  if (userError || !user) {
    return {
      ok: false as const,
      response: errorResponse('UNAUTHORIZED', 'A valid authenticated user is required.', 401),
    };
  }

  return {
    ok: true as const,
    user,
    adminClient,
  };
}

function buildEventDetailUrl(eventId: string): string {
  return `https://hrayem.cz/event/${eventId}`;
}

async function loadEventNotificationContext(
  adminClient: ReturnType<typeof createAdminClient>,
  eventId: string,
): Promise<EventNotificationContext> {
  const eventResult = await adminClient
    .from('event_detail_view')
    .select('id, organizer_id, sport_name_en, venue_name')
    .eq('id', eventId)
    .single();

  if (eventResult.error || !eventResult.data) {
    throw new Error(eventResult.error?.message ?? 'Unable to load notification event context.');
  }

  return {
    eventId: eventResult.data.id as string,
    organizerId: eventResult.data.organizer_id as string | null,
    sportNameEn: eventResult.data.sport_name_en as string,
    venueName: eventResult.data.venue_name as string,
  };
}

async function sendCancelNotifications(
  adminClient: ReturnType<typeof createAdminClient>,
  input: {
    actorUserId: string;
    eventId: string;
  },
): Promise<void> {
  const eventContext = await loadEventNotificationContext(adminClient, input.eventId);
  const recipientsResult = await adminClient
    .from('event_players')
    .select('user_id')
    .eq('event_id', input.eventId)
    .in('status', ['confirmed', 'waitlisted']);

  if (recipientsResult.error) {
    throw new Error(recipientsResult.error.message);
  }

  const recipientUserIds = [
    ...new Set(
      ((recipientsResult.data ?? []) as Array<{ user_id: string | null }>)
        .map((row) => row.user_id)
        .filter((value): value is string => Boolean(value) && value !== input.actorUserId),
    ),
  ];

  const deliveries: NotificationDelivery[] = recipientUserIds.map((userId) => ({
    userId,
    eventId: input.eventId,
    type: 'event_cancelled',
    title: 'Event cancelled',
    body: `${eventContext.sportNameEn} at ${eventContext.venueName} was cancelled.`,
    url: buildEventDetailUrl(input.eventId),
    data: {
      route: 'event-detail',
    },
  }));

  await fanOutPushNotifications(adminClient, deliveries);
}

async function sendLeaveNotifications(
  adminClient: ReturnType<typeof createAdminClient>,
  input: {
    actorUserId: string;
    targetUserId: string;
    eventId: string;
    promotedUserId: string | null;
  },
): Promise<void> {
  const eventContext = await loadEventNotificationContext(adminClient, input.eventId);
  const deliveries: NotificationDelivery[] = [];

  if (input.promotedUserId) {
    deliveries.push({
      userId: input.promotedUserId,
      eventId: input.eventId,
      type: 'waitlist_promoted',
      title: "You're confirmed now",
      body: `A spot opened for ${eventContext.sportNameEn} at ${eventContext.venueName}.`,
      url: buildEventDetailUrl(input.eventId),
      data: {
        route: 'event-detail',
      },
    });
  }

  if (input.actorUserId !== input.targetUserId) {
    deliveries.push({
      userId: input.targetUserId,
      eventId: input.eventId,
      type: 'player_removed',
      title: 'You were removed from an event',
      body: `You've been removed from ${eventContext.sportNameEn} at ${eventContext.venueName}.`,
      url: buildEventDetailUrl(input.eventId),
      data: {
        route: 'event-detail',
      },
    });
  }

  await fanOutPushNotifications(adminClient, deliveries);
}

async function runBestEffortNotificationTask(
  label: string,
  task: () => Promise<void>,
): Promise<void> {
  try {
    await task();
  } catch (error) {
    console.error(`${label} failed.`, error);
  }
}

async function deleteRowsAndCount(
  adminClient: ReturnType<typeof createAdminClient>,
  table: 'device_tokens' | 'player_availability',
  userId: string,
): Promise<number> {
  const result = await adminClient.from(table).delete().eq('user_id', userId).select('id');

  if (result.error) {
    throw new Error(result.error.message);
  }

  return (result.data ?? []).length;
}

async function deleteAvatarFolder(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<void> {
  const listResult = await adminClient.storage.from('avatars').list(userId, {
    limit: 100,
  });

  if (listResult.error) {
    throw new Error(listResult.error.message);
  }

  const paths = (listResult.data ?? [])
    .map((item) => item.name)
    .filter((name): name is string => Boolean(name))
    .map((name) => `${userId}/${name}`);

  if (!paths.length) {
    return;
  }

  const removeResult = await adminClient.storage.from('avatars').remove(paths);

  if (removeResult.error) {
    throw new Error(removeResult.error.message);
  }
}

async function loadFutureOrganizedEventIds(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
  nowIso: string,
): Promise<string[]> {
  const result = await adminClient
    .from('events')
    .select('id')
    .eq('organizer_id', userId)
    .in('status', ['active', 'full'])
    .gt('starts_at', nowIso);

  if (result.error) {
    throw new Error(result.error.message);
  }

  return ((result.data ?? []) as Array<{ id: string }>).map((row) => row.id);
}

async function loadFutureJoinedEventIds(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
  excludedEventIds: string[],
  nowIso: string,
): Promise<string[]> {
  const membershipResult = await adminClient
    .from('event_players')
    .select('event_id')
    .eq('user_id', userId)
    .in('status', ['confirmed', 'waitlisted']);

  if (membershipResult.error) {
    throw new Error(membershipResult.error.message);
  }

  const candidateEventIds = [
    ...new Set(
      ((membershipResult.data ?? []) as Array<{ event_id: string }>).map((row) => row.event_id),
    ),
  ].filter((eventId) => !excludedEventIds.includes(eventId));

  if (!candidateEventIds.length) {
    return [];
  }

  const eventResult = await adminClient
    .from('events')
    .select('id, organizer_id, status, starts_at')
    .in('id', candidateEventIds);

  if (eventResult.error) {
    throw new Error(eventResult.error.message);
  }

  return (
    (eventResult.data ?? []) as Array<{
      id: string;
      organizer_id: string | null;
      status: string;
      starts_at: string;
    }>
  )
    .filter(
      (row) =>
        row.organizer_id !== userId &&
        (row.status === 'active' || row.status === 'full') &&
        row.starts_at > nowIso,
    )
    .map((row) => row.id);
}

function parseDeleteAccountPath(requestUrl: string): boolean {
  const url = new URL(requestUrl);
  const segments = url.pathname.split('/').filter(Boolean);
  const accountIndex = segments.lastIndexOf('account');
  const tail = accountIndex >= 0 ? segments.slice(accountIndex + 1) : [];

  return tail.length === 1 && tail[0] === 'delete';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
  }

  if (!parseDeleteAccountPath(request.url) || request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Only POST /delete is supported for account.', 405);
  }

  if (!request.headers.get('Authorization')) {
    return errorResponse('UNAUTHORIZED', 'A valid authenticated user is required.', 401);
  }

  let authResult: Awaited<ReturnType<typeof requireAuthenticatedUser>>;

  try {
    authResult = await requireAuthenticatedUser(request);
  } catch (error) {
    if (error instanceof MissingAuthorizationHeaderError) {
      return errorResponse('UNAUTHORIZED', 'A valid authenticated user is required.', 401);
    }

    const message =
      error instanceof Error ? error.message : 'Supabase environment is not configured.';
    return errorResponse('INTERNAL_ERROR', message, 500);
  }

  if (!authResult.ok) {
    return authResult.response;
  }

  const userId = authResult.user.id;
  const nowIso = new Date().toISOString();

  try {
    const deletedDeviceTokenCount = await deleteRowsAndCount(
      authResult.adminClient,
      'device_tokens',
      userId,
    );
    const organizedEventIds = await loadFutureOrganizedEventIds(
      authResult.adminClient,
      userId,
      nowIso,
    );

    for (const eventId of organizedEventIds) {
      const cancelResult = await authResult.adminClient.rpc('cancel_event_atomic', {
        p_event_id: eventId,
        p_actor_user_id: userId,
      });

      if (cancelResult.error) {
        throw new Error(cancelResult.error.message);
      }

      await runBestEffortNotificationTask('Account deletion cancel notifications', async () => {
        await sendCancelNotifications(authResult.adminClient, {
          actorUserId: userId,
          eventId,
        });
      });
    }

    const joinedEventIds = await loadFutureJoinedEventIds(
      authResult.adminClient,
      userId,
      organizedEventIds,
      nowIso,
    );

    for (const eventId of joinedEventIds) {
      const leaveResult = await authResult.adminClient.rpc('leave_event_atomic', {
        p_event_id: eventId,
        p_actor_user_id: userId,
        p_target_user_id: userId,
      });

      if (leaveResult.error) {
        throw new Error(leaveResult.error.message);
      }

      const payload = (leaveResult.data ?? null) as LeaveEventResult | null;

      await runBestEffortNotificationTask('Account deletion leave notifications', async () => {
        await sendLeaveNotifications(authResult.adminClient, {
          actorUserId: userId,
          targetUserId: userId,
          eventId,
          promotedUserId: payload?.promoted_user_id ?? null,
        });
      });
    }

    const deletedAvailabilityCount = await deleteRowsAndCount(
      authResult.adminClient,
      'player_availability',
      userId,
    );

    await deleteAvatarFolder(authResult.adminClient, userId);

    const deleteUserResult = await authResult.adminClient.auth.admin.deleteUser(userId);

    if (deleteUserResult.error) {
      throw deleteUserResult.error;
    }

    const response: DeleteAccountResponse = {
      cancelled_event_ids: organizedEventIds,
      removed_from_event_ids: joinedEventIds,
      deleted_availability_count: deletedAvailabilityCount,
      deleted_device_token_count: deletedDeviceTokenCount,
    };

    return jsonResponse({
      data: response,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Account deletion failed.';
    return errorResponse('INTERNAL_ERROR', message, 500);
  }
});
