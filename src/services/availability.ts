import { eachDayOfInterval, formatISO, startOfDay } from 'date-fns';

import type { CityName } from '../constants/cities';
import { retrySupabaseOperationOnce, supabase } from './supabase';
import type {
  AvailabilityFeedItem,
  AvailabilityRow,
  AvailabilityTimePreference,
} from '../types/availability';
import { throwIfSupabaseError } from '../utils/supabase';

type AvailabilityRowRecord = {
  id: string;
  user_id: string;
  sport_id: string;
  city: CityName;
  available_date: string;
  time_pref: AvailabilityTimePreference;
  note: string | null;
  created_at: string;
};

type PlayerSportStatRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  photo_url: string | null;
  city: CityName | null;
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
  is_play_again_connection: boolean;
};

function mapAvailabilityRow(row: AvailabilityRowRecord): AvailabilityRow {
  return {
    id: row.id,
    userId: row.user_id,
    sportId: row.sport_id,
    city: row.city,
    availableDate: row.available_date,
    timePreference: row.time_pref,
    note: row.note,
    createdAt: row.created_at,
  };
}

function availabilityGroupKey(input: {
  userId: string;
  sportId: string;
  timePreference: AvailabilityTimePreference;
  note: string | null;
}): string {
  return [input.userId, input.sportId, input.timePreference ?? '', input.note ?? ''].join('::');
}

export function expandAvailabilityDates(input: { startDate: Date; endDate: Date }): string[] {
  return eachDayOfInterval({
    start: startOfDay(input.startDate),
    end: startOfDay(input.endDate),
  }).map((value) => formatISO(value, { representation: 'date' }));
}

export async function fetchOwnAvailability(): Promise<AvailabilityRow[]> {
  const today = formatISO(startOfDay(new Date()), { representation: 'date' });
  const result = await retrySupabaseOperationOnce(() =>
    supabase
      .from('player_availability')
      .select('id, user_id, sport_id, city, available_date, time_pref, note, created_at')
      .gte('available_date', today)
      .order('available_date', { ascending: true }),
  );

  throwIfSupabaseError(result.error, 'Unable to load your availability.');

  return ((result.data ?? []) as AvailabilityRowRecord[]).map(mapAvailabilityRow);
}

export async function upsertOwnAvailability(input: {
  userId: string;
  sportId: string;
  city: CityName;
  availableDates: string[];
  timePreference: AvailabilityTimePreference;
  note: string | null;
}): Promise<AvailabilityRow[]> {
  const rows = input.availableDates.map((availableDate) => ({
    user_id: input.userId,
    sport_id: input.sportId,
    city: input.city,
    available_date: availableDate,
    time_pref: input.timePreference,
    note: input.note,
  }));

  const result = await retrySupabaseOperationOnce(() =>
    supabase
      .from('player_availability')
      .upsert(rows, {
        onConflict: 'user_id,sport_id,available_date',
      })
      .select('id, user_id, sport_id, city, available_date, time_pref, note, created_at'),
  );

  throwIfSupabaseError(result.error, 'Unable to save availability.');

  return ((result.data ?? []) as AvailabilityRowRecord[]).map(mapAvailabilityRow);
}

export async function deleteOwnAvailability(ids: string[]): Promise<void> {
  if (!ids.length) {
    return;
  }

  const result = await retrySupabaseOperationOnce(() =>
    supabase.from('player_availability').delete().in('id', ids),
  );

  throwIfSupabaseError(result.error, 'Unable to delete availability.');
}

export async function fetchAvailablePlayersFeed(input: {
  city: CityName;
  sportIds?: string[];
  availableDateFrom?: string;
  availableDateTo?: string;
  viewerUserId?: string | null;
}): Promise<AvailabilityFeedItem[]> {
  const today = formatISO(startOfDay(new Date()), { representation: 'date' });
  const availableDateFrom = input.availableDateFrom ?? today;
  let availabilityQuery = supabase
    .from('player_availability')
    .select('id, user_id, sport_id, city, available_date, time_pref, note, created_at')
    .eq('city', input.city)
    .gte('available_date', availableDateFrom)
    .order('available_date', { ascending: true })
    .order('created_at', { ascending: true });

  if (input.availableDateTo) {
    availabilityQuery = availabilityQuery.lte('available_date', input.availableDateTo);
  }

  if (input.sportIds?.length) {
    availabilityQuery = availabilityQuery.in('sport_id', input.sportIds);
  }

  if (input.viewerUserId) {
    availabilityQuery = availabilityQuery.neq('user_id', input.viewerUserId);
  }

  const availabilityResult = await retrySupabaseOperationOnce(() => availabilityQuery);

  throwIfSupabaseError(availabilityResult.error, 'Unable to load available players.');

  const availabilityRows = (availabilityResult.data ?? []) as AvailabilityRowRecord[];

  if (!availabilityRows.length) {
    return [];
  }

  const userIds = [...new Set(availabilityRows.map((row) => row.user_id))];
  const sportIds = [...new Set(availabilityRows.map((row) => row.sport_id))];

  const statsResult = await retrySupabaseOperationOnce(() =>
    supabase
      .from('player_profile_sport_stats_view')
      .select(
        'user_id, first_name, last_name, photo_url, city, sport_id, sport_slug, sport_name_cs, sport_name_en, sport_icon, sport_color, skill_level, games_played, hours_played, no_shows, thumbs_up_percentage, is_play_again_connection',
      )
      .in('user_id', userIds)
      .in('sport_id', sportIds),
  );

  throwIfSupabaseError(statsResult.error, 'Unable to load available player stats.');

  const statsByPair = new Map<string, PlayerSportStatRow>();

  for (const row of (statsResult.data ?? []) as PlayerSportStatRow[]) {
    statsByPair.set(`${row.user_id}::${row.sport_id}`, row);
  }

  const grouped = new Map<string, AvailabilityFeedItem>();

  for (const row of availabilityRows) {
    const stats = statsByPair.get(`${row.user_id}::${row.sport_id}`);

    if (!stats) {
      continue;
    }

    const key = availabilityGroupKey({
      userId: row.user_id,
      sportId: row.sport_id,
      timePreference: row.time_pref,
      note: row.note,
    });
    const existingGroup = grouped.get(key);

    if (existingGroup) {
      existingGroup.availableDates.push(row.available_date);
      continue;
    }

    grouped.set(key, {
      userId: row.user_id,
      firstName: stats.first_name,
      lastName: stats.last_name,
      photoUrl: stats.photo_url,
      city: stats.city,
      sportId: stats.sport_id,
      sportSlug: stats.sport_slug,
      sportNameCs: stats.sport_name_cs,
      sportNameEn: stats.sport_name_en,
      sportIcon: stats.sport_icon,
      sportColor: stats.sport_color,
      skillLevel: stats.skill_level,
      gamesPlayed: stats.games_played,
      hoursPlayed: Number(stats.hours_played),
      noShows: stats.no_shows,
      thumbsUpPercentage:
        stats.thumbs_up_percentage === null ? null : Number(stats.thumbs_up_percentage),
      isPlayAgainConnection: stats.is_play_again_connection,
      availableDates: [row.available_date],
      timePreference: row.time_pref,
      note: row.note,
    });
  }

  return [...grouped.values()]
    .map((item) => ({
      ...item,
      availableDates: [...item.availableDates].sort(),
    }))
    .sort((left, right) => {
      const leftDate = left.availableDates[0] ?? '';
      const rightDate = right.availableDates[0] ?? '';

      if (leftDate !== rightDate) {
        return leftDate.localeCompare(rightDate);
      }

      return right.gamesPlayed - left.gamesPlayed;
    });
}
