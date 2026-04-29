import DateTimePicker from '@react-native-community/datetimepicker';
import { zodResolver } from '@hookform/resolvers/zod';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, setHours, setMinutes, setSeconds, startOfDay } from 'date-fns';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  ActivityIndicator,
  Animated,
  Easing,
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { ActionButton, FormTextField, NoticeBanner } from '../auth/AuthPrimitives';
import {
  CreateEventSuccessOverlay,
  type CreateEventSuccessSummary,
} from './CreateEventSuccessOverlay';
import { canOrganizerEditEvent } from './event-eligibility';
import { SportBadge } from './EventPrimitives';
import { SkillLevelModal } from './SkillLevelModal';
import { buildEventWebUrl } from '../../navigation/deep-links';
import {
  createEvent,
  EdgeFunctionError,
  fetchActiveSports,
  fetchEventDetail,
  fetchOwnSportProfiles,
  updateEvent,
  upsertOwnSportProfile,
} from '../../services/events';
import { createVenue, fetchVenueMatches } from '../../services/venues';
import type { RootStackParamList } from '../../navigation/types';
import { useAuthStore } from '../../store/auth-store';
import { useUIStore } from '../../store/ui-store';
import { useUserStore } from '../../store/user-store';
import type { AppNotice, AppLanguage } from '../../types/app';
import type {
  CreateEventResponse,
  CreateEventInput,
  ReservationType,
  SportSummary,
  UpdateEventInput,
  VenueSummary,
} from '../../types/events';
import { formatEventDate, formatEventTime } from '../../utils/dates';

type RootNavigation = NavigationProp<RootStackParamList>;
type EditEventRoute = RouteProp<RootStackParamList, 'EditEvent'>;
type EventFormMode = 'create' | 'edit';
type VenueFilterMode = 'all' | 'verified' | 'community' | 'mine';
type PickerTarget = 'date' | 'start' | 'end' | null;

const skillLevelValues = [1, 2, 3, 4] as const;
type SkillLevelValue = (typeof skillLevelValues)[number];
const durationOptions = [60, 90, 120] as const;
const descriptionAccessoryId = 'create-event-description-accessory';

type CreateEventSuccessState = {
  eventId: string;
  summary: CreateEventSuccessSummary;
  shareMessage: string;
  shareUrl: string;
};

function getSportBadgeLabel(slug: string | undefined, fallbackName: string): string {
  if (slug === 'badminton') {
    return 'BD';
  }

  if (slug === 'padel') {
    return 'PD';
  }

  if (slug === 'squash') {
    return 'SQ';
  }

  if (slug === 'tennis') {
    return 'TE';
  }

  return fallbackName.slice(0, 2).toUpperCase();
}

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

function addMinutesToClock(time: Date, minutes: number): Date {
  const next = new Date(time.getTime() + minutes * 60 * 1000);

  if (next.getDate() !== time.getDate()) {
    return setSeconds(setMinutes(setHours(new Date(time), 23), 45), 0);
  }

  return next;
}

function getDurationMinutes(startTime: Date, endTime: Date) {
  const delta = endTime.getTime() - startTime.getTime();
  return delta > 0 ? Math.round(delta / (60 * 1000)) : 0;
}

function getSkillRangeLabel(
  t: ReturnType<typeof useTranslation>['t'],
  minimum: number | null,
  maximum: number | null,
) {
  if (minimum === null || maximum === null) {
    return t('events.create.skillUnset');
  }

  if (minimum === 1 && maximum === 4) {
    return t('home.feed.allLevels');
  }

  if (minimum === maximum) {
    return t(`events.skillLevel.label.${minimum}`);
  }

  return `${t(`events.skillLevel.label.${minimum}`)} – ${t(`events.skillLevel.label.${maximum}`)}`;
}

function buildCreateEventSuccessState(input: {
  createdEvent: CreateEventResponse;
  selectedSport: SportSummary | undefined;
  venueName: string;
  language: AppLanguage;
  t: ReturnType<typeof useTranslation>['t'];
}): CreateEventSuccessState {
  const sportName = input.selectedSport
    ? input.language === 'cs'
      ? input.selectedSport.nameCs
      : input.selectedSport.nameEn
    : input.t('events.create.previewSportFallback');
  const shareDate = `${formatEventDate(input.createdEvent.starts_at, input.language)} · ${formatEventTime(
    input.createdEvent.starts_at,
    input.language,
  )}`;
  const shareUrl = buildEventWebUrl(input.createdEvent.id);

  return {
    eventId: input.createdEvent.id,
    summary: {
      eventId: input.createdEvent.id,
      sportName,
      sportBadgeLabel: getSportBadgeLabel(input.selectedSport?.slug, sportName),
      sportColorHex: input.selectedSport?.colorHex ?? '#49a6ff',
      venueName: input.venueName,
      dateLabel: formatEventDate(input.createdEvent.starts_at, input.language),
      timeLabel: `${formatEventTime(input.createdEvent.starts_at, input.language)}-${formatEventTime(
        input.createdEvent.ends_at,
        input.language,
      )}`,
      playerCountLabel: input.t('events.create.summary.players', {
        count: input.createdEvent.player_count_total,
      }),
      reservationLabel: input.t(`events.reservationType.${input.createdEvent.reservation_type}`),
    },
    shareUrl,
    shareMessage: input.t('events.detail.shareMessage', {
      sport: sportName,
      venue: input.venueName,
      date: shareDate,
      url: shareUrl,
    }),
  };
}

function getSportNote(
  sport: SportSummary,
  t: ReturnType<typeof useTranslation>['t'],
  language: AppLanguage,
) {
  if (sport.slug === 'padel') {
    return t('events.create.sportNotes.padel');
  }

  if (sport.slug === 'badminton') {
    return t('events.create.sportNotes.badminton');
  }

  if (sport.slug === 'squash') {
    return t('events.create.sportNotes.squash');
  }

  if (sport.slug === 'tennis') {
    return t('events.create.sportNotes.tennis');
  }

  return language === 'cs' ? sport.nameCs : sport.nameEn;
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
      skillMin: z.number().int().min(1).max(4).nullable(),
      skillMax: z.number().int().min(1).max(4).nullable(),
      description: z
        .string()
        .max(500, t('events.create.validation.description'))
        .optional()
        .or(z.literal('')),
    })
    .superRefine((value, context) => {
      if (value.skillMin === null || value.skillMax === null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'events.create.validation.skillRequired',
          path: ['skillMax'],
        });

        return;
      }

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

function CreateScreenHeader({
  title,
  onBack,
  topInset,
}: {
  title: string;
  onBack: () => void;
  topInset: number;
}) {
  return (
    <View style={[styles.topBar, { paddingTop: topInset + 8 }]}>
      <Pressable
        accessibilityHint={title}
        accessibilityLabel={title}
        accessibilityRole="button"
        onPress={onBack}
        style={styles.backButton}
      >
        <Ionicons color="#183153" name="chevron-back-outline" size={22} />
      </Pressable>
      <Text style={styles.topBarTitle}>{title}</Text>
      <View style={styles.topBarSpacer} />
    </View>
  );
}

function StepBadge({ value }: { value: string }) {
  return (
    <View style={styles.stepBadge}>
      <Text style={styles.stepBadgeLabel}>{value}</Text>
    </View>
  );
}

function FormSection({
  step,
  title,
  description,
  children,
}: {
  step: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.sectionBlock}>
      <View style={styles.sectionTitleRow}>
        <StepBadge value={step} />
        <Text style={styles.sectionHeadline}>{title}</Text>
      </View>
      <Text style={styles.sectionDescription}>{description}</Text>
      {children}
    </View>
  );
}

function SportCard({
  sport,
  selected,
  note,
  onPress,
  language,
}: {
  sport: SportSummary;
  selected: boolean;
  note: string;
  onPress: () => void;
  language: AppLanguage;
}) {
  const sportName = language === 'cs' ? sport.nameCs : sport.nameEn;

  return (
    <Pressable
      accessibilityLabel={sportName}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.sportCard, selected ? styles.sportCardSelected : undefined]}
    >
      <View style={styles.sportCardTop}>
        <SportBadge colorHex={sport.colorHex} label={getSportBadgeLabel(sport.slug, sportName)} />
        {selected ? (
          <View style={styles.sportSelectedIcon}>
            <Ionicons color="#10233f" name="checkmark" size={16} />
          </View>
        ) : null}
      </View>
      <Text style={[styles.sportCardTitle, selected ? styles.sportCardTitleSelected : undefined]}>
        {sportName}
      </Text>
      <Text style={[styles.sportCardNote, selected ? styles.sportCardNoteSelected : undefined]}>
        {note}
      </Text>
    </Pressable>
  );
}

function PickerCard({
  label,
  value,
  helper,
  onPress,
  iconName,
  emphasized = false,
  error,
}: {
  label: string;
  value: string;
  helper?: string;
  onPress: () => void;
  iconName: React.ComponentProps<typeof Ionicons>['name'];
  emphasized?: boolean;
  error?: string | null;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.pickerCard,
        emphasized ? styles.pickerCardEmphasized : undefined,
        error ? styles.pickerCardError : undefined,
      ]}
    >
      <View style={styles.pickerCardLabelRow}>
        <Ionicons color={emphasized ? '#d8ff45' : '#9aa7b6'} name={iconName} size={15} />
        <Text style={styles.pickerCardLabel}>{label}</Text>
      </View>
      <Text style={[styles.pickerCardValue, emphasized ? styles.pickerCardValueBig : undefined]}>
        {value}
      </Text>
      {helper ? <Text style={styles.pickerCardHelper}>{helper}</Text> : null}
      <Ionicons
        color="#9aa7b6"
        name="chevron-forward-outline"
        size={18}
        style={styles.pickerChevron}
      />
    </Pressable>
  );
}

function DurationChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.durationChip, selected ? styles.durationChipSelected : undefined]}
    >
      <Text
        style={[styles.durationChipLabel, selected ? styles.durationChipLabelSelected : undefined]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function VenueFilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.venueFilterChip, selected ? styles.venueFilterChipSelected : undefined]}
    >
      <Text
        style={[
          styles.venueFilterChipLabel,
          selected ? styles.venueFilterChipLabelSelected : undefined,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function VenueCard({
  venue,
  selected,
  isMine,
  onPress,
  t,
}: {
  venue: VenueSummary;
  selected: boolean;
  isMine: boolean;
  onPress: () => void;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const statusLabel = selected
    ? t('events.create.venueMeta.selected')
    : venue.isVerified
      ? t('events.create.venueMeta.verified')
      : t('events.create.venueMeta.community');
  const metaRight = isMine ? t('events.create.venueFilters.mine') : venue.city;

  return (
    <Pressable
      accessibilityLabel={venue.name}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.venueCard, selected ? styles.venueCardSelected : undefined]}
    >
      <View
        style={[styles.venueCardIconWrap, selected ? styles.venueCardIconWrapSelected : undefined]}
      >
        <Ionicons color={selected ? '#d8ff45' : '#7c8797'} name="location-outline" size={20} />
      </View>
      <View style={styles.venueCardCopy}>
        <View style={styles.venueCardTitleRow}>
          <Text
            numberOfLines={2}
            style={[styles.venueCardTitle, selected ? styles.venueCardTitleSelected : undefined]}
          >
            {venue.name}
          </Text>
          {selected ? (
            <View style={styles.venueSelectedCheck}>
              <Ionicons color="#10233f" name="checkmark" size={16} />
            </View>
          ) : null}
        </View>
        <Text
          numberOfLines={2}
          style={[styles.venueCardAddress, selected ? styles.venueCardAddressSelected : undefined]}
        >
          {venue.address ?? t('events.venue.noAddress')}
        </Text>
        <View style={styles.venueMetaRow}>
          <View
            style={[styles.venueMetaBadge, selected ? styles.venueMetaBadgeSelected : undefined]}
          >
            <Text
              style={[
                styles.venueMetaBadgeLabel,
                selected ? styles.venueMetaBadgeLabelSelected : undefined,
              ]}
            >
              {statusLabel}
            </Text>
          </View>
          <Text style={[styles.venueMetaText, selected ? styles.venueMetaTextSelected : undefined]}>
            {metaRight}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function SkillLevelCard({
  value,
  selected,
  label,
  shortLabel,
  onPress,
}: {
  value: number;
  selected: boolean;
  label: string;
  shortLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.skillCard, selected ? styles.skillCardSelected : undefined]}
    >
      <Text style={[styles.skillShortLabel, selected ? styles.skillShortLabelSelected : undefined]}>
        {shortLabel}
      </Text>
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.86}
        numberOfLines={2}
        style={[styles.skillLongLabel, selected ? styles.skillLongLabelSelected : undefined]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SkillSelectionSummary({
  minimum,
  maximum,
  t,
  onClear,
}: {
  minimum: number | null;
  maximum: number | null;
  t: ReturnType<typeof useTranslation>['t'];
  onClear: () => void;
}) {
  const hasSelection = minimum !== null && maximum !== null;
  const minimumLabel = minimum ? t(`events.skillLevel.short.${minimum}`) : '—';
  const maximumLabel = maximum ? t(`events.skillLevel.short.${maximum}`) : '—';

  return (
    <View style={styles.skillSummaryCard}>
      <View style={styles.skillSummaryTopRow}>
        <View style={styles.skillSummaryPill}>
          <Text style={styles.skillSummaryPillLabel}>{t('events.create.skillRangeMinLabel')}</Text>
          <Text style={styles.skillSummaryPillValue}>{minimumLabel}</Text>
        </View>
        <View style={styles.skillSummaryPill}>
          <Text style={styles.skillSummaryPillLabel}>{t('events.create.skillRangeMaxLabel')}</Text>
          <Text style={styles.skillSummaryPillValue}>{maximumLabel}</Text>
        </View>
        {hasSelection ? (
          <Pressable
            accessibilityLabel={t('events.create.clearSkillSelection')}
            accessibilityRole="button"
            onPress={onClear}
            style={styles.skillClearButton}
          >
            <Text style={styles.skillClearButtonLabel}>
              {t('events.create.clearSkillSelection')}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {hasSelection ? (
        <Text style={styles.skillSummaryBody}>
          {minimum === maximum
            ? t('events.create.skillSummarySingle', {
                level: t(`events.skillLevel.label.${minimum}`),
              })
            : t('events.create.skillSummaryRange', {
                min: t(`events.skillLevel.short.${minimum}`),
                max: t(`events.skillLevel.short.${maximum}`),
              })}
        </Text>
      ) : null}
    </View>
  );
}

function CompactCountStepper({
  label,
  value,
  minimum,
  maximum,
  onChange,
}: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  onChange: (next: number) => void;
}) {
  return (
    <View style={styles.compactFieldCard}>
      <Text style={styles.compactFieldLabel}>{label}</Text>
      <View style={styles.compactStepperRow}>
        <Pressable
          accessibilityLabel={`${label} -`}
          accessibilityRole="button"
          disabled={value <= minimum}
          onPress={() => onChange(Math.max(minimum, value - 1))}
          style={[
            styles.compactStepperButton,
            value <= minimum ? styles.compactStepperButtonDisabled : undefined,
          ]}
        >
          <Ionicons color="#183153" name="remove" size={18} />
        </Pressable>
        <Text style={styles.compactStepperValue}>{value}</Text>
        <Pressable
          accessibilityLabel={`${label} +`}
          accessibilityRole="button"
          disabled={value >= maximum}
          onPress={() => onChange(Math.min(maximum, value + 1))}
          style={[
            styles.compactStepperButton,
            value >= maximum ? styles.compactStepperButtonDisabled : undefined,
          ]}
        >
          <Ionicons color="#183153" name="add" size={18} />
        </Pressable>
      </View>
    </View>
  );
}

function ReservationToggle({
  value,
  onChange,
  t,
}: {
  value: ReservationType;
  onChange: (next: ReservationType) => void;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  return (
    <View style={styles.compactFieldCard}>
      <Text style={styles.compactFieldLabel}>{t('events.create.reservationType')}</Text>
      <View style={styles.toggleRow}>
        {(['reserved', 'to_be_arranged'] as const).map((option) => {
          const selected = option === value;

          return (
            <Pressable
              accessibilityLabel={t(`events.reservationType.${option}`)}
              accessibilityRole="button"
              key={option}
              onPress={() => onChange(option)}
              style={[styles.togglePill, selected ? styles.togglePillSelected : undefined]}
            >
              <Text
                style={[
                  styles.togglePillLabel,
                  selected ? styles.togglePillLabelSelected : undefined,
                ]}
              >
                {t(`events.reservationType.${option}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function DescriptionSuggestionChip({
  label,
  iconName,
  onPress,
}: {
  label: string;
  iconName: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.suggestionChip}
    >
      <Ionicons color="#8ea0b4" name={iconName} size={12} />
      <Text style={styles.suggestionChipLabel}>{label}</Text>
    </Pressable>
  );
}

function StickySubmitCard({
  sport,
  venueName,
  startTime,
  endTime,
  language,
  playerCountTotal,
  skillRangeLabel,
  buttonLabel,
  disabled,
  isLoading,
  onPress,
  t,
}: {
  sport: SportSummary | undefined;
  venueName: string;
  startTime: Date;
  endTime: Date;
  language: AppLanguage;
  playerCountTotal: number;
  skillRangeLabel: string;
  buttonLabel: string;
  disabled: boolean;
  isLoading: boolean;
  onPress: () => void;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const sportName = sport
    ? language === 'cs'
      ? sport.nameCs
      : sport.nameEn
    : t('events.create.previewSportFallback');

  return (
    <View style={styles.stickyFooterCard}>
      <View style={styles.stickyFooterHeader}>
        <View style={styles.stickyFooterIdentity}>
          {sport ? (
            <SportBadge
              colorHex={sport.colorHex}
              label={getSportBadgeLabel(sport.slug, sportName)}
            />
          ) : (
            <View style={styles.stickyFooterPlaceholder}>
              <Ionicons color="#a7b5c4" name="tennisball-outline" size={18} />
            </View>
          )}
          <View style={styles.stickyFooterCopy}>
            <Text numberOfLines={1} style={styles.stickyFooterTitle}>
              {sportName}
              {venueName ? ` · ${venueName}` : ''}
            </Text>
            <Text numberOfLines={1} style={styles.stickyFooterMeta}>
              {formatEventDate(startTime, language)} · {formatEventTime(startTime, language)}-
              {formatEventTime(endTime, language)} · {skillRangeLabel}
            </Text>
          </View>
        </View>
        <View style={styles.stickyFooterStats}>
          <Text style={styles.stickyFooterPlayers}>
            {t('events.create.summary.players', { count: playerCountTotal })}
          </Text>
        </View>
      </View>

      <Pressable
        accessibilityLabel={buttonLabel}
        accessibilityRole="button"
        disabled={disabled}
        onPress={onPress}
        style={[
          styles.stickySubmitButton,
          disabled ? styles.stickySubmitButtonDisabled : undefined,
        ]}
      >
        {isLoading ? <ActivityIndicator color="#10233f" size="small" /> : null}
        <Text style={styles.stickySubmitButtonLabel}>{buttonLabel}</Text>
        {!isLoading ? <Ionicons color="#10233f" name="arrow-forward" size={18} /> : null}
      </Pressable>
    </View>
  );
}

function EventFormScreen({ mode, eventId }: { mode: EventFormMode; eventId?: string }) {
  const navigation = useNavigation<RootNavigation>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const scrollViewRef = useRef<ScrollView>(null);
  const descriptionCardOffsetRef = useRef(0);
  const overlayScreenScale = useRef(new Animated.Value(1)).current;
  const overlayScreenTranslateY = useRef(new Animated.Value(0)).current;
  const overlayScreenOpacity = useRef(new Animated.Value(1)).current;
  const userId = useAuthStore((state) => state.userId);
  const selectedCity = useUserStore((state) => state.selectedCity);
  const language = useUserStore((state) => state.language);
  const isEditMode = mode === 'edit';
  const setAuthNotice = useUIStore((state) => state.setAuthNotice);
  const notice = useUIStore((state) => state.authNotice);
  const clearAuthNotice = useUIStore((state) => state.clearAuthNotice);
  const [venueSearchInput, setVenueSearchInput] = useState('');
  const [debouncedVenueSearch, setDebouncedVenueSearch] = useState('');
  const [selectedVenue, setSelectedVenue] = useState<VenueSummary | null>(null);
  const [showInlineVenueForm, setShowInlineVenueForm] = useState(false);
  const [showAllVenues, setShowAllVenues] = useState(false);
  const [activeVenueFilter, setActiveVenueFilter] = useState<VenueFilterMode>('all');
  const [isSkillModalVisible, setIsSkillModalVisible] = useState(false);
  const [pendingEventInput, setPendingEventInput] = useState<CreateEventInput | null>(null);
  const [pendingSportId, setPendingSportId] = useState<string | null>(null);
  const [selectedSkillLevel, setSelectedSkillLevel] = useState<number | null>(null);
  const [prefilledEventId, setPrefilledEventId] = useState<string | null>(null);
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>(null);
  const [pickerDraftValue, setPickerDraftValue] = useState(new Date());
  const [isDescriptionFocused, setIsDescriptionFocused] = useState(false);
  const [successState, setSuccessState] = useState<CreateEventSuccessState | null>(null);
  const [isSuccessActionPending, setIsSuccessActionPending] = useState(false);

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
      skillMin: null,
      skillMax: null,
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

  const formValues = eventForm.watch();

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedVenueSearch(venueSearchInput.trim());
    }, 250);

    return () => clearTimeout(handle);
  }, [venueSearchInput]);

  useEffect(() => {
    setShowAllVenues(false);
  }, [debouncedVenueSearch, activeVenueFilter, selectedCity]);

  useEffect(() => {
    if (!isDescriptionFocused) {
      return;
    }

    const scrollToComposer = () => {
      const revealOffset = insets.top + 138;
      const nextPosition = Math.max(descriptionCardOffsetRef.current - revealOffset, 0);
      scrollViewRef.current?.scrollTo({ y: nextPosition, animated: true });
    };

    const initialHandle = setTimeout(scrollToComposer, 110);

    return () => {
      clearTimeout(initialHandle);
    };
  }, [insets.top, isDescriptionFocused]);

  useEffect(() => {
    const isOverlayVisible = Boolean(successState);
    const entrance = Animated.parallel([
      Animated.timing(overlayScreenScale, {
        toValue: isOverlayVisible ? 0.972 : 1,
        duration: isOverlayVisible ? 240 : 180,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(overlayScreenTranslateY, {
        toValue: isOverlayVisible ? -10 : 0,
        duration: isOverlayVisible ? 240 : 180,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(overlayScreenOpacity, {
        toValue: isOverlayVisible ? 0.18 : 1,
        duration: isOverlayVisible ? 220 : 180,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    ]);

    entrance.start();

    return () => {
      entrance.stop();
    };
  }, [overlayScreenOpacity, overlayScreenScale, overlayScreenTranslateY, successState]);

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
    onSuccess: (createdEvent) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSuccessState(
        buildCreateEventSuccessState({
          createdEvent,
          selectedSport,
          venueName: previewVenueName,
          language,
          t,
        }),
      );
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['events', 'feed'] }),
        queryClient.invalidateQueries({ queryKey: ['events', 'my-games'] }),
      ]);
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
    filteredVenueMatchesFromAll({
      venues: venueMatchesQuery.data ?? [],
      activeFilter: activeVenueFilter,
      userId,
    }).length === 0;

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
    if (createEventMutation.isPending || updateEventMutation.isPending || successState) {
      return;
    }

    clearAuthNotice();
    setIsDescriptionFocused(false);
    Keyboard.dismiss();

    if (values.skillMin === null || values.skillMax === null) {
      setAuthNotice({
        messageKey: 'events.create.validation.skillRequired',
        tone: 'error',
      });
      return;
    }

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

  function finishSuccessFlow(nextEventId: string) {
    setIsSuccessActionPending(false);
    setSuccessState(null);
    navigation.navigate('EventDetail', { eventId: nextEventId });
  }

  function handleSuccessClose() {
    if (!successState || isSuccessActionPending) {
      return;
    }

    setIsSuccessActionPending(true);
    finishSuccessFlow(successState.eventId);
  }

  async function handleSuccessInvite() {
    if (!successState || isSuccessActionPending) {
      return;
    }

    setIsSuccessActionPending(true);

    try {
      await Share.share({
        title: t('events.detail.shareAction'),
        url: successState.shareUrl,
        message: successState.shareMessage,
      });
    } catch {
      // Ignore share-sheet failures and continue to detail so the create flow never dead-ends.
    } finally {
      finishSuccessFlow(successState.eventId);
    }
  }

  const selectedSport = (sportsQuery.data ?? []).find((sport) => sport.id === formValues.sportId);
  const skillModalSport = (sportsQuery.data ?? []).find((sport) => sport.id === pendingSportId);
  const descriptionLength = formValues.description?.length ?? 0;
  const previewVenueName = selectedVenue?.name ?? t('events.create.previewVenueFallback');
  const isSubmitting = createEventMutation.isPending || updateEventMutation.isPending;
  const submitLabel = isEditMode ? t('events.edit.submit') : t('events.create.submit');
  const submitFeedbackLabel = isSubmitting
    ? isEditMode
      ? t('events.edit.submitting')
      : t('events.create.submitting')
    : submitLabel;
  const durationMinutes = getDurationMinutes(formValues.startTime, formValues.endTime);
  const skillRangeLabel = getSkillRangeLabel(t, formValues.skillMin, formValues.skillMax);
  const previewStartsAt = combineLocalDateAndTime(formValues.eventDate, formValues.startTime);
  const previewEndsAt = combineLocalDateAndTime(formValues.eventDate, formValues.endTime);
  const visibleNotice = notice?.messageKey.startsWith('events.') ? notice : null;
  const isSuccessOverlayVisible = Boolean(successState);
  const isInteractionLocked = isSubmitting || isSuccessOverlayVisible || isSuccessActionPending;

  const venueFilters = useMemo(
    () => [
      { value: 'all' as const, label: t('events.create.venueFilters.all') },
      { value: 'verified' as const, label: t('events.create.venueFilters.verified') },
      { value: 'community' as const, label: t('events.create.venueFilters.community') },
      { value: 'mine' as const, label: t('events.create.venueFilters.mine') },
    ],
    [t],
  );

  const filteredVenueMatches = useMemo(() => {
    const filtered = filteredVenueMatchesFromAll({
      venues: venueMatchesQuery.data ?? [],
      activeFilter: activeVenueFilter,
      userId,
    });

    const selectedId = selectedVenue?.id;
    const withSelected =
      selectedVenue && !filtered.some((venue) => venue.id === selectedVenue.id)
        ? [selectedVenue, ...filtered]
        : filtered;

    return withSelected.sort((left, right) => {
      if (left.id === selectedId) {
        return -1;
      }

      if (right.id === selectedId) {
        return 1;
      }

      if (left.isVerified !== right.isVerified) {
        return left.isVerified ? -1 : 1;
      }

      return left.name.localeCompare(right.name, language === 'cs' ? 'cs' : 'en');
    });
  }, [activeVenueFilter, language, selectedVenue, userId, venueMatchesQuery.data]);

  const visibleVenueMatches = showAllVenues
    ? filteredVenueMatches
    : filteredVenueMatches.slice(0, 4);
  const hiddenVenueCount = Math.max(filteredVenueMatches.length - visibleVenueMatches.length, 0);

  function handleBackPress() {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    navigation.navigate('MainTabs', {
      screen: 'HomeTab',
      params: {
        screen: 'HomeFeed',
      },
    });
  }

  const setFormValue: typeof eventForm.setValue = (key, value, options) => {
    eventForm.setValue(key, value, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
      ...options,
    });
  };

  function openPicker(target: PickerTarget, value: Date) {
    setPickerDraftValue(value);
    setPickerTarget(target);
  }

  function confirmPicker() {
    if (!pickerTarget) {
      return;
    }

    if (pickerTarget === 'date') {
      setFormValue('eventDate', pickerDraftValue);
    }

    if (pickerTarget === 'start') {
      const nextStart = pickerDraftValue;
      const nextDuration = durationMinutes > 0 ? durationMinutes : 90;
      setFormValue('startTime', nextStart);
      setFormValue('endTime', addMinutesToClock(nextStart, nextDuration));
    }

    if (pickerTarget === 'end') {
      setFormValue('endTime', pickerDraftValue);
    }

    setPickerTarget(null);
  }

  function handleDurationSelect(minutes: number) {
    setFormValue('endTime', addMinutesToClock(formValues.startTime, minutes));
  }

  function handleSkillTap(value: SkillLevelValue) {
    const currentMin = formValues.skillMin;
    const currentMax = formValues.skillMax;

    if (currentMin === null || currentMax === null) {
      setFormValue('skillMin', value);
      setFormValue('skillMax', value);
      return;
    }

    if (currentMin === currentMax && currentMin === value) {
      setFormValue('skillMin', null);
      setFormValue('skillMax', null);
      return;
    }

    if (currentMin === currentMax) {
      setFormValue('skillMin', Math.min(currentMin, value) as SkillLevelValue);
      setFormValue('skillMax', Math.max(currentMax, value) as SkillLevelValue);
      return;
    }

    if (value < currentMin) {
      setFormValue('skillMin', value);
      return;
    }

    if (value > currentMax) {
      setFormValue('skillMax', value);
      return;
    }

    setFormValue('skillMin', value);
    setFormValue('skillMax', value);
  }

  function clearSkillSelection() {
    setFormValue('skillMin', null);
    setFormValue('skillMax', null);
  }

  function applyDescriptionSuggestion(nextSnippet: string) {
    const current = formValues.description?.trim() ?? '';

    if (current.includes(nextSnippet)) {
      return;
    }

    const nextValue = current ? `${current}\n${nextSnippet}` : nextSnippet;
    setFormValue('description', nextValue);
  }

  const noteSuggestions = [
    {
      key: 'balls',
      label: t('events.create.noteSuggestions.balls'),
      body: t('events.create.noteSuggestionBodies.balls'),
      iconName: 'tennisball-outline' as const,
    },
    {
      key: 'tips',
      label: t('events.create.noteSuggestions.tips'),
      body: t('events.create.noteSuggestionBodies.tips'),
      iconName: 'bulb-outline' as const,
    },
    {
      key: 'parking',
      label: t('events.create.noteSuggestions.parking'),
      body: t('events.create.noteSuggestionBodies.parking'),
      iconName: 'car-outline' as const,
    },
  ];

  const sports = sportsQuery.data ?? [];
  const isCreateMode = !isEditMode;
  const footerBottomPadding = Math.max(insets.bottom + 6, 20);

  const createHeroTitle = t('events.create.hero.title');
  const createHeroSubtitle = t('events.create.hero.subtitle');
  const editHeroTitle = t('events.edit.title');
  const editHeroSubtitle = t('events.edit.subtitle');

  const blockingCard =
    isEditMode && editingEventQuery.isPending ? (
      <View style={styles.blockingCard}>
        <ActivityIndicator color="#183153" />
        <Text style={styles.blockingTitle}>{t('events.edit.loadingTitle')}</Text>
        <Text style={styles.blockingBody}>{t('events.edit.loadingBody')}</Text>
      </View>
    ) : isEditMode && (editingEventQuery.isError || !editingEventQuery.data) ? (
      <View style={styles.blockingCard}>
        <Text style={styles.blockingTitle}>{t('events.edit.errors.loadTitle')}</Text>
        <Text style={styles.blockingBody}>{t('events.edit.errors.loadBody')}</Text>
        <ActionButton
          label={t('events.common.retry')}
          onPress={async () => {
            await editingEventQuery.refetch();
          }}
        />
      </View>
    ) : isEditMode && editingEventQuery.data && !canOrganizerEditEvent(editingEventQuery.data) ? (
      <View style={styles.blockingCard}>
        <Text style={styles.blockingTitle}>{t('events.edit.errors.unavailableTitle')}</Text>
        <Text style={styles.blockingBody}>{t('events.edit.errors.unavailableBody')}</Text>
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
    ) : null;

  return (
    <View style={styles.screen}>
      <Animated.View
        style={[
          styles.screenLayer,
          {
            opacity: overlayScreenOpacity,
            transform: [{ scale: overlayScreenScale }, { translateY: overlayScreenTranslateY }],
          },
        ]}
      >
        {isCreateMode ? (
          <CreateScreenHeader
            onBack={handleBackPress}
            title={t('navigation.titles.createEvent')}
            topInset={insets.top}
          />
        ) : null}

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 72 : 0}
          style={styles.flex}
        >
          <ScrollView
            ref={scrollViewRef}
            contentContainerStyle={[
              styles.scrollContent,
              {
                paddingTop: isCreateMode ? 8 : 18,
                paddingBottom: 206 + footerBottomPadding,
              },
            ]}
            scrollEnabled={!isInteractionLocked}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.heroCard}>
              {isCreateMode ? (
                <>
                  <Text style={styles.heroTitle}>{createHeroTitle}</Text>
                  <Text style={styles.heroSubtitle}>{createHeroSubtitle}</Text>
                </>
              ) : (
                <>
                  <Text style={styles.heroEyebrow}>{t('events.edit.title')}</Text>
                  <Text style={styles.heroTitle}>{editHeroTitle}</Text>
                  <Text style={styles.heroSubtitle}>{editHeroSubtitle}</Text>
                </>
              )}
            </View>

            {blockingCard ? (
              blockingCard
            ) : (
              <View style={styles.formStack}>
                <NoticeBanner notice={visibleNotice} resolveMessage={t} />

                <FormSection
                  description={t('events.create.sections.sportDescription')}
                  step="01"
                  title={t('events.create.sections.sportQuestion')}
                >
                  {isEditMode ? (
                    <View style={styles.lockedCard}>
                      <View style={styles.lockedCardHeader}>
                        {selectedSport ? (
                          <SportBadge
                            colorHex={selectedSport.colorHex}
                            label={getSportBadgeLabel(
                              selectedSport.slug,
                              language === 'cs' ? selectedSport.nameCs : selectedSport.nameEn,
                            )}
                          />
                        ) : null}
                        <View style={styles.lockedCardCopy}>
                          <Text style={styles.lockedCardTitle}>
                            {selectedSport
                              ? language === 'cs'
                                ? selectedSport.nameCs
                                : selectedSport.nameEn
                              : t('events.create.previewSportFallback')}
                          </Text>
                          <Text style={styles.lockedCardBody}>{t('events.edit.sportLocked')}</Text>
                        </View>
                      </View>
                    </View>
                  ) : sportsQuery.isPending ? (
                    <View style={styles.loadingCard}>
                      <ActivityIndicator color="#183153" />
                    </View>
                  ) : sportsQuery.isError ? (
                    <View style={styles.inlineStateCard}>
                      <Text style={styles.inlineStateBody}>
                        {t('events.common.errors.generic')}
                      </Text>
                      <ActionButton
                        label={t('events.common.retry')}
                        onPress={async () => {
                          await sportsQuery.refetch();
                        }}
                        variant="secondary"
                      />
                    </View>
                  ) : (
                    <View style={styles.sportGrid}>
                      {sports.map((sport) => (
                        <SportCard
                          key={sport.id}
                          language={language}
                          note={getSportNote(sport, t, language)}
                          onPress={() => setFormValue('sportId', sport.id)}
                          selected={formValues.sportId === sport.id}
                          sport={sport}
                        />
                      ))}
                    </View>
                  )}

                  {eventForm.formState.errors.sportId?.message ? (
                    <Text style={styles.errorText}>
                      {translateFieldError(t, eventForm.formState.errors.sportId.message)}
                    </Text>
                  ) : null}
                </FormSection>

                <FormSection
                  description={t('events.create.sections.scheduleDescription')}
                  step="02"
                  title={t('events.create.sections.scheduleQuestion')}
                >
                  <PickerCard
                    emphasized
                    helper={t('events.create.eventDatePlaceholder')}
                    iconName="calendar-clear-outline"
                    label={t('events.create.eventDate')}
                    onPress={() => openPicker('date', formValues.eventDate)}
                    value={formatEventDate(formValues.eventDate, language)}
                  />

                  <View style={styles.scheduleRow}>
                    <View style={styles.scheduleCardWrap}>
                      <PickerCard
                        error={translateFieldError(
                          t,
                          eventForm.formState.errors.startTime?.message,
                        )}
                        iconName="time-outline"
                        label={t('events.create.startTime')}
                        onPress={() => openPicker('start', formValues.startTime)}
                        value={formatEventTime(formValues.startTime, language)}
                      />
                    </View>
                    <View style={styles.scheduleCardWrap}>
                      <PickerCard
                        error={translateFieldError(t, eventForm.formState.errors.endTime?.message)}
                        iconName="ellipse"
                        label={t('events.create.endTime')}
                        onPress={() => openPicker('end', formValues.endTime)}
                        value={formatEventTime(formValues.endTime, language)}
                      />
                    </View>
                  </View>

                  <View style={styles.durationRow}>
                    {durationOptions.map((minutes) => (
                      <DurationChip
                        key={minutes}
                        label={t('events.create.durationAuto', { minutes })}
                        onPress={() => handleDurationSelect(minutes)}
                        selected={durationMinutes === minutes}
                      />
                    ))}
                  </View>
                </FormSection>

                <FormSection
                  description={t('events.create.sections.venueDescription')}
                  step="03"
                  title={t('events.create.sections.venueQuestion')}
                >
                  <View style={styles.searchShell}>
                    <Ionicons color="#98a5b5" name="search-outline" size={18} />
                    <TextInput
                      accessibilityLabel={t('events.create.venueSearch')}
                      editable={!isInteractionLocked}
                      onChangeText={(nextValue) => {
                        setVenueSearchInput(nextValue);

                        if (selectedVenue && nextValue.trim() !== selectedVenue.name) {
                          setSelectedVenue(null);
                          eventForm.setValue('venueId', '', {
                            shouldDirty: true,
                            shouldValidate: true,
                          });
                        }
                      }}
                      placeholder={t('events.create.venueSearchPlaceholder')}
                      placeholderTextColor="#97a5b7"
                      style={styles.searchInput}
                      value={venueSearchInput}
                    />
                    <View style={styles.cityPill}>
                      <Text style={styles.cityPillLabel}>{selectedCity ?? 'CZ'}</Text>
                    </View>
                  </View>

                  <ScrollView
                    contentContainerStyle={styles.venueFiltersRow}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                  >
                    {venueFilters.map((filter) => (
                      <VenueFilterChip
                        key={filter.value}
                        label={filter.label}
                        onPress={() => setActiveVenueFilter(filter.value)}
                        selected={activeVenueFilter === filter.value}
                      />
                    ))}
                  </ScrollView>

                  {!selectedCity ? (
                    <View style={styles.inlineStateCard}>
                      <Text style={styles.inlineStateBody}>
                        {t('events.venue.errors.cityRequired')}
                      </Text>
                    </View>
                  ) : venueMatchesQuery.isPending ? (
                    <View style={styles.loadingCard}>
                      <ActivityIndicator color="#183153" />
                    </View>
                  ) : venueMatchesQuery.isError ? (
                    <View style={styles.inlineStateCard}>
                      <Text style={styles.inlineStateBody}>
                        {t('events.common.errors.generic')}
                      </Text>
                      <ActionButton
                        label={t('events.common.retry')}
                        onPress={async () => {
                          await venueMatchesQuery.refetch();
                        }}
                        variant="secondary"
                      />
                    </View>
                  ) : visibleVenueMatches.length ? (
                    <View style={styles.venueList}>
                      {visibleVenueMatches.map((venue) => (
                        <VenueCard
                          isMine={venue.createdBy === userId}
                          key={venue.id}
                          onPress={() => {
                            setSelectedVenue(venue);
                            setVenueSearchInput(venue.name);
                            setShowInlineVenueForm(false);
                            setFormValue('venueId', venue.id);
                          }}
                          selected={selectedVenue?.id === venue.id}
                          t={t}
                          venue={venue}
                        />
                      ))}
                      {hiddenVenueCount > 0 ? (
                        <Pressable
                          accessibilityLabel={t('events.create.showAllVenues')}
                          accessibilityRole="button"
                          onPress={() => setShowAllVenues(true)}
                          style={styles.showMoreVenuesButton}
                        >
                          <Text style={styles.showMoreVenuesLabel}>
                            {t('events.create.showAllVenues')}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}

                  {canOfferInlineVenue ? (
                    <View style={styles.inlineVenuePrompt}>
                      <Text style={styles.inlineVenuePromptText}>{t('events.venue.noMatch')}</Text>
                      <ActionButton
                        iconName="add-circle-outline"
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
                        iconName="save-outline"
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
                </FormSection>

                <FormSection
                  description={t('events.create.sections.skillDescription')}
                  step="04"
                  title={t('events.create.sections.skillQuestion')}
                >
                  <View style={styles.skillRow}>
                    {skillLevelValues.map((value) => (
                      <SkillLevelCard
                        key={value}
                        label={t(`events.skillLevel.label.${value}`)}
                        onPress={() => handleSkillTap(value)}
                        selected={
                          formValues.skillMin !== null &&
                          formValues.skillMax !== null &&
                          value >= formValues.skillMin &&
                          value <= formValues.skillMax
                        }
                        shortLabel={t(`events.skillLevel.short.${value}`)}
                        value={value}
                      />
                    ))}
                  </View>

                  <SkillSelectionSummary
                    maximum={formValues.skillMax}
                    minimum={formValues.skillMin}
                    onClear={clearSkillSelection}
                    t={t}
                  />

                  {eventForm.formState.errors.skillMax?.message ? (
                    <Text style={styles.errorText}>
                      {translateFieldError(t, eventForm.formState.errors.skillMax.message)}
                    </Text>
                  ) : null}

                  <View style={styles.compactControlsRow}>
                    <CompactCountStepper
                      label={t('events.create.playerCountCompact')}
                      maximum={20}
                      minimum={2}
                      onChange={(nextValue) => setFormValue('playerCountTotal', nextValue)}
                      value={formValues.playerCountTotal}
                    />
                    <ReservationToggle
                      onChange={(nextValue) => setFormValue('reservationType', nextValue)}
                      t={t}
                      value={formValues.reservationType}
                    />
                  </View>
                </FormSection>

                <FormSection
                  description={t('events.create.sections.detailsDescription')}
                  step="05"
                  title={t('events.create.sections.detailsQuestion')}
                >
                  <View
                    onLayout={(event) => {
                      descriptionCardOffsetRef.current = event.nativeEvent.layout.y;
                    }}
                    style={styles.descriptionCard}
                  >
                    <Text style={styles.descriptionLabel}>{t('events.create.description')}</Text>
                    <TextInput
                      accessibilityLabel={t('events.create.description')}
                      editable={!isInteractionLocked}
                      inputAccessoryViewID={
                        Platform.OS === 'ios' ? descriptionAccessoryId : undefined
                      }
                      multiline
                      numberOfLines={5}
                      onBlur={() => setIsDescriptionFocused(false)}
                      onChangeText={(nextValue) => setFormValue('description', nextValue)}
                      onFocus={() => setIsDescriptionFocused(true)}
                      placeholder={t('events.create.descriptionPlaceholder')}
                      placeholderTextColor="#97a5b7"
                      returnKeyType="default"
                      style={[
                        styles.descriptionInput,
                        eventForm.formState.errors.description
                          ? styles.descriptionInputError
                          : undefined,
                      ]}
                      textAlignVertical="top"
                      value={formValues.description ?? ''}
                    />

                    <View style={styles.descriptionFooter}>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <View style={styles.descriptionSuggestionsRow}>
                          {noteSuggestions.map((suggestion) => (
                            <DescriptionSuggestionChip
                              iconName={suggestion.iconName}
                              key={suggestion.key}
                              label={suggestion.label}
                              onPress={() => applyDescriptionSuggestion(suggestion.body)}
                            />
                          ))}
                        </View>
                      </ScrollView>
                      <Text style={styles.counterText}>
                        {t('events.create.descriptionCounter', {
                          count: descriptionLength,
                          max: 500,
                        })}
                      </Text>
                    </View>
                  </View>

                  {eventForm.formState.errors.description?.message ? (
                    <Text style={styles.errorText}>
                      {translateFieldError(t, eventForm.formState.errors.description.message)}
                    </Text>
                  ) : null}
                </FormSection>
              </View>
            )}
          </ScrollView>

          {!blockingCard && !isDescriptionFocused ? (
            <View
              style={[
                styles.stickyFooterWrap,
                {
                  paddingBottom: footerBottomPadding,
                },
              ]}
            >
              <StickySubmitCard
                buttonLabel={submitFeedbackLabel}
                disabled={!eventForm.formState.isValid || isInteractionLocked}
                endTime={previewEndsAt}
                isLoading={isSubmitting}
                language={language}
                onPress={eventForm.handleSubmit(handleEventSubmit)}
                playerCountTotal={formValues.playerCountTotal}
                skillRangeLabel={skillRangeLabel}
                sport={selectedSport}
                startTime={previewStartsAt}
                t={t}
                venueName={previewVenueName}
              />
            </View>
          ) : null}
        </KeyboardAvoidingView>

        {isInteractionLocked ? (
          <View pointerEvents="auto" style={styles.interactionShield} />
        ) : null}

        {Platform.OS === 'ios' ? (
          <InputAccessoryView nativeID={descriptionAccessoryId}>
            <View style={styles.keyboardAccessory}>
              <Pressable
                accessibilityLabel={t('events.create.hideKeyboard')}
                accessibilityRole="button"
                onPress={() => {
                  setIsDescriptionFocused(false);
                  Keyboard.dismiss();
                }}
                style={styles.keyboardAccessoryButton}
              >
                <Text style={styles.keyboardAccessoryButtonLabel}>
                  {t('events.create.hideKeyboard')}
                </Text>
              </Pressable>
            </View>
          </InputAccessoryView>
        ) : null}
      </Animated.View>

      <CreateEventSuccessOverlay
        closeLabel={t('events.create.successCloseAction')}
        isActionPending={isSuccessActionPending}
        onClose={handleSuccessClose}
        onPrimaryAction={handleSuccessInvite}
        onSecondaryAction={handleSuccessClose}
        primaryActionLabel={t('events.create.successInviteAction')}
        secondaryActionLabel={t('events.create.successCloseAction')}
        subtitle={t('events.create.successBody')}
        summary={successState?.summary ?? null}
        title={t('events.create.successTitle')}
        visible={isSuccessOverlayVisible}
      />

      {pickerTarget ? (
        <Modal
          animationType="slide"
          onRequestClose={() => setPickerTarget(null)}
          transparent
          visible
        >
          <Pressable onPress={() => setPickerTarget(null)} style={styles.pickerBackdrop}>
            <Pressable style={styles.pickerSheet}>
              <View style={styles.pickerHandle} />
              <Text style={styles.pickerSheetTitle}>
                {pickerTarget === 'date'
                  ? t('events.create.eventDate')
                  : pickerTarget === 'start'
                    ? t('events.create.startTime')
                    : t('events.create.endTime')}
              </Text>
              <DateTimePicker
                display="spinner"
                mode={pickerTarget === 'date' ? 'date' : 'time'}
                onChange={(_event, nextValue) => {
                  if (nextValue) {
                    setPickerDraftValue(nextValue);
                  }
                }}
                style={styles.pickerControl}
                value={pickerDraftValue}
              />
              <View style={styles.pickerActions}>
                <Pressable
                  accessibilityLabel={t('events.common.pickerCancel')}
                  accessibilityRole="button"
                  onPress={() => setPickerTarget(null)}
                  style={[styles.pickerActionButton, styles.pickerActionButtonSecondary]}
                >
                  <Text style={styles.pickerActionButtonSecondaryLabel}>
                    {t('events.common.pickerCancel')}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={t('events.common.pickerDone')}
                  accessibilityRole="button"
                  onPress={confirmPicker}
                  style={[styles.pickerActionButton, styles.pickerActionButtonPrimary]}
                >
                  <Text style={styles.pickerActionButtonPrimaryLabel}>
                    {t('events.common.pickerDone')}
                  </Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      <SkillLevelModal
        language={language}
        onClose={() => setIsSkillModalVisible(false)}
        onConfirm={handleConfirmSkillLevel}
        onSelectSkillLevel={setSelectedSkillLevel}
        selectedSkillLevel={selectedSkillLevel}
        sport={skillModalSport ?? null}
        visible={isSkillModalVisible}
      />
    </View>
  );
}

function filteredVenueMatchesFromAll({
  venues,
  activeFilter,
  userId,
}: {
  venues: VenueSummary[];
  activeFilter: VenueFilterMode;
  userId: string | null;
}) {
  if (activeFilter === 'verified') {
    return venues.filter((venue) => venue.isVerified);
  }

  if (activeFilter === 'community') {
    return venues.filter((venue) => !venue.isVerified);
  }

  if (activeFilter === 'mine') {
    return venues.filter((venue) => Boolean(userId) && venue.createdBy === userId);
  }

  return venues;
}

export function CreateEventScreen() {
  return <EventFormScreen mode="create" />;
}

export function EditEventScreen({ route }: { route: EditEventRoute }) {
  return <EventFormScreen eventId={route.params.eventId} mode="edit" />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f7f0e6',
  },
  screenLayer: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 8,
    backgroundColor: '#f7f0e6',
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#ede1d2',
  },
  topBarTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#132b4f',
  },
  topBarSpacer: {
    width: 42,
    height: 42,
  },
  scrollContent: {
    paddingHorizontal: 20,
    gap: 18,
  },
  heroCard: {
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingVertical: 20,
    backgroundColor: '#0f233f',
    borderWidth: 1,
    borderColor: '#1d3556',
  },
  heroEyebrow: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: '#8ea2bb',
  },
  heroTitle: {
    marginTop: 10,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '900',
    color: '#ffffff',
  },
  heroSubtitle: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 21,
    color: '#c7d5e5',
  },
  formStack: {
    gap: 22,
  },
  blockingCard: {
    borderRadius: 24,
    padding: 20,
    gap: 14,
    backgroundColor: '#fffaf3',
    borderWidth: 1,
    borderColor: '#eee0d0',
    alignItems: 'flex-start',
  },
  blockingTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#183153',
  },
  blockingBody: {
    fontSize: 14,
    lineHeight: 21,
    color: '#5f7289',
  },
  sectionBlock: {
    gap: 12,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepBadge: {
    minWidth: 30,
    height: 20,
    borderRadius: 8,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10233f',
  },
  stepBadgeLabel: {
    fontSize: 11,
    fontWeight: '900',
    color: '#d8ff45',
  },
  sectionHeadline: {
    fontSize: 18,
    fontWeight: '900',
    color: '#10233f',
  },
  sectionDescription: {
    fontSize: 14,
    lineHeight: 20,
    color: '#7a8798',
  },
  loadingCard: {
    minHeight: 120,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#ede0d1',
  },
  inlineStateCard: {
    borderRadius: 20,
    padding: 16,
    gap: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#ede0d1',
  },
  inlineStateBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#5f7289',
  },
  sportGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  sportCard: {
    width: '48%',
    minHeight: 138,
    borderRadius: 22,
    padding: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#ede1d2',
    shadowColor: '#10233f',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 2,
  },
  sportCardSelected: {
    backgroundColor: '#0f233f',
    borderColor: '#0f233f',
  },
  sportCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sportSelectedIcon: {
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#d8ff45',
  },
  sportCardTitle: {
    marginTop: 18,
    fontSize: 24,
    fontWeight: '900',
    color: '#132b4f',
  },
  sportCardTitleSelected: {
    color: '#ffffff',
  },
  sportCardNote: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 18,
    color: '#7b8796',
  },
  sportCardNoteSelected: {
    color: '#b4c4d6',
  },
  lockedCard: {
    borderRadius: 22,
    padding: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#ede1d2',
  },
  lockedCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  lockedCardCopy: {
    flex: 1,
    gap: 4,
  },
  lockedCardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#183153',
  },
  lockedCardBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#6f7d8d',
  },
  pickerCard: {
    position: 'relative',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#ede1d2',
  },
  pickerCardEmphasized: {
    paddingVertical: 18,
  },
  pickerCardError: {
    borderColor: '#d9594c',
  },
  pickerCardLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pickerCardLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: '#8c99ab',
  },
  pickerCardValue: {
    marginTop: 12,
    fontSize: 20,
    fontWeight: '900',
    color: '#10233f',
  },
  pickerCardValueBig: {
    fontSize: 30,
    lineHeight: 34,
  },
  pickerCardHelper: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: '#7b8796',
  },
  pickerChevron: {
    position: 'absolute',
    right: 14,
    top: 16,
  },
  scheduleRow: {
    flexDirection: 'row',
    gap: 12,
  },
  scheduleCardWrap: {
    flex: 1,
  },
  durationRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  durationChip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#fffaf3',
    borderWidth: 1,
    borderColor: '#e7daca',
  },
  durationChipSelected: {
    backgroundColor: '#10233f',
    borderColor: '#10233f',
  },
  durationChipLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#6f7c8d',
  },
  durationChipLabelSelected: {
    color: '#ffffff',
  },
  searchShell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 54,
    borderRadius: 18,
    paddingHorizontal: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e7daca',
  },
  searchInput: {
    flex: 1,
    minHeight: 48,
    fontSize: 16,
    color: '#183153',
  },
  cityPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#f6efe5',
  },
  cityPillLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#8d7b67',
    textTransform: 'uppercase',
  },
  venueFiltersRow: {
    gap: 10,
    paddingRight: 12,
  },
  venueFilterChip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#fffaf3',
    borderWidth: 1,
    borderColor: '#e7daca',
  },
  venueFilterChipSelected: {
    backgroundColor: '#10233f',
    borderColor: '#10233f',
  },
  venueFilterChipLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#6f7c8d',
  },
  venueFilterChipLabelSelected: {
    color: '#ffffff',
  },
  venueList: {
    gap: 12,
  },
  venueCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    borderRadius: 22,
    padding: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#ede1d2',
    shadowColor: '#10233f',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 2,
  },
  venueCardSelected: {
    backgroundColor: '#0f233f',
    borderColor: '#0f233f',
  },
  venueCardIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5efe7',
  },
  venueCardIconWrapSelected: {
    backgroundColor: '#214066',
  },
  venueCardCopy: {
    flex: 1,
    gap: 6,
  },
  venueCardTitleRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  venueCardTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '900',
    color: '#132b4f',
  },
  venueCardTitleSelected: {
    color: '#ffffff',
  },
  venueSelectedCheck: {
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#d8ff45',
  },
  venueCardAddress: {
    fontSize: 14,
    lineHeight: 20,
    color: '#6f7c8d',
  },
  venueCardAddressSelected: {
    color: '#c1cfe0',
  },
  venueMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  venueMetaBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#eef4c7',
  },
  venueMetaBadgeSelected: {
    backgroundColor: '#d8ff45',
  },
  venueMetaBadgeLabel: {
    fontSize: 12,
    fontWeight: '900',
    color: '#6b7d12',
    textTransform: 'uppercase',
  },
  venueMetaBadgeLabelSelected: {
    color: '#10233f',
  },
  venueMetaText: {
    fontSize: 13,
    color: '#8b98aa',
  },
  venueMetaTextSelected: {
    color: '#c1cfe0',
  },
  showMoreVenuesButton: {
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#faf5ee',
    borderWidth: 1,
    borderColor: '#ddcdbb',
    borderStyle: 'dashed',
  },
  showMoreVenuesLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: '#8d7b67',
  },
  inlineVenuePrompt: {
    gap: 12,
    borderRadius: 20,
    padding: 16,
    backgroundColor: '#fff8ef',
    borderWidth: 1,
    borderColor: '#ecd9c7',
  },
  inlineVenuePromptText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#6f7c8d',
  },
  inlineVenueForm: {
    gap: 14,
    borderRadius: 20,
    padding: 16,
    backgroundColor: '#fffaf4',
    borderWidth: 1,
    borderColor: '#e8dbcb',
  },
  skillRow: {
    flexDirection: 'row',
    gap: 10,
  },
  skillCard: {
    flex: 1,
    minHeight: 94,
    borderRadius: 18,
    paddingHorizontal: 8,
    paddingVertical: 14,
    backgroundColor: '#f4f6f8',
    borderWidth: 1,
    borderColor: '#dbe2ea',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  skillCardSelected: {
    backgroundColor: '#10233f',
    borderColor: '#10233f',
  },
  skillShortLabel: {
    fontSize: 21,
    fontWeight: '900',
    color: '#10233f',
    textAlign: 'center',
  },
  skillShortLabelSelected: {
    color: '#ffffff',
  },
  skillLongLabel: {
    minHeight: 30,
    fontSize: 11.5,
    lineHeight: 14,
    fontWeight: '700',
    color: '#7b8796',
    textAlign: 'center',
    width: '100%',
  },
  skillLongLabelSelected: {
    color: '#c5d1e0',
  },
  skillSummaryCard: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#ede1d2',
    gap: 10,
  },
  skillSummaryTopRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
  },
  skillSummaryPill: {
    flex: 1,
    minWidth: 0,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#f4f6f8',
    borderWidth: 1,
    borderColor: '#dbe2ea',
    gap: 4,
  },
  skillSummaryPillLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#8c99ab',
  },
  skillSummaryPillValue: {
    fontSize: 18,
    fontWeight: '900',
    color: '#10233f',
  },
  skillClearButton: {
    minWidth: 104,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#fffaf3',
    borderWidth: 1,
    borderColor: '#e7daca',
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  skillClearButtonLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#6f7c8d',
  },
  skillSummaryBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#728093',
  },
  compactControlsRow: {
    gap: 12,
  },
  compactFieldCard: {
    borderRadius: 20,
    padding: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#ede1d2',
    gap: 12,
  },
  compactFieldLabel: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#8d7b67',
  },
  compactStepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  compactStepperButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef3f8',
  },
  compactStepperButtonDisabled: {
    opacity: 0.45,
  },
  compactStepperValue: {
    fontSize: 28,
    fontWeight: '900',
    color: '#10233f',
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  togglePill: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#fffaf3',
    borderWidth: 1,
    borderColor: '#e7daca',
  },
  togglePillSelected: {
    backgroundColor: '#10233f',
    borderColor: '#10233f',
  },
  togglePillLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#6f7c8d',
  },
  togglePillLabelSelected: {
    color: '#ffffff',
  },
  descriptionCard: {
    borderRadius: 22,
    padding: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#ede1d2',
    gap: 12,
  },
  descriptionLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color: '#9ba7b8',
  },
  descriptionInput: {
    minHeight: 120,
    fontSize: 16,
    lineHeight: 22,
    color: '#183153',
  },
  descriptionInputError: {},
  descriptionFooter: {
    gap: 12,
  },
  descriptionSuggestionsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 12,
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#f4f6f8',
    borderWidth: 1,
    borderColor: '#e2e7ee',
  },
  suggestionChipLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#728093',
  },
  counterText: {
    fontSize: 12,
    color: '#8a98aa',
    alignSelf: 'flex-end',
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#d9594c',
  },
  stickyFooterWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 0,
    backgroundColor: 'transparent',
  },
  stickyFooterCard: {
    borderRadius: 26,
    padding: 14,
    backgroundColor: '#0f233f',
    borderWidth: 1,
    borderColor: '#223a5d',
    shadowColor: '#10233f',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 6,
    gap: 14,
  },
  stickyFooterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  stickyFooterIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  stickyFooterPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1b3355',
  },
  stickyFooterCopy: {
    flex: 1,
    gap: 2,
  },
  stickyFooterTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#ffffff',
  },
  stickyFooterMeta: {
    fontSize: 12,
    lineHeight: 17,
    color: '#b5c5d7',
  },
  stickyFooterStats: {
    alignItems: 'flex-end',
  },
  stickyFooterPlayers: {
    fontSize: 13,
    fontWeight: '800',
    color: '#d8ff45',
  },
  stickySubmitButton: {
    minHeight: 54,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#d8ff45',
  },
  stickySubmitButtonDisabled: {
    opacity: 0.45,
  },
  stickySubmitButtonLabel: {
    fontSize: 18,
    fontWeight: '900',
    color: '#10233f',
  },
  keyboardAccessory: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e4e9f0',
  },
  keyboardAccessoryButton: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#10233f',
  },
  keyboardAccessoryButtonLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ffffff',
  },
  interactionShield: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    backgroundColor: 'rgba(247, 240, 230, 0.01)',
  },
  pickerBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },
  pickerSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: '#fff9f1',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    gap: 14,
  },
  pickerHandle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#d6c9b7',
  },
  pickerSheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#183153',
    textAlign: 'center',
  },
  pickerControl: {
    alignSelf: 'center',
  },
  pickerActions: {
    flexDirection: 'row',
    gap: 12,
  },
  pickerActionButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerActionButtonPrimary: {
    backgroundColor: '#183153',
  },
  pickerActionButtonSecondary: {
    backgroundColor: '#eef3f8',
  },
  pickerActionButtonPrimaryLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff8f0',
  },
  pickerActionButtonSecondaryLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#183153',
  },
});
