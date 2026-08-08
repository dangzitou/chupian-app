import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { hydrateActorId } from './src/lib/actor';

import { APP_ROUTES } from './src/constants/routes';

import MapScreen from './src/screens/MapScreen';
import PostsScreen from './src/screens/PostsScreen';
import SpotDetailScreen from './src/screens/SpotDetailScreen';
import SpotsScreen from './src/screens/SpotsScreen';
import PostDetailScreen from './src/screens/PostDetailScreen';
import NewPostScreen from './src/screens/NewPostScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import AuthorProfileScreen from './src/screens/AuthorProfileScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const linking = {
  prefixes: ['chupian://'],
  config: {
    screens: {
      [APP_ROUTES.MAP]: 'map',
      [APP_ROUTES.DISCOVERY]: {
        screens: {
          PostsList: 'discover',
          PostDetail: 'post/:postId',
          AuthorProfile: 'author/:authorId',
          SpotsList: 'spots',
          SpotDetail: 'spot/:spotId',
        },
      },
      [APP_ROUTES.CREATE]: 'publish',
      [APP_ROUTES.PROFILE]: 'profile',
    },
  },
};

function TabIcon({ type, focused, primary = false }) {
  const color = focused ? '#191919' : '#8f8987';

  if (primary) {
    return (
      <View style={[styles.tabIcon, styles.tabIconPrimary]}>
        <View style={styles.plusHorizontal} />
        <View style={styles.plusVertical} />
      </View>
    );
  }

  if (type === 'map') {
    return (
      <View style={styles.tabIcon}>
        <View style={[styles.mapGlyph, { borderColor: color }]}>
          <View style={[styles.mapGlyphDot, { backgroundColor: color }]} />
        </View>
      </View>
    );
  }

  if (type === 'discover') {
    return (
      <View style={[styles.tabIcon, styles.discoverGlyph]}>
        {[0, 1, 2, 3].map((item) => (
          <View key={item} style={[styles.discoverCell, { borderColor: color }]} />
        ))}
      </View>
    );
  }

  return (
    <View style={[styles.tabIcon, styles.profileGlyph]}>
      <View style={[styles.profileHead, { borderColor: color }]} />
      <View style={[styles.profileBody, { borderColor: color }]} />
    </View>
  );
}

function DiscoveryStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="PostsList" component={PostsScreen} />
      <Stack.Screen name="PostDetail" component={PostDetailScreen} />
      <Stack.Screen name="AuthorProfile" component={AuthorProfileScreen} />
      <Stack.Screen name="SpotsList" component={SpotsScreen} />
      <Stack.Screen name="SpotDetail" component={SpotDetailScreen} />
    </Stack.Navigator>
  );
}

function MapStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Map" component={MapScreen} />
    </Stack.Navigator>
  );
}

function CreateStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="NewPost" component={NewPostScreen} />
    </Stack.Navigator>
  );
}

function ProfileStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ProfileHome" component={ProfileScreen} />
      <Stack.Screen name="PostDetail" component={PostDetailScreen} />
    </Stack.Navigator>
  );
}

export default function App() {
  const [actorReady, setActorReady] = useState(false);

  useEffect(() => {
    let alive = true;
    hydrateActorId().finally(() => {
      if (alive) setActorReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');
    [html, body, root].filter(Boolean).forEach((node) => {
      node.style.width = '100%';
      node.style.height = '100%';
      node.style.margin = '0';
      node.style.overflow = 'hidden';
    });
    body.style.backgroundColor = '#e9e6e2';
    body.style.webkitFontSmoothing = 'antialiased';
  }, []);

  if (!actorReady) {
    return (
      <SafeAreaProvider>
        <View style={styles.viewport}>
          <View style={[styles.mobileShell, styles.bootScreen]}>
            <ActivityIndicator size="small" color="#d93657" />
          </View>
        </View>
        <StatusBar style="dark" />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <View style={styles.viewport}>
        <View style={styles.mobileShell}>
          <NavigationContainer linking={linking}>
            <Tab.Navigator
              initialRouteName={APP_ROUTES.MAP}
              screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: '#191919',
                tabBarInactiveTintColor: '#8f8987',
                tabBarLabelStyle: { fontSize: 10.5, fontWeight: '600' },
                tabBarItemStyle: { minWidth: 0 },
                tabBarStyle: {
                  height: 68,
                  paddingTop: 6,
                  paddingBottom: 8,
                  borderTopWidth: 1,
                  borderTopColor: 'rgba(25,25,25,0.08)',
                  backgroundColor: '#ffffff',
                  elevation: 0,
                },
              }}
            >
              <Tab.Screen
                name={APP_ROUTES.MAP}
                component={MapStack}
                options={{
                  tabBarLabel: '首页',
                  tabBarIcon: ({ focused }) => <TabIcon type="map" focused={focused} />,
                }}
              />
              <Tab.Screen
                name={APP_ROUTES.DISCOVERY}
                component={DiscoveryStack}
                options={{
                  tabBarLabel: '发现',
                  tabBarIcon: ({ focused }) => <TabIcon type="discover" focused={focused} />,
                }}
              />
              <Tab.Screen
                name={APP_ROUTES.CREATE}
                component={CreateStack}
                options={{
                  tabBarLabel: '发布',
                  tabBarIcon: ({ focused }) => <TabIcon type="create" focused={focused} primary />,
                }}
              />
              <Tab.Screen
                name={APP_ROUTES.PROFILE}
                component={ProfileStack}
                options={{
                  tabBarLabel: '我的',
                  tabBarIcon: ({ focused }) => <TabIcon type="profile" focused={focused} />,
                }}
              />
            </Tab.Navigator>
          </NavigationContainer>
        </View>
      </View>
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  viewport: {
    flex: 1,
    width: '100%',
    height: '100%',
    minHeight: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e9e6e2',
  },
  mobileShell: {
    flex: 1,
    width: '100%',
    maxWidth: 430,
    height: '100%',
    minHeight: 0,
    overflow: 'hidden',
    backgroundColor: '#f8f7f6',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(25,25,25,0.06)',
    shadowColor: '#1c1c1c',
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  tabIcon: {
    width: 25,
    height: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIconPrimary: {
    width: 34,
    height: 28,
    borderRadius: 9,
    backgroundColor: '#d93657',
  },
  plusHorizontal: {
    position: 'absolute',
    width: 16,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#ffffff',
  },
  plusVertical: {
    position: 'absolute',
    width: 2,
    height: 16,
    borderRadius: 1,
    backgroundColor: '#ffffff',
  },
  mapGlyph: {
    width: 19,
    height: 19,
    borderWidth: 1.8,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapGlyphDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  discoverGlyph: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    paddingVertical: 2,
  },
  discoverCell: {
    width: 7,
    height: 7,
    borderWidth: 1.5,
    borderRadius: 2,
    margin: 1.5,
  },
  profileGlyph: {
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: 2,
  },
  profileHead: {
    width: 8,
    height: 8,
    borderWidth: 1.6,
    borderRadius: 5,
  },
  profileBody: {
    width: 18,
    height: 9,
    marginTop: 2,
    borderWidth: 1.6,
    borderBottomWidth: 0,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  bootScreen: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8f7f6',
  },
});
