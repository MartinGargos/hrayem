import { Platform } from 'react-native';

import type { CityName } from '../constants/cities';
import type { AppLanguage, UserProfile } from '../types/app';
import { throwIfSupabaseError } from '../utils/supabase';
import { retrySupabaseOperationOnce, supabase } from './supabase';

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  photo_url: string | null;
  city: CityName | null;
  language: AppLanguage;
  latitude: number | null;
  longitude: number | null;
  profile_complete: boolean;
};

type AppConfigRow = {
  key: string;
  value: string;
};

export function mapProfileRowToUserProfile(profile: ProfileRow): UserProfile {
  return {
    id: profile.id,
    firstName: profile.first_name,
    lastName: profile.last_name,
    photoUrl: profile.photo_url,
    city: profile.city,
    language: profile.language,
    latitude: profile.latitude,
    longitude: profile.longitude,
    profileComplete: profile.profile_complete,
  };
}

export async function fetchCurrentUserProfile(userId: string): Promise<UserProfile> {
  const result = await retrySupabaseOperationOnce(() =>
    supabase
      .from('profiles')
      .select(
        'id, first_name, last_name, photo_url, city, language, latitude, longitude, profile_complete',
      )
      .eq('id', userId)
      .single(),
  );

  throwIfSupabaseError(result.error, 'Unable to load the profile.');

  if (!result.data) {
    throw new Error('Missing profile record.');
  }

  return mapProfileRowToUserProfile(result.data as ProfileRow);
}

export async function fetchMinimumSupportedVersion(): Promise<string> {
  const minimumVersionKey =
    Platform.OS === 'ios' ? 'minimum_app_version_ios' : 'minimum_app_version_android';

  const result = await retrySupabaseOperationOnce(() =>
    supabase.from('app_config').select('key, value').eq('key', minimumVersionKey).single(),
  );

  throwIfSupabaseError(result.error, 'Unable to load the minimum app version.');

  const row = result.data as AppConfigRow | null;

  if (!row?.value) {
    throw new Error('Missing minimum app version.');
  }

  return row.value;
}

export async function hasAcceptedConsentVersions(
  userId: string,
  termsVersion: string,
  privacyVersion: string,
): Promise<boolean> {
  const result = await retrySupabaseOperationOnce(() =>
    supabase
      .from('consent_log')
      .select('id')
      .eq('user_id', userId)
      .eq('terms_version', termsVersion)
      .eq('privacy_version', privacyVersion)
      .limit(1),
  );

  throwIfSupabaseError(result.error, 'Unable to load the consent state.');

  const rows = (result.data ?? []) as { id: string }[];

  return rows.length > 0;
}

export async function acceptCurrentConsent(
  userId: string,
  termsVersion: string,
  privacyVersion: string,
): Promise<void> {
  const result = await retrySupabaseOperationOnce(() =>
    supabase.from('consent_log').insert({
      user_id: userId,
      terms_version: termsVersion,
      privacy_version: privacyVersion,
    }),
  );

  throwIfSupabaseError(result.error, 'Unable to record consent.');
}
