import { zodResolver } from '@hookform/resolvers/zod';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
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
import { z } from 'zod';

import { ActionButton, NoticeBanner } from '../auth/AuthPrimitives';
import { AvatarPhoto, SportBadge } from '../events/EventPrimitives';
import { isChatChannelReconnectNeeded, shouldRecoverChatOnForeground } from './chat-realtime';
import { ScreenCard } from '../../components/ScreenShell';
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

type MessageFormValues = {
  body: string;
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

export function ChatScreen({ route }: ChatScreenProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isScreenFocused = useIsFocused();
  const language = useUserStore((state) => state.language);
  const userId = useAuthStore((state) => state.userId);
  const eventId = route.params.eventId;
  const [notice, setNotice] = useState<AppNotice | null>(null);
  const [channelReconnectNonce, setChannelReconnectNonce] = useState(0);

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
        <ScreenCard title={t('events.chat.errorTitle')}>
          <Text style={styles.bodyText}>{t('events.chat.errorBody')}</Text>
          <ActionButton
            label={t('events.common.retry')}
            onPress={async () => {
              await eventQuery.refetch();
            }}
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
              <Text style={styles.heroSubtitle}>{event.venueName}</Text>
              <Text style={styles.heroMeta}>
                {formatEventDate(event.startsAt, language)} ·{' '}
                {formatEventTime(event.startsAt, language)}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.content}>
          <NoticeBanner notice={notice} resolveMessage={t} />

          {!canOpenChat ? (
            <ScreenCard title={t('events.chat.forbiddenTitle')}>
              <Text style={styles.bodyText}>{t('events.chat.forbiddenBody')}</Text>
            </ScreenCard>
          ) : (
            <>
              {event.status === 'cancelled' ? (
                <View style={[styles.banner, styles.bannerMuted]}>
                  <Text style={styles.bannerText}>{t('events.chat.cancelledBanner')}</Text>
                </View>
              ) : null}

              {finishedCountdownVisible ? (
                <View style={styles.banner}>
                  <Text style={styles.bannerText}>
                    {t('events.chat.finishedBanner', {
                      remaining: formatRelativeTime(event.chatClosedAt ?? '', language),
                    })}
                  </Text>
                </View>
              ) : null}

              {event.status === 'finished' && isReadOnly ? (
                <View style={[styles.banner, styles.bannerMuted]}>
                  <Text style={styles.bannerText}>{t('events.chat.readOnlyFinished')}</Text>
                </View>
              ) : null}

              {messagesQuery.isError ? (
                <ScreenCard title={t('events.chat.messagesErrorTitle')}>
                  <Text style={styles.bodyText}>{t('events.chat.messagesErrorBody')}</Text>
                  <ActionButton
                    label={t('events.common.retry')}
                    onPress={async () => {
                      await messagesQuery.refetch();
                    }}
                  />
                </ScreenCard>
              ) : (
                <FlatList
                  contentContainerStyle={styles.messageListContent}
                  data={messageRows}
                  inverted
                  keyExtractor={(item) => item.id}
                  keyboardShouldPersistTaps="handled"
                  ListEmptyComponent={
                    messagesQuery.isPending ? (
                      <View style={styles.centeredBlock}>
                        <ActivityIndicator color="#183153" />
                      </View>
                    ) : (
                      <View style={styles.emptyState}>
                        <Text style={styles.emptyTitle}>{t('events.chat.emptyTitle')}</Text>
                        <Text style={styles.emptyBody}>{t('events.chat.emptyBody')}</Text>
                      </View>
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
                        style={[styles.messageRow, isOwnMessage ? styles.messageRowOwn : undefined]}
                      >
                        <AvatarPhoto label={authorName} uri={item.authorPhotoUrl} size={38} />
                        <View
                          style={[
                            styles.messageBubble,
                            isOwnMessage ? styles.messageBubbleOwn : styles.messageBubbleOther,
                          ]}
                        >
                          <View style={styles.messageMetaRow}>
                            <Text
                              style={[
                                styles.messageAuthor,
                                isOwnMessage ? styles.messageMetaOwn : undefined,
                              ]}
                            >
                              {authorName}
                            </Text>
                            <Text
                              style={[
                                styles.messageTimestamp,
                                isOwnMessage ? styles.messageMetaOwn : undefined,
                              ]}
                            >
                              {formatChatTimestamp(item.sentAt, language)}
                            </Text>
                          </View>
                          <Text
                            style={[
                              styles.messageBody,
                              isOwnMessage ? styles.messageBodyOwn : undefined,
                            ]}
                          >
                            {body}
                          </Text>
                        </View>
                      </View>
                    );
                  }}
                  style={styles.messageList}
                />
              )}
            </>
          )}
        </View>

        {showInput ? (
          <View style={styles.inputWrap}>
            <Controller
              control={messageForm.control}
              name="body"
              render={({ field: { onBlur, onChange, value }, fieldState }) => (
                <View style={styles.inputRow}>
                  <TextInput
                    accessibilityLabel={t('events.chat.inputLabel')}
                    autoCapitalize="sentences"
                    multiline
                    onBlur={onBlur}
                    onChangeText={onChange}
                    placeholder={t('events.chat.inputPlaceholder')}
                    placeholderTextColor="#7a8ca3"
                    selectionColor="#183153"
                    style={[styles.input, fieldState.error ? styles.inputError : undefined]}
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
                    <Text style={styles.sendButtonLabel}>
                      {sendMessageMutation.isPending
                        ? t('events.chat.sendPending')
                        : t('events.chat.sendAction')}
                    </Text>
                  </Pressable>
                </View>
              )}
            />
            {messageForm.formState.errors.body?.message ? (
              <Text style={styles.errorText}>{messageForm.formState.errors.body.message}</Text>
            ) : (
              <Text style={styles.helperText}>{t('events.chat.inputHelper')}</Text>
            )}
          </View>
        ) : canOpenChat ? (
          <View style={styles.readOnlyFooter}>
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
    marginTop: 18,
    borderRadius: 26,
    padding: 20,
    backgroundColor: '#183153',
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
    fontSize: 22,
    fontWeight: '800',
    color: '#fff8f0',
  },
  heroSubtitle: {
    fontSize: 15,
    color: '#d2dde8',
  },
  heroMeta: {
    fontSize: 13,
    color: '#d2dde8',
  },
  content: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 14,
    gap: 12,
  },
  centeredBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  bodyText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#395065',
  },
  banner: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#eadfce',
    backgroundColor: '#fffaf3',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  bannerMuted: {
    backgroundColor: '#f1e6d6',
  },
  bannerText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#395065',
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    paddingBottom: 8,
    paddingTop: 4,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 36,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#183153',
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    color: '#5a6475',
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    marginBottom: 12,
  },
  messageRowOwn: {
    flexDirection: 'row-reverse',
  },
  messageBubble: {
    flex: 1,
    maxWidth: '82%',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
  },
  messageBubbleOther: {
    backgroundColor: '#fffaf3',
    borderColor: '#eadfce',
  },
  messageBubbleOwn: {
    backgroundColor: '#183153',
    borderColor: '#183153',
  },
  messageMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 6,
  },
  messageAuthor: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: '#183153',
  },
  messageTimestamp: {
    fontSize: 11,
    color: '#6d7f95',
  },
  messageMetaOwn: {
    color: '#d2dde8',
  },
  messageBody: {
    fontSize: 15,
    lineHeight: 22,
    color: '#183153',
  },
  messageBodyOwn: {
    color: '#fff8f0',
  },
  inputWrap: {
    borderTopWidth: 1,
    borderTopColor: '#eadfce',
    backgroundColor: '#fffaf3',
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 22 : 14,
    gap: 8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  input: {
    flex: 1,
    minHeight: 52,
    maxHeight: 140,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#d4c2af',
    backgroundColor: '#fffdf9',
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    lineHeight: 22,
    color: '#183153',
  },
  inputError: {
    borderColor: '#d15b5b',
  },
  sendButton: {
    minWidth: 82,
    borderRadius: 18,
    backgroundColor: '#183153',
    paddingHorizontal: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#9fb0c2',
  },
  sendButtonPressed: {
    opacity: 0.9,
  },
  sendButtonLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff8f0',
  },
  helperText: {
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
    borderTopWidth: 1,
    borderTopColor: '#eadfce',
    backgroundColor: '#fffaf3',
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 22 : 14,
  },
});
