import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { hydrateActorId } from './src/lib/actor';

import { APP_ROUTES } from './src/constants/routes';
import { PUBLIC_WEB_ORIGIN } from './src/config';

import MapScreen from './src/screens/MapScreen';
import PostsScreen from './src/screens/PostsScreen';
import SpotDetailScreen from './src/screens/SpotDetailScreen';
import SpotsScreen from './src/screens/SpotsScreen';
import PostDetailScreen from './src/screens/PostDetailScreen';
import NewPostScreen from './src/screens/NewPostScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import AuthorProfileScreen from './src/screens/AuthorProfileScreen';
import AuthScreen from './src/screens/AuthScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import BlockedAuthorsScreen from './src/screens/BlockedAuthorsScreen';
import EditProfileScreen from './src/screens/EditProfileScreen';
import AppTabBar from './src/components/AppTabBar';
import AppErrorBoundary from './src/components/AppErrorBoundary';
import NetworkStatusBanner from './src/components/NetworkStatusBanner';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const linking = {
  prefixes: ['chupian://', PUBLIC_WEB_ORIGIN].filter(Boolean),
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
      <Stack.Screen name="Auth" component={AuthScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="BlockedAuthors" component={BlockedAuthorsScreen} />
      <Stack.Screen name="EditProfile" component={EditProfileScreen} />
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
      <AppErrorBoundary>
        <View style={styles.viewport}>
          <View style={styles.mobileShell}>
            <NetworkStatusBanner />
            <NavigationContainer linking={linking}>
              <Tab.Navigator
                initialRouteName={APP_ROUTES.MAP}
                screenOptions={{
                  headerShown: false,
                  tabBar: (props) => <AppTabBar {...props} />,
                }}
              >
                <Tab.Screen
                  name={APP_ROUTES.MAP}
                  component={MapStack}
                  options={{
                    tabBarLabel: '首页',
                  }}
                />
                <Tab.Screen
                  name={APP_ROUTES.DISCOVERY}
                  component={DiscoveryStack}
                  options={{
                    tabBarLabel: '发现',
                  }}
                />
                <Tab.Screen
                  name={APP_ROUTES.CREATE}
                  component={CreateStack}
                  options={{
                    tabBarLabel: '发布',
                  }}
                />
                <Tab.Screen
                  name={APP_ROUTES.PROFILE}
                  component={ProfileStack}
                  options={{
                    tabBarLabel: '我的',
                  }}
                />
              </Tab.Navigator>
            </NavigationContainer>
          </View>
        </View>
      </AppErrorBoundary>
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
  bootScreen: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8f7f6',
  },
});
