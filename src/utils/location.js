import { Platform } from 'react-native';

function normalizeLocation(raw) {
  const lat = Number(raw?.lat ?? raw?.latitude);
  const lng = Number(raw?.lng ?? raw?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('invalid location');
  }
  return {
    lat,
    lng,
    label: String(raw?.label || '我的位置'),
  };
}

function getBrowserLocation() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.reject(new Error('geolocation unavailable'));
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        try {
          resolve(normalizeLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            label: '我的位置',
          }));
        } catch (error) {
          reject(error);
        }
      },
      reject,
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}

export async function getCurrentLocation() {
  if (Platform.OS === 'web') return getBrowserLocation();

  const Location = await import('expo-location');
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') {
    const error = new Error('location permission denied');
    error.code = 'PERMISSION_DENIED';
    throw error;
  }

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  return normalizeLocation({
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    label: '我的位置',
  });
}
