import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { DetailRow, ScreenCard, ScreenShell } from '../../components/ScreenShell';
import type { RootStackParamList } from '../../navigation/types';
import { signOutAndClearState } from '../../services/auth';
import {
  fetchNotificationPreferences,
  upsertNotificationPreference,
} from '../../services/notification-preferences';
import { registerPushTokenIfNeeded } from '../../services/push-notifications';
import { useAuthStore } from '../../store/auth-store';
import { useUserStore } from '../../store/user-store';
import type { AppNotice } from '../../types/app';
import type { NotificationPreference, NotificationPreferenceType } from '../../types/notifications';
import { NoticeBanner, ActionButton } from '../auth/AuthPrimitives';

type RootNavigation = NavigationProp<RootStackParamList>;

function notificationPreferenceLabelKey(type: NotificationPreferenceType): string {
  return `settings.notifications.types.${type}`;
}

export function SettingsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<RootNavigation>();
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.userId);
  const language = useUserStore((state) => state.language);
  const profile = useUserStore((state) => state.profile);
  const selectedCity = useUserStore((state) => state.selectedCity);
  const [notice, setNotice] = useState<AppNotice | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<
    Notifications.NotificationPermissionsStatus['status']
  >(Notifications.PermissionStatus.UNDETERMINED);

  const preferencesQuery = useQuery({
    queryKey: ['settings', 'notification-preferences', userId],
    queryFn: fetchNotificationPreferences,
    enabled: Boolean(userId),
    staleTime: 30_000,
  });

  async function refreshNotificationPermission() {
    const permission = await Notifications.getPermissionsAsync();
    setPermissionStatus(permission.status);
    return permission;
  }

  useEffect(() => {
    void refreshNotificationPermission();
  }, []);

  const togglePreferenceMutation = useMutation({
    mutationFn: async (input: NotificationPreference) => {
      if (!userId) {
        throw new Error('Missing user id.');
      }

      return upsertNotificationPreference({
        userId,
        type: input.type,
        isEnabled: input.isEnabled,
      });
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        queryKey: ['settings', 'notification-preferences', userId],
      });
      const previous = queryClient.getQueryData<NotificationPreference[]>([
        'settings',
        'notification-preferences',
        userId,
      ]);

      queryClient.setQueryData<NotificationPreference[]>(
        ['settings', 'notification-preferences', userId],
        (current) =>
          (current ?? []).map((preference) =>
            preference.type === input.type
              ? {
                  ...preference,
                  isEnabled: input.isEnabled,
                }
              : preference,
          ),
      );

      return {
        previous,
      };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          ['settings', 'notification-preferences', userId],
          context.previous,
        );
      }

      setNotice({
        messageKey: 'settings.notifications.saveFailed',
        tone: 'error',
      });
    },
    onSuccess: async () => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setNotice(null);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['settings', 'notification-preferences', userId],
      });
    },
  });

  async function handleEnableNotifications() {
    try {
      const token = await registerPushTokenIfNeeded();
      const latestPermission = await refreshNotificationPermission();

      setNotice({
        messageKey:
          token || latestPermission.status === 'granted'
            ? 'settings.notifications.permissionReady'
            : latestPermission.canAskAgain
              ? 'settings.notifications.permissionUnavailable'
              : 'settings.notifications.permissionDenied',
        tone: token ? 'success' : 'info',
      });
    } catch {
      setNotice({
        messageKey: 'settings.notifications.permissionFailed',
        tone: 'error',
      });
    }
  }

  const cityValue = profile?.city ?? selectedCity ?? t('shell.common.noCity');

  return (
    <ScreenShell title={t('shell.settings.title')} subtitle={t('shell.settings.subtitle')}>
      <ScreenCard title={t('settings.profileTitle')}>
        <DetailRow label={t('settings.languageLabel')} value={t(`auth.language.${language}`)} />
        <DetailRow label={t('settings.cityLabel')} value={cityValue} />
      </ScreenCard>

      <ScreenCard title={t('settings.notifications.permissionTitle')}>
        <NoticeBanner notice={notice} resolveMessage={t} />
        <Text style={styles.bodyText}>{t('settings.notifications.permissionBody')}</Text>
        <DetailRow
          label={t('settings.notifications.permissionStatusLabel')}
          value={t(`settings.notifications.permissionStatus.${permissionStatus}`)}
        />
        <ActionButton
          label={t('settings.notifications.permissionAction')}
          onPress={handleEnableNotifications}
          variant={permissionStatus === 'granted' ? 'secondary' : 'primary'}
        />
      </ScreenCard>

      <ScreenCard title={t('settings.notifications.preferencesTitle')}>
        {preferencesQuery.isPending ? (
          <View style={styles.centeredBlock}>
            <ActivityIndicator color="#183153" />
          </View>
        ) : preferencesQuery.isError ? (
          <>
            <Text style={styles.bodyText}>{t('settings.notifications.loadFailed')}</Text>
            <ActionButton
              label={t('events.common.retry')}
              onPress={async () => {
                await preferencesQuery.refetch();
              }}
            />
          </>
        ) : (
          <View style={styles.preferenceList}>
            {(preferencesQuery.data ?? []).map((preference) => (
              <View key={preference.type} style={styles.preferenceRow}>
                <View style={styles.preferenceCopy}>
                  <Text style={styles.preferenceLabel}>
                    {t(notificationPreferenceLabelKey(preference.type))}
                  </Text>
                </View>
                <Switch
                  onValueChange={(nextValue) => {
                    void togglePreferenceMutation.mutateAsync({
                      type: preference.type,
                      isEnabled: nextValue,
                    });
                  }}
                  value={preference.isEnabled}
                />
              </View>
            ))}
          </View>
        )}
      </ScreenCard>

      <ScreenCard title={t('shell.settings.title')}>
        <ActionButton
          label={t('shell.settings.openAccountDeletion')}
          onPress={() => navigation.navigate('AccountDeletion')}
        />
        <ActionButton
          label={t('auth.home.logout')}
          onPress={signOutAndClearState}
          variant="secondary"
        />
      </ScreenCard>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  bodyText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#395065',
  },
  centeredBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  preferenceCopy: {
    flex: 1,
    paddingRight: 12,
  },
  preferenceLabel: {
    fontSize: 15,
    lineHeight: 22,
    color: '#183153',
    fontWeight: '600',
  },
  preferenceList: {
    gap: 14,
  },
  preferenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#eadfce',
    backgroundColor: '#fffdf8',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
});
