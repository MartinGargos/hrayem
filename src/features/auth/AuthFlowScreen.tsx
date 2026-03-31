import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from '../../constants/external-links';
import { useAuthStore } from '../../store/auth-store';
import { useUIStore } from '../../store/ui-store';
import { publicEnv } from '../../utils/env';
import {
  sendPasswordResetEmail,
  signInWithOAuth,
  signInWithPassword,
  signUpWithEmail,
  updatePassword,
} from '../../services/auth';
import type { AppNotice } from '../../types/app';
import {
  ActionButton,
  AuthScaffold,
  CheckboxField,
  FormTextField,
  NoticeBanner,
  TextLink,
} from './AuthPrimitives';
import { mapAuthErrorToMessageKey } from './auth-errors';

const loginSchema = z.object({
  email: z.string().email('auth.validation.email'),
  password: z.string().min(6, 'auth.validation.password'),
});

const registerSchema = loginSchema.extend({
  acceptedTerms: z.boolean().refine((value) => value, 'auth.validation.acceptTerms'),
});

const forgotPasswordSchema = z.object({
  email: z.string().email('auth.validation.email'),
});

const resetPasswordSchema = z.object({
  password: z.string().min(6, 'auth.validation.password'),
});

type LoginValues = z.infer<typeof loginSchema>;
type RegisterValues = z.infer<typeof registerSchema>;
type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;
type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

const DEV_QA_ACCOUNTS = [
  {
    labelKey: 'auth.login.qa.loginAsQa1',
    email: 'qa.iphone1@example.com',
    password: 'Hrayem-QA-2026!',
  },
  {
    labelKey: 'auth.login.qa.loginAsQa2',
    email: 'qa.iphone2@example.com',
    password: 'Hrayem-QA-2026!',
  },
] as const satisfies readonly (LoginValues & {
  labelKey: string;
})[];

function translateFieldError(
  t: (key: string) => string,
  message: string | undefined,
): string | null {
  return message ? t(message) : null;
}

function AuthFooterLinks() {
  const authScreen = useUIStore((state) => state.authScreen);
  const setAuthScreen = useUIStore((state) => state.setAuthScreen);
  const { t } = useTranslation();

  if (authScreen === 'register') {
    return (
      <View style={styles.footerRow}>
        <Text style={styles.footerText}>{t('auth.register.haveAccount')}</Text>
        <TextLink label={t('auth.register.signIn')} onPress={() => setAuthScreen('login')} />
      </View>
    );
  }

  if (authScreen === 'forgot-password' || authScreen === 'reset-password') {
    return (
      <View style={styles.footerRow}>
        <TextLink
          label={t('auth.forgotPassword.backToLogin')}
          onPress={() => setAuthScreen('login')}
        />
      </View>
    );
  }

  return (
    <View style={styles.footerGroup}>
      <View style={styles.footerRow}>
        <Text style={styles.footerText}>{t('auth.login.noAccount')}</Text>
        <TextLink label={t('auth.login.createAccount')} onPress={() => setAuthScreen('register')} />
      </View>
      <View style={styles.footerRow}>
        <TextLink
          label={t('auth.login.forgotPassword')}
          onPress={() => setAuthScreen('forgot-password')}
        />
      </View>
    </View>
  );
}

function useResolvedNotice(): AppNotice | null {
  const authNotice = useUIStore((state) => state.authNotice);
  const authErrorMessageKey = useAuthStore((state) => state.errorMessageKey);

  if (authErrorMessageKey) {
    return {
      messageKey: authErrorMessageKey,
      tone: 'error',
    };
  }

  return authNotice;
}

function LoginForm() {
  const { t } = useTranslation();
  const clearAuthNotice = useUIStore((state) => state.clearAuthNotice);
  const clearErrorMessage = useAuthStore((state) => state.clearErrorMessage);
  const setAuthNotice = useUIStore((state) => state.setAuthNotice);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  async function handleSubmit(values: LoginValues) {
    clearAuthNotice();
    clearErrorMessage();
    setIsSubmitting(true);

    try {
      await signInWithPassword(values);
    } catch (error) {
      setAuthNotice({
        messageKey: mapAuthErrorToMessageKey(error),
        tone: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleQuickLogin(values: LoginValues) {
    form.reset(values);
    await handleSubmit(values);
  }

  async function handleOAuth(provider: 'apple' | 'google') {
    clearAuthNotice();
    clearErrorMessage();
    setIsSubmitting(true);

    try {
      await signInWithOAuth(provider);
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
    <>
      <Controller
        control={form.control}
        name="email"
        render={({ field, fieldState }) => (
          <FormTextField
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            label={t('auth.fields.email')}
            onChangeText={field.onChange}
            placeholder={t('auth.placeholders.email')}
            textContentType="emailAddress"
            value={field.value}
            error={translateFieldError(t, fieldState.error?.message)}
          />
        )}
      />
      <Controller
        control={form.control}
        name="password"
        render={({ field, fieldState }) => (
          <FormTextField
            autoComplete="password"
            label={t('auth.fields.password')}
            onChangeText={field.onChange}
            placeholder={t('auth.placeholders.password')}
            secureTextEntry
            textContentType="password"
            value={field.value}
            error={translateFieldError(t, fieldState.error?.message)}
          />
        )}
      />

      {__DEV__ ? (
        <View style={styles.devQuickLoginCard}>
          <Text style={styles.devQuickLoginTitle}>{t('auth.login.qa.title')}</Text>
          <Text style={styles.devQuickLoginBody}>{t('auth.login.qa.description')}</Text>
          {DEV_QA_ACCOUNTS.map((account) => (
            <ActionButton
              key={account.email}
              disabled={isSubmitting}
              label={t(account.labelKey)}
              onPress={() => handleQuickLogin(account)}
              variant="secondary"
            />
          ))}
        </View>
      ) : null}

      <ActionButton
        disabled={isSubmitting}
        label={t('auth.login.submit')}
        onPress={form.handleSubmit(handleSubmit)}
      />
      <ActionButton
        disabled={isSubmitting}
        label={t('auth.login.apple')}
        onPress={() => handleOAuth('apple')}
        variant="secondary"
      />
      <ActionButton
        disabled={isSubmitting}
        label={t('auth.login.google')}
        onPress={() => handleOAuth('google')}
        variant="secondary"
      />
    </>
  );
}

function RegisterForm() {
  const { t } = useTranslation();
  const clearAuthNotice = useUIStore((state) => state.clearAuthNotice);
  const clearErrorMessage = useAuthStore((state) => state.clearErrorMessage);
  const setAuthNotice = useUIStore((state) => state.setAuthNotice);
  const setAuthScreen = useUIStore((state) => state.setAuthScreen);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: '',
      password: '',
      acceptedTerms: false,
    },
  });

  async function handleSubmit(values: RegisterValues) {
    clearAuthNotice();
    clearErrorMessage();
    setIsSubmitting(true);

    try {
      const result = await signUpWithEmail({
        email: values.email,
        password: values.password,
        termsVersion: publicEnv.termsVersion,
        privacyVersion: publicEnv.privacyVersion,
      });

      if (result.requiresEmailConfirmation) {
        setAuthScreen('login');
        setAuthNotice({
          messageKey: 'auth.register.confirmEmail',
          tone: 'success',
        });
      }
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
    <>
      <Controller
        control={form.control}
        name="email"
        render={({ field, fieldState }) => (
          <FormTextField
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            label={t('auth.fields.email')}
            onChangeText={field.onChange}
            placeholder={t('auth.placeholders.email')}
            textContentType="emailAddress"
            value={field.value}
            error={translateFieldError(t, fieldState.error?.message)}
          />
        )}
      />
      <Controller
        control={form.control}
        name="password"
        render={({ field, fieldState }) => (
          <FormTextField
            autoComplete="new-password"
            label={t('auth.fields.password')}
            onChangeText={field.onChange}
            placeholder={t('auth.placeholders.password')}
            secureTextEntry
            textContentType="newPassword"
            value={field.value}
            error={translateFieldError(t, fieldState.error?.message)}
          />
        )}
      />
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
        label={t('auth.register.submit')}
        onPress={form.handleSubmit(handleSubmit)}
      />
    </>
  );
}

function ForgotPasswordForm() {
  const { t } = useTranslation();
  const clearAuthNotice = useUIStore((state) => state.clearAuthNotice);
  const setAuthNotice = useUIStore((state) => state.setAuthNotice);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: '',
    },
  });

  async function handleSubmit(values: ForgotPasswordValues) {
    clearAuthNotice();
    setIsSubmitting(true);

    try {
      await sendPasswordResetEmail(values.email);
      setAuthNotice({
        messageKey: 'auth.forgotPassword.sent',
        tone: 'success',
      });
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
    <>
      <Controller
        control={form.control}
        name="email"
        render={({ field, fieldState }) => (
          <FormTextField
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            label={t('auth.fields.email')}
            onChangeText={field.onChange}
            placeholder={t('auth.placeholders.email')}
            textContentType="emailAddress"
            value={field.value}
            error={translateFieldError(t, fieldState.error?.message)}
          />
        )}
      />

      <ActionButton
        disabled={isSubmitting}
        label={t('auth.forgotPassword.submit')}
        onPress={form.handleSubmit(handleSubmit)}
      />
    </>
  );
}

function ResetPasswordForm() {
  const { t } = useTranslation();
  const clearAuthNotice = useUIStore((state) => state.clearAuthNotice);
  const setAuthNotice = useUIStore((state) => state.setAuthNotice);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      password: '',
    },
  });

  async function handleSubmit(values: ResetPasswordValues) {
    clearAuthNotice();
    setIsSubmitting(true);

    try {
      await updatePassword(values.password);
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
    <>
      <Controller
        control={form.control}
        name="password"
        render={({ field, fieldState }) => (
          <FormTextField
            autoComplete="new-password"
            label={t('auth.resetPassword.password')}
            onChangeText={field.onChange}
            placeholder={t('auth.placeholders.password')}
            secureTextEntry
            textContentType="newPassword"
            value={field.value}
            error={translateFieldError(t, fieldState.error?.message)}
          />
        )}
      />
      <ActionButton
        disabled={isSubmitting}
        label={t('auth.resetPassword.submit')}
        onPress={form.handleSubmit(handleSubmit)}
      />
    </>
  );
}

export function AuthFlowScreen() {
  const { t } = useTranslation();
  const authScreen = useUIStore((state) => state.authScreen);
  const notice = useResolvedNotice();

  const screenCopy = {
    login: {
      title: t('auth.login.title'),
      subtitle: t('auth.login.subtitle'),
      content: <LoginForm />,
    },
    register: {
      title: t('auth.register.title'),
      subtitle: t('auth.register.subtitle'),
      content: <RegisterForm />,
    },
    'forgot-password': {
      title: t('auth.forgotPassword.title'),
      subtitle: t('auth.forgotPassword.subtitle'),
      content: <ForgotPasswordForm />,
    },
    'reset-password': {
      title: t('auth.resetPassword.title'),
      subtitle: t('auth.resetPassword.subtitle'),
      content: <ResetPasswordForm />,
    },
  } as const;

  const activeScreen = screenCopy[authScreen];

  return (
    <AuthScaffold
      title={activeScreen.title}
      subtitle={activeScreen.subtitle}
      footer={<AuthFooterLinks />}
    >
      <NoticeBanner notice={notice} resolveMessage={t} />
      {activeScreen.content}
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  footerGroup: {
    gap: 10,
    alignItems: 'center',
  },
  footerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'center',
  },
  footerText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#395065',
  },
  devQuickLoginCard: {
    gap: 10,
    padding: 14,
    borderRadius: 18,
    backgroundColor: '#eef4fb',
  },
  devQuickLoginTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#183153',
  },
  devQuickLoginBody: {
    fontSize: 13,
    lineHeight: 19,
    color: '#395065',
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
