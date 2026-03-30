export const notificationPreferenceTypes = [
  'player_joined',
  'join_confirmed',
  'waitlist_promoted',
  'event_full',
  'chat_message',
  'event_reminder',
  'event_cancelled',
  'player_removed',
] as const;

export type NotificationPreferenceType = (typeof notificationPreferenceTypes)[number];

export type NotificationPreference = {
  type: NotificationPreferenceType;
  isEnabled: boolean;
};
