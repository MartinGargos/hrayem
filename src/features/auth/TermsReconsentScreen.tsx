import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useState } from 'react';
import { Linking, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from '../../constants/external-links';
import { acceptCurrentConsent } from '../../services/app-bootstrap';
import { useUIStore } from '../../store/ui-store';
import { publicEnv } from '../../utils/env';
import { ActionButton, AuthScaffold, CheckboxField, NoticeBanner } from './AuthPrimitives';
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
    <AuthScaffold title={t('auth.reconsent.title')} subtitle={t('auth.reconsent.subtitle')}>
      <NoticeBanner notice={notice} resolveMessage={t} />
      <Controller
        control={form.control}
        name="acceptedTerms"
        render={({ field, fieldState }) => (
          <CheckboxField
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
        label={t('auth.reconsent.submit')}
        onPress={form.handleSubmit(handleSubmit)}
      />
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
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
