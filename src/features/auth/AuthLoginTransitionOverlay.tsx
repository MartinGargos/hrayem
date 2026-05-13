import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

type AuthLoginTransitionOverlayProps = {
  visible: boolean;
  onFinished: () => void;
};

export function AuthLoginTransitionOverlay({
  visible,
  onFinished,
}: AuthLoginTransitionOverlayProps) {
  const { width, height } = useWindowDimensions();
  const formOpacity = useRef(new Animated.Value(0)).current;
  const heroProgress = useRef(new Animated.Value(0)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.5)).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const sweepTranslateY = useRef(new Animated.Value(-height * 0.35)).current;

  useEffect(() => {
    if (!visible) {
      formOpacity.setValue(0);
      heroProgress.setValue(0);
      logoOpacity.setValue(0);
      logoScale.setValue(0.5);
      overlayOpacity.setValue(1);
      sweepTranslateY.setValue(-height * 0.35);
      return;
    }

    const animation = Animated.sequence([
      Animated.timing(formOpacity, {
        toValue: 1,
        duration: 200,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(heroProgress, {
        toValue: 1,
        duration: 400,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 300,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(logoScale, {
          toValue: 1,
          duration: 300,
          easing: Easing.out(Easing.back(1.1)),
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(200),
      Animated.parallel([
        Animated.timing(sweepTranslateY, {
          toValue: height,
          duration: 500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 500,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ]);

    animation.start(({ finished }) => {
      if (finished) {
        onFinished();
      }
    });

    return () => {
      animation.stop();
    };
  }, [
    formOpacity,
    height,
    heroProgress,
    logoOpacity,
    logoScale,
    onFinished,
    overlayOpacity,
    sweepTranslateY,
    visible,
  ]);

  if (!visible) {
    return null;
  }

  const heroWidth = heroProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [width - 40, width],
  });
  const heroHeight = heroProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [178, height],
  });
  const heroTop = heroProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [92, 0],
  });
  const heroLeft = heroProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [20, 0],
  });
  const heroRadius = heroProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [30, 0],
  });

  return (
    <Animated.View pointerEvents="auto" style={[styles.overlay, { opacity: overlayOpacity }]}>
      <StatusBar style="light" />
      <Animated.View style={[styles.formGhost, { opacity: formOpacity }]} />
      <Animated.View
        style={[
          styles.hero,
          {
            width: heroWidth,
            height: heroHeight,
            top: heroTop,
            left: heroLeft,
            borderRadius: heroRadius,
          },
        ]}
      >
        <View style={[styles.gridLine, styles.gridLineVertical]} />
        <View style={[styles.gridLine, styles.gridLineHorizontal]} />
      </Animated.View>
      <Animated.View
        style={[
          styles.logoMark,
          {
            opacity: logoOpacity,
            transform: [{ scale: logoScale }],
          },
        ]}
      >
        <Text style={styles.logoText}>H/</Text>
      </Animated.View>
      <Animated.View
        style={[
          styles.sweep,
          {
            transform: [{ translateY: sweepTranslateY }, { rotate: '-3deg' }],
          },
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
  },
  formGhost: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#f7f0e6',
  },
  hero: {
    position: 'absolute',
    overflow: 'hidden',
    backgroundColor: '#061427',
  },
  gridLine: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  gridLineVertical: {
    top: 0,
    bottom: 0,
    left: '58%',
    width: 1,
  },
  gridLineHorizontal: {
    left: 0,
    right: 0,
    top: '52%',
    height: 1,
  },
  logoMark: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 92,
    height: 92,
    marginTop: -46,
    marginLeft: -46,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#061427',
    shadowColor: '#c8ff28',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 34,
    elevation: 3,
  },
  logoText: {
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '900',
    color: '#c8ff28',
  },
  sweep: {
    position: 'absolute',
    left: -40,
    right: -40,
    height: 180,
    backgroundColor: '#c8ff28',
    opacity: 0.72,
  },
});
