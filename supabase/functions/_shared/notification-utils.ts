import { createClient } from 'jsr:@supabase/supabase-js@2';

export type NotificationType =
  | 'player_joined'
  | 'join_confirmed'
  | 'waitlist_promoted'
  | 'event_full'
  | 'chat_message'
  | 'event_reminder'
  | 'event_cancelled'
  | 'player_removed';

type NotificationPreferenceRow = {
  user_id: string;
  type: NotificationType;
  is_enabled: boolean;
};

type DeviceTokenRow = {
  user_id: string | null;
  token: string;
};

type ExpoPushTicket = {
  status: 'ok' | 'error';
  message?: string;
  details?: unknown;
};

export type NotificationDelivery = {
  userId: string;
  eventId: string | null;
  type: NotificationType;
  title: string;
  body: string;
  url: string;
  data?: Record<string, unknown>;
  payload?: Record<string, unknown>;
};

type AdminClient = ReturnType<typeof createClient>;

function buildExpoHeaders(): HeadersInit {
  const expoPushAccessToken = Deno.env.get('EXPO_PUSH_ACCESS_TOKEN');
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  if (expoPushAccessToken) {
    headers.Authorization = `Bearer ${expoPushAccessToken}`;
  }

  return headers;
}

function readResultValue(item: unknown): unknown {
  if (item && typeof item === 'object' && 'result' in item) {
    return (item as { result?: unknown }).result;
  }

  return item;
}

function readExpoTickets(payload: unknown): ExpoPushTicket[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const rawData = (payload as { data?: unknown }).data;
  const resolvedData = readResultValue(rawData);

  if (!Array.isArray(resolvedData)) {
    return [];
  }

  return resolvedData as ExpoPushTicket[];
}

export async function fanOutPushNotifications(
  adminClient: AdminClient,
  deliveries: NotificationDelivery[],
): Promise<void> {
  if (!deliveries.length) {
    return;
  }

  const recipientUserIds = [...new Set(deliveries.map((delivery) => delivery.userId))];
  const notificationTypes = [...new Set(deliveries.map((delivery) => delivery.type))];
  const [preferencesResult, tokensResult] = await Promise.all([
    adminClient
      .from('notification_preferences')
      .select('user_id, type, is_enabled')
      .in('user_id', recipientUserIds)
      .in('type', notificationTypes),
    adminClient.from('device_tokens').select('user_id, token').in('user_id', recipientUserIds),
  ]);

  if (preferencesResult.error || tokensResult.error) {
    throw new Error(
      preferencesResult.error?.message ??
        tokensResult.error?.message ??
        'Unable to load push notification recipients.',
    );
  }

  const disabledKeys = new Set(
    ((preferencesResult.data ?? []) as NotificationPreferenceRow[])
      .filter((row) => row.is_enabled === false)
      .map((row) => `${row.user_id}:${row.type}`),
  );
  const enabledDeliveries = deliveries.filter(
    (delivery) => !disabledKeys.has(`${delivery.userId}:${delivery.type}`),
  );

  if (!enabledDeliveries.length) {
    return;
  }

  const tokensByUserId = new Map<string, string[]>();

  for (const row of (tokensResult.data ?? []) as DeviceTokenRow[]) {
    if (!row.user_id) {
      continue;
    }

    const existingTokens = tokensByUserId.get(row.user_id) ?? [];
    tokensByUserId.set(row.user_id, [...existingTokens, row.token]);
  }

  const deliveryStatusByKey = new Map<string, 'sent' | 'failed'>();
  const pushMessages: Array<{
    to: string;
    title: string;
    body: string;
    data: Record<string, unknown>;
  }> = [];
  const pushMessageKeys: string[] = [];

  enabledDeliveries.forEach((delivery, index) => {
    const deliveryKey = `${delivery.userId}:${delivery.type}:${delivery.eventId ?? 'none'}:${index}`;
    const tokens = tokensByUserId.get(delivery.userId) ?? [];
    deliveryStatusByKey.set(deliveryKey, 'failed');

    for (const token of tokens) {
      pushMessages.push({
        to: token,
        title: delivery.title,
        body: delivery.body,
        data: {
          ...(delivery.data ?? {}),
          eventId: delivery.eventId,
          type: delivery.type,
          url: delivery.url,
        },
      });
      pushMessageKeys.push(deliveryKey);
    }
  });

  if (pushMessages.length) {
    try {
      const expoResponse = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: buildExpoHeaders(),
        body: JSON.stringify(pushMessages),
      });
      const expoJson = (await expoResponse.json().catch(() => null)) as unknown;
      const tickets = readExpoTickets(expoJson);

      if (expoResponse.ok && tickets.length === pushMessages.length) {
        tickets.forEach((ticket, index) => {
          const deliveryKey = pushMessageKeys[index];

          if (deliveryKey && ticket.status === 'ok') {
            deliveryStatusByKey.set(deliveryKey, 'sent');
          }
        });
      }
    } catch (error) {
      console.error('Push notification delivery failed.', error);
    }
  }

  const rows = enabledDeliveries.map((delivery, index) => {
    const deliveryKey = `${delivery.userId}:${delivery.type}:${delivery.eventId ?? 'none'}:${index}`;

    return {
      user_id: delivery.userId,
      event_id: delivery.eventId,
      type: delivery.type,
      status: deliveryStatusByKey.get(deliveryKey) ?? 'failed',
      payload: {
        title: delivery.title,
        body: delivery.body,
        url: delivery.url,
        ...(delivery.payload ?? {}),
        ...(delivery.data ?? {}),
      },
    };
  });

  if (!rows.length) {
    return;
  }

  const logResult = await adminClient.from('notification_log').insert(rows);

  if (logResult.error) {
    throw new Error(logResult.error.message);
  }
}
