import { FunctionsHttpError } from '@supabase/supabase-js';

import { useAuthStore } from '../store/auth-store';
import { retryOnceAfterUnauthorized, throwIfSupabaseError } from '../utils/supabase';
import type {
  CreateEventErrorCode,
  CreateEventInput,
  CreateEventResponse,
  EventConfirmedPlayer,
  EventDetail,
  EventFeedFilters,
  EventFeedItem,
  SportSummary,
  UserSportProfile,
} from '../types/events';
import { refreshSupabaseSession, retrySupabaseOperationOnce, supabase } from './supabase';

type SportRow = {
  id: string;
  slug: string;
  name_cs: string;
  name_en: string;
  icon_name: string;
  color_hex: string;
  sort_order: number;
};

type UserSportRow = {
  id: string;
  user_id: string;
  sport_id: string;
  skill_level: number;
  games_played: number;
  hours_played: number | string;
  no_shows: number;
};

type EventFeedRow = {
  id: string;
  sport_id: string;
  sport_slug: string;
  sport_name_cs: string;
  sport_name_en: string;
  sport_icon: string;
  sport_color: string;
  organizer_id: string | null;
  organizer_first_name: string | null;
  organizer_photo_url: string | null;
  organizer_no_shows: number;
  organizer_games_played: number;
  venue_id: string;
  venue_name: string;
  venue_address: string | null;
  starts_at: string;
  ends_at: string;
  city: string;
  reservation_type: EventFeedItem['reservationType'];
  player_count_total: number;
  skill_min: number;
  skill_max: number;
  description: string | null;
  status: EventFeedItem['status'];
  spots_taken: number;
  waitlist_count: number;
  created_at: string;
};

type OrganizerNameRow = {
  last_name: string | null;
};

type EventPlayerRow = {
  user_id: string | null;
  joined_at: string;
  profile:
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

type EdgeFunctionFailure = {
  error?: {
    code?: CreateEventErrorCode;
    message?: string;
  };
};

function readEdgeFunctionFailure(
  value: EdgeFunctionFailure | { data: unknown } | null,
): EdgeFunctionFailure['error'] | null {
  if (!value || !('error' in value)) {
    return null;
  }

  return value.error ?? null;
}

export class EdgeFunctionError extends Error {
  code: CreateEventErrorCode | null;
  status: number;

  constructor(message: string, code: CreateEventErrorCode | null, status: number) {
    super(message);
    this.name = 'EdgeFunctionError';
    this.code = code;
    this.status = status;
  }
}

function mapSportRow(row: SportRow): SportSummary {
  return {
    id: row.id,
    slug: row.slug,
    nameCs: row.name_cs,
    nameEn: row.name_en,
    iconName: row.icon_name,
    colorHex: row.color_hex,
    sortOrder: row.sort_order,
  };
}

function mapUserSportRow(row: UserSportRow): UserSportProfile {
  return {
    id: row.id,
    userId: row.user_id,
    sportId: row.sport_id,
    skillLevel: row.skill_level,
    gamesPlayed: row.games_played,
    hoursPlayed: Number(row.hours_played),
    noShows: row.no_shows,
  };
}

function mapEventFeedRow(row: EventFeedRow): EventFeedItem {
  return {
    id: row.id,
    sportId: row.sport_id,
    sportSlug: row.sport_slug,
    sportNameCs: row.sport_name_cs,
    sportNameEn: row.sport_name_en,
    sportIcon: row.sport_icon,
    sportColor: row.sport_color,
    organizerId: row.organizer_id,
    organizerFirstName: row.organizer_first_name,
    organizerPhotoUrl: row.organizer_photo_url,
    organizerNoShows: row.organizer_no_shows,
    organizerGamesPlayed: row.organizer_games_played,
    venueId: row.venue_id,
    venueName: row.venue_name,
    venueAddress: row.venue_address,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    city: row.city,
    reservationType: row.reservation_type,
    playerCountTotal: row.player_count_total,
    skillMin: row.skill_min,
    skillMax: row.skill_max,
    description: row.description,
    status: row.status,
    spotsTaken: row.spots_taken,
    waitlistCount: row.waitlist_count,
    createdAt: row.created_at,
  };
}

function resolveProfileRelation(profile: EventPlayerRow['profile']) {
  if (Array.isArray(profile)) {
    return profile[0] ?? null;
  }

  return profile;
}

async function callEventsFunction<TResponse>(body: Record<string, unknown>): Promise<TResponse> {
  return retryOnceAfterUnauthorized(
    async () => {
      const accessToken = useAuthStore.getState().accessToken;

      if (!accessToken) {
        throw new EdgeFunctionError('Missing authenticated session.', 'UNAUTHORIZED', 401);
      }

      const result = await supabase.functions.invoke<{
        data: TResponse;
      }>('events', {
        body,
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (result.error) {
        if (result.error instanceof FunctionsHttpError) {
          const response = result.error.context;
          let parsedBody: EdgeFunctionFailure | { data: TResponse } | null = null;

          try {
            parsedBody = (await response.json()) as EdgeFunctionFailure | { data: TResponse };
          } catch {
            parsedBody = null;
          }

          const failure = readEdgeFunctionFailure(parsedBody);

          if (response.status === 401) {
            throw {
              status: 401,
              message: failure?.message ?? result.error.message,
            };
          }

          throw new EdgeFunctionError(
            failure?.message ?? result.error.message,
            failure?.code ?? null,
            response.status,
          );
        }

        throw new EdgeFunctionError(result.error.message, null, 500);
      }

      if (!result.data?.data) {
        throw new EdgeFunctionError('The server returned an unexpected response.', null, 500);
      }

      return result.data.data;
    },
    async () => {
      const refreshedSession = await refreshSupabaseSession();

      if (!refreshedSession) {
        throw new EdgeFunctionError(
          'Your session expired. Please log in again.',
          'UNAUTHORIZED',
          401,
        );
      }
    },
  );
}

export async function fetchActiveSports(): Promise<SportSummary[]> {
  const result = await retrySupabaseOperationOnce(() =>
    supabase
      .from('sports')
      .select('id, slug, name_cs, name_en, icon_name, color_hex, sort_order')
      .order('sort_order', { ascending: true }),
  );

  throwIfSupabaseError(result.error, 'Unable to load sports.');

  return ((result.data ?? []) as SportRow[]).map(mapSportRow);
}

export async function fetchOwnSportProfiles(userId: string): Promise<UserSportProfile[]> {
  const result = await retrySupabaseOperationOnce(() =>
    supabase
      .from('user_sports')
      .select('id, user_id, sport_id, skill_level, games_played, hours_played, no_shows')
      .eq('user_id', userId),
  );

  throwIfSupabaseError(result.error, 'Unable to load sport profiles.');

  return ((result.data ?? []) as UserSportRow[]).map(mapUserSportRow);
}

export async function upsertOwnSportProfile(input: {
  userId: string;
  sportId: string;
  skillLevel: number;
}): Promise<UserSportProfile> {
  const result = await retrySupabaseOperationOnce(() =>
    supabase
      .from('user_sports')
      .upsert(
        {
          user_id: input.userId,
          sport_id: input.sportId,
          skill_level: input.skillLevel,
        },
        {
          onConflict: 'user_id,sport_id',
        },
      )
      .select('id, user_id, sport_id, skill_level, games_played, hours_played, no_shows')
      .single(),
  );

  throwIfSupabaseError(result.error, 'Unable to save the skill level.');

  if (!result.data) {
    throw new Error('Missing user sport row after upsert.');
  }

  return mapUserSportRow(result.data as UserSportRow);
}

export async function fetchEventFeedPage(input: {
  filters: EventFeedFilters;
  offset: number;
  limit: number;
}): Promise<EventFeedItem[]> {
  let query = supabase
    .from('event_feed_view')
    .select(
      'id, sport_id, sport_slug, sport_name_cs, sport_name_en, sport_icon, sport_color, organizer_id, organizer_first_name, organizer_photo_url, organizer_no_shows, organizer_games_played, venue_id, venue_name, venue_address, starts_at, ends_at, city, reservation_type, player_count_total, skill_min, skill_max, description, status, spots_taken, waitlist_count, created_at',
    )
    .eq('city', input.filters.city)
    .gte('starts_at', input.filters.startsAtFrom)
    .lte('starts_at', input.filters.startsAtTo)
    .order('starts_at', { ascending: true })
    .order('created_at', { ascending: true })
    .range(input.offset, input.offset + input.limit - 1);

  if (input.filters.sportIds.length) {
    query = query.in('sport_id', input.filters.sportIds);
  }

  const result = await retrySupabaseOperationOnce(() => query);

  throwIfSupabaseError(result.error, 'Unable to load the event feed.');

  return ((result.data ?? []) as EventFeedRow[]).map(mapEventFeedRow);
}

export async function fetchEventDetail(eventId: string): Promise<EventDetail> {
  const detailResult = await retrySupabaseOperationOnce(() =>
    supabase
      .from('event_detail_view')
      .select(
        'id, sport_id, sport_slug, sport_name_cs, sport_name_en, sport_icon, sport_color, organizer_id, organizer_first_name, organizer_photo_url, organizer_no_shows, organizer_games_played, venue_id, venue_name, venue_address, starts_at, ends_at, city, reservation_type, player_count_total, skill_min, skill_max, description, status, spots_taken, waitlist_count, created_at',
      )
      .eq('id', eventId)
      .single(),
  );

  throwIfSupabaseError(detailResult.error, 'Unable to load the event.');

  if (!detailResult.data) {
    throw new Error('Missing event detail row.');
  }

  const mappedDetail = mapEventFeedRow(detailResult.data as EventFeedRow);

  if (!mappedDetail.organizerId) {
    return {
      ...mappedDetail,
      organizerLastName: null,
    };
  }

  const organizerResult = await retrySupabaseOperationOnce(() =>
    supabase.from('profiles').select('last_name').eq('id', mappedDetail.organizerId).maybeSingle(),
  );

  throwIfSupabaseError(organizerResult.error, 'Unable to load the organizer profile.');

  return {
    ...mappedDetail,
    organizerLastName: (organizerResult.data as OrganizerNameRow | null)?.last_name ?? null,
  };
}

export async function fetchConfirmedEventPlayers(input: {
  eventId: string;
  sportId: string;
}): Promise<EventConfirmedPlayer[]> {
  const playersResult = await retrySupabaseOperationOnce(() =>
    supabase
      .from('event_players')
      .select(
        'user_id, joined_at, profile:profiles!event_players_user_id_fkey(first_name, last_name, photo_url)',
      )
      .eq('event_id', input.eventId)
      .eq('status', 'confirmed')
      .order('joined_at', { ascending: true }),
  );

  throwIfSupabaseError(playersResult.error, 'Unable to load confirmed players.');

  const playerRows = (playersResult.data ?? []) as EventPlayerRow[];
  const playerIds = playerRows
    .map((row) => row.user_id)
    .filter((value): value is string => typeof value === 'string');

  const playerSkillsByUserId = new Map<string, number>();

  if (playerIds.length) {
    const skillsResult = await retrySupabaseOperationOnce(() =>
      supabase
        .from('user_sports')
        .select('user_id, skill_level')
        .eq('sport_id', input.sportId)
        .in('user_id', playerIds),
    );

    throwIfSupabaseError(skillsResult.error, 'Unable to load player skill levels.');

    for (const row of (skillsResult.data ?? []) as { user_id: string; skill_level: number }[]) {
      playerSkillsByUserId.set(row.user_id, row.skill_level);
    }
  }

  return playerRows.map((row) => {
    const profile = resolveProfileRelation(row.profile);

    return {
      userId: row.user_id ?? `deleted-${row.joined_at}`,
      firstName: profile?.first_name ?? null,
      lastName: profile?.last_name ?? null,
      photoUrl: profile?.photo_url ?? null,
      skillLevel: row.user_id ? (playerSkillsByUserId.get(row.user_id) ?? null) : null,
      joinedAt: row.joined_at,
    };
  });
}

export async function createEvent(input: CreateEventInput): Promise<CreateEventResponse> {
  return callEventsFunction<CreateEventResponse>({
    sport_id: input.sportId,
    venue_id: input.venueId,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    reservation_type: input.reservationType,
    player_count_total: input.playerCountTotal,
    skill_min: input.skillMin,
    skill_max: input.skillMax,
    description: input.description ?? null,
  });
}
