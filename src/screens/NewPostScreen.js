import React, { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Device from 'expo-device';
import * as ImagePicker from 'expo-image-picker';

import { api } from '../api';
import { COLORS, MEDIA_KINDS, TIME_LABELS } from '../config';
import { EMPTY_SHOT, SHOT_PRESETS } from '../constants/shotForm';
import { splitTags } from '../utils/postCodec';
import PostInput from '../components/forms/PostInput';
import OptionPills from '../components/forms/OptionPills';
import MediaBuilder from '../components/forms/MediaBuilder';

function reducer(state, action) {
  if (action.type === 'update') {
    return { ...state, ...action.payload };
  }
  if (action.type === 'reset') {
    return { ...EMPTY_SHOT };
  }
  return state;
}

function requestPermissions() {
  if (Device.osName === 'web') return true;
  return Promise.all([
    ImagePicker.requestCameraPermissionsAsync(),
    ImagePicker.requestMediaLibraryPermissionsAsync(),
  ]).then(([camera, media]) => {
    const cameraOk = camera.granted || camera.status === 'granted';
    const mediaOk = media.granted || media.status === 'granted';
    return cameraOk && mediaOk;
  });
}

function mediaKindLabel(kind) {
  if (kind === MEDIA_KINDS.VIDEO) return '视频';
  if (kind === MEDIA_KINDS.LIVE) return '实况';
  return '图片';
}

export default function NewPostScreen({ navigation }) {
  const [spots, setSpots] = useState([]);
  const [loadingSpots, setLoadingSpots] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [mediaList, setMediaList] = useState([]);
  const [state, dispatch] = useReducer(reducer, EMPTY_SHOT);

  const selectedSpot = useMemo(
    () => spots.find((item) => String(item.id) === String(state.spotId)) || null,
    [spots, state.spotId]
  );

  useEffect(() => {
    (async () => {
      try {
        const response = await api.spots();
        setSpots(response.spots || []);
      } catch (_err) {
        setSpots([]);
      } finally {
        setLoadingSpots(false);
      }
    })();
  }, []);

  const selectSpot = useCallback((item) => {
    dispatch({
      type: 'update',
      payload: {
        spotId: item.id,
        spotName: item.name,
        district: item.district || state.district,
      },
    });
  }, [state.district]);

  const setField = useCallback((key, value) => {
    dispatch({ type: 'update', payload: { [key]: value } });
  }, []);

  const setBestTime = useCallback((value) => {
    dispatch({ type: 'update', payload: { bestTime: value } });
  }, []);

  const pickFromLibrary = useCallback(async () => {
    const ok = await requestPermissions();
    if (!ok) {
      Alert.alert('无权限', '请先授权照片/相册权限');
      return;
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 1,
      allowsMultipleSelection: true,
      selectionLimit: 9,
    });

    if (res.canceled || !res.assets?.length) return;

    setMediaList((prev) => {
      const next = [...prev];
      for (const asset of res.assets) {
        if (next.length >= 9) break;
        next.push({
          uri: asset.uri,
          kind: asset.type === 'video' ? MEDIA_KINDS.VIDEO : MEDIA_KINDS.IMAGE,
          mime: asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg'),
          duration: asset.duration || 0,
        });
      }
      return next;
    });
  }, []);

  const shootWithCamera = useCallback(async () => {
    const ok = await requestPermissions();
    if (!ok) {
      Alert.alert('无权限', '请先授权相机权限');
      return;
    }

    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 1,
      videoMaxDuration: 40,
    });
    if (res.canceled || !res.assets?.length) return;

    const asset = res.assets[0];
    setMediaList((prev) => {
      if (prev.length >= 9) return prev;
      return [...prev, {
        uri: asset.uri,
        kind: asset.type === 'video' ? MEDIA_KINDS.VIDEO : MEDIA_KINDS.IMAGE,
        mime: asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg'),
        duration: asset.duration || 0,
      }].slice(0, 9);
    });
  }, []);

  const addLivePhoto = useCallback(() => {
    setMediaList((prev) => {
      if (prev.length >= 9) {
        Alert.alert('提示', '素材最多支持 9 个');
        return prev;
      }
      if (prev.some((x) => x.kind === MEDIA_KINDS.LIVE)) {
        return prev.filter((x) => x.kind !== MEDIA_KINDS.LIVE).concat({
          uri: 'https://picsum.photos/seed/live-photo/900/1200',
          kind: MEDIA_KINDS.LIVE,
          mime: 'image/jpeg',
        });
      }
      return [...prev, {
        uri: 'https://picsum.photos/seed/live-photo/900/1200',
        kind: MEDIA_KINDS.LIVE,
        mime: 'image/jpeg',
      }];
    });
  }, []);

  const removeMedia = useCallback((index) => {
    setMediaList((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const validationMessage = useMemo(() => {
    if (!state.title.trim()) return '标题不能为空';
    if (!state.content.trim()) return '正文不能为空';
    if (!mediaList.length) return '请至少上传 1 张照片/视频';
    if (state.title.length > 90) return '标题最多 90 字';
    if (state.content.length > 3000) return '正文最多 3000 字';
    if (splitTags(state.tags).length > 12) return '标签最多 12 个';
    if (splitTags(state.stylesText).length > 12) return '风格标签最多 12 个';
    return '';
  }, [state.content, state.stylesText, state.tags, state.title, mediaList.length]);

  const publish = useCallback(async () => {
    if (validationMessage) {
      Alert.alert('发布前请检查', validationMessage);
      return;
    }

    setSubmitting(true);
    try {
      const uploaded = [];
      for (const item of mediaList) {
        if (item.kind === MEDIA_KINDS.LIVE && item.uri.startsWith('http')) {
          uploaded.push({
            kind: item.kind,
            url: item.uri,
            duration: item.duration || 0,
          });
          continue;
        }

        const res = await api.uploadMedia(item.uri, item.mime);
        const mediaRecord = (res.media || [])[0] || {};
        uploaded.push({
          kind: mediaRecord.kind || item.kind || MEDIA_KINDS.IMAGE,
          url: mediaRecord.url || item.uri,
          width: mediaRecord.width || 0,
          height: mediaRecord.height || 0,
          duration: mediaRecord.duration || item.duration || 0,
        });
      }

      const payload = {
        title: state.title.trim(),
        content: state.content.trim(),
        spotId: selectedSpot?.id || state.spotId || '',
        spotName: selectedSpot?.name || state.spotName || '',
        district: selectedSpot?.district || state.district || '',
        media: uploaded,
        cover: uploaded[0]?.url || '',
        angle: state.angle.trim(),
        direction: state.direction.trim(),
        timeWindow: state.timeWindow.trim(),
        bestTime: state.bestTime,
        shotAt: new Date().toISOString(),
        camera: state.camera.trim(),
        lens: state.lens.trim(),
        focalLength: state.focal.trim(),
        aperture: state.aperture.trim(),
        shutter: state.shutter.trim(),
        iso: state.iso.trim(),
        whiteBalance: state.whiteBalance.trim(),
        styles: splitTags(state.stylesText),
        tags: splitTags(state.tags),
        author: state.author.trim() || '匿名拍友',
        authorBio: state.authorBio.trim(),
      };

      await api.createPost(payload);
      Alert.alert('发布成功', '作品已发送审核，预计短时间内上架');
      dispatch({ type: 'reset' });
      setMediaList([]);
      navigation.goBack();
    } catch (err) {
      Alert.alert('发布失败', err.message || '网络异常，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  }, [api, dispatch, mediaList, navigation, selectedSpot, state, validationMessage]);

  const shootMetaSummary = useMemo(() => {
    const chunks = [
      state.spotName ? `地点：${state.spotName}` : null,
      state.angle ? `角度：${state.angle}` : null,
      state.direction ? `方向：${state.direction}` : null,
      state.timeWindow ? `窗口：${state.timeWindow}` : null,
      state.bestTime ? `时段：${TIME_LABELS[state.bestTime]}` : null,
      state.camera ? `机身：${state.camera}` : null,
      state.lens ? `镜头：${state.lens}` : null,
      state.focal ? `焦距：${state.focal}` : null,
      state.aperture ? `光圈：${state.aperture}` : null,
      state.shutter ? `快门：${state.shutter}` : null,
      state.iso ? `ISO：${state.iso}` : null,
      state.whiteBalance ? `白平衡：${state.whiteBalance}` : null,
    ].filter(Boolean);
    return chunks.slice(0, 4);
  }, [state]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>发布出片</Text>
        <Text style={styles.subtitle}>完善拍摄参数 + 发布照片/视频，打造可收藏的广州出片帖</Text>

        <PostInput
          label="标题 *"
          value={state.title}
          onChange={(value) => setField('title', value)}
          placeholder="例如：海珠夜景｜广州塔"
          maxLength={90}
        />

        <Text style={styles.sectionTitle}>出片位置</Text>
        <View style={styles.spotWrap}>
          {loadingSpots ? <ActivityIndicator color={COLORS.accent} /> : (
            spots.slice(0, 12).map((item) => {
              const active = String(item.id) === String(state.spotId);
              return (
                <Pressable
                  key={item.id}
                  style={[styles.spotBtn, active && styles.spotBtnActive]}
                  onPress={() => selectSpot(item)}
                >
                  <Text style={[styles.spotBtnText, active && styles.spotBtnTextActive]}>{item.name}</Text>
                </Pressable>
              );
            })
          )}
        </View>
        <PostInput
          label="或手动输入地点"
          value={state.spotName}
          onChange={(value) => setField('spotName', value)}
          placeholder="如：海珠区江湾路"
          maxLength={80}
        />
        <PostInput
          label="行政区"
          value={state.district}
          onChange={(value) => setField('district', value)}
          placeholder="如：海珠区"
          maxLength={24}
        />

        <Text style={styles.sectionTitle}>拍摄信息</Text>
        <PostInput
          label="角度"
          value={state.angle}
          onChange={(value) => setField('angle', value)}
          placeholder="仰拍 / 平拍 / 俯拍"
          maxLength={70}
          help="可从下方快速选项填入"
        />
        <OptionPills
          options={SHOT_PRESETS.angle.map((value) => ({ value, label: value }))}
          value={state.angle}
          onChange={(value) => setField('angle', value)}
          compact
        />

        <PostInput
          label="方向"
          value={state.direction}
          onChange={(value) => setField('direction', value)}
          placeholder="顺光 / 逆光 / 侧逆"
          maxLength={70}
          help="如：逆光、顺光、侧光"
        />
        <OptionPills
          options={SHOT_PRESETS.direction.map((value) => ({ value, label: value }))}
          value={state.direction}
          onChange={(value) => setField('direction', value)}
          compact
        />

        <PostInput
          label="时间窗口"
          value={state.timeWindow}
          onChange={(value) => setField('timeWindow', value)}
          placeholder="如：18:20-19:10"
          maxLength={50}
        />
        <OptionPills
          options={SHOT_PRESETS.bestTime}
          value={state.bestTime}
          onChange={setBestTime}
          compact
        />

        <Text style={styles.subTitleSmall}>镜头参数</Text>
        <PostInput
          label="机身"
          value={state.camera}
          onChange={(value) => setField('camera', value)}
          placeholder="Sony A7M4"
          maxLength={60}
        />
        <PostInput
          label="镜头"
          value={state.lens}
          onChange={(value) => setField('lens', value)}
          placeholder="24-70mm F2.8"
          maxLength={60}
        />
        <View style={styles.row2}>
          <PostInput
            label="焦距"
            value={state.focal}
            onChange={(value) => setField('focal', value)}
            placeholder="35mm"
            maxLength={24}
          />
          <PostInput
            label="光圈"
            value={state.aperture}
            onChange={(value) => setField('aperture', value)}
            placeholder="f/1.8"
            maxLength={24}
          />
        </View>
        <View style={styles.row2}>
          <PostInput
            label="快门"
            value={state.shutter}
            onChange={(value) => setField('shutter', value)}
            placeholder="1/125"
            maxLength={24}
          />
          <PostInput
            label="ISO"
            value={state.iso}
            onChange={(value) => setField('iso', value)}
            placeholder="200"
            keyboardType="numeric"
            maxLength={24}
          />
        </View>
        <PostInput
          label="白平衡"
          value={state.whiteBalance}
          onChange={(value) => setField('whiteBalance', value)}
          placeholder="日光 / 阴天 / 阴影"
          maxLength={24}
        />

        <Text style={styles.sectionTitle}>正文 / 经验</Text>
        <PostInput
          label="正文 *"
          value={state.content}
          onChange={(value) => setField('content', value)}
          placeholder="记录时间、天气、机位、拍摄流程、避坑提醒"
          multiline
          maxLength={3000}
          help="建议 300 字以上可提高曝光率"
        />
        <PostInput
          label="标签（逗号分隔）"
          value={state.tags}
          onChange={(value) => setField('tags', value)}
          placeholder="夜景, 人像, 人群"
        />
        <PostInput
          label="风格（逗号分隔）"
          value={state.stylesText}
          onChange={(value) => setField('stylesText', value)}
          placeholder="霓虹, 街头, 人文"
        />

        <Text style={styles.sectionTitle}>作者信息</Text>
        <PostInput
          label="昵称"
          value={state.author}
          onChange={(value) => setField('author', value)}
          placeholder="匿名拍友"
          maxLength={18}
        />
        <PostInput
          label="简介"
          value={state.authorBio}
          onChange={(value) => setField('authorBio', value)}
          placeholder="拍摄偏好/器材说明（可选）"
          maxLength={80}
        />

        <Text style={styles.sectionTitle}>素材</Text>
        <Text style={styles.note}>支持图片、视频、实况截图；建议 1-9 个素材，最大 40s 视频</Text>
        <View style={styles.mediaActions}>
          <Pressable style={styles.mediaBtn} onPress={pickFromLibrary}>
            <Text style={styles.mediaBtnText}>从相册</Text>
          </Pressable>
          <Pressable style={styles.mediaBtn} onPress={shootWithCamera}>
            <Text style={styles.mediaBtnText}>拍摄</Text>
          </Pressable>
          <Pressable style={styles.mediaBtn} onPress={addLivePhoto}>
            <Text style={styles.mediaBtnText}>实况</Text>
          </Pressable>
          <View style={styles.mediaCount}><Text style={styles.mediaCountText}>{mediaList.length}/9</Text></View>
        </View>

        <MediaBuilder mediaList={mediaList} onRemove={removeMedia} />

        {shootMetaSummary.length > 0 ? (
          <View style={styles.previewWrap}>
            <Text style={styles.previewTitle}>参数预览</Text>
            {shootMetaSummary.map((text) => (
              <Text key={text} style={styles.previewText}>• {text}</Text>
            ))}
            <Text style={styles.previewText}>• 当前素材：{mediaKindLabel(mediaList[0]?.kind || MEDIA_KINDS.IMAGE)} x {mediaList.length}</Text>
          </View>
        ) : null}

        <Pressable
          style={[styles.publishBtn, submitting && styles.publishBtnDisabled]}
          onPress={publish}
          disabled={submitting}
        >
          {submitting ? <ActivityIndicator color={COLORS.onAccent} /> : <Text style={styles.publishText}>发布出片</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  body: { padding: 16, paddingBottom: 60 },
  title: { fontSize: 24, color: COLORS.ink, fontWeight: '700' },
  subtitle: { color: COLORS.muted, marginTop: 3, marginBottom: 12, fontSize: 12.5 },
  sectionTitle: {
    color: COLORS.ink,
    marginTop: 16,
    marginBottom: 8,
    fontSize: 17,
    fontWeight: '700',
  },
  subTitleSmall: {
    marginTop: 12,
    color: COLORS.muted,
    fontSize: 12.8,
    fontWeight: '600',
  },
  spotWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  spotBtn: {
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
    backgroundColor: COLORS.card,
  },
  spotBtnActive: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accent,
  },
  spotBtnText: {
    color: COLORS.muted,
    fontSize: 12.5,
  },
  spotBtnTextActive: {
    color: COLORS.onAccent,
    fontWeight: '700',
  },
  row2: { flexDirection: 'row', gap: 12 },
  note: {
    color: COLORS.muted,
    marginBottom: 6,
    fontSize: 11.5,
  },
  mediaActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
    marginBottom: 10,
  },
  mediaBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: COLORS.card,
  },
  mediaBtnText: {
    color: COLORS.ink,
    fontWeight: '600',
    fontSize: 13,
  },
  mediaCount: {
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.card,
  },
  mediaCountText: {
    color: COLORS.muted,
    fontSize: 11.5,
  },
  publishBtn: {
    marginTop: 14,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: COLORS.accent,
  },
  publishBtnDisabled: {
    opacity: 0.6,
  },
  publishText: {
    color: COLORS.onAccent,
    fontWeight: '700',
    fontSize: 15,
  },
  previewWrap: {
    marginTop: 10,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 12,
    padding: 10,
  },
  previewTitle: {
    color: COLORS.ink,
    fontWeight: '700',
    marginBottom: 6,
  },
  previewText: {
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 2,
  },
});
