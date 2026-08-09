import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../config';

function getInitials(name) {
  return String(name || '匿名拍友').trim().slice(0, 2) || '拍';
}

export default function Avatar({ name, uri, size = 32, style, textStyle }) {
  const normalizedUri = String(uri || '').trim();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [normalizedUri]);

  const dimension = Math.max(20, Number(size) || 32);
  const fontSize = Math.max(10, Math.round(dimension * 0.4));

  return (
    <View
      style={[styles.base, { width: dimension, height: dimension, borderRadius: dimension / 2 }, style]}
      accessible
      accessibilityLabel={`${name || '匿名拍友'}的头像`}
    >
      {normalizedUri && !failed ? (
        <Image
          source={{ uri: normalizedUri }}
          style={[StyleSheet.absoluteFillObject, { borderRadius: dimension / 2 }]}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Text style={[styles.text, { fontSize }, textStyle]} numberOfLines={1}>
          {getInitials(name)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: COLORS.accentBg,
  },
  text: {
    color: COLORS.accent,
    fontWeight: '800',
  },
});
