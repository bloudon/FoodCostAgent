import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect, useNavigation } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import WebView, { WebViewMessageEvent } from "react-native-webview";
import { useAuth } from "@/context/AuthContext";
import {
  buildDraftMessage,
  clearWasteDraft,
  getWasteDraft,
  parseWebMessage,
  WASTE_BRIDGE_VERSION,
} from "@/lib/wasteBridge";

const WASTE_URL = "https://app.fnbcostpro.com/waste?embedded=true";
const BRIDGE_READY_TIMEOUT_MS = 15000;
const DRAFT_ACK_TIMEOUT_MS = 10000;

// Injected BEFORE page JS: patch fetch/XHR with the mobileToken (same pattern
// as the other wrapped screens). The bridge itself is the web page's
// responsibility — it posts FNB_WASTE_* messages via
// window.ReactNativeWebView.postMessage and must listen for native messages on
// BOTH window and document 'message' events (RN WebView quirk: Android
// dispatches on document, iOS on window).
// Note: unlike the older wrapped screens, the Authorization header here is
// only attached to same-origin requests so the token cannot leak to
// third-party hosts the page might call.
const INJECTED_SCRIPT = `(function(){
  var tok=new URLSearchParams(window.location.search).get('mobileToken');
  if(!tok) return;
  function sameOrigin(u){
    try { return new URL(u, window.location.href).origin === window.location.origin; }
    catch(e){ return false; }
  }
  var oF=window.fetch;
  window.fetch=function(i,o){
    var url=(typeof i==='string')?i:(i&&i.url)||'';
    if(sameOrigin(url)){o=o||{};o.headers=Object.assign({'Authorization':'Bearer '+tok},o.headers||{});}
    return oF.call(this,i,o);
  };
  var oO=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){this._mt=sameOrigin(u)?tok:null;return oO.apply(this,arguments);};
  var oS=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send=function(){if(this._mt){try{this.setRequestHeader('Authorization','Bearer '+this._mt);}catch(e){}}return oS.apply(this,arguments);};
})();true;`;

type BridgeStatus =
  | "loading" // page loading, waiting for FNB_WASTE_BRIDGE_READY
  | "sending" // draft sent, waiting for FNB_WASTE_DRAFT_RECEIVED
  | "delivered" // web page owns the draft; user works in the wizard
  | "no-draft" // opened without a pending draft — plain wrapped page
  | "bridge-error";

export default function WasteWebScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { getToken } = useAuth();

  const webViewRef = useRef<WebView>(null);
  const readyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ackTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // requestId acked by the CURRENT page session; reset whenever the page
  // (re)announces itself via FNB_WASTE_BRIDGE_READY.
  const ackedRequestIdThisSession = useRef<string | null>(null);

  const [mobileToken, setMobileToken] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(true);
  const [tokenError, setTokenError] = useState(false);
  const [pageError, setPageError] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>(
    getWasteDraft() ? "loading" : "no-draft"
  );
  const [webError, setWebError] = useState<string | null>(null);

  useEffect(() => {
    navigation.setOptions({
      title: "Waste Entry",
      headerLeft: () => (
        <Pressable onPress={() => confirmLeave()} hitSlop={10} style={{ padding: 4 }}>
          <Feather name="arrow-left" size={22} color="#fff" />
        </Pressable>
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  const loadToken = useCallback(async () => {
    setTokenLoading(true);
    setTokenError(false);
    setPageError(false);
    setWebError(null);
    setBridgeStatus(getWasteDraft() ? "loading" : "no-draft");
    try {
      const tok = await getToken();
      if (!tok) {
        setTokenError(true);
        return;
      }
      setMobileToken(tok);
    } catch {
      setTokenError(true);
    } finally {
      setTokenLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    loadToken();
    return () => {
      if (readyTimeout.current) clearTimeout(readyTimeout.current);
      if (ackTimeout.current) clearTimeout(ackTimeout.current);
    };
  }, [loadToken]);

  // Leaving without FNB_WASTE_CREATED keeps the draft (retained on
  // error/abandonment); only explicit user cancellation clears it.
  const confirmLeave = useCallback(() => {
    const draft = getWasteDraft();
    if (!draft) {
      router.back();
      return;
    }
    Alert.alert(
      "Leave Waste Entry?",
      "Your voice draft hasn't been submitted yet.",
      [
        { text: "Keep draft & leave", onPress: () => router.back() },
        {
          text: "Discard draft",
          style: "destructive",
          onPress: () => {
            clearWasteDraft();
            router.back();
          },
        },
        { text: "Stay", style: "cancel" },
      ]
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        confirmLeave();
        return true;
      });
      return () => sub.remove();
    }, [confirmLeave])
  );

  const sendDraft = useCallback(() => {
    const draft = getWasteDraft();
    if (!draft || !webViewRef.current) return;
    // Session-scoped dedupe only: if THIS page session already acked this
    // requestId, don't re-send. After a page reload the session resets and the
    // retained draft is re-delivered; the web side dedupes by requestId.
    if (ackedRequestIdThisSession.current === draft.requestId) {
      setBridgeStatus("delivered");
      return;
    }
    const msg = JSON.stringify(buildDraftMessage(draft));
    // Deliver on BOTH window and document so the page can listen on either.
    webViewRef.current.injectJavaScript(
      `(function(){var d=${JSON.stringify(msg)};` +
        `try{window.dispatchEvent(new MessageEvent('message',{data:d}));}catch(e){}` +
        `try{document.dispatchEvent(new MessageEvent('message',{data:d}));}catch(e){}` +
        `})();true;`
    );
    setBridgeStatus("sending");
    // If the web page never acks with FNB_WASTE_DRAFT_RECEIVED, surface a
    // recoverable error instead of spinning forever. Draft is retained.
    if (ackTimeout.current) clearTimeout(ackTimeout.current);
    ackTimeout.current = setTimeout(() => {
      setBridgeStatus((s) => {
        if (s === "sending") {
          setWebError(
            "The Waste page did not confirm receiving your draft. Your draft is safe — you can retry."
          );
          return "bridge-error";
        }
        return s;
      });
    }, DRAFT_ACK_TIMEOUT_MS);
  }, []);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const msg = parseWebMessage(event.nativeEvent.data);
      if (!msg) return; // Non-bridge messages (console forwarding etc.) are ignored here
      if (msg.version !== WASTE_BRIDGE_VERSION) {
        setWebError(
          `The Waste page uses bridge version ${msg.version}, but this app expects ${WASTE_BRIDGE_VERSION}. Please update the app.`
        );
        setBridgeStatus("bridge-error");
        return;
      }
      const draft = getWasteDraft();

      switch (msg.type) {
        case "FNB_WASTE_BRIDGE_READY": {
          if (readyTimeout.current) clearTimeout(readyTimeout.current);
          // A READY means a fresh page session (initial load or reload) —
          // any previous ack belongs to a dead session, so re-deliver.
          ackedRequestIdThisSession.current = null;
          if (draft) sendDraft();
          else setBridgeStatus("no-draft");
          break;
        }
        case "FNB_WASTE_DRAFT_RECEIVED": {
          if (draft && msg.requestId === draft.requestId) {
            if (ackTimeout.current) clearTimeout(ackTimeout.current);
            ackedRequestIdThisSession.current = draft.requestId;
            setBridgeStatus("delivered");
          }
          break;
        }
        case "FNB_WASTE_CREATED": {
          // Only now is the draft cleared.
          if (!draft || msg.requestId === draft.requestId) {
            clearWasteDraft();
          }
          Alert.alert(
            "Waste logged",
            `${msg.payload.createdCount} waste ${msg.payload.createdCount === 1 ? "entry was" : "entries were"} recorded.`,
            [{ text: "Done", onPress: () => router.back() }]
          );
          break;
        }
        case "FNB_WASTE_CANCELLED": {
          if (!draft || msg.requestId === draft.requestId) {
            clearWasteDraft();
          }
          router.back();
          break;
        }
        case "FNB_WASTE_ERROR": {
          // Draft is retained so the user can retry.
          setWebError(`${msg.payload.message} (${msg.payload.code})`);
          setBridgeStatus("bridge-error");
          break;
        }
      }
    },
    [sendDraft]
  );

  const startReadyTimeout = useCallback(() => {
    if (!getWasteDraft()) return;
    if (readyTimeout.current) clearTimeout(readyTimeout.current);
    readyTimeout.current = setTimeout(() => {
      setBridgeStatus((s) => {
        if (s === "loading") {
          setWebError(
            "The Waste page did not respond to the app. Your draft is safe — you can retry."
          );
          return "bridge-error";
        }
        return s;
      });
    }, BRIDGE_READY_TIMEOUT_MS);
  }, []);

  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const webViewUri = mobileToken
    ? `${WASTE_URL}&mobileToken=${encodeURIComponent(mobileToken)}`
    : null;

  if (tokenLoading) {
    return (
      <View style={[styles.centered, { paddingBottom: bottomPad }]}>
        <ActivityIndicator size="large" color="#1B4332" />
        <Text style={styles.loadingText}>Opening Waste Entry…</Text>
      </View>
    );
  }

  if (tokenError) {
    return (
      <View style={[styles.centered, { paddingBottom: bottomPad }]}>
        <View style={styles.errorCard}>
          <Feather name="wifi-off" size={36} color="#DC2626" />
          <Text style={styles.errorTitle}>Could not connect</Text>
          <Text style={styles.errorDesc}>Your session could not be loaded. Please try again.</Text>
          <Pressable
            style={({ pressed }) => [styles.retryBtn, { opacity: pressed ? 0.75 : 1 }]}
            onPress={loadToken}
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
            setPageError(false);
          }}
          onLoadEnd={startReadyTimeout}
          onError={() => setPageError(true)}
          onHttpError={(e) => {
            if (e.nativeEvent.statusCode >= 400) setPageError(true);
          }}
          onMessage={handleMessage}
          style={styles.webview}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          allowsBackForwardNavigationGestures={false}
        />
      )}

      {(bridgeStatus === "loading" || bridgeStatus === "sending") && !pageError && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#1B4332" />
          <Text style={styles.loadingText}>
            {bridgeStatus === "loading" ? "Connecting to Waste Entry…" : "Handing off your voice draft…"}
          </Text>
        </View>
      )}

      {(pageError || bridgeStatus === "bridge-error") && (
        <View style={styles.errorOverlay}>
          <View style={styles.errorCard}>
            <Feather name="alert-circle" size={36} color="#DC2626" />
            <Text style={styles.errorTitle}>
              {pageError ? "Page failed to load" : "Handoff problem"}
            </Text>
            <Text style={styles.errorDesc}>
              {webError ?? "The Waste page could not be loaded. Your draft is safe — tap Retry."}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.retryBtn, { opacity: pressed ? 0.75 : 1 }]}
              onPress={loadToken}
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
  root: { flex: 1, backgroundColor: "#fff" },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    backgroundColor: "#fff",
  },
  webview: { flex: 1 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  loadingText: {
    marginTop: 8,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#6B7280",
    textAlign: "center",
  },
  errorCard: { alignItems: "center", gap: 12, maxWidth: 320 },
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
  retryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
