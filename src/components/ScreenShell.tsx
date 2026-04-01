import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

type ScreenShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
};

export function ScreenShell({ title, subtitle, children }: ScreenShellProps) {
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.hero}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      {children}
    </ScrollView>
  );
}

type ScreenCardProps = {
  title?: string;
  children: ReactNode;
};

export function ScreenCard({ title, children }: ScreenCardProps) {
  return (
    <View style={styles.card}>
      {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

type SegmentedOption<TValue extends string> = {
  label: string;
  value: TValue;
};

type SegmentedTabsProps<TValue extends string> = {
  options: SegmentedOption<TValue>[];
  value: TValue;
  onChange: (value: TValue) => void;
};

export function SegmentedTabs<TValue extends string>({
  options,
  value,
  onChange,
}: SegmentedTabsProps<TValue>) {
  return (
    <View style={styles.segmentedWrap}>
      {options.map((option) => {
        const isActive = option.value === value;

        return (
          <Pressable
            accessibilityHint={option.label}
            accessibilityLabel={option.label}
            accessibilityRole="button"
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.segment, isActive ? styles.segmentActive : undefined]}
          >
            <Text style={[styles.segmentLabel, isActive ? styles.segmentLabelActive : undefined]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

type DetailRowProps = {
  label: string;
  value: string;
};

export function DetailRow({ label, value }: DetailRowProps) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 16,
  },
  hero: {
    borderRadius: 28,
    padding: 22,
    backgroundColor: '#183153',
  },
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    color: '#fff8f0',
  },
  subtitle: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 24,
    color: '#d2dde8',
  },
  card: {
    borderRadius: 22,
    padding: 18,
    backgroundColor: '#fffaf3',
    borderWidth: 1,
    borderColor: '#eadfce',
    gap: 12,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#183153',
  },
  segmentedWrap: {
    flexDirection: 'row',
    borderRadius: 18,
    padding: 4,
    backgroundColor: '#f0e6d8',
    gap: 4,
  },
  segment: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  segmentActive: {
    backgroundColor: '#183153',
  },
  segmentLabel: {
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '700',
    color: '#5a6475',
  },
  segmentLabelActive: {
    color: '#fff8f0',
  },
  detailRow: {
    gap: 4,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: '#a0603b',
  },
  detailValue: {
    fontSize: 15,
    lineHeight: 22,
    color: '#395065',
  },
});
