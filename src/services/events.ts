import { useAuthStore } from '../store/auth-store';
import { requirePublicEnvValue } from '../utils/env';
import { retryOnceAfterUnauthorized, throwIfSupabaseError } from '../utils/supabase';
import type {
  CancelEventInput,
  CancelEventResponse,
  CreateEventErrorCode,
  CreateEventInput,
  CreateEventResponse,
  EventConfirmedPlayer,
  EventDetail,
  EventFeedFilters,
  EventFeedItem,
  EventMembershipStatus,
  GiveThumbsUpInput,
  GiveThumbsUpResponse,
  JoinEventInput,
  JoinEventResponse,
  LeaveEventInput,
  LeaveEventResponse,
  MyGamesPastItem,
  MyGamesUpcomingItem,
  PlayAgainConnection,
  PlayerSportStat,
  ReportNoShowInput,
  ReportNoShowResponse,
  RemovePlayerInput,
  RemovePlayerResponse,
  SportSummary,
  UpdateEventInput,
  UpdateEventResponse,
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

type EventDetailRow = EventFeedRow & {
  organizer_last_name: string | null;
  no_show_window_end: string | null;
  chat_closed_at: string | null;
  viewer_membership_status: EventMembershipStatus | null;
  viewer_waitlist_position: number | null;
};

type MyGamesUpcomingRow = EventFeedRow & {
  viewer_membership_status: Extract<EventMembershipStatus, 'organizer' | 'confirmed'>;
};

type MyGamesPastRow = EventFeedRow & {
  no_show_window_end: string | null;
  chat_closed_at: string | null;
  viewer_membership_status: Extract<EventMembershipStatus, 'organizer' | 'confirmed'>;
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

type PlayerSportStatRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  photo_url: string | null;
  city: string | null;
  sport_id: string;
  sport_slug: string;
  sport_name_cs: string;
  sport_name_en: string;
  sport_icon: string;
  sport_color: string;
  skill_level: number;
  games_played: number;
  hours_played: number | string;
  no_shows: number;
  thumbs_up_games: number;
  thumbs_up_percentage: number | null;
  is_play_again_connection: boolean;
};

type PlayAgainConnectionRow = {
  connection_user_id: string;
  first_name: string | null;
  last_name: string | null;
  photo_url: string | null;
  city: string | null;
  sport_id: string;
  sport_slug: string;
  sport_name_cs: string;
  sport_name_en: string;
  sport_icon: string;
  sport_color: string;
  skill_level: number;
  games_played: number;
  hours_played: number | string;
  no_shows: number;
  thumbs_up_percentage: number | null;
};

type VisibleProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  photo_url: string | null;
  city: string | null;
};

type PostGameThumbRow = {
  to_user: string | null;
};

type NoShowReportRow = {
  reported_user: string | null;
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

const eventsFunctionUrl = `${requirePublicEnvValue('supabaseUrl')}/functions/v1/events`;
const supabaseAnonKey = requirePublicEnvValue('supabaseAnonKey');

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

function mapPlayerSportStatRow(row: PlayerSportStatRow): PlayerSportStat {
  return {
    userId: row.user_id,
    firstName: row.first_name,
    lastName: row.last_name,
    photoUrl: row.photo_url,
    city: row.city,
    sportId: row.sport_id,
    sportSlug: row.sport_slug,
    sportNameCs: row.sport_name_cs,
    sportNameEn: row.sport_name_en,
    sportIcon: row.sport_icon,
    sportColor: row.sport_color,
    skillLevel: row.skill_level,
    gamesPlayed: row.games_played,
    hoursPlayed: Number(row.hours_played),
    noShows: row.no_shows,
    thumbsUpGames: row.thumbs_up_games,
    thumbsUpPercentage: row.thumbs_up_percentage === null ? null : Number(row.thumbs_up_percentage),
    isPlayAgainConnection: row.is_play_again_connection,
  };
}

function mapPlayAgainConnectionRow(row: PlayAgainConnectionRow): PlayAgainConnection {
  return {
    connectionUserId: row.connection_user_id,
    firstName: row.first_name,
    lastName: row.last_name,
    photoUrl: row.photo_url,
    city: row.city,
    sportId: row.sport_id,
    sportSlug: row.sport_slug,
    sportNameCs: row.sport_name_cs,
    sportNameEn: row.sport_name_en,
    sportIcon: row.sport_icon,
    sportColor: row.sport_color,
    skillLevel: row.skill_level,
    gamesPlayed: row.games_played,
    hoursPlayed: Number(row.hours_played),
    noShows: row.no_shows,
    thumbsUpPercentage: row.thumbs_up_percentage === null ? null : Number(row.thumbs_up_percentage),
  };
}

async function callEventsRoute<TResponse>(
  path: string,
  body: Record<string, unknown>,
  options?: {
    method?: 'POST' | 'PATCH';
  },
): Promise<TResponse> {
  return retryOnceAfterUnauthorized(
    async () => {
      const accessToken = useAuthStore.getState().accessToken;

      if (!accessToken) {
        throw new EdgeFunctionError('Missing authenticated session.', 'UNAUTHORIZED', 401);
      }

      const response = await fetch(`${eventsFunctionUrl}${path}`, {
        method: options?.method ?? 'POST',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      let parsedBody: EdgeFunctionFailure | { data: TResponse } | null = null;

      try {
        parsedBody = (await response.json()) as EdgeFunctionFailure | { data: TResponse };
      } catch {
        parsedBody = null;
      }

      if (!response.ok) {
        const failure = readEdgeFunctionFailure(parsedBody);

        if (response.status === 401) {
          throw {
            status: 401,
            message: failure?.message ?? 'Unauthorized.',
          };
        }

        throw new EdgeFunctionError(
          failure?.message ?? 'The server returned an unexpected response.',
          failure?.code ?? null,
          response.status,
        );
      }

      if (!parsedBody || !('data' in parsedBody) || !parsedBody.data) {
        throw new EdgeFunctionError('The server returned an unexpected response.', null, 500);
      }

      return parsedBody.data;
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
        'id, sport_id, sport_slug, sport_name_cs, sport_name_en, sport_icon, sport_color, organizer_id, organizer_first_name, organizer_last_name, organizer_photo_url, organizer_no_shows, organizer_games_played, venue_id, venue_name, venue_address, starts_at, ends_at, city, reservation_type, player_count_total, skill_min, skill_max, description, status, spots_taken, waitlist_count, no_show_window_end, chat_closed_at, viewer_membership_status, viewer_waitlist_position, created_at',
      )
      .eq('id', eventId)
      .single(),
  );

  throwIfSupabaseError(detailResult.error, 'Unable to load the event.');

  if (!detailResult.data) {
    throw new Error('Missing event detail row.');
  }

  const detailRow = detailResult.data as EventDetailRow;
  const mappedDetail = mapEventFeedRow(detailRow);

  return {
    ...mappedDetail,
    organizerLastName: detailRow.organizer_last_name,
    noShowWindowEnd: detailRow.no_show_window_end,
    chatClosedAt: detailRow.chat_closed_at,
    viewerMembershipStatus: detailRow.viewer_membership_status,
    viewerWaitlistPosition: detailRow.viewer_waitlist_position,
  };
}

export async function fetchMyUpcomingGames(): Promise<MyGamesUpcomingItem[]> {
  const result = await retrySupabaseOperationOnce(() =>
    supabase
      .from('my_games_upcoming_view')
      .select(
        'id, sport_id, sport_slug, sport_name_cs, sport_name_en, sport_icon, sport_color, organizer_id, organizer_first_name, organizer_photo_url, organizer_no_shows, organizer_games_played, venue_id, venue_name, venue_address, starts_at, ends_at, city, reservation_type, player_count_total, skill_min, skill_max, description, status, spots_taken, waitlist_count, viewer_membership_status, created_at',
      ),
  );

  throwIfSupabaseError(result.error, 'Unable to load upcoming games.');

  return ((result.data ?? []) as MyGamesUpcomingRow[]).map((row) => ({
    ...mapEventFeedRow(row),
    viewerMembershipStatus: row.viewer_membership_status,
  }));
}

export async function fetchMyPastGames(): Promise<MyGamesPastItem[]> {
  const result = await retrySupabaseOperationOnce(() =>
    supabase
      .from('my_games_past_view')
      .select(
        'id, sport_id, sport_slug, sport_name_cs, sport_name_en, sport_icon, sport_color, organizer_id, organizer_first_name, organizer_photo_url, organizer_no_shows, organizer_games_played, venue_id, venue_name, venue_address, starts_at, ends_at, city, reservation_type, player_count_total, skill_min, skill_max, description, status, spots_taken, waitlist_count, no_show_window_end, chat_closed_at, viewer_membership_status, created_at',
      ),
  );

  throwIfSupabaseError(result.error, 'Unable to load past games.');

  return ((result.data ?? []) as MyGamesPastRow[]).map((row) => ({
    ...mapEventFeedRow(row),
    noShowWindowEnd: row.no_show_window_end,
    chatClosedAt: row.chat_closed_at,
    viewerMembershipStatus: row.viewer_membership_status,
  }));
}

export async function fetchConfirmedEventPlayers(input: {
  eventId: string;
  sportId: string;
  viewerUserId?: string | null;
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
  const playerStatsByUserId = new Map<string, PlayerSportStat>();
  const alreadyThumbedUpUserIds = new Set<string>();
  const alreadyReportedNoShowUserIds = new Set<string>();

  if (playerIds.length) {
    const skillsResult = await retrySupabaseOperationOnce(() =>
      supabase
        .from('player_profile_sport_stats_view')
        .select(
          'user_id, first_name, last_name, photo_url, city, sport_id, sport_slug, sport_name_cs, sport_name_en, sport_icon, sport_color, skill_level, games_played, hours_played, no_shows, thumbs_up_games, thumbs_up_percentage, is_play_again_connection',
        )
        .eq('sport_id', input.sportId)
        .in('user_id', playerIds),
    );

    throwIfSupabaseError(skillsResult.error, 'Unable to load player sport stats.');

    for (const row of (skillsResult.data ?? []) as PlayerSportStatRow[]) {
      const mappedRow = mapPlayerSportStatRow(row);
      playerStatsByUserId.set(mappedRow.userId, mappedRow);
      playerSkillsByUserId.set(row.user_id, row.skill_level);
    }

    if (input.viewerUserId) {
      const [thumbsResult, noShowResult] = await Promise.all([
        retrySupabaseOperationOnce(() =>
          supabase
            .from('post_game_thumbs')
            .select('to_user')
            .eq('event_id', input.eventId)
            .eq('from_user', input.viewerUserId)
            .in('to_user', playerIds),
        ),
        retrySupabaseOperationOnce(() =>
          supabase
            .from('no_show_reports')
            .select('reported_user')
            .eq('event_id', input.eventId)
            .in('reported_user', playerIds),
        ),
      ]);

      throwIfSupabaseError(thumbsResult.error, 'Unable to load post-game thumbs state.');
      throwIfSupabaseError(noShowResult.error, 'Unable to load no-show report state.');

      for (const row of (thumbsResult.data ?? []) as PostGameThumbRow[]) {
        if (row.to_user) {
          alreadyThumbedUpUserIds.add(row.to_user);
        }
      }

      for (const row of (noShowResult.data ?? []) as NoShowReportRow[]) {
        if (row.reported_user) {
          alreadyReportedNoShowUserIds.add(row.reported_user);
        }
      }
    }
  }

  return playerRows.map((row) => {
    const profile = resolveProfileRelation(row.profile);
    const playerId = row.user_id ?? `deleted-${row.joined_at}`;
    const stats = row.user_id ? playerStatsByUserId.get(row.user_id) : null;

    return {
      userId: playerId,
      firstName: profile?.first_name ?? null,
      lastName: profile?.last_name ?? null,
      photoUrl: profile?.photo_url ?? null,
      skillLevel: row.user_id ? (playerSkillsByUserId.get(row.user_id) ?? null) : null,
      gamesPlayed: stats?.gamesPlayed ?? 0,
      hoursPlayed: stats?.hoursPlayed ?? 0,
      noShows: stats?.noShows ?? 0,
      thumbsUpPercentage: stats?.thumbsUpPercentage ?? null,
      isPlayAgainConnection: stats?.isPlayAgainConnection ?? false,
      alreadyThumbedUpByViewer: row.user_id ? alreadyThumbedUpUserIds.has(row.user_id) : false,
      alreadyReportedNoShow: row.user_id ? alreadyReportedNoShowUserIds.has(row.user_id) : false,
      joinedAt: row.joined_at,
    };
  });
}

export async function fetchPlayerSportStats(userId: string): Promise<PlayerSportStat[]> {
  const result = await retrySupabaseOperationOnce(() =>
    supabase
      .from('player_profile_sport_stats_view')
      .select(
        'user_id, first_name, last_name, photo_url, city, sport_id, sport_slug, sport_name_cs, sport_name_en, sport_icon, sport_color, skill_level, games_played, hours_played, no_shows, thumbs_up_games, thumbs_up_percentage, is_play_again_connection',
      )
      .eq('user_id', userId)
      .order('sport_name_en', { ascending: true }),
  );

  throwIfSupabaseError(result.error, 'Unable to load player sport stats.');

  return ((result.data ?? []) as PlayerSportStatRow[]).map(mapPlayerSportStatRow);
}

export async function fetchPlayAgainConnections(): Promise<PlayAgainConnection[]> {
  const result = await retrySupabaseOperationOnce(() =>
    supabase
      .from('play_again_connections_view')
      .select(
        'connection_user_id, first_name, last_name, photo_url, city, sport_id, sport_slug, sport_name_cs, sport_name_en, sport_icon, sport_color, skill_level, games_played, hours_played, no_shows, thumbs_up_percentage',
      )
      .order('sport_name_en', { ascending: true })
      .order('first_name', { ascending: true }),
  );

  throwIfSupabaseError(result.error, 'Unable to load play-again connections.');

  return ((result.data ?? []) as PlayAgainConnectionRow[]).map(mapPlayAgainConnectionRow);
}

export async function fetchVisibleProfile(playerId: string): Promise<VisibleProfileRow> {
  const result = await retrySupabaseOperationOnce(() =>
    supabase
      .from('profiles')
      .select('id, first_name, last_name, photo_url, city')
      .eq('id', playerId)
      .single(),
  );

  throwIfSupabaseError(result.error, 'Unable to load the player profile.');

  if (!result.data) {
    throw new Error('Missing player profile.');
  }

  return result.data as VisibleProfileRow;
}

export async function createEvent(input: CreateEventInput): Promise<CreateEventResponse> {
  return callEventsRoute<CreateEventResponse>('', {
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

export async function updateEvent(input: UpdateEventInput): Promise<UpdateEventResponse> {
  return callEventsRoute<UpdateEventResponse>(
    `/${input.eventId}`,
    {
      venue_id: input.venueId,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      reservation_type: input.reservationType,
      player_count_total: input.playerCountTotal,
      skill_min: input.skillMin,
      skill_max: input.skillMax,
      description: input.description,
    },
    {
      method: 'PATCH',
    },
  );
}

export async function joinEvent(input: JoinEventInput): Promise<JoinEventResponse> {
  return callEventsRoute<JoinEventResponse>(`/${input.eventId}/join`, {
    skill_level: input.skillLevel ?? null,
  });
}

export async function leaveEvent(input: LeaveEventInput): Promise<LeaveEventResponse> {
  return callEventsRoute<LeaveEventResponse>(`/${input.eventId}/leave`, {});
}

export async function cancelEvent(input: CancelEventInput): Promise<CancelEventResponse> {
  return callEventsRoute<CancelEventResponse>(`/${input.eventId}/cancel`, {});
}

export async function removePlayer(input: RemovePlayerInput): Promise<RemovePlayerResponse> {
  return callEventsRoute<RemovePlayerResponse>(`/${input.eventId}/remove-player`, {
    target_user_id: input.targetUserId,
  });
}

export async function reportNoShow(input: ReportNoShowInput): Promise<ReportNoShowResponse> {
  return callEventsRoute<ReportNoShowResponse>(`/${input.eventId}/no-show`, {
    reported_user_id: input.reportedUserId,
  });
}

export async function giveThumbsUp(input: GiveThumbsUpInput): Promise<GiveThumbsUpResponse> {
  return callEventsRoute<GiveThumbsUpResponse>(`/${input.eventId}/thumbs-up`, {
    to_user_id: input.toUserId,
  });
}
