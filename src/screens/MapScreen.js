import React, { createElement, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { COLORS } from '../config';
import { WebView } from 'react-native-webview';
import { api } from '../api';
import { APP_ROUTES } from '../constants/routes';

const DEFAULT_CENTER = {
  lat: 23.129163,
  lng: 113.264435,
  label: '广州',
};

const FALLBACK_MARKER = `
  <div style=\"font-size:12px;line-height:1.4; padding:4px 8px;\">
    <div><strong>出发点</strong></div>
    <div>广州 · 定位未知</div>
  </div>
`;

const sanitize = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export default function MapScreen({ navigation }) {
  const [error, setError] = useState(false);
  const [spots, setSpots] = useState([]);
  const [posts, setPosts] = useState([]);
  const [currentLocation, setCurrentLocation] = useState(DEFAULT_CENTER);

  const mapHtml = useMemo(() => {
    const safeSpots = Array.isArray(spots) ? spots.filter((item) => {
      const lat = Number(item?.lat);
      const lng = Number(item?.lng);
      return Number.isFinite(lat) && Number.isFinite(lng);
    }).map((item) => ({
      id: String(item.id || ''),
      type: 'spot',
      name: sanitize(item.name),
      district: sanitize(item.district || ''),
      lat: Number(item.lat),
      lng: Number(item.lng),
    })) : [];

    const safePosts = Array.isArray(posts) ? posts.filter((item) => {
      const lat = Number(item?.latitude ?? item?.lat);
      const lng = Number(item?.longitude ?? item?.lng);
      return Number.isFinite(lat) && Number.isFinite(lng);
    }).map((item) => ({
      id: String(item.id || ''),
      type: 'post',
      name: sanitize(item.title || '出片帖子'),
      district: sanitize(item.district || ''),
      lat: Number(item.latitude ?? item.lat),
      lng: Number(item.longitude ?? item.lng),
    })) : [];

    const spotsPayload = JSON.stringify([...safeSpots, ...safePosts]);

    return `<!doctype html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width,height=device-height,initial-scale=1.0,maximum-scale=1.0,user-scalable=no" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css"
        />
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        />
        <script
          src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"
          onerror="this.onerror=null;this.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';"
        ></script>
        <style>
          html, body, #app { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; }
          .map { width: 100%; height: 100%; background: #e9eef5; }
          .pulse {
            width: 12px;
            height: 12px;
            background: #e53935;
            border-radius: 999px;
            animation: ping 1.2s ease-in-out infinite;
            box-shadow: 0 0 0 0 rgba(229,57,53,0.45);
          }
          @keyframes ping {
            70% { box-shadow: 0 0 0 14px rgba(229,57,53,0); }
            100% { box-shadow: 0 0 0 0 rgba(229,57,53,0); }
          }
          .open-btn {
            font-size: 12px;
            margin-top: 6px;
            border: none;
            border-radius: 999px;
            padding: 6px 10px;
            color: #fff;
            background: #d93657;
            cursor: pointer;
          }
          .spot-popup {
            font-size: 12px;
            line-height: 1.35;
            max-width: 210px;
            color: #232323;
          }
          .spot-popup button {
            margin-top: 7px;
            border: none;
            border-radius: 999px;
            background: #d93657;
            color: #fff;
            padding: 6px 10px;
            width: 100%;
            cursor: pointer;
          }
        </style>
      </head>
      <body>
        <div id="app">
          <div id="map" class="map"></div>
        </div>
        <script>
          (function () {
            const fallbackLat = ${DEFAULT_CENTER.lat};
            const fallbackLng = ${DEFAULT_CENTER.lng};
            const fallbackName = '${DEFAULT_CENTER.label}';
            const markers = ${spotsPayload};
            const emit = (payload) => {
              const message = JSON.stringify(payload || {});
              if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
                window.ReactNativeWebView.postMessage(message);
              }
              if (window.parent && window.parent !== window) {
                window.parent.postMessage(message, '*');
              }
            };
            const escapeText = (value) => {
              return String(value || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\"/g, '&quot;')
                .replace(/'/g, '&#39;');
            };
            const renderMarkerPopup = (item) => {
              const name = escapeText(item.name || '未知点位');
              const district = escapeText(item.district || '');
              if (item.type === 'post') {
                return (
                  '<div class="spot-popup">' +
                    '<strong>' + name + '</strong><br/>' +
                    (district ? district + '<br/>' : '') +
                    '<button type="button" onclick="(function(){ window.__openPost && window.__openPost(' +
                    item.id + ') })()">查看帖子</button>' +
                  '</div>'
                );
              }
              return (
                '<div class=\"spot-popup\">' +
                  '<strong>' + name + '</strong><br/>' +
                  (district ? district + '<br/>' : '') +
                  '<button type=\"button\" onclick=\"(function(){ window.__pickSpot && window.__pickSpot(' +
                  item.id + ') })()\">发布此点</button>' +
                '</div>'
              );
            };

            function render(lat, lng, label) {
              emit({
                type: 'locationReady',
                location: { lat: Number(lat), lng: Number(lng), label: label || fallbackName },
              });
              const map = L.map('map', {
                zoomControl: true,
                attributionControl: false,
                preferCanvas: true,
              }).setView([lat, lng], 15);
              L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap',
                maxZoom: 19,
              }).addTo(map);
              L.marker([lat, lng], {
                title: '我在这里',
              }).addTo(map).bindPopup('我在这里');
              L.circleMarker([lat, lng], {
                radius: 8,
                color: '#e53935',
                fillColor: '#e53935',
                fillOpacity: 1,
                weight: 2,
              }).addTo(map);
              L.circleMarker([lat, lng], {
                radius: 16,
                color: 'rgba(229,57,53,0.55)',
                fillColor: 'rgba(229,57,53,0.15)',
                fillOpacity: 0.75,
                weight: 0,
              }).addTo(map);
              const fallbackMarker = L.divIcon({
                className: '',
                html: '<div class=\"pulse\"></div>',
                iconSize: [14, 14],
                iconAnchor: [7, 7],
              });
              L.marker([lat, lng], { icon: fallbackMarker }).addTo(map).bindPopup('${FALLBACK_MARKER}');

              window.__pickSpot = (id) => {
                const target = markers.find((item) => item.type === 'spot' && String(item.id) === String(id));
                if (!target) {
                  emit({
                    type: 'openCreate',
                    spot: { id: '', name: '广州', district: '' },
                  });
                  return;
                }
                emit({
                  type: 'openCreate',
                  spot: {
                    id: String(target.id),
                    name: target.name,
                    district: target.district,
                  },
                });
              };

              window.__openPost = (id) => {
                const target = markers.find((item) => item.type === 'post' && String(item.id) === String(id));
                if (!target) return;
                emit({ type: 'openPost', postId: String(target.id) });
              };

              markers.forEach((item) => {
                if (!item) return;
                const marker = L.marker([item.lat, item.lng], { title: item.name || '拍摄点' })
                  .addTo(map)
                  .bindPopup(renderMarkerPopup(item));
                marker.on('popupopen', () => {
                  window.__activeSpot = item;
                });
              });
            }

            if (!('geolocation' in navigator)) {
              return render(fallbackLat, fallbackLng, fallbackName);
            }

            navigator.geolocation.getCurrentPosition(
              (position) => {
                const lat = Number(position.coords.latitude);
                const lng = Number(position.coords.longitude);
                if (Number.isFinite(lat) && Number.isFinite(lng)) {
                  render(lat, lng, '我的位置');
                } else {
                  render(fallbackLat, fallbackLng, fallbackName);
                }
              },
              () => {
                render(fallbackLat, fallbackLng, fallbackName);
              },
              { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
            );
          })();
        </script>
      </body>
    </html>`;
  }, [posts, spots]);

  const onOpenCreate = useCallback((spot) => {
    if (!navigation || !APP_ROUTES || !APP_ROUTES.CREATE) return;

    const parent = navigation.getParent && navigation.getParent();
    if (parent) {
      parent.navigate(APP_ROUTES.CREATE, { prefillSpot: spot });
      return;
    }

    navigation.navigate(APP_ROUTES.CREATE, { prefillSpot: spot });
  }, [navigation]);

  const onOpenPost = useCallback((postId) => {
    const parent = navigation?.getParent && navigation.getParent();
    if (parent) {
      parent.navigate(APP_ROUTES.DISCOVERY, {
        screen: 'PostDetail',
        params: { postId: String(postId) },
      });
      return;
    }
    navigation.navigate('PostDetail', { postId: String(postId) });
  }, [navigation]);

  const onWebMessage = useCallback(async (event) => {
    const raw = event?.nativeEvent?.data;
    if (!raw) return;
    try {
      const payload = JSON.parse(raw);
      if (payload?.type === 'locationReady') {
        const lat = Number(payload?.location?.lat);
        const lng = Number(payload?.location?.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          setCurrentLocation({
            lat,
            lng,
            label: String(payload?.location?.label || '我的位置'),
          });
        }
        return;
      }
      if (payload?.type === 'openCreate') {
        onOpenCreate(payload?.spot);
        return;
      }
      if (payload?.type === 'openPost' && payload?.postId) {
        onOpenPost(payload.postId);
      }
    } catch (_err) {
      // ignore
    }
  }, [onOpenCreate, onOpenPost]);

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const handleWindowMessage = (event) => {
      if (typeof event?.data !== 'string') return;
      onWebMessage({ nativeEvent: { data: event.data } });
    };
    window.addEventListener('message', handleWindowMessage);
    return () => window.removeEventListener('message', handleWindowMessage);
  }, [onWebMessage]);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([
      api.spots(),
      api.feed({ limit: 40, sort: 'latest' }),
    ]).then(([spotsResult, postsResult]) => {
      if (!alive) return;
      setSpots(spotsResult.status === 'fulfilled' && Array.isArray(spotsResult.value?.spots)
        ? spotsResult.value.spots
        : []);
      setPosts(postsResult.status === 'fulfilled' && Array.isArray(postsResult.value?.posts)
        ? postsResult.value.posts
        : []);
    });

    return () => {
      alive = false;
    };
  }, [onOpenPost, onOpenCreate]);

  const openCreateWithCurrent = useCallback(() => onOpenCreate({
    id: '',
    name: currentLocation.label || DEFAULT_CENTER.label,
    district: '',
    lat: currentLocation.lat,
    lng: currentLocation.lng,
  }), [currentLocation, onOpenCreate]);

  return (
    <View style={styles.container}>
      {Platform.OS === 'web' ? createElement('iframe', {
        title: '出片地图',
        srcDoc: mapHtml,
        allow: 'geolocation',
        scrolling: 'no',
        style: styles.webFrame,
      }) : (
        <WebView
          source={{ html: mapHtml }}
          style={styles.webview}
          onMessage={onWebMessage}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
          onError={() => setError(true)}
          onHttpError={() => setError(true)}
          allowsInlineMediaPlayback={true}
          geolocationEnabled
          scalesPageToFit={false}
          injectedJavaScript={`
            window.__chupianMapBootstrapped = true;
          `}
          originWhitelist={['*']}
          renderLoading={() => (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={COLORS.accent} />
            </View>
          )}
        />
      )}
      {!error ? (
        <View style={styles.actionsWrap} pointerEvents="box-none">
          <Pressable
            accessibilityLabel="标记出片点位"
            accessibilityRole="button"
            style={styles.actionBtn}
            onPress={openCreateWithCurrent}
          >
            <View style={styles.plusHorizontal} />
            <View style={styles.plusVertical} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#e6edf3' },
  webview: { flex: 1 },
  actionsWrap: {
    position: 'absolute',
    right: 18,
    bottom: 22,
    alignItems: 'flex-end',
  },
  actionBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#d93657',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#1e1e1e',
    shadowOpacity: 0.16,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  plusHorizontal: {
    position: 'absolute',
    width: 20,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#ffffff',
  },
  plusVertical: {
    position: 'absolute',
    width: 2,
    height: 20,
    borderRadius: 1,
    backgroundColor: '#ffffff',
  },
  loadingWrap: { flex: 1, backgroundColor: '#e6edf3' },
  webFrame: {
    width: '100%',
    height: '100%',
    borderWidth: 0,
    borderStyle: 'none',
    display: 'block',
  },
});
