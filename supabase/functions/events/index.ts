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

type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'METHOD_NOT_ALLOWED'
  | 'INVALID_JSON'
  | 'VALIDATION_ERROR'
  | 'VENUE_NOT_FOUND'
  | 'SKILL_LEVEL_REQUIRED'
  | 'INTERNAL_ERROR';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

function validatePayload(value: unknown): CreateEventPayload {
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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
  }

  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Only POST is supported for /v1/events.', 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return errorResponse('INTERNAL_ERROR', 'Supabase environment is not configured.', 500);
  }

  const authHeader = request.headers.get('Authorization');

  if (!authHeader) {
    return errorResponse('UNAUTHORIZED', 'Missing Authorization header.', 401);
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

  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser();

  if (userError || !user) {
    return errorResponse('UNAUTHORIZED', 'A valid authenticated user is required.', 401);
  }

  let payload: CreateEventPayload;

  try {
    payload = validatePayload(await request.json());
  } catch (error) {
    const isInvalidJson = error instanceof SyntaxError;
    const message = error instanceof Error ? error.message : 'Request body must be valid JSON.';
    return errorResponse(isInvalidJson ? 'INVALID_JSON' : 'VALIDATION_ERROR', message, 400);
  }

  const venueResult = await adminClient
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

  const userSportResult = await adminClient
    .from('user_sports')
    .select('id')
    .eq('user_id', user.id)
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

  const createEventResult = await adminClient.rpc('create_event_atomic', {
    p_sport_id: payload.sport_id,
    p_organizer_id: user.id,
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
    if (createEventResult.error.message.includes('VENUE_NOT_FOUND')) {
      return errorResponse('VENUE_NOT_FOUND', 'The selected venue no longer exists.', 404);
    }

    return errorResponse('INTERNAL_ERROR', createEventResult.error.message, 500);
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
});
