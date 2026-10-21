// App configuration. Values that differ per environment come from EXPO_PUBLIC_
// variables (see .env.example); everything else is fixed here.

const googleIosUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME

export default {
  expo: {
    name: 'Hengam Teams',
    slug: 'hengam-teams',
    scheme: 'hengamteams',
    version: '0.1.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    // Follows the device; the app's own setting can override it.
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier: 'app.hengam.teams',
      supportsTablet: true,
      usesAppleSignIn: true,
      associatedDomains: ['applinks:teams.hengam.app'],
    },
    android: {
      package: 'app.hengam.teams',
      adaptiveIcon: {
        backgroundColor: '#030816',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      intentFilters: [{
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: 'teams.hengam.app', pathPrefix: '/join' }],
        category: ['BROWSABLE', 'DEFAULT'],
      }],
    },
    web: {
      favicon: './assets/favicon.png',
      output: 'single',
      bundler: 'metro',
    },
    plugins: [
      'expo-router',
      'expo-status-bar',
      'expo-localization',
      'expo-apple-authentication',
      // The Google plugin refuses to build without the iOS URL scheme from
      // the Firebase console, so it is added only once that is configured.
      ...(googleIosUrlScheme
        ? [['@react-native-google-signin/google-signin', { iosUrlScheme: googleIosUrlScheme }]]
        : []),
    ],
    experiments: { typedRoutes: false },
  },
}
