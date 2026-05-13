import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
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
  {
    labelKey: 'auth.login.qa.loginAsQa3',
    email: 'qa.iphone3@example.com',
    password: 'Hrayem-QA-2026!',
  },
  {
    labelKey: 'auth.login.qa.loginAsQa4',
    email: 'qa.iphone4@example.com',
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
    <View style={styles.footerRow}>
      <Text style={styles.footerText}>{t('auth.login.noAccount')}</Text>
      <TextLink label={t('auth.login.createAccount')} onPress={() => setAuthScreen('register')} />
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

function DividerLabel({ label }: { label: string }) {
  return (
    <View style={styles.dividerRow}>
      <View style={styles.dividerLine} />
      <Text style={styles.dividerLabel}>{label}</Text>
      <View style={styles.dividerLine} />
    </View>
  );
}

function InfoCallout({ text }: { text: string }) {
  return (
    <View style={styles.infoCallout}>
      <Text style={styles.infoIcon}>i</Text>
      <Text style={styles.infoCalloutText}>{text}</Text>
    </View>
  );
}

function getPasswordStrength(password: string): number {
  if (!password) {
    return 0;
  }

  const checks = [
    password.length >= 6,
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ];

  return Math.max(1, checks.filter(Boolean).length);
}

function LoginForm() {
  const { t } = useTranslation();
  const clearAuthNotice = useUIStore((state) => state.clearAuthNotice);
  const clearErrorMessage = useAuthStore((state) => state.clearErrorMessage);
  const setAuthNotice = useUIStore((state) => state.setAuthNotice);
  const setAuthScreen = useUIStore((state) => state.setAuthScreen);
  const startAuthTransition = useUIStore((state) => state.startAuthTransition);
  const finishAuthTransition = useUIStore((state) => state.finishAuthTransition);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
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
    startAuthTransition();

    try {
      await signInWithPassword(values);
    } catch (error) {
      finishAuthTransition();
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
            leftIconName="mail-outline"
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
            leftIconName="lock-closed-outline"
            onChangeText={field.onChange}
            placeholder={t('auth.placeholders.password')}
            rightIconName="eye-outline"
            secureTextEntry
            textContentType="password"
            value={field.value}
            error={translateFieldError(t, fieldState.error?.message)}
          />
        )}
      />

      <View style={styles.loginUtilityRow}>
        <Pressable
          accessibilityLabel={t('auth.login.rememberMe')}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: rememberMe }}
          onPress={() => setRememberMe((value) => !value)}
          style={styles.rememberControl}
        >
          <View
            style={[styles.rememberCheckbox, rememberMe ? styles.rememberCheckboxChecked : null]}
          >
            {rememberMe ? <Text style={styles.rememberCheck}>✓</Text> : null}
          </View>
          <Text style={styles.rememberText}>{t('auth.login.rememberMe')}</Text>
        </Pressable>
        <TextLink
          label={t('auth.login.forgotPassword')}
          onPress={() => setAuthScreen('forgot-password')}
        />
      </View>

      {__DEV__ ? (
        <View style={styles.devQuickLoginCard}>
          <View style={styles.devQuickLoginHeader}>
            <Text style={styles.devBadge}>DEV</Text>
            <Text style={styles.devQuickLoginTitle}>{t('auth.login.qa.title')}</Text>
          </View>
          <Text style={styles.devQuickLoginBody}>{t('auth.login.qa.description')}</Text>
          <View style={styles.devQuickLoginGrid}>
            {DEV_QA_ACCOUNTS.map((account) => (
              <View key={account.email} style={styles.devQuickLoginButton}>
                <ActionButton
                  disabled={isSubmitting}
                  label={t(account.labelKey)}
                  onPress={() => handleQuickLogin(account)}
                  variant="secondary"
                />
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <ActionButton
        disabled={isSubmitting}
        iconName="arrow-forward"
        iconPosition="right"
        label={t('auth.login.submit')}
        onPress={form.handleSubmit(handleSubmit)}
      />
      <DividerLabel label={t('auth.login.or')} />
      <ActionButton
        disabled={isSubmitting}
        iconName="logo-apple"
        label={t('auth.login.apple')}
        onPress={() => handleOAuth('apple')}
        variant="secondary"
      />
      <ActionButton
        disabled={isSubmitting}
        iconName="logo-google"
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
  const passwordStrength = getPasswordStrength(form.watch('password'));

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
            leftIconName="mail-outline"
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
            leftIconName="lock-closed-outline"
            onChangeText={field.onChange}
            placeholder={t('auth.placeholders.password')}
            rightIconName="eye-outline"
            secureTextEntry
            textContentType="newPassword"
            value={field.value}
            error={translateFieldError(t, fieldState.error?.message)}
          />
        )}
      />
      <View
        style={styles.passwordStrengthRow}
        accessibilityLabel={t('auth.register.passwordStrength')}
      >
        {[1, 2, 3, 4].map((level) => (
          <View
            key={level}
            style={[
              styles.passwordStrengthSegment,
              passwordStrength >= level ? styles.passwordStrengthSegmentActive : null,
            ]}
          />
        ))}
      </View>
      <Controller
        control={form.control}
        name="acceptedTerms"
        render={({ field, fieldState }) => (
          <CheckboxField
            accessibilityHint={t('auth.register.submit')}
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
            leftIconName="mail-outline"
            onChangeText={field.onChange}
            placeholder={t('auth.placeholders.email')}
            textContentType="emailAddress"
            value={field.value}
            error={translateFieldError(t, fieldState.error?.message)}
          />
        )}
      />
      <InfoCallout text={t('auth.forgotPassword.info')} />

      <ActionButton
        disabled={isSubmitting}
        iconName="arrow-forward"
        iconPosition="right"
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
            leftIconName="lock-closed-outline"
            onChangeText={field.onChange}
            placeholder={t('auth.placeholders.password')}
            rightIconName="eye-outline"
            secureTextEntry
            textContentType="newPassword"
            value={field.value}
            error={translateFieldError(t, fieldState.error?.message)}
          />
        )}
      />
      <ActionButton
        disabled={isSubmitting}
        iconName="arrow-forward"
        iconPosition="right"
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
  loginUtilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  rememberControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 36,
  },
  rememberCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#c6c9cc',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fffdf8',
  },
  rememberCheckboxChecked: {
    backgroundColor: '#061427',
    borderColor: '#061427',
  },
  rememberCheck: {
    color: '#c8ff28',
    fontSize: 15,
    fontWeight: '900',
  },
  rememberText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#5f6670',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 2,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e7e1da',
  },
  dividerLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: '#8c9097',
  },
  infoCallout: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: '#edf5ff',
  },
  infoIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#5fa0ff',
    textAlign: 'center',
    lineHeight: 18,
    fontSize: 13,
    fontWeight: '800',
    color: '#3484ef',
  },
  infoCalloutText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
    color: '#2e4056',
  },
  devQuickLoginCard: {
    gap: 12,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#a8cfff',
    backgroundColor: '#eef5ff',
  },
  devQuickLoginHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  devBadge: {
    overflow: 'hidden',
    borderRadius: 9,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#ff5f43',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    color: '#fffdf8',
  },
  devQuickLoginTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: '#061427',
  },
  devQuickLoginBody: {
    fontSize: 13,
    lineHeight: 19,
    color: '#395065',
  },
  devQuickLoginGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  devQuickLoginButton: {
    flexBasis: '48%',
    flexGrow: 1,
  },
  passwordStrengthRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: -4,
  },
  passwordStrengthSegment: {
    flex: 1,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#e6e1d9',
  },
  passwordStrengthSegmentActive: {
    backgroundColor: '#c8ff28',
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
