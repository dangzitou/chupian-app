import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Device from 'expo-device';
import { api } from '../api';
import { COLORS, MEDIA_KINDS, TIME_LABELS } from '../config';

function field(label, placeholder, value, onChange, opts = {}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, opts.multiline && styles.multiline]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={COLORS.muted}
        multiline={Boolean(opts.multiline)}
        numberOfLines={opts.numberOfLines || 1}
        maxLength={opts.maxLength}
      />
    </View>
  );
}

function MediaChip({ media, onRemove }) {
  return (
    <View style={styles.mediaCard}>
      <Image
        source={{ uri: media.uri }}
        style={styles.mediaImage}
        resizeMode="cover"
      />
      <Text style={styles.mediaType}>{media.kind}</Text>
      <Pressable style={styles.mediaDelete} onPress={onRemove}>
        <Text style={styles.mediaDeleteText}>×</Text>
      </Pressable>
    </View>
  );
}

async function requestPermissions() {
  if (Device.osName === 'web') return true;
  const cameraStatus = await ImagePicker.requestCameraPermissionsAsync();
  const mediaStatus = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return cameraStatus.granted && mediaStatus.granted;
}

export default function NewPostScreen({ navigation }) {
  const [spots, setSpots] = useState([]);
  const [loadingSpots, setLoadingSpots] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [title, setTitle] = useState('');
  const [spotId, setSpotId] = useState('');
  const [spotName, setSpotName] = useState('');
  const [district, setDistrict] = useState('');
  const [content, setContent] = useState('');
  const [angle, setAngle] = useState('');
  const [direction, setDirection] = useState('');
  const [timeWindow, setTimeWindow] = useState('');
  const [bestTime, setBestTime] = useState('day');
  const [camera, setCamera] = useState('');
  const [lens, setLens] = useState('');
  const [focal, setFocal] = useState('');
  const [aperture, setAperture] = useState('');
  const [shutter, setShutter] = useState('');
  const [iso, setIso] = useState('');
  const [whiteBalance, setWhiteBalance] = useState('');
  const [author, setAuthor] = useState('匿名拍友');
  const [authorBio, setAuthorBio] = useState('');
  const [tags, setTags] = useState('');
  const [stylesText, setStylesText] = useState('');
  const [mediaList, setMediaList] = useState([]);
  const [isLiveMode, setIsLiveMode] = useState(false);

  const selectedSpot = useMemo(() => spots.find((item) => item.id === spotId), [spots, spotId]);

  useEffect(() => {
    (async () => {
      try {
        const d = await api.spots();
        setSpots(d.spots || []);
      } catch (e) {
        setSpots([]);
      } finally {
        setLoadingSpots(false);
      }
    })();
  }, []);

  const pickFromLibrary = useCallback(async () => {
    const ok = await requestPermissions();
    if (!ok) {
      Alert.alert('无权限', '请先打开系统相册权限');
      return;
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 1,
      allowsMultipleSelection: true,
      selectionLimit: 6,
    });

    if (res.canceled || !res.assets || !res.assets.length) return;
    const picks = res.assets.map((asset) => ({
      uri: asset.uri,
      kind: asset.type === 'video' ? MEDIA_KINDS.VIDEO : MEDIA_KINDS.IMAGE,
      mime: asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg'),
      duration: asset.duration || 0,
    }));
    setMediaList((prev) => [...prev, ...picks].slice(0, 6));
  }, []);

  const shootWithCamera = useCallback(async () => {
    const ok = await requestPermissions();
    if (!ok) {
      Alert.alert('无权限', '请先打开相机权限');
      return;
    }

    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 1,
      videoMaxDuration: 40,
    });

    if (res.canceled || !res.assets || !res.assets.length) return;
    const asset = res.assets[0];
    setMediaList((prev) => [
      ...prev,
      {
        uri: asset.uri,
        kind: asset.type === 'video' ? MEDIA_KINDS.VIDEO : MEDIA_KINDS.IMAGE,
        mime: asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg'),
        duration: asset.duration || 0,
      },
    ].slice(0, 6));
  }, []);

  const addLivePhoto = useCallback(() => {
    if (mediaList.length >= 6) {
      Alert.alert('提示', '最多支持 6 个素材');
      return;
    }
    setMediaList((prev) => [
      ...prev,
      {
        uri: 'https://picsum.photos/seed/live-photo/900/1200',
        kind: MEDIA_KINDS.LIVE,
        mime: 'image/jpeg',
      },
    ].slice(0, 6));
  }, [mediaList.length]);

  const removeMedia = useCallback((idx) => {
    setMediaList((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const publish = useCallback(async () => {
    if (!title.trim()) return Alert.alert('提示', '标题不能为空');
    if (!content.trim()) return Alert.alert('提示', '正文不能为空');
    if (!mediaList.length) return Alert.alert('提示', '至少上传一张图片/视频');

    setSubmitting(true);
    try {
      const uploaded = [];
      for (const item of mediaList) {
        if (item.kind === MEDIA_KINDS.LIVE && item.uri.startsWith('http')) {
          uploaded.push({ kind: item.kind, url: item.uri });
          continue;
        }
        const res = await api.uploadMedia(item.uri, item.mime);
        const mediaRecord = (res.media && res.media[0]) || {};
        if (mediaRecord.url) {
          uploaded.push({
            kind: mediaRecord.kind || item.kind || MEDIA_KINDS.IMAGE,
            url: mediaRecord.url,
            width: mediaRecord.width || 0,
            height: mediaRecord.height || 0,
            duration: mediaRecord.duration || 0,
          });
        } else {
          uploaded.push({
            kind: item.kind,
            url: item.uri,
            duration: item.duration || 0,
          });
        }
      }

      const payload = {
        title: title.trim(),
        content: content.trim(),
        spotId: selectedSpot?.id || spotId || '',
        spotName: selectedSpot?.name || spotName || '',
        district: selectedSpot?.district || district || '',
        media: uploaded,
        cover: uploaded[0]?.url || '',
        angle: angle.trim(),
        direction: direction.trim(),
        timeWindow: timeWindow.trim(),
        bestTime,
        shotAt: new Date().toISOString(),
        camera: camera.trim(),
        lens: lens.trim(),
        focalLength: focal.trim(),
        aperture: aperture.trim(),
        shutter: shutter.trim(),
        iso: iso.trim(),
        whiteBalance: whiteBalance.trim(),
        styles: stylesText.split(/[,，/|]/).map((t) => t.trim()).filter(Boolean),
        tags: tags.split(/[,，/|#]/).map((t) => t.trim()).filter(Boolean),
        author: author.trim() || '匿名拍友',
        authorBio: authorBio.trim(),
      };

      await api.createPost(payload);
      Alert.alert('发布成功', '内容已提交，等待审核后会显示在广场');
      navigation.goBack();
    } catch (err) {
      Alert.alert('发布失败', err.message);
    } finally {
      setSubmitting(false);
    }
  }, [
    angle,
    author,
    authorBio,
    bestTime,
    content,
    direction,
    iso,
    lens,
    mediaList,
    navigation,
    spotId,
    spotName,
    selectedSpot,
    shutter,
    tags,
    stylesText,
    title,
    timeWindow,
    aperture,
    focal,
    camera,
    district,
    whiteBalance,
  ]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>发布出片</Text>
        <Text style={styles.subtitle}>拍照参数、实况内容和短视频都可以上传，形成完整出片帖</Text>

        {field('标题 *', '例如：海珠夜景｜广州塔', title, setTitle, { maxLength: 80 })}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>出片位置</Text>
          {loadingSpots ? (
            <ActivityIndicator color={COLORS.accent} />
          ) : (
            <View style={styles.spotWrap}>
              {spots.slice(0, 12).map((s) => (
                <Pressable
                  key={s.id}
                  style={[styles.spotBtn, spotId === s.id && styles.spotBtnActive]}
                  onPress={() => {
                    setSpotId(s.id);
                    setSpotName(s.name);
                    setDistrict(s.district || '');
                  }}
                >
                  <Text style={[styles.spotBtnText, spotId === s.id && styles.spotBtnTextActive]}>{s.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {field('或手输地点', '如：南浦路-广州塔脚下', spotName, setSpotName)}
          {field('行政区', '如：海珠区', district, setDistrict)}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>拍摄信息</Text>
          <View style={styles.row}>
            <View style={styles.flexCol}>
              {field('角度', '平视/仰拍/低机位', angle, setAngle, { maxLength: 70 })}
            </View>
            <View style={styles.flexCol}>
              {field('方向', '逆光/顺光/侧逆', direction, setDirection, { maxLength: 70 })}
            </View>
          </View>
          <View style={styles.row}>
            <View style={styles.flexCol}>
              {field('时间窗口', '如：18:30-19:30', timeWindow, setTimeWindow, { maxLength: 40 })}
            </View>
            <View style={styles.flexCol}>
              <Text style={styles.label}>时段</Text>
              <View style={styles.row}>
                {['day', 'golden', 'night'].map((k) => (
                  <Pressable key={k} style={[styles.timeChip, bestTime === k && styles.timeChipActive]} onPress={() => setBestTime(k)}>
                    <Text style={[styles.timeChipText, bestTime === k && styles.timeChipTextActive]}>
                      {TIME_LABELS[k]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>

          <Text style={styles.sectionTitle}>参数</Text>
          <View style={styles.row}>
            <View style={styles.flexCol}>
              {field('机身', 'Sony A7M4', camera, setCamera, { maxLength: 40 })}
            </View>
            <View style={styles.flexCol}>
              {field('镜头', '24-70mm', lens, setLens, { maxLength: 40 })}
            </View>
          </View>
          <View style={styles.row}>
            <View style={styles.flexCol}>
              {field('焦距', '35mm', focal, setFocal, { maxLength: 20 })}
            </View>
            <View style={styles.flexCol}>
              {field('光圈', 'f/4', aperture, setAperture, { maxLength: 20 })}
            </View>
          </View>
          <View style={styles.row}>
            <View style={styles.flexCol}>
              {field('快门', '1/15s', shutter, setShutter, { maxLength: 20 })}
            </View>
            <View style={styles.flexCol}>
              {field('ISO', '800', iso, setIso, { maxLength: 20 })}
            </View>
          </View>
          {field('白平衡', '日光/阴天/人工/钨丝灯', whiteBalance, setWhiteBalance, { maxLength: 20 })}
        </View>

        {field('正文 *', '描述构图、位置、拍摄流程、注意事项', content, setContent, { multiline: true, maxLength: 5000 })}
        {field('标签', '夜景, 城市, 人像', tags, setTags)}
        {field('风格', '蓝调, 霓虹, 人文', stylesText, setStylesText)}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>博主信息</Text>
          {field('昵称', '匿名拍友', author, setAuthor, { maxLength: 20 })}
          {field('简介', '拍摄风格/器材偏好（可选）', authorBio, setAuthorBio, { maxLength: 80 })}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>素材</Text>
          <Text style={styles.muted}>支持图片、视频和实况类型，最多 6 张/段，建议单条素材 <= 40s 视频</Text>
          <View style={styles.mediaActions}>
            <Pressable style={styles.mediaBtn} onPress={pickFromLibrary}>
              <Text style={styles.mediaBtnText}>从相册</Text>
            </Pressable>
            <Pressable style={styles.mediaBtn} onPress={shootWithCamera}>
              <Text style={styles.mediaBtnText}>拍摄</Text>
            </Pressable>
            <Pressable
              style={[styles.mediaBtn, isLiveMode && styles.mediaBtnActive]}
              onPress={() => {
                setIsLiveMode((v) => !v);
                addLivePhoto();
              }}
            >
              <Text style={styles.mediaBtnText}>实况</Text>
            </Pressable>
          </View>
          <ScrollView horizontal style={styles.mediaList}>
            {mediaList.map((m, idx) => (
              <MediaChip
                key={`${m.uri}-${idx}`}
                media={m}
                onRemove={() => removeMedia(idx)}
              />
            ))}
          </ScrollView>
          {mediaList.length === 0 ? <Text style={styles.muted}>至少添加 1 个素材</Text> : null}
        </View>

        <Pressable style={[styles.publishBtn, submitting && styles.publishBtnDisabled]} onPress={publish} disabled={submitting}>
          {submitting ? <ActivityIndicator color={COLORS.onAccent} /> : <Text style={styles.publishText}>发布出片</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  body: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 24, color: COLORS.ink, fontWeight: '700' },
  subtitle: { color: COLORS.muted, marginTop: 4, marginBottom: 12, fontSize: 13 },
  field: { marginBottom: 12 },
  label: { color: COLORS.muted, fontSize: 12.5, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    fontSize: 14,
    color: COLORS.ink,
    padding: 11,
  },
  multiline: { minHeight: 110, textAlignVertical: 'top' },
  section: { marginTop: 10 },
  sectionTitle: { color: COLORS.ink, marginBottom: 8, marginTop: 6, fontSize: 16, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 10 },
  flexCol: { flex: 1 },
  spotWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  spotBtn: {
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
    backgroundColor: COLORS.card,
  },
  spotBtnActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  spotBtnText: { color: COLORS.muted, fontSize: 12.5 },
  spotBtnTextActive: { color: COLORS.onAccent, fontWeight: '700' },
  timeChip: {
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 6,
    backgroundColor: COLORS.card,
  },
  timeChipActive: { borderColor: COLORS.accent, backgroundColor: COLORS.accentBg },
  timeChipText: { color: COLORS.muted },
  timeChipTextActive: { color: COLORS.accent, fontWeight: '700' },
  muted: { color: COLORS.muted, marginBottom: 8, fontSize: 12 },
  mediaActions: { flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 12 },
  mediaBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: COLORS.card,
  },
  mediaBtnActive: { backgroundColor: COLORS.accentBg, borderColor: COLORS.accent },
  mediaBtnText: { color: COLORS.ink, fontWeight: '600', fontSize: 13 },
  mediaList: { marginTop: 8 },
  mediaCard: {
    width: 120,
    height: 120,
    borderRadius: 12,
    marginRight: 8,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    overflow: 'hidden',
    backgroundColor: COLORS.card,
    position: 'relative',
  },
  mediaImage: { width: '100%', height: '100%' },
  mediaType: {
    position: 'absolute',
    left: 6,
    top: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    color: COLORS.onAccent,
    fontSize: 11,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  mediaDelete: {
    position: 'absolute',
    right: 4,
    top: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaDeleteText: { color: COLORS.onAccent, fontSize: 16, lineHeight: 18, fontWeight: '700' },
  publishBtn: {
    marginTop: 20,
    borderRadius: 999,
    paddingVertical: 14,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
  },
  publishBtnDisabled: { opacity: 0.6 },
  publishText: { color: COLORS.onAccent, fontWeight: '700' },
});
