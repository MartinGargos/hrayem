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
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AppNotice, NoticeTone } from '../../types/app';

type AuthScaffoldProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  betweenHeroAndCard?: ReactNode;
  footer?: ReactNode;
};

export function AuthScaffold({
  title,
  subtitle,
  children,
  betweenHeroAndCard,
  footer,
}: AuthScaffoldProps) {
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}
    >
      <StatusBar style="dark" />
      <ScrollView
        bounces={false}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + 18,
            paddingBottom: Math.max(insets.bottom + 30, 44),
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={[styles.heroGridLine, styles.heroGridLineVertical]} />
          <View style={[styles.heroGridLine, styles.heroGridLineHorizontal]} />
          <Text style={styles.eyebrow}>HRAYEM</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>

        {betweenHeroAndCard ? (
          <View style={styles.betweenHeroAndCard}>{betweenHeroAndCard}</View>
        ) : null}
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
  leftIconName?: React.ComponentProps<typeof Ionicons>['name'];
  rightIconName?: React.ComponentProps<typeof Ionicons>['name'];
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
  leftIconName,
  rightIconName,
}: FormTextFieldProps) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View
        style={[
          styles.inputShell,
          multiline ? styles.inputMultiline : undefined,
          isFocused ? styles.inputFocused : undefined,
          error ? styles.inputError : undefined,
        ]}
      >
        {leftIconName ? (
          <Ionicons color={isFocused ? '#183153' : '#918a80'} name={leftIconName} size={19} />
        ) : null}
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
          placeholderTextColor="#8d96a1"
          secureTextEntry={secureTextEntry}
          selectionColor="#183153"
          style={[styles.input, multiline ? styles.inputTextMultiline : undefined]}
          textAlignVertical={multiline ? 'top' : 'center'}
          textContentType={textContentType}
          value={value}
        />
        {rightIconName ? <Ionicons color="#918a80" name={rightIconName} size={20} /> : null}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

type ActionButtonProps = {
  label: string;
  onPress: () => void | Promise<void>;
  accessibilityHint?: string;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'lime';
  iconName?: React.ComponentProps<typeof Ionicons>['name'];
  iconPosition?: 'left' | 'right';
};

export function ActionButton({
  label,
  onPress,
  accessibilityHint,
  disabled = false,
  variant = 'primary',
  iconName,
  iconPosition = 'left',
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
        variant === 'primary'
          ? styles.primaryButton
          : variant === 'lime'
            ? styles.limeButton
            : styles.secondaryButton,
        disabled ? styles.buttonDisabled : undefined,
        pressed && !disabled ? styles.buttonPressed : undefined,
      ]}
    >
      <View style={styles.buttonContent}>
        {iconName && iconPosition === 'left' ? (
          <Ionicons
            color={variant === 'primary' ? '#fff9f1' : '#183153'}
            name={iconName}
            size={16}
          />
        ) : null}
        <Text
          style={[
            styles.buttonLabel,
            variant === 'primary'
              ? styles.primaryButtonLabel
              : variant === 'lime'
                ? styles.limeButtonLabel
                : styles.secondaryButtonLabel,
          ]}
        >
          {label}
        </Text>
        {iconName && iconPosition === 'right' ? (
          <Ionicons
            color={variant === 'primary' ? '#fff9f1' : '#183153'}
            name={iconName}
            size={16}
          />
        ) : null}
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
        <Ionicons color="#918a80" name="location-outline" size={19} />
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
  if (!visible) {
    return null;
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible>
      <StatusBar style="dark" />
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
    backgroundColor: '#f7f0e6',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 18,
    backgroundColor: '#f7f0e6',
  },
  hero: {
    minHeight: 178,
    borderRadius: 30,
    paddingHorizontal: 22,
    paddingVertical: 24,
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#061427',
  },
  heroGridLine: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  heroGridLineVertical: {
    top: 0,
    bottom: 0,
    left: '58%',
    width: 1,
  },
  heroGridLineHorizontal: {
    left: 0,
    right: 0,
    top: '52%',
    height: 1,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: '#c8ff28',
  },
  title: {
    marginTop: 14,
    fontSize: 32,
    lineHeight: 37,
    fontWeight: '900',
    letterSpacing: -0.2,
    color: '#fff8f0',
  },
  subtitle: {
    marginTop: 12,
    fontSize: 16,
    lineHeight: 24,
    color: '#dbe4ee',
  },
  betweenHeroAndCard: {
    marginTop: 2,
  },
  card: {
    borderRadius: 28,
    padding: 20,
    backgroundColor: '#fffbf6',
    gap: 14,
    shadowColor: '#10233f',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 14,
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
    fontWeight: '900',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
    color: '#66707c',
  },
  inputShell: {
    minHeight: 60,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ded5c8',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#f3efe7',
  },
  input: {
    flex: 1,
    minHeight: 58,
    paddingVertical: 0,
    fontSize: 16,
    color: '#183153',
  },
  inputMultiline: {
    minHeight: 112,
    alignItems: 'flex-start',
    paddingTop: 12,
  },
  inputTextMultiline: {
    minHeight: 86,
    paddingTop: 2,
  },
  inputFocused: {
    borderColor: '#183153',
    backgroundColor: '#fffdf8',
  },
  inputError: {
    borderColor: '#cc5f58',
  },
  selectionField: {
    minHeight: 60,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ded5c8',
    paddingHorizontal: 16,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    justifyContent: 'center',
    backgroundColor: '#f3efe7',
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
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    paddingHorizontal: 16,
  },
  buttonDisabled: {
    opacity: 1,
    backgroundColor: '#d3d1cf',
    borderColor: '#d3d1cf',
  },
  buttonPressed: {
    transform: [{ scale: 0.99 }],
  },
  primaryButton: {
    backgroundColor: '#061427',
  },
  limeButton: {
    backgroundColor: '#c8ff28',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#dedbd7',
    backgroundColor: '#fffdf8',
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
  limeButtonLabel: {
    color: '#061427',
  },
  secondaryButtonLabel: {
    color: '#183153',
  },
  textLink: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    color: '#061427',
  },
  checkboxRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    borderRadius: 16,
    padding: 14,
    backgroundColor: '#f3efe7',
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
