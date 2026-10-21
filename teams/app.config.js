// App configuration. Values that differ per environment come from EXPO_PUBLIC_
// variables (see .env.example); everything else is fixed here.

const googleIosUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME

export default {
  expo: {
    name: 'Hengam Teams',
    slug: 'hengam-teams',
    scheme: 'hengamteams',
    // The version people see in the stores. Build numbers are kept by EAS
    // (eas.json: appVersionSource remote) and rise with every store build.
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    // Follows the device; the app's own setting can override it.
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier: 'app.hengam.teams',
      supportsTablet: true,
      usesAppleSignIn: true,
      associatedDomains: ['applinks:teams.hengam.app'],
      // Only HTTPS, which is exempt, so no export compliance questions per build.
      config: { usesNonExemptEncryption: false },
      // Apple's required-reason APIs used by React Native and the Expo
      // modules. They ship their own manifests, but Apple does not reliably
      // read those from static pods, so the app declares them too.
      privacyManifests: {
        NSPrivacyAccessedAPITypes: [
          { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
          { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1'] },
          { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] },
          { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace', NSPrivacyAccessedAPITypeReasons: ['E174.1'] },
        ],
      },
    },
    android: {
      package: 'app.hengam.teams',
      adaptiveIcon: {
        backgroundColor: '#030816',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      // Files are picked through the system picker, which needs no storage
      // permission; expo-file-system asks for it on old Android otherwise.
      blockedPermissions: [
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.SYSTEM_ALERT_WINDOW',
      ],
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
      ['expo-splash-screen', {
        image: './assets/splash-icon.png',
        imageWidth: 120,
        backgroundColor: '#F7FAFF',
        dark: { image: './assets/splash-icon.png', backgroundColor: '#030816' },
      }],
      'expo-localization',
      'expo-apple-authentication',
      // The Android status-bar icon must be a white silhouette.
      ['expo-notifications', { icon: './assets/android-icon-monochrome.png', color: '#3B82F6' }],
      // The Google plugin refuses to build without the iOS URL scheme from
      // the Firebase console, so it is added only once that is configured.
      ...(googleIosUrlScheme
        ? [['@react-native-google-signin/google-signin', { iosUrlScheme: googleIosUrlScheme }]]
        : []),
    ],
    experiments: { typedRoutes: false },
    // The EAS project, which Expo's push service needs to address this app.
    extra: { eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID || undefined } },
  },
}
