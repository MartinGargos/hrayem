import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { ScreenCard, ScreenShell } from '../../components/ScreenShell';
import { clearSessionWithMessage, supabase } from '../../services/supabase';
import { clearLocalPushRegistrationState } from '../../services/push-notifications';
import { deleteAccount } from '../../services/account';
import type { AppNotice } from '../../types/app';
import { ActionButton, NoticeBanner } from '../auth/AuthPrimitives';
import { EdgeFunctionError } from '../../services/edge-functions';

function mapDeleteAccountError(error: unknown): AppNotice {
  if (error instanceof EdgeFunctionError && error.code === 'UNAUTHORIZED') {
    return {
      messageKey: 'accountDeletion.errors.unauthorized',
      tone: 'info',
    };
  }

  const message = error instanceof Error ? error.message.toLowerCase() : '';

  if (message.includes('network') || message.includes('fetch')) {
    return {
      messageKey: 'accountDeletion.errors.network',
      tone: 'info',
    };
  }

  return {
    messageKey: 'accountDeletion.errors.generic',
    tone: 'error',
  };
}

export function AccountDeletionScreen() {
  const { t } = useTranslation();
  const [notice, setNotice] = useState<AppNotice | null>(null);

  const deleteAccountMutation = useMutation({
    mutationFn: deleteAccount,
    onSuccess: async () => {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await Promise.allSettled([
        clearLocalPushRegistrationState(),
        supabase.auth.signOut({
          scope: 'local',
        }),
      ]);
      await clearSessionWithMessage('accountDeletion.success');
    },
    onError: async (error) => {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setNotice(mapDeleteAccountError(error));
    },
  });

  function handleDeletePress() {
    Alert.alert(t('accountDeletion.confirmTitle'), t('accountDeletion.confirmBody'), [
      {
        text: t('events.common.cancel'),
        style: 'cancel',
      },
      {
        text: t('accountDeletion.confirmAction'),
        style: 'destructive',
        onPress: () => {
          setNotice(null);
          void deleteAccountMutation.mutateAsync();
        },
      },
    ]);
  }

  return (
    <ScreenShell
      title={t('navigation.titles.accountDeletion')}
      subtitle={t('accountDeletion.subtitle')}
    >
      <ScreenCard title={t('accountDeletion.title')}>
        <NoticeBanner notice={notice} resolveMessage={t} />
        <Text style={styles.bodyText}>{t('accountDeletion.body')}</Text>
        <View style={styles.impactList}>
          <Text style={styles.impactItem}>{t('accountDeletion.impacts.organizedEvents')}</Text>
          <Text style={styles.impactItem}>{t('accountDeletion.impacts.joinedEvents')}</Text>
          <Text style={styles.impactItem}>{t('accountDeletion.impacts.availability')}</Text>
          <Text style={styles.impactItem}>{t('accountDeletion.impacts.profilePhoto')}</Text>
          <Text style={styles.impactItem}>{t('accountDeletion.impacts.sessions')}</Text>
          <Text style={styles.impactItem}>{t('accountDeletion.impacts.history')}</Text>
        </View>
      </ScreenCard>

      <ScreenCard title={t('accountDeletion.actionTitle')}>
        <Text style={styles.warningText}>{t('accountDeletion.warning')}</Text>
        <ActionButton
          accessibilityHint={t('accountDeletion.confirmAction')}
          disabled={deleteAccountMutation.isPending}
          label={
            deleteAccountMutation.isPending
              ? t('accountDeletion.pending')
              : t('accountDeletion.deleteAction')
          }
          onPress={handleDeletePress}
        />
      </ScreenCard>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  bodyText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#395065',
  },
  impactList: {
    gap: 10,
  },
  impactItem: {
    fontSize: 15,
    lineHeight: 22,
    color: '#183153',
  },
  warningText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#8d2b20',
    fontWeight: '700',
  },
});
