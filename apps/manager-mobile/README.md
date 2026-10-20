# Demo Hotel Manager — React Native + Expo

The Manager app now uses React Native components and Expo SDK 58. The same `App.jsx` runs on Android, iOS and Web; there are no HTML/CSS page components or WebView wrappers in the app.

## Start

From the repository root:

```powershell
npm install
npm run dev:mobile
```

This starts Expo Metro on port 8081. Open the project using a compatible Expo client or a development build on your device. The local network / firewall must allow the device to reach the development machine.

For the React Native Web preview:

```powershell
npm run dev:mobile:web
```

Open http://localhost:5180/. This renders the same React Native components through React Native Web; it is not the previous Vite mockup.

Native launch commands (from `apps/manager-mobile`):

```powershell
npm run android
npm run ios
```

Android requires a connected device or installed emulator. The iOS simulator requires macOS / Xcode. `expo-dev-client` and EAS development / preview build profiles are included, but no signed native binary has been built or uploaded. EAS builds require your own Expo account and signing setup. See [Expo development builds](https://docs.expo.dev/develop/development-builds/create-a-build/).

## Preserved UI and flows

- Deep navy / gold palette, mobile card layouts and four bottom navigation tabs.
- Manager-only demo login and profile.
- Pending / approved / rejected request lists, search and category filters.
- Four pricing sections with Prior, Remark and expandable details.
- Approval confirmation, mandatory rejection reason and stored decision history.
- Notification deep links, unread state, mark-all-read and alert indicator preference.
- Reset-data confirmation and sign out.

## Native implementation

- `App.jsx`: `View`, `Text`, `ScrollView`, `Pressable`, `TextInput`, `Modal` and `Switch`.
- `src/styles.js`: React Native StyleSheet tokens and layouts.
- Safe areas, keyboard avoidance and Android hardware-back handling.
- `src/storage.js`: AsyncStorage for workspace data; SecureStore for native demo sessions. Web uses sessionStorage for the demo session.
- Feather icons and fonts are bundled; the UI has no remote font dependency.
- `src/model.js`: unchanged business rules and sample requests, covered by unit tests.
- `app.json`, `eas.json`, `index.js`: Expo configuration, development-build profiles and entry point.

## Demo access and boundaries

Tap **Fill demo credentials**, then **Sign in**:

- Email: `manager@demo.local`
- Password: `Manager123!`

This fixed credential is only a demo gate, not production authentication. Sessions expire after eight hours on reopening. The API must enforce the Manager role for real approvals. Decisions, notifications and preferences use local demo data; no FDS synchronization or push delivery is connected.

The native app uses a separate storage namespace. Browser data from the old Vite preview is not automatically transferred to a physical device. The previous web source is backed up in `artifacts/manager-web-reference` for visual comparison only; it is not part of the Expo entry point or build.

## Validation

```powershell
npm test
npm run lint
npm run build
```

From this workspace, `npx expo install --check` verifies SDK-compatible dependency versions. `npm run build` exports Android / iOS Hermes bundles and Web assets; this is not an APK / IPA build. Native device testing is still required. `artifacts/test-manager-expo.mjs` tests the same UI through Expo Web in isolated Chromium.
