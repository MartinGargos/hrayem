import { useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';

import { ActionButton } from '../auth/AuthPrimitives';
import {
  getLifecycleRefetchInterval,
  hasEnoughConfirmedPlayersForNoShow,
} from '../events/event-eligibility';
import { AvatarPhoto, EventSummaryCard } from '../events/EventPrimitives';
import { ScreenCard, SegmentedTabs } from '../../components/ScreenShell';
import type { RootStackParamList } from '../../navigation/types';
import {
  fetchConfirmedEventPlayers,
  fetchMyPastGames,
  fetchMyUpcomingGames,
  giveThumbsUp,
} from '../../services/events';
import { useAuthStore } from '../../store/auth-store';
import { useUserStore } from '../../store/user-store';
import type { EventConfirmedPlayer, MyGamesPastItem } from '../../types/events';
import { formatRelativeTime } from '../../utils/dates';

type RootNavigation = NavigationProp<RootStackParamList>;

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
    onSuccess: async (result, variables) => {
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

      return result;
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

export function MyGamesScreen() {
  const { t } = useTranslation();
  const isScreenFocused = useIsFocused();
  const navigation = useNavigation<RootNavigation>();
  const language = useUserStore((state) => state.language);
  const userId = useAuthStore((state) => state.userId);
  const [activeTab, setActiveTab] = useState<'upcoming' | 'past'>('upcoming');

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

  const activeQuery = activeTab === 'upcoming' ? upcomingGamesQuery : pastGamesQuery;
  const activeItems =
    activeTab === 'upcoming' ? (upcomingGamesQuery.data ?? []) : (pastGamesQuery.data ?? []);

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

  return (
    <FlatList
      contentContainerStyle={styles.listContent}
      data={activeItems}
      keyExtractor={(item) => item.id}
      ListEmptyComponent={
        activeQuery.isPending ? (
          <View style={styles.centeredBlock}>
            <ActivityIndicator color="#183153" />
          </View>
        ) : activeQuery.isError ? (
          <ScreenCard
            title={
              activeTab === 'upcoming'
                ? t('shell.myGames.errorTitle')
                : t('shell.myGames.pastErrorTitle')
            }
          >
            <Text style={styles.placeholderText}>
              {activeTab === 'upcoming'
                ? t('shell.myGames.errorBody')
                : t('shell.myGames.pastErrorBody')}
            </Text>
            <ActionButton
              label={t('events.common.retry')}
              onPress={async () => {
                await activeQuery.refetch();
              }}
            />
          </ScreenCard>
        ) : (
          <ScreenCard
            title={
              activeTab === 'upcoming'
                ? t('shell.myGames.emptyTitle')
                : t('shell.myGames.pastEmptyTitle')
            }
          >
            <Text style={styles.placeholderText}>
              {activeTab === 'upcoming'
                ? t('shell.myGames.emptyBody')
                : t('shell.myGames.pastEmptyBody')}
            </Text>
            {activeTab === 'upcoming' ? (
              <ActionButton
                label={t('shell.myGames.openCreate')}
                onPress={() =>
                  navigation.navigate('MainTabs', {
                    screen: 'CreateEventTab',
                    params: { screen: 'CreateEvent' },
                  })
                }
              />
            ) : null}
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
          {activeTab === 'past' ? <PastEventActions event={item as MyGamesPastItem} /> : null}
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
  actionBlock: {
    gap: 10,
  },
  actionBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#395065',
  },
  helperText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#6d7f95',
  },
  promptRow: {
    gap: 10,
  },
  promptPlayerCard: {
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#eadfce',
    backgroundColor: '#fffdf9',
    padding: 14,
  },
  promptPlayerName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#183153',
  },
});
