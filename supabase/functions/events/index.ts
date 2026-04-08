import { createClient } from 'jsr:@supabase/supabase-js@2';

import {
  fanOutPushNotifications,
  type NotificationDelivery,
} from '../_shared/notification-utils.ts';
import { enforceSlidingWindowRateLimit } from '../_shared/rate-limit.ts';

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

type SendMessagePayload = {
  body: string;
};

type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'METHOD_NOT_ALLOWED'
  | 'INVALID_JSON'
  | 'VALIDATION_ERROR'
  | 'VENUE_NOT_FOUND'
  | 'EVENT_NOT_FOUND'
  | 'CHAT_CLOSED'
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
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

type EventsRoute =
  | { kind: 'create' }
  | { kind: 'dispatchReminders' }
  | { kind: 'edit'; eventId: string }
  | { kind: 'join'; eventId: string }
  | { kind: 'leave'; eventId: string }
  | { kind: 'cancel'; eventId: string }
  | { kind: 'removePlayer'; eventId: string }
  | { kind: 'noShow'; eventId: string }
  | { kind: 'thumbsUp'; eventId: string }
  | { kind: 'messages'; eventId: string };

type ChatEventRow = {
  id: string;
  organizer_id: string | null;
  status: 'active' | 'full' | 'finished' | 'cancelled';
  chat_closed_at: string | null;
};

type DueReminderRow = {
  event_id: string;
  organizer_id: string | null;
  sport_name_en: string;
  venue_name: string;
  starts_at: string;
};

type ChatMessageRow = {
  id: string;
  event_id: string;
  user_id: string | null;
  body: string;
  sent_at: string;
  is_deleted: boolean;
  author:
    | {
        first_name: string | null;
        last_name: string | null;
        photo_url: string | null;
      }
    | {
        first_name: string | null;
        last_name: string | null;
        photo_url: string | null;
      }[]
    | null;
};

type JoinEventResult = {
  event_id: string;
  membership_status: 'confirmed' | 'waitlisted';
  waitlist_position: number | null;
  event_status: 'active' | 'full' | 'finished' | 'cancelled';
  spots_taken: number;
  waitlist_count: number;
  event_became_full?: boolean;
};

type LeaveEventResult = {
  event_id: string;
  membership_status: null;
  waitlist_position: null;
  event_status: 'active' | 'full' | 'finished' | 'cancelled';
  spots_taken: number;
  waitlist_count: number;
  promoted_user_id: string | null;
};

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

type RateLimitConfig = {
  bucket: string;
  limit: number;
  windowMs: number;
};

type EventNotificationContext = {
  eventId: string;
  organizerId: string | null;
  sportNameEn: string;
  venueName: string;
};

const rateLimitConfigByRoute: Record<
  'join' | 'leave' | 'messages' | 'noShow' | 'thumbsUp' | 'edit',
  RateLimitConfig
> = {
  join: {
    bucket: 'join-event',
    limit: 10,
    windowMs: 60_000,
  },
  leave: {
    bucket: 'leave-event',
    limit: 10,
    windowMs: 60_000,
  },
  messages: {
    bucket: 'send-message',
    limit: 30,
    windowMs: 60_000,
  },
  noShow: {
    bucket: 'report-no-show',
    limit: 20,
    windowMs: 60_000,
  },
  thumbsUp: {
    bucket: 'give-thumbs-up',
    limit: 20,
    windowMs: 60_000,
  },
  edit: {
    bucket: 'edit-event',
    limit: 10,
    windowMs: 60_000,
  },
};

function buildEventDetailUrl(eventId: string): string {
  return `https://hrayem.cz/event/${eventId}`;
}

function buildEventChatUrl(eventId: string): string {
  return `https://hrayem.cz/event/${eventId}?screen=chat`;
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

async function enforceRouteRateLimit(
  route: keyof typeof rateLimitConfigByRoute,
  userId: string,
): Promise<Response | null> {
  const config = rateLimitConfigByRoute[route];
  const result = await enforceSlidingWindowRateLimit({
    key: `${config.bucket}:${userId}`,
    limit: config.limit,
    windowMs: config.windowMs,
  });

  if (result.allowed) {
    return null;
  }

  return new Response(
    JSON.stringify({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please try again later.',
      },
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Retry-After': `${result.retryAfterSeconds}`,
      },
    },
  );
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

  if (
    tail.length === 3 &&
    tail[0] === 'internal' &&
    tail[1] === 'reminders' &&
    tail[2] === 'dispatch'
  ) {
    return {
      kind: 'dispatchReminders',
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

  if (tail.length === 2 && isUuid(tail[0] ?? '') && tail[1] === 'messages') {
    return {
      kind: 'messages',
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

function validateSendMessagePayload(value: unknown): SendMessagePayload {
  if (!value || typeof value !== 'object') {
    throw new Error('Body must be a JSON object.');
  }

  const payload = value as Record<string, unknown>;
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';

  if (!body || body.length > 1_000) {
    throw new Error('body must be a trimmed string between 1 and 1000 characters.');
  }

  return {
    body,
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

  if (normalizedMessage.includes('CHAT_CLOSED')) {
    return {
      code: 'CHAT_CLOSED',
      status: 409,
      message: 'This chat is read-only now.',
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

function resolveChatAuthorRelation(author: ChatMessageRow['author']) {
  if (Array.isArray(author)) {
    return author[0] ?? null;
  }

  return author;
}

function getDisplayName(input: { firstName: string | null; lastName: string | null }): string {
  const combinedName = [input.firstName, input.lastName].filter(Boolean).join(' ').trim();

  return combinedName || 'Hrayem';
}

async function loadEventNotificationContext(
  adminClient: ReturnType<typeof createSupabaseClients>['adminClient'],
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

async function loadDisplayNames(
  adminClient: ReturnType<typeof createSupabaseClients>['adminClient'],
  userIds: string[],
): Promise<Map<string, string>> {
  if (!userIds.length) {
    return new Map();
  }

  const profileResult = await adminClient
    .from('profiles')
    .select('id, first_name, last_name')
    .in('id', userIds);

  if (profileResult.error) {
    throw new Error(profileResult.error.message);
  }

  return new Map(
    (
      (profileResult.data ?? []) as Array<{
        id: string;
        first_name: string | null;
        last_name: string | null;
      }>
    ).map((row) => [
      row.id,
      getDisplayName({
        firstName: row.first_name,
        lastName: row.last_name,
      }),
    ]),
  );
}

async function sendJoinNotifications(
  adminClient: ReturnType<typeof createSupabaseClients>['adminClient'],
  input: {
    eventId: string;
    joinedUserId: string;
    membershipStatus: 'confirmed' | 'waitlisted';
    eventBecameFull: boolean;
  },
): Promise<void> {
  const eventContext = await loadEventNotificationContext(adminClient, input.eventId);
  const displayNames = await loadDisplayNames(adminClient, [input.joinedUserId]);
  const joinedPlayerName = displayNames.get(input.joinedUserId) ?? 'A player';
  const deliveries: NotificationDelivery[] = [];

  if (eventContext.organizerId && eventContext.organizerId !== input.joinedUserId) {
    deliveries.push({
      userId: eventContext.organizerId,
      eventId: input.eventId,
      type: 'player_joined' as const,
      title: 'Someone joined your event',
      body: `${joinedPlayerName} joined ${eventContext.sportNameEn} at ${eventContext.venueName}.`,
      url: buildEventDetailUrl(input.eventId),
      data: {
        route: 'event-detail',
      },
      payload: {
        joinedUserId: input.joinedUserId,
        membershipStatus: input.membershipStatus,
      },
    });
  }

  if (input.membershipStatus === 'confirmed') {
    deliveries.push({
      userId: input.joinedUserId,
      eventId: input.eventId,
      type: 'join_confirmed' as const,
      title: "You're confirmed",
      body: `Your spot for ${eventContext.sportNameEn} at ${eventContext.venueName} is confirmed.`,
      url: buildEventDetailUrl(input.eventId),
      data: {
        route: 'event-detail',
      },
    });
  }

  if (input.eventBecameFull && eventContext.organizerId) {
    deliveries.push({
      userId: eventContext.organizerId,
      eventId: input.eventId,
      type: 'event_full' as const,
      title: 'Event is now full',
      body: `${eventContext.sportNameEn} at ${eventContext.venueName} is now full.`,
      url: buildEventDetailUrl(input.eventId),
      data: {
        route: 'event-detail',
      },
    });
  }

  await fanOutPushNotifications(adminClient, deliveries);
}

async function sendLeaveNotifications(
  adminClient: ReturnType<typeof createSupabaseClients>['adminClient'],
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
      type: 'waitlist_promoted' as const,
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
      type: 'player_removed' as const,
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

async function sendCancelNotifications(
  adminClient: ReturnType<typeof createSupabaseClients>['adminClient'],
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

  await fanOutPushNotifications(
    adminClient,
    recipientUserIds.map((userId) => ({
      userId,
      eventId: input.eventId,
      type: 'event_cancelled' as const,
      title: 'Event cancelled',
      body: `${eventContext.sportNameEn} at ${eventContext.venueName} was cancelled.`,
      url: buildEventDetailUrl(input.eventId),
      data: {
        route: 'event-detail',
      },
    })),
  );
}

async function sendChatNotifications(
  adminClient: ReturnType<typeof createSupabaseClients>['adminClient'],
  input: {
    eventId: string;
    senderUserId: string;
    senderName: string;
    messageBody: string;
    recipientUserIds: string[];
  },
): Promise<void> {
  await fanOutPushNotifications(
    adminClient,
    input.recipientUserIds.map((recipientUserId) => ({
      userId: recipientUserId,
      eventId: input.eventId,
      type: 'chat_message' as const,
      title: input.senderName,
      body: input.messageBody,
      url: buildEventChatUrl(input.eventId),
      data: {
        route: 'chat',
        senderUserId: input.senderUserId,
      },
      payload: {
        senderName: input.senderName,
        bodyPreview: input.messageBody,
      },
    })),
  );
}

function hasValidEventReminderDispatchSecret(request: Request): boolean {
  const expectedSecret = Deno.env.get('EVENT_REMINDER_DISPATCH_SECRET');

  if (!expectedSecret) {
    throw new Error('Event reminder dispatch secret is not configured.');
  }

  return request.headers.get('x-cron-secret') === expectedSecret;
}

async function resetReminderSentFlag(
  adminClient: ReturnType<typeof createAdminClient>,
  eventIds: string[],
): Promise<void> {
  if (!eventIds.length) {
    return;
  }

  const resetResult = await adminClient
    .from('events')
    .update({
      reminder_sent: false,
    })
    .in('id', eventIds);

  if (resetResult.error) {
    throw new Error(resetResult.error.message);
  }
}

async function handleDispatchRemindersRoute(request: Request): Promise<Response> {
  if (!hasValidEventReminderDispatchSecret(request)) {
    return errorResponse('UNAUTHORIZED', 'A valid reminder dispatch secret is required.', 401);
  }

  const adminClient = createAdminClient();
  const claimResult = await adminClient.rpc('claim_due_event_reminders', {
    p_limit: 100,
  });

  if (claimResult.error) {
    return errorResponse('INTERNAL_ERROR', claimResult.error.message, 500);
  }

  const claimedReminders = (claimResult.data ?? []) as DueReminderRow[];

  if (!claimedReminders.length) {
    return jsonResponse({
      data: {
        processed: 0,
        failed: 0,
      },
    });
  }

  const eventIds = claimedReminders.map((row) => row.event_id);
  const participantsResult = await adminClient
    .from('event_players')
    .select('event_id, user_id')
    .in('event_id', eventIds)
    .eq('status', 'confirmed');

  if (participantsResult.error) {
    await resetReminderSentFlag(adminClient, eventIds);
    return errorResponse('INTERNAL_ERROR', participantsResult.error.message, 500);
  }

  const recipientUserIdsByEventId = new Map<string, Set<string>>();

  for (const reminder of claimedReminders) {
    recipientUserIdsByEventId.set(reminder.event_id, new Set<string>());

    if (reminder.organizer_id) {
      recipientUserIdsByEventId.get(reminder.event_id)?.add(reminder.organizer_id);
    }
  }

  for (const row of (participantsResult.data ?? []) as Array<{
    event_id: string;
    user_id: string | null;
  }>) {
    if (!row.user_id) {
      continue;
    }

    const eventRecipients = recipientUserIdsByEventId.get(row.event_id);
    eventRecipients?.add(row.user_id);
  }

  const failedEventIds: string[] = [];
  let processedCount = 0;

  for (const reminder of claimedReminders) {
    const recipientUserIds = [...(recipientUserIdsByEventId.get(reminder.event_id) ?? new Set())];

    try {
      await fanOutPushNotifications(
        adminClient,
        recipientUserIds.map((userId) => ({
          userId,
          eventId: reminder.event_id,
          type: 'event_reminder' as const,
          title: 'Event reminder',
          body: `${reminder.sport_name_en} at ${reminder.venue_name} starts in about 2 hours.`,
          url: buildEventDetailUrl(reminder.event_id),
          data: {
            route: 'event-detail',
          },
          payload: {
            startsAt: reminder.starts_at,
          },
        })),
      );
      processedCount += 1;
    } catch (error) {
      console.error('Event reminder fan-out failed.', error);
      failedEventIds.push(reminder.event_id);
    }
  }

  if (failedEventIds.length) {
    await resetReminderSentFlag(adminClient, failedEventIds);
  }

  return jsonResponse({
    data: {
      processed: processedCount,
      failed: failedEventIds.length,
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

  const rateLimitResponse = await enforceRouteRateLimit('join', authResult.user.id);

  if (rateLimitResponse) {
    return rateLimitResponse;
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

  const joinState = joinResult.data as JoinEventResult;

  try {
    await sendJoinNotifications(authResult.adminClient, {
      eventId,
      joinedUserId: authResult.user.id,
      membershipStatus: joinState.membership_status,
      eventBecameFull: Boolean(joinState.event_became_full),
    });
  } catch (error) {
    console.error('Join notification fan-out failed.', error);
  }

  return jsonResponse({
    data: joinState,
  });
}

async function handleLeaveRoute(request: Request, eventId: string): Promise<Response> {
  const authResult = await requireAuthenticatedUser(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const rateLimitResponse = await enforceRouteRateLimit('leave', authResult.user.id);

  if (rateLimitResponse) {
    return rateLimitResponse;
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

  const leaveState = leaveResult.data as LeaveEventResult;
  const targetUserId = payload.target_user_id ?? authResult.user.id;

  try {
    await sendLeaveNotifications(authResult.adminClient, {
      actorUserId: authResult.user.id,
      targetUserId,
      eventId,
      promotedUserId: leaveState.promoted_user_id,
    });
  } catch (error) {
    console.error('Leave notification fan-out failed.', error);
  }

  return jsonResponse({
    data: leaveState,
  });
}

async function handleEditRoute(request: Request, eventId: string): Promise<Response> {
  const authResult = await requireAuthenticatedUser(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const rateLimitResponse = await enforceRouteRateLimit('edit', authResult.user.id);

  if (rateLimitResponse) {
    return rateLimitResponse;
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

  try {
    await sendCancelNotifications(authResult.adminClient, {
      actorUserId: authResult.user.id,
      eventId,
    });
  } catch (error) {
    console.error('Cancel notification fan-out failed.', error);
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

  const rateLimitResponse = await enforceRouteRateLimit('leave', authResult.user.id);

  if (rateLimitResponse) {
    return rateLimitResponse;
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

  const removeState = removeResult.data as LeaveEventResult;

  try {
    await sendLeaveNotifications(authResult.adminClient, {
      actorUserId: authResult.user.id,
      targetUserId: payload.target_user_id,
      eventId,
      promotedUserId: removeState.promoted_user_id,
    });
  } catch (error) {
    console.error('Remove-player notification fan-out failed.', error);
  }

  return jsonResponse({
    data: removeState,
  });
}

async function handleReportNoShowRoute(request: Request, eventId: string): Promise<Response> {
  const authResult = await requireAuthenticatedUser(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const rateLimitResponse = await enforceRouteRateLimit('noShow', authResult.user.id);

  if (rateLimitResponse) {
    return rateLimitResponse;
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

  const rateLimitResponse = await enforceRouteRateLimit('thumbsUp', authResult.user.id);

  if (rateLimitResponse) {
    return rateLimitResponse;
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

async function handleMessagesRoute(request: Request, eventId: string): Promise<Response> {
  const authResult = await requireAuthenticatedUser(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const rateLimitResponse = await enforceRouteRateLimit('messages', authResult.user.id);

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  let payload: SendMessagePayload;

  try {
    payload = validateSendMessagePayload(await readJsonBody(request));
  } catch (error) {
    const isInvalidJson = error instanceof SyntaxError;
    const message = error instanceof Error ? error.message : 'Request body must be valid JSON.';
    return errorResponse(isInvalidJson ? 'INVALID_JSON' : 'VALIDATION_ERROR', message, 400);
  }

  const eventResult = await authResult.adminClient
    .from('events')
    .select('id, organizer_id, status, chat_closed_at')
    .eq('id', eventId)
    .maybeSingle();

  if (eventResult.error) {
    return errorResponse('INTERNAL_ERROR', eventResult.error.message, 500);
  }

  if (!eventResult.data) {
    return errorResponse('EVENT_NOT_FOUND', 'This event could not be found.', 404);
  }

  const event = eventResult.data as ChatEventRow;
  const isOrganizer = event.organizer_id === authResult.user.id;

  if (event.status === 'cancelled') {
    return errorResponse('CHAT_CLOSED', 'This event was cancelled and chat is read-only.', 409);
  }

  if (event.chat_closed_at && new Date(event.chat_closed_at).getTime() <= Date.now()) {
    return errorResponse('CHAT_CLOSED', 'This chat is read-only now.', 409);
  }

  let isConfirmedPlayer = false;

  if (!isOrganizer) {
    const membershipResult = await authResult.adminClient
      .from('event_players')
      .select('user_id')
      .eq('event_id', eventId)
      .eq('user_id', authResult.user.id)
      .eq('status', 'confirmed')
      .maybeSingle();

    if (membershipResult.error) {
      return errorResponse('INTERNAL_ERROR', membershipResult.error.message, 500);
    }

    isConfirmedPlayer = Boolean(membershipResult.data);
  }

  if (!isOrganizer && !isConfirmedPlayer) {
    return errorResponse('FORBIDDEN', 'Only confirmed players can access event chat.', 403);
  }

  const insertResult = await authResult.adminClient
    .from('chat_messages')
    .insert({
      event_id: eventId,
      user_id: authResult.user.id,
      body: payload.body,
    })
    .select(
      'id, event_id, user_id, body, sent_at, is_deleted, author:profiles!chat_messages_user_id_fkey(first_name, last_name, photo_url)',
    )
    .single();

  if (insertResult.error) {
    return errorResponse('INTERNAL_ERROR', insertResult.error.message, 500);
  }

  if (!insertResult.data) {
    return errorResponse('INTERNAL_ERROR', 'The server did not return the inserted message.', 500);
  }

  const insertedMessage = insertResult.data as ChatMessageRow;
  const messageAuthor = resolveChatAuthorRelation(insertedMessage.author);
  const senderName = getDisplayName({
    firstName: messageAuthor?.first_name ?? null,
    lastName: messageAuthor?.last_name ?? null,
  });

  const recipientsResult = await authResult.adminClient
    .from('event_players')
    .select('user_id')
    .eq('event_id', eventId)
    .eq('status', 'confirmed');

  if (!recipientsResult.error) {
    const recipientIds = new Set<string>();

    for (const row of (recipientsResult.data ?? []) as Array<{ user_id: string | null }>) {
      if (row.user_id && row.user_id !== authResult.user.id) {
        recipientIds.add(row.user_id);
      }
    }

    if (event.organizer_id && event.organizer_id !== authResult.user.id) {
      recipientIds.add(event.organizer_id);
    }

    if (recipientIds.size) {
      try {
        await sendChatNotifications(authResult.adminClient, {
          eventId,
          senderUserId: authResult.user.id,
          senderName,
          messageBody: payload.body,
          recipientUserIds: [...recipientIds],
        });
      } catch (error) {
        console.error('Chat notification fan-out failed.', error);
      }
    }
  }

  return jsonResponse({
    data: insertResult.data,
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
    if (route.kind === 'dispatchReminders') {
      if (request.method !== 'POST') {
        return errorResponse('METHOD_NOT_ALLOWED', 'Only POST is supported for this route.', 405);
      }

      return await handleDispatchRemindersRoute(request);
    }

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

    if (route.kind === 'messages') {
      if (request.method !== 'POST') {
        return errorResponse('METHOD_NOT_ALLOWED', 'Only POST is supported for this route.', 405);
      }

      return await handleMessagesRoute(request, route.eventId);
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
