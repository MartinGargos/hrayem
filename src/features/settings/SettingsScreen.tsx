import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import { CURATED_CITIES, type CityName } from '../../constants/cities';
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
import { ActionButton, NoticeBanner, PickerSheet } from '../auth/AuthPrimitives';
import { AvatarPhoto } from '../events/EventPrimitives';

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

function SettingsSectionHeader({ iconName, title }: { iconName: IoniconName; title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionIconWrap}>
        <Ionicons color="#06142a" name={iconName} size={17} />
      </View>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function SettingsActionRow({
  title,
  subtitle,
  onPress,
  tone = 'neutral',
}: {
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
      style={({ pressed }) => [styles.actionRow, pressed ? styles.actionRowPressed : undefined]}
    >
      <View style={styles.actionCopy}>
        <Text
          style={[styles.actionTitle, tone === 'danger' ? styles.actionTitleDanger : undefined]}
        >
          {title}
        </Text>
        <Text style={styles.actionSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons
        color={tone === 'danger' ? '#ff5f45' : '#a3acb7'}
        name="chevron-forward"
        size={16}
      />
    </Pressable>
  );
}

function SettingsAvatar({ fullName, photoUrl }: { fullName: string; photoUrl?: string | null }) {
  const fallback = fullName.trim().slice(0, 1).toUpperCase() || '?';

  if (photoUrl) {
    return <AvatarPhoto label={fullName} size={58} uri={photoUrl} />;
  }

  return (
    <View accessibilityLabel={fullName} style={styles.settingsAvatar}>
      <Text style={styles.settingsAvatarText}>{fallback}</Text>
    </View>
  );
}

function SettingsPill({ label }: { label: string }) {
  return (
    <View style={styles.settingsPill}>
      <Text numberOfLines={1} style={styles.settingsPillLabel}>
        {label}
      </Text>
    </View>
  );
}

export function SettingsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<RootNavigation>();
  const isScreenFocused = useIsFocused();
  const insets = useSafeAreaInsets();
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
  const resolvedFullName = fullName || t('auth.home.defaultName');
  const languageLabel = t(`auth.language.${profile?.language ?? language}`);
  const permissionLabel = t(`settings.notifications.permissionStatus.${permissionStatus}`);
  const shouldShowPermissionPrompt =
    permissionStatus !== 'granted' && permissionStatus !== 'provisional';
  const bottomPadding = Math.max(insets.bottom, 16) + 126;

  function handleGoBack() {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    navigation.navigate('MainTabs', {
      screen: 'ProfileTab',
      params: {
        screen: 'ProfileHome',
      },
    });
  }

  return (
    <ScrollView
      contentContainerStyle={[
        styles.settingsContent,
        {
          paddingTop: insets.top + 14,
          paddingBottom: bottomPadding,
        },
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      style={styles.settingsScreen}
    >
      {isScreenFocused ? <StatusBar style="dark" /> : null}
      <View style={styles.topBar}>
        <Pressable
          accessibilityHint={t('navigation.titles.profile')}
          accessibilityLabel={t('settings.backAction')}
          accessibilityRole="button"
          onPress={handleGoBack}
          style={({ pressed }) => [styles.backButton, pressed ? styles.backButtonPressed : null]}
        >
          <Ionicons color="#06142a" name="chevron-back" size={26} />
        </Pressable>
        <Text style={styles.topBarTitle}>{t('navigation.titles.settings')}</Text>
        <View style={styles.topBarSpacer} />
      </View>

      <View style={styles.settingsHero}>
        <View pointerEvents="none" style={styles.settingsHeroGrid}>
          <View style={[styles.settingsHeroGridLine, styles.settingsHeroGridLineVerticalOne]} />
          <View style={[styles.settingsHeroGridLine, styles.settingsHeroGridLineVerticalTwo]} />
          <View style={[styles.settingsHeroGridLine, styles.settingsHeroGridLineHorizontal]} />
        </View>
        <Text style={styles.settingsHeroTitle}>{t('navigation.titles.settings')}</Text>
        <Text style={styles.settingsHeroSubtitle}>{t('shell.settings.subtitle')}</Text>
      </View>

      <NoticeBanner notice={notice} resolveMessage={t} />

      <View style={styles.profileCard}>
        <SettingsAvatar fullName={resolvedFullName} photoUrl={profile?.photoUrl ?? null} />
        <View style={styles.profileCopy}>
          <Text numberOfLines={1} style={styles.profileName}>
            {resolvedFullName}
          </Text>
          <View style={styles.profilePillRow}>
            <SettingsPill label={profile?.city ?? selectedCity ?? t('shell.common.noCity')} />
            <SettingsPill label={languageLabel} />
          </View>
        </View>
      </View>

      <View style={styles.settingsCard}>
        <SettingsSectionHeader iconName="options-outline" title={t('settings.profileTitle')} />
        <Controller
          control={settingsForm.control}
          name="language"
          render={({ field, fieldState }) => (
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{t('settings.languageLabel')}</Text>
              <View style={styles.languageChipRow}>
                {languageOptions.map((option) => {
                  const selected = field.value === option.value;

                  return (
                    <Pressable
                      accessibilityHint={t(option.labelKey)}
                      accessibilityLabel={t(option.labelKey)}
                      accessibilityRole="button"
                      key={option.value}
                      onPress={() => field.onChange(option.value)}
                      style={({ pressed }) => [
                        styles.languageChip,
                        selected ? styles.languageChipSelected : undefined,
                        pressed ? styles.languageChipPressed : undefined,
                      ]}
                    >
                      <Text
                        style={[
                          styles.languageChipLabel,
                          selected ? styles.languageChipLabelSelected : undefined,
                        ]}
                      >
                        {t(option.labelKey)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {fieldState.error?.message ? (
                <Text style={styles.fieldError}>{t(fieldState.error.message)}</Text>
              ) : null}
            </View>
          )}
        />
        <Controller
          control={settingsForm.control}
          name="city"
          render={({ field, fieldState }) => (
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{t('settings.cityLabel')}</Text>
              <Pressable
                accessibilityHint={t('settings.cityPickerHint')}
                accessibilityLabel={t('settings.cityLabel')}
                accessibilityRole="button"
                onPress={() => setIsCityPickerVisible(true)}
                style={({ pressed }) => [
                  styles.cityField,
                  pressed ? styles.cityFieldPressed : undefined,
                  fieldState.error ? styles.cityFieldError : undefined,
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.cityFieldText, !field.value ? styles.cityFieldPlaceholder : null]}
                >
                  {field.value || t('settings.cityPlaceholder')}
                </Text>
              </Pressable>
              {fieldState.error?.message ? (
                <Text style={styles.fieldError}>{t(fieldState.error.message)}</Text>
              ) : null}
              <PickerSheet
                closeAccessibilityLabel={t('settings.closeCityPicker')}
                onClose={() => setIsCityPickerVisible(false)}
                onSelect={(value) => field.onChange(value)}
                options={cityOptions}
                selectedValue={field.value || null}
                title={t('settings.cityPickerTitle')}
                visible={isCityPickerVisible}
              />
            </View>
          )}
        />
        <Pressable
          accessibilityHint={t('settings.saveProfileAction')}
          accessibilityLabel={t('settings.saveProfileAction')}
          accessibilityRole="button"
          disabled={saveProfileMutation.isPending}
          onPress={settingsForm.handleSubmit(async (values) => {
            setNotice(null);
            await saveProfileMutation.mutateAsync(values);
          })}
          style={({ pressed }) => [
            styles.saveButton,
            saveProfileMutation.isPending ? styles.saveButtonDisabled : undefined,
            pressed && !saveProfileMutation.isPending ? styles.saveButtonPressed : undefined,
          ]}
        >
          <Text style={styles.saveButtonLabel}>
            {saveProfileMutation.isPending
              ? t('settings.saveProfilePending')
              : t('settings.saveProfileAction')}
          </Text>
        </Pressable>
      </View>

      <View style={styles.settingsCard}>
        <SettingsSectionHeader
          iconName="notifications-outline"
          title={t('settings.notifications.title')}
        />
        {shouldShowPermissionPrompt ? (
          <Pressable
            accessibilityHint={t('settings.notifications.permissionAction')}
            accessibilityLabel={t('settings.notifications.permissionAction')}
            accessibilityRole="button"
            onPress={handleEnableNotifications}
            style={({ pressed }) => [
              styles.permissionPrompt,
              pressed ? styles.permissionPromptPressed : undefined,
            ]}
          >
            <View style={styles.permissionPromptCopy}>
              <Text style={styles.permissionPromptTitle}>
                {t('settings.notifications.permissionInlineTitle')}
              </Text>
              <Text style={styles.permissionPromptBody}>
                {t('settings.notifications.permissionInlineBody', {
                  status: permissionLabel,
                })}
              </Text>
            </View>
            <Ionicons color="#06142a" name="chevron-forward" size={16} />
          </Pressable>
        ) : null}
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
            {(preferencesQuery.data ?? []).map((preference, index, preferences) => (
              <View
                key={preference.type}
                style={[
                  styles.preferenceRow,
                  index < preferences.length - 1 ? styles.preferenceRowBorder : undefined,
                ]}
              >
                <Text style={styles.preferenceLabel}>
                  {t(notificationPreferenceLabelKey(preference.type))}
                </Text>
                <Switch
                  accessibilityHint={t('settings.notifications.toggleHint')}
                  accessibilityLabel={t(notificationPreferenceLabelKey(preference.type))}
                  disabled={togglePreferenceMutation.isPending}
                  ios_backgroundColor="#d8dadd"
                  onValueChange={(nextValue) => {
                    void togglePreferenceMutation.mutateAsync({
                      type: preference.type,
                      isEnabled: nextValue,
                    });
                  }}
                  thumbColor="#ffffff"
                  trackColor={{ false: '#d8dadd', true: '#06142a' }}
                  value={preference.isEnabled}
                />
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={styles.settingsCard}>
        <SettingsSectionHeader iconName="shield-outline" title={t('settings.accountTitle')} />
        <View style={styles.actionList}>
          <SettingsActionRow
            onPress={signOutAndClearState}
            subtitle={t('settings.account.logoutSubtitle')}
            title={t('settings.account.logoutTitle')}
          />
          <SettingsActionRow
            onPress={() => navigation.navigate('AccountDeletion')}
            subtitle={t('settings.account.deleteSubtitle')}
            title={t('settings.account.deleteTitle')}
            tone="danger"
          />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  settingsScreen: {
    flex: 1,
    backgroundColor: '#f7f0e6',
  },
  settingsContent: {
    paddingHorizontal: 20,
    gap: 14,
  },
  topBar: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#efe2d1',
  },
  backButtonPressed: {
    transform: [{ scale: 0.96 }],
    backgroundColor: '#fbf8f2',
  },
  topBarTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
    color: '#06142a',
  },
  topBarSpacer: {
    width: 42,
  },
  settingsHero: {
    position: 'relative',
    overflow: 'hidden',
    minHeight: 110,
    justifyContent: 'center',
    borderRadius: 24,
    paddingHorizontal: 20,
    backgroundColor: '#07162a',
  },
  settingsHeroGrid: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.72,
  },
  settingsHeroGridLine: {
    position: 'absolute',
    backgroundColor: 'rgba(185, 205, 230, 0.12)',
  },
  settingsHeroGridLineVerticalOne: {
    top: 0,
    bottom: 0,
    left: '48%',
    width: 1,
  },
  settingsHeroGridLineVerticalTwo: {
    top: 0,
    bottom: 0,
    left: '76%',
    width: 1,
  },
  settingsHeroGridLineHorizontal: {
    top: 58,
    left: 0,
    right: 0,
    height: 1,
  },
  settingsHeroTitle: {
    fontSize: 28,
    lineHeight: 33,
    fontWeight: '900',
    color: '#ffffff',
  },
  settingsHeroSubtitle: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 19,
    color: '#c5d1df',
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 17,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#f1e6d8',
    shadowColor: '#10233f',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.04,
    shadowRadius: 18,
    elevation: 2,
  },
  settingsAvatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#06142a',
  },
  settingsAvatarText: {
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '900',
    color: '#ffffff',
  },
  profileCopy: {
    flex: 1,
    gap: 7,
  },
  profileName: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '900',
    color: '#06142a',
  },
  profilePillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  settingsPill: {
    minHeight: 21,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#3c86ff',
    paddingHorizontal: 9,
    paddingVertical: 2,
  },
  settingsPillLabel: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '800',
    color: '#06142a',
  },
  settingsCard: {
    gap: 15,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 17,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#f1e6d8',
    shadowColor: '#10233f',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.04,
    shadowRadius: 18,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  sectionIconWrap: {
    width: 31,
    height: 31,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f6f7',
  },
  sectionTitle: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '900',
    color: '#06142a',
  },
  fieldGroup: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: '#ff5f45',
  },
  languageChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  languageChip: {
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#dde2e8',
    paddingHorizontal: 15,
    backgroundColor: '#ffffff',
  },
  languageChipSelected: {
    borderColor: '#06142a',
    backgroundColor: '#06142a',
  },
  languageChipPressed: {
    transform: [{ scale: 0.98 }],
  },
  languageChipLabel: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    color: '#06142a',
  },
  languageChipLabelSelected: {
    color: '#ffffff',
  },
  cityField: {
    minHeight: 42,
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e1e4e8',
    paddingHorizontal: 14,
    backgroundColor: '#f9f9fa',
  },
  cityFieldPressed: {
    backgroundColor: '#f4f5f6',
  },
  cityFieldError: {
    borderColor: '#ff8876',
  },
  cityFieldText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    color: '#06142a',
  },
  cityFieldPlaceholder: {
    color: '#8a98a9',
  },
  fieldError: {
    fontSize: 12,
    lineHeight: 16,
    color: '#c14a3b',
  },
  saveButton: {
    minHeight: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#06142a',
  },
  saveButtonPressed: {
    transform: [{ scale: 0.99 }],
  },
  saveButtonDisabled: {
    opacity: 0.66,
  },
  saveButtonLabel: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
    color: '#ffffff',
  },
  permissionPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e7edf4',
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: '#f7fafc',
  },
  permissionPromptPressed: {
    transform: [{ scale: 0.99 }],
    backgroundColor: '#f1f5f8',
  },
  permissionPromptCopy: {
    flex: 1,
    gap: 2,
  },
  permissionPromptTitle: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
    color: '#06142a',
  },
  permissionPromptBody: {
    fontSize: 12,
    lineHeight: 16,
    color: '#7f8c9d',
  },
  centeredBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  preferenceList: {
    marginTop: -4,
  },
  preferenceRow: {
    minHeight: 47,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  preferenceRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e7e2db',
  },
  preferenceLabel: {
    flex: 1,
    paddingRight: 12,
    fontSize: 14,
    lineHeight: 19,
    color: '#06142a',
    fontWeight: '800',
  },
  actionList: {
    marginTop: -2,
  },
  actionRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e7e2db',
  },
  actionRowPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  actionCopy: {
    flex: 1,
    gap: 2,
  },
  actionTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
    color: '#06142a',
  },
  actionTitleDanger: {
    color: '#ff5f45',
  },
  actionSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    color: '#7f8c9d',
  },
});
