import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import WebView, { WebViewMessageEvent, WebViewNavigation } from "react-native-webview";
import { useAuth } from "@/context/AuthContext";

const BASE_URL = "https://app.fnbcostpro.com";

// Injected BEFORE page JS:
//  1. Reads ?mobileToken= from URL and patches fetch + XHR to send it as a Bearer header.
//  2. Forwards window.console.{log,warn,error} and unhandled errors back to RN
//     via window.ReactNativeWebView.postMessage so we can see them in the Expo log.
//  3. Logs every fetch URL + status so we can spot 401/404/redirects from the page.
const INJECTED_SCRIPT = `(function(){
  function send(kind, payload){
    try { window.ReactNativeWebView.postMessage(JSON.stringify({kind: kind, payload: payload})); } catch(e){}
  }
  function safe(args){
    try { return Array.from(args).map(function(a){
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === 'object') { try { return JSON.stringify(a); } catch(_) { return String(a); } }
      return String(a);
    }).join(' '); } catch(_) { return '[unserializable]'; }
  }
  ['log','warn','error','info'].forEach(function(lvl){
    var orig = console[lvl];
    console[lvl] = function(){ send('console.'+lvl, safe(arguments)); try { orig.apply(console, arguments); } catch(_){} };
  });
  window.addEventListener('error', function(e){ send('window.error', (e && e.message) ? e.message : 'unknown'); });
  window.addEventListener('unhandledrejection', function(e){ send('promise.rejection', (e && e.reason) ? String(e.reason) : 'unknown'); });

  send('init', { url: window.location.href });

  // Token survives in-page navigation: the URL only carries it on the first
  // load, so persist it in sessionStorage for subsequent pages — otherwise
  // those pages load unauthenticated and show 404s.
  var tok = new URLSearchParams(window.location.search).get('mobileToken');
  try {
    if (tok) { sessionStorage.setItem('fnbMobileToken', tok); }
    else { tok = sessionStorage.getItem('fnbMobileToken'); }
  } catch(e) {}
  send('token', { present: !!tok, length: tok ? tok.length : 0 });

  if (tok) {
    var oF = window.fetch;
    window.fetch = function(input, init){
      init = init || {};
      init.headers = Object.assign({'Authorization': 'Bearer ' + tok}, init.headers || {});
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      return oF.call(this, input, init).then(function(res){
        send('fetch', { url: url, status: res.status });
        return res;
      }).catch(function(err){
        send('fetch.error', { url: url, error: String(err) });
        throw err;
      });
    };
    var oO = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url){
      this._mt = tok; this._mUrl = url;
      return oO.apply(this, arguments);
    };
    var oS = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(){
      var self = this;
      if (self._mt) { try { self.setRequestHeader('Authorization', 'Bearer ' + self._mt); } catch(_){} }
      self.addEventListener('loadend', function(){
        send('xhr', { url: self._mUrl, status: self.status });
      });
      return oS.apply(this, arguments);
    };
  }
})(); true;`;

export type WebSectionProps = {
  /** Path on app.fnbcostpro.com, e.g. "/dashboard/mobile" or "/recipes" */
  path: string;
  /** Shown in loading/error copy, e.g. "dashboard", "Recipes" */
  label: string;
};

/**
 * Wrapped main-app page: loads a fresh mobileToken on focus, embeds the page
 * with the token-injection script, and handles loading/error/auth states.
 * Extracted from the original dashboard screen so every footer tab can reuse it.
 */
export default function WebSection({ path, label }: WebSectionProps) {
  const { getToken } = useAuth();

  const webViewRef = useRef<WebView>(null);
  const canGoBackRef = useRef(false);

  const [mobileToken, setMobileToken] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(true);
  const [tokenError, setTokenError] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState(false);
  const [authRedirected, setAuthRedirected] = useState(false);
  const initialLoadDone = useRef(false);

  const loadToken = useCallback(async () => {
    setTokenLoading(true);
    setTokenError(false);
    setMobileToken(null);
    setPageError(false);
    setPageLoading(true);
    setAuthRedirected(false);
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

  // First focus: load the page. Later refocuses keep the loaded page (tab
  // state preservation) UNLESS the mobileToken is old enough that in-page
  // API calls would start failing — then reload with a fresh token.
  const lastTokenLoadAt = useRef(0);
  const TOKEN_MAX_AGE_MS = 5 * 60 * 1000;
  useFocusEffect(
    useCallback(() => {
      const stale = Date.now() - lastTokenLoadAt.current > TOKEN_MAX_AGE_MS;
      if (lastTokenLoadAt.current === 0 || stale) {
        lastTokenLoadAt.current = Date.now();
        loadToken();
      }
    }, [loadToken])
  );

  const handleBackPress = useCallback(() => {
    if (canGoBackRef.current && webViewRef.current) {
      webViewRef.current.goBack();
      return true; // consumed: stepped back inside the web page
    }
    return false; // let the navigator/OS handle it (pop stack or exit)
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return;
      const sub = BackHandler.addEventListener("hardwareBackPress", handleBackPress);
      return () => sub.remove();
    }, [handleBackPress])
  );

  const handleNavigationStateChange = useCallback((navState: WebViewNavigation) => {
    canGoBackRef.current = navState.canGoBack;
    console.log("[WebView nav]", navState.url, "loading=", navState.loading);
    if (navState.url && navState.url.includes("fnbcostpro.com/login")) {
      console.warn("[WebView] redirected to /login — auth guard rejected mobileToken");
      webViewRef.current?.stopLoading();
      setPageLoading(false);
      setAuthRedirected(true);
    }
  }, []);

  const handleWebViewMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const { kind, payload } = JSON.parse(event.nativeEvent.data) as {
        kind: string;
        payload: unknown;
      };
      const payloadStr =
        typeof payload === "string" ? payload : JSON.stringify(payload);
      // eslint-disable-next-line no-console
      console.log(`[WebView ${kind}]`, payloadStr);
    } catch {
      // eslint-disable-next-line no-console
      console.log("[WebView raw]", event.nativeEvent.data);
    }
  }, []);

  const sectionUrl = `${BASE_URL}${path}${path.includes("?") ? "&" : "?"}embedded=true`;
  const webViewUri = mobileToken
    ? `${sectionUrl}&mobileToken=${encodeURIComponent(mobileToken)}`
    : null;

  if (tokenLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1B4332" />
        <Text style={styles.loadingText}>Opening {label}…</Text>
      </View>
    );
  }

  if (tokenError) {
    return (
      <View style={styles.centered}>
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

  if (authRedirected) {
    return (
      <View style={styles.centered}>
        <View style={styles.errorCard}>
          <Feather name="lock" size={36} color="#D97706" />
          <Text style={styles.errorTitle}>Authentication failed</Text>
          <Text style={styles.errorDesc}>
            Could not connect to {label}. Tap Retry to try again.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.retryBtn, { opacity: pressed ? 0.75 : 1 }]}
            onPress={loadToken}
            testID="auth-retry-btn"
          >
            <Feather name="refresh-cw" size={16} color="#fff" />
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
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
          onNavigationStateChange={handleNavigationStateChange}
          onMessage={handleWebViewMessage}
          style={styles.webview}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          allowsBackForwardNavigationGestures
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
              {label} could not be loaded. Tap to try again.
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
