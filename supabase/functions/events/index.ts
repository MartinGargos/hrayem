import { createClient } from 'jsr:@supabase/supabase-js@2';

type CreateEventPayload = {
  sport_id: string;
  venue_id: string;
  starts_at: string;
  ends_at: string;
  reservation_type: 'reserved' | 'to_be_arranged';
  player_count_total: number;
  skill_min: number;
  skill_max: number;
  description?: string | null;
};

type UpdateEventPayload = {
  venue_id?: string;
  starts_at?: string;
  ends_at?: string;
  reservation_type?: 'reserved' | 'to_be_arranged';
  player_count_total?: number;
  skill_min?: number;
  skill_max?: number;
  description?: string | null;
};

type JoinEventPayload = {
  skill_level?: number | null;
};

type LeaveEventPayload = {
  target_user_id?: string | null;
};

type ReportNoShowPayload = {
  reported_user_id: string;
};

type GiveThumbsUpPayload = {
  to_user_id: string;
};

type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'METHOD_NOT_ALLOWED'
  | 'INVALID_JSON'
  | 'VALIDATION_ERROR'
  | 'VENUE_NOT_FOUND'
  | 'EVENT_NOT_FOUND'
  | 'EVENT_NOT_JOINABLE'
  | 'EVENT_NOT_LEAVABLE'
  | 'EVENT_NOT_CANCELLABLE'
  | 'EVENT_NOT_EDITABLE'
  | 'EVENT_ALREADY_STARTED'
  | 'SKILL_LEVEL_REQUIRED'
  | 'ALREADY_JOINED'
  | 'ORGANIZER_CANNOT_JOIN'
  | 'ORGANIZER_CANNOT_LEAVE'
  | 'PLAYER_NOT_IN_EVENT'
  | 'NO_SHOW_NOT_ALLOWED'
  | 'ALREADY_REPORTED'
  | 'THUMBS_UP_NOT_ALLOWED'
  | 'ALREADY_THUMBED_UP'
  | 'INVALID_SKILL_LEVEL'
  | 'PLAYER_COUNT_TOO_LOW'
  | 'INTERNAL_ERROR';

type EventsRoute =
  | { kind: 'create' }
  | { kind: 'edit'; eventId: string }
  | { kind: 'join'; eventId: string }
  | { kind: 'leave'; eventId: string }
  | { kind: 'cancel'; eventId: string }
  | { kind: 'removePlayer'; eventId: string }
  | { kind: 'noShow'; eventId: string }
  | { kind: 'thumbsUp'; eventId: string };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, PATCH, OPTIONS',
} as const;

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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isReservationType(value: unknown): value is CreateEventPayload['reservation_type'] {
  return value === 'reserved' || value === 'to_be_arranged';
}

function isSkillLevel(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 4;
}

async function readJsonBody(request: Request): Promise<unknown> {
  const rawBody = await request.text();

  if (!rawBody.trim()) {
    return {};
  }

  return JSON.parse(rawBody) as unknown;
}

function parseEventsRoute(requestUrl: string): EventsRoute {
  const url = new URL(requestUrl);
  const segments = url.pathname.split('/').filter(Boolean);
  const eventsIndex = segments.lastIndexOf('events');
  const tail = eventsIndex >= 0 ? segments.slice(eventsIndex + 1) : [];

  if (tail.length === 0) {
    return {
      kind: 'create',
    };
  }

  if (tail.length === 1 && isUuid(tail[0] ?? '')) {
    return {
      kind: 'edit',
      eventId: tail[0]!,
    };
  }

  if (tail.length === 2 && isUuid(tail[0] ?? '') && tail[1] === 'join') {
    return {
      kind: 'join',
      eventId: tail[0]!,
    };
  }

  if (tail.length === 2 && isUuid(tail[0] ?? '') && tail[1] === 'leave') {
    return {
      kind: 'leave',
      eventId: tail[0]!,
    };
  }

  if (tail.length === 2 && isUuid(tail[0] ?? '') && tail[1] === 'cancel') {
    return {
      kind: 'cancel',
      eventId: tail[0]!,
    };
  }

  if (tail.length === 2 && isUuid(tail[0] ?? '') && tail[1] === 'remove-player') {
    return {
      kind: 'removePlayer',
      eventId: tail[0]!,
    };
  }

  if (tail.length === 2 && isUuid(tail[0] ?? '') && tail[1] === 'no-show') {
    return {
      kind: 'noShow',
      eventId: tail[0]!,
    };
  }

  if (tail.length === 2 && isUuid(tail[0] ?? '') && tail[1] === 'thumbs-up') {
    return {
      kind: 'thumbsUp',
      eventId: tail[0]!,
    };
  }

  throw new Error('Unsupported events route.');
}

function validateCreatePayload(value: unknown): CreateEventPayload {
  if (!value || typeof value !== 'object') {
    throw new Error('Body must be a JSON object.');
  }

  const payload = value as Record<string, unknown>;
  const sportId = typeof payload.sport_id === 'string' ? payload.sport_id : '';
  const venueId = typeof payload.venue_id === 'string' ? payload.venue_id : '';
  const startsAt = typeof payload.starts_at === 'string' ? payload.starts_at : '';
  const endsAt = typeof payload.ends_at === 'string' ? payload.ends_at : '';
  const reservationType = payload.reservation_type;
  const playerCountTotal = payload.player_count_total;
  const skillMin = payload.skill_min;
  const skillMax = payload.skill_max;
  const description =
    typeof payload.description === 'string'
      ? payload.description.trim()
      : payload.description === null || typeof payload.description === 'undefined'
        ? null
        : undefined;

  if (!isUuid(sportId) || !isUuid(venueId)) {
    throw new Error('sport_id and venue_id must be UUID values.');
  }

  if (!isReservationType(reservationType)) {
    throw new Error("reservation_type must be 'reserved' or 'to_be_arranged'.");
  }

  if (
    typeof playerCountTotal !== 'number' ||
    !Number.isInteger(playerCountTotal) ||
    playerCountTotal < 2 ||
    playerCountTotal > 20
  ) {
    throw new Error('player_count_total must be an integer between 2 and 20.');
  }

  if (!isSkillLevel(skillMin) || !isSkillLevel(skillMax) || skillMin > skillMax) {
    throw new Error(
      'skill_min and skill_max must be integers between 1 and 4 with skill_min <= skill_max.',
    );
  }

  const startsAtDate = new Date(startsAt);
  const endsAtDate = new Date(endsAt);

  if (Number.isNaN(startsAtDate.getTime()) || Number.isNaN(endsAtDate.getTime())) {
    throw new Error('starts_at and ends_at must be valid ISO timestamps.');
  }

  if (endsAtDate <= startsAtDate) {
    throw new Error('ends_at must be later than starts_at.');
  }

  if (startsAtDate <= new Date()) {
    throw new Error('starts_at must be in the future.');
  }

  if (typeof description === 'undefined') {
    throw new Error('description must be omitted, null, or a string.');
  }

  if (description && description.length > 500) {
    throw new Error('description must be 500 characters or fewer.');
  }

  return {
    sport_id: sportId,
    venue_id: venueId,
    starts_at: startsAtDate.toISOString(),
    ends_at: endsAtDate.toISOString(),
    reservation_type: reservationType,
    player_count_total: playerCountTotal,
    skill_min: skillMin,
    skill_max: skillMax,
    description,
  };
}

function validateJoinPayload(value: unknown): JoinEventPayload {
  if (!value || typeof value !== 'object') {
    throw new Error('Body must be a JSON object.');
  }

  const payload = value as Record<string, unknown>;
  const skillLevel = payload.skill_level;

  if (typeof skillLevel !== 'undefined' && skillLevel !== null && !isSkillLevel(skillLevel)) {
    throw new Error('skill_level must be null, omitted, or an integer between 1 and 4.');
  }

  return {
    skill_level: typeof skillLevel === 'number' ? skillLevel : null,
  };
}

function validateUpdatePayload(value: unknown): UpdateEventPayload {
  if (!value || typeof value !== 'object') {
    throw new Error('Body must be a JSON object.');
  }

  const payload = value as Record<string, unknown>;
  const editableKeys = [
    'venue_id',
    'starts_at',
    'ends_at',
    'reservation_type',
    'player_count_total',
    'skill_min',
    'skill_max',
    'description',
  ];
  const hasEditableField = editableKeys.some((key) => Object.hasOwn(payload, key));

  if (!hasEditableField) {
    throw new Error('At least one editable field must be provided.');
  }

  const venueId = Object.hasOwn(payload, 'venue_id') ? payload.venue_id : undefined;
  const startsAt = Object.hasOwn(payload, 'starts_at') ? payload.starts_at : undefined;
  const endsAt = Object.hasOwn(payload, 'ends_at') ? payload.ends_at : undefined;
  const reservationType = Object.hasOwn(payload, 'reservation_type')
    ? payload.reservation_type
    : undefined;
  const playerCountTotal = Object.hasOwn(payload, 'player_count_total')
    ? payload.player_count_total
    : undefined;
  const skillMin = Object.hasOwn(payload, 'skill_min') ? payload.skill_min : undefined;
  const skillMax = Object.hasOwn(payload, 'skill_max') ? payload.skill_max : undefined;
  const description = Object.hasOwn(payload, 'description') ? payload.description : undefined;

  if (typeof venueId !== 'undefined' && (typeof venueId !== 'string' || !isUuid(venueId))) {
    throw new Error('venue_id must be a UUID when provided.');
  }

  let normalizedStartsAt: string | undefined;

  if (typeof startsAt !== 'undefined') {
    if (typeof startsAt !== 'string') {
      throw new Error('starts_at must be a valid ISO timestamp when provided.');
    }

    const startsAtDate = new Date(startsAt);

    if (Number.isNaN(startsAtDate.getTime())) {
      throw new Error('starts_at must be a valid ISO timestamp when provided.');
    }

    normalizedStartsAt = startsAtDate.toISOString();
  }

  let normalizedEndsAt: string | undefined;

  if (typeof endsAt !== 'undefined') {
    if (typeof endsAt !== 'string') {
      throw new Error('ends_at must be a valid ISO timestamp when provided.');
    }

    const endsAtDate = new Date(endsAt);

    if (Number.isNaN(endsAtDate.getTime())) {
      throw new Error('ends_at must be a valid ISO timestamp when provided.');
    }

    normalizedEndsAt = endsAtDate.toISOString();
  }

  if (typeof reservationType !== 'undefined' && !isReservationType(reservationType)) {
    throw new Error("reservation_type must be 'reserved' or 'to_be_arranged' when provided.");
  }

  if (
    typeof playerCountTotal !== 'undefined' &&
    (typeof playerCountTotal !== 'number' ||
      !Number.isInteger(playerCountTotal) ||
      playerCountTotal < 2 ||
      playerCountTotal > 20)
  ) {
    throw new Error('player_count_total must be an integer between 2 and 20 when provided.');
  }

  if (typeof skillMin !== 'undefined' && !isSkillLevel(skillMin)) {
    throw new Error('skill_min must be an integer between 1 and 4 when provided.');
  }

  if (typeof skillMax !== 'undefined' && !isSkillLevel(skillMax)) {
    throw new Error('skill_max must be an integer between 1 and 4 when provided.');
  }

  if (typeof skillMin !== 'undefined' && typeof skillMax !== 'undefined' && skillMin > skillMax) {
    throw new Error('skill_min must be less than or equal to skill_max.');
  }

  if (
    typeof description !== 'undefined' &&
    description !== null &&
    typeof description !== 'string'
  ) {
    throw new Error('description must be null, omitted, or a string.');
  }

  if (typeof description === 'string' && description.trim().length > 500) {
    throw new Error('description must be 500 characters or fewer.');
  }

  return {
    venue_id: venueId,
    starts_at: normalizedStartsAt,
    ends_at: normalizedEndsAt,
    reservation_type: reservationType,
    player_count_total: typeof playerCountTotal === 'number' ? playerCountTotal : undefined,
    skill_min: typeof skillMin === 'number' ? skillMin : undefined,
    skill_max: typeof skillMax === 'number' ? skillMax : undefined,
    description:
      typeof description === 'string'
        ? description.trim()
        : description === null
          ? null
          : undefined,
  };
}

function validateLeavePayload(value: unknown): LeaveEventPayload {
  if (!value || typeof value !== 'object') {
    throw new Error('Body must be a JSON object.');
  }

  const payload = value as Record<string, unknown>;
  const targetUserId = payload.target_user_id;

  if (
    typeof targetUserId !== 'undefined' &&
    targetUserId !== null &&
    (typeof targetUserId !== 'string' || !isUuid(targetUserId))
  ) {
    throw new Error('target_user_id must be null, omitted, or a UUID.');
  }

  return {
    target_user_id: typeof targetUserId === 'string' ? targetUserId : null,
  };
}

function validateReportNoShowPayload(value: unknown): ReportNoShowPayload {
  if (!value || typeof value !== 'object') {
    throw new Error('Body must be a JSON object.');
  }

  const payload = value as Record<string, unknown>;
  const reportedUserId = payload.reported_user_id;

  if (typeof reportedUserId !== 'string' || !isUuid(reportedUserId)) {
    throw new Error('reported_user_id must be a UUID.');
  }

  return {
    reported_user_id: reportedUserId,
  };
}

function validateGiveThumbsUpPayload(value: unknown): GiveThumbsUpPayload {
  if (!value || typeof value !== 'object') {
    throw new Error('Body must be a JSON object.');
  }

  const payload = value as Record<string, unknown>;
  const toUserId = payload.to_user_id;

  if (typeof toUserId !== 'string' || !isUuid(toUserId)) {
    throw new Error('to_user_id must be a UUID.');
  }

  return {
    to_user_id: toUserId,
  };
}

function mapCreateEventError(message: string): {
  code: ApiErrorCode;
  status: number;
  message: string;
} {
  const normalizedMessage = message.toUpperCase();

  if (normalizedMessage.includes('VENUE_NOT_FOUND')) {
    return {
      code: 'VENUE_NOT_FOUND',
      status: 404,
      message: 'The selected venue no longer exists.',
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    status: 500,
    message,
  };
}

function mapEventMutationError(message: string): {
  code: ApiErrorCode;
  status: number;
  message: string;
} {
  const normalizedMessage = message.toUpperCase();

  if (normalizedMessage.includes('EVENT_NOT_FOUND')) {
    return {
      code: 'EVENT_NOT_FOUND',
      status: 404,
      message: 'This event could not be found.',
    };
  }

  if (normalizedMessage.includes('EVENT_ALREADY_STARTED')) {
    return {
      code: 'EVENT_ALREADY_STARTED',
      status: 409,
      message: 'This event has already started.',
    };
  }

  if (normalizedMessage.includes('EVENT_NOT_JOINABLE')) {
    return {
      code: 'EVENT_NOT_JOINABLE',
      status: 409,
      message: 'This event is not open for new joins anymore.',
    };
  }

  if (normalizedMessage.includes('EVENT_NOT_LEAVABLE')) {
    return {
      code: 'EVENT_NOT_LEAVABLE',
      status: 409,
      message: 'This event can no longer be left from the app.',
    };
  }

  if (normalizedMessage.includes('EVENT_NOT_CANCELLABLE')) {
    return {
      code: 'EVENT_NOT_CANCELLABLE',
      status: 409,
      message: 'This event can no longer be cancelled from the app.',
    };
  }

  if (normalizedMessage.includes('EVENT_NOT_EDITABLE')) {
    return {
      code: 'EVENT_NOT_EDITABLE',
      status: 409,
      message: 'This event can no longer be edited from the app.',
    };
  }

  if (normalizedMessage.includes('SKILL_LEVEL_REQUIRED')) {
    return {
      code: 'SKILL_LEVEL_REQUIRED',
      status: 409,
      message: 'Choose your skill level for this sport before joining.',
    };
  }

  if (normalizedMessage.includes('ALREADY_JOINED')) {
    return {
      code: 'ALREADY_JOINED',
      status: 409,
      message: 'You already joined this event.',
    };
  }

  if (normalizedMessage.includes('ORGANIZER_CANNOT_JOIN')) {
    return {
      code: 'ORGANIZER_CANNOT_JOIN',
      status: 409,
      message: 'The organizer cannot join their own event.',
    };
  }

  if (normalizedMessage.includes('ORGANIZER_CANNOT_LEAVE')) {
    return {
      code: 'ORGANIZER_CANNOT_LEAVE',
      status: 409,
      message: 'The organizer cannot leave their own event.',
    };
  }

  if (normalizedMessage.includes('PLAYER_NOT_IN_EVENT')) {
    return {
      code: 'PLAYER_NOT_IN_EVENT',
      status: 409,
      message: 'The selected player is not in this event anymore.',
    };
  }

  if (normalizedMessage.includes('INVALID_SKILL_LEVEL')) {
    return {
      code: 'INVALID_SKILL_LEVEL',
      status: 400,
      message: 'The provided skill level is invalid.',
    };
  }

  if (normalizedMessage.includes('PLAYER_COUNT_TOO_LOW')) {
    return {
      code: 'PLAYER_COUNT_TOO_LOW',
      status: 409,
      message: 'The total player count cannot be reduced below the confirmed player count.',
    };
  }

  if (normalizedMessage.includes('FORBIDDEN')) {
    return {
      code: 'FORBIDDEN',
      status: 403,
      message: 'You are not allowed to perform this action.',
    };
  }

  if (normalizedMessage.includes('NO_SHOW_NOT_ALLOWED')) {
    return {
      code: 'NO_SHOW_NOT_ALLOWED',
      status: 409,
      message: 'No-show reporting is not available for this event anymore.',
    };
  }

  if (normalizedMessage.includes('ALREADY_REPORTED')) {
    return {
      code: 'ALREADY_REPORTED',
      status: 409,
      message: 'This player was already reported as a no-show for this event.',
    };
  }

  if (normalizedMessage.includes('THUMBS_UP_NOT_ALLOWED')) {
    return {
      code: 'THUMBS_UP_NOT_ALLOWED',
      status: 409,
      message: 'Thumbs up is not available for this event anymore.',
    };
  }

  if (normalizedMessage.includes('ALREADY_THUMBED_UP')) {
    return {
      code: 'ALREADY_THUMBED_UP',
      status: 409,
      message: 'You already gave this player a thumbs up for this event.',
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    status: 500,
    message,
  };
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
    throw new Error('Missing Authorization header.');
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

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return {
    authClient,
    adminClient,
  };
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

async function handleCreateRoute(request: Request): Promise<Response> {
  const authResult = await requireAuthenticatedUser(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  let payload: CreateEventPayload;

  try {
    payload = validateCreatePayload(await readJsonBody(request));
  } catch (error) {
    const isInvalidJson = error instanceof SyntaxError;
    const message = error instanceof Error ? error.message : 'Request body must be valid JSON.';
    return errorResponse(isInvalidJson ? 'INVALID_JSON' : 'VALIDATION_ERROR', message, 400);
  }

  const venueResult = await authResult.adminClient
    .from('venues')
    .select('id')
    .eq('id', payload.venue_id)
    .maybeSingle();

  if (venueResult.error) {
    return errorResponse('INTERNAL_ERROR', venueResult.error.message, 500);
  }

  if (!venueResult.data) {
    return errorResponse('VENUE_NOT_FOUND', 'The selected venue no longer exists.', 404);
  }

  const userSportResult = await authResult.adminClient
    .from('user_sports')
    .select('id')
    .eq('user_id', authResult.user.id)
    .eq('sport_id', payload.sport_id)
    .limit(1)
    .maybeSingle();

  if (userSportResult.error) {
    return errorResponse('INTERNAL_ERROR', userSportResult.error.message, 500);
  }

  if (!userSportResult.data) {
    return errorResponse(
      'SKILL_LEVEL_REQUIRED',
      'Select your skill level for this sport before creating an event.',
      409,
    );
  }

  const createEventResult = await authResult.adminClient.rpc('create_event_atomic', {
    p_sport_id: payload.sport_id,
    p_organizer_id: authResult.user.id,
    p_venue_id: payload.venue_id,
    p_starts_at: payload.starts_at,
    p_ends_at: payload.ends_at,
    p_reservation_type: payload.reservation_type,
    p_player_count_total: payload.player_count_total,
    p_skill_min: payload.skill_min,
    p_skill_max: payload.skill_max,
    p_description: payload.description,
  });

  if (createEventResult.error) {
    const mappedError = mapCreateEventError(createEventResult.error.message);
    return errorResponse(mappedError.code, mappedError.message, mappedError.status);
  }

  const createdEvent = Array.isArray(createEventResult.data)
    ? (createEventResult.data[0] ?? null)
    : createEventResult.data;

  if (!createdEvent) {
    return errorResponse('INTERNAL_ERROR', 'The server did not return the created event.', 500);
  }

  return jsonResponse(
    {
      data: createdEvent,
    },
    201,
  );
}

async function handleJoinRoute(request: Request, eventId: string): Promise<Response> {
  const authResult = await requireAuthenticatedUser(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  let payload: JoinEventPayload;

  try {
    payload = validateJoinPayload(await readJsonBody(request));
  } catch (error) {
    const isInvalidJson = error instanceof SyntaxError;
    const message = error instanceof Error ? error.message : 'Request body must be valid JSON.';
    return errorResponse(isInvalidJson ? 'INVALID_JSON' : 'VALIDATION_ERROR', message, 400);
  }

  const joinResult = await authResult.adminClient.rpc('join_event_atomic', {
    p_event_id: eventId,
    p_user_id: authResult.user.id,
    p_skill_level: payload.skill_level,
  });

  if (joinResult.error) {
    const mappedError = mapEventMutationError(joinResult.error.message);
    return errorResponse(mappedError.code, mappedError.message, mappedError.status);
  }

  if (!joinResult.data) {
    return errorResponse('INTERNAL_ERROR', 'The server did not return join state.', 500);
  }

  return jsonResponse({
    data: joinResult.data,
  });
}

async function handleLeaveRoute(request: Request, eventId: string): Promise<Response> {
  const authResult = await requireAuthenticatedUser(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  let payload: LeaveEventPayload;

  try {
    payload = validateLeavePayload(await readJsonBody(request));
  } catch (error) {
    const isInvalidJson = error instanceof SyntaxError;
    const message = error instanceof Error ? error.message : 'Request body must be valid JSON.';
    return errorResponse(isInvalidJson ? 'INVALID_JSON' : 'VALIDATION_ERROR', message, 400);
  }

  const leaveResult = await authResult.adminClient.rpc('leave_event_atomic', {
    p_event_id: eventId,
    p_actor_user_id: authResult.user.id,
    p_target_user_id: payload.target_user_id,
  });

  if (leaveResult.error) {
    const mappedError = mapEventMutationError(leaveResult.error.message);
    return errorResponse(mappedError.code, mappedError.message, mappedError.status);
  }

  if (!leaveResult.data) {
    return errorResponse('INTERNAL_ERROR', 'The server did not return leave state.', 500);
  }

  return jsonResponse({
    data: leaveResult.data,
  });
}

async function handleEditRoute(request: Request, eventId: string): Promise<Response> {
  const authResult = await requireAuthenticatedUser(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  let payload: UpdateEventPayload;

  try {
    payload = validateUpdatePayload(await readJsonBody(request));
  } catch (error) {
    const isInvalidJson = error instanceof SyntaxError;
    const message = error instanceof Error ? error.message : 'Request body must be valid JSON.';
    return errorResponse(isInvalidJson ? 'INVALID_JSON' : 'VALIDATION_ERROR', message, 400);
  }

  const editResult = await authResult.adminClient.rpc('update_event_atomic', {
    p_event_id: eventId,
    p_actor_user_id: authResult.user.id,
    p_venue_id: payload.venue_id ?? null,
    p_starts_at: payload.starts_at ?? null,
    p_ends_at: payload.ends_at ?? null,
    p_reservation_type: payload.reservation_type ?? null,
    p_player_count_total: payload.player_count_total ?? null,
    p_skill_min: payload.skill_min ?? null,
    p_skill_max: payload.skill_max ?? null,
    p_description: payload.description ?? null,
    p_description_is_set: typeof payload.description !== 'undefined',
  });

  if (editResult.error) {
    const mappedError = mapEventMutationError(editResult.error.message);
    return errorResponse(mappedError.code, mappedError.message, mappedError.status);
  }

  const editedEvent = Array.isArray(editResult.data)
    ? (editResult.data[0] ?? null)
    : editResult.data;

  if (!editedEvent) {
    return errorResponse('INTERNAL_ERROR', 'The server did not return the updated event.', 500);
  }

  return jsonResponse({
    data: editedEvent,
  });
}

async function handleCancelRoute(request: Request, eventId: string): Promise<Response> {
  const authResult = await requireAuthenticatedUser(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const cancelResult = await authResult.adminClient.rpc('cancel_event_atomic', {
    p_event_id: eventId,
    p_actor_user_id: authResult.user.id,
  });

  if (cancelResult.error) {
    const mappedError = mapEventMutationError(cancelResult.error.message);
    return errorResponse(mappedError.code, mappedError.message, mappedError.status);
  }

  const cancelledEvent = Array.isArray(cancelResult.data)
    ? (cancelResult.data[0] ?? null)
    : cancelResult.data;

  if (!cancelledEvent) {
    return errorResponse('INTERNAL_ERROR', 'The server did not return the cancelled event.', 500);
  }

  return jsonResponse({
    data: cancelledEvent,
  });
}

async function handleRemovePlayerRoute(request: Request, eventId: string): Promise<Response> {
  const authResult = await requireAuthenticatedUser(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  let payload: LeaveEventPayload;

  try {
    payload = validateLeavePayload(await readJsonBody(request));
  } catch (error) {
    const isInvalidJson = error instanceof SyntaxError;
    const message = error instanceof Error ? error.message : 'Request body must be valid JSON.';
    return errorResponse(isInvalidJson ? 'INVALID_JSON' : 'VALIDATION_ERROR', message, 400);
  }

  if (!payload.target_user_id) {
    return errorResponse(
      'VALIDATION_ERROR',
      'target_user_id must be provided when removing a player.',
      400,
    );
  }

  const organizerResult = await authResult.adminClient
    .from('events')
    .select('organizer_id')
    .eq('id', eventId)
    .maybeSingle();

  if (organizerResult.error) {
    return errorResponse('INTERNAL_ERROR', organizerResult.error.message, 500);
  }

  if (!organizerResult.data) {
    return errorResponse('EVENT_NOT_FOUND', 'This event could not be found.', 404);
  }

  if (organizerResult.data.organizer_id !== authResult.user.id) {
    return errorResponse('FORBIDDEN', 'Only the organizer can remove players.', 403);
  }

  const removeResult = await authResult.adminClient.rpc('leave_event_atomic', {
    p_event_id: eventId,
    p_actor_user_id: authResult.user.id,
    p_target_user_id: payload.target_user_id,
  });

  if (removeResult.error) {
    const mappedError = mapEventMutationError(removeResult.error.message);
    return errorResponse(mappedError.code, mappedError.message, mappedError.status);
  }

  if (!removeResult.data) {
    return errorResponse('INTERNAL_ERROR', 'The server did not return remove-player state.', 500);
  }

  return jsonResponse({
    data: removeResult.data,
  });
}

async function handleReportNoShowRoute(request: Request, eventId: string): Promise<Response> {
  const authResult = await requireAuthenticatedUser(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  let payload: ReportNoShowPayload;

  try {
    payload = validateReportNoShowPayload(await readJsonBody(request));
  } catch (error) {
    const isInvalidJson = error instanceof SyntaxError;
    const message = error instanceof Error ? error.message : 'Request body must be valid JSON.';
    return errorResponse(isInvalidJson ? 'INVALID_JSON' : 'VALIDATION_ERROR', message, 400);
  }

  const reportResult = await authResult.adminClient.rpc('report_no_show_atomic', {
    p_event_id: eventId,
    p_actor_user_id: authResult.user.id,
    p_reported_user_id: payload.reported_user_id,
  });

  if (reportResult.error) {
    const mappedError = mapEventMutationError(reportResult.error.message);
    return errorResponse(mappedError.code, mappedError.message, mappedError.status);
  }

  if (!reportResult.data) {
    return errorResponse('INTERNAL_ERROR', 'The server did not return the no-show report.', 500);
  }

  return jsonResponse({
    data: reportResult.data,
  });
}

async function handleThumbsUpRoute(request: Request, eventId: string): Promise<Response> {
  const authResult = await requireAuthenticatedUser(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  let payload: GiveThumbsUpPayload;

  try {
    payload = validateGiveThumbsUpPayload(await readJsonBody(request));
  } catch (error) {
    const isInvalidJson = error instanceof SyntaxError;
    const message = error instanceof Error ? error.message : 'Request body must be valid JSON.';
    return errorResponse(isInvalidJson ? 'INVALID_JSON' : 'VALIDATION_ERROR', message, 400);
  }

  const thumbsUpResult = await authResult.adminClient.rpc('give_thumbs_up_atomic', {
    p_event_id: eventId,
    p_from_user_id: authResult.user.id,
    p_to_user_id: payload.to_user_id,
  });

  if (thumbsUpResult.error) {
    const mappedError = mapEventMutationError(thumbsUpResult.error.message);
    return errorResponse(mappedError.code, mappedError.message, mappedError.status);
  }

  if (!thumbsUpResult.data) {
    return errorResponse('INTERNAL_ERROR', 'The server did not return the thumbs up record.', 500);
  }

  return jsonResponse({
    data: thumbsUpResult.data,
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
  }

  let route: EventsRoute;

  try {
    route = parseEventsRoute(request.url);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unsupported events route.';
    return errorResponse('VALIDATION_ERROR', message, 400);
  }

  try {
    if (route.kind === 'create') {
      if (request.method !== 'POST') {
        return errorResponse('METHOD_NOT_ALLOWED', 'Only POST is supported for this route.', 405);
      }

      return await handleCreateRoute(request);
    }

    if (route.kind === 'edit') {
      if (request.method !== 'PATCH') {
        return errorResponse('METHOD_NOT_ALLOWED', 'Only PATCH is supported for this route.', 405);
      }

      return await handleEditRoute(request, route.eventId);
    }

    if (route.kind === 'join') {
      if (request.method !== 'POST') {
        return errorResponse('METHOD_NOT_ALLOWED', 'Only POST is supported for this route.', 405);
      }

      return await handleJoinRoute(request, route.eventId);
    }

    if (route.kind === 'leave') {
      if (request.method !== 'POST') {
        return errorResponse('METHOD_NOT_ALLOWED', 'Only POST is supported for this route.', 405);
      }

      return await handleLeaveRoute(request, route.eventId);
    }

    if (route.kind === 'cancel') {
      if (request.method !== 'POST') {
        return errorResponse('METHOD_NOT_ALLOWED', 'Only POST is supported for this route.', 405);
      }

      return await handleCancelRoute(request, route.eventId);
    }

    if (route.kind === 'noShow') {
      if (request.method !== 'POST') {
        return errorResponse('METHOD_NOT_ALLOWED', 'Only POST is supported for this route.', 405);
      }

      return await handleReportNoShowRoute(request, route.eventId);
    }

    if (route.kind === 'thumbsUp') {
      if (request.method !== 'POST') {
        return errorResponse('METHOD_NOT_ALLOWED', 'Only POST is supported for this route.', 405);
      }

      return await handleThumbsUpRoute(request, route.eventId);
    }

    if (request.method !== 'POST') {
      return errorResponse('METHOD_NOT_ALLOWED', 'Only POST is supported for this route.', 405);
    }

    return await handleRemovePlayerRoute(request, route.eventId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    return errorResponse('INTERNAL_ERROR', message, 500);
  }
});
