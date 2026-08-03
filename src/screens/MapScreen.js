import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { API_BASE, COLORS } from '../config';

// 地图页：内嵌网页版 Leaflet 地图（含机位/筛选/详情/社区全功能）
export default function MapScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.hintWrap}>
        <Text style={styles.hint}>高质量地图体验建议接入专用 Web 地图端，当前嵌入为可快速上线版本。</Text>
      </View>
      <WebView
        source={{ uri: `${API_BASE}/` }}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        allowsInlineMediaPlayback
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4efe7' },
  hintWrap: {
    backgroundColor: COLORS.accentBg,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  hint: {
    color: COLORS.accent,
    fontSize: 11.5,
  },
  webview: { flex: 1 },
});
