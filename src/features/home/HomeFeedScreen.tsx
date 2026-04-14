import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { addDays, formatISO, startOfDay } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { ActionButton } from '../auth/AuthPrimitives';
import { fetchAvailablePlayersFeed } from '../../services/availability';
import { getLifecycleRefetchInterval } from '../events/event-eligibility';
import {
  AvatarPhoto,
  FilterChip,
  EventSummaryCard,
  InfoPill,
  SportBadge,
} from '../events/EventPrimitives';
import { NativePickerField } from '../events/NativePickerField';
import { ScreenCard, SegmentedTabs } from '../../components/ScreenShell';
import { StateMessage } from '../../components/StateMessage';
import { fetchActiveSports, fetchEventFeedPage } from '../../services/events';
import { useAuthStore } from '../../store/auth-store';
import { useUserStore } from '../../store/user-store';
import type { RootStackParamList } from '../../navigation/types';
import type { AvailabilityFeedItem } from '../../types/availability';
import { formatEventDate } from '../../utils/dates';

type RootNavigation = NavigationProp<RootStackParamList>;

const PAGE_SIZE = 20;

function getSportBadgeLabel(slug: string, fallbackName: string): string {
  if (slug === 'badminton') {
    return 'BD';
  }

  if (slug === 'padel') {
    return 'PD';
  }

  if (slug === 'squash') {
    return 'SQ';
  }

  return fallbackName.slice(0, 2).toUpperCase();
}

function AvailabilityPlayerCard({
  fallbackName,
  item,
  language,
  onPress,
  playAgainLabel,
  timePreferenceLabel,
}: {
  fallbackName: string;
  item: AvailabilityFeedItem;
  language: 'cs' | 'en';
  onPress: () => void;
  playAgainLabel: string;
  timePreferenceLabel: string;
}) {
  const { t } = useTranslation();
  const fullName = [item.firstName, item.lastName].filter(Boolean).join(' ') || fallbackName;
  const sportName = language === 'cs' ? item.sportNameCs : item.sportNameEn;
  const translatedSkillLevel = t(`events.skillLevel.label.${item.skillLevel}`);

  return (
    <Pressable
      accessibilityHint={t('events.detail.openPlayerProfileHint')}
      accessibilityLabel={fullName}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.cardPressable}
    >
      <View style={[styles.availabilityCard, { borderLeftColor: item.sportColor }]}>
        <View style={styles.availabilityHeader}>
          <View style={styles.availabilityIdentity}>
            <AvatarPhoto label={fullName} uri={item.photoUrl} size={48} />
            <View style={styles.availabilityIdentityCopy}>
              <Text style={styles.availabilityName}>{fullName}</Text>
              <Text style={styles.availabilityMeta}>{sportName}</Text>
            </View>
          </View>
          <SportBadge
            colorHex={item.sportColor}
            label={getSportBadgeLabel(item.sportSlug, sportName)}
          />
        </View>

        <Text style={styles.availabilityMeta}>
          {t('availability.cardSummary', {
            games: item.gamesPlayed,
            skill: translatedSkillLevel,
          })}
        </Text>

        <View style={styles.availabilitySignalsRow}>
          <InfoPill accentColor={item.sportColor}>{timePreferenceLabel}</InfoPill>
          {item.isPlayAgainConnection ? (
            <InfoPill accentColor="#183153">{playAgainLabel}</InfoPill>
          ) : null}
        </View>

        <View style={styles.availabilityDatesRow}>
          <Ionicons color="#708298" name="calendar-clear-outline" size={16} />
          <Text style={styles.availabilityDates}>
            {item.availableDates
              .map((dateValue) => formatEventDate(`${dateValue}T00:00:00`, language))
              .join(' · ')}
          </Text>
        </View>

        {item.note ? (
          <Text numberOfLines={2} style={styles.availabilityNote}>
            {item.note}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function FeedStateCard({
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
    <ScreenCard>
      <StateMessage
        action={
          actionLabel && onPress ? (
            <ActionButton
              iconName={iconName === 'cloud-offline-outline' ? 'refresh-outline' : 'add-outline'}
              label={actionLabel}
              onPress={onPress}
              variant={iconName === 'cloud-offline-outline' ? 'secondary' : 'primary'}
            />
          ) : undefined
        }
        body={body}
        iconName={iconName}
        title={title}
        tone={iconName === 'cloud-offline-outline' ? 'muted' : 'warm'}
      />
    </ScreenCard>
  );
}

export function HomeFeedScreen() {
  const { t } = useTranslation();
  const isScreenFocused = useIsFocused();
  const navigation = useNavigation<RootNavigation>();
  const userId = useAuthStore((state) => state.userId);
  const selectedCity = useUserStore((state) => state.selectedCity);
  const language = useUserStore((state) => state.language);
  const [activeTab, setActiveTab] = useState<'upcoming' | 'available'>('upcoming');
  const [selectedSportIds, setSelectedSportIds] = useState<string[]>([]);
  const [selectedAvailabilitySportIds, setSelectedAvailabilitySportIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(() => startOfDay(new Date()));
  const [endDate, setEndDate] = useState(() => startOfDay(addDays(new Date(), 7)));
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);

  const sportsQuery = useQuery({
    queryKey: ['sports', 'active'],
    queryFn: fetchActiveSports,
    staleTime: 86_400_000,
  });

  const feedQuery = useInfiniteQuery({
    queryKey: [
      'events',
      'feed',
      selectedCity,
      [...selectedSportIds].sort().join(','),
      startDate.toISOString(),
      endDate.toISOString(),
    ],
    queryFn: ({ pageParam }) =>
      fetchEventFeedPage({
        filters: {
          city: selectedCity ?? '',
          sportIds: selectedSportIds,
          startsAtFrom: startDate.toISOString(),
          startsAtTo: addDays(endDate, 1).toISOString(),
        },
        offset: pageParam,
        limit: PAGE_SIZE,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE ? allPages.length * PAGE_SIZE : undefined,
    enabled: activeTab === 'upcoming' && Boolean(selectedCity),
    refetchInterval:
      activeTab === 'upcoming' ? getLifecycleRefetchInterval(isScreenFocused) : false,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });

  const feedItems = feedQuery.data?.pages.flat() ?? [];
  const availablePlayersQuery = useQuery({
    queryKey: [
      'availability',
      'feed',
      selectedCity,
      [...selectedAvailabilitySportIds].sort().join(','),
      formatISO(startDate, { representation: 'date' }),
      formatISO(endDate, { representation: 'date' }),
      userId,
    ],
    queryFn: () => {
      if (!selectedCity) {
        throw new Error('Missing selected city for availability feed.');
      }

      return fetchAvailablePlayersFeed({
        city: selectedCity,
        sportIds: selectedAvailabilitySportIds,
        availableDateFrom: formatISO(startDate, { representation: 'date' }),
        availableDateTo: formatISO(endDate, { representation: 'date' }),
        viewerUserId: userId,
      });
    },
    enabled: activeTab === 'available' && Boolean(selectedCity),
    refetchInterval:
      activeTab === 'available' ? getLifecycleRefetchInterval(isScreenFocused) : false,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });
  const activeCount =
    activeTab === 'available' ? (availablePlayersQuery.data?.length ?? 0) : feedItems.length;

  function toggleSportFilter(sportId: string) {
    setSelectedSportIds((current) =>
      current.includes(sportId)
        ? current.filter((value) => value !== sportId)
        : [...current, sportId],
    );
  }

  function toggleAvailabilitySportFilter(sportId: string) {
    setSelectedAvailabilitySportIds((current) =>
      current.includes(sportId)
        ? current.filter((value) => value !== sportId)
        : [...current, sportId],
    );
  }

  async function handleRefresh() {
    setIsPullRefreshing(true);

    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (activeTab === 'available') {
        await availablePlayersQuery.refetch();
      } else {
        await feedQuery.refetch();
      }
    } finally {
      setIsPullRefreshing(false);
    }
  }

  function renderHeader() {
    return (
      <View style={styles.headerWrap}>
        <View style={styles.hero}>
          <View style={styles.heroMetaRow}>
            <View style={styles.heroPill}>
              <Ionicons color="#dbe4ee" name="location-outline" size={14} />
              <Text style={styles.heroPillLabel}>{selectedCity ?? t('shell.common.noCity')}</Text>
            </View>
            <View style={styles.heroPill}>
              <Ionicons
                color="#dbe4ee"
                name={activeTab === 'available' ? 'people-outline' : 'flash-outline'}
                size={14}
              />
              <Text style={styles.heroPillLabel}>
                {activeTab === 'available'
                  ? t('shell.home.tabs.availablePlayers')
                  : t('shell.home.tabs.upcoming')}
              </Text>
            </View>
          </View>
          <Text style={styles.heroTitle}>{t('shell.home.title')}</Text>
          <Text style={styles.heroSubtitle}>
            {activeTab === 'available' ? t('availability.subtitle') : t('shell.home.subtitle')}
          </Text>
        </View>

        <SegmentedTabs
          onChange={setActiveTab}
          options={[
            { label: t('shell.home.tabs.upcoming'), value: 'upcoming' },
            { label: t('shell.home.tabs.availablePlayers'), value: 'available' },
          ]}
          value={activeTab}
        />

        {activeTab === 'upcoming' ? (
          <ScreenCard>
            <View style={styles.surfaceHeader}>
              <View style={styles.surfaceTitleWrap}>
                <View style={styles.surfaceTitleRow}>
                  <Ionicons color="#183153" name="options-outline" size={16} />
                  <Text style={styles.surfaceTitle}>{t('events.feed.filtersTitle')}</Text>
                </View>
                <Text style={styles.surfaceSubtitle}>
                  {selectedCity ?? t('shell.common.noCity')}
                </Text>
              </View>
            </View>
            <View style={styles.filterChipWrap}>
              <FilterChip
                label={t('availability.allSports')}
                onPress={() => setSelectedSportIds([])}
                selected={selectedSportIds.length === 0}
              />
              {(sportsQuery.data ?? []).map((sport) => (
                <FilterChip
                  key={sport.id}
                  label={language === 'cs' ? sport.nameCs : sport.nameEn}
                  onPress={() => toggleSportFilter(sport.id)}
                  selected={selectedSportIds.includes(sport.id)}
                />
              ))}
            </View>
            <View style={styles.dateFieldRow}>
              <View style={styles.dateFieldWrap}>
                <NativePickerField
                  label={t('events.feed.startDate')}
                  mode="date"
                  onChange={(nextValue) => {
                    setStartDate(nextValue);

                    if (nextValue > endDate) {
                      setEndDate(nextValue);
                    }
                  }}
                  placeholder={t('events.feed.startDatePlaceholder')}
                  value={startDate}
                  valueText={formatEventDate(startDate, language)}
                />
              </View>
              <View style={styles.dateFieldWrap}>
                <NativePickerField
                  label={t('events.feed.endDate')}
                  mode="date"
                  onChange={(nextValue) => {
                    setEndDate(nextValue < startDate ? startDate : nextValue);
                  }}
                  placeholder={t('events.feed.endDatePlaceholder')}
                  value={endDate}
                  valueText={formatEventDate(endDate, language)}
                />
              </View>
            </View>
          </ScreenCard>
        ) : (
          <ScreenCard>
            <View style={styles.surfaceHeader}>
              <View style={styles.surfaceTitleWrap}>
                <View style={styles.surfaceTitleRow}>
                  <Ionicons color="#183153" name="sparkles-outline" size={16} />
                  <Text style={styles.surfaceTitle}>{t('availability.availablePlayersTitle')}</Text>
                </View>
                <Text style={styles.surfaceSubtitle}>
                  {selectedCity ?? t('shell.common.noCity')}
                </Text>
              </View>
            </View>
            <View style={styles.filterChipWrap}>
              <FilterChip
                label={t('availability.allSports')}
                onPress={() => setSelectedAvailabilitySportIds([])}
                selected={selectedAvailabilitySportIds.length === 0}
              />
              {(sportsQuery.data ?? []).map((sport) => (
                <FilterChip
                  key={sport.id}
                  label={language === 'cs' ? sport.nameCs : sport.nameEn}
                  onPress={() => toggleAvailabilitySportFilter(sport.id)}
                  selected={selectedAvailabilitySportIds.includes(sport.id)}
                />
              ))}
            </View>
            <View style={styles.dateFieldRow}>
              <View style={styles.dateFieldWrap}>
                <NativePickerField
                  label={t('availability.startDate')}
                  mode="date"
                  onChange={(nextValue) => {
                    setStartDate(nextValue);

                    if (nextValue > endDate) {
                      setEndDate(nextValue);
                    }
                  }}
                  placeholder={t('availability.startDatePlaceholder')}
                  value={startDate}
                  valueText={formatEventDate(startDate, language)}
                />
              </View>
              <View style={styles.dateFieldWrap}>
                <NativePickerField
                  label={t('availability.endDate')}
                  mode="date"
                  onChange={(nextValue) => {
                    setEndDate(nextValue < startDate ? startDate : nextValue);
                  }}
                  placeholder={t('availability.endDatePlaceholder')}
                  value={endDate}
                  valueText={formatEventDate(endDate, language)}
                />
              </View>
            </View>
            <ActionButton
              iconName="add-circle-outline"
              label={t('availability.openFormAction')}
              onPress={() => navigation.navigate('PostAvailability')}
            />
          </ScreenCard>
        )}

        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleWrap}>
            <Text style={styles.sectionTitle}>
              {activeTab === 'available'
                ? t('availability.availablePlayersTitle')
                : t('shell.home.tabs.upcoming')}
            </Text>
            <Text style={styles.sectionSubtitle}>{selectedCity ?? t('shell.common.noCity')}</Text>
          </View>
          <View style={styles.sectionCountPill}>
            <Text style={styles.sectionCountLabel}>{activeCount}</Text>
          </View>
        </View>
      </View>
    );
  }

  if (activeTab === 'available') {
    return (
      <FlatList
        contentContainerStyle={styles.listContent}
        data={availablePlayersQuery.data ?? []}
        keyExtractor={(item) =>
          `${item.userId}-${item.sportId}-${item.timePreference ?? 'any'}-${item.note ?? 'none'}`
        }
        ListEmptyComponent={
          availablePlayersQuery.isLoading ? (
            <View style={styles.centeredBlock}>
              <ActivityIndicator color="#183153" />
            </View>
          ) : availablePlayersQuery.isError ? (
            <FeedStateCard
              actionLabel={t('events.common.retry')}
              body={t('availability.errorBody')}
              iconName="cloud-offline-outline"
              onPress={async () => {
                await availablePlayersQuery.refetch();
              }}
              title={t('availability.errorTitle')}
            />
          ) : (
            <FeedStateCard
              actionLabel={t('availability.openFormAction')}
              body={t('availability.emptyBody')}
              iconName="people-outline"
              onPress={() => navigation.navigate('PostAvailability')}
              title={t('availability.emptyTitle')}
            />
          )
        }
        ListHeaderComponent={renderHeader}
        ItemSeparatorComponent={() => <View style={styles.listSeparator} />}
        refreshControl={
          <RefreshControl onRefresh={() => void handleRefresh()} refreshing={isPullRefreshing} />
        }
        renderItem={({ item }) => (
          <AvailabilityPlayerCard
            fallbackName={t('auth.home.defaultName')}
            item={item}
            language={language}
            onPress={() => navigation.navigate('PlayerProfile', { playerId: item.userId })}
            playAgainLabel={t('profile.playAgainBadge')}
            timePreferenceLabel={t(
              `availability.timePreferenceValues.${item.timePreference ?? 'any'}`,
            )}
          />
        )}
        showsVerticalScrollIndicator={false}
      />
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.listContent}
      data={feedItems}
      keyExtractor={(item) => item.id}
      ListEmptyComponent={
        feedQuery.isLoading ? (
          <View style={styles.centeredBlock}>
            <ActivityIndicator color="#183153" />
          </View>
        ) : feedQuery.isError ? (
          <FeedStateCard
            actionLabel={t('events.common.retry')}
            body={t('events.feed.errorBody')}
            iconName="cloud-offline-outline"
            onPress={async () => {
              await feedQuery.refetch();
            }}
            title={t('events.feed.errorTitle')}
          />
        ) : (
          <FeedStateCard
            actionLabel={t('events.feed.emptyCreateAction')}
            body={t('events.feed.emptyBody')}
            iconName="search-outline"
            onPress={() =>
              navigation.navigate('MainTabs', {
                screen: 'CreateEventTab',
                params: { screen: 'CreateEvent' },
              })
            }
            title={t('events.feed.emptyTitle')}
          />
        )
      }
      ListFooterComponent={
        feedQuery.isFetchingNextPage ? (
          <View style={styles.centeredBlock}>
            <ActivityIndicator color="#183153" />
          </View>
        ) : null
      }
      ListHeaderComponent={renderHeader}
      ItemSeparatorComponent={() => <View style={styles.listSeparator} />}
      onEndReached={() => {
        if (feedQuery.hasNextPage && !feedQuery.isFetchingNextPage) {
          void feedQuery.fetchNextPage();
        }
      }}
      onEndReachedThreshold={0.35}
      refreshControl={
        <RefreshControl onRefresh={() => void handleRefresh()} refreshing={isPullRefreshing} />
      }
      renderItem={({ item }) => (
        <EventSummaryCard
          event={item}
          language={language}
          onPress={() => navigation.navigate('EventDetail', { eventId: item.id })}
        />
      )}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 14,
    backgroundColor: '#f7f0e6',
  },
  headerWrap: {
    gap: 14,
    marginBottom: 14,
  },
  hero: {
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 18,
    backgroundColor: '#183153',
  },
  heroMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  heroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(255, 248, 240, 0.12)',
  },
  heroPillLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#dbe4ee',
  },
  heroTitle: {
    fontSize: 26,
    lineHeight: 31,
    fontWeight: '800',
    color: '#fff8f0',
  },
  heroSubtitle: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 22,
    color: '#dbe4ee',
  },
  surfaceHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  surfaceTitleWrap: {
    flex: 1,
    gap: 4,
  },
  surfaceTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  surfaceTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#183153',
  },
  surfaceSubtitle: {
    fontSize: 13,
    color: '#6c7f94',
  },
  filterChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dateFieldRow: {
    flexDirection: 'row',
    gap: 10,
  },
  dateFieldWrap: {
    flex: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitleWrap: {
    flex: 1,
    gap: 2,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#183153',
  },
  sectionSubtitle: {
    fontSize: 13,
    color: '#708298',
  },
  sectionCountPill: {
    minWidth: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#efe4d5',
  },
  sectionCountLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: '#183153',
  },
  centeredBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  listSeparator: {
    height: 12,
  },
  availabilityCard: {
    borderRadius: 20,
    borderLeftWidth: 4,
    backgroundColor: '#fffbf6',
    borderWidth: 1,
    borderColor: '#ece0d1',
    padding: 16,
    gap: 8,
    shadowColor: '#10233f',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 1,
  },
  availabilityDates: {
    fontSize: 14,
    lineHeight: 20,
    color: '#183153',
    fontWeight: '600',
  },
  availabilityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  availabilityIdentity: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    flex: 1,
  },
  availabilityIdentityCopy: {
    flex: 1,
    gap: 2,
  },
  availabilityMeta: {
    fontSize: 14,
    lineHeight: 20,
    color: '#617184',
  },
  availabilitySignalsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  availabilityDatesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  availabilityName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#183153',
  },
  availabilityNote: {
    fontSize: 14,
    lineHeight: 20,
    color: '#395065',
    paddingTop: 2,
  },
  cardPressable: {
    borderRadius: 20,
  },
});
