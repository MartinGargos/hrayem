import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';

import { formatEventDate, formatEventTime } from '../../utils/dates';
import type { AppLanguage } from '../../types/app';
import type { EventFeedItem, SportSummary } from '../../types/events';

function getSportBadgeLabel(input: { slug?: string | null; name: string }): string {
  const slug = input.slug?.toLowerCase() ?? '';

  if (slug === 'badminton') {
    return 'BD';
  }

  if (slug === 'padel') {
    return 'PD';
  }

  if (slug === 'squash') {
    return 'SQ';
  }

  return input.name.slice(0, 2).toUpperCase();
}

type SportBadgeProps = {
  colorHex: string;
  label: string;
};

export function SportBadge({ colorHex, label }: SportBadgeProps) {
  return (
    <View style={[styles.sportBadge, { backgroundColor: colorHex }]}>
      <Text style={styles.sportBadgeLabel}>{label}</Text>
    </View>
  );
}

type SportChoiceChipProps = {
  sport: SportSummary;
  language: AppLanguage;
  selected: boolean;
  onPress: () => void;
};

export function SportChoiceChip({ sport, language, selected, onPress }: SportChoiceChipProps) {
  const sportName = language === 'cs' ? sport.nameCs : sport.nameEn;

  return (
    <Pressable
      accessibilityHint={sportName}
      accessibilityLabel={sportName}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.sportChoiceChip, selected ? styles.sportChoiceChipSelected : undefined]}
    >
      <SportBadge
        colorHex={sport.colorHex}
        label={getSportBadgeLabel({
          slug: sport.slug,
          name: sportName,
        })}
      />
      <Text
        style={[
          styles.sportChoiceChipLabel,
          selected ? styles.sportChoiceChipLabelSelected : undefined,
        ]}
      >
        {sportName}
      </Text>
    </Pressable>
  );
}

type AvatarPhotoProps = {
  uri: string | null;
  label: string;
  size?: number;
};

export function AvatarPhoto({ uri, label, size = 42 }: AvatarPhotoProps) {
  const fallback = label.trim().slice(0, 1).toUpperCase() || '?';

  return uri ? (
    <Image
      accessibilityLabel={label}
      contentFit="cover"
      source={{ uri }}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
      }}
      transition={150}
    />
  ) : (
    <View
      accessibilityLabel={label}
      style={[
        styles.avatarFallback,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
      ]}
    >
      <Text style={styles.avatarFallbackText}>{fallback}</Text>
    </View>
  );
}

type FilterChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
};

export function FilterChip({ label, selected, onPress }: FilterChipProps) {
  return (
    <Pressable
      accessibilityHint={label}
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.filterChip, selected ? styles.filterChipSelected : undefined]}
    >
      <Text style={[styles.filterChipLabel, selected ? styles.filterChipLabelSelected : undefined]}>
        {label}
      </Text>
    </Pressable>
  );
}

type StepperFieldProps = {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  onChange: (nextValue: number) => void;
};

export function StepperField({ label, value, minimum, maximum, onChange }: StepperFieldProps) {
  return (
    <View style={styles.stepperField}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperRow}>
        <StepperButton
          disabled={value <= minimum}
          label="-"
          onPress={() => onChange(Math.max(minimum, value - 1))}
        />
        <Text style={styles.stepperValue}>{value}</Text>
        <StepperButton
          disabled={value >= maximum}
          label="+"
          onPress={() => onChange(Math.min(maximum, value + 1))}
        />
      </View>
    </View>
  );
}

function StepperButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      accessibilityHint={label}
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.stepperButton, disabled ? styles.stepperButtonDisabled : undefined]}
    >
      <Text style={styles.stepperButtonLabel}>{label}</Text>
    </Pressable>
  );
}

type InfoPillProps = {
  children: ReactNode;
  accentColor?: string;
};

export function InfoPill({ children, accentColor }: InfoPillProps) {
  return (
    <View
      style={[
        styles.infoPill,
        accentColor
          ? {
              borderColor: accentColor,
              backgroundColor: `${accentColor}18`,
            }
          : undefined,
      ]}
    >
      <Text style={styles.infoPillText}>{children}</Text>
    </View>
  );
}

type EventSummaryCardProps = {
  event: EventFeedItem;
  language: AppLanguage;
  onPress: () => void;
};

export function EventSummaryCard({ event, language, onPress }: EventSummaryCardProps) {
  const { t } = useTranslation();
  const organizerName = event.organizerFirstName ?? t('events.common.organizerFallback');
  const sportName = language === 'cs' ? event.sportNameCs : event.sportNameEn;

  return (
    <Pressable
      accessibilityHint={t('events.detail.openEventHint', {
        sport: sportName,
        venue: event.venueName,
      })}
      accessibilityLabel={sportName}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.cardPressable}
    >
      <View style={[styles.eventCard, { borderLeftColor: event.sportColor }]}>
        <View style={styles.eventCardHeader}>
          <View style={styles.sportIdentity}>
            <SportBadge
              colorHex={event.sportColor}
              label={getSportBadgeLabel({
                slug: event.sportSlug,
                name: sportName,
              })}
            />
            <View style={styles.sportTextWrap}>
              <Text style={styles.sportTitle}>{sportName}</Text>
              <Text style={styles.sportMetaText}>{event.city}</Text>
            </View>
          </View>
          <Ionicons color="#97a7b8" name="chevron-forward" size={18} />
        </View>

        <View style={styles.scheduleCard}>
          <View style={styles.scheduleIconWrap}>
            <Ionicons color="#183153" name="calendar-clear-outline" size={18} />
          </View>
          <View style={styles.scheduleCopy}>
            <Text style={styles.dateText}>{formatEventDate(event.startsAt, language)}</Text>
            <Text style={styles.timeText}>
              {formatEventTime(event.startsAt, language)} -{' '}
              {formatEventTime(event.endsAt, language)}
            </Text>
          </View>
        </View>

        <View style={styles.locationRow}>
          <Ionicons color="#708298" name="location-outline" size={16} />
          <Text numberOfLines={2} style={styles.venueText}>
            {event.venueName}
          </Text>
        </View>

        <View style={styles.metricsRow}>
          <InfoPill accentColor={event.sportColor}>
            {t(`events.reservationType.${event.reservationType}`)}
          </InfoPill>
          {event.status === 'full' || event.waitlistCount > 0 ? (
            <InfoPill accentColor="#a0603b">
              {event.status === 'full'
                ? t('events.feed.statusFull')
                : t('events.feed.waitlistCount', { count: event.waitlistCount })}
            </InfoPill>
          ) : null}
          <InfoPill>
            {t('events.feed.spotsTaken', {
              current: event.spotsTaken,
              total: event.playerCountTotal,
            })}
          </InfoPill>
          <InfoPill>
            {t('events.feed.skillRange', { min: event.skillMin, max: event.skillMax })}
          </InfoPill>
        </View>

        <View style={styles.organizerRow}>
          <AvatarPhoto label={organizerName} uri={event.organizerPhotoUrl} />
          <View style={styles.organizerTextWrap}>
            <Text style={styles.organizerEyebrow}>{t('events.detail.organizerTitle')}</Text>
            <Text style={styles.organizerName}>{organizerName}</Text>
            <Text style={styles.organizerMeta}>
              {t('events.detail.organizerStats', {
                games: event.organizerGamesPlayed,
                noShows: event.organizerNoShows,
              })}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#183153',
  },
  avatarFallbackText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff8f0',
  },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ddcfbd',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fffdf8',
  },
  filterChipSelected: {
    backgroundColor: '#183153',
    borderColor: '#183153',
  },
  filterChipLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#586676',
  },
  filterChipLabelSelected: {
    color: '#fff8f0',
  },
  sportChoiceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dfd1bf',
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: '#fffdf8',
  },
  sportChoiceChipSelected: {
    borderColor: '#183153',
    backgroundColor: '#183153',
  },
  sportChoiceChipLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#28445d',
  },
  sportChoiceChipLabelSelected: {
    color: '#fff8f0',
  },
  sportBadge: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sportBadgeLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#fffaf3',
    letterSpacing: 0.6,
  },
  stepperField: {
    gap: 10,
  },
  stepperLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#183153',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dfd1bf',
    backgroundColor: '#fffdf8',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  stepperButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#183153',
  },
  stepperButtonDisabled: {
    opacity: 0.35,
  },
  stepperButtonLabel: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff8f0',
  },
  stepperValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#183153',
  },
  infoPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e7dbcb',
    backgroundColor: '#faf3e9',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  infoPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#435a6d',
  },
  cardPressable: {
    borderRadius: 20,
  },
  eventCard: {
    gap: 12,
    borderRadius: 20,
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: '#ece0d1',
    backgroundColor: '#fffbf6',
    padding: 16,
    shadowColor: '#10233f',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 1,
  },
  eventCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  sportIdentity: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  sportTextWrap: {
    flex: 1,
    gap: 3,
  },
  sportTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#183153',
  },
  sportMetaText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#708298',
  },
  scheduleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: '#f6efe5',
    borderWidth: 1,
    borderColor: '#eadfce',
  },
  scheduleIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e7edf4',
  },
  scheduleCopy: {
    gap: 1,
    flex: 1,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  venueText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#617184',
  },
  dateText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#183153',
  },
  timeText: {
    fontSize: 14,
    color: '#617184',
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  organizerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0e5d7',
  },
  organizerTextWrap: {
    flex: 1,
    gap: 2,
  },
  organizerEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: '#aa6d44',
  },
  organizerName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#183153',
  },
  organizerMeta: {
    fontSize: 13,
    lineHeight: 18,
    color: '#708298',
  },
});
