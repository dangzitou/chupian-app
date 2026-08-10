import React, { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { COLORS } from '../config';
import { WebView } from 'react-native-webview';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { APP_ROUTES } from '../constants/routes';
import RemoteImage from '../components/RemoteImage';
import AppIcon from '../components/AppIcon';
import { getCurrentLocation } from '../utils/location';
import AsyncStorage from '@react-native-async-storage/async-storage';

const NEUTRAL_CENTER = {
  lat: 0,
  lng: 0,
  label: '',
};

const MAP_CACHE_PREFIX = 'chupian:map-data:v1:';
const MAP_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function getMapCacheKey(locationKey) {
  return `${MAP_CACHE_PREFIX}${locationKey}`;
}

const normalizeLocation = (raw) => {
  const lat = Number(raw?.lat);
  const lng = Number(raw?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat,
    lng,
    label: String(raw?.label || '当前位置'),
  };
};

const sameLocation = (left, right) => Boolean(left && right)
  && Math.abs(Number(left.lat) - Number(right.lat)) < 0.00001
  && Math.abs(Number(left.lng) - Number(right.lng)) < 0.00001;

const sanitize = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export default function MapScreen({ navigation, route }) {
  const [error, setError] = useState(false);
  const [mapDataError, setMapDataError] = useState(false);
  const [mapRevision, setMapRevision] = useState(0);
  const [mapDataAttempt, setMapDataAttempt] = useState(0);
  const [webLocation, setWebLocation] = useState(null);
  const [spots, setSpots] = useState([]);
  const [posts, setPosts] = useState([]);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [resolvedLocation, setResolvedLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState('locating');
  const [locationAttempt, setLocationAttempt] = useState(0);
  const [locationChooserOpen, setLocationChooserOpen] = useState(false);
  const [mapPickMode, setMapPickMode] = useState(false);
  const [selectedMapItem, setSelectedMapItem] = useState(null);
  const mapDataLocationRef = useRef('');
  const focusLocation = useMemo(() => {
    const raw = route?.params?.focusLocation;
    const lat = Number(raw?.lat);
    const lng = Number(raw?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, label: String(raw?.label || '出片位置') };
  }, [route?.params?.focusLocation]);

  useEffect(() => {
    if (focusLocation) return undefined;
    let alive = true;
    const resolveNetworkLocation = () => {
      api.resolveLocation()
        .then((payload) => {
          if (!alive) return;
          const nextLocation = normalizeLocation(payload?.location);
          if (!nextLocation) throw new Error('invalid network location');
          setWebLocation(nextLocation);
          setCurrentLocation(nextLocation);
          setResolvedLocation(nextLocation);
          setLocationStatus('ready');
        })
        .catch(() => {
          if (alive) setLocationStatus('error');
        });
    };
    setLocationStatus('locating');
    getCurrentLocation()
      .then((nextLocation) => {
        if (!alive) return;
        setWebLocation(nextLocation);
        setCurrentLocation(nextLocation);
        setResolvedLocation(nextLocation);
        setLocationStatus('ready');
      })
      .catch(() => {
        if (alive) resolveNetworkLocation();
      });
    return () => { alive = false; };
  }, [focusLocation, locationAttempt]);

  useEffect(() => {
    if (!focusLocation) return;
    setCurrentLocation(focusLocation);
    setResolvedLocation(focusLocation);
    setLocationStatus('ready');
  }, [focusLocation]);

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
      cover: '',
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
      spotName: sanitize(item.spotName || item.spot_name || ''),
      district: sanitize(item.district || ''),
      cover: sanitize(item.cover || item.cover_url || ''),
      lat: Number(item.latitude ?? item.lat),
      lng: Number(item.longitude ?? item.lng),
    })) : [];

    const spotsPayload = JSON.stringify([
      ...safeSpots.slice(0, 80),
      ...safePosts.slice(0, 80),
    ]);
    const initialLocation = focusLocation || webLocation || resolvedLocation || NEUTRAL_CENTER;
    const hasInitialLocation = Boolean(focusLocation || webLocation || resolvedLocation);
    const initialZoom = hasInitialLocation ? 15 : 2;

    return `<!doctype html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width,height=device-height,initial-scale=1.0,maximum-scale=1.0,user-scalable=no" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css"
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
            border: none;
            border-radius: 999px;
            background: #d93657;
            color: #fff;
            padding: 6px 10px;
            flex: 1;
            cursor: pointer;
          }
          .popup-actions {
            display: flex;
            gap: 6px;
            margin-top: 7px;
          }
          .spot-popup .popup-secondary {
            background: #f1eeec;
            color: #3d3735;
          }
          .map-pin {
            width: 22px;
            height: 22px;
            border: 3px solid #fff;
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            box-shadow: 0 2px 7px rgba(20, 28, 38, 0.28);
          }
          .map-pin::after {
            content: '';
            display: block;
            width: 7px;
            height: 7px;
            margin: 5px auto 0;
            border-radius: 50%;
            background: rgba(255,255,255,0.9);
          }
          .map-pin-post { background: #d93657; }
          .map-pin-spot { background: #263b50; }
          .map-cluster {
            width: 36px;
            height: 36px;
            border: 3px solid #fff;
            border-radius: 50%;
            display: grid;
            place-items: center;
            color: #fff;
            background: #d93657;
            box-shadow: 0 2px 9px rgba(20, 28, 38, 0.28);
            font-size: 12px;
            font-weight: 800;
          }
          .leaflet-control-attribution {
            font-size: 9px;
            opacity: 0.72;
          }
          .locate-control {
            margin: 12px 12px 0 0;
          }
          .locate-button {
            width: 40px;
            height: 40px;
            border: 1px solid rgba(38,59,80,0.12);
            border-radius: 12px;
            background: rgba(255,255,255,0.96);
            box-shadow: 0 2px 8px rgba(20,28,38,0.18);
            display: grid;
            place-items: center;
            cursor: pointer;
          }
          .locate-button.is-loading .locate-icon {
            animation: locate-spin 0.9s linear infinite;
          }
          .locate-icon {
            width: 14px;
            height: 14px;
            border: 2px solid #263b50;
            border-radius: 50%;
            position: relative;
          }
          .locate-icon::before,
          .locate-icon::after {
            content: '';
            position: absolute;
            background: #263b50;
          }
          .locate-icon::before {
            width: 2px;
            height: 22px;
            left: 4px;
            top: -6px;
          }
          .locate-icon::after {
            width: 22px;
            height: 2px;
            left: -6px;
            top: 4px;
          }
          @keyframes locate-spin {
            to { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div id="app">
          <div id="map" class="map"></div>
        </div>
        <script>
          (function () {
            const fallbackLat = ${initialLocation.lat};
            const fallbackLng = ${initialLocation.lng};
            const fallbackName = '${sanitize(initialLocation.label)}';
            const hasInitialLocation = ${hasInitialLocation ? 'true' : 'false'};
            const markers = ${spotsPayload};
            let mapBootTimer = null;
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
              const idLiteral = JSON.stringify(String(item.id || ''));
              if (item.type === 'post') {
                return (
                  '<div class="spot-popup">' +
                    '<strong>' + name + '</strong><br/>' +
                    (district ? district + '<br/>' : '') +
                    '<button type="button" onclick="(function(){ window.__openPost && window.__openPost(' +
                    idLiteral + ') })()">查看帖子</button>' +
                  '</div>'
                );
              }
              return (
                '<div class=\"spot-popup\">' +
                  '<strong>' + name + '</strong><br/>' +
                  (district ? district + '<br/>' : '') +
                  '<div class=\"popup-actions\">' +
                    '<button class=\"popup-secondary\" type=\"button\" onclick=\"(function(){ window.__openSpot && window.__openSpot(' +
                    idLiteral + ') })()\">查看点位</button>' +
                    '<button type=\"button\" onclick=\"(function(){ window.__pickSpot && window.__pickSpot(' +
                    idLiteral + ') })()\">发布此点</button>' +
                  '</div>' +
                '</div>'
              );
            };

            function render(lat, lng, label, announceLocation = true) {
              if (!window.L) {
                emit({ type: 'mapError' });
                return;
              }
              if (mapBootTimer) window.clearTimeout(mapBootTimer);
              if (announceLocation) {
                emit({
                  type: 'locationReady',
                  location: { lat: Number(lat), lng: Number(lng), label: label || fallbackName },
                });
              }
              const map = L.map('map', {
                zoomControl: false,
                attributionControl: true,
                preferCanvas: true,
              }).setView([lat, lng], ${initialZoom});
              L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap contributors',
                maxZoom: 19,
              }).addTo(map);
              const currentDot = L.circleMarker([lat, lng], {
                radius: 8,
                color: '#e53935',
                fillColor: '#e53935',
                fillOpacity: 1,
                weight: 2,
              }).addTo(map);
              const currentHalo = L.circleMarker([lat, lng], {
                radius: 16,
                color: 'rgba(229,57,53,0.55)',
                fillColor: 'rgba(229,57,53,0.15)',
                fillOpacity: 0.75,
                weight: 0,
              }).addTo(map);
              let locateButton = null;
              const locateControl = L.control({ position: 'topright' });
              locateControl.onAdd = () => {
                const container = L.DomUtil.create('div', 'locate-control');
                locateButton = L.DomUtil.create('button', 'locate-button', container);
                locateButton.type = 'button';
                locateButton.setAttribute('aria-label', '定位到我的位置');
                locateButton.innerHTML = '<span class=\"locate-icon\"></span>';
                L.DomEvent.disableClickPropagation(container);
                L.DomEvent.on(locateButton, 'click', () => {
                  if (!locateButton) return;
                  locateButton.classList.add('is-loading');
                  map.locate({ setView: true, maxZoom: 15, enableHighAccuracy: true });
                });
                return container;
              };
              locateControl.addTo(map);
              map.on('locationfound', (event) => {
                const nextLat = Number(event?.latlng?.lat);
                const nextLng = Number(event?.latlng?.lng);
                if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return;
                currentDot.setLatLng([nextLat, nextLng]);
                currentHalo.setLatLng([nextLat, nextLng]);
                if (locateButton) locateButton.classList.remove('is-loading');
                emit({
                  type: 'locationReady',
                  location: { lat: nextLat, lng: nextLng, label: '我的位置' },
                });
              });
              map.on('locationerror', () => {
                if (locateButton) locateButton.classList.remove('is-loading');
              });
              map.on('click', (event) => {
                const nextLat = Number(event?.latlng?.lat);
                const nextLng = Number(event?.latlng?.lng);
                if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return;
                emit({
                  type: 'mapPick',
                  location: { lat: nextLat, lng: nextLng, label: '地图选点' },
                });
              });

              window.__pickSpot = (id) => {
                const target = markers.find((item) => item.type === 'spot' && String(item.id) === String(id));
                if (!target) {
                  emit({
                    type: 'openCreate',
                    spot: { id: '', name: '附近点位', district: '' },
                  });
                  return;
                }
                emit({
                  type: 'openCreate',
                  spot: {
                    id: String(target.id),
                    name: target.name,
                    district: target.district,
                    lat: target.lat,
                    lng: target.lng,
                  },
                });
              };

              window.__openPost = (id) => {
                const target = markers.find((item) => item.type === 'post' && String(item.id) === String(id));
                if (!target) return;
                emit({ type: 'openPost', postId: String(target.id) });
              };

              window.__openSpot = (id) => {
                const target = markers.find((item) => item.type === 'spot' && String(item.id) === String(id));
                if (!target) return;
                emit({ type: 'openSpot', spotId: String(target.id) });
              };

              const addSingleMarker = (item) => {
                if (!item) return;
                const markerIcon = L.divIcon({
                  className: '',
                  html: '<div class="map-pin ' + (item.type === 'post' ? 'map-pin-post' : 'map-pin-spot') + '"></div>',
                  iconSize: [28, 28],
                  iconAnchor: [8, 24],
                  popupAnchor: [0, -22],
                });
                const marker = L.marker([item.lat, item.lng], { icon: markerIcon, title: item.name || '拍摄点' })
                  .addTo(map)
                  .bindPopup(renderMarkerPopup(item));
                marker.on('click', () => {
                  emit({
                    type: 'previewItem',
                    item: { type: item.type, id: String(item.id || ''), lat: item.lat, lng: item.lng },
                  });
                });
                marker.on('popupopen', () => {
                  window.__activeSpot = item;
                });
              };

              const clusterSize = 0.0025;
              const groupedMarkers = new Map();
              markers.forEach((item) => {
                if (!item) return;
                const key = String(Math.floor(Number(item.lat) / clusterSize))
                  + ':'
                  + String(Math.floor(Number(item.lng) / clusterSize));
                const group = groupedMarkers.get(key) || [];
                group.push(item);
                groupedMarkers.set(key, group);
              });
              groupedMarkers.forEach((group) => {
                if (group.length === 1) {
                  addSingleMarker(group[0]);
                  return;
                }
                const center = group.reduce((sum, item) => ({
                  lat: sum.lat + Number(item.lat) / group.length,
                  lng: sum.lng + Number(item.lng) / group.length,
                }), { lat: 0, lng: 0 });
                const clusterIcon = L.divIcon({
                  className: '',
                  html: '<div class="map-cluster">' + group.length + '</div>',
                  iconSize: [42, 42],
                  iconAnchor: [21, 21],
                });
                const clusterMarker = L.marker([center.lat, center.lng], { icon: clusterIcon, title: group.length + ' 个出片点' })
                  .addTo(map);
                clusterMarker.on('click', () => {
                  clusterMarker.remove();
                  group.forEach((item) => addSingleMarker(item));
                  map.setView([center.lat, center.lng], Math.min(map.getZoom() + 2, 18), { animate: true });
                });
              });
            }

            mapBootTimer = window.setTimeout(() => {
              if (!window.L || !document.querySelector('.leaflet-container')) {
                emit({ type: 'mapError' });
              }
            }, 12000);

            if (hasInitialLocation) {
              return render(fallbackLat, fallbackLng, fallbackName, true);
            }

            if (window.parent && window.parent !== window) {
              emit({ type: 'locationWaiting' });
              return render(fallbackLat, fallbackLng, fallbackName, false);
            }

            if (!('geolocation' in navigator)) {
              emit({ type: 'locationError', reason: 'unsupported' });
              return render(fallbackLat, fallbackLng, fallbackName, false);
            }

            navigator.geolocation.getCurrentPosition(
              (position) => {
                const lat = Number(position.coords.latitude);
                const lng = Number(position.coords.longitude);
                if (Number.isFinite(lat) && Number.isFinite(lng)) {
                  render(lat, lng, '我的位置', true);
                } else {
                  emit({ type: 'locationError', reason: 'invalid' });
                  render(fallbackLat, fallbackLng, fallbackName, false);
                }
              },
              () => {
                emit({ type: 'locationError', reason: 'denied' });
                render(fallbackLat, fallbackLng, fallbackName, false);
              },
              { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
            );
          })();
        </script>
      </body>
    </html>`;
  }, [focusLocation, posts, resolvedLocation, spots, webLocation]);

  const onOpenCreate = useCallback((spot) => {
    if (!navigation || !APP_ROUTES || !APP_ROUTES.CREATE) return;

    const parent = navigation.getParent && navigation.getParent();
    if (parent) {
      parent.navigate(APP_ROUTES.CREATE, {
        screen: 'NewPost',
        params: { prefillSpot: spot },
      });
      return;
    }

    navigation.navigate(APP_ROUTES.CREATE, {
      screen: 'NewPost',
      params: { prefillSpot: spot },
    });
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

  const onOpenSpot = useCallback((spotId) => {
    const parent = navigation?.getParent && navigation.getParent();
    const params = { spotId: String(spotId) };
    if (parent) {
      parent.navigate(APP_ROUTES.DISCOVERY, {
        screen: 'SpotDetail',
        params,
      });
      return;
    }
    navigation.navigate('SpotDetail', params);
  }, [navigation]);

  const loadMapData = useCallback((location) => {
    let alive = true;
    const target = location || focusLocation || webLocation || resolvedLocation;
    const latitude = Number(target?.lat);
    const longitude = Number(target?.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return () => { alive = false; };

    const locationKey = `${latitude.toFixed(3)}:${longitude.toFixed(3)}`;
    if (mapDataLocationRef.current === locationKey) return () => { alive = false; };
    mapDataLocationRef.current = locationKey;
    setSelectedMapItem(null);

    const cacheKey = getMapCacheKey(locationKey);
    let freshLoaded = false;
    let cacheApplied = false;

    AsyncStorage.getItem(cacheKey)
      .then((raw) => {
        if (!alive || freshLoaded || !raw) return;
        try {
          const cached = JSON.parse(raw);
          const savedAt = Number(cached?.savedAt || 0);
          if (!savedAt || Date.now() - savedAt > MAP_CACHE_MAX_AGE_MS) return;
          const payload = cached?.payload || {};
          cacheApplied = true;
          setMapDataError(false);
          setSpots(Array.isArray(payload.spots) ? payload.spots : []);
          setPosts(Array.isArray(payload.posts) ? payload.posts : []);
        } catch (_err) {
          // A corrupt cache must never prevent a fresh map request.
        }
      })
      .catch(() => {});

    api.mapData({ latitude, longitude, radiusKm: 35, limit: 60 })
      .then((payload) => {
        if (!alive) return;
        freshLoaded = true;
        setMapDataError(false);
        setSpots(Array.isArray(payload?.spots) ? payload.spots : []);
        setPosts(Array.isArray(payload?.posts) ? payload.posts : []);
        AsyncStorage.setItem(cacheKey, JSON.stringify({
          savedAt: Date.now(),
          payload: {
            spots: Array.isArray(payload?.spots) ? payload.spots : [],
            posts: Array.isArray(payload?.posts) ? payload.posts : [],
          },
        })).catch(() => {});
      })
      .catch(() => {
        if (!alive) return;
        if (cacheApplied) return;
        setSpots([]);
        setPosts([]);
        setMapDataError(true);
      });

    return () => {
      alive = false;
    };
  }, [focusLocation, resolvedLocation, webLocation]);

  const onWebMessage = useCallback(async (event) => {
    const raw = event?.nativeEvent?.data;
    if (!raw) return;
    try {
      const payload = JSON.parse(raw);
      if (payload?.type === 'locationReady') {
        const nextLocation = normalizeLocation({
          lat: payload?.location?.lat,
          lng: payload?.location?.lng,
          label: payload?.location?.label || '我的位置',
        });
        if (nextLocation) {
          setResolvedLocation((previous) => sameLocation(previous, nextLocation) ? previous : nextLocation);
          setCurrentLocation((previous) => sameLocation(previous, nextLocation) ? previous : nextLocation);
          setLocationStatus('ready');
          loadMapData(nextLocation);
        }
        return;
      }
      if (payload?.type === 'locationError') {
        setLocationStatus('locating');
        try {
          const networkPayload = await api.resolveLocation();
          const nextLocation = normalizeLocation(networkPayload?.location);
          if (!nextLocation) throw new Error('invalid network location');
          setResolvedLocation(nextLocation);
          setCurrentLocation(nextLocation);
          setLocationStatus('ready');
          loadMapData(nextLocation);
        } catch (_err) {
          setLocationStatus('error');
        }
        return;
      }
      if (payload?.type === 'mapError') {
        setError(true);
        return;
      }
      if (payload?.type === 'previewItem' && !mapPickMode) {
        const type = payload?.item?.type === 'spot' ? 'spot' : 'post';
        const collection = type === 'spot' ? spots : posts;
        const target = collection.find((item) => String(item?.id || '') === String(payload?.item?.id || ''));
        if (!target) return;
        const lat = Number(target.latitude ?? target.lat);
        const lng = Number(target.longitude ?? target.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        setSelectedMapItem({
          type,
          id: String(target.id),
          title: String(type === 'spot' ? (target.name || '出片点位') : (target.title || target.name || '出片帖子')),
          spotName: String(target.spotName || target.spot_name || ''),
          district: String(target.district || ''),
          cover: String(target.cover || target.cover_url || ''),
          lat,
          lng,
        });
        return;
      }
      if (payload?.type === 'previewItem' && mapPickMode) {
        const lat = Number(payload?.item?.lat);
        const lng = Number(payload?.item?.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          setMapPickMode(false);
          setLocationChooserOpen(false);
          onOpenCreate({
            id: '',
            name: '地图选点',
            district: '',
            lat,
            lng,
          });
        }
        return;
      }
      if (payload?.type === 'mapPick' && mapPickMode) {
        const picked = normalizeLocation(payload?.location);
        if (picked) {
          setMapPickMode(false);
          setLocationChooserOpen(false);
          onOpenCreate({
            id: '',
            name: picked.label || '地图选点',
            district: '',
            lat: picked.lat,
            lng: picked.lng,
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
        return;
      }
      if (payload?.type === 'openSpot' && payload?.spotId) {
        onOpenSpot(payload.spotId);
      }
    } catch (_err) {
      // ignore
    }
  }, [loadMapData, mapPickMode, onOpenCreate, onOpenPost, onOpenSpot, posts, spots]);

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const handleWindowMessage = (event) => {
      if (typeof event?.data !== 'string') return;
      onWebMessage({ nativeEvent: { data: event.data } });
    };
    window.addEventListener('message', handleWindowMessage);
    return () => window.removeEventListener('message', handleWindowMessage);
  }, [onWebMessage]);

  useFocusEffect(useCallback(() => {
    mapDataLocationRef.current = '';
    return loadMapData(focusLocation || webLocation || resolvedLocation);
  }, [focusLocation, loadMapData, mapDataAttempt, resolvedLocation, webLocation]));

  const retryLocation = useCallback(() => {
    setError(false);
    setMapDataError(false);
    setLocationStatus('locating');
    if (focusLocation) return;
    setWebLocation(null);
    setResolvedLocation(null);
    setCurrentLocation(null);
    mapDataLocationRef.current = '';
    setLocationAttempt((value) => value + 1);
    setMapRevision((value) => value + 1);
  }, [focusLocation]);

  const openAppSettings = useCallback(() => {
    Linking.openSettings().catch(() => {});
  }, []);

  const openCreateWithCurrent = useCallback(() => {
    setLocationChooserOpen(true);
    setMapPickMode(false);
  }, []);

  const createAtCurrentLocation = useCallback(() => {
    if (!currentLocation) {
      setLocationChooserOpen(false);
      retryLocation();
      return;
    }
    setLocationChooserOpen(false);
    onOpenCreate({
      id: '',
      name: currentLocation.label || '当前位置',
      district: '',
      lat: currentLocation.lat,
      lng: currentLocation.lng,
    });
  }, [currentLocation, onOpenCreate, retryLocation]);

  const startMapPick = useCallback(() => {
    setLocationChooserOpen(false);
    setMapPickMode(true);
  }, []);

  const cancelMapPick = useCallback(() => {
    setMapPickMode(false);
  }, []);

  const closeMapPreview = useCallback(() => {
    setSelectedMapItem(null);
  }, []);

  const openMapPreviewDetail = useCallback(() => {
    if (!selectedMapItem) return;
    const item = selectedMapItem;
    setSelectedMapItem(null);
    if (item.type === 'spot') {
      onOpenSpot(item.id);
    } else {
      onOpenPost(item.id);
    }
  }, [onOpenPost, onOpenSpot, selectedMapItem]);

  const publishFromMapPreview = useCallback(() => {
    if (!selectedMapItem) return;
    const item = selectedMapItem;
    setSelectedMapItem(null);
    onOpenCreate({
      id: item.type === 'spot' ? item.id : '',
      name: item.spotName || (item.type === 'spot' ? item.title : '地图选点'),
      district: item.district,
      lat: item.lat,
      lng: item.lng,
    });
  }, [onOpenCreate, selectedMapItem]);

  const retryMap = useCallback(() => {
    setError(false);
    setMapDataError(false);
    mapDataLocationRef.current = '';
    setMapRevision((value) => value + 1);
    setMapDataAttempt((value) => value + 1);
  }, []);

  const locationPending = !focusLocation && !currentLocation && locationStatus === 'locating';
  const locationUnavailable = !focusLocation && !currentLocation && locationStatus === 'error';
  const mapUnavailable = error || mapDataError;

  return (
    <View style={styles.container}>
      {Platform.OS === 'web' ? createElement('iframe', {
        key: mapRevision,
        title: '出片地图',
        srcDoc: mapHtml,
        allow: 'geolocation',
        scrolling: 'no',
        style: styles.webFrame,
      }) : (
        <WebView
          key={mapRevision}
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
      {!mapUnavailable ? (
        <View style={styles.actionsWrap} pointerEvents="box-none">
          <Pressable
            accessibilityLabel="标记出片点位"
            accessibilityRole="button"
            style={styles.actionBtn}
            onPress={openCreateWithCurrent}
          >
            <AppIcon name="plus" size={23} color={COLORS.onAccent} stroke={2} />
          </Pressable>
        </View>
      ) : null}
      {selectedMapItem ? (
        <View style={styles.previewWrap} pointerEvents="box-none">
          <View style={styles.previewCard}>
            <Pressable
              style={styles.previewClose}
              onPress={closeMapPreview}
              accessibilityRole="button"
              accessibilityLabel="关闭地图预览"
            >
              <AppIcon name="close" size={15} color={COLORS.muted} stroke={1.8} />
            </Pressable>
            <RemoteImage
              uri={selectedMapItem.cover}
              style={styles.previewImage}
              fallback={selectedMapItem.type === 'post' ? '出片' : '点位'}
              accessibilityLabel={`${selectedMapItem.type === 'post' ? '出片' : '点位'}预览`}
            />
            <View style={styles.previewCopy}>
              <Text style={styles.previewEyebrow}>{selectedMapItem.type === 'post' ? '附近出片' : '拍摄点位'}</Text>
              <Text style={styles.previewTitle} numberOfLines={2}>{selectedMapItem.title}</Text>
              <Text style={styles.previewMeta} numberOfLines={1}>
                {[selectedMapItem.spotName, selectedMapItem.district].filter(Boolean).join(' · ') || '已记录坐标'}
              </Text>
              <View style={styles.previewActions}>
                <Pressable style={styles.previewPrimary} onPress={openMapPreviewDetail}>
                  <Text style={styles.previewPrimaryText}>{selectedMapItem.type === 'post' ? '看详情' : '看点位'}</Text>
                </Pressable>
                <Pressable style={styles.previewSecondary} onPress={publishFromMapPreview}>
                  <Text style={styles.previewSecondaryText}>在此发布</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      ) : null}
      {locationChooserOpen ? (
        <View style={styles.chooserBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setLocationChooserOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="关闭位置选择"
          />
          <View style={styles.chooserCard}>
            <Text style={styles.chooserTitle}>标记出片位置</Text>
            <Text style={styles.chooserHint}>先选位置，拍摄参数和攻略之后再补</Text>
            <View style={styles.chooserActions}>
              <Pressable style={styles.chooserPrimary} onPress={createAtCurrentLocation}>
                <Text style={styles.chooserPrimaryText}>使用当前位置</Text>
                <Text style={styles.chooserPrimaryHint}>{currentLocation?.label || '需要先允许定位'}</Text>
              </Pressable>
              <Pressable style={styles.chooserSecondary} onPress={startMapPick}>
                <Text style={styles.chooserSecondaryText}>在地图上点选</Text>
                <Text style={styles.chooserSecondaryHint}>适合拍摄点不在身边</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
      {mapPickMode ? (
        <View style={styles.pickHintWrap} pointerEvents="box-none">
          <View style={styles.pickHintCard}>
            <Text style={styles.pickHintTitle}>点击地图选择出片位置</Text>
            <Pressable onPress={cancelMapPick} accessibilityRole="button">
              <Text style={styles.pickHintCancel}>取消</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {locationPending ? (
        <View style={styles.locationPendingOverlay} pointerEvents="none">
          <ActivityIndicator size="small" color={COLORS.accent} />
          <Text style={styles.locationTitle}>正在获取当前位置</Text>
          <Text style={styles.locationHint}>允许定位后显示附近的出片点</Text>
        </View>
      ) : null}
      {locationUnavailable ? (
        <View style={styles.locationOverlay}>
          <Text style={styles.locationTitle}>无法确定当前位置</Text>
          <Text style={styles.locationHint}>请允许定位，或检查网络后重试。</Text>
          <Pressable style={styles.retryBtn} onPress={retryLocation} accessibilityRole="button">
            <Text style={styles.retryText}>重新定位</Text>
          </Pressable>
          <Pressable
            style={[styles.retryBtn, styles.manualPickBtn]}
            onPress={openCreateWithCurrent}
            accessibilityRole="button"
            accessibilityLabel="在地图上选点发布"
          >
            <Text style={styles.manualPickText}>在地图上选点发布</Text>
          </Pressable>
          {Platform.OS !== 'web' ? (
            <Pressable style={[styles.retryBtn, styles.settingsBtn]} onPress={openAppSettings} accessibilityRole="button">
              <Text style={styles.settingsText}>打开系统设置</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {mapUnavailable ? (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorTitle}>地图暂时加载失败</Text>
          <Text style={styles.errorHint}>请检查网络后重试，已保存的作品不会受影响。</Text>
          <Pressable style={styles.retryBtn} onPress={retryMap} accessibilityRole="button">
            <Text style={styles.retryText}>重新加载地图</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgDeep },
  webview: { flex: 1 },
  actionsWrap: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    alignItems: 'flex-end',
  },
  actionBtn: {
    width: 58,
    height: 58,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,253,248,0.76)',
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#40372d',
    shadowOpacity: 0.26,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
  },
  previewWrap: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 96,
  },
  previewCard: {
    position: 'relative',
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.card,
    shadowColor: '#493f34',
    shadowOpacity: 0.16,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  previewImage: {
    width: 88,
    height: 88,
    borderRadius: 14,
    backgroundColor: COLORS.bgDeep,
  },
  previewImageFallback: {
    width: 88,
    height: 88,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.accentBg,
  },
  previewImageFallbackText: { color: COLORS.accent, fontSize: 13, fontWeight: '800' },
  previewCopy: { flex: 1, minWidth: 0, paddingRight: 16 },
  previewEyebrow: { color: COLORS.accent, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.8 },
  previewTitle: { color: COLORS.ink, fontSize: 14, lineHeight: 19, fontWeight: '800', marginTop: 4 },
  previewMeta: { color: COLORS.muted, fontSize: 10.5, marginTop: 3 },
  previewActions: { flexDirection: 'row', gap: 7, marginTop: 8 },
  previewPrimary: {
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 6,
    backgroundColor: COLORS.ink,
  },
  previewPrimaryText: { color: COLORS.white, fontSize: 11, fontWeight: '800' },
  previewSecondary: {
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 6,
    backgroundColor: COLORS.accentBg,
  },
  previewSecondaryText: { color: COLORS.accent, fontSize: 11, fontWeight: '800' },
  previewClose: {
    position: 'absolute',
    zIndex: 2,
    top: 5,
    right: 7,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: 'rgba(255,253,248,0.92)',
  },
  previewCloseText: { color: COLORS.muted, fontSize: 20, lineHeight: 21, fontWeight: '500' },
  chooserBackdrop: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(22,28,34,0.26)',
    padding: 14,
  },
  chooserCard: {
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.card,
    shadowColor: '#493f34',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  chooserTitle: { color: COLORS.ink, fontSize: 16, fontWeight: '800' },
  chooserHint: { color: COLORS.muted, fontSize: 11.5, marginTop: 5 },
  chooserActions: { gap: 9, marginTop: 14 },
  chooserPrimary: {
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 11,
    backgroundColor: COLORS.ink,
  },
  chooserPrimaryText: { color: COLORS.white, fontSize: 13, fontWeight: '800' },
  chooserPrimaryHint: { color: 'rgba(255,255,255,0.78)', fontSize: 10.5, marginTop: 3 },
  chooserSecondary: {
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 11,
    backgroundColor: COLORS.accentBg,
  },
  chooserSecondaryText: { color: COLORS.accent, fontSize: 13, fontWeight: '800' },
  chooserSecondaryHint: { color: COLORS.muted, fontSize: 10.5, marginTop: 3 },
  pickHintWrap: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  pickHintCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 13,
    backgroundColor: 'rgba(255,253,248,0.96)',
    shadowColor: '#1e1e1e',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  pickHintTitle: { color: COLORS.ink, fontSize: 12, fontWeight: '700' },
  pickHintCancel: { color: COLORS.accent, fontSize: 12, fontWeight: '800' },
  loadingWrap: { flex: 1, backgroundColor: COLORS.bgDeep },
  errorOverlay: {
    position: 'absolute',
    left: 24,
    right: 24,
    top: '40%',
    alignItems: 'center',
    padding: 20,
    borderRadius: 18,
    backgroundColor: 'rgba(255,253,248,0.96)',
  },
  locationOverlay: {
    position: 'absolute',
    left: 28,
    right: 28,
    top: '38%',
    alignItems: 'center',
    padding: 20,
    borderRadius: 18,
    backgroundColor: 'rgba(255,253,248,0.96)',
    shadowColor: '#1e1e1e',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  locationPendingOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 4,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(233,225,213,0.68)',
  },
  locationTitle: { color: COLORS.ink, fontSize: 15, fontWeight: '700', marginTop: 8 },
  locationHint: { color: COLORS.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 6 },
  errorTitle: { color: COLORS.ink, fontSize: 15, fontWeight: '700' },
  errorHint: { color: COLORS.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 6 },
  retryBtn: {
    marginTop: 12,
    borderRadius: 9,
    paddingHorizontal: 16,
    paddingVertical: 9,
    backgroundColor: COLORS.accent,
  },
  retryText: { color: COLORS.onAccent, fontSize: 12.5, fontWeight: '700' },
  manualPickBtn: { backgroundColor: COLORS.accentBg },
  manualPickText: { color: COLORS.accent, fontSize: 12.5, fontWeight: '700' },
  settingsBtn: { backgroundColor: 'rgba(25,25,25,0.08)' },
  settingsText: { color: COLORS.ink, fontSize: 12.5, fontWeight: '700' },
  webFrame: {
    width: '100%',
    height: '100%',
    borderWidth: 0,
    borderStyle: 'none',
    display: 'block',
  },
});
