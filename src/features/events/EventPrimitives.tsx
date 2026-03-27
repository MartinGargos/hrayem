import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.cardPressable}>
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
              <Text style={styles.venueText}>{event.venueName}</Text>
            </View>
          </View>
          <View style={styles.headerPills}>
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
          </View>
        </View>

        <View style={styles.dateRow}>
          <Text style={styles.dateText}>{formatEventDate(event.startsAt, language)}</Text>
          <Text style={styles.timeText}>
            {formatEventTime(event.startsAt, language)} - {formatEventTime(event.endsAt, language)}
          </Text>
        </View>

        <View style={styles.metricsRow}>
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
    borderColor: '#d8c8b2',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#fff9f1',
  },
  filterChipSelected: {
    backgroundColor: '#183153',
    borderColor: '#183153',
  },
  filterChipLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#5a6475',
  },
  filterChipLabelSelected: {
    color: '#fff8f0',
  },
  sportChoiceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#d8c8b2',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff9f1',
  },
  sportChoiceChipSelected: {
    borderColor: '#183153',
    backgroundColor: '#183153',
  },
  sportChoiceChipLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#183153',
  },
  sportChoiceChipLabelSelected: {
    color: '#fff8f0',
  },
  sportBadge: {
    width: 34,
    height: 34,
    borderRadius: 12,
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
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#d8c8b2',
    backgroundColor: '#fff9f1',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  stepperButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
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
    fontSize: 22,
    fontWeight: '800',
    color: '#183153',
  },
  infoPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#eadfce',
    backgroundColor: '#f8efe1',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  infoPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#395065',
  },
  cardPressable: {
    borderRadius: 22,
  },
  eventCard: {
    gap: 14,
    borderRadius: 22,
    borderLeftWidth: 6,
    borderWidth: 1,
    borderColor: '#eadfce',
    backgroundColor: '#fffaf3',
    padding: 18,
  },
  eventCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
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
    gap: 4,
  },
  sportTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#183153',
  },
  venueText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#5a6475',
  },
  headerPills: {
    alignItems: 'flex-end',
    gap: 8,
  },
  dateRow: {
    gap: 2,
  },
  dateText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#183153',
  },
  timeText: {
    fontSize: 14,
    color: '#5a6475',
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
  },
  organizerTextWrap: {
    flex: 1,
    gap: 2,
  },
  organizerName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#183153',
  },
  organizerMeta: {
    fontSize: 13,
    lineHeight: 18,
    color: '#6d7f95',
  },
});
