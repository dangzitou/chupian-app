import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  Platform,
  KeyboardAvoidingView,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Device from 'expo-device';
import * as ImagePicker from 'expo-image-picker';

import { api } from '../api';
import { COLORS, MEDIA_KINDS } from '../config';
import { APP_ROUTES } from '../constants/routes';
import { EMPTY_SHOT, SHOT_PRESETS } from '../constants/shotForm';
import { splitTags } from '../utils/postCodec';
import { validatePostDraft } from '../utils/postValidation';
import ShotMetaBoard from '../components/ShotMetaBoard';
import PostInput from '../components/forms/PostInput';
import OptionPills from '../components/forms/OptionPills';
import MediaBuilder from '../components/forms/MediaBuilder';
import { buildSessionIdempotencyKey } from '../lib/idempotency';
import { createDraftStorage } from '../hooks/useDraftStorage';

const MAX_MEDIA_COUNT = 9;
const MAX_VIDEO_SECONDS = 40;
const DRAFT_DEBOUNCE_MS = 900;
const DRAFT_STORAGE_KEY = 'chupian:new-post-v1';
const LIVE_MEDIA_URI = 'https://picsum.photos/seed/live-photo/900/1200';

const draftStorage = createDraftStorage(DRAFT_STORAGE_KEY);

const EMPTY_DRAFT_STATE = {
  state: EMPTY_SHOT,
  coverIndex: -1,
  mediaList: [],
};

function parseMediaDuration(raw, kind) {
  const normalized = Number(raw || 0);
  if (!normalized || !Number.isFinite(normalized)) return 0;
  if (String(kind).toLowerCase() !== MEDIA_KINDS.VIDEO) return 0;
  const seconds = normalized > 500 ? normalized / 1000 : normalized;
  return Math.max(0, Math.round(seconds));
}

function buildMediaPayload(sourceAsset) {
  const uri = String(sourceAsset?.uri || '').trim();
  if (!uri) return null;
  const isVideo = String(sourceAsset?.type || '').toLowerCase() === 'video'
    || String(sourceAsset?.mimeType || '').toLowerCase().includes('video')
    || String(sourceAsset?.mediaType || '').toLowerCase() === 'video';
  const kind = isVideo ? MEDIA_KINDS.VIDEO : (sourceAsset?.kind || MEDIA_KINDS.IMAGE);
  return {
    uri,
    kind,
    mime: sourceAsset?.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg'),
    duration: isVideo ? parseMediaDuration(sourceAsset?.duration, kind) : 0,
  };
}

function reducer(state, action) {
  if (action.type === 'update') {
    return { ...state, ...action.payload };
  }
  if (action.type === 'reset') {
    return { ...EMPTY_SHOT };
  }
  return state;
}

function hasGranted(status) {
  return status.granted || status.status === 'granted';
}

function requestGalleryPermission() {
  if (Device.osName === 'web') return true;
  return ImagePicker.requestMediaLibraryPermissionsAsync().then((media) => {
    if (hasGranted(media)) return true;
    Alert.alert('无权限', '请先授权相册权限');
    return false;
  });
}

function requestCameraPermission() {
  if (Device.osName === 'web') return true;
  return ImagePicker.requestCameraPermissionsAsync().then((camera) => {
    if (hasGranted(camera)) return true;
    Alert.alert('无权限', '请先授权相机权限');
    return false;
  });
}

function normalizeSpotPrefill(raw) {
  if (!raw) return null;
  return {
    id: raw.id || raw.spotId || '',
    name: raw.name || raw.spotName || '',
    district: raw.district || '',
  };
}

function normalizeShotAt(raw) {
  const input = String(raw || '').trim();
  if (!input) return new Date().toISOString();
  const parsed = new Date(input.replace(/\//g, '-'));
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return input;
}

export default function NewPostScreen({ navigation, route }) {
  const [spots, setSpots] = useState([]);
  const [loadingSpots, setLoadingSpots] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [mediaList, setMediaList] = useState([]);
  const [coverIndex, setCoverIndex] = useState(-1);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [state, dispatch] = useReducer(reducer, EMPTY_SHOT);
  const idempotencyKeyRef = useRef('');
  const draftTimer = useRef(null);
  const hasHydratedDraftRef = useRef(false);

  const selectedSpot = useMemo(
    () => spots.find((item) => String(item.id) === String(state.spotId)) || null,
    [spots, state.spotId]
  );

  const routeSpot = useMemo(() => normalizeSpotPrefill(route?.params?.prefillSpot || route?.params?.spot), [route?.params]);

  const toDraftPayload = useCallback(() => ({
    version: 1,
    savedAt: Date.now(),
    state,
    mediaList,
    coverIndex,
  }), [coverIndex, mediaList, state]);

  const applyDraft = useCallback((draft = EMPTY_DRAFT_STATE) => {
    const nextState = draft.state || EMPTY_DRAFT_STATE.state;
    const nextMedia = Array.isArray(draft.mediaList) ? draft.mediaList.filter(Boolean) : [];
    const nextCover = Number.isInteger(draft.coverIndex) ? draft.coverIndex : -1;

    dispatch({ type: 'reset' });
    dispatch({
      type: 'update',
      payload: {
        ...EMPTY_SHOT,
        ...nextState,
      },
    });
    setMediaList(nextMedia);
    setCoverIndex(nextMedia.length > 0 ? Math.min(Math.max(nextCover, 0), nextMedia.length - 1) : -1);
  }, []);

  const saveDraft = useCallback(async () => {
    const payload = toDraftPayload();
    if (!payload.state?.title && !payload.state?.content && !payload.mediaList.length) {
      return;
    }
    await draftStorage.write(payload);
  }, [toDraftPayload]);

  const clearDraft = useCallback(async () => {
    await draftStorage.remove();
    hasHydratedDraftRef.current = false;
    dispatch({ type: 'reset' });
    setMediaList([]);
    setCoverIndex(-1);
    idempotencyKeyRef.current = '';
  }, []);

  const hydrateDraft = useCallback(async () => {
    if (hasHydratedDraftRef.current) return;
    const raw = await draftStorage.read();
    if (!raw || !raw.state) {
      hasHydratedDraftRef.current = true;
      return;
    }
    if (raw.savedAt && Date.now() - raw.savedAt > 30 * 24 * 3600 * 1000) {
      await draftStorage.remove();
      hasHydratedDraftRef.current = true;
      setDraftLoaded(false);
      return;
    }
    applyDraft(raw);
    setDraftLoaded(true);
    hasHydratedDraftRef.current = true;
  }, [applyDraft]);

  useEffect(() => {
    if (!hasHydratedDraftRef.current) return;

    if (draftTimer.current) {
      clearTimeout(draftTimer.current);
    }

    draftTimer.current = setTimeout(() => {
      saveDraft().catch(() => {
        // ignore
      });
    }, DRAFT_DEBOUNCE_MS);

    return () => {
      if (draftTimer.current) {
        clearTimeout(draftTimer.current);
      }
    };
  }, [coverIndex, mediaList, saveDraft, state]);

  useEffect(() => {
    hydrateDraft();
  }, [hydrateDraft]);

  useEffect(() => {
    if (!routeSpot) return;
    const nextSpotId = String(routeSpot.id || '').trim();
    const nextSpotName = String(routeSpot.name || '').trim();
    const nextDistrict = String(routeSpot.district || '').trim();
    const shouldApply = (
      (!!nextSpotId && String(state.spotId) !== nextSpotId)
      || (!!nextSpotName && state.spotName !== nextSpotName)
      || (!!nextDistrict && state.district !== nextDistrict)
    );
    if (!shouldApply) return;

    dispatch({
      type: 'update',
      payload: {
        spotId: nextSpotId || state.spotId,
        spotName: nextSpotName || state.spotName,
        district: nextDistrict || state.district,
      },
    });
  }, [routeSpot, state.district, state.spotId, state.spotName]);

  useEffect(() => {
    setCoverIndex((prev) => {
      if (!mediaList.length) return -1;
      if (prev < 0 || prev >= mediaList.length) return 0;
      return prev;
    });
  }, [mediaList]);

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
    const ok = await requestGalleryPermission();
    if (!ok) {
      return;
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 1,
      allowsMultipleSelection: true,
      selectionLimit: 9,
    });

    if (res.canceled || !res.assets?.length) return;
    const candidates = res.assets
      .map((asset) => buildMediaPayload(asset))
      .filter(Boolean)
      .filter((item) => {
        if (item.kind === MEDIA_KINDS.VIDEO && item.duration > MAX_VIDEO_SECONDS) {
          return false;
        }
        return true;
      });
    const skippedVideos = res.assets.length - candidates.length;
    setMediaList((prev) => {
      if (prev.length >= MAX_MEDIA_COUNT) {
        Alert.alert('提示', `素材最多支持 ${MAX_MEDIA_COUNT} 个`);
        return prev;
      }
      const existingSet = new Set(prev.map((item) => item.uri));
      const next = [...prev];
      for (const item of candidates) {
        if (!item.uri || existingSet.has(item.uri)) continue;
        if (next.length >= MAX_MEDIA_COUNT) break;
        next.push(item);
        existingSet.add(item.uri);
      }
      return next;
    });
    if (skippedVideos > 0) {
      Alert.alert('提示', `检测到 ${skippedVideos} 个视频超过 ${MAX_VIDEO_SECONDS}s，已自动忽略`);
    }
  }, []);

  const shootWithCamera = useCallback(async () => {
    const ok = await requestCameraPermission();
    if (!ok) {
      return;
    }

    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 1,
      videoMaxDuration: 40,
    });
    if (res.canceled || !res.assets?.length) return;

    const asset = res.assets[0];
    const normalized = buildMediaPayload(asset);
    if (!normalized) return;
    if (normalized.kind === MEDIA_KINDS.VIDEO && normalized.duration > MAX_VIDEO_SECONDS) {
      Alert.alert('提示', `视频时长超过 ${MAX_VIDEO_SECONDS}s，不支持发布`);
      return;
    }

    setMediaList((prev) => {
      const existingSet = new Set(prev.map((item) => item.uri));
      if (normalized.uri && existingSet.has(normalized.uri)) {
        Alert.alert('提示', '这张素材已经添加过了');
        return prev;
      }
      if (prev.length >= MAX_MEDIA_COUNT) {
        Alert.alert('提示', `素材最多支持 ${MAX_MEDIA_COUNT} 个`);
        return prev;
      }
      return [...prev, normalized].slice(0, MAX_MEDIA_COUNT);
    });
  }, []);

  const addLivePhoto = useCallback(() => {
    setMediaList((prev) => {
      if (prev.length >= MAX_MEDIA_COUNT) {
        Alert.alert('提示', `素材最多支持 ${MAX_MEDIA_COUNT} 个`);
        return prev;
      }
      if (prev.some((x) => x.kind === MEDIA_KINDS.LIVE)) {
        return prev.filter((x) => x.kind !== MEDIA_KINDS.LIVE).concat({
          uri: LIVE_MEDIA_URI,
          kind: MEDIA_KINDS.LIVE,
          mime: 'image/jpeg',
        });
      }
      return [...prev, {
        uri: LIVE_MEDIA_URI,
        kind: MEDIA_KINDS.LIVE,
        mime: 'image/jpeg',
      }];
    });
  }, []);

  const setCover = useCallback((index) => {
    if (!mediaList.length) return;
    const safeIndex = Number(index);
    if (!Number.isFinite(safeIndex)) return;
    if (safeIndex < 0 || safeIndex >= mediaList.length) return;
    setCoverIndex(safeIndex);
  }, [mediaList.length]);

  const removeMedia = useCallback((index) => {
    setMediaList((prev) => prev.filter((_, i) => i !== index));
    setCoverIndex((prev) => {
      if (prev < 0) return -1;
      if (prev === index) return 0;
      if (index < prev) return prev - 1;
      return prev;
    });
  }, []);

  const validation = useMemo(() => validatePostDraft(state, mediaList), [mediaList, state]);

  const hasDraftPayload = useMemo(
    () => (
      state.title.trim()
      || state.content.trim()
      || state.tags.trim()
      || state.stylesText.trim()
      || state.spotName.trim()
      || state.district.trim()
      || state.author.trim()
      || state.authorBio.trim()
      || mediaList.length > 0
      || coverIndex >= 0
    ),
    [
      coverIndex,
      mediaList.length,
      state.author,
      state.authorBio,
      state.content,
      state.district,
      state.spotName,
      state.stylesText,
      state.tags,
      state.title,
    ]
  );

  const publish = useCallback(async () => {
    if (!validation.isValid) {
      Alert.alert('发布前请检查', validation.firstError || '发布内容不完整');
      return;
    }

    setSubmitting(true);
    try {
      const orderedMediaList = mediaList.length
        ? (coverIndex > 0 && coverIndex < mediaList.length
          ? [mediaList[coverIndex], ...mediaList.slice(0, coverIndex), ...mediaList.slice(coverIndex + 1)]
          : mediaList)
        : [];
      const uploaded = await Promise.all(
        orderedMediaList.map(async (item) => {
          if (item.kind === MEDIA_KINDS.LIVE && item.uri.startsWith('http')) {
            return {
              kind: item.kind,
              url: item.uri,
              duration: item.duration || 0,
            };
          }
          const res = await api.uploadMedia(item.uri, item.mime);
          const mediaRecord = (res.media || [])[0] || {};
          return {
            kind: mediaRecord.kind || item.kind || MEDIA_KINDS.IMAGE,
            url: mediaRecord.url || item.uri,
            width: mediaRecord.width || 0,
            height: mediaRecord.height || 0,
            duration: mediaRecord.duration || item.duration || 0,
          };
        })
      );

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
        shotAt: normalizeShotAt(state.shotAt),
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

      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current = buildSessionIdempotencyKey('post-create', `${state.spotId || ''}-${state.author || ''}`);
      }
      await clearDraft();
      await api.createPost(payload, idempotencyKeyRef.current);
      Alert.alert('发布成功', '作品已发送审核，预计短时间内上架');
      dispatch({ type: 'reset' });
      setMediaList([]);
      setCoverIndex(-1);
      idempotencyKeyRef.current = '';
      if (navigation.canGoBack && navigation.canGoBack()) {
        navigation.goBack();
        return;
      }
      const parent = navigation.getParent && navigation.getParent();
      if (parent) {
        parent.navigate(APP_ROUTES.DISCOVERY);
      }
    } catch (err) {
      Alert.alert('发布失败', err.message || '网络异常，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  }, [api, clearDraft, coverIndex, dispatch, mediaList, navigation, selectedSpot, state, validation]);

  const onSaveDraft = useCallback(() => {
    saveDraft()
      .then(() => {
        setDraftLoaded(true);
        Alert.alert('草稿已保存', '本地草稿保留 30 天');
      })
      .catch(() => {
        Alert.alert('保存失败', '草稿保存失败，请稍后重试');
      });
  }, [saveDraft]);

  const onClearDraft = useCallback(() => {
    Alert.alert(
      '清空草稿',
      '将清空当前编辑内容，是否继续？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清空',
          style: 'destructive',
          onPress: async () => {
            await clearDraft();
            setDraftLoaded(false);
          },
        },
      ],
    );
  }, [clearDraft]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>发布出片</Text>
          <Text style={styles.subtitle}>完善拍摄参数 + 发布照片/视频，打造可收藏的广州出片帖</Text>
          {!!validation.firstError ? <Text style={styles.validationMsg}>{validation.firstError}</Text> : null}
          {draftLoaded ? <Text style={styles.draftHint}>已读取本地草稿，继续编辑即可接续发布。</Text> : null}

          <View style={styles.formActions}>
            <Pressable
              style={[styles.secondaryBtn, !hasDraftPayload && styles.secondaryBtnDisabled]}
              onPress={onSaveDraft}
              disabled={submitting || !hasDraftPayload}
            >
              <Text style={styles.secondaryBtnText}>保存草稿</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryBtn, (!draftLoaded && !hasDraftPayload) && styles.secondaryBtnDisabled]}
              onPress={onClearDraft}
              disabled={submitting || (!draftLoaded && !hasDraftPayload)}
            >
              <Text style={styles.secondaryBtnText}>清空草稿</Text>
            </Pressable>
          </View>

        <PostInput
          label="标题 *"
          error={validation.errors.title}
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
          error={validation.errors.spotName}
          value={state.spotName}
          onChange={(value) => setField('spotName', value)}
          placeholder="如：海珠区江湾路"
          maxLength={80}
        />
        <PostInput
          label="行政区"
          error={validation.errors.district}
          value={state.district}
          onChange={(value) => setField('district', value)}
          placeholder="如：海珠区"
          maxLength={24}
        />

        <Text style={styles.sectionTitle}>拍摄信息</Text>
        <PostInput
          label="拍摄时间（可选）"
          error={validation.errors.shotAt}
          value={state.shotAt}
          onChange={(value) => setField('shotAt', value)}
          placeholder="如：2026-08-08 20:30"
          maxLength={30}
          help="留空会使用当前时间"
        />

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
            error={validation.errors.iso}
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
          error={validation.errors.content}
          value={state.content}
          onChange={(value) => setField('content', value)}
          placeholder="记录时间、天气、机位、拍摄流程、避坑提醒"
          multiline
          maxLength={3000}
          help="建议 300 字以上可提高曝光率"
        />
        <PostInput
          label="标签（逗号分隔）"
          error={validation.errors.tags}
          value={state.tags}
          onChange={(value) => setField('tags', value)}
          placeholder="夜景, 人像, 人群"
        />
        <PostInput
          label="风格（逗号分隔）"
          error={validation.errors.stylesText}
          value={state.stylesText}
          onChange={(value) => setField('stylesText', value)}
          placeholder="霓虹, 街头, 人文"
        />

        <Text style={styles.sectionTitle}>作者信息</Text>
        <PostInput
          label="昵称"
          error={validation.errors.author}
          value={state.author}
          onChange={(value) => setField('author', value)}
          placeholder="匿名拍友"
          maxLength={18}
        />
        <PostInput
          label="简介"
          error={validation.errors.authorBio}
          value={state.authorBio}
          onChange={(value) => setField('authorBio', value)}
          placeholder="拍摄偏好/器材说明（可选）"
          maxLength={80}
        />

        <Text style={styles.sectionTitle}>素材</Text>
        <Text style={[styles.note, validation.errors.media && styles.mediaError]}>{validation.errors.media || '支持图片、视频、实况截图；建议 1-9 个素材，最大 40s 视频'}</Text>
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
          <View style={styles.mediaCount}><Text style={styles.mediaCountText}>{mediaList.length}/{MAX_MEDIA_COUNT}</Text></View>
          {mediaList.length >= MAX_MEDIA_COUNT ? <Text style={styles.mediaCountWarn}>已达上限</Text> : null}
        </View>

        <MediaBuilder
          mediaList={mediaList}
          onRemove={removeMedia}
          coverIndex={coverIndex}
          onSetCover={setCover}
        />

        <View style={styles.previewWrap}>
          <ShotMetaBoard
            source={{ ...state, media: mediaList }}
            title="参数预览"
            options={{ includeSpot: true, includeLocation: true, includeMedia: true, maxItems: 8 }}
            compact
            fallback="请先填写拍摄参数，完成后预览会自动更新"
            showPanel={false}
          />
        </View>

        <Pressable
          style={[
            styles.publishBtn,
            (submitting || !validation.isValid) && styles.publishBtnDisabled,
          ]}
          onPress={publish}
          disabled={submitting || !validation.isValid}
        >
          {submitting ? <ActivityIndicator color={COLORS.onAccent} /> : <Text style={styles.publishText}>发布出片</Text>}
        </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
  mediaError: {
    color: '#b84b4b',
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
  mediaCountWarn: {
    position: 'absolute',
    right: 0,
    top: 46,
    color: '#a34a2a',
    fontSize: 11,
  },
  draftHint: {
    marginTop: 4,
    color: '#8a6d43',
    fontSize: 12,
  },
  formActions: {
    marginTop: 10,
    marginBottom: 8,
    flexDirection: 'row',
    gap: 10,
  },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 999,
    paddingVertical: 11,
    alignItems: 'center',
    backgroundColor: COLORS.card,
  },
  secondaryBtnDisabled: {
    opacity: 0.45,
  },
  secondaryBtnText: {
    color: COLORS.ink,
    fontWeight: '600',
    fontSize: 13,
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
  validationMsg: {
    color: '#b84b4b',
    marginTop: 4,
    fontSize: 12,
  },
  previewWrap: {
    marginTop: 10,
  },
});
