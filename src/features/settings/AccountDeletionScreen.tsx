import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useMutation } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
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

  const impacts = [
    t('accountDeletion.impacts.organizedEvents'),
    t('accountDeletion.impacts.joinedEvents'),
    t('accountDeletion.impacts.availability'),
    t('accountDeletion.impacts.profilePhoto'),
    t('accountDeletion.impacts.sessions'),
    t('accountDeletion.impacts.history'),
  ];

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
      <ScreenCard>
        <NoticeBanner notice={notice} resolveMessage={t} />
        <View style={styles.heroPanel}>
          <View style={styles.heroIconWrap}>
            <Ionicons color="#8f332d" name="trash-outline" size={20} />
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>{t('accountDeletion.title')}</Text>
            <Text style={styles.bodyText}>{t('accountDeletion.body')}</Text>
          </View>
        </View>

        <View style={styles.impactList}>
          {impacts.map((impact) => (
            <View key={impact} style={styles.impactRow}>
              <View style={styles.impactIconWrap}>
                <Ionicons color="#183153" name="checkmark-outline" size={16} />
              </View>
              <Text style={styles.impactItem}>{impact}</Text>
            </View>
          ))}
        </View>
      </ScreenCard>

      <ScreenCard title={t('accountDeletion.actionTitle')}>
        <View style={styles.dangerCard}>
          <View style={styles.warningRow}>
            <Ionicons color="#b44740" name="alert-circle-outline" size={18} />
            <Text style={styles.warningText}>{t('accountDeletion.warning')}</Text>
          </View>
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
        </View>
      </ScreenCard>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  heroPanel: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  heroIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fdeceb',
  },
  heroCopy: {
    flex: 1,
    gap: 6,
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#183153',
  },
  bodyText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#395065',
  },
  impactList: {
    gap: 10,
  },
  impactRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#fffaf5',
  },
  impactIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef3f8',
  },
  impactItem: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
    color: '#183153',
  },
  dangerCard: {
    gap: 14,
    borderRadius: 18,
    padding: 14,
    backgroundColor: '#fff4f3',
    borderWidth: 1,
    borderColor: '#f0d0cb',
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  warningText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    color: '#8d2b20',
    fontWeight: '700',
  },
});
