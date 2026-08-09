import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../config';
import { api } from '../api';

function getOnlineState() {
  if (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean') return true;
  return navigator.onLine;
}

export default function NetworkStatusBanner() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = api.subscribeNetworkStatus(setOnline);
    if (Platform.OS !== 'web' || typeof window === 'undefined') return unsubscribe;

    const update = () => setOnline(getOnlineState());
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      unsubscribe();
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (online) return null;

  return (
    <View
      style={styles.banner}
      pointerEvents="none"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Text style={styles.title}>当前处于离线状态</Text>
      <Text style={styles.hint}>已加载内容仍可查看，联网后再试即可继续操作。</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 10,
    left: 12,
    right: 12,
    zIndex: 100,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 13,
    backgroundColor: '#2e2b29',
    shadowColor: '#1c1c1c',
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  title: { color: COLORS.onAccent, fontSize: 12.5, fontWeight: '800' },
  hint: { color: '#e7e1dc', fontSize: 11, lineHeight: 16, marginTop: 2 },
});
