import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SportBadge } from './EventPrimitives';

export type CreateEventSuccessSummary = {
  eventId: string;
  sportName: string;
  sportBadgeLabel: string;
  sportColorHex: string;
  venueName: string;
  dateLabel: string;
  timeLabel: string;
  playerCountLabel: string;
  reservationLabel: string | null;
};

export type CreateEventSuccessOverlayOrigin = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CreateEventSuccessOverlayProps = {
  visible: boolean;
  isActionPending: boolean;
  summary: CreateEventSuccessSummary | null;
  originFrame: CreateEventSuccessOverlayOrigin | null;
  originButtonLabel: string;
  title: string;
  subtitle: string;
  primaryActionLabel: string;
  secondaryActionLabel: string;
  closeLabel: string;
  onPrimaryAction: () => void;
  onSecondaryAction: () => void;
  onClose: () => void;
};

const floatingParticleConfigs: readonly FloatingParticleConfig[] = [
  {
    anchor: { top: 118, left: 64 },
    size: 7,
    color: '#d8ff45',
    deltaX: 8,
    deltaY: -10,
  },
  {
    anchor: { top: 118, right: 70 },
    size: 6,
    color: '#d8ff45',
    deltaX: -7,
    deltaY: -9,
  },
  {
    anchor: { top: 166, left: 38 },
    size: 5,
    color: '#6db8ff',
    deltaX: 6,
    deltaY: -8,
  },
  {
    anchor: { top: 194, right: 24 },
    size: 7,
    color: '#b6ff57',
    deltaX: -8,
    deltaY: -6,
  },
  {
    anchor: { top: 248, left: 46 },
    size: 6,
    color: '#6db8ff',
    deltaX: 5,
    deltaY: -9,
  },
  {
    anchor: { top: 274, right: 92 },
    size: 5,
    color: '#86d5ff',
    deltaX: -5,
    deltaY: -8,
  },
  {
    anchor: { top: 212, left: 18 },
    size: 5,
    color: '#cfff56',
    deltaX: 7,
    deltaY: -7,
  },
  {
    anchor: { top: 224, right: 72 },
    size: 4,
    color: '#d8ff45',
    deltaX: -4,
    deltaY: -8,
  },
] as const;

type FloatingParticleConfig = {
  anchor: {
    top: number;
    left?: number;
    right?: number;
  };
  size: number;
  color: string;
  deltaX: number;
  deltaY: number;
};

export function CreateEventSuccessOverlay({
  visible,
  isActionPending,
  summary,
  originFrame,
  originButtonLabel,
  title,
  subtitle,
  primaryActionLabel,
  closeLabel,
  onPrimaryAction,
  onClose,
}: CreateEventSuccessOverlayProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const orbOpacity = useRef(new Animated.Value(0)).current;
  const morphProgress = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0.6)).current;
  const checkOpacity = useRef(new Animated.Value(0)).current;
  const checkGlow = useRef(new Animated.Value(0)).current;
  const headingOpacity = useRef(new Animated.Value(0)).current;
  const headingTranslateY = useRef(new Animated.Value(18)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardTranslateY = useRef(new Animated.Value(28)).current;
  const actionsOpacity = useRef(new Animated.Value(0)).current;
  const actionsTranslateY = useRef(new Animated.Value(28)).current;
  const particleDrifts = useRef(floatingParticleConfigs.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const animationsToReset = [
      backdropOpacity,
      orbOpacity,
      morphProgress,
      checkScale,
      checkOpacity,
      checkGlow,
      headingOpacity,
      headingTranslateY,
      cardOpacity,
      cardTranslateY,
      actionsOpacity,
      actionsTranslateY,
      ...particleDrifts,
    ];

    animationsToReset.forEach((animation) => animation.stopAnimation());

    if (!visible) {
      backdropOpacity.setValue(0);
      orbOpacity.setValue(0);
      morphProgress.setValue(0);
      checkScale.setValue(0.6);
      checkOpacity.setValue(0);
      checkGlow.setValue(0);
      headingOpacity.setValue(0);
      headingTranslateY.setValue(18);
      cardOpacity.setValue(0);
      cardTranslateY.setValue(28);
      actionsOpacity.setValue(0);
      actionsTranslateY.setValue(28);
      particleDrifts.forEach((animation) => animation.setValue(0));
      return;
    }

    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(checkGlow, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(checkGlow, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    const particleLoops = particleDrifts.map((animation, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(animation, {
            toValue: 1,
            duration: 2600 + index * 180,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(animation, {
            toValue: 0,
            duration: 2600 + index * 180,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      ),
    );

    const hasOriginFrame = originFrame !== null && originFrame.width > 0 && originFrame.height > 0;

    const entrance = Animated.sequence([
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: hasOriginFrame ? 360 : 220,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(orbOpacity, {
          toValue: 1,
          duration: hasOriginFrame ? 440 : 320,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(morphProgress, {
          toValue: 1,
          duration: hasOriginFrame ? 620 : 1,
          easing: hasOriginFrame ? Easing.bezier(0.18, 0.82, 0.24, 1) : Easing.linear,
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(hasOriginFrame ? 36 : 0),
      Animated.parallel([
        Animated.timing(checkOpacity, {
          toValue: 1,
          duration: 170,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(checkScale, {
          toValue: 1,
          damping: 16,
          stiffness: 200,
          mass: 0.92,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(headingOpacity, {
          toValue: 1,
          duration: 180,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(headingTranslateY, {
          toValue: 0,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(cardOpacity, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(cardTranslateY, {
          toValue: 0,
          duration: 260,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(actionsOpacity, {
          toValue: 1,
          duration: 180,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(actionsTranslateY, {
          toValue: 0,
          duration: 220,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ]);

    glowLoop.start();
    particleLoops.forEach((loop) => loop.start());
    entrance.start();

    return () => {
      entrance.stop();
      glowLoop.stop();
      particleLoops.forEach((loop) => loop.stop());
    };
  }, [
    actionsOpacity,
    actionsTranslateY,
    backdropOpacity,
    cardOpacity,
    cardTranslateY,
    checkGlow,
    checkOpacity,
    checkScale,
    headingOpacity,
    headingTranslateY,
    morphProgress,
    orbOpacity,
    originFrame,
    particleDrifts,
    visible,
    windowHeight,
    windowWidth,
  ]);

  if (!visible || !summary) {
    return null;
  }

  const glowScale = checkGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.13],
  });
  const glowOpacity = checkGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.26, 0.46],
  });
  const waveScale = checkGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.05],
  });
  const waveOpacity = checkGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.08, 0.16],
  });
  const hasOriginFrame = originFrame !== null && originFrame.width > 0 && originFrame.height > 0;
  const originCenterX = hasOriginFrame ? originFrame.x + originFrame.width / 2 : 0;
  const originCenterY = hasOriginFrame ? originFrame.y + originFrame.height / 2 : 0;
  const targetCenterX = windowWidth / 2;
  const targetCenterY = windowHeight / 2;
  const morphTranslateX = morphProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, targetCenterX - originCenterX],
  });
  const morphTranslateY = morphProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, targetCenterY - originCenterY],
  });
  const morphScaleX = morphProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, hasOriginFrame ? (windowWidth + 180) / originFrame.width : 1],
  });
  const morphScaleY = morphProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, hasOriginFrame ? (windowHeight + 260) / originFrame.height : 1],
  });
  const morphSurfaceOpacity = morphProgress.interpolate({
    inputRange: [0, 0.06, 0.24, 1],
    outputRange: [0, 0.72, 0.96, 1],
  });
  const morphButtonOpacity = morphProgress.interpolate({
    inputRange: [0, 0.28, 0.56, 0.8, 1],
    outputRange: [1, 1, 0.68, 0.1, 0],
  });
  const morphButtonScale = morphProgress.interpolate({
    inputRange: [0, 0.22, 0.6, 1],
    outputRange: [1, 1.018, 1.05, 1.085],
  });
  const morphButtonTranslateY = morphProgress.interpolate({
    inputRange: [0, 0.3, 0.68, 1],
    outputRange: [0, -6, -34, -54],
  });

  return (
    <View pointerEvents="auto" style={styles.overlayRoot}>
      <Animated.View style={[styles.backdropLayer, { opacity: backdropOpacity }]}>
        <View style={styles.backdropBase} />
        <View style={styles.backdropVignette} />
      </Animated.View>

      {hasOriginFrame ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.morphSurface,
            {
              left: originFrame.x,
              opacity: morphSurfaceOpacity,
              top: originFrame.y,
              width: originFrame.width,
              height: originFrame.height,
              transform: [
                { translateX: morphTranslateX },
                { translateY: morphTranslateY },
                { scaleX: morphScaleX },
                { scaleY: morphScaleY },
              ],
            },
          ]}
        />
      ) : null}

      {floatingParticleConfigs.map((particle, index) => {
        const drift = particleDrifts[index];
        const particleAnchorStyle: ViewStyle = {
          top: particle.anchor.top,
          left: particle.anchor.left,
          right: particle.anchor.right,
        };

        return (
          <Animated.View
            key={`${particle.color}-${index}`}
            style={[
              styles.particle,
              particleAnchorStyle,
              {
                width: particle.size,
                height: particle.size,
                borderRadius: particle.size / 2,
                backgroundColor: particle.color,
                opacity: drift.interpolate({
                  inputRange: [0, 0.5, 1],
                  outputRange: [0.22, 0.54, 0.24],
                }),
                transform: [
                  {
                    translateX: drift.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, particle.deltaX],
                    }),
                  },
                  {
                    translateY: drift.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, particle.deltaY],
                    }),
                  },
                  {
                    scale: drift.interpolate({
                      inputRange: [0, 0.5, 1],
                      outputRange: [0.94, 1.08, 0.96],
                    }),
                  },
                ],
              },
            ]}
          />
        );
      })}

      <View
        style={[
          styles.safeAreaFrame,
          {
            paddingTop: insets.top + 10,
            paddingBottom: Math.max(insets.bottom, 18) + 18,
          },
        ]}
      >
        <View style={styles.topActionsRow}>
          <View style={styles.topActionsSpacer} />
          <Pressable
            accessibilityLabel={closeLabel}
            accessibilityRole="button"
            disabled={isActionPending}
            onPress={onClose}
            style={[styles.closeButton, isActionPending ? styles.disabledAction : undefined]}
          >
            <Ionicons color="#f5f8ff" name="close" size={18} />
          </Pressable>
        </View>

        <View style={styles.contentStack}>
          <View style={styles.heroStack}>
            <Animated.View
              style={[
                styles.checkSection,
                {
                  opacity: checkOpacity,
                  transform: [{ scale: checkScale }],
                },
              ]}
            >
              <Animated.View style={[styles.checkAmbientGlow, { opacity: orbOpacity }]} />
              <Animated.View
                style={[
                  styles.checkBloomGlow,
                  {
                    opacity: glowOpacity,
                    transform: [{ scale: glowScale }],
                  },
                ]}
              />
              <View style={styles.checkOuterRing} />
              <Animated.View
                style={[
                  styles.checkMiddleRing,
                  {
                    opacity: waveOpacity,
                    transform: [{ scale: waveScale }],
                  },
                ]}
              />
              <Animated.View
                style={[
                  styles.checkGlow,
                  {
                    opacity: glowOpacity,
                    transform: [{ scale: glowScale }],
                  },
                ]}
              />
              <View style={styles.checkInnerRing} />
              <View style={styles.checkCore}>
                <Text style={styles.checkmarkGlyph}>✓</Text>
              </View>
            </Animated.View>

            <Animated.View
              style={[
                styles.heroCopy,
                {
                  opacity: headingOpacity,
                  transform: [{ translateY: headingTranslateY }],
                },
              ]}
            >
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle}>{subtitle}</Text>
            </Animated.View>
          </View>

          <Animated.View
            style={[
              styles.summaryCardStack,
              {
                opacity: cardOpacity,
                transform: [{ translateY: cardTranslateY }],
              },
            ]}
          >
            <View style={[styles.summaryShadowLayer, styles.summaryShadowLayerFar]} />
            <View style={[styles.summaryShadowLayer, styles.summaryShadowLayerNear]} />
            <View style={styles.summaryCard}>
              <View style={styles.summaryHeader}>
                <View style={styles.summaryIdentity}>
                  <SportBadge colorHex={summary.sportColorHex} label={summary.sportBadgeLabel} />
                  <Text numberOfLines={2} style={styles.summaryTitle}>
                    {summary.sportName} • {summary.venueName}
                  </Text>
                </View>
              </View>

              <View style={styles.metaRow}>
                <View style={styles.metaItem}>
                  <Ionicons color="#9cb0c7" name="calendar-clear-outline" size={16} />
                  <Text numberOfLines={1} style={styles.metaLabel}>
                    {summary.dateLabel}
                  </Text>
                </View>
                <View style={styles.metaItem}>
                  <Ionicons color="#9cb0c7" name="time-outline" size={16} />
                  <Text numberOfLines={1} style={styles.metaLabel}>
                    {summary.timeLabel}
                  </Text>
                </View>
              </View>

              <View style={styles.summaryDivider} />

              <View style={styles.summaryBottomStat}>
                <Ionicons color="#d8ff45" name="people" size={24} />
                <Text style={styles.summaryBottomStatLabel}>{summary.playerCountLabel}</Text>
              </View>
            </View>
          </Animated.View>

          <Animated.View
            style={[
              styles.actionStack,
              {
                opacity: actionsOpacity,
                transform: [{ translateY: actionsTranslateY }],
              },
            ]}
          >
            <Pressable
              accessibilityLabel={primaryActionLabel}
              accessibilityRole="button"
              disabled={isActionPending}
              onPress={onPrimaryAction}
              style={[styles.primaryButton, isActionPending ? styles.disabledAction : undefined]}
            >
              <Text style={styles.primaryButtonLabel}>{primaryActionLabel}</Text>
              <Ionicons color="#10233f" name="arrow-forward" size={18} />
            </Pressable>
          </Animated.View>
        </View>
      </View>

      {hasOriginFrame ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.morphButtonClone,
            {
              left: originFrame.x,
              opacity: morphButtonOpacity,
              top: originFrame.y,
              width: originFrame.width,
              height: originFrame.height,
              transform: [{ translateY: morphButtonTranslateY }, { scale: morphButtonScale }],
            },
          ]}
        >
          <Text style={styles.morphButtonCloneLabel}>{originButtonLabel}</Text>
          <Ionicons color="#10233f" name="arrow-forward" size={18} />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 60,
  },
  backdropLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  backdropBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#081528',
  },
  backdropVignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(4, 10, 20, 0.16)',
  },
  morphSurface: {
    position: 'absolute',
    borderRadius: 18,
    backgroundColor: '#081528',
    shadowColor: '#071526',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.32,
    shadowRadius: 28,
    elevation: 18,
  },
  morphButtonClone: {
    position: 'absolute',
    borderRadius: 18,
    backgroundColor: '#d8ff45',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#d8ff45',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 14,
  },
  morphButtonCloneLabel: {
    fontSize: 18,
    fontWeight: '900',
    color: '#10233f',
  },
  particle: {
    position: 'absolute',
  },
  safeAreaFrame: {
    flex: 1,
    paddingHorizontal: 24,
  },
  topActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  topActionsSpacer: {
    width: 56,
    height: 56,
  },
  closeButton: {
    width: 56,
    height: 56,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.09)',
  },
  contentStack: {
    flex: 1,
    alignItems: 'stretch',
    justifyContent: 'center',
    gap: 26,
    paddingTop: 22,
    paddingBottom: 10,
    transform: [{ translateY: -18 }],
  },
  heroStack: {
    alignItems: 'center',
    gap: 20,
  },
  heroCopy: {
    alignItems: 'center',
    gap: 0,
  },
  checkSection: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    width: 244,
    height: 244,
  },
  checkAmbientGlow: {
    position: 'absolute',
    width: 184,
    height: 184,
    borderRadius: 999,
    backgroundColor: 'rgba(173, 255, 76, 0.12)',
  },
  checkBloomGlow: {
    position: 'absolute',
    width: 238,
    height: 238,
    borderRadius: 999,
    backgroundColor: 'rgba(194, 255, 92, 0.08)',
    shadowColor: '#d8ff45',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 46,
  },
  checkOuterRing: {
    position: 'absolute',
    width: 214,
    height: 214,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(194, 255, 92, 0.16)',
  },
  checkMiddleRing: {
    position: 'absolute',
    width: 166,
    height: 166,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(197, 255, 97, 0.14)',
  },
  checkGlow: {
    position: 'absolute',
    width: 196,
    height: 196,
    borderRadius: 999,
    backgroundColor: 'rgba(208, 255, 76, 0.11)',
    shadowColor: '#d8ff45',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 54,
  },
  checkInnerRing: {
    position: 'absolute',
    width: 128,
    height: 128,
    borderRadius: 999,
    borderWidth: 3,
    borderColor: '#e1ff55',
    shadowColor: '#d8ff45',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.26,
    shadowRadius: 18,
  },
  checkCore: {
    width: 120,
    height: 120,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(13, 28, 49, 0.78)',
  },
  checkmarkGlyph: {
    fontSize: 70,
    lineHeight: 70,
    fontWeight: '800',
    color: '#e7ff56',
    textAlign: 'center',
    marginTop: -2,
  },
  title: {
    fontSize: 36,
    lineHeight: 41,
    fontWeight: '900',
    color: '#ffffff',
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 6,
    fontSize: 16,
    lineHeight: 25,
    color: 'rgba(227, 236, 247, 0.76)',
    textAlign: 'center',
    paddingHorizontal: 36,
  },
  summaryCardStack: {
    width: '100%',
    paddingHorizontal: 8,
    paddingBottom: 24,
  },
  summaryShadowLayer: {
    position: 'absolute',
    left: 24,
    right: 24,
    borderRadius: 28,
    backgroundColor: 'rgba(23, 41, 69, 0.56)',
    borderWidth: 1,
    borderColor: 'rgba(129, 153, 182, 0.06)',
  },
  summaryShadowLayerNear: {
    top: 14,
    bottom: 8,
    opacity: 0.72,
  },
  summaryShadowLayerFar: {
    top: 28,
    bottom: 0,
    left: 42,
    right: 42,
    opacity: 0.42,
  },
  summaryCard: {
    borderRadius: 28,
    paddingHorizontal: 22,
    paddingVertical: 24,
    backgroundColor: 'rgba(14, 33, 60, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(140, 163, 189, 0.2)',
    gap: 16,
    shadowColor: '#091728',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 8,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  summaryIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
  },
  summaryTitle: {
    flex: 1,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
    color: '#ffffff',
  },
  metaRow: {
    gap: 8,
    paddingLeft: 56,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  metaLabel: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: '#c2d1e3',
  },
  summaryDivider: {
    height: 1,
    backgroundColor: 'rgba(144, 165, 191, 0.16)',
  },
  summaryBottomStat: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  summaryBottomStatLabel: {
    fontSize: 18,
    fontWeight: '900',
    color: '#d8ff45',
  },
  actionStack: {
    gap: 10,
    paddingHorizontal: 14,
  },
  primaryButton: {
    minHeight: 64,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#d8ff45',
    shadowColor: '#d8ff45',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.42,
    shadowRadius: 20,
    elevation: 14,
  },
  primaryButtonLabel: {
    fontSize: 20,
    fontWeight: '900',
    color: '#10233f',
  },
  secondaryButton: {
    minHeight: 34,
    borderRadius: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  secondaryButtonLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: 'rgba(242, 247, 255, 0.82)',
  },
  disabledAction: {
    opacity: 0.6,
  },
});
