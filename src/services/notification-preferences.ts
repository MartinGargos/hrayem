import { retrySupabaseOperationOnce, supabase } from './supabase';
import { throwIfSupabaseError } from '../utils/supabase';
import {
  notificationPreferenceTypes,
  type NotificationPreference,
  type NotificationPreferenceType,
} from '../types/notifications';

type NotificationPreferenceRow = {
  type: NotificationPreferenceType;
  is_enabled: boolean;
};

export async function fetchNotificationPreferences(): Promise<NotificationPreference[]> {
  const result = await retrySupabaseOperationOnce(() =>
    supabase.from('notification_preferences').select('type, is_enabled'),
  );

  throwIfSupabaseError(result.error, 'Unable to load notification preferences.');

  const rows = (result.data ?? []) as NotificationPreferenceRow[];
  const byType = new Map(rows.map((row) => [row.type, row.is_enabled]));

  return notificationPreferenceTypes.map((type) => ({
    type,
    isEnabled: byType.get(type) ?? true,
  }));
}

export async function upsertNotificationPreference(
  input: NotificationPreference & { userId: string },
): Promise<void> {
  const result = await retrySupabaseOperationOnce(() =>
    supabase.from('notification_preferences').upsert(
      {
        user_id: input.userId,
        type: input.type,
        is_enabled: input.isEnabled,
      },
      {
        onConflict: 'user_id,type',
      },
    ),
  );

  throwIfSupabaseError(result.error, 'Unable to save notification preferences.');
}
