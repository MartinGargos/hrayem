const UNHEALTHY_CHAT_CHANNEL_STATUSES = new Set(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']);

export function isChatChannelReconnectNeeded(status: string): boolean {
  return UNHEALTHY_CHAT_CHANNEL_STATUSES.has(status);
}

export function shouldRecoverChatOnForeground(input: {
  appStateStatus: string;
  canReadMessages: boolean;
  isScreenFocused: boolean;
}): boolean {
  return input.appStateStatus === 'active' && input.canReadMessages && input.isScreenFocused;
}
