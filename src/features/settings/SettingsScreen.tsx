import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { CURATED_CITIES, type CityName } from '../../constants/cities';
import { ScreenCard, ScreenShell } from '../../components/ScreenShell';
import { StateMessage } from '../../components/StateMessage';
import type { RootStackParamList } from '../../navigation/types';
import { saveProfilePreferences } from '../../services/profile';
import { signOutAndClearState } from '../../services/auth';
import {
  fetchNotificationPreferences,
  upsertNotificationPreference,
} from '../../services/notification-preferences';
import { registerPushTokenIfNeeded } from '../../services/push-notifications';
import { useAuthStore } from '../../store/auth-store';
import { useUserStore } from '../../store/user-store';
import type { AppLanguage, AppNotice } from '../../types/app';
import type { NotificationPreference, NotificationPreferenceType } from '../../types/notifications';
import {
  ActionButton,
  ChoiceChips,
  NoticeBanner,
  PickerSheet,
  SelectionField,
} from '../auth/AuthPrimitives';
import { AvatarPhoto, InfoPill } from '../events/EventPrimitives';

type RootNavigation = NavigationProp<RootStackParamList>;
type IoniconName = ComponentProps<typeof Ionicons>['name'];
type NotificationPermissionStatus =
  | Notifications.NotificationPermissionsStatus['status']
  | 'provisional';

const languageOptions: { labelKey: string; value: AppLanguage }[] = [
  { labelKey: 'auth.language.cs', value: 'cs' },
  { labelKey: 'auth.language.en', value: 'en' },
];

const settingsProfileSchema = z.object({
  language: z.enum(['cs', 'en']),
  city: z
    .string()
    .min(1, 'settings.validation.city')
    .refine((value) => CURATED_CITIES.includes(value as CityName), {
      message: 'settings.validation.city',
    }),
});

type SettingsProfileValues = z.infer<typeof settingsProfileSchema>;

function notificationPreferenceLabelKey(type: NotificationPreferenceType): string {
  return `settings.notifications.types.${type}`;
}

function notificationPreferenceIconName(type: NotificationPreferenceType): IoniconName {
  switch (type) {
    case 'player_joined':
      return 'person-add-outline';
    case 'join_confirmed':
      return 'checkmark-circle-outline';
    case 'waitlist_promoted':
      return 'arrow-up-circle-outline';
    case 'event_full':
      return 'people-outline';
    case 'chat_message':
      return 'chatbubble-ellipses-outline';
    case 'event_reminder':
      return 'alarm-outline';
    case 'event_cancelled':
      return 'close-circle-outline';
    case 'player_removed':
      return 'person-remove-outline';
  }
}

function SettingsSectionHeader({
  iconName,
  title,
  subtitle,
}: {
  iconName: IoniconName;
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionIconWrap}>
        <Ionicons color="#183153" name={iconName} size={18} />
      </View>
      <View style={styles.sectionHeaderCopy}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

function SettingsActionRow({
  iconName,
  title,
  subtitle,
  onPress,
  tone = 'neutral',
}: {
  iconName: IoniconName;
  title: string;
  subtitle: string;
  onPress: () => void | Promise<void>;
  tone?: 'neutral' | 'danger';
}) {
  return (
    <Pressable
      accessibilityHint={title}
      accessibilityLabel={title}
      accessibilityRole="button"
      onPress={() => {
        void onPress();
      }}
      style={({ pressed }) => [
        styles.actionRow,
        tone === 'danger' ? styles.actionRowDanger : undefined,
        pressed ? styles.actionRowPressed : undefined,
      ]}
    >
      <View
        style={[styles.actionIconWrap, tone === 'danger' ? styles.actionIconWrapDanger : undefined]}
      >
        <Ionicons color={tone === 'danger' ? '#b44740' : '#183153'} name={iconName} size={18} />
      </View>
      <View style={styles.actionCopy}>
        <Text
          style={[styles.actionTitle, tone === 'danger' ? styles.actionTitleDanger : undefined]}
        >
          {title}
        </Text>
        <Text style={styles.actionSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons
        color={tone === 'danger' ? '#b44740' : '#9aacbd'}
        name="chevron-forward"
        size={18}
      />
    </Pressable>
  );
}

export function SettingsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<RootNavigation>();
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.userId);
  const language = useUserStore((state) => state.language);
  const profile = useUserStore((state) => state.profile);
  const selectedCity = useUserStore((state) => state.selectedCity);
  const setLanguage = useUserStore((state) => state.setLanguage);
  const setSelectedCity = useUserStore((state) => state.setSelectedCity);
  const [notice, setNotice] = useState<AppNotice | null>(null);
  const [isCityPickerVisible, setIsCityPickerVisible] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermissionStatus>(
    Notifications.PermissionStatus.UNDETERMINED,
  );
  const settingsForm = useForm<SettingsProfileValues>({
    resolver: zodResolver(settingsProfileSchema),
    defaultValues: {
      language: profile?.language ?? language,
      city: profile?.city ?? selectedCity ?? '',
    },
  });

  const preferencesQuery = useQuery({
    queryKey: ['settings', 'notification-preferences', userId],
    queryFn: fetchNotificationPreferences,
    enabled: Boolean(userId),
    staleTime: 30_000,
  });

  useEffect(() => {
    settingsForm.reset({
      language: profile?.language ?? language,
      city: profile?.city ?? selectedCity ?? '',
    });
  }, [language, profile?.city, profile?.language, selectedCity, settingsForm]);

  const cityOptions = useMemo(
    () => CURATED_CITIES.map((city) => ({ label: city, value: city })),
    [],
  );

  async function refreshNotificationPermission() {
    const permission = await Notifications.getPermissionsAsync();
    setPermissionStatus(permission.status as NotificationPermissionStatus);
    return permission;
  }

  useEffect(() => {
    void refreshNotificationPermission();
  }, []);

  const saveProfileMutation = useMutation({
    mutationFn: async (values: SettingsProfileValues) => {
      if (!userId) {
        throw new Error('Missing user id.');
      }

      await saveProfilePreferences({
        userId,
        city: values.city,
        language: values.language,
      });
    },
    onSuccess: async (_, values) => {
      setLanguage(values.language);
      setSelectedCity(values.city as CityName);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNotice({
        messageKey: 'settings.profileSaved',
        tone: 'success',
      });
    },
    onError: async (error) => {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      setNotice({
        messageKey: message.includes('network')
          ? 'settings.profileSaveFailedNetwork'
          : 'settings.profileSaveFailed',
        tone: 'error',
      });
    },
  });

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

  const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ');
  const languageLabel = t(`auth.language.${profile?.language ?? language}`);
  const permissionLabel = t(`settings.notifications.permissionStatus.${permissionStatus}`);

  return (
    <ScreenShell title={t('shell.settings.title')} subtitle={t('shell.settings.subtitle')}>
      <ScreenCard>
        <NoticeBanner notice={notice} resolveMessage={t} />
        <View style={styles.accountHero}>
          <View style={styles.accountAvatarWrap}>
            <AvatarPhoto
              label={fullName || t('auth.home.defaultName')}
              size={72}
              uri={profile?.photoUrl ?? null}
            />
          </View>
          <View style={styles.accountCopy}>
            <Text style={styles.accountName}>{fullName || t('auth.home.defaultName')}</Text>
          </View>
        </View>
        <View style={styles.accountPillRow}>
          <InfoPill>{profile?.city ?? selectedCity ?? t('shell.common.noCity')}</InfoPill>
          <InfoPill accentColor="#183153">{languageLabel}</InfoPill>
        </View>
      </ScreenCard>

      <ScreenCard>
        <SettingsSectionHeader iconName="options-outline" title={t('settings.profileTitle')} />
        <Controller
          control={settingsForm.control}
          name="language"
          render={({ field, fieldState }) => (
            <ChoiceChips
              accessibilityHint={t('settings.languageLabel')}
              error={fieldState.error?.message ? t(fieldState.error.message) : null}
              label={t('settings.languageLabel')}
              onChange={field.onChange}
              options={languageOptions.map((option) => ({
                label: t(option.labelKey),
                value: option.value,
              }))}
              value={field.value}
            />
          )}
        />
        <Controller
          control={settingsForm.control}
          name="city"
          render={({ field, fieldState }) => (
            <>
              <SelectionField
                accessibilityHint={t('settings.cityPickerHint')}
                error={fieldState.error?.message ? t(fieldState.error.message) : null}
                label={t('settings.cityLabel')}
                onPress={() => setIsCityPickerVisible(true)}
                placeholder={t('settings.cityPlaceholder')}
                value={field.value || null}
              />
              <PickerSheet
                closeAccessibilityLabel={t('settings.closeCityPicker')}
                onClose={() => setIsCityPickerVisible(false)}
                onSelect={(value) => field.onChange(value)}
                options={cityOptions}
                selectedValue={field.value || null}
                title={t('settings.cityPickerTitle')}
                visible={isCityPickerVisible}
              />
            </>
          )}
        />
        <ActionButton
          accessibilityHint={t('settings.saveProfileAction')}
          disabled={saveProfileMutation.isPending}
          iconName="save-outline"
          label={
            saveProfileMutation.isPending
              ? t('settings.saveProfilePending')
              : t('settings.saveProfileAction')
          }
          onPress={settingsForm.handleSubmit(async (values) => {
            setNotice(null);
            await saveProfileMutation.mutateAsync(values);
          })}
        />
      </ScreenCard>

      <ScreenCard>
        <SettingsSectionHeader
          iconName="notifications-outline"
          title={t('settings.notifications.permissionTitle')}
        />
        <View style={styles.permissionPanel}>
          <View style={styles.permissionPanelCopy}>
            <Text style={styles.detailLabel}>
              {t('settings.notifications.permissionStatusLabel')}
            </Text>
            <Text style={styles.detailValue}>{permissionLabel}</Text>
          </View>
          <View
            style={[
              styles.permissionBadge,
              permissionStatus === 'granted'
                ? styles.permissionBadgeReady
                : permissionStatus === 'provisional'
                  ? styles.permissionBadgeQuiet
                  : styles.permissionBadgeBlocked,
            ]}
          >
            <Text
              style={[
                styles.permissionBadgeText,
                permissionStatus === 'granted'
                  ? styles.permissionBadgeTextReady
                  : permissionStatus === 'provisional'
                    ? styles.permissionBadgeTextQuiet
                    : styles.permissionBadgeTextBlocked,
              ]}
            >
              {permissionLabel}
            </Text>
          </View>
        </View>
        <Text style={styles.bodyText}>{t('settings.notifications.permissionBody')}</Text>
        <ActionButton
          accessibilityHint={t('settings.notifications.permissionAction')}
          iconName={
            permissionStatus === 'granted' ? 'checkmark-circle-outline' : 'notifications-outline'
          }
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
          <StateMessage
            action={
              <ActionButton
                accessibilityHint={t('events.common.retry')}
                iconName="refresh-outline"
                label={t('events.common.retry')}
                onPress={async () => {
                  await preferencesQuery.refetch();
                }}
                variant="secondary"
              />
            }
            body={t('settings.notifications.loadFailed')}
            compact
            iconName="notifications-off-outline"
            title={t('common.tryAgainTitle')}
            tone="muted"
          />
        ) : (
          <View style={styles.preferenceList}>
            {(preferencesQuery.data ?? []).map((preference) => (
              <View key={preference.type} style={styles.preferenceRow}>
                <View style={styles.preferenceIconWrap}>
                  <Ionicons
                    color="#183153"
                    name={notificationPreferenceIconName(preference.type)}
                    size={18}
                  />
                </View>
                <View style={styles.preferenceCopy}>
                  <Text style={styles.preferenceLabel}>
                    {t(notificationPreferenceLabelKey(preference.type))}
                  </Text>
                </View>
                <Switch
                  accessibilityHint={t('settings.notifications.toggleHint')}
                  accessibilityLabel={t(notificationPreferenceLabelKey(preference.type))}
                  disabled={togglePreferenceMutation.isPending}
                  ios_backgroundColor="#d8cab7"
                  onValueChange={(nextValue) => {
                    void togglePreferenceMutation.mutateAsync({
                      type: preference.type,
                      isEnabled: nextValue,
                    });
                  }}
                  thumbColor="#fffaf3"
                  trackColor={{ false: '#d8cab7', true: '#183153' }}
                  value={preference.isEnabled}
                />
              </View>
            ))}
          </View>
        )}
      </ScreenCard>

      <ScreenCard>
        <SettingsSectionHeader
          iconName="shield-checkmark-outline"
          subtitle={t('settings.accountSubtitle')}
          title={t('settings.accountTitle')}
        />
        <View style={styles.actionList}>
          <SettingsActionRow
            iconName="log-out-outline"
            onPress={signOutAndClearState}
            subtitle={t('settings.account.logoutSubtitle')}
            title={t('settings.account.logoutTitle')}
          />
          <SettingsActionRow
            iconName="trash-outline"
            onPress={() => navigation.navigate('AccountDeletion')}
            subtitle={t('settings.account.deleteSubtitle')}
            title={t('settings.account.deleteTitle')}
            tone="danger"
          />
        </View>
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
  accountHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  accountAvatarWrap: {
    padding: 5,
    borderRadius: 999,
    backgroundColor: '#eef3f8',
  },
  accountCopy: {
    flex: 1,
    gap: 4,
  },
  accountName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#183153',
  },
  accountPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sectionIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef3f8',
  },
  sectionHeaderCopy: {
    flex: 1,
    gap: 2,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#183153',
  },
  sectionSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#5a6475',
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: '#a0603b',
  },
  detailValue: {
    fontSize: 15,
    lineHeight: 22,
    color: '#395065',
    fontWeight: '700',
  },
  permissionPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: '#f8f1e6',
  },
  permissionPanelCopy: {
    flex: 1,
    gap: 4,
  },
  permissionBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
  },
  permissionBadgeReady: {
    backgroundColor: '#ebf6ef',
    borderColor: '#b7d8c2',
  },
  permissionBadgeQuiet: {
    backgroundColor: '#eef4fa',
    borderColor: '#c9d9e8',
  },
  permissionBadgeBlocked: {
    backgroundColor: '#fdeceb',
    borderColor: '#f1b9b6',
  },
  permissionBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  permissionBadgeTextReady: {
    color: '#2f6b47',
  },
  permissionBadgeTextQuiet: {
    color: '#37536e',
  },
  permissionBadgeTextBlocked: {
    color: '#a33d37',
  },
  preferenceList: {
    gap: 12,
  },
  preferenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#eadfce',
    backgroundColor: '#fffaf5',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  preferenceIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef3f8',
  },
  preferenceCopy: {
    flex: 1,
    paddingRight: 8,
  },
  preferenceLabel: {
    fontSize: 15,
    lineHeight: 22,
    color: '#183153',
    fontWeight: '600',
  },
  actionList: {
    gap: 12,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#eadfce',
    backgroundColor: '#fffaf5',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  actionRowDanger: {
    borderColor: '#f0d0cb',
    backgroundColor: '#fff4f3',
  },
  actionRowPressed: {
    opacity: 0.9,
  },
  actionIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef3f8',
  },
  actionIconWrapDanger: {
    backgroundColor: '#fdeceb',
  },
  actionCopy: {
    flex: 1,
    gap: 3,
  },
  actionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#183153',
  },
  actionTitleDanger: {
    color: '#8f332d',
  },
  actionSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: '#5a6475',
  },
});
