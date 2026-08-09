import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../config';

export default function RemoteImage({
  uri,
  style,
  imageStyle,
  fallback = '暂无封面',
  accessibilityLabel = '图片',
  resizeMode = 'cover',
  onLoad,
  onError,
}) {
  const normalizedUri = String(uri || '').trim();
  const [status, setStatus] = useState(normalizedUri ? 'loading' : 'failed');

  useEffect(() => {
    setStatus(normalizedUri ? 'loading' : 'failed');
  }, [normalizedUri]);

  const handleLoad = (event) => {
    setStatus('loaded');
    onLoad?.(event);
  };

  const handleError = (event) => {
    setStatus('failed');
    onError?.(event);
  };

  return (
    <View
      style={[styles.container, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.fallback} pointerEvents="none">
        <Text style={styles.fallbackText} numberOfLines={2}>{fallback}</Text>
      </View>
      {normalizedUri && status !== 'failed' ? (
        <Image
          source={{ uri: normalizedUri }}
          style={[StyleSheet.absoluteFillObject, imageStyle]}
          resizeMode={resizeMode}
          onLoadStart={() => setStatus('loading')}
          onLoad={handleLoad}
          onError={handleError}
          accessibilityIgnoresInvertColors
        />
      ) : null}
      {normalizedUri && status === 'loading' ? (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator size="small" color={COLORS.accent} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: COLORS.accentBg,
  },
  fallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  fallbackText: {
    color: COLORS.muted,
    fontSize: 11,
    textAlign: 'center',
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(246,241,236,0.72)',
  },
});
