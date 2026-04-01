import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { ActionButton, ChoiceChips, FormTextField, NoticeBanner } from '../auth/AuthPrimitives';
import { EdgeFunctionError } from '../../services/edge-functions';
import { submitReport } from '../../services/reports';
import type { AppNotice } from '../../types/app';
import type { ReportReason, SubmitReportInput } from '../../types/reports';

type ReportSheetTarget =
  | {
      type: 'event';
      eventId: string;
      title: string;
    }
  | {
      type: 'player';
      playerId: string;
      title: string;
    };

type ReportSheetProps = {
  visible: boolean;
  target: ReportSheetTarget;
  onClose: () => void;
  onSubmitted: (notice: AppNotice) => void;
};

const reportReasonOptions: ReportReason[] = [
  'inappropriate_content',
  'spam_or_fake',
  'abusive_behavior',
  'other',
];

const reportSchema = z.object({
  reason: z.enum(reportReasonOptions),
  detail: z.string().trim().max(300, 'reports.validation.detail'),
});

type ReportFormValues = z.infer<typeof reportSchema>;

function mapReportErrorToNotice(error: unknown): AppNotice {
  if (error instanceof EdgeFunctionError) {
    if (error.code === 'DUPLICATE_USER_REPORT') {
      return {
        messageKey: 'reports.errors.duplicate',
        tone: 'info',
      };
    }

    if (error.code === 'RATE_LIMITED') {
      return {
        messageKey: 'reports.errors.rateLimited',
        tone: 'info',
      };
    }

    if (error.code === 'EVENT_NOT_FOUND' || error.code === 'PLAYER_NOT_FOUND') {
      return {
        messageKey: 'reports.errors.targetUnavailable',
        tone: 'info',
      };
    }

    if (error.code === 'VALIDATION_ERROR' || error.code === 'INVALID_JSON') {
      return {
        messageKey: 'reports.errors.validation',
        tone: 'info',
      };
    }
  }

  const message = error instanceof Error ? error.message.toLowerCase() : '';

  if (message.includes('network') || message.includes('fetch')) {
    return {
      messageKey: 'reports.errors.network',
      tone: 'info',
    };
  }

  return {
    messageKey: 'reports.errors.generic',
    tone: 'error',
  };
}

export function ReportSheet({ visible, target, onClose, onSubmitted }: ReportSheetProps) {
  const { t } = useTranslation();
  const [notice, setNotice] = useState<AppNotice | null>(null);
  const form = useForm<ReportFormValues>({
    resolver: zodResolver(reportSchema),
    defaultValues: {
      reason: 'inappropriate_content',
      detail: '',
    },
  });
  const selectedReason = form.watch('reason');

  const reasonOptions = useMemo(
    () =>
      reportReasonOptions.map((reason) => ({
        label: t(`reports.reasons.${reason}`),
        value: reason,
      })),
    [t],
  );

  useEffect(() => {
    if (!visible) {
      form.reset({
        reason: 'inappropriate_content',
        detail: '',
      });
      setNotice(null);
    }
  }, [form, visible]);

  const submitMutation = useMutation({
    mutationFn: async (values: ReportFormValues) => {
      const input: SubmitReportInput =
        target.type === 'event'
          ? {
              targetType: 'event',
              targetEventId: target.eventId,
              reason: values.reason,
              detail: values.detail.trim() ? values.detail.trim() : null,
            }
          : {
              targetType: 'player',
              targetUserId: target.playerId,
              reason: values.reason,
              detail: values.detail.trim() ? values.detail.trim() : null,
            };

      return submitReport(input);
    },
    onSuccess: () => {
      onSubmitted({
        messageKey: 'reports.success',
        tone: 'success',
      });
      form.reset({
        reason: 'inappropriate_content',
        detail: '',
      });
      setNotice(null);
      onClose();
    },
    onError: (error) => {
      setNotice(mapReportErrorToNotice(error));
    },
  });

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardWrap}
        >
          <Pressable onPress={() => undefined} style={styles.card}>
            <ScrollView
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.title}>{t('reports.title')}</Text>
              <Text style={styles.bodyText}>
                {t(target.type === 'event' ? 'reports.eventBody' : 'reports.playerBody', {
                  target: target.title,
                })}
              </Text>
              <NoticeBanner notice={notice} resolveMessage={t} />
              <Controller
                control={form.control}
                name="reason"
                render={({ field, fieldState }) => (
                  <ChoiceChips
                    accessibilityHint={t('reports.reasonLabel')}
                    error={fieldState.error?.message ? t(fieldState.error.message) : null}
                    label={t('reports.reasonLabel')}
                    onChange={field.onChange}
                    options={reasonOptions}
                    value={field.value}
                  />
                )}
              />
              <Controller
                control={form.control}
                name="detail"
                render={({ field, fieldState }) => (
                  <FormTextField
                    accessibilityHint={t('reports.detailHint')}
                    autoCapitalize="sentences"
                    error={fieldState.error?.message ? t(fieldState.error.message) : null}
                    label={t('reports.detailLabel')}
                    maxLength={300}
                    multiline
                    numberOfLines={4}
                    onChangeText={field.onChange}
                    placeholder={t(
                      selectedReason === 'other'
                        ? 'reports.detailPlaceholderOther'
                        : 'reports.detailPlaceholder',
                    )}
                    value={field.value}
                  />
                )}
              />
              <Text style={styles.helperText}>
                {t('reports.detailCounter', {
                  count: form.watch('detail').length,
                })}
              </Text>
              <View style={styles.actions}>
                <ActionButton
                  accessibilityHint={t('reports.closeAction')}
                  label={t('reports.closeAction')}
                  onPress={onClose}
                  variant="secondary"
                />
                <ActionButton
                  accessibilityHint={t('reports.submit')}
                  disabled={submitMutation.isPending}
                  label={
                    submitMutation.isPending ? t('reports.submitPending') : t('reports.submit')
                  }
                  onPress={form.handleSubmit(async (values) => {
                    setNotice(null);
                    await submitMutation.mutateAsync(values);
                  })}
                />
              </View>
            </ScrollView>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(24, 49, 83, 0.4)',
  },
  keyboardWrap: {
    justifyContent: 'flex-end',
  },
  card: {
    maxHeight: '88%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: '#fffaf3',
    borderTopWidth: 1,
    borderColor: '#eadfce',
  },
  content: {
    gap: 14,
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 28,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#183153',
  },
  bodyText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#395065',
  },
  helperText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#6d7f95',
  },
  actions: {
    gap: 10,
  },
});
