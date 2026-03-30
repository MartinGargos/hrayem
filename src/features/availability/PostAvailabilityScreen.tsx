import { zodResolver } from '@hookform/resolvers/zod';
import { addDays, format as formatDate, startOfDay } from 'date-fns';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import type { RootStackParamList } from '../../navigation/types';
import {
  deleteOwnAvailability,
  expandAvailabilityDates,
  fetchOwnAvailability,
  upsertOwnAvailability,
} from '../../services/availability';
import {
  fetchActiveSports,
  fetchOwnSportProfiles,
  upsertOwnSportProfile,
} from '../../services/events';
import { useAuthStore } from '../../store/auth-store';
import { useUserStore } from '../../store/user-store';
import type { AppNotice } from '../../types/app';
import type { AvailabilityRow, AvailabilityTimePreference } from '../../types/availability';
import { formatEventDate } from '../../utils/dates';
import { ActionButton, ChoiceChips, FormTextField, NoticeBanner } from '../auth/AuthPrimitives';
import { SportChoiceChip } from '../events/EventPrimitives';
import { NativePickerField } from '../events/NativePickerField';
import { SkillLevelModal } from '../events/SkillLevelModal';

type RootNavigation = NavigationProp<RootStackParamList>;

const MAX_AVAILABILITY_DAY_OFFSET = 6;

type AvailabilityFormValues = {
  sportId: string;
  startDate: Date;
  endDate: Date;
  timePreference: Exclude<AvailabilityTimePreference, null>;
  note?: string;
};

function createAvailabilitySchema(t: (key: string, options?: Record<string, unknown>) => string) {
  const latestAllowedDate = addDays(startOfDay(new Date()), MAX_AVAILABILITY_DAY_OFFSET);

  return z
    .object({
      sportId: z.string().min(1, 'availability.validation.sport'),
      startDate: z.date(),
      endDate: z.date(),
      timePreference: z.enum(['morning', 'afternoon', 'evening', 'any']),
      note: z.string().max(200, t('availability.validation.note')).optional().or(z.literal('')),
    })
    .superRefine((value, context) => {
      const normalizedStartDate = startOfDay(value.startDate);
      const normalizedEndDate = startOfDay(value.endDate);
      const today = startOfDay(new Date());

      if (normalizedStartDate < today) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'availability.validation.startDate',
          path: ['startDate'],
        });
      }

      if (normalizedEndDate < normalizedStartDate) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'availability.validation.endDate',
          path: ['endDate'],
        });
      }

      if (normalizedEndDate > latestAllowedDate) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'availability.validation.rangeLimit',
          path: ['endDate'],
        });
      }
    });
}

function translateFieldError(
  t: (key: string, options?: Record<string, unknown>) => string,
  message: string | undefined,
): string | null {
  return message ? t(message) : null;
}

function availabilityGroupKey(row: AvailabilityRow): string {
  return [row.sportId, row.timePreference ?? '', row.note ?? ''].join('::');
}

function groupOwnAvailability(rows: AvailabilityRow[]) {
  const groups = new Map<
    string,
    {
      ids: string[];
      sportId: string;
      timePreference: AvailabilityTimePreference;
      note: string | null;
      dates: string[];
    }
  >();

  for (const row of rows) {
    const key = availabilityGroupKey(row);
    const existing = groups.get(key);

    if (existing) {
      existing.ids.push(row.id);
      existing.dates.push(row.availableDate);
      continue;
    }

    groups.set(key, {
      ids: [row.id],
      sportId: row.sportId,
      timePreference: row.timePreference,
      note: row.note,
      dates: [row.availableDate],
    });
  }

  return [...groups.values()].map((group) => ({
    ...group,
    dates: [...group.dates].sort(),
  }));
}

export function PostAvailabilityScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<RootNavigation>();
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.userId);
  const selectedCity = useUserStore((state) => state.selectedCity);
  const language = useUserStore((state) => state.language);
  const [notice, setNotice] = useState<AppNotice | null>(null);
  const [pendingAvailabilityValues, setPendingAvailabilityValues] =
    useState<AvailabilityFormValues | null>(null);
  const [pendingSportId, setPendingSportId] = useState<string | null>(null);
  const [selectedSkillLevel, setSelectedSkillLevel] = useState<number | null>(null);
  const [isSkillModalVisible, setIsSkillModalVisible] = useState(false);

  const availabilityForm = useForm<AvailabilityFormValues>({
    resolver: zodResolver(createAvailabilitySchema(t)),
    mode: 'onChange',
    defaultValues: {
      sportId: '',
      startDate: startOfDay(new Date()),
      endDate: startOfDay(new Date()),
      timePreference: 'any',
      note: '',
    },
  });

  const sportsQuery = useQuery({
    queryKey: ['sports', 'active'],
    queryFn: fetchActiveSports,
    staleTime: 86_400_000,
  });

  const ownAvailabilityQuery = useQuery({
    queryKey: ['availability', 'own', userId],
    queryFn: fetchOwnAvailability,
    enabled: Boolean(userId),
    staleTime: 30_000,
  });

  const ownSportProfilesQuery = useQuery({
    queryKey: ['user-sports', userId],
    queryFn: () => fetchOwnSportProfiles(userId ?? ''),
    enabled: Boolean(userId),
    staleTime: 300_000,
  });

  const saveAvailabilityMutation = useMutation({
    mutationFn: upsertOwnAvailability,
    onSuccess: async () => {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNotice({
        messageKey: 'availability.saveSuccess',
        tone: 'success',
      });
      availabilityForm.reset({
        ...availabilityForm.getValues(),
        note: '',
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['availability', 'own', userId] }),
        queryClient.invalidateQueries({ queryKey: ['availability', 'feed'] }),
      ]);
    },
    onError: () => {
      setNotice({
        messageKey: 'availability.saveFailed',
        tone: 'error',
      });
    },
  });

  const deleteAvailabilityMutation = useMutation({
    mutationFn: deleteOwnAvailability,
    onSuccess: async () => {
      setNotice({
        messageKey: 'availability.deleteSuccess',
        tone: 'success',
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['availability', 'own', userId] }),
        queryClient.invalidateQueries({ queryKey: ['availability', 'feed'] }),
      ]);
    },
    onError: () => {
      setNotice({
        messageKey: 'availability.deleteFailed',
        tone: 'error',
      });
    },
  });

  async function persistAvailability(values: AvailabilityFormValues) {
    if (!userId || !selectedCity) {
      setNotice({
        messageKey: 'availability.cityRequired',
        tone: 'error',
      });
      return;
    }

    await saveAvailabilityMutation.mutateAsync({
      userId,
      sportId: values.sportId,
      city: selectedCity,
      availableDates: expandAvailabilityDates({
        startDate: values.startDate,
        endDate: values.endDate,
      }),
      timePreference: values.timePreference,
      note: values.note?.trim() ? values.note.trim() : null,
    });
  }

  function openSkillLevelRequirement(values: AvailabilityFormValues) {
    setPendingAvailabilityValues(values);
    setPendingSportId(values.sportId);
    setSelectedSkillLevel(null);
    setIsSkillModalVisible(true);
    setNotice({
      messageKey: 'availability.skillRequired',
      tone: 'info',
    });
  }

  async function handleSubmit(values: AvailabilityFormValues) {
    setNotice(null);

    if (!userId || !selectedCity) {
      setNotice({
        messageKey: 'availability.cityRequired',
        tone: 'error',
      });
      return;
    }

    try {
      const ownSportProfiles =
        ownSportProfilesQuery.data ??
        (await queryClient.fetchQuery({
          queryKey: ['user-sports', userId],
          queryFn: () => fetchOwnSportProfiles(userId),
          staleTime: 300_000,
        })) ??
        [];
      const hasSportProfile = ownSportProfiles.some(
        (profileRow) => profileRow.sportId === values.sportId,
      );

      if (!hasSportProfile) {
        openSkillLevelRequirement(values);
        return;
      }

      await persistAvailability(values);
    } catch {
      setNotice({
        messageKey: 'availability.saveFailed',
        tone: 'error',
      });
    }
  }

  async function handleConfirmSkillLevel() {
    if (!pendingAvailabilityValues || !pendingSportId || !selectedSkillLevel || !userId) {
      setIsSkillModalVisible(false);
      return;
    }

    try {
      await upsertOwnSportProfile({
        userId,
        sportId: pendingSportId,
        skillLevel: selectedSkillLevel,
      });
      await queryClient.invalidateQueries({ queryKey: ['user-sports', userId] });
      setIsSkillModalVisible(false);
      setNotice(null);
      await persistAvailability(pendingAvailabilityValues);
    } catch {
      setNotice({
        messageKey: 'availability.skillSaveFailed',
        tone: 'error',
      });
      setIsSkillModalVisible(false);
    }
  }

  const groupedAvailability = useMemo(
    () => groupOwnAvailability(ownAvailabilityQuery.data ?? []),
    [ownAvailabilityQuery.data],
  );
  const noteLength = availabilityForm.watch('note')?.length ?? 0;
  const skillModalSport = (sportsQuery.data ?? []).find((sport) => sport.id === pendingSportId);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>{t('availability.title')}</Text>
          <Text style={styles.heroSubtitle}>{t('availability.subtitle')}</Text>
        </View>

        <View style={styles.card}>
          <NoticeBanner notice={notice} resolveMessage={t} />

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('availability.sections.sport')}</Text>
            <Controller
              control={availabilityForm.control}
              name="sportId"
              render={({ field, fieldState }) => (
                <>
                  <View style={styles.sportChipWrap}>
                    {(sportsQuery.data ?? []).map((sport) => (
                      <SportChoiceChip
                        key={sport.id}
                        language={language}
                        onPress={() => field.onChange(sport.id)}
                        selected={field.value === sport.id}
                        sport={sport}
                      />
                    ))}
                  </View>
                  {fieldState.error?.message ? (
                    <Text style={styles.errorText}>
                      {translateFieldError(t, fieldState.error.message)}
                    </Text>
                  ) : null}
                </>
              )}
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('availability.sections.dates')}</Text>
            <Controller
              control={availabilityForm.control}
              name="startDate"
              render={({ field, fieldState }) => (
                <NativePickerField
                  error={translateFieldError(t, fieldState.error?.message)}
                  label={t('availability.startDate')}
                  mode="date"
                  onChange={field.onChange}
                  placeholder={t('availability.startDatePlaceholder')}
                  value={field.value}
                  valueText={formatEventDate(field.value, language)}
                />
              )}
            />
            <Controller
              control={availabilityForm.control}
              name="endDate"
              render={({ field, fieldState }) => (
                <NativePickerField
                  error={translateFieldError(t, fieldState.error?.message)}
                  label={t('availability.endDate')}
                  mode="date"
                  onChange={field.onChange}
                  placeholder={t('availability.endDatePlaceholder')}
                  value={field.value}
                  valueText={formatEventDate(field.value, language)}
                />
              )}
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('availability.sections.timePreference')}</Text>
            <Controller
              control={availabilityForm.control}
              name="timePreference"
              render={({ field }) => (
                <ChoiceChips<Exclude<AvailabilityTimePreference, null>>
                  label={t('availability.timePreference')}
                  onChange={field.onChange}
                  options={[
                    { label: t('availability.timePreferenceValues.morning'), value: 'morning' },
                    { label: t('availability.timePreferenceValues.afternoon'), value: 'afternoon' },
                    { label: t('availability.timePreferenceValues.evening'), value: 'evening' },
                    { label: t('availability.timePreferenceValues.any'), value: 'any' },
                  ]}
                  value={field.value}
                />
              )}
            />
          </View>

          <View style={styles.section}>
            <Controller
              control={availabilityForm.control}
              name="note"
              render={({ field, fieldState }) => (
                <FormTextField
                  autoCapitalize="sentences"
                  error={translateFieldError(t, fieldState.error?.message)}
                  label={t('availability.note')}
                  onChangeText={field.onChange}
                  placeholder={t('availability.notePlaceholder')}
                  value={field.value ?? ''}
                />
              )}
            />
            <Text style={styles.helperText}>
              {t('availability.noteCounter', {
                count: noteLength,
              })}
            </Text>
          </View>

          <ActionButton
            disabled={!availabilityForm.formState.isValid || saveAvailabilityMutation.isPending}
            label={
              saveAvailabilityMutation.isPending
                ? t('availability.submitPending')
                : t('availability.submit')
            }
            onPress={availabilityForm.handleSubmit(handleSubmit)}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('availability.yourAvailabilityTitle')}</Text>
          {ownAvailabilityQuery.isPending ? (
            <View style={styles.centeredBlock}>
              <ActivityIndicator color="#183153" />
            </View>
          ) : ownAvailabilityQuery.isError ? (
            <>
              <Text style={styles.helperText}>{t('availability.loadFailed')}</Text>
              <ActionButton
                label={t('events.common.retry')}
                onPress={async () => {
                  await ownAvailabilityQuery.refetch();
                }}
              />
            </>
          ) : groupedAvailability.length ? (
            groupedAvailability.map((group) => {
              const sport = (sportsQuery.data ?? []).find((entry) => entry.id === group.sportId);

              return (
                <View key={`${group.sportId}-${group.ids.join('-')}`} style={styles.existingCard}>
                  <Text style={styles.existingTitle}>
                    {sport
                      ? language === 'cs'
                        ? sport.nameCs
                        : sport.nameEn
                      : t('availability.unknownSport')}
                  </Text>
                  <Text style={styles.helperText}>
                    {group.dates
                      .map((dateValue) =>
                        formatDate(
                          new Date(`${dateValue}T00:00:00`),
                          language === 'cs' ? 'd. M.' : 'MMM d',
                        ),
                      )
                      .join(' · ')}
                  </Text>
                  <Text style={styles.helperText}>
                    {t(`availability.timePreferenceValues.${group.timePreference ?? 'any'}`)}
                  </Text>
                  {group.note ? <Text style={styles.helperText}>{group.note}</Text> : null}
                  <ActionButton
                    label={t('availability.deleteAction')}
                    onPress={async () => {
                      await deleteAvailabilityMutation.mutateAsync(group.ids);
                    }}
                    variant="secondary"
                  />
                </View>
              );
            })
          ) : (
            <>
              <Text style={styles.helperText}>{t('availability.emptyOwn')}</Text>
              <ActionButton
                label={t('availability.backToHome')}
                onPress={() =>
                  navigation.navigate('MainTabs', {
                    screen: 'HomeTab',
                    params: { screen: 'HomeFeed' },
                  })
                }
                variant="secondary"
              />
            </>
          )}
        </View>
      </ScrollView>
      <SkillLevelModal
        language={language}
        onClose={() => setIsSkillModalVisible(false)}
        onConfirm={handleConfirmSkillLevel}
        onSelectSkillLevel={setSelectedSkillLevel}
        selectedSkillLevel={selectedSkillLevel}
        sport={skillModalSport ?? null}
        subtitleKey="availability.skillModalSubtitle"
        visible={isSkillModalVisible}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: '#f7f0e6',
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 16,
  },
  hero: {
    borderRadius: 28,
    padding: 22,
    backgroundColor: '#183153',
  },
  heroTitle: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    color: '#fff8f0',
  },
  heroSubtitle: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 24,
    color: '#d2dde8',
  },
  card: {
    borderRadius: 22,
    padding: 18,
    backgroundColor: '#fffaf3',
    borderWidth: 1,
    borderColor: '#eadfce',
    gap: 12,
  },
  centeredBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#b42318',
  },
  existingCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#eadfce',
    backgroundColor: '#fffdf8',
    padding: 14,
    gap: 8,
  },
  existingTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#183153',
  },
  helperText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#5a6475',
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#183153',
  },
  sportChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
});
