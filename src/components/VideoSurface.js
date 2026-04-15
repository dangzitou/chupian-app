import { Platform, Pressable, Text, View, createElement } from 'react-native';

let NativeVideo = null;

try {
  const expoAv = require('expo-av');
  NativeVideo = expoAv?.Video || null;
} catch (_err) {
  NativeVideo = null;
}

export default function VideoSurface({ uri, style, shouldPlay = false, loop = false }) {
  if (!uri) return null;

  if (Platform.OS === 'web') {
    return createElement('video', {
      src: uri,
      style,
      controls: true,
      autoPlay: shouldPlay,
      loop,
      muted: shouldPlay,
      playsInline: true,
      preload: 'metadata',
      'aria-label': '出片视频',
    });
  }

  if (NativeVideo) {
    return (
      <NativeVideo
        source={{ uri }}
        style={style}
        useNativeControls
        resizeMode="cover"
        shouldPlay={shouldPlay}
        isLooping={loop}
      />
    );
  }

  return (
    <View style={[style, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#121212' }]}> 
      <Pressable onPress={() => {}} style={{ alignItems: 'center' }}>
        <Text style={{ color: '#fff', fontSize: 12 }}>视频暂不可播放</Text>
        <Text style={{ color: '#ddd', fontSize: 11, marginTop: 4 }}>请检查视频地址</Text>
      </Pressable>
    </View>
  );
}
