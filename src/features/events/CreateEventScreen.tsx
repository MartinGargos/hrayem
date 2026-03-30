import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, setHours, setMinutes, setSeconds, startOfDay } from 'date-fns';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp, RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { ActionButton, ChoiceChips, FormTextField, NoticeBanner } from '../auth/AuthPrimitives';
import { canOrganizerEditEvent } from './event-eligibility';
import { AvatarPhoto, SportChoiceChip, StepperField } from './EventPrimitives';
import { NativePickerField } from './NativePickerField';
import { SkillLevelModal } from './SkillLevelModal';
import {
  fetchActiveSports,
  createEvent,
  EdgeFunctionError,
  fetchEventDetail,
  fetchOwnSportProfiles,
  updateEvent,
  upsertOwnSportProfile,
} from '../../services/events';
import { createVenue, fetchVenueMatches } from '../../services/venues';
import { useAuthStore } from '../../store/auth-store';
import { useUIStore } from '../../store/ui-store';
import { useUserStore } from '../../store/user-store';
import type { RootStackParamList } from '../../navigation/types';
import { formatEventDate, formatEventTime } from '../../utils/dates';
import type { AppNotice } from '../../types/app';
import type {
  CreateEventInput,
  ReservationType,
  UpdateEventInput,
  VenueSummary,
} from '../../types/events';

type RootNavigation = NavigationProp<RootStackParamList>;
type EditEventRoute = RouteProp<RootStackParamList, 'EditEvent'>;
type EventFormMode = 'create' | 'edit';

const skillLevelValues = [1, 2, 3, 4] as const;

function buildDefaultDateTime(hours: number, minutes: number): Date {
  const nextDay = addDays(startOfDay(new Date()), 1);
  return setSeconds(setMinutes(setHours(nextDay, hours), minutes), 0);
}

function combineLocalDateAndTime(datePart: Date, timePart: Date): Date {
  return setSeconds(
    setMinutes(setHours(new Date(datePart), timePart.getHours()), timePart.getMinutes()),
    0,
  );
}

function createEventSchema(t: (key: string, options?: Record<string, unknown>) => string) {
  return z
    .object({
      sportId: z.string().min(1, 'events.create.validation.sport'),
      reservationType: z.enum(['reserved', 'to_be_arranged']),
      eventDate: z.date(),
      startTime: z.date(),
      endTime: z.date(),
      venueId: z.string().min(1, 'events.create.validation.venue'),
      playerCountTotal: z.number().int().min(2).max(20),
      skillMin: z.number().int().min(1).max(4),
      skillMax: z.number().int().min(1).max(4),
      description: z
        .string()
        .max(500, t('events.create.validation.description'))
        .optional()
        .or(z.literal('')),
    })
    .superRefine((value, context) => {
      if (value.skillMin > value.skillMax) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'events.create.validation.skillRange',
          path: ['skillMax'],
        });
      }

      const startsAt = combineLocalDateAndTime(value.eventDate, value.startTime);
      const endsAt = combineLocalDateAndTime(value.eventDate, value.endTime);

      if (endsAt <= startsAt) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'events.create.validation.endTime',
          path: ['endTime'],
        });
      }

      if (startsAt <= new Date()) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'events.create.validation.futureStart',
          path: ['startTime'],
        });
      }
    });
}

type CreateEventValues = z.infer<ReturnType<typeof createEventSchema>>;

function createVenueSchema() {
  return z.object({
    name: z.string().trim().min(1, 'events.venue.validation.name').max(100),
    address: z
      .string()
      .trim()
      .max(200, 'events.venue.validation.address')
      .optional()
      .or(z.literal('')),
  });
}

type CreateVenueValues = z.infer<ReturnType<typeof createVenueSchema>>;

function translateFieldError(
  t: (key: string, options?: Record<string, unknown>) => string,
  message: string | undefined,
): string | null {
  return message ? t(message) : null;
}

function mapEventErrorToNotice(error: unknown, mode: EventFormMode): AppNotice {
  if (error instanceof EdgeFunctionError) {
    if (error.code === 'SKILL_LEVEL_REQUIRED') {
      return {
        messageKey: 'events.create.skillRequired',
        tone: 'info',
      };
    }

    if (error.code === 'VENUE_NOT_FOUND') {
      return {
        messageKey: 'events.venue.errors.missing',
        tone: 'error',
      };
    }

    if (error.code === 'VALIDATION_ERROR') {
      return {
        messageKey:
          mode === 'edit' ? 'events.edit.errors.validation' : 'events.create.errors.validation',
        tone: 'error',
      };
    }

    if (error.code === 'PLAYER_COUNT_TOO_LOW') {
      return {
        messageKey: 'events.edit.errors.playerCountTooLow',
        tone: 'error',
      };
    }

    if (error.code === 'EVENT_NOT_EDITABLE') {
      return {
        messageKey: 'events.edit.errors.unavailable',
        tone: 'info',
      };
    }

    if (error.code === 'EVENT_NOT_CANCELLABLE') {
      return {
        messageKey: 'events.cancel.errors.unavailable',
        tone: 'info',
      };
    }

    if (error.code === 'RATE_LIMITED') {
      return {
        messageKey: 'events.common.errors.rateLimited',
        tone: 'info',
      };
    }
  }

  return {
    messageKey: 'events.common.errors.generic',
    tone: 'error',
  };
}

function EventFormScreen({ mode, eventId }: { mode: EventFormMode; eventId?: string }) {
  const navigation = useNavigation<RootNavigation>();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.userId);
  const selectedCity = useUserStore((state) => state.selectedCity);
  const language = useUserStore((state) => state.language);
  const profile = useUserStore((state) => state.profile);
  const isEditMode = mode === 'edit';
  const setAuthNotice = useUIStore((state) => state.setAuthNotice);
  const notice = useUIStore((state) => state.authNotice);
  const clearAuthNotice = useUIStore((state) => state.clearAuthNotice);
  const [venueSearchInput, setVenueSearchInput] = useState('');
  const [debouncedVenueSearch, setDebouncedVenueSearch] = useState('');
  const [selectedVenue, setSelectedVenue] = useState<VenueSummary | null>(null);
  const [showInlineVenueForm, setShowInlineVenueForm] = useState(false);
  const [isSkillModalVisible, setIsSkillModalVisible] = useState(false);
  const [pendingEventInput, setPendingEventInput] = useState<CreateEventInput | null>(null);
  const [pendingSportId, setPendingSportId] = useState<string | null>(null);
  const [selectedSkillLevel, setSelectedSkillLevel] = useState<number | null>(null);
  const [prefilledEventId, setPrefilledEventId] = useState<string | null>(null);

  const eventForm = useForm<CreateEventValues>({
    resolver: zodResolver(createEventSchema(t)),
    mode: 'onChange',
    defaultValues: {
      sportId: '',
      reservationType: 'reserved',
      eventDate: buildDefaultDateTime(0, 0),
      startTime: buildDefaultDateTime(18, 0),
      endTime: buildDefaultDateTime(19, 30),
      venueId: '',
      playerCountTotal: 4,
      skillMin: 1,
      skillMax: 4,
      description: '',
    },
  });

  const venueForm = useForm<CreateVenueValues>({
    resolver: zodResolver(createVenueSchema()),
    mode: 'onChange',
    defaultValues: {
      name: '',
      address: '',
    },
  });

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedVenueSearch(venueSearchInput.trim());
    }, 250);

    return () => clearTimeout(handle);
  }, [venueSearchInput]);

  const sportsQuery = useQuery({
    queryKey: ['sports', 'active'],
    queryFn: fetchActiveSports,
    staleTime: 86_400_000,
  });

  const editingEventQuery = useQuery({
    queryKey: ['events', 'detail', eventId, 'edit-form'],
    queryFn: () => fetchEventDetail(eventId ?? ''),
    enabled: isEditMode && Boolean(eventId),
    staleTime: 10_000,
  });

  const ownSportProfilesQuery = useQuery({
    queryKey: ['user-sports', userId],
    queryFn: () => fetchOwnSportProfiles(userId ?? ''),
    enabled: Boolean(userId) && !isEditMode,
    staleTime: 300_000,
  });

  const venueMatchesQuery = useQuery({
    queryKey: ['venues', selectedCity, debouncedVenueSearch],
    queryFn: () => fetchVenueMatches({ city: selectedCity ?? '', search: debouncedVenueSearch }),
    enabled: Boolean(selectedCity),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!isEditMode || !editingEventQuery.data || editingEventQuery.data.id === prefilledEventId) {
      return;
    }

    const event = editingEventQuery.data;
    const startsAtDate = new Date(event.startsAt);
    const endsAtDate = new Date(event.endsAt);

    eventForm.reset({
      sportId: event.sportId,
      reservationType: event.reservationType,
      eventDate: startsAtDate,
      startTime: startsAtDate,
      endTime: endsAtDate,
      venueId: event.venueId,
      playerCountTotal: event.playerCountTotal,
      skillMin: event.skillMin,
      skillMax: event.skillMax,
      description: event.description ?? '',
    });
    setSelectedVenue({
      id: event.venueId,
      name: event.venueName,
      city: event.city,
      address: event.venueAddress,
      createdBy: event.organizerId,
      isVerified: false,
    });
    setVenueSearchInput(event.venueName);
    setPrefilledEventId(event.id);
  }, [editingEventQuery.data, eventForm, isEditMode, prefilledEventId]);

  const createVenueMutation = useMutation({
    mutationFn: createVenue,
    onSuccess: (venue) => {
      setSelectedVenue(venue);
      setVenueSearchInput(venue.name);
      eventForm.setValue('venueId', venue.id, { shouldValidate: true, shouldDirty: true });
      venueForm.reset({
        name: venue.name,
        address: venue.address ?? '',
      });
      setShowInlineVenueForm(false);
      void queryClient.invalidateQueries({ queryKey: ['venues', selectedCity] });
    },
  });

  const createEventMutation = useMutation({
    mutationFn: createEvent,
    onSuccess: async (createdEvent) => {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['events', 'feed'] }),
        queryClient.invalidateQueries({ queryKey: ['events', 'my-games'] }),
      ]);
      navigation.navigate('EventDetail', { eventId: createdEvent.id });
    },
  });

  const updateEventMutation = useMutation({
    mutationFn: updateEvent,
    onSuccess: async (updatedEvent) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['events', 'detail', updatedEvent.id] }),
        queryClient.invalidateQueries({
          queryKey: ['events', 'detail', updatedEvent.id, 'edit-form'],
        }),
        queryClient.invalidateQueries({
          queryKey: ['events', 'detail', updatedEvent.id, 'confirmed-players'],
        }),
        queryClient.invalidateQueries({ queryKey: ['events', 'feed'] }),
        queryClient.invalidateQueries({ queryKey: ['events', 'my-games'] }),
      ]);
      navigation.navigate('EventDetail', { eventId: updatedEvent.id });
    },
  });

  const canOfferInlineVenue =
    Boolean(selectedCity) &&
    Boolean(debouncedVenueSearch) &&
    !venueMatchesQuery.isFetching &&
    (venueMatchesQuery.data ?? []).length === 0;

  async function handleCreateVenue(values: CreateVenueValues) {
    clearAuthNotice();

    if (!selectedCity || !userId) {
      setAuthNotice({
        messageKey: 'events.venue.errors.cityRequired',
        tone: 'error',
      });
      return;
    }

    await createVenueMutation.mutateAsync({
      name: values.name,
      address: values.address,
      city: selectedCity,
      createdBy: userId,
    });
  }

  function openSkillLevelRequirement(input: CreateEventInput) {
    setPendingEventInput(input);
    setPendingSportId(input.sportId);
    setSelectedSkillLevel(null);
    setIsSkillModalVisible(true);
    setAuthNotice({
      messageKey: 'events.create.skillRequired',
      tone: 'info',
    });
  }

  async function submitCreateEvent(input: CreateEventInput) {
    try {
      await createEventMutation.mutateAsync(input);
    } catch (error) {
      const mappedNotice = mapEventErrorToNotice(error, mode);

      if (error instanceof EdgeFunctionError && error.code === 'SKILL_LEVEL_REQUIRED') {
        openSkillLevelRequirement(input);
      }

      setAuthNotice(mappedNotice);
    }
  }

  async function submitUpdateEvent(input: UpdateEventInput) {
    try {
      await updateEventMutation.mutateAsync(input);
    } catch (error) {
      setAuthNotice(mapEventErrorToNotice(error, mode));
    }
  }

  async function handleEventSubmit(values: CreateEventValues) {
    clearAuthNotice();

    const startsAt = combineLocalDateAndTime(values.eventDate, values.startTime).toISOString();
    const endsAt = combineLocalDateAndTime(values.eventDate, values.endTime).toISOString();

    const eventInput = {
      sportId: values.sportId,
      venueId: values.venueId,
      startsAt,
      endsAt,
      reservationType: values.reservationType,
      playerCountTotal: values.playerCountTotal,
      skillMin: values.skillMin,
      skillMax: values.skillMax,
      description: values.description?.trim() ? values.description.trim() : null,
    } satisfies CreateEventInput;

    if (isEditMode) {
      const editableEvent = editingEventQuery.data;

      if (!eventId || !editableEvent) {
        setAuthNotice({
          messageKey: 'events.edit.errors.unavailable',
          tone: 'info',
        });
        return;
      }

      if (!canOrganizerEditEvent(editableEvent)) {
        setAuthNotice({
          messageKey: 'events.edit.errors.unavailable',
          tone: 'info',
        });
        return;
      }

      if (values.playerCountTotal < editableEvent.spotsTaken) {
        setAuthNotice({
          messageKey: 'events.edit.errors.playerCountTooLow',
          tone: 'error',
        });
        return;
      }

      await submitUpdateEvent({
        eventId,
        venueId: eventInput.venueId,
        startsAt: eventInput.startsAt,
        endsAt: eventInput.endsAt,
        reservationType: eventInput.reservationType,
        playerCountTotal: eventInput.playerCountTotal,
        skillMin: eventInput.skillMin,
        skillMax: eventInput.skillMax,
        description: eventInput.description ?? null,
      });
      return;
    }

    if (ownSportProfilesQuery.data) {
      const hasSportProfile = ownSportProfilesQuery.data.some(
        (profileRow) => profileRow.sportId === eventInput.sportId,
      );

      if (!hasSportProfile) {
        openSkillLevelRequirement(eventInput);
        return;
      }
    }

    await submitCreateEvent(eventInput);
  }

  async function handleConfirmSkillLevel() {
    if (isEditMode) {
      setIsSkillModalVisible(false);
      return;
    }

    if (!pendingSportId || !pendingEventInput || !userId || !selectedSkillLevel) {
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
      setAuthNotice(null);
      await submitCreateEvent(pendingEventInput);
    } catch {
      setAuthNotice({
        messageKey: 'events.skillLevel.errors.saveFailed',
        tone: 'error',
      });
      setIsSkillModalVisible(false);
    }
  }

  const selectedSport = (sportsQuery.data ?? []).find(
    (sport) => sport.id === eventForm.watch('sportId'),
  );
  const skillModalSport = (sportsQuery.data ?? []).find((sport) => sport.id === pendingSportId);
  const descriptionLength = eventForm.watch('description')?.length ?? 0;
  const isSubmitting = createEventMutation.isPending || updateEventMutation.isPending;
  const heroTitle = isEditMode ? t('events.edit.title') : t('shell.createEvent.title');
  const heroSubtitle = isEditMode ? t('events.edit.subtitle') : t('shell.createEvent.subtitle');
  const submitLabel = isEditMode ? t('events.edit.submit') : t('events.create.submit');

  if (isEditMode && editingEventQuery.isPending) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <Text style={styles.heroTitle}>{heroTitle}</Text>
            <Text style={styles.heroSubtitle}>{heroSubtitle}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('events.edit.loadingTitle')}</Text>
            <Text style={styles.helperText}>{t('events.edit.loadingBody')}</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  if (isEditMode && (editingEventQuery.isError || !editingEventQuery.data)) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <Text style={styles.heroTitle}>{heroTitle}</Text>
            <Text style={styles.heroSubtitle}>{heroSubtitle}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('events.edit.errors.loadTitle')}</Text>
            <Text style={styles.helperText}>{t('events.edit.errors.loadBody')}</Text>
            <ActionButton
              label={t('events.common.retry')}
              onPress={async () => {
                await editingEventQuery.refetch();
              }}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  if (isEditMode && editingEventQuery.data && !canOrganizerEditEvent(editingEventQuery.data)) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <Text style={styles.heroTitle}>{heroTitle}</Text>
            <Text style={styles.heroSubtitle}>{heroSubtitle}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('events.edit.errors.unavailableTitle')}</Text>
            <Text style={styles.helperText}>{t('events.edit.errors.unavailableBody')}</Text>
            <ActionButton
              label={t('events.detail.backToEvent')}
              onPress={() =>
                navigation.navigate('EventDetail', {
                  eventId: editingEventQuery.data.id,
                })
              }
              variant="secondary"
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

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
          <Text style={styles.heroTitle}>{heroTitle}</Text>
          <Text style={styles.heroSubtitle}>{heroSubtitle}</Text>
        </View>

        <View style={styles.card}>
          <NoticeBanner notice={notice} resolveMessage={t} />

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('events.create.sections.sport')}</Text>
            {isEditMode ? (
              <View style={styles.selectedVenueCard}>
                <Text style={styles.selectedVenueName}>
                  {selectedSport
                    ? language === 'cs'
                      ? selectedSport.nameCs
                      : selectedSport.nameEn
                    : t('events.create.previewSportFallback')}
                </Text>
                <Text style={styles.selectedVenueMeta}>{t('events.edit.sportLocked')}</Text>
              </View>
            ) : (
              <Controller
                control={eventForm.control}
                name="sportId"
                render={({ field, fieldState }) => (
                  <>
                    <View style={styles.sportChipWrap}>
                      {(sportsQuery.data ?? []).map((sport) => {
                        const selected = field.value === sport.id;

                        return (
                          <SportChoiceChip
                            key={sport.id}
                            onPress={() => field.onChange(sport.id)}
                            selected={selected}
                            sport={sport}
                            language={language}
                          />
                        );
                      })}
                    </View>
                    {fieldState.error?.message ? (
                      <Text style={styles.errorText}>
                        {translateFieldError(t, fieldState.error.message)}
                      </Text>
                    ) : null}
                  </>
                )}
              />
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('events.create.sections.schedule')}</Text>
            <Controller
              control={eventForm.control}
              name="eventDate"
              render={({ field }) => (
                <NativePickerField
                  label={t('events.create.eventDate')}
                  mode="date"
                  onChange={field.onChange}
                  placeholder={t('events.create.eventDatePlaceholder')}
                  value={field.value}
                  valueText={formatEventDate(field.value, language)}
                />
              )}
            />
            <Controller
              control={eventForm.control}
              name="startTime"
              render={({ field, fieldState }) => (
                <NativePickerField
                  error={translateFieldError(t, fieldState.error?.message)}
                  label={t('events.create.startTime')}
                  mode="time"
                  onChange={field.onChange}
                  placeholder={t('events.create.startTimePlaceholder')}
                  value={field.value}
                  valueText={formatEventTime(field.value, language)}
                />
              )}
            />
            <Controller
              control={eventForm.control}
              name="endTime"
              render={({ field, fieldState }) => (
                <NativePickerField
                  error={translateFieldError(t, fieldState.error?.message)}
                  label={t('events.create.endTime')}
                  mode="time"
                  onChange={field.onChange}
                  placeholder={t('events.create.endTimePlaceholder')}
                  value={field.value}
                  valueText={formatEventTime(field.value, language)}
                />
              )}
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('events.create.sections.venue')}</Text>
            <TextInput
              accessibilityLabel={t('events.create.venueSearch')}
              onChangeText={(nextValue) => {
                setVenueSearchInput(nextValue);

                if (selectedVenue && nextValue.trim() !== selectedVenue.name) {
                  setSelectedVenue(null);
                  eventForm.setValue('venueId', '', { shouldValidate: true, shouldDirty: true });
                }
              }}
              placeholder={t('events.create.venueSearchPlaceholder')}
              placeholderTextColor="#7a8ca3"
              style={styles.searchInput}
              value={venueSearchInput}
            />

            {selectedVenue ? (
              <View style={styles.selectedVenueCard}>
                <Text style={styles.selectedVenueName}>{selectedVenue.name}</Text>
                <Text style={styles.selectedVenueMeta}>
                  {selectedVenue.address ?? t('events.venue.noAddress')}
                </Text>
              </View>
            ) : null}

            {(venueMatchesQuery.data ?? []).length ? (
              <View style={styles.venueMatchesWrap}>
                {(venueMatchesQuery.data ?? []).map((venue) => (
                  <Pressable
                    key={venue.id}
                    onPress={() => {
                      setSelectedVenue(venue);
                      setVenueSearchInput(venue.name);
                      eventForm.setValue('venueId', venue.id, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                      setShowInlineVenueForm(false);
                    }}
                    style={styles.venueMatchCard}
                  >
                    <Text style={styles.venueMatchName}>{venue.name}</Text>
                    <Text style={styles.venueMatchMeta}>
                      {venue.address ?? t('events.venue.noAddress')}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {canOfferInlineVenue ? (
              <View style={styles.inlineVenuePrompt}>
                <Text style={styles.inlineVenuePromptText}>{t('events.venue.noMatch')}</Text>
                <ActionButton
                  label={t('events.venue.addInlineAction')}
                  onPress={() => {
                    venueForm.reset({
                      name: debouncedVenueSearch,
                      address: '',
                    });
                    setShowInlineVenueForm(true);
                  }}
                  variant="secondary"
                />
              </View>
            ) : null}

            {showInlineVenueForm ? (
              <View style={styles.inlineVenueForm}>
                <Controller
                  control={venueForm.control}
                  name="name"
                  render={({ field, fieldState }) => (
                    <FormTextField
                      error={translateFieldError(t, fieldState.error?.message)}
                      label={t('events.venue.fields.name')}
                      onChangeText={field.onChange}
                      placeholder={t('events.venue.placeholders.name')}
                      value={field.value}
                    />
                  )}
                />
                <Controller
                  control={venueForm.control}
                  name="address"
                  render={({ field, fieldState }) => (
                    <FormTextField
                      error={translateFieldError(t, fieldState.error?.message)}
                      label={t('events.venue.fields.address')}
                      onChangeText={field.onChange}
                      placeholder={t('events.venue.placeholders.address')}
                      value={field.value ?? ''}
                    />
                  )}
                />
                <ActionButton
                  disabled={!venueForm.formState.isValid || createVenueMutation.isPending}
                  label={t('events.venue.submit')}
                  onPress={venueForm.handleSubmit(handleCreateVenue)}
                />
              </View>
            ) : null}

            {eventForm.formState.errors.venueId?.message ? (
              <Text style={styles.errorText}>
                {translateFieldError(t, eventForm.formState.errors.venueId.message)}
              </Text>
            ) : null}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('events.create.sections.rules')}</Text>
            <Controller
              control={eventForm.control}
              name="reservationType"
              render={({ field }) => (
                <ChoiceChips<ReservationType>
                  label={t('events.create.reservationType')}
                  onChange={field.onChange}
                  options={[
                    {
                      label: t('events.reservationType.reserved'),
                      value: 'reserved',
                    },
                    {
                      label: t('events.reservationType.to_be_arranged'),
                      value: 'to_be_arranged',
                    },
                  ]}
                  value={field.value}
                />
              )}
            />
            <Controller
              control={eventForm.control}
              name="playerCountTotal"
              render={({ field }) => (
                <StepperField
                  label={t('events.create.playerCountTotal')}
                  maximum={20}
                  minimum={2}
                  onChange={field.onChange}
                  value={field.value}
                />
              )}
            />
            <Controller
              control={eventForm.control}
              name="skillMin"
              render={({ field }) => (
                <ChoiceChips<number>
                  label={t('events.create.skillMin')}
                  onChange={field.onChange}
                  options={skillLevelValues.map((value) => ({
                    label: t(`events.skillLevel.short.${value}`),
                    value,
                  }))}
                  value={field.value}
                />
              )}
            />
            <Controller
              control={eventForm.control}
              name="skillMax"
              render={({ field, fieldState }) => (
                <ChoiceChips<number>
                  error={translateFieldError(t, fieldState.error?.message)}
                  label={t('events.create.skillMax')}
                  onChange={field.onChange}
                  options={skillLevelValues.map((value) => ({
                    label: t(`events.skillLevel.short.${value}`),
                    value,
                  }))}
                  value={field.value}
                />
              )}
            />
            <Text style={styles.helperText}>{t('events.create.skillHelper')}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('events.create.sections.description')}</Text>
            <Controller
              control={eventForm.control}
              name="description"
              render={({ field, fieldState }) => (
                <>
                  <TextInput
                    accessibilityLabel={t('events.create.description')}
                    multiline
                    numberOfLines={4}
                    onChangeText={field.onChange}
                    placeholder={t('events.create.descriptionPlaceholder')}
                    placeholderTextColor="#7a8ca3"
                    style={[
                      styles.multilineInput,
                      fieldState.error ? styles.inputError : undefined,
                    ]}
                    textAlignVertical="top"
                    value={field.value}
                  />
                  <Text style={styles.counterText}>
                    {t('events.create.descriptionCounter', {
                      count: descriptionLength,
                      max: 500,
                    })}
                  </Text>
                  {fieldState.error?.message ? (
                    <Text style={styles.errorText}>
                      {translateFieldError(t, fieldState.error.message)}
                    </Text>
                  ) : null}
                </>
              )}
            />
          </View>

          <View style={styles.previewCard}>
            <Text style={styles.previewTitle}>{t('events.create.previewTitle')}</Text>
            <View style={styles.previewRow}>
              <AvatarPhoto
                label={profile?.firstName ?? t('events.common.organizerFallback')}
                uri={profile?.photoUrl ?? null}
              />
              <View style={styles.previewTextWrap}>
                <Text style={styles.previewEventTitle}>
                  {selectedSport
                    ? language === 'cs'
                      ? selectedSport.nameCs
                      : selectedSport.nameEn
                    : t('events.create.previewSportFallback')}
                </Text>
                <Text style={styles.previewEventMeta}>
                  {selectedVenue?.name ?? t('events.create.previewVenueFallback')}
                </Text>
                <Text style={styles.previewEventMeta}>
                  {formatEventDate(eventForm.watch('eventDate'), language)} ·{' '}
                  {formatEventTime(eventForm.watch('startTime'), language)}
                </Text>
              </View>
            </View>
          </View>

          <ActionButton
            disabled={!eventForm.formState.isValid || isSubmitting}
            label={submitLabel}
            onPress={eventForm.handleSubmit(handleEventSubmit)}
          />
        </View>
      </ScrollView>

      <SkillLevelModal
        language={language}
        onClose={() => setIsSkillModalVisible(false)}
        onConfirm={handleConfirmSkillLevel}
        onSelectSkillLevel={setSelectedSkillLevel}
        selectedSkillLevel={selectedSkillLevel}
        sport={skillModalSport ?? null}
        visible={isSkillModalVisible}
      />
    </KeyboardAvoidingView>
  );
}

export function CreateEventScreen() {
  return <EventFormScreen mode="create" />;
}

export function EditEventScreen({ route }: { route: EditEventRoute }) {
  return <EventFormScreen eventId={route.params.eventId} mode="edit" />;
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 32,
    gap: 18,
    backgroundColor: '#f7f0e6',
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
    borderRadius: 24,
    padding: 20,
    gap: 18,
    backgroundColor: '#fff9f1',
    borderWidth: 1,
    borderColor: '#eedfca',
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#183153',
  },
  sportChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  searchInput: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#c8d5e4',
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: '#fbfdff',
    fontSize: 16,
    color: '#183153',
  },
  selectedVenueCard: {
    gap: 4,
    borderRadius: 18,
    padding: 14,
    backgroundColor: '#eff5fb',
  },
  selectedVenueName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#183153',
  },
  selectedVenueMeta: {
    fontSize: 14,
    lineHeight: 20,
    color: '#5a6475',
  },
  venueMatchesWrap: {
    gap: 10,
  },
  venueMatchCard: {
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#eadfce',
    backgroundColor: '#fffaf3',
    gap: 4,
  },
  venueMatchName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#183153',
  },
  venueMatchMeta: {
    fontSize: 14,
    lineHeight: 20,
    color: '#5a6475',
  },
  inlineVenuePrompt: {
    gap: 10,
  },
  inlineVenuePromptText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#5a6475',
  },
  inlineVenueForm: {
    gap: 14,
    borderRadius: 18,
    padding: 14,
    backgroundColor: '#f4ecdf',
  },
  helperText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#6d7f95',
  },
  multilineInput: {
    minHeight: 120,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#c8d5e4',
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: '#fbfdff',
    fontSize: 16,
    color: '#183153',
  },
  inputError: {
    borderColor: '#d9594c',
  },
  counterText: {
    fontSize: 12,
    color: '#6d7f95',
    textAlign: 'right',
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#d9594c',
  },
  previewCard: {
    gap: 12,
    borderRadius: 20,
    padding: 16,
    backgroundColor: '#f0e6d8',
  },
  previewTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#183153',
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  previewTextWrap: {
    flex: 1,
    gap: 2,
  },
  previewEventTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#183153',
  },
  previewEventMeta: {
    fontSize: 14,
    color: '#5a6475',
  },
});
