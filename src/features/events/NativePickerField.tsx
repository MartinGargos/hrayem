import { useState } from 'react';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { SelectionField } from '../auth/AuthPrimitives';

type NativePickerFieldProps = {
  label: string;
  valueText: string | null;
  placeholder: string;
  mode: 'date' | 'time';
  value: Date;
  onChange: (value: Date) => void;
  error?: string | null;
};

export function NativePickerField({
  label,
  valueText,
  placeholder,
  mode,
  value,
  onChange,
  error,
}: NativePickerFieldProps) {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [draftValue, setDraftValue] = useState(value);

  function handlePickerChange(_event: DateTimePickerEvent, nextValue?: Date) {
    if (!nextValue) {
      return;
    }

    setDraftValue(nextValue);
  }

  function openPicker() {
    setDraftValue(value);
    setIsVisible(true);
  }

  function confirmPicker() {
    onChange(draftValue);
    setIsVisible(false);
  }

  return (
    <>
      <SelectionField
        error={error}
        label={label}
        onPress={openPicker}
        placeholder={placeholder}
        value={valueText}
      />

      <Modal
        animationType="slide"
        onRequestClose={() => setIsVisible(false)}
        transparent
        visible={isVisible}
      >
        <Pressable onPress={() => setIsVisible(false)} style={styles.backdrop}>
          <Pressable style={styles.card}>
            <Text style={styles.title}>{label}</Text>
            <DateTimePicker
              display="spinner"
              mode={mode}
              onChange={handlePickerChange}
              style={styles.picker}
              value={draftValue}
            />
            <View style={styles.actions}>
              <Pressable
                onPress={() => setIsVisible(false)}
                style={[styles.button, styles.secondaryButton]}
              >
                <Text style={[styles.buttonLabel, styles.secondaryButtonLabel]}>
                  {t('events.common.pickerCancel')}
                </Text>
              </Pressable>
              <Pressable onPress={confirmPicker} style={[styles.button, styles.primaryButton]}>
                <Text style={[styles.buttonLabel, styles.primaryButtonLabel]}>
                  {t('events.common.pickerDone')}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },
  card: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: '#fff9f1',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#183153',
  },
  picker: {
    alignSelf: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: '#183153',
  },
  secondaryButton: {
    backgroundColor: '#eef3f8',
  },
  buttonLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  primaryButtonLabel: {
    color: '#fff8f0',
  },
  secondaryButtonLabel: {
    color: '#183153',
  },
});
