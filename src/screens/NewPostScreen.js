import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  Platform,
  KeyboardAvoidingView,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';

import { api } from '../api';
import { COLORS, MEDIA_KINDS } from '../config';
import { APP_ROUTES } from '../constants/routes';
import { EMPTY_SHOT, SHOT_PRESETS } from '../constants/shotForm';
import { splitTags } from '../utils/postCodec';
import { validatePostDraft } from '../utils/postValidation';
import { mapWithConcurrency } from '../utils/async';
import { buildShotDefaultsFromExif } from '../utils/exif';
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

const draftStorage = createDraftStorage(DRAFT_STORAGE_KEY);

const EMPTY_DRAFT_STATE = {
  state: EMPTY_SHOT,
  coverIndex: -1,
  mediaList: [],
};

function isUsableDraftMedia(item) {
  const uri = String(item?.uri || '').trim();
  if (!uri) return false;
  if (Platform.OS === 'web' && /^blob:/i.test(uri)) return false;
  return true;
}

function FormSection({ title, summary, expanded, onToggle, children }) {
  return (
    <View style={styles.formSection}>
      <Pressable
        style={styles.formSectionHeader}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <View style={styles.formSectionCopy}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.formSectionSummary}>{summary}</Text>
        </View>
        <Text style={styles.formSectionChevron}>{expanded ? '−' : '+'}</Text>
      </Pressable>
      {expanded ? <View style={styles.formSectionBody}>{children}</View> : null}
    </View>
  );
}

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
  const assetType = String(sourceAsset?.type || '').toLowerCase();
  const pairedVideoAsset = sourceAsset?.pairedVideoAsset || null;
  const pairedVideoUri = String(pairedVideoAsset?.uri || '').trim();
  const isVideo = assetType === 'video'
    || String(sourceAsset?.mimeType || '').toLowerCase().includes('video')
    || String(sourceAsset?.mediaType || '').toLowerCase() === 'video';
  const isLive = assetType === 'livephoto'
    || assetType === 'live_photo'
    || assetType === 'live'
    || sourceAsset?.isLivePhoto === true
    || Boolean(pairedVideoUri);
  const kind = isVideo
    ? MEDIA_KINDS.VIDEO
    : (isLive ? MEDIA_KINDS.LIVE : (sourceAsset?.kind || MEDIA_KINDS.IMAGE));
  return {
    uri,
    kind,
    file: sourceAsset?.file || null,
    exif: sourceAsset?.exif || null,
    mime: sourceAsset?.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg'),
    duration: isVideo ? parseMediaDuration(sourceAsset?.duration, kind) : 0,
    pairedVideo: pairedVideoUri ? {
      uri: pairedVideoUri,
      file: pairedVideoAsset?.file || null,
      mime: pairedVideoAsset?.mimeType || 'video/quicktime',
      duration: parseMediaDuration(pairedVideoAsset?.duration, MEDIA_KINDS.VIDEO),
    } : null,
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

function openAppSettings() {
  Linking.openSettings().catch(() => {});
}

function requestGalleryPermission() {
  if (Platform.OS === 'web') return true;
  return ImagePicker.requestMediaLibraryPermissionsAsync().then((media) => {
    if (hasGranted(media)) return true;
    Alert.alert('需要相册权限', '请在系统设置中允许访问照片，才能添加出片素材。', [
      { text: '稍后', style: 'cancel' },
      { text: '打开设置', onPress: openAppSettings },
    ]);
    return false;
  });
}

function requestCameraPermission() {
  if (Platform.OS === 'web') return true;
  return ImagePicker.requestCameraPermissionsAsync().then((camera) => {
    if (hasGranted(camera)) return true;
    Alert.alert('需要相机权限', '请在系统设置中允许使用相机，才能直接拍摄素材。', [
      { text: '稍后', style: 'cancel' },
      { text: '打开设置', onPress: openAppSettings },
    ]);
    return false;
  });
}

function normalizeSpotPrefill(raw) {
  if (!raw) return null;
  return {
    id: raw.id || raw.spotId || '',
    name: raw.name || raw.spotName || '',
    district: raw.district || '',
    latitude: raw.latitude ?? raw.lat ?? '',
    longitude: raw.longitude ?? raw.lng ?? '',
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
  const [uploadProgress, setUploadProgress] = useState(null);
  const [publishError, setPublishError] = useState('');
  const [mediaList, setMediaList] = useState([]);
  const [coverIndex, setCoverIndex] = useState(-1);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [rewardOpen, setRewardOpen] = useState(false);
  const [draftMediaWarning, setDraftMediaWarning] = useState('');
  const [shootingOpen, setShootingOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [authorOpen, setAuthorOpen] = useState(false);
  const [state, dispatch] = useReducer(reducer, EMPTY_SHOT);
  const idempotencyKeyRef = useRef('');
  const draftTimer = useRef(null);
  const hasHydratedDraftRef = useRef(false);
  const saveDraftRef = useRef(null);
  const mediaIdempotencyRef = useRef(new Map());

  const getMediaUploadKey = useCallback((item, part) => {
    const seed = `${part}:${item?.uri || ''}`;
    const existing = mediaIdempotencyRef.current.get(seed);
    if (existing) return existing;
    const next = buildSessionIdempotencyKey('media-upload', seed);
    mediaIdempotencyRef.current.set(seed, next);
    return next;
  }, []);

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
    const storedMedia = Array.isArray(draft.mediaList) ? draft.mediaList.filter(Boolean) : [];
    const nextMedia = storedMedia.filter(isUsableDraftMedia);
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
    setDraftMediaWarning(
      storedMedia.length !== nextMedia.length
        ? '浏览器临时素材已失效，请重新选择图片或视频；文字和拍摄参数已保留。'
        : ''
    );
  }, []);

  const saveDraft = useCallback(async () => {
    const payload = toDraftPayload();
    if (!payload.state?.title && !payload.state?.content && !payload.mediaList.length) {
      return;
    }
    await draftStorage.write(payload);
  }, [toDraftPayload]);


  useEffect(() => {
    saveDraftRef.current = saveDraft;
  }, [saveDraft]);

  useEffect(() => {
    let lastPersistAt = 0;
    const persist = () => {
      if (!hasHydratedDraftRef.current) return;
      const now = Date.now();
      if (now - lastPersistAt < 500) return;
      lastPersistAt = now;
      if (draftTimer.current) {
        clearTimeout(draftTimer.current);
        draftTimer.current = null;
      }
      const pending = saveDraftRef.current?.();
      pending?.catch(() => {
        // Draft persistence is best effort during app suspension.
      });
    };
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') persist();
    });
    let removeVisibilityListener = null;
    if (typeof document !== 'undefined') {
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'hidden') persist();
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);
      removeVisibilityListener = () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
    return () => {
      subscription?.remove?.();
      removeVisibilityListener?.();
    };
  }, []);

  const clearDraft = useCallback(async () => {
    await draftStorage.remove();
    // Clearing is a completed hydration step; new edits must keep autosaving.
    hasHydratedDraftRef.current = true;
    setDraftMediaWarning('');
    dispatch({ type: 'reset' });
    setMediaList([]);
    setCoverIndex(-1);
    idempotencyKeyRef.current = '';
  }, []);

  const hydrateDraft = useCallback(async () => {
    if (hasHydratedDraftRef.current) return;
    const raw = await draftStorage.read();
    if (!raw || !raw.state) {
      setDraftMediaWarning('');
      hasHydratedDraftRef.current = true;
      return;
    }
    if (raw.savedAt && Date.now() - raw.savedAt > 30 * 24 * 3600 * 1000) {
      await draftStorage.remove();
      hasHydratedDraftRef.current = true;
      setDraftLoaded(false);
      setDraftMediaWarning('');
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
    const nextLatitude = Number(routeSpot.latitude);
    const nextLongitude = Number(routeSpot.longitude);
    const hasCoordinates = Number.isFinite(nextLatitude) && Number.isFinite(nextLongitude);
    const shouldApply = (
      (!!nextSpotId && String(state.spotId) !== nextSpotId)
      || (!!nextSpotName && state.spotName !== nextSpotName)
      || (!!nextDistrict && state.district !== nextDistrict)
      || (hasCoordinates && (
        Number(state.latitude) !== nextLatitude || Number(state.longitude) !== nextLongitude
      ))
    );
    if (!shouldApply) return;

    dispatch({
      type: 'update',
      payload: {
        spotId: nextSpotId || state.spotId,
        spotName: nextSpotName || state.spotName,
        district: nextDistrict || state.district,
        latitude: hasCoordinates ? String(nextLatitude) : state.latitude,
        longitude: hasCoordinates ? String(nextLongitude) : state.longitude,
      },
    });
  }, [routeSpot, state.district, state.latitude, state.longitude, state.spotId, state.spotName]);

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
        latitude: String(item.latitude ?? item.lat ?? ''),
        longitude: String(item.longitude ?? item.lng ?? ''),
      },
    });
  }, [state.district]);

  const setField = useCallback((key, value) => {
    const payload = { [key]: value };
    if (key === 'spotName' || key === 'district') {
      payload.spotId = '';
    }
    dispatch({ type: 'update', payload });
  }, []);

  const setBestTime = useCallback((value) => {
    dispatch({ type: 'update', payload: { bestTime: value } });
  }, []);

  const applyExifDefaults = useCallback((rawExif) => {
    const defaults = buildShotDefaultsFromExif(rawExif);
    const next = {};
    for (const key of ['camera', 'lens', 'focal', 'aperture', 'shutter', 'iso', 'whiteBalance', 'shotAt']) {
      if (!String(state[key] || '').trim() && defaults[key]) next[key] = defaults[key];
    }
    if (Object.keys(next).length) dispatch({ type: 'update', payload: next });
  }, [state]);

  const pickFromLibrary = useCallback(async () => {
    const ok = await requestGalleryPermission();
    if (!ok) {
      return;
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 1,
      exif: true,
      allowsMultipleSelection: true,
      selectionLimit: 9,
    });

    if (res.canceled || !res.assets?.length) return;
    applyExifDefaults(res.assets[0]?.exif);
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
  }, [applyExifDefaults]);

  const shootWithCamera = useCallback(async () => {
    const ok = await requestCameraPermission();
    if (!ok) {
      return;
    }

    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images', 'videos'],
      quality: 1,
      exif: true,
      videoMaxDuration: 40,
    });
    if (res.canceled || !res.assets?.length) return;

    const asset = res.assets[0];
    applyExifDefaults(asset.exif);
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
  }, [applyExifDefaults]);

  const addLivePhoto = useCallback(async () => {
    if (Platform.OS !== 'ios') {
      Alert.alert('暂不支持', '实况照片目前仅支持 iPhone，请用相册添加静态图片或视频。');
      return;
    }
    const ok = await requestGalleryPermission();
    if (!ok) return;

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['livePhotos'],
      quality: 1,
      allowsMultipleSelection: false,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    });
    if (res.canceled || !res.assets?.length) return;

    const normalized = buildMediaPayload(res.assets[0]);
    if (!normalized || normalized.kind !== MEDIA_KINDS.LIVE) {
      Alert.alert('不是实况照片', '请在相册中选择一张 Live Photo 后重试');
      return;
    }

    setMediaList((prev) => {
      if (prev.length >= MAX_MEDIA_COUNT) {
        Alert.alert('提示', `素材最多支持 ${MAX_MEDIA_COUNT} 个`);
        return prev;
      }
      if (prev.some((item) => item.uri === normalized.uri)) return prev;
      return [...prev, normalized];
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

  const rewardPreview = useMemo(() => {
    const metadataCount = [
      state.angle,
      state.direction,
      state.timeWindow,
      state.shotAt,
      state.camera,
      state.lens,
      state.focal,
      state.aperture,
      state.shutter,
      state.iso,
      state.whiteBalance,
    ].filter((value) => String(value || '').trim()).length;
    const contentLength = state.content.trim().length;
    const contentReady = contentLength >= 120;
    const guideReady = contentReady && metadataCount >= 3;
    const missing = [
      contentReady ? '' : `正文还差 ${120 - contentLength} 字`,
      metadataCount >= 3 ? '' : `参数还差 ${3 - metadataCount} 项`,
    ].filter(Boolean);
    return {
      metadataCount,
      guideReady,
      contentLength,
      contentProgress: Math.min(contentLength / 120, 1),
      metadataProgress: Math.min(metadataCount / 3, 1),
      earnedHint: guideReady ? '完整攻略奖励已解锁 +15' : `${missing.join('，')}，解锁 +15 贡献值`,
    };
  }, [state]);

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
    setPublishError('');
    try {
      // Keep the draft until the post transaction succeeds. A page refresh after
      // a failed upload must not erase the user's text or shooting metadata.
      await saveDraft();
      const orderedMediaList = mediaList.length
        ? (coverIndex > 0 && coverIndex < mediaList.length
          ? [mediaList[coverIndex], ...mediaList.slice(0, coverIndex), ...mediaList.slice(coverIndex + 1)]
          : mediaList)
        : [];
      const uploadTotal = orderedMediaList.reduce((total, item) => (
        total + (item.kind === MEDIA_KINDS.LIVE && item.pairedVideo?.uri ? 2 : 1)
      ), 0);
      setUploadProgress({ completed: 0, total: uploadTotal, phase: 'uploading' });
      const markUploadComplete = () => {
        setUploadProgress((current) => current
          ? { ...current, completed: Math.min(current.total, current.completed + 1) }
          : current);
      };
      const uploaded = await mapWithConcurrency(orderedMediaList, async (item) => {
          if (item.kind === MEDIA_KINDS.LIVE && item.uri.startsWith('http')) {
            const result = {
              kind: item.kind,
              url: item.uri,
              duration: item.duration || 0,
            };
            markUploadComplete();
            return result;
          }
          const stillRes = await api.uploadMedia(
            item.uri,
            item.mime || 'image/jpeg',
            item.kind === MEDIA_KINDS.LIVE ? MEDIA_KINDS.IMAGE : item.kind,
            item.file,
            getMediaUploadKey(item, 'still'),
          );
          markUploadComplete();
          const stillRecord = (stillRes.media || [])[0] || {};
          let mediaRecord = stillRecord;
          if (item.kind === MEDIA_KINDS.LIVE && item.pairedVideo?.uri) {
            const videoRes = await api.uploadMedia(
              item.pairedVideo.uri,
              item.pairedVideo.mime || 'video/quicktime',
              MEDIA_KINDS.VIDEO,
              item.pairedVideo.file,
              getMediaUploadKey(item.pairedVideo, 'paired'),
            );
            markUploadComplete();
            const videoRecord = (videoRes.media || [])[0] || {};
            mediaRecord = {
              ...videoRecord,
              url: videoRecord.url || item.pairedVideo.uri,
              cover: stillRecord.url || item.uri,
              duration: videoRecord.duration || item.pairedVideo.duration || 0,
            };
          }
          const result = {
            kind: item.kind === MEDIA_KINDS.LIVE
              ? MEDIA_KINDS.LIVE
              : (mediaRecord.kind || item.kind || MEDIA_KINDS.IMAGE),
            url: mediaRecord.url || item.uri,
            cover: mediaRecord.cover || mediaRecord.cover_url || '',
            width: mediaRecord.width || 0,
            height: mediaRecord.height || 0,
            duration: mediaRecord.duration || item.duration || 0,
          };
          return result;
        }, 2);

      const payload = {
        title: state.title.trim(),
        content: state.content.trim(),
        spotId: selectedSpot?.id || state.spotId || '',
        spotName: selectedSpot?.name || state.spotName || '',
        district: selectedSpot?.district || state.district || '',
        latitude: Number.isFinite(Number(state.latitude)) ? Number(state.latitude) : null,
        longitude: Number.isFinite(Number(state.longitude)) ? Number(state.longitude) : null,
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

      setUploadProgress((current) => current
        ? { ...current, phase: 'publishing' }
        : current);

      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current = buildSessionIdempotencyKey('post-create', `${state.spotId || ''}-${state.author || ''}`);
      }
      const created = await api.createPost(payload, idempotencyKeyRef.current);
      await clearDraft();
      mediaIdempotencyRef.current.clear();
      setUploadProgress(null);
      const earnedPoints = Number(created?.reward?.earnedPoints || 5);
      const createdPostId = String(created?.post?.id || created?.postId || created?.id || '').trim();
      Alert.alert('发布成功', `作品已发布，获得 +${earnedPoints} 贡献值`);
      dispatch({ type: 'reset' });
      setMediaList([]);
      setCoverIndex(-1);
      idempotencyKeyRef.current = '';
      const parent = navigation.getParent && navigation.getParent();
      if (parent) {
        parent.navigate(APP_ROUTES.DISCOVERY, createdPostId
          ? {
            screen: 'PostDetail',
            params: { postId: createdPostId, title: created?.post?.title || state.title },
          }
          : undefined);
        return;
      }
      if (navigation.canGoBack && navigation.canGoBack()) {
        navigation.goBack();
      }
    } catch (err) {
      setPublishError('发布失败，草稿和已完成的上传状态已保留。检查网络后再次点击即可继续。');
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  }, [api, clearDraft, coverIndex, dispatch, getMediaUploadKey, mediaList, navigation, saveDraft, selectedSpot, state, validation]);

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

  const closeEditor = useCallback(() => {
    const leave = async () => {
      if (hasDraftPayload) {
        try {
          await saveDraft();
        } catch (_err) {
          Alert.alert('草稿保存失败', '当前内容还没有退出，请检查存储空间后重试。');
          return;
        }
      }
      if (navigation.canGoBack && navigation.canGoBack()) {
        navigation.goBack();
        return;
      }
      const parent = navigation.getParent && navigation.getParent();
      if (parent) parent.navigate(APP_ROUTES.DISCOVERY);
    };
    if (!hasDraftPayload) {
      leave();
      return;
    }
    Alert.alert(
      '退出发布？',
      '草稿会保留，之后可以继续编辑。',
      [
        { text: '继续编辑', style: 'cancel' },
        { text: '退出', style: 'destructive', onPress: leave },
      ],
    );
  }, [hasDraftPayload, navigation, saveDraft]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        style={styles.flex}
      >
        <ScrollView style={styles.flex} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.titleRow}>
            <View style={styles.titleCopy}>
              <Text style={styles.title}>发布出片</Text>
              <Text style={styles.subtitle}>先发出来，拍摄参数和攻略之后再补也可以</Text>
            </View>
            <Pressable
              style={styles.closeBtn}
              onPress={closeEditor}
              accessibilityRole="button"
              accessibilityLabel="关闭发布编辑器"
            >
              <Text style={styles.closeText}>关闭</Text>
            </Pressable>
          </View>
          <View style={styles.rewardHint}>
            <Pressable
              style={styles.rewardHintHeader}
              onPress={() => setRewardOpen((value) => !value)}
              accessibilityRole="button"
              accessibilityState={{ expanded: rewardOpen }}
            >
              <Text style={styles.rewardHintTitle}>发布即可得 +5 贡献值</Text>
              <Text style={styles.rewardHintStatus}>
                {rewardOpen ? '收起' : (rewardPreview.guideReady ? '攻略 +15 已解锁' : '攻略奖励 +15')}
              </Text>
            </Pressable>
            {rewardOpen ? (
              <>
                <View style={styles.rewardMeter}>
              <View style={styles.rewardMeterRow}>
                <View style={styles.rewardMeterLabels}>
                  <Text style={styles.rewardMeterLabel}>正文</Text>
                  <Text style={styles.rewardMeterValue}>{Math.min(rewardPreview.contentLength, 120)}/120</Text>
                </View>
                <View style={styles.rewardTrack}>
                  <View style={[styles.rewardFill, { width: `${rewardPreview.contentProgress * 100}%` }]} />
                </View>
              </View>
              <View style={styles.rewardMeterRow}>
                <View style={styles.rewardMeterLabels}>
                  <Text style={styles.rewardMeterLabel}>拍摄参数</Text>
                  <Text style={styles.rewardMeterValue}>{Math.min(rewardPreview.metadataCount, 3)}/3</Text>
                </View>
                <View style={styles.rewardTrack}>
                  <View style={[styles.rewardFill, { width: `${rewardPreview.metadataProgress * 100}%` }]} />
                </View>
              </View>
                </View>
                <Text style={styles.rewardHintText}>{rewardPreview.earnedHint}</Text>
              </>
            ) : (
              <Text style={styles.rewardHintText}>{rewardPreview.earnedHint}</Text>
            )}
          </View>
          {!!validation.firstError ? <Text style={styles.validationMsg}>{validation.firstError}</Text> : null}
          {!!publishError ? <Text style={styles.publishError} accessibilityLiveRegion="polite">{publishError}</Text> : null}
          {draftLoaded ? <Text style={styles.draftHint}>已读取本地草稿，继续编辑即可接续发布。</Text> : null}
          {draftMediaWarning ? <Text style={styles.draftMediaWarning}>{draftMediaWarning}</Text> : null}

          {(draftLoaded || hasDraftPayload) ? (
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
          ) : null}

          <Text style={styles.sectionTitle}>素材</Text>
          <Text style={[styles.note, validation.errors.media && styles.mediaError]}>{validation.errors.media || '先选 1-9 个素材，再补齐机位与拍摄参数；视频最大 40s，实况仅支持 iPhone'}</Text>
          <View style={styles.mediaActions}>
            <Pressable style={styles.mediaBtn} onPress={pickFromLibrary}>
              <Text style={styles.mediaBtnText}>从相册</Text>
            </Pressable>
            <Pressable style={styles.mediaBtn} onPress={shootWithCamera}>
              <Text style={styles.mediaBtnText}>拍摄</Text>
            </Pressable>
            <Pressable
              style={[styles.mediaBtn, Platform.OS !== 'ios' && styles.mediaBtnDisabled]}
              onPress={addLivePhoto}
              disabled={Platform.OS !== 'ios'}
              accessibilityLabel="添加实况照片，仅支持 iPhone"
            >
              <Text style={styles.mediaBtnText}>{Platform.OS === 'ios' ? '实况' : '实况 · iOS'}</Text>
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

        <PostInput
          label="标题（可选）"
          error={validation.errors.title}
          value={state.title}
          onChange={(value) => setField('title', value)}
          placeholder="例如：海珠夜景｜广州塔"
          maxLength={90}
        />

        <FormSection
          title="出片位置"
          summary={state.spotName || (state.latitude && state.longitude) ? '已记录位置，可补充点位名称' : '可选，之后也能从地图补充'}
          expanded={locationOpen}
          onToggle={() => setLocationOpen((value) => !value)}
        >
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
            label="地点名称（可选）"
            error={validation.errors.spotName}
            value={state.spotName}
            onChange={(value) => setField('spotName', value)}
            placeholder="如：海珠区江湾路"
            maxLength={80}
          />
          <PostInput
            label="行政区（可选）"
            error={validation.errors.district}
            value={state.district}
            onChange={(value) => setField('district', value)}
            placeholder="如：海珠区"
            maxLength={24}
          />
        </FormSection>

        <FormSection
          title="拍摄信息"
          summary={[
            state.shotAt ? '已记录时间' : '',
            state.angle,
            state.direction,
            state.bestTime,
          ].filter(Boolean).join(' · ') || '时间、角度、光线与时间窗口'}
          expanded={shootingOpen}
          onToggle={() => setShootingOpen((value) => !value)}
        >
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
        </FormSection>

        <FormSection
          title="镜头参数"
          summary={[state.camera, state.lens, state.focal].filter(Boolean).join(' · ') || '机身、镜头、焦距、曝光与白平衡'}
          expanded={advancedOpen}
          onToggle={() => setAdvancedOpen((value) => !value)}
        >
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
        </FormSection>

        <Text style={styles.sectionTitle}>正文 / 攻略（可选）</Text>
        <PostInput
          label="正文 / 攻略"
          error={validation.errors.content}
          value={state.content}
          onChange={(value) => setField('content', value)}
          placeholder="记录时间、天气、机位、拍摄流程、避坑提醒"
          multiline
          maxLength={3000}
          help="补充 120 字和 3 项拍摄参数，可获得额外贡献值"
        />
        <FormSection
          title="标签与风格"
          summary={[state.tags, state.stylesText].filter(Boolean).join(' · ') || '可选，帮助更多人找到攻略'}
          expanded={tagsOpen}
          onToggle={() => setTagsOpen((value) => !value)}
        >
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
        </FormSection>

        <FormSection
          title="作者信息"
          summary={state.author || '昵称与拍摄偏好（可选）'}
          expanded={authorOpen}
          onToggle={() => setAuthorOpen((value) => !value)}
        >
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
        </FormSection>

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

        </ScrollView>
        <View style={styles.publishDock}>
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
          {submitting && uploadProgress ? (
            <Text style={styles.uploadProgress}>
              {uploadProgress.phase === 'publishing'
                ? '正在发布作品'
                : `正在上传素材 ${uploadProgress.completed}/${uploadProgress.total}`}
            </Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: COLORS.bg },
  body: { padding: 16, paddingBottom: 96 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  titleCopy: { flex: 1 },
  title: { fontSize: 24, color: COLORS.ink, fontWeight: '700' },
  subtitle: { color: COLORS.muted, marginTop: 3, marginBottom: 12, fontSize: 12.5 },
  closeBtn: { paddingHorizontal: 4, paddingVertical: 6 },
  closeText: { color: COLORS.muted, fontSize: 12.5, fontWeight: '700' },
  rewardHint: {
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: COLORS.accentBg,
  },
  rewardHintHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  rewardHintTitle: { color: COLORS.accent, fontSize: 13, fontWeight: '700' },
  rewardHintStatus: { color: COLORS.accent, fontSize: 10.5, fontWeight: '700' },
  rewardMeter: { marginTop: 8, gap: 6 },
  rewardMeterRow: { gap: 3 },
  rewardMeterLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  rewardMeterLabel: { color: COLORS.muted, fontSize: 10.5 },
  rewardMeterValue: { color: COLORS.ink, fontSize: 10.5, fontWeight: '700' },
  rewardTrack: {
    height: 4,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: COLORS.cardBorder,
  },
  rewardFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: COLORS.accent,
  },
  rewardHintText: { color: COLORS.muted, fontSize: 11.5, marginTop: 7 },
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
  formSection: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.cardBorder,
  },
  formSectionHeader: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  formSectionCopy: { flex: 1 },
  formSectionSummary: {
    color: COLORS.muted,
    fontSize: 11.5,
    marginTop: -4,
    paddingBottom: 9,
  },
  formSectionChevron: {
    color: COLORS.accent,
    fontSize: 24,
    fontWeight: '400',
    paddingHorizontal: 8,
  },
  formSectionBody: {
    paddingBottom: 4,
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
  mediaBtnDisabled: {
    opacity: 0.48,
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
  draftMediaWarning: {
    marginTop: 4,
    color: '#a34a2a',
    fontSize: 12,
    lineHeight: 18,
  },
  formActions: {
    marginTop: 6,
    marginBottom: 4,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
  },
  secondaryBtn: {
    paddingVertical: 7,
    paddingHorizontal: 2,
    alignItems: 'center',
  },
  secondaryBtnDisabled: {
    opacity: 0.45,
  },
  secondaryBtnText: {
    color: COLORS.muted,
    fontWeight: '600',
    fontSize: 12,
  },
  publishBtn: {
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: COLORS.accent,
  },
  publishBtnDisabled: {
    opacity: 0.6,
  },
  publishDock: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    backgroundColor: COLORS.panel,
  },
  uploadProgress: {
    marginTop: 5,
    color: COLORS.muted,
    fontSize: 11.5,
    textAlign: 'center',
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
  publishError: {
    color: '#a34a2a',
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
  },
  previewWrap: {
    marginTop: 10,
  },
});
