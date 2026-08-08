import React, { useCallback, useEffect, useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api';
import { COLORS } from '../config';

export default function EditProfileScreen({ navigation }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api.me().then((result) => {
      if (!alive) return;
      setUsername(result?.user?.username || '');
      setDisplayName(result?.user?.displayName || '');
      setBio(result?.user?.bio || '');
    }).catch((err) => {
      if (alive) setError(err?.cause || err?.message || '资料加载失败');
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const save = useCallback(async () => {
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
      await api.updateProfile(nextName, nextBio);
      Alert.alert('资料已更新', '新的昵称和简介已同步到你的作品。', [
        { text: '好的', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      setError(err?.cause || err?.message || '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  }, [bio, displayName, navigation]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="返回">
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>编辑资料</Text>
        <View style={styles.headerSpacer} />
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.avatar}><Text style={styles.avatarText}>{String(displayName || '拍友').slice(0, 2)}</Text></View>
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
            editable={!loading && !saving}
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
            placeholder="例如：广州夜景、街头和城市边缘"
            placeholderTextColor={COLORS.muted}
            editable={!loading && !saving}
          />
          <Text style={styles.counter}>{bio.length}/160</Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={[styles.save, (loading || saving) && styles.saveDisabled]} onPress={save} disabled={loading || saving}>
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
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: COLORS.accentSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: COLORS.accent, fontSize: 19, fontWeight: '800' },
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
  save: { height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.accent, marginTop: 22 },
  saveDisabled: { opacity: 0.6 },
  saveText: { color: COLORS.onAccent, fontSize: 15, fontWeight: '800' },
});
