import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { CURATED_CITIES, type CityName } from '../../constants/cities';
import { ScreenCard, ScreenShell } from '../../components/ScreenShell';
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

type RootNavigation = NavigationProp<RootStackParamList>;

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
  const [permissionStatus, setPermissionStatus] = useState<
    Notifications.NotificationPermissionsStatus['status']
  >(Notifications.PermissionStatus.UNDETERMINED);
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
    setPermissionStatus(permission.status);
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

  return (
    <ScreenShell title={t('shell.settings.title')} subtitle={t('shell.settings.subtitle')}>
      <ScreenCard title={t('settings.profileTitle')}>
        <NoticeBanner notice={notice} resolveMessage={t} />
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

      <ScreenCard title={t('settings.notifications.permissionTitle')}>
        <Text style={styles.bodyText}>{t('settings.notifications.permissionBody')}</Text>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>
            {t('settings.notifications.permissionStatusLabel')}
          </Text>
          <Text style={styles.detailValue}>
            {t(`settings.notifications.permissionStatus.${permissionStatus}`)}
          </Text>
        </View>
        <ActionButton
          accessibilityHint={t('settings.notifications.permissionAction')}
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
              accessibilityHint={t('events.common.retry')}
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
                  accessibilityHint={t('settings.notifications.toggleHint')}
                  accessibilityLabel={t(notificationPreferenceLabelKey(preference.type))}
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
          accessibilityHint={t('shell.settings.openAccountDeletion')}
          label={t('shell.settings.openAccountDeletion')}
          onPress={() => navigation.navigate('AccountDeletion')}
        />
        <ActionButton
          accessibilityHint={t('auth.home.logout')}
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
  detailLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: '#a0603b',
  },
  detailRow: {
    gap: 4,
  },
  detailValue: {
    fontSize: 15,
    lineHeight: 22,
    color: '#395065',
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
