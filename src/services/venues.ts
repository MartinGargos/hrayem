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

function mapVenueRow(row: VenueRow): VenueSummary {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    address: row.address,
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
  const trimmedSearch = input.search.trim();

  let query = supabase
    .from('venues')
    .select('id, name, city, address, created_by, is_verified')
    .eq('city', input.city)
    .order('name', { ascending: true })
    .limit(limit);

  if (trimmedSearch) {
    query = query.ilike('name', `%${trimmedSearch}%`);
  }

  const result = await retrySupabaseOperationOnce(() => query);

  throwIfSupabaseError(result.error, 'Unable to load venue matches.');

  return ((result.data ?? []) as VenueRow[]).map(mapVenueRow);
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
