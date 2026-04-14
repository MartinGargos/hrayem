import { useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextInputProps,
} from 'react-native';

import type { AppNotice, NoticeTone } from '../../types/app';

type AuthScaffoldProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthScaffold({ title, subtitle, children, footer }: AuthScaffoldProps) {
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}
    >
      <ScrollView
        bounces={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Hrayem</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>

        <View style={styles.card}>{children}</View>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

type NoticeBannerProps = {
  notice: AppNotice | null;
  resolveMessage: (messageKey: string) => string;
};

export function NoticeBanner({ notice, resolveMessage }: NoticeBannerProps) {
  if (!notice) {
    return null;
  }

  return (
    <View style={[styles.notice, noticeStyles[notice.tone]]}>
      <Text style={styles.noticeText}>{resolveMessage(notice.messageKey)}</Text>
    </View>
  );
}

type FormTextFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  error?: string | null;
  placeholder?: string;
  accessibilityHint?: string;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoComplete?: TextInputProps['autoComplete'];
  multiline?: boolean;
  maxLength?: number;
  numberOfLines?: number;
  textContentType?: TextInputProps['textContentType'];
};

export function FormTextField({
  label,
  value,
  onChangeText,
  error,
  placeholder,
  accessibilityHint,
  secureTextEntry,
  keyboardType,
  autoCapitalize = 'none',
  autoComplete,
  multiline = false,
  maxLength,
  numberOfLines,
  textContentType,
}: FormTextFieldProps) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityHint={accessibilityHint ?? placeholder ?? label}
        accessibilityLabel={label}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        keyboardType={keyboardType}
        maxLength={maxLength}
        multiline={multiline}
        numberOfLines={numberOfLines}
        onBlur={() => setIsFocused(false)}
        onChangeText={onChangeText}
        onFocus={() => setIsFocused(true)}
        placeholder={placeholder}
        placeholderTextColor="#7a8ca3"
        secureTextEntry={secureTextEntry}
        selectionColor="#183153"
        style={[
          styles.input,
          multiline ? styles.inputMultiline : undefined,
          isFocused ? styles.inputFocused : undefined,
          error ? styles.inputError : undefined,
        ]}
        textAlignVertical={multiline ? 'top' : 'center'}
        textContentType={textContentType}
        value={value}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

type ActionButtonProps = {
  label: string;
  onPress: () => void | Promise<void>;
  accessibilityHint?: string;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
  iconName?: React.ComponentProps<typeof Ionicons>['name'];
};

export function ActionButton({
  label,
  onPress,
  accessibilityHint,
  disabled = false,
  variant = 'primary',
  iconName,
}: ActionButtonProps) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint ?? label}
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={() => {
        void onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' ? styles.primaryButton : styles.secondaryButton,
        disabled ? styles.buttonDisabled : undefined,
        pressed && !disabled ? styles.buttonPressed : undefined,
      ]}
    >
      <View style={styles.buttonContent}>
        {iconName ? (
          <Ionicons
            color={variant === 'primary' ? '#fff9f1' : '#183153'}
            name={iconName}
            size={16}
          />
        ) : null}
        <Text
          style={[
            styles.buttonLabel,
            variant === 'primary' ? styles.primaryButtonLabel : styles.secondaryButtonLabel,
          ]}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

type TextLinkProps = {
  label: string;
  accessibilityHint?: string;
  onPress: () => void | Promise<void>;
};

export function TextLink({ label, accessibilityHint, onPress }: TextLinkProps) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint ?? label}
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={() => {
        void onPress();
      }}
    >
      <Text style={styles.textLink}>{label}</Text>
    </Pressable>
  );
}

type CheckboxFieldProps = {
  label: ReactNode;
  accessibilityHint?: string;
  accessibilityLabel: string;
  checked: boolean;
  onPress: () => void;
  error?: string | null;
};

export function CheckboxField({
  label,
  accessibilityHint,
  accessibilityLabel,
  checked,
  onPress,
  error,
}: CheckboxFieldProps) {
  return (
    <View style={styles.field}>
      <Pressable
        accessibilityHint={accessibilityHint ?? accessibilityLabel}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        onPress={onPress}
        style={styles.checkboxRow}
      >
        <View style={[styles.checkbox, checked ? styles.checkboxChecked : undefined]}>
          {checked ? <Text style={styles.checkboxMark}>✓</Text> : null}
        </View>
        <View style={styles.checkboxLabel}>{label}</View>
      </Pressable>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

type ChoiceOption<TValue extends string | number> = {
  label: string;
  value: TValue;
};

type SelectionFieldProps = {
  label: string;
  value: string | null;
  placeholder: string;
  accessibilityHint?: string;
  onPress: () => void;
  error?: string | null;
};

export function SelectionField({
  label,
  value,
  placeholder,
  accessibilityHint,
  onPress,
  error,
}: SelectionFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityHint={accessibilityHint ?? (value || placeholder)}
        accessibilityLabel={label}
        accessibilityRole="button"
        onPress={onPress}
        style={[styles.selectionField, error ? styles.inputError : undefined]}
      >
        <Text style={value ? styles.selectionValue : styles.selectionPlaceholder}>
          {value || placeholder}
        </Text>
      </Pressable>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

type ChoiceChipsProps<TValue extends string | number> = {
  label: string;
  options: ChoiceOption<TValue>[];
  value: TValue | null;
  onChange: (value: TValue) => void;
  accessibilityHint?: string;
  error?: string | null;
};

export function ChoiceChips<TValue extends string | number>({
  label,
  options,
  value,
  onChange,
  accessibilityHint,
  error,
}: ChoiceChipsProps<TValue>) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chipWrap}>
        {options.map((option) => {
          const selected = option.value === value;

          return (
            <Pressable
              accessibilityHint={accessibilityHint ?? option.label}
              accessibilityLabel={`${label}: ${option.label}`}
              accessibilityRole="button"
              key={option.value}
              onPress={() => onChange(option.value)}
              style={[styles.chip, selected ? styles.chipSelected : undefined]}
            >
              <Text style={[styles.chipLabel, selected ? styles.chipLabelSelected : undefined]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

type PickerSheetProps<TValue extends string> = {
  title: string;
  options: ChoiceOption<TValue>[];
  selectedValue: TValue | null;
  onSelect: (value: TValue) => void;
  closeAccessibilityLabel?: string;
  onClose: () => void;
  visible: boolean;
};

export function PickerSheet<TValue extends string>({
  title,
  options,
  selectedValue,
  onSelect,
  closeAccessibilityLabel,
  onClose,
  visible,
}: PickerSheetProps<TValue>) {
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <Pressable
        accessibilityHint={closeAccessibilityLabel ?? title}
        accessibilityLabel={closeAccessibilityLabel ?? title}
        accessibilityRole="button"
        onPress={onClose}
        style={styles.sheetBackdrop}
      >
        <Pressable style={styles.sheetCard}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{title}</Text>
          {options.map((option) => {
            const selected = option.value === selectedValue;

            return (
              <Pressable
                accessibilityHint={option.label}
                accessibilityLabel={`${title}: ${option.label}`}
                accessibilityRole="button"
                key={option.value}
                onPress={() => {
                  onSelect(option.value);
                  onClose();
                }}
                style={[styles.sheetOption, selected ? styles.sheetOptionSelected : undefined]}
              >
                <Text
                  style={[
                    styles.sheetOptionLabel,
                    selected ? styles.sheetOptionLabelSelected : undefined,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const noticeStyles: Record<NoticeTone, object> = {
  info: {
    backgroundColor: '#eaf2fb',
    borderColor: '#bfd4ea',
  },
  success: {
    backgroundColor: '#ebf6ef',
    borderColor: '#b7d8c2',
  },
  error: {
    backgroundColor: '#fdeceb',
    borderColor: '#f1b9b6',
  },
};

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 16,
    backgroundColor: '#f7f0e6',
  },
  hero: {
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 18,
    backgroundColor: '#183153',
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#f4cf8c',
  },
  title: {
    marginTop: 8,
    fontSize: 28,
    lineHeight: 33,
    fontWeight: '800',
    color: '#fff8f0',
  },
  subtitle: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 22,
    color: '#dbe4ee',
  },
  card: {
    borderRadius: 20,
    padding: 18,
    backgroundColor: '#fffbf6',
    gap: 14,
    borderWidth: 1,
    borderColor: '#eee1d2',
    shadowColor: '#10233f',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 1,
  },
  footer: {
    gap: 12,
  },
  notice: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  noticeText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#2b4156',
  },
  field: {
    gap: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#28445d',
  },
  input: {
    minHeight: 50,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#d4dee9',
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: '#fffefe',
    fontSize: 16,
    color: '#183153',
  },
  inputMultiline: {
    minHeight: 112,
  },
  inputFocused: {
    borderColor: '#183153',
  },
  inputError: {
    borderColor: '#cc5f58',
  },
  selectionField: {
    minHeight: 50,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#d4dee9',
    paddingHorizontal: 14,
    paddingVertical: 13,
    justifyContent: 'center',
    backgroundColor: '#fffefe',
  },
  selectionValue: {
    fontSize: 16,
    color: '#183153',
  },
  selectionPlaceholder: {
    fontSize: 16,
    color: '#7a8ca3',
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#b44740',
  },
  button: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    paddingHorizontal: 16,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonPressed: {
    transform: [{ scale: 0.99 }],
  },
  primaryButton: {
    backgroundColor: '#183153',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#e3d2bf',
    backgroundColor: '#fffdf8',
    shadowColor: '#10233f',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 10,
    elevation: 1,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'center',
  },
  primaryButtonLabel: {
    color: '#fff9f1',
  },
  secondaryButtonLabel: {
    color: '#183153',
  },
  textLink: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    color: '#1d557f',
  },
  checkboxRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#93a5b8',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fffdf9',
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: '#183153',
    borderColor: '#183153',
  },
  checkboxMark: {
    color: '#fffdf9',
    fontSize: 14,
    fontWeight: '800',
  },
  checkboxLabel: {
    flex: 1,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#dfd1bf',
    backgroundColor: '#fffdf8',
  },
  chipSelected: {
    backgroundColor: '#183153',
    borderColor: '#183153',
  },
  chipLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#395065',
  },
  chipLabelSelected: {
    color: '#fff9f1',
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(24, 49, 83, 0.48)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 30,
    backgroundColor: '#fffbf6',
    gap: 8,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#d6c9b7',
    marginBottom: 2,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#183153',
    marginBottom: 8,
    textAlign: 'center',
  },
  sheetOption: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: '#fffdf9',
    borderWidth: 1,
    borderColor: '#e5d7c4',
  },
  sheetOptionSelected: {
    borderColor: '#183153',
    backgroundColor: '#eef4fa',
  },
  sheetOptionLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#183153',
  },
  sheetOptionLabelSelected: {
    color: '#183153',
  },
});
