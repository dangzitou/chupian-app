import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, Pressable, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api';
import { COLORS } from '../config';

const field = (label, placeholder, state, setState, opts = {}) => (
  <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput
      style={[styles.input, opts.multiline && styles.multiline]}
      placeholder={placeholder}
      placeholderTextColor={COLORS.muted}
      value={state}
      onChangeText={setState}
      {...opts}
    />
  </View>
);

export default function NewPostScreen({ navigation }) {
  const [spots, setSpots] = useState([]);
  const [loadingSpots, setLoadingSpots] = useState(true);
  const [title, setTitle] = useState('');
  const [spotId, setSpotId] = useState('');
  const [content, setContent] = useState('');
  const [cover, setCover] = useState('');
  const [camera, setCamera] = useState('');
  const [lens, setLens] = useState('');
  const [focal, setFocal] = useState('');
  const [aperture, setAperture] = useState('');
  const [shutter, setShutter] = useState('');
  const [iso, setIso] = useState('');
  const [angle, setAngle] = useState('');
  const [timeWindow, setTimeWindow] = useState('');
  const [styles, setStyles] = useState('');
  const [tags, setTags] = useState('');
  const [author, setAuthor] = useState('');
  const [authorBio, setAuthorBio] = useState('');
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const d = await api.spots();
        setSpots(d.spots || []);
      } catch (e) { /* ignore */ } finally {
        setLoadingSpots(false);
      }
    })();
  }, []);

  const publish = async () => {
    if (!title.trim()) return Alert.alert('提示', '标题不能为空');
    setPublishing(true);
    try {
      const spot = spots.find((s) => s.id === spotId);
      const res = await api.createPost({
        title: title.trim(),
        spotId,
        district: spot?.district || '',
        content: content.trim(),
        cover: cover.trim(),
        gear: { camera: camera.trim(), lens: lens.trim(), focal: focal.trim(), aperture: aperture.trim(), shutter: shutter.trim(), iso: iso.trim() },
        angle: angle.trim(),
        timeWindow: timeWindow.trim(),
        bestTime: spot?.bestTime || 'day',
        styles: styles.split(/[,，/|]/).map((x) => x.trim()).filter(Boolean),
        tags: tags.split(/[,，/|#]/).map((x) => x.trim()).filter(Boolean),
        author: author.trim() || '匿名拍友',
        authorBio: authorBio.trim(),
      });
      Alert.alert('发布成功', '攻略已发布！', [
        { text: '好的', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert('发布失败', e.message);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>发攻略</Text>
        <Text style={styles.subtitle}>分享机位、设备与参数，帮更多人出片</Text>

        {field('标题 *', '例如：大佛寺夜拍全攻略', title, setTitle, { maxLength: 80 })}

        <View style={styles.field}>
          <Text style={styles.label}>关联点位</Text>
          {loadingSpots ? (
            <ActivityIndicator color={COLORS.accent} style={{ alignSelf: 'flex-start' }} />
          ) : (
            <View style={styles.spotWrap}>
              {spots.map((s) => (
                <Pressable
                  key={s.id}
                  style={[styles.spotChip, spotId === s.id && styles.spotChipActive]}
                  onPress={() => setSpotId(s.id)}
                >
                  <Text style={[styles.spotChipText, spotId === s.id && styles.spotChipTextActive]}>{s.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {field('正文', '怎么拍、拍什么、注意事项…', content, setContent, { multiline: true, maxLength: 3000 })}
        {field('封面图 URL（可选）', 'https://...', cover, setCover)}

        <Text style={styles.section}>设备与参数</Text>
        <View style={styles.row2}>
          <View style={{ flex: 1 }}>{field('机身', 'Sony A7M4', camera, setCamera, { maxLength: 60 })}</View>
          <View style={{ flex: 1 }}>{field('镜头', '24-70mm F2.8', lens, setLens, { maxLength: 60 })}</View>
        </View>
        <View style={styles.row2}>
          <View style={{ flex: 1 }}>{field('焦距', '35mm', focal, setFocal, { maxLength: 30 })}</View>
          <View style={{ flex: 1 }}>{field('光圈', 'f/4', aperture, setAperture, { maxLength: 20 })}</View>
        </View>
        <View style={styles.row2}>
          <View style={{ flex: 1 }}>{field('快门', '1/15s', shutter, setShutter, { maxLength: 20 })}</View>
          <View style={{ flex: 1 }}>{field('ISO', '800', iso, setIso, { maxLength: 20 })}</View>
        </View>

        <Text style={styles.section}>机位信息</Text>
        <View style={styles.row2}>
          <View style={{ flex: 1 }}>{field('角度', '正面低机位略仰5°', angle, setAngle, { maxLength: 80 })}</View>
          <View style={{ flex: 1 }}>{field('时间窗口', '19:00-20:30', timeWindow, setTimeWindow, { maxLength: 40 })}</View>
        </View>
        {field('风格（逗号分隔）', '城市夜景, 建筑几何', styles, setStyles)}
        {field('标签（逗号分隔）', '夜景, 蓝调, 寺庙', tags, setTags)}

        <Text style={styles.section}>博主</Text>
        {field('昵称', '匿名拍友', author, setAuthor, { maxLength: 32 })}
        {field('博主简介（可选）', '广州夜景摄影师', authorBio, setAuthorBio, { maxLength: 100 })}

        <Pressable
          style={[styles.publishBtn, publishing && styles.publishBtnDisabled]}
          onPress={publish}
          disabled={publishing}
        >
          {publishing ? <ActivityIndicator color="#fff" /> : <Text style={styles.publishBtnText}>发布攻略</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  body: { padding: 16, paddingBottom: 50 },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.ink },
  subtitle: { fontSize: 13, color: COLORS.muted, marginTop: 2, marginBottom: 14 },
  field: { marginBottom: 12 },
  label: { fontSize: 12.5, color: COLORS.muted, marginBottom: 5, fontWeight: '500' },
  input: {
    borderWidth: 1, borderColor: COLORS.line, borderRadius: 12,
    padding: 11, backgroundColor: COLORS.panel, fontSize: 14, color: COLORS.ink,
  },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  section: { fontSize: 16, fontWeight: '700', color: COLORS.ink, marginTop: 16, marginBottom: 8 },
  row2: { flexDirection: 'row', gap: 10 },
  spotWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  spotChip: {
    borderWidth: 1, borderColor: COLORS.line, borderRadius: 999,
    paddingHorizontal: 11, paddingVertical: 6, backgroundColor: 'rgba(255,255,255,0.6)',
  },
  spotChipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  spotChipText: { fontSize: 12.5, color: COLORS.muted },
  spotChipTextActive: { color: COLORS.onAccent, fontWeight: '600' },
  publishBtn: {
    marginTop: 20, backgroundColor: COLORS.accent, borderRadius: 999,
    paddingVertical: 14, alignItems: 'center',
  },
  publishBtnDisabled: { opacity: 0.6 },
  publishBtnText: { color: COLORS.onAccent, fontSize: 16, fontWeight: '700' },
});
