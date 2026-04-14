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
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 14,
  },
  hero: {
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 18,
    backgroundColor: '#183153',
  },
  title: {
    fontSize: 26,
    lineHeight: 31,
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
    padding: 16,
    backgroundColor: '#fffbf6',
    borderWidth: 1,
    borderColor: '#eee1d2',
    gap: 10,
    shadowColor: '#10233f',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 1,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#183153',
  },
  segmentedWrap: {
    flexDirection: 'row',
    borderRadius: 16,
    padding: 3,
    backgroundColor: '#f1e6d7',
    gap: 3,
  },
  segment: {
    flex: 1,
    borderRadius: 13,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  segmentActive: {
    backgroundColor: '#183153',
  },
  segmentLabel: {
    textAlign: 'center',
    fontSize: 13,
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
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#aa6d44',
  },
  detailValue: {
    fontSize: 15,
    lineHeight: 21,
    color: '#395065',
  },
});
