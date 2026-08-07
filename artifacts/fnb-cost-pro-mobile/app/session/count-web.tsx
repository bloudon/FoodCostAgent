import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import WebView from "react-native-webview";
import { useAuth } from "@/context/AuthContext";

const COUNT_BASE_URL = "https://app.fnbcostpro.com/count";

const INJECTED_SCRIPT = `(function(){
  var tok=new URLSearchParams(window.location.search).get('mobileToken');
  // Same-origin guard: never forward the mobileToken to third-party origins.
  function sameOrigin(u){
    try { return new URL(u, window.location.href).origin === window.location.origin; }
    catch(e) { return false; }
  }
  if(tok){
    var oF=window.fetch;
    window.fetch=function(i,o){var u=(typeof i==='string')?i:((i&&i.url)||'');if(sameOrigin(u)){o=o||{};o.headers=Object.assign({'Authorization':'Bearer '+tok},o.headers||{});}return oF.call(this,i,o);};
    var oO=XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open=function(m,u){this._mt=sameOrigin(u)?tok:null;return oO.apply(this,arguments);};
    var oS=XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send=function(){if(this._mt){try{this.setRequestHeader('Authorization','Bearer '+this._mt);}catch(e){}}return oS.apply(this,arguments);};
  }
})();true;`;

export default function CountWebScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { sessionId, sessionName } = useLocalSearchParams<{
    sessionId: string;
    sessionName?: string;
  }>();
  const { getToken } = useAuth();

  const webViewRef = useRef<WebView>(null);

  const [mobileToken, setMobileToken] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(true);
  const [tokenError, setTokenError] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState(false);
  const initialLoadDone = useRef(false);

  const loadToken = useCallback(async () => {
    setTokenLoading(true);
    setTokenError(false);
    setMobileToken(null);
    setPageError(false);
    setPageLoading(true);
    initialLoadDone.current = false;
    try {
      const tok = await getToken();
      if (!tok) { setTokenError(true); return; }
      setMobileToken(tok);
    } catch {
      setTokenError(true);
    } finally {
      setTokenLoading(false);
    }
  }, [getToken]);

  useFocusEffect(
    useCallback(() => { loadToken(); }, [loadToken])
  );

  useEffect(() => {
    navigation.setOptions({
      title: sessionName ?? "Count Items",
      headerLeft: () => (
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={{ paddingHorizontal: 4, paddingVertical: 4 }}
        >
          <Feather name="arrow-left" size={22} color="#fff" />
        </Pressable>
      ),
    });
  }, [navigation, sessionName]);

  const handleBackPress = useCallback(() => {
    router.back();
    return true;
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return;
      const sub = BackHandler.addEventListener("hardwareBackPress", handleBackPress);
      return () => sub.remove();
    }, [handleBackPress])
  );

  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const webViewUri = mobileToken && sessionId
    ? `${COUNT_BASE_URL}/${encodeURIComponent(sessionId)}/mobile?mobileToken=${encodeURIComponent(mobileToken)}`
    : null;

  if (tokenLoading) {
    return (
      <View style={[styles.centered, { paddingBottom: bottomPad }]}>
        <ActivityIndicator size="large" color="#1B4332" />
        <Text style={styles.loadingText}>Opening count session…</Text>
      </View>
    );
  }

  if (tokenError) {
    return (
      <View style={[styles.centered, { paddingBottom: bottomPad }]}>
        <View style={styles.errorCard}>
          <Feather name="wifi-off" size={36} color="#DC2626" />
          <Text style={styles.errorTitle}>Could not connect</Text>
          <Text style={styles.errorDesc}>
            Your session could not be loaded. Please try again.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.retryBtn, { opacity: pressed ? 0.75 : 1 }]}
            onPress={loadToken}
            testID="token-retry-btn"
          >
            <Feather name="refresh-cw" size={16} color="#fff" />
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingBottom: bottomPad }]}>
      {webViewUri && (
        <WebView
          ref={webViewRef}
          source={{ uri: webViewUri }}
          injectedJavaScriptBeforeContentLoaded={INJECTED_SCRIPT}
          onLoadStart={() => {
            if (!initialLoadDone.current) { setPageLoading(true); setPageError(false); }
          }}
          onLoadEnd={() => {
            if (!initialLoadDone.current) { initialLoadDone.current = true; setPageLoading(false); }
          }}
          onError={() => {
            if (!initialLoadDone.current) {
              initialLoadDone.current = true;
              setPageLoading(false);
              setPageError(true);
            }
          }}
          onHttpError={(e) => {
            if (!initialLoadDone.current && e.nativeEvent.statusCode >= 400) {
              initialLoadDone.current = true;
              setPageLoading(false);
              setPageError(true);
            }
          }}
          style={styles.webview}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          allowsBackForwardNavigationGestures={false}
        />
      )}

      {pageLoading && !pageError && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#1B4332" />
        </View>
      )}

      {pageError && (
        <View style={styles.errorOverlay}>
          <View style={styles.errorCard}>
            <Feather name="alert-circle" size={36} color="#DC2626" />
            <Text style={styles.errorTitle}>Page failed to load</Text>
            <Text style={styles.errorDesc}>
              The count page could not be loaded. Tap to try again.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.retryBtn, { opacity: pressed ? 0.75 : 1 }]}
              onPress={loadToken}
              testID="webview-retry-btn"
            >
              <Feather name="refresh-cw" size={16} color="#fff" />
              <Text style={styles.retryBtnText}>Retry</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#fff",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    backgroundColor: "#fff",
  },
  webview: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#6B7280",
    textAlign: "center",
  },
  errorCard: {
    alignItems: "center",
    gap: 12,
    maxWidth: 320,
  },
  errorTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    color: "#111827",
    textAlign: "center",
  },
  errorDesc: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 20,
  },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#1B4332",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 4,
  },
  retryBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
});
