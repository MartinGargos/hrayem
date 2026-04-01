import { Pressable, StyleSheet, Text } from 'react-native';

type HeaderOverflowButtonProps = {
  accessibilityHint: string;
  accessibilityLabel: string;
  onPress: () => void;
};

export function HeaderOverflowButton({
  accessibilityHint,
  accessibilityLabel,
  onPress,
}: HeaderOverflowButtonProps) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed ? styles.buttonPressed : undefined]}
    >
      <Text style={styles.buttonLabel}>⋯</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  buttonLabel: {
    fontSize: 28,
    lineHeight: 28,
    color: '#183153',
    marginTop: -6,
  },
  buttonPressed: {
    backgroundColor: '#efe4d5',
  },
});
