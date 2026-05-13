import Ionicons from '@expo/vector-icons/Ionicons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionButton } from '../auth/AuthPrimitives';
import { StateMessage } from '../../components/StateMessage';
import type { RootStackParamList } from '../../navigation/types';
import { fetchVenueOpenEvents } from '../../services/events';
import { fetchVenueById } from '../../services/venues';
import { useUserStore } from '../../store/user-store';
import type { AppLanguage } from '../../types/app';
import type { EventFeedItem, VenueSummary } from '../../types/events';
import { formatEventCompactDate, formatEventTime, formatRelativeTime } from '../../utils/dates';
import { translatePlural } from '../../utils/pluralization';

type VenueDetailScreenProps = NativeStackScreenProps<RootStackParamList, 'VenueDetail'>;

const OPEN_EVENTS_WINDOW_DAYS = 2;

function addDays(input: Date, days: number): Date {
  return new Date(input.getTime() + days * 24 * 60 * 60 * 1000);
}

function getSportName(event: EventFeedItem, language: AppLanguage): string {
  return language === 'cs' ? event.sportNameCs : event.sportNameEn;
}

function getSportBadgeLabel(event: EventFeedItem): string {
  const slug = event.sportSlug.toLowerCase();

  if (slug === 'badminton') {
    return 'BD';
  }

  if (slug === 'padel') {
    return 'PADEL';
  }

  if (slug === 'squash') {
    return 'SQ';
  }

  return event.sportNameCs.slice(0, 2).toUpperCase();
}

function getOccupancySegments(current: number, total: number) {
  if (!total) {
    return 0;
  }

  const ratio = current / total;
  return Math.min(4, Math.max(current > 0 ? 1 : 0, Math.round(ratio * 4)));
}

function isEventSoon(startsAt: string): boolean {
  const startsAtMs = new Date(startsAt).getTime();
  const nowMs = Date.now();
  return startsAtMs > nowMs && startsAtMs - nowMs <= 24 * 60 * 60 * 1000;
}

function buildMapsUrl(venue: VenueSummary): string {
  const query = [venue.name, venue.address, venue.city].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function VenueTopBar({
  onBack,
  onMenu,
  topInset,
}: {
  onBack: () => void;
  onMenu: () => void;
  topInset: number;
}) {
  const { t } = useTranslation();

  return (
    <View style={[styles.topBar, { paddingTop: topInset + 8 }]}>
      <Pressable
        accessibilityLabel={t('events.venueDetail.backAction')}
        accessibilityRole="button"
        onPress={onBack}
        style={styles.topButton}
      >
        <Ionicons color="#10233f" name="chevron-back" size={24} />
      </Pressable>
      <Text style={styles.topTitle}>{t('navigation.titles.venueDetail')}</Text>
      <Pressable
        accessibilityLabel={t('reports.overflowLabel')}
        accessibilityRole="button"
        onPress={onMenu}
        style={styles.topButton}
      >
        <Ionicons color="#10233f" name="ellipsis-horizontal" size={21} />
      </Pressable>
    </View>
  );
}

function VenueHero({
  language,
  openEventCount,
  venue,
}: {
  language: AppLanguage;
  openEventCount: number;
  venue: VenueSummary;
}) {
  const { t } = useTranslation();

  return (
    <View style={styles.heroCard}>
      <View pointerEvents="none" style={styles.courtLines}>
        <View style={styles.courtOuterLine} />
        <View style={[styles.courtLine, styles.courtLineVertical]} />
        <View style={[styles.courtLine, styles.courtLineHorizontalTop]} />
        <View style={[styles.courtLine, styles.courtLineHorizontalMiddle]} />
        <View style={[styles.courtLine, styles.courtLineHorizontalBottom]} />
        <View style={[styles.courtLine, styles.courtLineServiceLeft]} />
        <View style={[styles.courtLine, styles.courtLineServiceRight]} />
      </View>

      <View style={styles.heroBottomRow}>
        <View style={styles.openGamesBadge}>
          <View style={styles.openGamesDot} />
          <Text style={styles.openGamesBadgeLabel}>
            {translatePlural(t, language, 'events.venueDetail.openGamesBadge', openEventCount)}
          </Text>
        </View>
        <View style={styles.venueTrustBlock}>
          <Ionicons color="#ffffff" name={venue.isVerified ? 'star' : 'sparkles'} size={13} />
          <Text style={styles.venueTrustTitle}>
            {venue.isVerified
              ? t('events.venueDetail.verifiedVenue')
              : t('events.venueDetail.communityVenue')}
          </Text>
        </View>
      </View>
    </View>
  );
}

function VenueAction({
  iconName,
  label,
  onPress,
}: {
  iconName: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.actionCard, pressed ? styles.actionCardPressed : undefined]}
    >
      <Ionicons color="#10233f" name={iconName} size={20} />
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

function VenueHeader({
  events,
  language,
  onNavigate,
  onReservation,
  onSports,
  venue,
}: {
  events: EventFeedItem[];
  language: AppLanguage;
  onNavigate: () => void;
  onReservation: () => void;
  onSports: () => void;
  venue: VenueSummary;
}) {
  const { t } = useTranslation();
  const address = venue.address ?? venue.city;

  return (
    <View style={styles.venueHeader}>
      <VenueHero language={language} openEventCount={events.length} venue={venue} />
      <View style={styles.titleBlock}>
        <Text numberOfLines={2} style={styles.venueTitle}>
          {venue.name}
        </Text>
        <View style={styles.addressRow}>
          <Ionicons color="#6f736d" name="location-outline" size={14} />
          <Text numberOfLines={1} style={styles.addressText}>
            {address}
          </Text>
        </View>
      </View>
      <View style={styles.actionGrid}>
        <VenueAction
          iconName="location-outline"
          label={t('events.venueDetail.actions.navigation')}
          onPress={onNavigate}
        />
        <VenueAction
          iconName="hourglass-outline"
          label={t('events.venueDetail.actions.reserve')}
          onPress={onReservation}
        />
        <VenueAction
          iconName="albums-outline"
          label={t('events.venueDetail.actions.sports')}
          onPress={onSports}
        />
      </View>
    </View>
  );
}

function VenueEventCard({
  event,
  language,
  onPress,
}: {
  event: EventFeedItem;
  language: AppLanguage;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const sportName = getSportName(event, language);
  const activeSegments = getOccupancySegments(event.spotsTaken, event.playerCountTotal);
  const isFull = event.status === 'full';

  return (
    <Pressable
      accessibilityLabel={t('events.venueDetail.openGameAction')}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.gameCard, pressed ? styles.gameCardPressed : undefined]}
    >
      <View style={styles.gameTopRow}>
        <View style={styles.gameBadgeRow}>
          <View style={styles.sportPill}>
            <View style={styles.sportPillDot} />
            <Text style={styles.sportPillLabel}>{getSportBadgeLabel(event)}</Text>
          </View>
          {isEventSoon(event.startsAt) ? (
            <View style={styles.soonPill}>
              <Text style={styles.soonPillLabel}>{t('events.venueDetail.soon')}</Text>
            </View>
          ) : null}
        </View>
        <Text numberOfLines={1} style={styles.gameDistanceFallback}>
          {formatRelativeTime(event.startsAt, language)}
        </Text>
      </View>

      <View style={styles.gameMainRow}>
        <View style={styles.gameCopy}>
          <Text numberOfLines={2} style={styles.gameVenueName}>
            {event.venueName}
          </Text>
          <Text numberOfLines={1} style={styles.gameMeta}>
            {sportName} · {t(`events.reservationType.${event.reservationType}`)}
          </Text>
        </View>
        <View style={styles.gameTimeBlock}>
          <Text style={styles.gameTime}>{formatEventTime(event.startsAt, language)}</Text>
          <Text style={styles.gameDate}>{formatEventCompactDate(event.startsAt, language)}</Text>
        </View>
      </View>

      <View style={styles.gameFooter}>
        <View style={styles.occupancyTrack}>
          {Array.from({ length: 4 }).map((_, index) => (
            <View
              key={`${event.id}-segment-${index}`}
              style={[
                styles.occupancySegment,
                index < activeSegments ? styles.occupancySegmentActive : undefined,
              ]}
            />
          ))}
        </View>
        <Text style={styles.occupancyLabel}>
          {event.spotsTaken}/{event.playerCountTotal}
        </Text>
        <View style={[styles.joinPill, isFull ? styles.joinPillMuted : undefined]}>
          <Text style={styles.joinPillLabel}>
            {isFull ? t('events.venueDetail.waitlistAction') : t('events.venueDetail.joinAction')}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function VenueInfoCard({ events, language }: { events: EventFeedItem[]; language: AppLanguage }) {
  const { t } = useTranslation();
  const sportNames = Array.from(
    new Map(events.map((event) => [event.sportId, getSportName(event, language)])).values(),
  );
  const rows = [
    ...(sportNames.length
      ? [
          {
            label: t('events.venueDetail.info.sports'),
            value: sportNames.join(', '),
          },
        ]
      : []),
    {
      label: t('events.venueDetail.info.pricePerHour'),
      value: t('events.venueDetail.info.pricePending'),
    },
  ];

  return (
    <View style={styles.infoCard}>
      {rows.map((row, index) => (
        <View
          key={row.label}
          style={[styles.infoRow, index === rows.length - 1 ? styles.infoRowLast : undefined]}
        >
          <Text style={styles.infoLabel}>{row.label}</Text>
          <Text numberOfLines={2} style={styles.infoValue}>
            {row.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function VenueDetailScreen({ navigation, route }: VenueDetailScreenProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const language = useUserStore((state) => state.language);
  const venueId = route.params.venueId;
  const queryWindow = useMemo(() => {
    const startsAtFrom = new Date();
    const startsAtTo = addDays(startsAtFrom, OPEN_EVENTS_WINDOW_DAYS);

    return {
      startsAtFrom: startsAtFrom.toISOString(),
      startsAtTo: startsAtTo.toISOString(),
    };
  }, []);

  const venueQuery = useQuery({
    queryKey: ['venues', 'detail', venueId],
    queryFn: () => fetchVenueById(venueId),
    staleTime: 5 * 60_000,
  });
  const openEventsQuery = useQuery({
    queryKey: ['venues', 'detail', venueId, 'open-events', queryWindow],
    queryFn: () =>
      fetchVenueOpenEvents({
        venueId,
        startsAtFrom: queryWindow.startsAtFrom,
        startsAtTo: queryWindow.startsAtTo,
      }),
    staleTime: 30_000,
  });

  async function handleRefresh() {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Promise.all([venueQuery.refetch(), openEventsQuery.refetch()]);
  }

  async function handleNavigatePress(venue: VenueSummary) {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      await Linking.openURL(buildMapsUrl(venue));
    } catch {
      Alert.alert(
        t('events.venueDetail.navigationUnavailableTitle'),
        t('events.venueDetail.navigationUnavailableBody'),
      );
    }
  }

  function handleReservationPress() {
    Alert.alert(
      t('events.venueDetail.reserveUnavailableTitle'),
      t('events.venueDetail.reserveUnavailableBody'),
    );
  }

  function handleSportsPress(events: EventFeedItem[]) {
    const sportNames = Array.from(new Set(events.map((event) => getSportName(event, language))));

    Alert.alert(
      t('events.venueDetail.sportsTitle'),
      sportNames.length ? sportNames.join('\n') : t('events.venueDetail.sportsUnavailableBody'),
    );
  }

  function handleMenuPress() {
    Alert.alert(t('events.venueDetail.menuTitle'), t('events.venueDetail.menuBody'));
  }

  const openEvents = openEventsQuery.data ?? [];

  if (venueQuery.isPending) {
    return (
      <View style={styles.screen}>
        <StatusBar style="dark" />
        <VenueTopBar
          onBack={() => navigation.goBack()}
          onMenu={handleMenuPress}
          topInset={insets.top}
        />
        <View style={styles.stateWrap}>
          <ActivityIndicator color="#10233f" />
        </View>
      </View>
    );
  }

  if (venueQuery.isError || !venueQuery.data) {
    return (
      <View style={styles.screen}>
        <StatusBar style="dark" />
        <VenueTopBar
          onBack={() => navigation.goBack()}
          onMenu={handleMenuPress}
          topInset={insets.top}
        />
        <View style={styles.stateWrap}>
          <StateMessage
            action={
              <ActionButton
                iconName="refresh-outline"
                label={t('events.common.retry')}
                onPress={async () => {
                  await venueQuery.refetch();
                }}
                variant="secondary"
              />
            }
            body={t('events.venueDetail.errorBody')}
            iconName="alert-circle-outline"
            title={t('events.venueDetail.errorTitle')}
            tone="muted"
          />
        </View>
      </View>
    );
  }

  const venue = venueQuery.data;

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <VenueTopBar
        onBack={() => navigation.goBack()}
        onMenu={handleMenuPress}
        topInset={insets.top}
      />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: Math.max(insets.bottom, 18) + 150,
          },
        ]}
        refreshControl={
          <RefreshControl
            onRefresh={() => {
              void handleRefresh();
            }}
            refreshing={venueQuery.isRefetching || openEventsQuery.isRefetching}
            tintColor="#10233f"
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <VenueHeader
          events={openEvents}
          language={language}
          onNavigate={() => {
            void handleNavigatePress(venue);
          }}
          onReservation={handleReservationPress}
          onSports={() => handleSportsPress(openEvents)}
          venue={venue}
        />

        <View style={styles.sectionBlock}>
          <Text style={styles.sectionEyebrow}>{t('events.venueDetail.openGamesEyebrow')}</Text>
          <Text style={styles.sectionTitle}>{t('events.venueDetail.openGamesTitle')}</Text>
        </View>

        {openEventsQuery.isPending ? (
          <View style={styles.stateInline}>
            <ActivityIndicator color="#10233f" />
          </View>
        ) : openEventsQuery.isError ? (
          <StateMessage
            action={
              <ActionButton
                iconName="refresh-outline"
                label={t('events.common.retry')}
                onPress={async () => {
                  await openEventsQuery.refetch();
                }}
                variant="secondary"
              />
            }
            body={t('events.venueDetail.openGamesErrorBody')}
            compact
            iconName="cloud-offline-outline"
            title={t('events.venueDetail.openGamesErrorTitle')}
            tone="muted"
          />
        ) : openEvents.length ? (
          <View style={styles.gameList}>
            {openEvents.map((event) => (
              <VenueEventCard
                event={event}
                key={event.id}
                language={language}
                onPress={() => navigation.navigate('EventDetail', { eventId: event.id })}
              />
            ))}
          </View>
        ) : (
          <StateMessage
            body={t('events.venueDetail.openGamesEmptyBody')}
            compact
            iconName="calendar-outline"
            title={t('events.venueDetail.openGamesEmptyTitle')}
            tone="warm"
          />
        )}

        <View style={styles.sectionBlock}>
          <Text style={styles.sectionTitle}>{t('events.venueDetail.infoTitle')}</Text>
        </View>
        <VenueInfoCard events={openEvents} language={language} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f4f0e8',
  },
  topBar: {
    minHeight: 64,
    paddingHorizontal: 18,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topButton: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#ede1d2',
  },
  topTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
    color: '#06162f',
  },
  content: {
    paddingHorizontal: 18,
    gap: 16,
  },
  stateWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  stateInline: {
    minHeight: 96,
    justifyContent: 'center',
  },
  venueHeader: {
    gap: 14,
  },
  heroCard: {
    minHeight: 176,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#183153',
  },
  courtLines: {
    position: 'absolute',
    top: 26,
    left: 80,
    right: 80,
    height: 104,
    opacity: 0.22,
  },
  courtOuterLine: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: '#ffffff',
  },
  courtLine: {
    position: 'absolute',
    backgroundColor: '#ffffff',
  },
  courtLineVertical: {
    top: 0,
    bottom: 0,
    left: '50%',
    width: 1,
  },
  courtLineHorizontalTop: {
    top: 32,
    left: 0,
    right: 0,
    height: 1,
  },
  courtLineHorizontalMiddle: {
    top: 64,
    left: 0,
    right: 0,
    height: 1,
  },
  courtLineHorizontalBottom: {
    top: 88,
    left: 0,
    right: 0,
    height: 1,
  },
  courtLineServiceLeft: {
    top: 32,
    bottom: 0,
    left: '25%',
    width: 1,
  },
  courtLineServiceRight: {
    top: 32,
    bottom: 0,
    right: '25%',
    width: 1,
  },
  heroBottomRow: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  openGamesBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#d8ff39',
  },
  openGamesDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#071426',
  },
  openGamesBadgeLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    color: '#071426',
    textTransform: 'uppercase',
  },
  venueTrustBlock: {
    alignItems: 'flex-end',
  },
  venueTrustTitle: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '900',
    color: '#ffffff',
  },
  venueTrustMeta: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
    color: '#d9e6ff',
  },
  titleBlock: {
    gap: 4,
    paddingHorizontal: 4,
  },
  venueTitle: {
    fontSize: 26,
    lineHeight: 31,
    fontWeight: '900',
    color: '#06162f',
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  addressText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: '#5f665e',
  },
  actionGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  actionCard: {
    flex: 1,
    minHeight: 70,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#ffffff',
  },
  actionCardPressed: {
    transform: [{ scale: 0.98 }],
  },
  actionLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    color: '#06162f',
  },
  sectionBlock: {
    gap: 2,
  },
  sectionEyebrow: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '900',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: '#9b8e7c',
  },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '900',
    color: '#06162f',
  },
  gameList: {
    gap: 12,
  },
  gameCard: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    backgroundColor: '#ffffff',
    shadowColor: '#10233f',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 3,
  },
  gameCardPressed: {
    transform: [{ scale: 0.99 }],
  },
  gameTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  gameBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sportPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 7,
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: '#071426',
  },
  sportPillDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#d8ff39',
  },
  sportPillLabel: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '900',
    color: '#ffffff',
  },
  soonPill: {
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: '#ff6f4d',
  },
  soonPillLabel: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '900',
    color: '#ffffff',
  },
  gameDistanceFallback: {
    flex: 1,
    textAlign: 'right',
    fontSize: 12,
    lineHeight: 16,
    color: '#8090a6',
  },
  gameMainRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  gameCopy: {
    flex: 1,
    minWidth: 0,
  },
  gameVenueName: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
    color: '#06162f',
  },
  gameMeta: {
    marginTop: 1,
    fontSize: 12,
    lineHeight: 16,
    color: '#68778a',
  },
  gameTimeBlock: {
    alignItems: 'flex-end',
  },
  gameTime: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '900',
    color: '#06162f',
  },
  gameDate: {
    fontSize: 11,
    lineHeight: 15,
    color: '#7b8797',
  },
  gameFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  occupancyTrack: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
  },
  occupancySegment: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#e7ebef',
  },
  occupancySegmentActive: {
    backgroundColor: '#071426',
  },
  occupancyLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    color: '#5f6d7f',
  },
  joinPill: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#d8ff39',
  },
  joinPillMuted: {
    backgroundColor: '#edf2f7',
  },
  joinPillLabel: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '900',
    color: '#06162f',
  },
  infoCard: {
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    minHeight: 36,
    borderBottomWidth: 1,
    borderBottomColor: '#efe7dc',
  },
  infoRowLast: {
    borderBottomWidth: 0,
  },
  infoLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    color: '#ff644c',
    textTransform: 'uppercase',
  },
  infoValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    color: '#06162f',
  },
});
