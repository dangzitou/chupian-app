import { Pressable, Text, View } from 'react-native';

let NativeVideo = null;

try {
  const expoAv = require('expo-av');
  NativeVideo = expoAv?.Video || null;
} catch (_err) {
  NativeVideo = null;
}

export default function VideoSurface({ uri, style, shouldPlay = false, loop = false }) {
  if (!uri) return null;

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
        <Text style={{ color: '#fff', fontSize: 12 }}>🎬 视频文件</Text>
        <Text style={{ color: '#ddd', fontSize: 11, marginTop: 4 }}>打开 App 后可播放</Text>
      </Pressable>
    </View>
  );
}
