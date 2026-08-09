import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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

export default function AuthScreen({ navigation }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isRegister = mode === 'register';
  const title = isRegister ? '建立你的拍摄档案' : '登录出片地图';
  const submitLabel = useMemo(() => (isRegister ? '注册并继续' : '登录'), [isRegister]);

  const submit = useCallback(async () => {
    setError('');
    const nextUsername = username.trim();
    if (nextUsername.length < 3) {
      setError('用户名至少 3 位');
      return;
    }
    if (password.length < 8) {
      setError('密码至少 8 位');
      return;
    }
    if (isRegister && !displayName.trim()) {
      setError('请填写昵称');
      return;
    }
    setBusy(true);
    try {
      if (isRegister) {
        await api.register(nextUsername, password, displayName.trim());
      } else {
        await api.login(nextUsername, password);
      }
      navigation.goBack();
    } catch (err) {
      setError(err?.cause || err?.message || '操作失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  }, [displayName, isRegister, navigation, password, username]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable style={styles.back} onPress={() => navigation.goBack()} accessibilityRole="button">
            <Text style={styles.backText}>‹ 返回</Text>
          </Pressable>
          <View style={styles.brandMark}><Text style={styles.brandPlus}>＋</Text></View>
          <Text style={styles.eyebrow}>CHUPIAN / CREATOR IDENTITY</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>
            {isRegister ? '注册后可在不同设备找回作品、点赞、收藏和关注关系。' : '登录后继续管理你的出片记录。'}
          </Text>

          {isRegister ? (
            <TextInput
              style={styles.input}
              placeholder="昵称"
              placeholderTextColor={COLORS.muted}
              value={displayName}
              onChangeText={setDisplayName}
              maxLength={64}
              returnKeyType="next"
            />
          ) : null}
          <TextInput
            style={styles.input}
            placeholder="用户名"
            placeholderTextColor={COLORS.muted}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={32}
            returnKeyType="next"
          />
          <TextInput
            style={styles.input}
            placeholder="密码（至少 8 位）"
            placeholderTextColor={COLORS.muted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={128}
            returnKeyType="done"
            onSubmitEditing={submit}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={[styles.submit, busy && styles.submitDisabled]} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color={COLORS.onAccent} /> : <Text style={styles.submitText}>{submitLabel}</Text>}
          </Pressable>
          <Pressable
            style={styles.switch}
            onPress={() => {
              setMode((value) => (value === 'login' ? 'register' : 'login'));
              setError('');
            }}
          >
            <Text style={styles.switchText}>
              {isRegister ? '已有账号？返回登录' : '还没有账号？注册拍摄档案'}
            </Text>
          </Pressable>
          <Pressable
            style={styles.guestEntry}
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="先浏览，不注册"
          >
            <Text style={styles.guestTitle}>先看看，不注册</Text>
            <Text style={styles.guestSubtitle}>地图、出片点和公开作品都可以先浏览</Text>
          </Pressable>
          <Text style={styles.privacy}>密码仅以加盐 scrypt 摘要存储，不保存明文。</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 32 },
  back: { alignSelf: 'flex-start', paddingVertical: 8, paddingRight: 12 },
  backText: { color: COLORS.muted, fontSize: 14, fontWeight: '600' },
  brandMark: {
    width: 48,
    height: 48,
    borderRadius: 16,
    marginTop: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.accent,
  },
  brandPlus: { color: COLORS.white, fontSize: 28, lineHeight: 32, fontWeight: '300' },
  eyebrow: { color: COLORS.accent, fontSize: 10, letterSpacing: 1.4, marginTop: 22, fontWeight: '700' },
  title: { color: COLORS.ink, fontSize: 28, lineHeight: 35, fontWeight: '800', marginTop: 8 },
  subtitle: { color: COLORS.muted, fontSize: 13, lineHeight: 20, marginTop: 8, marginBottom: 24 },
  input: {
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.white,
    color: COLORS.ink,
    fontSize: 15,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  error: { color: '#b43a41', fontSize: 12.5, lineHeight: 18, marginTop: 2, marginBottom: 8 },
  submit: {
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.accent,
    marginTop: 8,
  },
  submitDisabled: { opacity: 0.65 },
  submitText: { color: COLORS.onAccent, fontSize: 15, fontWeight: '800' },
  switch: { alignItems: 'center', paddingVertical: 18 },
  switchText: { color: COLORS.accent, fontSize: 13, fontWeight: '700' },
  guestEntry: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: 'rgba(255,255,255,0.6)',
    paddingVertical: 11,
    paddingHorizontal: 14,
    marginBottom: 18,
  },
  guestTitle: { color: COLORS.ink, fontSize: 13, fontWeight: '700' },
  guestSubtitle: { color: COLORS.muted, fontSize: 11.5, marginTop: 3 },
  privacy: { color: COLORS.mutedText, fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 'auto' },
});
