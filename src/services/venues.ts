import { throwIfSupabaseError } from '../utils/supabase';
import type { VenueSummary } from '../types/events';
import { retrySupabaseOperationOnce, supabase } from './supabase';

type VenueRow = {
  id: string;
  name: string;
  city: string;
  address: string | null;
  created_by: string | null;
  is_verified: boolean;
};

const USER_HIDDEN_VENUE_PATTERNS = [
  /\bmilestone\b/i,
  /\bverifier\b/i,
  /\bplaceholder\b/i,
  /\bdummy\b/i,
  /\bdelete venue\b/i,
  /\bdelete lane\b/i,
  /\btest venue\b/i,
  /^\s*m\d+\s+delete venue\b/i,
  /^\s*test\b/i,
  /^\s*venue\b/i,
  /^\s*asdf\b/i,
  /^\s*qwe\b/i,
  /^\s*xxx+\b/i,
];

function normalizeVenueText(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? '';
  return normalized ? normalized : null;
}

function isUserFacingVenue(venue: VenueSummary): boolean {
  const normalizedName = normalizeVenueText(venue.name);
  const normalizedAddress = normalizeVenueText(venue.address);
  const searchableText = `${normalizedName ?? ''} ${normalizedAddress ?? ''}`.trim();

  if (!normalizedName) {
    return false;
  }

  if (normalizedName.length < 4 || /^[0-9\W_]+$/.test(normalizedName)) {
    return false;
  }

  return !USER_HIDDEN_VENUE_PATTERNS.some((pattern) => pattern.test(searchableText));
}

function mapVenueRow(row: VenueRow): VenueSummary {
  return {
    id: row.id,
    name: normalizeVenueText(row.name) ?? row.name,
    city: row.city,
    address: normalizeVenueText(row.address),
    createdBy: row.created_by,
    isVerified: row.is_verified,
  };
}

export async function fetchVenueMatches(input: {
  city: string;
  search: string;
  limit?: number;
}): Promise<VenueSummary[]> {
  const limit = input.limit ?? 8;
  const requestedLimit = Math.min(limit * 3, 24);
  const trimmedSearch = input.search.trim();

  let query = supabase
    .from('venues')
    .select('id, name, city, address, created_by, is_verified')
    .eq('city', input.city)
    .order('is_verified', { ascending: false })
    .order('name', { ascending: true })
    .limit(requestedLimit);

  if (trimmedSearch) {
    query = query.ilike('name', `%${trimmedSearch}%`);
  }

  const result = await retrySupabaseOperationOnce(() => query);

  throwIfSupabaseError(result.error, 'Unable to load venue matches.');

  const seenKeys = new Set<string>();

  return ((result.data ?? []) as VenueRow[])
    .map(mapVenueRow)
    .filter((venue) => isUserFacingVenue(venue))
    .filter((venue) => {
      const dedupeKey = `${venue.name.toLocaleLowerCase()}::${venue.address?.toLocaleLowerCase() ?? ''}`;

      if (seenKeys.has(dedupeKey)) {
        return false;
      }

      seenKeys.add(dedupeKey);
      return true;
    })
    .slice(0, limit);
}

export async function createVenue(input: {
  name: string;
  city: string;
  address?: string | null;
  createdBy: string;
}): Promise<VenueSummary> {
  const result = await retrySupabaseOperationOnce(() =>
    supabase
      .from('venues')
      .insert({
        name: input.name.trim(),
        city: input.city,
        address: input.address?.trim() ? input.address.trim() : null,
        created_by: input.createdBy,
      })
      .select('id, name, city, address, created_by, is_verified')
      .single(),
  );

  throwIfSupabaseError(result.error, 'Unable to create the venue.');

  if (!result.data) {
    throw new Error('Missing venue after insert.');
  }

  return mapVenueRow(result.data as VenueRow);
}
