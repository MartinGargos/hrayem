import { useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { ActionButton } from '../auth/AuthPrimitives';
import { EventSummaryCard } from '../events/EventPrimitives';
import { ScreenCard, ScreenShell, SegmentedTabs } from '../../components/ScreenShell';
import type { RootStackParamList } from '../../navigation/types';
import { fetchMyUpcomingGames } from '../../services/events';
import { useAuthStore } from '../../store/auth-store';
import { useUserStore } from '../../store/user-store';

type RootNavigation = NavigationProp<RootStackParamList>;

export function MyGamesScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<RootNavigation>();
  const language = useUserStore((state) => state.language);
  const userId = useAuthStore((state) => state.userId);
  const [activeTab, setActiveTab] = useState<'upcoming' | 'past'>('upcoming');

  const upcomingGamesQuery = useQuery({
    queryKey: ['events', 'my-games', 'upcoming', userId],
    queryFn: fetchMyUpcomingGames,
    enabled: Boolean(userId),
    staleTime: 30_000,
  });

  function renderHeader() {
    return (
      <View style={styles.headerWrap}>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>{t('shell.myGames.title')}</Text>
          <Text style={styles.heroSubtitle}>{t('shell.myGames.subtitle')}</Text>
        </View>
        <SegmentedTabs
          onChange={setActiveTab}
          options={[
            { label: t('shell.myGames.tabs.upcoming'), value: 'upcoming' },
            { label: t('shell.myGames.tabs.past'), value: 'past' },
          ]}
          value={activeTab}
        />
      </View>
    );
  }

  if (activeTab === 'past') {
    return (
      <ScreenShell title={t('shell.myGames.title')} subtitle={t('shell.myGames.subtitle')}>
        <SegmentedTabs
          onChange={setActiveTab}
          options={[
            { label: t('shell.myGames.tabs.upcoming'), value: 'upcoming' },
            { label: t('shell.myGames.tabs.past'), value: 'past' },
          ]}
          value={activeTab}
        />
        <ScreenCard title={t('shell.myGames.pastTitle')}>
          <Text style={styles.placeholderText}>{t('shell.myGames.pastPlaceholder')}</Text>
        </ScreenCard>
      </ScreenShell>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.listContent}
      data={upcomingGamesQuery.data ?? []}
      keyExtractor={(item) => item.id}
      ListEmptyComponent={
        upcomingGamesQuery.isPending ? (
          <View style={styles.centeredBlock}>
            <ActivityIndicator color="#183153" />
          </View>
        ) : upcomingGamesQuery.isError ? (
          <ScreenCard title={t('shell.myGames.errorTitle')}>
            <Text style={styles.placeholderText}>{t('shell.myGames.errorBody')}</Text>
            <ActionButton
              label={t('events.common.retry')}
              onPress={async () => {
                await upcomingGamesQuery.refetch();
              }}
            />
          </ScreenCard>
        ) : (
          <ScreenCard title={t('shell.myGames.emptyTitle')}>
            <Text style={styles.placeholderText}>{t('shell.myGames.emptyBody')}</Text>
            <ActionButton
              label={t('shell.myGames.openCreate')}
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
      ListHeaderComponent={renderHeader}
      renderItem={({ item }) => (
        <View style={styles.itemWrap}>
          <Text style={styles.roleLabel}>
            {item.viewerMembershipStatus === 'organizer'
              ? t('shell.myGames.role.organizing')
              : t('shell.myGames.role.playing')}
          </Text>
          <EventSummaryCard
            event={item}
            language={language}
            onPress={() => navigation.navigate('EventDetail', { eventId: item.id })}
          />
        </View>
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
  centeredBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  itemWrap: {
    gap: 8,
  },
  roleLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: '#a0603b',
    paddingHorizontal: 6,
  },
  placeholderText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#395065',
  },
});
