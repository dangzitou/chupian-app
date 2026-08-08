import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { COLORS } from '../../config';

export default function PostInput({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
  maxLength,
  help,
  keyboardType = 'default',
  numberOfLines = 1,
}) {
  const lengthHint = maxLength ? `${String(value || '').length}/${maxLength}` : null;

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.multiline]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={COLORS.muted}
        multiline={multiline}
        numberOfLines={numberOfLines}
        maxLength={maxLength}
        keyboardType={keyboardType}
      />
      <View style={styles.footer}>
        {help ? <Text style={styles.help}>{help}</Text> : null}
        {lengthHint ? <Text style={styles.length}>{lengthHint}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 12 },
  label: { color: COLORS.muted, fontSize: 12.5, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    fontSize: 14,
    color: COLORS.ink,
    paddingHorizontal: 12,
    paddingVertical: 11,
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
  help: { color: COLORS.muted, fontSize: 11.5 },
  length: { color: COLORS.muted, fontSize: 11 },
});
