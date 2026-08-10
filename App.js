import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { hydrateActorId } from './src/lib/actor';

import { APP_ROUTES } from './src/constants/routes';
import { COLORS, PUBLIC_WEB_ORIGIN } from './src/config';

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
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === 'web' && width >= 840;

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
    body.style.backgroundColor = COLORS.bgDeep;
    body.style.webkitFontSmoothing = 'antialiased';
  }, []);

  if (!actorReady) {
    return (
      <SafeAreaProvider>
        <View style={[styles.viewport, isDesktopWeb && styles.desktopViewport]}>
          <View style={[styles.mobileShell, isDesktopWeb && styles.desktopShell, styles.bootScreen]}>
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
        <View style={[styles.viewport, isDesktopWeb && styles.desktopViewport]}>
          <View style={[styles.mobileShell, isDesktopWeb && styles.desktopShell]}>
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
                  listeners={({ navigation }) => ({
                    tabPress: () => navigation.navigate(APP_ROUTES.MAP, { screen: 'Map' }),
                  })}
                  options={{
                    tabBarLabel: '首页',
                  }}
                />
                <Tab.Screen
                  name={APP_ROUTES.DISCOVERY}
                  component={DiscoveryStack}
                  listeners={({ navigation }) => ({
                    tabPress: () => navigation.navigate(APP_ROUTES.DISCOVERY, { screen: 'PostsList' }),
                  })}
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
                  listeners={({ navigation }) => ({
                    tabPress: () => navigation.navigate(APP_ROUTES.PROFILE, { screen: 'ProfileHome' }),
                  })}
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
    backgroundColor: COLORS.bgDeep,
  },
  mobileShell: {
    flex: 1,
    width: '100%',
    maxWidth: 760,
    height: '100%',
    minHeight: 0,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: COLORS.bg,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(52,45,37,0.08)',
    shadowColor: '#5f5548',
    shadowOpacity: 0.1,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  bootScreen: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bg,
  },
  desktopViewport: {
    padding: 18,
  },
  desktopShell: {
    borderWidth: 1,
    borderRadius: 28,
    borderColor: 'rgba(52,45,37,0.13)',
    shadowOpacity: 0.18,
    shadowRadius: 42,
    shadowOffset: { width: 0, height: 16 },
  },
});
