import React from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { API_BASE } from '../config';

// 地图页：内嵌网页版 Leaflet 地图（含机位/筛选/详情/社区全功能）
export default function MapScreen() {
  return (
    <View style={styles.container}>
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
  webview: { flex: 1 },
});
