import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../config';

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, resetVersion: 0 };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Keep the user-facing fallback calm while preserving a useful runtime log.
    console.error('[app-error-boundary]', error, info);
  }

  reset = () => {
    this.setState((current) => ({
      hasError: false,
      resetVersion: current.resetVersion + 1,
    }));
  };

  reloadWebApp = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.reload();
      return;
    }
    this.reset();
  };

  render() {
    if (!this.state.hasError) {
      return (
        <React.Fragment key={this.state.resetVersion}>
          {this.props.children}
        </React.Fragment>
      );
    }

    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <View style={styles.mark}>
            <Text style={styles.markText}>!</Text>
          </View>
          <Text style={styles.title}>页面暂时没加载好</Text>
          <Text style={styles.hint}>你的草稿和已发布内容不会丢失，重试即可继续。</Text>
          <Pressable
            style={styles.retry}
            onPress={this.reset}
            accessibilityRole="button"
            accessibilityLabel="重新加载页面"
          >
            <Text style={styles.retryText}>重新加载</Text>
          </Pressable>
          {Platform.OS === 'web' ? (
            <Pressable
              style={styles.reload}
              onPress={this.reloadWebApp}
              accessibilityRole="button"
              accessibilityLabel="刷新网页应用"
            >
              <Text style={styles.reloadText}>刷新页面</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: COLORS.bg,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 24,
    borderRadius: 18,
    backgroundColor: COLORS.card,
    shadowColor: '#1e1e1e',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  mark: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    backgroundColor: COLORS.accentBg,
  },
  markText: { color: COLORS.accent, fontSize: 19, fontWeight: '800' },
  title: { marginTop: 12, color: COLORS.ink, fontSize: 16, fontWeight: '800' },
  hint: { marginTop: 6, color: COLORS.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  retry: {
    marginTop: 16,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 9,
    backgroundColor: COLORS.accent,
  },
  retryText: { color: COLORS.onAccent, fontSize: 12.5, fontWeight: '800' },
  reload: { marginTop: 10, paddingHorizontal: 18, paddingVertical: 8 },
  reloadText: { color: COLORS.muted, fontSize: 12.5, fontWeight: '700' },
});
