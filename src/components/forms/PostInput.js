import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { COLORS } from '../../config';

export default function PostInput({
  label,
  value,
  onChange,
  placeholder,
  error,
  multiline = false,
  maxLength,
  help,
  optional = true,
  keyboardType = 'default',
  numberOfLines = 1,
}) {
  const lengthHint = maxLength ? `${String(value || '').length}/${maxLength}` : null;
  const currentHelp = error || help;
  const hasFooter = currentHelp || lengthHint;

  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, error && styles.labelError]}>{label}</Text>
        {optional ? <Text style={styles.optional}>可选</Text> : null}
      </View>
      <TextInput
        style={[
          styles.input,
          multiline && styles.multiline,
          error && styles.inputError,
        ]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={COLORS.muted}
        multiline={multiline}
        numberOfLines={numberOfLines}
        maxLength={maxLength}
        keyboardType={keyboardType}
        accessibilityLabel={optional ? `${label}，可选` : label}
        accessibilityHint={help || undefined}
      />
      {hasFooter ? (
        <View style={styles.footer}>
          {currentHelp ? (
            <Text style={[styles.help, error && styles.error]}>{currentHelp}</Text>
          ) : null}
          {lengthHint ? <Text style={styles.length}>{lengthHint}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 12 },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  label: { color: COLORS.ink, fontSize: 12.5, fontWeight: '700' },
  optional: { color: COLORS.mutedText || COLORS.muted, fontSize: 10, letterSpacing: 0.25 },
  input: {
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.card,
    borderRadius: 10,
    fontSize: 14,
    color: COLORS.ink,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  multiline: {
    minHeight: 116,
    textAlignVertical: 'top',
  },
  footer: {
    marginTop: 5,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  labelError: {
    color: '#b84b4b',
  },
  help: { color: COLORS.muted, fontSize: 11.5 },
  error: { color: '#b84b4b' },
  inputError: {
    borderColor: '#da7474',
  },
  length: { color: COLORS.muted, fontSize: 11 },
});
