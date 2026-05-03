import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { addDays, format, isSameWeek, isToday, isTomorrow, startOfWeek } from 'date-fns';
import { cs, enUS } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionButton } from '../auth/AuthPrimitives';
import {
  getLifecycleRefetchInterval,
  hasEnoughConfirmedPlayersForNoShow,
} from '../events/event-eligibility';
import { AvatarPhoto, SportBadge } from '../events/EventPrimitives';
import { ScreenCard } from '../../components/ScreenShell';
import type { RootStackParamList } from '../../navigation/types';
import {
  fetchConfirmedEventPlayers,
  fetchMyPastGames,
  fetchMyUpcomingGames,
  giveThumbsUp,
} from '../../services/events';
import { useAuthStore } from '../../store/auth-store';
import { useUserStore } from '../../store/user-store';
import type { AppLanguage } from '../../types/app';
import type {
  EventConfirmedPlayer,
  MyGamesPastItem,
  MyGamesUpcomingItem,
} from '../../types/events';
import { formatEventTime, formatRelativeTime } from '../../utils/dates';

type RootNavigation = NavigationProp<RootStackParamList>;
type MyGamesListItem = MyGamesUpcomingItem | MyGamesPastItem;
type MyGamesTab = 'upcoming' | 'past';

const localeMap = {
  cs,
  en: enUS,
} as const;

const weekdayChipMap = {
  cs: ['PO', 'ÚT', 'ST', 'ČT', 'PÁ', 'SO', 'NE'],
  en: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'],
} as const;

const CALENDAR_PREVIEW_DAYS = 35;

function getDateFnsLocale(language: AppLanguage) {
  return localeMap[language];
}

function formatMonthLabel(input: Date, language: AppLanguage) {
  return format(input, language === 'cs' ? 'LLLL · yyyy' : 'MMMM · yyyy', {
    locale: getDateFnsLocale(language),
  }).toUpperCase();
}

function formatShortDate(input: Date, language: AppLanguage) {
  return format(input, language === 'cs' ? 'EEE d. M.' : 'EEE, MMM d', {
    locale: getDateFnsLocale(language),
  });
}

function formatDayHeading(
  input: Date,
  language: AppLanguage,
  t: ReturnType<typeof useTranslation>['t'],
  isPast: boolean,
) {
  if (!isPast && isToday(input)) {
    return t('shell.myGames.day.today').toUpperCase();
  }

  if (!isPast && isTomorrow(input)) {
    return t('shell.myGames.day.tomorrow').toUpperCase();
  }

  return format(input, 'EEEE', {
    locale: getDateFnsLocale(language),
  }).toUpperCase();
}

function getOccupancySegments(current: number, total: number) {
  if (!total) {
    return 0;
  }

  const ratio = current / total;
  return Math.min(4, Math.max(current > 0 ? 1 : 0, Math.round(ratio * 4)));
}

function getSportBadgeLabel(input: { slug?: string | null; name: string }) {
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

function PastEventActions({ event }: { event: MyGamesPastItem }) {
  const { t } = useTranslation();
  const navigation = useNavigation<RootNavigation>();
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.userId);
  const language = useUserStore((state) => state.language);

  const playersQuery = useQuery({
    queryKey: ['events', 'detail', event.id, 'confirmed-players'],
    queryFn: () =>
      fetchConfirmedEventPlayers({
        eventId: event.id,
        sportId: event.sportId,
        viewerUserId: userId,
      }),
    enabled: Boolean(userId),
    staleTime: 10_000,
  });

  const thumbsUpMutation = useMutation({
    mutationFn: giveThumbsUp,
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        queryKey: ['events', 'detail', event.id, 'confirmed-players'],
      });

      const previousPlayers = queryClient.getQueryData<EventConfirmedPlayer[]>([
        'events',
        'detail',
        event.id,
        'confirmed-players',
      ]);

      queryClient.setQueryData<EventConfirmedPlayer[]>(
        ['events', 'detail', event.id, 'confirmed-players'],
        (current) =>
          current?.map((player) =>
            player.userId === input.toUserId
              ? {
                  ...player,
                  alreadyThumbedUpByViewer: true,
                }
              : player,
          ) ?? [],
      );

      return {
        previousPlayers,
      };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousPlayers) {
        queryClient.setQueryData(
          ['events', 'detail', event.id, 'confirmed-players'],
          context.previousPlayers,
        );
      }
    },
    onSuccess: async (_result, variables) => {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['events', 'detail', event.id, 'confirmed-players'],
        }),
        queryClient.invalidateQueries({ queryKey: ['events', 'my-games'] }),
        queryClient.invalidateQueries({ queryKey: ['profile'] }),
        queryClient.invalidateQueries({
          queryKey: ['profile', 'player', variables.toUserId],
        }),
      ]);
    },
  });

  const hasEnoughPlayersForNoShow = hasEnoughConfirmedPlayersForNoShow(
    playersQuery.data ?? [],
    event.organizerId,
  );
  const canReportNoShow =
    event.viewerMembershipStatus === 'organizer' &&
    Boolean(event.noShowWindowEnd) &&
    new Date(event.noShowWindowEnd ?? '').getTime() > Date.now() &&
    hasEnoughPlayersForNoShow;
  const canGiveThumbsUp =
    Boolean(userId) &&
    Boolean(event.chatClosedAt) &&
    new Date(event.chatClosedAt ?? '').getTime() > Date.now();
  const coPlayers = (playersQuery.data ?? []).filter(
    (player) => player.userId !== userId && !player.userId.startsWith('deleted-'),
  );
  const thumbsUpTargetUserId = thumbsUpMutation.variables?.toUserId ?? null;

  if (!canReportNoShow && !canGiveThumbsUp) {
    return null;
  }

  return (
    <ScreenCard title={t('shell.myGames.pastActionsTitle')}>
      {canReportNoShow ? (
        <View style={styles.actionBlock}>
          <Text style={styles.actionBody}>
            {t('shell.myGames.reportNoShowBody', {
              remaining: formatRelativeTime(event.noShowWindowEnd ?? '', language),
            })}
          </Text>
          <ActionButton
            iconName="alert-circle-outline"
            label={t('shell.myGames.reportNoShowAction')}
            onPress={() => navigation.navigate('EventDetail', { eventId: event.id })}
            variant="secondary"
          />
        </View>
      ) : null}

      {canGiveThumbsUp ? (
        <View style={styles.actionBlock}>
          <Text style={styles.actionBody}>
            {t('shell.myGames.thumbsUpBody', {
              remaining: formatRelativeTime(event.chatClosedAt ?? '', language),
            })}
          </Text>
          {playersQuery.isPending ? (
            <View style={styles.centeredBlock}>
              <ActivityIndicator color="#183153" />
            </View>
          ) : coPlayers.length ? (
            <View style={styles.promptRow}>
              {coPlayers.map((player) => {
                const playerName =
                  [player.firstName, player.lastName].filter(Boolean).join(' ') ||
                  t('events.common.organizerFallback');

                return (
                  <View key={`${event.id}-${player.userId}`} style={styles.promptPlayerCard}>
                    <AvatarPhoto label={playerName} uri={player.photoUrl} size={48} />
                    <Text numberOfLines={1} style={styles.promptPlayerName}>
                      {playerName}
                    </Text>
                    <ActionButton
                      disabled={
                        player.alreadyThumbedUpByViewer ||
                        (thumbsUpMutation.isPending && thumbsUpTargetUserId === player.userId)
                      }
                      iconName={
                        player.alreadyThumbedUpByViewer ? 'checkmark-outline' : 'thumbs-up-outline'
                      }
                      label={
                        player.alreadyThumbedUpByViewer
                          ? t('events.thumbsUp.done')
                          : thumbsUpMutation.isPending && thumbsUpTargetUserId === player.userId
                            ? t('events.thumbsUp.pending')
                            : t('events.thumbsUp.action')
                      }
                      onPress={() =>
                        thumbsUpMutation.mutate({
                          eventId: event.id,
                          toUserId: player.userId,
                        })
                      }
                      variant={player.alreadyThumbedUpByViewer ? 'secondary' : 'primary'}
                    />
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.helperText}>{t('shell.myGames.thumbsUpEmpty')}</Text>
          )}
        </View>
      ) : null}
    </ScreenCard>
  );
}

function MyGamesStateCard({
  actionLabel,
  body,
  iconName,
  onPress,
  title,
}: {
  actionLabel?: string;
  body: string;
  iconName: React.ComponentProps<typeof Ionicons>['name'];
  onPress?: () => void | Promise<void>;
  title: string;
}) {
  return (
    <View style={styles.stateCard}>
      <View style={styles.stateIconWrap}>
        <Ionicons color="#183153" name={iconName} size={24} />
      </View>
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateBody}>{body}</Text>
      {actionLabel && onPress ? (
        <View style={styles.stateAction}>
          <ActionButton
            iconName={activeIconName(iconName)}
            label={actionLabel}
            onPress={onPress}
            variant={iconName === 'cloud-offline-outline' ? 'secondary' : 'primary'}
          />
        </View>
      ) : null}
    </View>
  );
}

function activeIconName(
  iconName: React.ComponentProps<typeof Ionicons>['name'],
): React.ComponentProps<typeof Ionicons>['name'] {
  if (iconName === 'cloud-offline-outline') {
    return 'refresh-outline';
  }

  if (iconName === 'trophy-outline') {
    return 'time-outline';
  }

  return 'add-outline';
}

function MyGamesEventCard({
  event,
  language,
  onPress,
}: {
  event: MyGamesListItem;
  language: AppLanguage;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const sportName = language === 'cs' ? event.sportNameCs : event.sportNameEn;
  const organizerName = event.organizerFirstName ?? t('events.common.organizerFallback');
  const roleKey = event.viewerMembershipStatus === 'organizer' ? 'organizer' : 'player';
  const openSpots = Math.max(event.playerCountTotal - event.spotsTaken, 0);
  const showNeedPlayers = event.viewerMembershipStatus === 'organizer' && openSpots > 0;
  const activeSegments = getOccupancySegments(event.spotsTaken, event.playerCountTotal);

  return (
    <Pressable
      accessibilityHint={t('events.detail.openEventHint', {
        sport: sportName,
        venue: event.venueName,
      })}
      accessibilityLabel={t('shell.myGames.card.openHint', { sport: sportName })}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.eventCard,
        showNeedPlayers ? styles.eventCardHighlighted : undefined,
        pressed ? styles.eventCardPressed : undefined,
      ]}
    >
      {showNeedPlayers ? (
        <View style={styles.needPlayersBadge}>
          <Text style={styles.needPlayersBadgeLabel}>
            {t('shell.myGames.card.needsPlayers', { count: openSpots })}
          </Text>
        </View>
      ) : null}

      <View style={styles.eventCardTopRow}>
        <View style={styles.eventCardIdentity}>
          <SportBadge
            colorHex={event.sportColor}
            label={getSportBadgeLabel({
              slug: event.sportSlug,
              name: sportName,
            })}
          />
          <Text numberOfLines={1} style={styles.eventCardSportLabel}>
            {sportName}
          </Text>
        </View>
        <Text
          style={[
            styles.eventCardRole,
            roleKey === 'organizer' ? styles.eventCardRoleOrganizer : styles.eventCardRolePlayer,
          ]}
        >
          {t(`shell.myGames.card.role.${roleKey}`)}
        </Text>
      </View>

      <View style={styles.eventCardVenueRow}>
        <Ionicons color="#7d8ca1" name="location-outline" size={15} />
        <Text numberOfLines={1} style={styles.eventCardVenueText}>
          {event.venueName}
        </Text>
      </View>

      <View style={styles.eventCardOrganizerRow}>
        <AvatarPhoto label={organizerName} uri={event.organizerPhotoUrl} size={36} />
        <View style={styles.eventCardOrganizerCopy}>
          <Text numberOfLines={1} style={styles.eventCardOrganizerLabel}>
            {event.viewerMembershipStatus === 'organizer'
              ? t('shell.myGames.card.organizedByYou')
              : t('shell.myGames.card.organizedBy', { name: organizerName })}
          </Text>
          <Text numberOfLines={1} style={styles.eventCardOrganizerMeta}>
            {event.city}
            {' · '}
            {t(`events.reservationType.${event.reservationType}`)}
          </Text>
        </View>
        <Ionicons color="#132b4f" name="chevron-forward-outline" size={18} />
      </View>

      <View style={styles.occupancyRow}>
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
          {t('shell.myGames.card.occupancy', {
            current: event.spotsTaken,
            total: event.playerCountTotal,
          })}
        </Text>
      </View>
    </Pressable>
  );
}

export function MyGamesScreen() {
  const { t } = useTranslation();
  const isScreenFocused = useIsFocused();
  const navigation = useNavigation<RootNavigation>();
  const insets = useSafeAreaInsets();
  const language = useUserStore((state) => state.language);
  const userId = useAuthStore((state) => state.userId);
  const [activeTab, setActiveTab] = useState<MyGamesTab>('upcoming');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const upcomingGamesQuery = useQuery({
    queryKey: ['events', 'my-games', 'upcoming', userId],
    queryFn: fetchMyUpcomingGames,
    enabled: Boolean(userId) && activeTab === 'upcoming',
    refetchInterval:
      activeTab === 'upcoming' ? getLifecycleRefetchInterval(isScreenFocused) : false,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });

  const pastGamesQuery = useQuery({
    queryKey: ['events', 'my-games', 'past', userId],
    queryFn: fetchMyPastGames,
    enabled: Boolean(userId) && activeTab === 'past',
    refetchInterval: activeTab === 'past' ? getLifecycleRefetchInterval(isScreenFocused) : false,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });

  const upcomingItems = useMemo(
    () =>
      [...(upcomingGamesQuery.data ?? [])].sort(
        (left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime(),
      ),
    [upcomingGamesQuery.data],
  );
  const pastItems = useMemo(
    () =>
      [...(pastGamesQuery.data ?? [])].sort(
        (left, right) => new Date(right.startsAt).getTime() - new Date(left.startsAt).getTime(),
      ),
    [pastGamesQuery.data],
  );
  const activeQuery = activeTab === 'upcoming' ? upcomingGamesQuery : pastGamesQuery;
  const activeItems = activeTab === 'upcoming' ? upcomingItems : pastItems;
  const currentWeekUpcomingCount = useMemo(
    () =>
      upcomingItems.filter((item) =>
        isSameWeek(new Date(item.startsAt), new Date(), { weekStartsOn: 1 }),
      ).length,
    [upcomingItems],
  );
  const calendarDays = useMemo(() => {
    const calendarStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const nextUpcoming = upcomingItems[0] ?? null;
    const highlightedKey = format(
      nextUpcoming ? new Date(nextUpcoming.startsAt) : new Date(),
      'yyyy-MM-dd',
    );

    return Array.from({ length: CALENDAR_PREVIEW_DAYS }).map((_, index) => {
      const date = addDays(calendarStart, index);
      const dateKey = format(date, 'yyyy-MM-dd');
      const hasGame = upcomingItems.some(
        (item) => format(new Date(item.startsAt), 'yyyy-MM-dd') === dateKey,
      );

      return {
        date,
        dateKey,
        dayLabel: weekdayChipMap[language][index % 7],
        dayNumber: format(date, 'd', { locale: getDateFnsLocale(language) }),
        highlighted: dateKey === highlightedKey,
        hasGame,
      };
    });
  }, [language, upcomingItems]);
  const headerMonthLabel = useMemo(() => {
    if (activeTab === 'past' && pastItems.length) {
      return formatMonthLabel(new Date(pastItems[0].startsAt), language);
    }

    return formatMonthLabel(new Date(), language);
  }, [activeTab, language, pastItems]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await activeQuery.refetch();
    setIsRefreshing(false);
  }

  async function handleTabChange(nextTab: MyGamesTab) {
    if (nextTab === activeTab) {
      return;
    }

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveTab(nextTab);
  }

  function renderHeader() {
    return (
      <View style={styles.headerWrap}>
        <Text style={styles.screenTitle}>{t('navigation.titles.myGames')}</Text>
        <Text style={styles.monthLabel}>{headerMonthLabel}</Text>

        {activeTab === 'upcoming' ? (
          <>
            {currentWeekUpcomingCount > 0 ? (
              <Text style={styles.headline}>
                {t('shell.myGames.headline.upcomingLead')}{' '}
                <Text style={styles.headlineHighlight}>{`${currentWeekUpcomingCount}×`}</Text>
                {'\n'}
                {t('shell.myGames.headline.upcomingTail')}
              </Text>
            ) : (
              <Text style={styles.headline}>
                {t('shell.myGames.headline.upcomingEmptyLead')}
                {'\n'}
                {t('shell.myGames.headline.upcomingEmptyTail')}
              </Text>
            )}

            <View style={styles.weekStrip}>
              <ScrollView
                horizontal
                nestedScrollEnabled
                contentContainerStyle={styles.weekStripContent}
                showsHorizontalScrollIndicator={false}
              >
                {calendarDays.map((day) => (
                  <View
                    key={day.dateKey}
                    style={[
                      styles.weekDayCard,
                      day.highlighted ? styles.weekDayCardActive : undefined,
                    ]}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.weekDayLabel,
                        day.highlighted ? styles.weekDayLabelActive : undefined,
                      ]}
                    >
                      {day.dayLabel}
                    </Text>
                    <Text
                      adjustsFontSizeToFit
                      minimumFontScale={0.78}
                      numberOfLines={1}
                      style={[
                        styles.weekDayNumber,
                        day.highlighted ? styles.weekDayNumberActive : undefined,
                      ]}
                    >
                      {day.dayNumber}
                    </Text>
                    <View
                      style={[
                        styles.weekDayDot,
                        day.hasGame ? styles.weekDayDotVisible : undefined,
                        day.highlighted ? styles.weekDayDotActive : undefined,
                      ]}
                    />
                  </View>
                ))}
              </ScrollView>
            </View>
          </>
        ) : (
          <Text style={styles.headlinePast}>{t('shell.myGames.pastTitle')}</Text>
        )}

        <View style={styles.tabRow}>
          <Pressable
            accessibilityLabel={t('shell.myGames.tabs.upcoming')}
            accessibilityRole="button"
            onPress={() => {
              void handleTabChange('upcoming');
            }}
            style={[styles.tabPill, activeTab === 'upcoming' ? styles.tabPillActive : undefined]}
          >
            <Text
              style={[
                styles.tabPillLabel,
                activeTab === 'upcoming' ? styles.tabPillLabelActive : undefined,
              ]}
            >
              {`${t('shell.myGames.tabs.upcoming')} · ${upcomingItems.length}`}
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel={t('shell.myGames.tabs.past')}
            accessibilityRole="button"
            onPress={() => {
              void handleTabChange('past');
            }}
            style={[styles.tabPill, activeTab === 'past' ? styles.tabPillActive : undefined]}
          >
            <Text
              style={[
                styles.tabPillLabel,
                activeTab === 'past' ? styles.tabPillLabelActive : undefined,
              ]}
            >
              {`${t('shell.myGames.tabs.past')} · ${pastItems.length}`}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  function renderTimeline() {
    if (activeQuery.isPending && !activeItems.length) {
      return (
        <View style={styles.loadingBlock}>
          <ActivityIndicator color="#183153" size="large" />
        </View>
      );
    }

    if (activeQuery.isError) {
      return (
        <MyGamesStateCard
          actionLabel={t('events.common.retry')}
          body={
            activeTab === 'upcoming'
              ? t('shell.myGames.errorBody')
              : t('shell.myGames.pastErrorBody')
          }
          iconName="cloud-offline-outline"
          onPress={async () => {
            await activeQuery.refetch();
          }}
          title={
            activeTab === 'upcoming'
              ? t('shell.myGames.errorTitle')
              : t('shell.myGames.pastErrorTitle')
          }
        />
      );
    }

    if (!activeItems.length) {
      return (
        <MyGamesStateCard
          actionLabel={activeTab === 'upcoming' ? t('shell.myGames.openCreate') : undefined}
          body={
            activeTab === 'upcoming'
              ? t('shell.myGames.emptyBody')
              : t('shell.myGames.pastEmptyBody')
          }
          iconName={activeTab === 'upcoming' ? 'calendar-outline' : 'trophy-outline'}
          onPress={
            activeTab === 'upcoming'
              ? () =>
                  navigation.navigate('MainTabs', {
                    screen: 'CreateEventTab',
                    params: { screen: 'CreateEvent' },
                  })
              : undefined
          }
          title={
            activeTab === 'upcoming'
              ? t('shell.myGames.emptyTitle')
              : t('shell.myGames.pastEmptyTitle')
          }
        />
      );
    }

    return (
      <View style={styles.timelineList}>
        {activeItems.map((item) => {
          const eventDate = new Date(item.startsAt);

          return (
            <View key={item.id} style={styles.timelineRow}>
              <View style={styles.timelineRail}>
                <Text style={styles.timelineDayLabel}>
                  {formatDayHeading(eventDate, language, t, activeTab === 'past')}
                </Text>
                <Text style={styles.timelineTimeLabel}>
                  {formatEventTime(item.startsAt, language)}
                </Text>
                <Text style={styles.timelineDateLabel}>{formatShortDate(eventDate, language)}</Text>
              </View>

              <View style={styles.timelineCardWrap}>
                <MyGamesEventCard
                  event={item}
                  language={language}
                  onPress={() => navigation.navigate('EventDetail', { eventId: item.id })}
                />
                {activeTab === 'past' ? <PastEventActions event={item as MyGamesPastItem} /> : null}
              </View>
            </View>
          );
        })}
      </View>
    );
  }

  const listBottomPadding = Math.max(insets.bottom, 16) + 128;

  return (
    <ScrollView
      contentContainerStyle={[
        styles.listContent,
        {
          paddingTop: insets.top + 18,
          paddingBottom: listBottomPadding,
        },
      ]}
      refreshControl={
        <RefreshControl
          onRefresh={() => {
            void handleRefresh();
          }}
          progressViewOffset={12}
          refreshing={isRefreshing}
          tintColor="#183153"
        />
      }
      showsVerticalScrollIndicator={false}
      style={styles.screen}
    >
      {isScreenFocused ? <StatusBar style="dark" /> : null}
      {renderHeader()}
      {renderTimeline()}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f7f0e6',
  },
  listContent: {
    paddingHorizontal: 20,
  },
  headerWrap: {
    gap: 14,
    marginBottom: 22,
  },
  screenTitle: {
    marginBottom: 4,
    textAlign: 'center',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
    color: '#10233f',
  },
  monthLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.8,
    color: '#b09a7b',
  },
  headline: {
    fontSize: 28,
    lineHeight: 33,
    fontWeight: '900',
    color: '#10233f',
  },
  headlinePast: {
    fontSize: 28,
    lineHeight: 33,
    fontWeight: '900',
    color: '#10233f',
  },
  headlineHighlight: {
    backgroundColor: '#d8ff39',
    color: '#10233f',
  },
  weekStrip: {
    borderRadius: 24,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#eee0ce',
    shadowColor: '#10233f',
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  weekStripContent: {
    gap: 8,
    paddingHorizontal: 12,
  },
  weekDayCard: {
    width: 48,
    minHeight: 62,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    paddingVertical: 7,
    gap: 3,
  },
  weekDayCardActive: {
    backgroundColor: '#132b4f',
  },
  weekDayLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    color: '#8897aa',
  },
  weekDayLabelActive: {
    color: '#f3f7fb',
  },
  weekDayNumber: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '900',
    color: '#132b4f',
  },
  weekDayNumberActive: {
    color: '#ffffff',
  },
  weekDayDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: 'transparent',
  },
  weekDayDotVisible: {
    backgroundColor: '#132b4f',
  },
  weekDayDotActive: {
    backgroundColor: '#d8ff39',
  },
  tabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tabPill: {
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: '#fbf7f1',
    borderWidth: 1,
    borderColor: '#eadccc',
  },
  tabPillActive: {
    backgroundColor: '#132b4f',
    borderColor: '#132b4f',
  },
  tabPillLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: '#6f6251',
  },
  tabPillLabelActive: {
    color: '#ffffff',
  },
  loadingBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 56,
  },
  timelineList: {
    gap: 18,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  timelineRail: {
    width: 86,
    paddingTop: 10,
  },
  timelineDayLabel: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.1,
    color: '#9a8b77',
    textTransform: 'uppercase',
  },
  timelineTimeLabel: {
    marginTop: 4,
    fontSize: 24,
    lineHeight: 27,
    fontWeight: '900',
    color: '#10233f',
  },
  timelineDateLabel: {
    marginTop: 3,
    fontSize: 14,
    lineHeight: 18,
    color: '#8a98a9',
  },
  timelineCardWrap: {
    flex: 1,
    gap: 10,
  },
  eventCard: {
    position: 'relative',
    borderRadius: 26,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#efe3d4',
    shadowColor: '#10233f',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
    gap: 14,
  },
  eventCardHighlighted: {
    borderColor: '#d8ff39',
    borderWidth: 2,
  },
  eventCardPressed: {
    transform: [{ scale: 0.99 }],
  },
  needPlayersBadge: {
    position: 'absolute',
    top: -12,
    right: 16,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#d8ff39',
  },
  needPlayersBadgeLabel: {
    fontSize: 12,
    fontWeight: '900',
    color: '#183153',
    textTransform: 'uppercase',
  },
  eventCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  eventCardIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  eventCardSportLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    color: '#183153',
  },
  eventCardRole: {
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  eventCardRoleOrganizer: {
    color: '#ff6f4d',
  },
  eventCardRolePlayer: {
    color: '#8a98a9',
  },
  eventCardVenueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  eventCardVenueText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    color: '#4c5d74',
  },
  eventCardOrganizerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  eventCardOrganizerCopy: {
    flex: 1,
    gap: 2,
  },
  eventCardOrganizerLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: '#183153',
  },
  eventCardOrganizerMeta: {
    fontSize: 13,
    lineHeight: 17,
    color: '#8090a6',
  },
  occupancyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  occupancyTrack: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
  },
  occupancySegment: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#e6ebf0',
  },
  occupancySegmentActive: {
    backgroundColor: '#132b4f',
  },
  occupancyLabel: {
    fontSize: 18,
    fontWeight: '800',
    color: '#4c5d74',
  },
  stateCard: {
    alignItems: 'center',
    borderRadius: 28,
    paddingHorizontal: 24,
    paddingVertical: 28,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#efe3d4',
    shadowColor: '#10233f',
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  stateIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  stateTitle: {
    marginTop: 16,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '900',
    color: '#10233f',
    textAlign: 'center',
  },
  stateBody: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    color: '#64748b',
    textAlign: 'center',
  },
  stateAction: {
    marginTop: 20,
    width: '100%',
  },
  actionBlock: {
    gap: 14,
  },
  actionBody: {
    fontSize: 14,
    lineHeight: 21,
    color: '#4c5d74',
  },
  centeredBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 80,
  },
  promptRow: {
    gap: 12,
  },
  promptPlayerCard: {
    borderRadius: 20,
    padding: 14,
    gap: 10,
    backgroundColor: '#f7fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  promptPlayerName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#183153',
  },
  helperText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#64748b',
  },
});
