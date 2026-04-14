import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet } from 'react-native';

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
      <Ionicons color="#183153" name="ellipsis-horizontal" size={20} />
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
  buttonPressed: {
    backgroundColor: '#efe4d5',
  },
});
