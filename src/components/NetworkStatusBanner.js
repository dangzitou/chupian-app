import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../config';
import { api } from '../api';

function getOnlineState() {
  if (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean') return true;
  return navigator.onLine;
}

export default function NetworkStatusBanner() {
  const [online, setOnline] = useState(true);
  const [checking, setChecking] = useState(false);

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

  const checkConnection = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    try {
      await api.health();
      setOnline(true);
    } catch (_err) {
      setOnline(false);
    } finally {
      setChecking(false);
    }
  }, [checking]);

  if (online) return null;

  return (
    <View
      style={styles.banner}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.copy}>
        <Text style={styles.title}>当前处于离线状态</Text>
        <Text style={styles.hint}>已加载内容仍可查看，联网后再试即可继续操作。</Text>
      </View>
      <Pressable
        style={[styles.retry, checking && styles.retryDisabled]}
        onPress={checkConnection}
        disabled={checking}
        accessibilityRole="button"
        accessibilityLabel="重新检查网络连接"
      >
        <Text style={styles.retryText}>{checking ? '检查中' : '重新检查'}</Text>
      </Pressable>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  copy: { flex: 1 },
  title: { color: COLORS.onAccent, fontSize: 12.5, fontWeight: '800' },
  hint: { color: '#e7e1dc', fontSize: 11, lineHeight: 16, marginTop: 2 },
  retry: {
    minHeight: 30,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  retryDisabled: { opacity: 0.55 },
  retryText: { color: COLORS.onAccent, fontSize: 11, fontWeight: '700' },
});
