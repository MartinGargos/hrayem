import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { addDays, startOfDay } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { ActionButton } from '../auth/AuthPrimitives';
import { getLifecycleRefetchInterval } from '../events/event-eligibility';
import { FilterChip, EventSummaryCard } from '../events/EventPrimitives';
import { NativePickerField } from '../events/NativePickerField';
import { ScreenCard, ScreenShell, SegmentedTabs } from '../../components/ScreenShell';
import { fetchActiveSports, fetchEventFeedPage } from '../../services/events';
import { useUserStore } from '../../store/user-store';
import type { RootStackParamList } from '../../navigation/types';
import { formatEventDate } from '../../utils/dates';

type RootNavigation = NavigationProp<RootStackParamList>;

const PAGE_SIZE = 20;

export function HomeFeedScreen() {
  const { t } = useTranslation();
  const isScreenFocused = useIsFocused();
  const navigation = useNavigation<RootNavigation>();
  const selectedCity = useUserStore((state) => state.selectedCity);
  const language = useUserStore((state) => state.language);
  const [activeTab, setActiveTab] = useState<'upcoming' | 'available'>('upcoming');
  const [selectedSportIds, setSelectedSportIds] = useState<string[]>([]);
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

  function toggleSportFilter(sportId: string) {
    setSelectedSportIds((current) =>
      current.includes(sportId)
        ? current.filter((value) => value !== sportId)
        : [...current, sportId],
    );
  }

  async function handleRefresh() {
    setIsPullRefreshing(true);

    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await feedQuery.refetch();
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
        ) : null}
      </View>
    );
  }

  if (activeTab === 'available') {
    return (
      <ScreenShell title={t('shell.home.title')} subtitle={t('shell.home.subtitle')}>
        <SegmentedTabs
          onChange={setActiveTab}
          options={[
            { label: t('shell.home.tabs.upcoming'), value: 'upcoming' },
            { label: t('shell.home.tabs.availablePlayers'), value: 'available' },
          ]}
          value={activeTab}
        />
        <ScreenCard title={t('shell.home.availablePlayers.title')}>
          <Text style={styles.placeholderText}>{t('shell.home.availablePlayers.placeholder')}</Text>
          <ActionButton
            label={t('shell.home.availablePlayers.postAvailability')}
            onPress={() => navigation.navigate('PostAvailability')}
          />
        </ScreenCard>
      </ScreenShell>
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
  placeholderText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#395065',
  },
});
