import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api';
import { COLORS } from '../config';
import Avatar from '../components/Avatar';
import { buildSessionIdempotencyKey } from '../lib/idempotency';
import AppIcon from '../components/AppIcon';

export default function EditProfileScreen({ navigation }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUri, setAvatarUri] = useState('');
  const [avatarAsset, setAvatarAsset] = useState(null);
  const [initialDisplayName, setInitialDisplayName] = useState('');
  const [initialBio, setInitialBio] = useState('');
  const [initialAvatar, setInitialAvatar] = useState('');
  const [loading, setLoading] = useState(true);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const avatarUploadKeyRef = useRef('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api.me().then((result) => {
      if (!alive) return;
      const nextUsername = result?.user?.username || '';
      const nextDisplayName = result?.user?.displayName || '';
      const nextBio = result?.user?.bio || '';
      const nextAvatar = result?.user?.avatar || result?.user?.avatarUrl || '';
      setUsername(nextUsername);
      setDisplayName(nextDisplayName);
      setBio(nextBio);
      setAvatarUri(nextAvatar);
      setInitialDisplayName(nextDisplayName);
      setInitialBio(nextBio);
      setInitialAvatar(nextAvatar);
      setProfileLoaded(true);
    }).catch((err) => {
      if (alive) {
        setProfileLoaded(false);
        setError(err?.cause || err?.message || '资料加载失败');
      }
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [loadAttempt]);

  const hasChanges = displayName.trim() !== initialDisplayName
    || bio.trim() !== initialBio
    || avatarUri.trim() !== initialAvatar.trim();

  const pickAvatar = useCallback(async () => {
    if (saving || !profileLoaded) return;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError('需要相册权限才能更换头像');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (result.canceled || !result.assets?.[0]) return;
      setAvatarAsset(result.assets[0]);
      setAvatarUri(result.assets[0].uri || '');
      avatarUploadKeyRef.current = '';
      setError('');
    } catch (err) {
      setError(err?.message || '选择头像失败，请重试');
    }
  }, [saving]);

  const requestBack = useCallback(() => {
    if (saving) return;
    if (!hasChanges) {
      navigation.goBack();
      return;
    }
    Alert.alert('放弃未保存修改？', '返回后，本次编辑的昵称和简介不会保留。', [
      { text: '继续编辑', style: 'cancel' },
      { text: '放弃修改', style: 'destructive', onPress: () => navigation.goBack() },
    ]);
  }, [hasChanges, navigation, saving]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (saving) {
        event.preventDefault();
        return;
      }
      if (!hasChanges) return;
      event.preventDefault();
      Alert.alert('放弃未保存修改？', '返回后，本次编辑的昵称和简介不会保留。', [
        { text: '继续编辑', style: 'cancel' },
        {
          text: '放弃修改',
          style: 'destructive',
          onPress: () => navigation.dispatch(event.data.action),
        },
      ]);
    });
    return unsubscribe;
  }, [hasChanges, navigation, saving]);

  const save = useCallback(async () => {
    if (!profileLoaded) return;
    const nextName = displayName.trim();
    const nextBio = bio.trim();
    if (!nextName) {
      setError('昵称不能为空');
      return;
    }
    if (nextName.length > 64 || nextBio.length > 160) {
      setError('昵称最多 64 个字符，简介最多 160 个字符');
      return;
    }
    setSaving(true);
    setError('');
    try {
      let nextAvatar = avatarUri.trim();
      if (avatarAsset?.uri && nextAvatar !== initialAvatar.trim()) {
        if (!avatarUploadKeyRef.current) {
          avatarUploadKeyRef.current = buildSessionIdempotencyKey('profile-avatar', nextAvatar);
        }
        const uploaded = await api.uploadMedia(
          avatarAsset.uri,
          avatarAsset.mimeType || 'image/jpeg',
          'image',
          avatarAsset.file,
          avatarUploadKeyRef.current,
        );
        nextAvatar = String(uploaded?.media?.[0]?.url || '').trim();
        if (!nextAvatar) throw new Error('头像上传失败，请重试');
      }
      await api.updateProfile(nextName, nextBio, nextAvatar);
      setInitialDisplayName(nextName);
      setInitialBio(nextBio);
      setInitialAvatar(nextAvatar);
      setAvatarUri(nextAvatar);
      setAvatarAsset(null);
      avatarUploadKeyRef.current = '';
      Alert.alert('资料已更新', '新的昵称和简介已同步到你的作品。', [
        { text: '好的', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      setError(err?.cause || err?.message || '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  }, [avatarAsset, avatarUri, bio, displayName, initialAvatar, navigation, profileLoaded]);

  const profileUnavailable = !loading && !profileLoaded;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={requestBack} accessibilityRole="button" accessibilityLabel="返回">
          <AppIcon name="chevronLeft" size={19} color={COLORS.ink} stroke={1.8} />
        </Pressable>
        <Text style={styles.headerTitle}>编辑资料</Text>
        <View style={styles.headerSpacer} />
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Pressable
            style={styles.avatarPicker}
            onPress={pickAvatar}
            disabled={loading || saving || profileUnavailable}
            accessibilityRole="button"
            accessibilityLabel="更换头像"
          >
            <Avatar name={displayName || '拍友'} uri={avatarUri} size={64} />
            <Text style={styles.avatarChange}>更换头像</Text>
          </Pressable>
          <Text style={styles.kicker}>CREATOR PROFILE</Text>
          <Text style={styles.title}>让别人知道你怎么拍</Text>
          <Text style={styles.subtitle}>昵称会同步到历史作品、评论和互动消息。</Text>

          <Text style={styles.label}>用户名</Text>
          <View style={styles.readonly}><Text style={styles.readonlyText}>{loading ? '加载中...' : `@${username}`}</Text></View>

          <Text style={styles.label}>昵称</Text>
          <TextInput
            style={styles.input}
            value={displayName}
            onChangeText={setDisplayName}
            maxLength={64}
            placeholder="你的拍摄昵称"
            placeholderTextColor={COLORS.muted}
            editable={!loading && !saving && !profileUnavailable}
          />
          <Text style={styles.counter}>{displayName.length}/64</Text>

          <Text style={styles.label}>简介</Text>
          <TextInput
            style={[styles.input, styles.bioInput]}
            value={bio}
            onChangeText={setBio}
            maxLength={160}
            multiline
            textAlignVertical="top"
            placeholder="例如：夜景、街头和城市边缘"
            placeholderTextColor={COLORS.muted}
            editable={!loading && !saving && !profileUnavailable}
          />
          <Text style={styles.counter}>{bio.length}/160</Text>

          {profileUnavailable ? (
            <View style={styles.loadError}>
              <Text style={styles.error}>{error || '资料暂时无法加载'}</Text>
              <Pressable
                style={styles.loadRetry}
                onPress={() => setLoadAttempt((value) => value + 1)}
                accessibilityRole="button"
                accessibilityLabel="重新加载资料"
              >
                <Text style={styles.loadRetryText}>重新加载</Text>
              </Pressable>
            </View>
          ) : (error ? <Text style={styles.error}>{error}</Text> : null)}
          <Pressable style={[styles.save, (loading || saving || profileUnavailable) && styles.saveDisabled]} onPress={save} disabled={loading || saving || profileUnavailable}>
            {saving ? <ActivityIndicator color={COLORS.onAccent} /> : <Text style={styles.saveText}>保存资料</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { height: 54, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: COLORS.line, backgroundColor: COLORS.panel },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backText: { color: COLORS.ink, fontSize: 34, lineHeight: 36, fontWeight: '300' },
  headerTitle: { color: COLORS.ink, fontSize: 16, fontWeight: '800' },
  headerSpacer: { width: 40 },
  body: { padding: 20, paddingBottom: 40 },
  avatarPicker: { alignItems: 'center', alignSelf: 'flex-start' },
  avatarChange: { color: COLORS.accent, fontSize: 11.5, fontWeight: '700', marginTop: 7 },
  kicker: { color: COLORS.accent, fontSize: 10, letterSpacing: 1.2, fontWeight: '800', marginTop: 22 },
  title: { color: COLORS.ink, fontSize: 25, lineHeight: 32, fontWeight: '800', marginTop: 5 },
  subtitle: { color: COLORS.muted, fontSize: 13, lineHeight: 19, marginTop: 7, marginBottom: 24 },
  label: { color: COLORS.ink, fontSize: 12.5, fontWeight: '700', marginBottom: 7, marginTop: 14 },
  readonly: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12, backgroundColor: COLORS.bgDeep },
  readonlyText: { color: COLORS.muted, fontSize: 14 },
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.panel, color: COLORS.ink, fontSize: 14.5, paddingHorizontal: 14 },
  bioInput: { minHeight: 108, paddingTop: 13, paddingBottom: 13, lineHeight: 20 },
  counter: { color: COLORS.muted, fontSize: 10.5, textAlign: 'right', marginTop: 4 },
  error: { color: '#b43a41', fontSize: 12.5, lineHeight: 18, marginTop: 14 },
  loadError: { alignItems: 'center', marginTop: 8 },
  loadRetry: { marginTop: 10, paddingHorizontal: 15, paddingVertical: 8, borderRadius: 999, backgroundColor: COLORS.accentBg },
  loadRetryText: { color: COLORS.accent, fontSize: 12.5, fontWeight: '700' },
  save: { height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.accent, marginTop: 22 },
  saveDisabled: { opacity: 0.6 },
  saveText: { color: COLORS.onAccent, fontSize: 15, fontWeight: '800' },
});
