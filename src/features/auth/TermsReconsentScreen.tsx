import { zodResolver } from '@hookform/resolvers/zod';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Controller, useForm } from 'react-hook-form';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from '../../constants/external-links';
import { acceptCurrentConsent } from '../../services/app-bootstrap';
import { signOutAndClearState } from '../../services/auth';
import { useUIStore } from '../../store/ui-store';
import { publicEnv } from '../../utils/env';
import {
  ActionButton,
  AuthScaffold,
  CheckboxField,
  NoticeBanner,
  TextLink,
} from './AuthPrimitives';
import { mapAuthErrorToMessageKey } from './auth-errors';

const consentSchema = z.object({
  acceptedTerms: z.boolean().refine((value) => value, 'auth.validation.acceptTerms'),
});

type ConsentValues = z.infer<typeof consentSchema>;

type TermsReconsentScreenProps = {
  userId: string;
  onAccepted: () => Promise<void> | void;
};

function translateFieldError(
  t: (key: string) => string,
  message: string | undefined,
): string | null {
  return message ? t(message) : null;
}

export function TermsReconsentScreen({ userId, onAccepted }: TermsReconsentScreenProps) {
  const { t } = useTranslation();
  const notice = useUIStore((state) => state.authNotice);
  const setAuthNotice = useUIStore((state) => state.setAuthNotice);
  const clearAuthNotice = useUIStore((state) => state.clearAuthNotice);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const form = useForm<ConsentValues>({
    resolver: zodResolver(consentSchema),
    defaultValues: {
      acceptedTerms: false,
    },
  });

  async function handleSubmit(values: ConsentValues) {
    clearAuthNotice();
    setIsSubmitting(true);

    try {
      if (!values.acceptedTerms) {
        return;
      }

      await acceptCurrentConsent(userId, publicEnv.termsVersion, publicEnv.privacyVersion);
      await onAccepted();
    } catch (error) {
      setAuthNotice({
        messageKey: mapAuthErrorToMessageKey(error),
        tone: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthScaffold
      title={t('auth.reconsent.title')}
      subtitle={t('auth.reconsent.subtitle')}
      footer={<TextLink label={t('auth.home.logout')} onPress={signOutAndClearState} />}
    >
      <NoticeBanner notice={notice} resolveMessage={t} />
      <View style={styles.documentsCard}>
        <Pressable
          accessibilityLabel={t('auth.reconsent.termsTitle')}
          accessibilityRole="link"
          onPress={() => Linking.openURL(TERMS_OF_SERVICE_URL)}
          style={styles.documentRow}
        >
          <View style={styles.documentIcon}>
            <Ionicons color="#8f887d" name="document-text-outline" size={23} />
          </View>
          <View style={styles.documentCopy}>
            <Text style={styles.documentTitle}>{t('auth.reconsent.termsTitle')}</Text>
            <Text style={styles.documentMeta}>
              {t('auth.reconsent.termsMeta', { version: publicEnv.termsVersion || '—' })}
            </Text>
          </View>
          <Ionicons color="#96918b" name="chevron-forward" size={19} />
        </Pressable>
        <View style={styles.documentDivider} />
        <Pressable
          accessibilityLabel={t('auth.reconsent.privacyTitle')}
          accessibilityRole="link"
          onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
          style={styles.documentRow}
        >
          <View style={styles.documentIcon}>
            <Ionicons color="#8f887d" name="document-text-outline" size={23} />
          </View>
          <View style={styles.documentCopy}>
            <Text style={styles.documentTitle}>{t('auth.reconsent.privacyTitle')}</Text>
            <Text style={styles.documentMeta}>
              {t('auth.reconsent.privacyMeta', { version: publicEnv.privacyVersion || '—' })}
            </Text>
          </View>
          <Ionicons color="#96918b" name="chevron-forward" size={19} />
        </Pressable>
      </View>
      <Controller
        control={form.control}
        name="acceptedTerms"
        render={({ field, fieldState }) => (
          <CheckboxField
            accessibilityHint={t('auth.reconsent.submit')}
            accessibilityLabel={t('auth.register.termsCheckbox')}
            checked={field.value}
            error={translateFieldError(t, fieldState.error?.message)}
            label={
              <Text style={styles.checkboxText}>
                {t('auth.register.termsPrefix')}{' '}
                <Text
                  style={styles.checkboxLink}
                  onPress={() => Linking.openURL(TERMS_OF_SERVICE_URL)}
                >
                  {t('auth.register.termsLink')}
                </Text>{' '}
                {t('auth.register.and')}{' '}
                <Text
                  style={styles.checkboxLink}
                  onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
                >
                  {t('auth.register.privacyLink')}
                </Text>
              </Text>
            }
            onPress={() => field.onChange(!field.value)}
          />
        )}
      />
      <ActionButton
        disabled={isSubmitting || !form.watch('acceptedTerms')}
        iconName="arrow-forward"
        iconPosition="right"
        label={t('auth.reconsent.submit')}
        onPress={form.handleSubmit(handleSubmit)}
      />
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  documentsCard: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#fffdf8',
  },
  documentRow: {
    minHeight: 78,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  documentIcon: {
    width: 48,
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ded5c8',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f2eee6',
  },
  documentCopy: {
    flex: 1,
    gap: 2,
  },
  documentTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
    color: '#061427',
  },
  documentMeta: {
    fontSize: 13,
    lineHeight: 18,
    color: '#7c8188',
  },
  documentDivider: {
    height: 1,
    marginLeft: 76,
    backgroundColor: '#eee9e2',
  },
  checkboxText: {
    fontSize: 14,
    lineHeight: 22,
    color: '#395065',
  },
  checkboxLink: {
    color: '#225b88',
    fontWeight: '700',
  },
});
