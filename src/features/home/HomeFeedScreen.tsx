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
              <Text style={styles.availabilityMeta}>
                {language === 'cs' ? item.sportNameCs : item.sportNameEn}
              </Text>
            </View>
          </View>
          <View style={styles.headerPills}>
            <SportBadge
              colorHex={item.sportColor}
              label={getSportBadgeLabel(item.sportSlug, sportName)}
            />
            <InfoPill accentColor={item.sportColor}>{timePreferenceLabel}</InfoPill>
            {item.isPlayAgainConnection ? (
              <InfoPill accentColor="#183153">{playAgainLabel}</InfoPill>
            ) : null}
          </View>
        </View>

        <Text style={styles.availabilityDates}>
          {item.availableDates
            .map((dateValue) => formatEventDate(`${dateValue}T00:00:00`, language))
            .join(' · ')}
        </Text>
        <Text style={styles.availabilityMeta}>
          {t('availability.cardSummary', {
            games: item.gamesPlayed,
            skill: translatedSkillLevel,
          })}
        </Text>
        {item.note ? <Text style={styles.availabilityNote}>{item.note}</Text> : null}
      </View>
    </Pressable>
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
          <Text style={styles.heroTitle}>{t('shell.home.title')}</Text>
          <Text style={styles.heroSubtitle}>{t('shell.home.subtitle')}</Text>
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
          <ScreenCard title={t('events.feed.filtersTitle')}>
            <View style={styles.filterMeta}>
              <Text style={styles.filterMetaLabel}>{t('shell.common.cityLabel')}</Text>
              <Text style={styles.filterMetaValue}>{selectedCity ?? t('shell.common.noCity')}</Text>
            </View>
            <View style={styles.filterChipWrap}>
              {(sportsQuery.data ?? []).map((sport) => (
                <FilterChip
                  key={sport.id}
                  label={language === 'cs' ? sport.nameCs : sport.nameEn}
                  onPress={() => toggleSportFilter(sport.id)}
                  selected={selectedSportIds.includes(sport.id)}
                />
              ))}
            </View>
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
          </ScreenCard>
        ) : (
          <ScreenCard title={t('availability.availablePlayersTitle')}>
            <View style={styles.filterMeta}>
              <Text style={styles.filterMetaLabel}>{t('shell.common.cityLabel')}</Text>
              <Text style={styles.filterMetaValue}>{selectedCity ?? t('shell.common.noCity')}</Text>
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
            <ActionButton
              label={t('availability.openFormAction')}
              onPress={() => navigation.navigate('PostAvailability')}
            />
          </ScreenCard>
        )}
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
            <ScreenCard title={t('availability.errorTitle')}>
              <Text style={styles.placeholderText}>{t('availability.errorBody')}</Text>
              <ActionButton
                label={t('events.common.retry')}
                onPress={async () => {
                  await availablePlayersQuery.refetch();
                }}
              />
            </ScreenCard>
          ) : (
            <ScreenCard title={t('availability.emptyTitle')}>
              <Text style={styles.placeholderText}>{t('availability.emptyBody')}</Text>
              <ActionButton
                label={t('availability.openFormAction')}
                onPress={() => navigation.navigate('PostAvailability')}
              />
            </ScreenCard>
          )
        }
        ListHeaderComponent={renderHeader}
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
          <ScreenCard title={t('events.feed.errorTitle')}>
            <Text style={styles.placeholderText}>{t('events.feed.errorBody')}</Text>
            <ActionButton
              label={t('events.common.retry')}
              onPress={async () => {
                await feedQuery.refetch();
              }}
            />
          </ScreenCard>
        ) : (
          <ScreenCard title={t('events.feed.emptyTitle')}>
            <Text style={styles.placeholderText}>{t('events.feed.emptyBody')}</Text>
            <ActionButton
              label={t('events.feed.emptyCreateAction')}
              onPress={() =>
                navigation.navigate('MainTabs', {
                  screen: 'CreateEventTab',
                  params: { screen: 'CreateEvent' },
                })
              }
            />
          </ScreenCard>
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
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 16,
    backgroundColor: '#f7f0e6',
  },
  headerWrap: {
    gap: 16,
    marginBottom: 16,
  },
  headerPills: {
    alignItems: 'flex-end',
    gap: 8,
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
  filterMeta: {
    gap: 4,
  },
  filterMetaLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: '#a0603b',
  },
  filterMetaValue: {
    fontSize: 15,
    color: '#395065',
  },
  filterChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  centeredBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  availabilityCard: {
    borderRadius: 24,
    borderLeftWidth: 6,
    backgroundColor: '#fffaf3',
    borderWidth: 1,
    borderColor: '#eadfce',
    padding: 18,
    gap: 10,
  },
  availabilityDates: {
    fontSize: 14,
    lineHeight: 20,
    color: '#183153',
    fontWeight: '600',
  },
  availabilityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  availabilityIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
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
    color: '#5a6475',
  },
  availabilityName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#183153',
  },
  availabilityNote: {
    fontSize: 14,
    lineHeight: 20,
    color: '#395065',
  },
  cardPressable: {
    marginBottom: 16,
  },
  placeholderText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#395065',
  },
});
