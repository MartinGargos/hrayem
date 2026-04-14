import { zodResolver } from '@hookform/resolvers/zod';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import { ActionButton, NoticeBanner } from '../auth/AuthPrimitives';
import { AvatarPhoto, SportBadge } from '../events/EventPrimitives';
import { isChatChannelReconnectNeeded, shouldRecoverChatOnForeground } from './chat-realtime';
import { ScreenCard } from '../../components/ScreenShell';
import { StateMessage } from '../../components/StateMessage';
import type { RootStackParamList } from '../../navigation/types';
import {
  EdgeFunctionError,
  fetchEventChatMessages,
  fetchEventDetail,
  sendEventMessage,
} from '../../services/events';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../store/auth-store';
import { useUserStore } from '../../store/user-store';
import type { AppNotice } from '../../types/app';
import type { ChatMessage, EventDetail } from '../../types/events';
import {
  formatChatTimestamp,
  formatEventDate,
  formatEventTime,
  formatRelativeTime,
} from '../../utils/dates';

type ChatScreenProps = NativeStackScreenProps<RootStackParamList, 'Chat'>;
type ChatIconName = ComponentProps<typeof Ionicons>['name'];

type MessageFormValues = {
  body: string;
};

type ChatStateViewProps = {
  actionLabel?: string;
  body: string;
  iconName: ChatIconName;
  onAction?: () => void | Promise<void>;
  title: string;
};

type ChatBannerProps = {
  iconName: ChatIconName;
  text: string;
  tone?: 'default' | 'muted';
};

function createMessageSchema(t: (key: string, options?: Record<string, unknown>) => string) {
  return z.object({
    body: z
      .string()
      .trim()
      .min(1, t('events.chat.validation.bodyRequired'))
      .max(1_000, t('events.chat.validation.bodyLength')),
  });
}

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

function canAccessEventChat(event: EventDetail): boolean {
  return (
    event.viewerMembershipStatus === 'organizer' || event.viewerMembershipStatus === 'confirmed'
  );
}

function isEventChatReadOnly(event: EventDetail): boolean {
  if (event.status === 'cancelled') {
    return true;
  }

  if (!event.chatClosedAt) {
    return false;
  }

  return new Date(event.chatClosedAt).getTime() <= Date.now();
}

function mapChatErrorToNotice(error: unknown): AppNotice {
  if (error instanceof EdgeFunctionError) {
    if (error.code === 'CHAT_CLOSED') {
      return {
        messageKey: 'events.chat.errors.closed',
        tone: 'info',
      };
    }

    if (error.code === 'FORBIDDEN') {
      return {
        messageKey: 'events.chat.errors.forbidden',
        tone: 'info',
      };
    }

    if (error.code === 'VALIDATION_ERROR') {
      return {
        messageKey: 'events.chat.errors.validation',
        tone: 'error',
      };
    }

    if (error.code === 'RATE_LIMITED') {
      return {
        messageKey: 'events.chat.errors.rateLimited',
        tone: 'info',
      };
    }
  }

  return {
    messageKey: 'events.chat.errors.generic',
    tone: 'error',
  };
}

function upsertChatMessage(
  messages: ChatMessage[] | undefined,
  nextMessage: ChatMessage,
): ChatMessage[] {
  const currentMessages = messages ?? [];
  const existingIndex = currentMessages.findIndex((message) => message.id === nextMessage.id);

  if (existingIndex >= 0) {
    const nextMessages = [...currentMessages];
    nextMessages[existingIndex] = nextMessage;
    return nextMessages;
  }

  return [nextMessage, ...currentMessages];
}

function ChatStateView({ actionLabel, body, iconName, onAction, title }: ChatStateViewProps) {
  return (
    <StateMessage
      action={
        actionLabel && onAction ? (
          <ActionButton
            iconName={iconName === 'cloud-offline-outline' ? 'refresh-outline' : undefined}
            label={actionLabel}
            onPress={onAction}
            variant={iconName === 'cloud-offline-outline' ? 'secondary' : 'primary'}
          />
        ) : undefined
      }
      body={body}
      iconName={iconName}
      title={title}
      tone={
        iconName === 'sparkles-outline'
          ? 'warm'
          : iconName === 'cloud-offline-outline'
            ? 'muted'
            : 'default'
      }
    />
  );
}

function ChatBanner({ iconName, text, tone = 'default' }: ChatBannerProps) {
  return (
    <View style={[styles.banner, tone === 'muted' ? styles.bannerMuted : undefined]}>
      <View style={[styles.bannerIconWrap, tone === 'muted' ? styles.bannerIconWrapMuted : null]}>
        <Ionicons color={tone === 'muted' ? '#8a694f' : '#183153'} name={iconName} size={16} />
      </View>
      <Text style={styles.bannerText}>{text}</Text>
    </View>
  );
}

export function ChatScreen({ route }: ChatScreenProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isScreenFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const language = useUserStore((state) => state.language);
  const userId = useAuthStore((state) => state.userId);
  const eventId = route.params.eventId;
  const [notice, setNotice] = useState<AppNotice | null>(null);
  const [channelReconnectNonce, setChannelReconnectNonce] = useState(0);
  const footerBottomPadding = Platform.OS === 'ios' ? Math.max(insets.bottom, 14) : 14;
  const keyboardVerticalOffset = Platform.OS === 'ios' ? insets.top + 44 : 0;

  const messageForm = useForm<MessageFormValues>({
    resolver: zodResolver(createMessageSchema(t)),
    mode: 'onChange',
    defaultValues: {
      body: '',
    },
  });

  const eventQuery = useQuery({
    queryKey: ['events', 'detail', eventId],
    queryFn: () => fetchEventDetail(eventId),
    staleTime: 10_000,
  });

  const canReadMessages = Boolean(eventQuery.data && canAccessEventChat(eventQuery.data));

  const messagesQuery = useQuery({
    queryKey: ['events', 'chat', eventId, 'messages'],
    queryFn: () => fetchEventChatMessages(eventId),
    enabled: canReadMessages,
    staleTime: 10_000,
  });

  const requestChannelReconnect = useCallback(() => {
    setChannelReconnectNonce((current) => current + 1);
  }, []);

  const refetchChatState = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['events', 'detail', eventId] }),
      queryClient.invalidateQueries({ queryKey: ['events', 'chat', eventId, 'messages'] }),
    ]);
  }, [eventId, queryClient]);

  useEffect(() => {
    if (!canReadMessages) {
      return;
    }

    let active = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let channel = supabase.channel(`event:${eventId}:chat:${channelReconnectNonce}`);

    const connect = () => {
      channel = supabase
        .channel(`event:${eventId}:chat:${channelReconnectNonce}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'chat_messages',
            filter: `event_id=eq.${eventId}`,
          },
          () => {
            void refetchChatState();
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'event_players',
            filter: `event_id=eq.${eventId}`,
          },
          () => {
            void refetchChatState();
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'events',
            filter: `id=eq.${eventId}`,
          },
          () => {
            void refetchChatState();
          },
        );

      channel.subscribe((status) => {
        if (!active) {
          return;
        }

        if (isChatChannelReconnectNeeded(status)) {
          void supabase.removeChannel(channel);

          if (reconnectTimer) {
            clearTimeout(reconnectTimer);
          }

          reconnectTimer = setTimeout(() => {
            if (active) {
              requestChannelReconnect();
            }
          }, 1_500);
        }
      });
    };

    connect();

    return () => {
      active = false;

      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }

      void supabase.removeChannel(channel);
    };
  }, [canReadMessages, channelReconnectNonce, eventId, refetchChatState, requestChannelReconnect]);

  useEffect(() => {
    if (!canReadMessages) {
      return;
    }

    const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (
        !shouldRecoverChatOnForeground({
          appStateStatus: status,
          canReadMessages,
          isScreenFocused,
        })
      ) {
        return;
      }

      requestChannelReconnect();
      void refetchChatState();
    });

    return () => subscription.remove();
  }, [canReadMessages, isScreenFocused, refetchChatState, requestChannelReconnect]);

  const sendMessageMutation = useMutation({
    mutationFn: sendEventMessage,
    onSuccess: async (message) => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      messageForm.reset({
        body: '',
      });
      setNotice(null);
      queryClient.setQueryData<ChatMessage[]>(['events', 'chat', eventId, 'messages'], (current) =>
        upsertChatMessage(current, message),
      );
      await refetchChatState();
    },
    onError: (error) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setNotice(mapChatErrorToNotice(error));
    },
  });

  async function handleSendMessage(values: MessageFormValues) {
    if (!eventQuery.data) {
      return;
    }

    if (!canAccessEventChat(eventQuery.data)) {
      setNotice({
        messageKey: 'events.chat.errors.forbidden',
        tone: 'info',
      });
      return;
    }

    if (isEventChatReadOnly(eventQuery.data)) {
      setNotice({
        messageKey: 'events.chat.errors.closed',
        tone: 'info',
      });
      return;
    }

    setNotice(null);
    await sendMessageMutation.mutateAsync({
      eventId,
      body: values.body,
    });
  }

  if (eventQuery.isPending) {
    return (
      <View style={styles.screen}>
        <ScreenCard title={t('events.chat.loadingTitle')}>
          <View style={styles.centeredBlock}>
            <ActivityIndicator color="#183153" />
          </View>
        </ScreenCard>
      </View>
    );
  }

  if (eventQuery.isError || !eventQuery.data) {
    return (
      <View style={styles.screen}>
        <ScreenCard>
          <ChatStateView
            actionLabel={t('events.common.retry')}
            body={t('events.chat.errorBody')}
            iconName="alert-circle-outline"
            onAction={async () => {
              await eventQuery.refetch();
            }}
            title={t('events.chat.errorTitle')}
          />
        </ScreenCard>
      </View>
    );
  }

  const event = eventQuery.data;
  const sportName = language === 'cs' ? event.sportNameCs : event.sportNameEn;
  const canOpenChat = canAccessEventChat(event);
  const isReadOnly = isEventChatReadOnly(event);
  const messageRows = messagesQuery.data ?? [];
  const finishedCountdownVisible =
    event.status === 'finished' &&
    Boolean(event.chatClosedAt) &&
    new Date(event.chatClosedAt ?? '').getTime() > Date.now();
  const showInput = canOpenChat && !isReadOnly;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={keyboardVerticalOffset}
      style={styles.keyboardWrap}
    >
      <View style={styles.screen}>
        <View style={styles.hero}>
          <View style={styles.heroIdentity}>
            <SportBadge
              colorHex={event.sportColor}
              label={getSportBadgeLabel(event.sportSlug, sportName)}
            />
            <View style={styles.heroCopy}>
              <Text style={styles.heroTitle}>{sportName}</Text>
              <Text numberOfLines={1} style={styles.heroSubtitle}>
                {event.venueName}
              </Text>
            </View>
          </View>
          <View style={styles.heroMetaRow}>
            <View style={styles.heroMetaPill}>
              <Ionicons color="#dbe4ee" name="calendar-clear-outline" size={14} />
              <Text style={styles.heroMetaPillLabel}>
                {formatEventDate(event.startsAt, language)}
              </Text>
            </View>
            <View style={styles.heroMetaPill}>
              <Ionicons color="#dbe4ee" name="time-outline" size={14} />
              <Text style={styles.heroMetaPillLabel}>
                {formatEventTime(event.startsAt, language)}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.content}>
          <NoticeBanner notice={notice} resolveMessage={t} />

          {!canOpenChat ? (
            <ScreenCard>
              <ChatStateView
                body={t('events.chat.forbiddenBody')}
                iconName="lock-closed-outline"
                title={t('events.chat.forbiddenTitle')}
              />
            </ScreenCard>
          ) : (
            <>
              {event.status === 'cancelled' ? (
                <ChatBanner
                  iconName="close-circle-outline"
                  text={t('events.chat.cancelledBanner')}
                  tone="muted"
                />
              ) : null}

              {finishedCountdownVisible ? (
                <ChatBanner
                  iconName="time-outline"
                  text={t('events.chat.finishedBanner', {
                    remaining: formatRelativeTime(event.chatClosedAt ?? '', language),
                  })}
                />
              ) : null}

              {event.status === 'finished' && isReadOnly ? (
                <ChatBanner
                  iconName="lock-closed-outline"
                  text={t('events.chat.readOnlyFinished')}
                  tone="muted"
                />
              ) : null}

              <View style={styles.messagesPanel}>
                <View style={styles.messagesPanelHeader}>
                  <View style={styles.messagesPanelTitleRow}>
                    <Ionicons color="#183153" name="chatbubble-ellipses-outline" size={16} />
                    <Text style={styles.messagesPanelTitle}>{t('events.chat.threadTitle')}</Text>
                  </View>
                  <View style={styles.messagesPanelSignals}>
                    {messagesQuery.isFetching && messageRows.length ? (
                      <View style={styles.syncPill}>
                        <ActivityIndicator color="#5f7388" size="small" />
                        <Text style={styles.syncPillLabel}>{t('events.chat.syncing')}</Text>
                      </View>
                    ) : null}
                    <View
                      style={[
                        styles.statusPill,
                        isReadOnly ? styles.statusPillMuted : styles.statusPillLive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusPillLabel,
                          isReadOnly ? styles.statusPillLabelMuted : undefined,
                        ]}
                      >
                        {isReadOnly ? t('events.chat.readOnlyStatus') : t('events.chat.liveStatus')}
                      </Text>
                    </View>
                  </View>
                </View>

                {messagesQuery.isError ? (
                  <ChatStateView
                    actionLabel={t('events.common.retry')}
                    body={t('events.chat.messagesErrorBody')}
                    iconName="cloud-offline-outline"
                    onAction={async () => {
                      await messagesQuery.refetch();
                    }}
                    title={t('events.chat.messagesErrorTitle')}
                  />
                ) : (
                  <FlatList
                    automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
                    contentContainerStyle={[
                      styles.messageListContent,
                      !messageRows.length ? styles.messageListContentEmpty : undefined,
                    ]}
                    data={messageRows}
                    inverted
                    keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                    keyboardShouldPersistTaps="handled"
                    keyExtractor={(item) => item.id}
                    ListEmptyComponent={
                      messagesQuery.isPending ? (
                        <View style={styles.centeredBlock}>
                          <ActivityIndicator color="#183153" />
                        </View>
                      ) : (
                        <ChatStateView
                          body={t('events.chat.emptyBody')}
                          iconName="sparkles-outline"
                          title={t('events.chat.emptyTitle')}
                        />
                      )
                    }
                    renderItem={({ item }) => {
                      const isOwnMessage = item.userId === userId;
                      const authorName =
                        [item.authorFirstName, item.authorLastName].filter(Boolean).join(' ') ||
                        t('events.chat.deletedParticipant');
                      const body = item.isDeleted ? t('events.chat.deletedBody') : item.body;

                      return (
                        <View
                          style={[styles.messageRow, isOwnMessage ? styles.messageRowOwn : null]}
                        >
                          {isOwnMessage ? (
                            <View style={styles.messageAvatarSpacer} />
                          ) : (
                            <AvatarPhoto label={authorName} uri={item.authorPhotoUrl} size={34} />
                          )}
                          <View
                            style={[
                              styles.messageColumn,
                              isOwnMessage ? styles.messageColumnOwn : null,
                            ]}
                          >
                            <View
                              style={[
                                styles.messageHeader,
                                isOwnMessage ? styles.messageHeaderOwn : null,
                              ]}
                            >
                              {!isOwnMessage ? (
                                <Text numberOfLines={1} style={styles.messageAuthor}>
                                  {authorName}
                                </Text>
                              ) : null}
                              <Text style={styles.messageTimestamp}>
                                {formatChatTimestamp(item.sentAt, language)}
                              </Text>
                            </View>
                            <View
                              style={[
                                styles.messageBubble,
                                item.isDeleted
                                  ? styles.messageBubbleDeleted
                                  : isOwnMessage
                                    ? styles.messageBubbleOwn
                                    : styles.messageBubbleOther,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.messageBody,
                                  !item.isDeleted && isOwnMessage
                                    ? styles.messageBodyOwn
                                    : undefined,
                                  item.isDeleted ? styles.messageBodyDeleted : undefined,
                                ]}
                              >
                                {body}
                              </Text>
                            </View>
                          </View>
                        </View>
                      );
                    }}
                    showsVerticalScrollIndicator={false}
                    style={styles.messageList}
                  />
                )}
              </View>
            </>
          )}
        </View>

        {showInput ? (
          <View style={[styles.inputWrap, { paddingBottom: footerBottomPadding }]}>
            <Controller
              control={messageForm.control}
              name="body"
              render={({ field: { onBlur, onChange, value }, fieldState }) => (
                <>
                  <View
                    style={[
                      styles.composerCard,
                      fieldState.error ? styles.composerCardError : undefined,
                    ]}
                  >
                    <TextInput
                      accessibilityLabel={t('events.chat.inputLabel')}
                      autoCapitalize="sentences"
                      maxLength={1_000}
                      multiline
                      onBlur={onBlur}
                      onChangeText={onChange}
                      placeholder={t('events.chat.inputPlaceholder')}
                      placeholderTextColor="#7a8ca3"
                      selectionColor="#183153"
                      style={styles.input}
                      textAlignVertical="top"
                      value={value}
                    />
                    <Pressable
                      accessibilityLabel={t('events.chat.sendAction')}
                      accessibilityRole="button"
                      disabled={!messageForm.formState.isValid || sendMessageMutation.isPending}
                      onPress={() => {
                        void messageForm.handleSubmit(handleSendMessage)();
                      }}
                      style={({ pressed }) => [
                        styles.sendButton,
                        (!messageForm.formState.isValid || sendMessageMutation.isPending) &&
                          styles.sendButtonDisabled,
                        pressed &&
                          messageForm.formState.isValid &&
                          !sendMessageMutation.isPending &&
                          styles.sendButtonPressed,
                      ]}
                    >
                      {sendMessageMutation.isPending ? (
                        <ActivityIndicator color="#fff8f0" size="small" />
                      ) : (
                        <Ionicons color="#fff8f0" name="arrow-up" size={20} />
                      )}
                    </Pressable>
                  </View>

                  {messageForm.formState.errors.body?.message ? (
                    <Text style={styles.errorText}>
                      {messageForm.formState.errors.body.message}
                    </Text>
                  ) : (
                    <View style={styles.helperRow}>
                      <Ionicons color="#8ea0b4" name="information-circle-outline" size={14} />
                      <Text style={styles.helperText}>{t('events.chat.inputHelper')}</Text>
                    </View>
                  )}
                </>
              )}
            />
          </View>
        ) : canOpenChat ? (
          <View style={[styles.readOnlyFooter, { paddingBottom: footerBottomPadding }]}>
            <Ionicons color="#8ea0b4" name="lock-closed-outline" size={16} />
            <Text style={styles.helperText}>
              {event.status === 'cancelled'
                ? t('events.chat.cancelledBanner')
                : t('events.chat.readOnlyFinished')}
            </Text>
          </View>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardWrap: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: '#f7f0e6',
  },
  hero: {
    marginHorizontal: 18,
    marginTop: 14,
    borderRadius: 26,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: '#183153',
    gap: 14,
  },
  heroIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  heroCopy: {
    flex: 1,
    gap: 4,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff8f0',
  },
  heroSubtitle: {
    fontSize: 15,
    color: '#d2dde8',
  },
  heroMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  heroMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: 'rgba(255, 248, 240, 0.12)',
  },
  heroMetaPillLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#dbe4ee',
  },
  content: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 12,
    gap: 10,
  },
  centeredBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#eadfce',
    backgroundColor: '#fffaf3',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  bannerMuted: {
    backgroundColor: '#f4eadb',
  },
  bannerIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#edf3f8',
  },
  bannerIconWrapMuted: {
    backgroundColor: '#f8efe3',
  },
  bannerText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: '#395065',
  },
  messagesPanel: {
    flex: 1,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#eadfce',
    backgroundColor: '#fffaf5',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 6,
    shadowColor: '#10233f',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 1,
  },
  messagesPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 4,
    paddingBottom: 10,
  },
  messagesPanelTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  messagesPanelTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#183153',
  },
  messagesPanelSignals: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  syncPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#eef2f7',
  },
  syncPillLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#5f7388',
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusPillLive: {
    backgroundColor: '#e6f3ec',
  },
  statusPillMuted: {
    backgroundColor: '#f0e7d9',
  },
  statusPillLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#2f8154',
  },
  statusPillLabelMuted: {
    color: '#8a694f',
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    paddingHorizontal: 4,
    paddingTop: 4,
    paddingBottom: 12,
  },
  messageListContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    marginBottom: 14,
  },
  messageRowOwn: {
    justifyContent: 'flex-end',
  },
  messageAvatarSpacer: {
    width: 34,
  },
  messageColumn: {
    flex: 1,
    maxWidth: '82%',
    gap: 5,
  },
  messageColumnOwn: {
    alignItems: 'flex-end',
  },
  messageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 6,
  },
  messageHeaderOwn: {
    justifyContent: 'flex-end',
  },
  messageAuthor: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '700',
    color: '#395065',
  },
  messageTimestamp: {
    fontSize: 11,
    color: '#8393a4',
  },
  messageBubble: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
  },
  messageBubbleOther: {
    backgroundColor: '#fffdf9',
    borderColor: '#eadfce',
  },
  messageBubbleOwn: {
    backgroundColor: '#183153',
    borderColor: '#183153',
  },
  messageBubbleDeleted: {
    backgroundColor: '#f4eee5',
    borderColor: '#e7dbca',
  },
  messageBody: {
    fontSize: 15,
    lineHeight: 22,
    color: '#183153',
  },
  messageBodyOwn: {
    color: '#fff8f0',
  },
  messageBodyDeleted: {
    fontStyle: 'italic',
    color: '#6f7c8b',
  },
  inputWrap: {
    borderTopWidth: 1,
    borderTopColor: '#eadfce',
    backgroundColor: '#fffaf3',
    paddingHorizontal: 18,
    paddingTop: 10,
    gap: 8,
  },
  composerCard: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#e2d4c3',
    backgroundColor: '#fffdf9',
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: '#10233f',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
  },
  composerCardError: {
    borderColor: '#d15b5b',
  },
  input: {
    flex: 1,
    minHeight: 46,
    maxHeight: 140,
    paddingTop: 2,
    paddingBottom: 2,
    fontSize: 15,
    lineHeight: 22,
    color: '#183153',
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#183153',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#9fb0c2',
  },
  sendButtonPressed: {
    opacity: 0.9,
  },
  helperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  helperText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: '#6d7f95',
  },
  errorText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#d15b5b',
  },
  readOnlyFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#eadfce',
    backgroundColor: '#fffaf3',
    paddingHorizontal: 18,
    paddingTop: 12,
  },
});
