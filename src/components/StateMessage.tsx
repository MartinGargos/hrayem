import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

type StateMessageProps = {
  iconName: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
  action?: ReactNode;
  tone?: 'default' | 'warm' | 'muted';
  compact?: boolean;
};

export function StateMessage({
  iconName,
  title,
  body,
  action,
  tone = 'default',
  compact = false,
}: StateMessageProps) {
  return (
    <View
      style={[
        styles.wrap,
        compact ? styles.wrapCompact : undefined,
        tone === 'warm' ? styles.wrapWarm : undefined,
        tone === 'muted' ? styles.wrapMuted : undefined,
      ]}
    >
      <View
        style={[
          styles.iconWrap,
          tone === 'warm' ? styles.iconWrapWarm : undefined,
          tone === 'muted' ? styles.iconWrapMuted : undefined,
        ]}
      >
        <Ionicons
          color={tone === 'warm' ? '#a0603b' : tone === 'muted' ? '#6f7c8b' : '#183153'}
          name={iconName}
          size={compact ? 18 : 20}
        />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, compact ? styles.titleCompact : undefined]}>{title}</Text>
        <Text style={[styles.body, compact ? styles.bodyCompact : undefined]}>{body}</Text>
      </View>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: 12,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dde6f0',
    shadowColor: '#10233f',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 2,
  },
  wrapCompact: {
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  wrapWarm: {
    backgroundColor: '#f8fbff',
    borderColor: '#d8e3ef',
  },
  wrapMuted: {
    backgroundColor: '#f5f8fb',
    borderColor: '#dce5ef',
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef4fa',
  },
  iconWrapWarm: {
    backgroundColor: '#e9f2fb',
  },
  iconWrapMuted: {
    backgroundColor: '#eaf0f6',
  },
  copy: {
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    color: '#183153',
  },
  titleCompact: {
    fontSize: 16,
    textAlign: 'left',
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    color: '#5a6f84',
  },
  bodyCompact: {
    textAlign: 'left',
  },
  action: {
    alignSelf: 'stretch',
  },
});
