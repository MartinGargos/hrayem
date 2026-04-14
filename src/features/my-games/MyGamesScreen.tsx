import { useState } from 'react';
import { ActivityIndicator, SectionList, StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';

import { ActionButton } from '../auth/AuthPrimitives';
import {
  getLifecycleRefetchInterval,
  hasEnoughConfirmedPlayersForNoShow,
} from '../events/event-eligibility';
import { AvatarPhoto, EventSummaryCard } from '../events/EventPrimitives';
import { ScreenCard, SegmentedTabs } from '../../components/ScreenShell';
import { StateMessage } from '../../components/StateMessage';
import type { RootStackParamList } from '../../navigation/types';
import {
  fetchConfirmedEventPlayers,
  fetchMyPastGames,
  fetchMyUpcomingGames,
  giveThumbsUp,
} from '../../services/events';
import { useAuthStore } from '../../store/auth-store';
import { useUserStore } from '../../store/user-store';
import type {
  EventConfirmedPlayer,
  MyGamesPastItem,
  MyGamesUpcomingItem,
} from '../../types/events';
import { formatRelativeTime } from '../../utils/dates';

type RootNavigation = NavigationProp<RootStackParamList>;
type MyGamesListItem = MyGamesUpcomingItem | MyGamesPastItem;
type MyGamesSection = {
  data: MyGamesListItem[];
  iconName: React.ComponentProps<typeof Ionicons>['name'];
  key: 'organizing' | 'playing';
  title: string;
};

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
    <ScreenCard>
      <StateMessage
        action={
          actionLabel && onPress ? (
            <ActionButton
              iconName={activeIconName(iconName)}
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
  const organizingItems = activeItems.filter((item) => item.viewerMembershipStatus === 'organizer');
  const playingItems = activeItems.filter((item) => item.viewerMembershipStatus === 'confirmed');
  const sections: MyGamesSection[] = [
    {
      key: 'organizing' as const,
      title: t('shell.myGames.role.organizing'),
      iconName: 'flag-outline' as const,
      data: organizingItems,
    },
    {
      key: 'playing' as const,
      title: t('shell.myGames.role.playing'),
      iconName: 'people-outline' as const,
      data: playingItems,
    },
  ].filter((section) => section.data.length > 0);

  function renderHeader() {
    return (
      <View style={styles.headerWrap}>
        <View style={styles.hero}>
          <View style={styles.heroMetaRow}>
            <View style={styles.heroPill}>
              <Ionicons
                color="#dbe4ee"
                name={activeTab === 'past' ? 'time-outline' : 'calendar-clear-outline'}
                size={14}
              />
              <Text style={styles.heroPillLabel}>
                {activeTab === 'past'
                  ? t('shell.myGames.tabs.past')
                  : t('shell.myGames.tabs.upcoming')}
              </Text>
            </View>
            <View style={styles.heroPill}>
              <Ionicons color="#dbe4ee" name="layers-outline" size={14} />
              <Text style={styles.heroPillLabel}>{activeItems.length}</Text>
            </View>
          </View>
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
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>{t('shell.myGames.role.organizing')}</Text>
            <Text style={styles.summaryValue}>{organizingItems.length}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>{t('shell.myGames.role.playing')}</Text>
            <Text style={styles.summaryValue}>{playingItems.length}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <SectionList
      contentContainerStyle={styles.listContent}
      sections={sections}
      keyExtractor={(item) => item.id}
      ListEmptyComponent={
        activeQuery.isPending ? (
          <View style={styles.centeredBlock}>
            <ActivityIndicator color="#183153" />
          </View>
        ) : activeQuery.isError ? (
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
        ) : (
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
        )
      }
      ListHeaderComponent={renderHeader}
      SectionSeparatorComponent={() => <View style={styles.sectionSpacer} />}
      ItemSeparatorComponent={() => <View style={styles.itemSeparator} />}
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderTitleRow}>
            <Ionicons color="#183153" name={section.iconName} size={16} />
            <Text style={styles.sectionHeaderTitle}>{section.title}</Text>
          </View>
          <View style={styles.sectionCountPill}>
            <Text style={styles.sectionCountLabel}>{section.data.length}</Text>
          </View>
        </View>
      )}
      renderItem={({ item }) => (
        <View style={styles.itemWrap}>
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
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#fffbf6',
    borderWidth: 1,
    borderColor: '#ece0d1',
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#aa6d44',
  },
  summaryValue: {
    marginTop: 6,
    fontSize: 24,
    fontWeight: '800',
    color: '#183153',
  },
  centeredBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  itemWrap: {
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  sectionHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionHeaderTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#183153',
  },
  sectionCountPill: {
    minWidth: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#efe4d5',
  },
  sectionCountLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#183153',
  },
  sectionSpacer: {
    height: 20,
  },
  itemSeparator: {
    height: 12,
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
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ece0d1',
    backgroundColor: '#fffdf8',
    padding: 12,
  },
  promptPlayerName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#183153',
  },
});
