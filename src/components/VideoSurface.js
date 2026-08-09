import { Platform, Pressable, Text, View, createElement } from 'react-native';

let NativeVideo = null;

try {
  const expoAv = require('expo-av');
  NativeVideo = expoAv?.Video || null;
} catch (_err) {
  NativeVideo = null;
}

export default function VideoSurface({ uri, style, shouldPlay = false, loop = false, controls = true, poster, onError, muted = false }) {
  if (!uri) return null;

  if (Platform.OS === 'web') {
    return createElement('video', {
      src: uri,
      style,
      controls,
      autoPlay: shouldPlay,
      loop,
      muted,
      playsInline: true,
      preload: 'metadata',
      poster: poster || undefined,
      onError,
      'aria-label': '出片视频',
    });
  }

  if (NativeVideo) {
    return (
      <NativeVideo
        source={{ uri }}
        style={style}
        useNativeControls={controls}
        resizeMode="cover"
        shouldPlay={shouldPlay}
        isLooping={loop}
        isMuted={muted}
        onError={onError}
      />
    );
  }

  return (
    <View style={[style, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#121212' }]}> 
      <Pressable
        onPress={() => onError?.(new Error('视频播放组件不可用'))}
        style={{ alignItems: 'center' }}
        accessibilityRole="button"
        accessibilityLabel="重试播放视频"
      >
        <Text style={{ color: '#fff', fontSize: 12 }}>视频暂不可播放</Text>
        <Text style={{ color: '#ddd', fontSize: 11, marginTop: 4 }}>点击重试</Text>
      </Pressable>
    </View>
  );
}
