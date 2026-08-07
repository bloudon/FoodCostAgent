import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
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
import WebView, { WebViewMessageEvent, WebViewNavigation } from "react-native-webview";
import { useAuth } from "@/context/AuthContext";
import { useScan } from "@/context/ScanContext";
import CatchWeightScanModal from "@/components/CatchWeightScanModal";

const INVENTORY_URL = "https://app.fnbcostpro.com/inventory-sessions?embedded=true";

// Auth token injection — patches fetch + XHR to carry Bearer token from URL param.
// Also:
//   • Guards the catch-weight "+" button against zero/empty weight input (Bug A).
//   • Forwards SCAN_CATCH_WEIGHT messages from web-app buttons to the native bridge
//     via window.ReactNativeWebView.postMessage (Bug B / C).
const INJECTED_SCRIPT = `(function(){
  var tok=new URLSearchParams(window.location.search).get('mobileToken');
  if(tok){
    var oF=window.fetch;
    window.fetch=function(i,o){o=o||{};o.headers=Object.assign({'Authorization':'Bearer '+tok},o.headers||{});return oF.call(this,i,o);};
    var oO=XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open=function(){this._mt=tok;return oO.apply(this,arguments);};
    var oS=XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send=function(){if(this._mt){try{this.setRequestHeader('Authorization','Bearer '+this._mt);}catch(e){}}return oS.apply(this,arguments);};
  }

  // Bug A: guard catch-weight "+" buttons against zero / empty input.
  // Uses a MutationObserver so dynamically-rendered buttons are also covered.
  function guardCwPlusButtons(){
    document.querySelectorAll('button,[role="button"]').forEach(function(btn){
      if(btn.__cwGuarded) return;
      var txt=(btn.textContent||'').trim();
      if(txt!=='+') return;
      btn.__cwGuarded=true;
      btn.addEventListener('click',function(e){
        // Walk up from the button looking for a sibling/cousin numeric input
        var parent=btn.parentElement;
        for(var i=0;i<4&&parent;i++,parent=parent.parentElement){
          var inp=parent.querySelector('input[type="number"],input[inputmode="decimal"],input[inputmode="numeric"]');
          if(inp){
            var v=parseFloat(inp.value);
            if(!inp.value||isNaN(v)||v<=0){
              e.preventDefault();
              e.stopImmediatePropagation();
            }
            return;
          }
        }
      },true);
    });
  }

  var obs=new MutationObserver(guardCwPlusButtons);
  document.addEventListener('DOMContentLoaded',function(){
    obs.observe(document.body,{childList:true,subtree:true});
    guardCwPlusButtons();
  });
  // Fallback for already-loaded page
  if(document.readyState!=='loading'){
    obs.observe(document.body,{childList:true,subtree:true});
    guardCwPlusButtons();
  }
})();true;`;

interface CwBridgeTarget {
  lineId: string;
  itemId: string;
  itemName: string;
  sessionId: string | null;
}

export default function InventoryWebScreen() {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const navigation = useNavigation();
  const { targetPath, locationId } = useLocalSearchParams<{ targetPath?: string; locationId?: string }>();
  const {
    backendUrl,
    selectedSessionId,
    setSelectedSessionId,
    setSelectedItemId,
    setSelectedItemName,
    setScanCategoryId,
    setScanLocationId,
  } = useScan();

  const webViewRef = useRef<WebView>(null);
  const canGoBackRef = useRef(false);

  const [mobileToken, setMobileToken] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(true);
  const [tokenError, setTokenError] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState(false);
  const [authRedirected, setAuthRedirected] = useState(false);
  const initialLoadDone = useRef(false);

  // Catch-weight scan bridge state (Bug B / C)
  const [cwBridgeTarget, setCwBridgeTarget] = useState<CwBridgeTarget | null>(null);
  // Tracks whether onWeightApplied fired for the current bridge target.
  // Prevents onClose (which CatchWeightScanModal calls 900ms after success) from
  // emitting a false cancel event that would undo the just-confirmed weight.
  const cwDidApplyRef = useRef(false);

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

  useFocusEffect(
    useCallback(() => { loadToken(); }, [loadToken])
  );

  const handleBackPress = useCallback(() => {
    if (canGoBackRef.current && webViewRef.current) {
      webViewRef.current.goBack();
      return true;
    }
    return false;
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
    if (navState.url && navState.url.includes("fnbcostpro.com/login")) {
      webViewRef.current?.stopLoading();
      setPageLoading(false);
      setAuthRedirected(true);
    }
  }, []);

  const handleWebViewRetry = useCallback(() => { loadToken(); }, [loadToken]);

  const scanningRef = useRef(false);

  const handleScan = useCallback(() => {
    if (scanningRef.current) return;
    scanningRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (!selectedSessionId) {
      getToken().then((token) => {
        if (!token) return;
        return fetch(`${backendUrl}/api/mobile/sessions/active`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }).then((res) => {
        if (res && res.ok) return res.json();
      }).then((data) => {
        const id = Array.isArray(data) ? data[0]?.id : data?.id;
        if (id) setSelectedSessionId(id);
      }).catch(() => {});
    }

    setSelectedItemId(null);
    setSelectedItemName(null);
    setScanCategoryId(null);
    setScanLocationId(null);
    scanningRef.current = false;
    router.push("/camera");
  }, [
    selectedSessionId,
    backendUrl,
    getToken,
    setSelectedSessionId,
    setSelectedItemId,
    setSelectedItemName,
    setScanCategoryId,
    setScanLocationId,
  ]);

  const handleScanRef = useRef(handleScan);
  handleScanRef.current = handleScan;

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => handleScanRef.current()}
          hitSlop={10}
          testID="inventory-scan-btn-header"
          style={styles.headerCameraBtn}
        >
          <Text style={styles.headerCameraText}>Scan</Text>
        </Pressable>
      ),
    });
  }, [navigation]);

  // Post weight result back into the WebView (Bug C — prevents the web app getting stuck with -1).
  // Declared before handleWebViewMessage so it can be referenced in that callback's dep array.
  //
  // Event contract (web app side):
  //   newCount  — the individual package weight just measured on the scale.
  //               The web app accumulates these entries on its side; it does NOT treat
  //               newCount as a running total. Always pass the raw scanned weight here.
  //   cancelled — false for success
  const postWeightResult = useCallback((lineId: string, newCount: number) => {
    const js = `(function(){
      window.dispatchEvent(new CustomEvent('nativeCatchWeightResult',{
        detail:{type:'NATIVE_CATCH_WEIGHT_RESULT',lineId:${JSON.stringify(lineId)},newCount:${newCount},cancelled:false}
      }));
    })();true;`;
    webViewRef.current?.injectJavaScript(js);
  }, []);

  // Post cancellation signal back into the WebView so the web app can undo its optimistic update.
  // Declared before handleWebViewMessage so it can be referenced in that callback's dep array.
  const postCancelResult = useCallback((lineId: string) => {
    const js = `(function(){
      window.dispatchEvent(new CustomEvent('nativeCatchWeightResult',{
        detail:{type:'NATIVE_CATCH_WEIGHT_RESULT',lineId:${JSON.stringify(lineId)},weight:null,cancelled:true}
      }));
    })();true;`;
    webViewRef.current?.injectJavaScript(js);
  }, []);

  // Message bridge: receive SCAN_CATCH_WEIGHT from the web app (Bug B).
  // If no sessionId is available (neither from the message nor from ScanContext),
  // we lazy-fetch the active session — same pattern as handleScan — before opening
  // the modal so the bridge never silently fails.
  const handleWebViewMessage = useCallback((event: WebViewMessageEvent) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(event.nativeEvent.data) as Record<string, unknown>;
    } catch {
      return; // ignore non-JSON messages
    }

    if (msg.type !== "SCAN_CATCH_WEIGHT") return;

    const lineId = typeof msg.lineId === "string" ? msg.lineId : "";
    if (!lineId) return;

    const itemId = typeof msg.itemId === "string" ? msg.itemId : lineId;
    const itemName = typeof msg.itemName === "string" ? msg.itemName : "Item";
    const msgSessionId = typeof msg.sessionId === "string" ? msg.sessionId : null;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const resolvedId = msgSessionId ?? selectedSessionId;
    if (resolvedId) {
      cwDidApplyRef.current = false;
      setCwBridgeTarget({ lineId, itemId, sessionId: resolvedId, itemName });
      return;
    }

    // No sessionId in context yet — lazy-fetch the active session before opening
    getToken().then((token) => {
      if (!token) return null;
      return fetch(`${backendUrl}/api/mobile/sessions/active`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }).then((res) => {
      if (res && res.ok) return res.json();
      return null;
    }).then((data) => {
      const id = Array.isArray(data) ? data[0]?.id : data?.id;
      if (id) {
        setSelectedSessionId(id);
        cwDidApplyRef.current = false;
        setCwBridgeTarget({ lineId, itemId, sessionId: id, itemName });
      } else {
        // Could not resolve a session — tell the user and unblock the web app.
        postCancelResult(lineId);
        Alert.alert(
          "No active session",
          "Please select an inventory session before scanning a catch-weight item.",
          [{ text: "OK" }]
        );
      }
    }).catch(() => {
      postCancelResult(lineId);
      Alert.alert(
        "Could not load session",
        "There was a problem fetching your active session. Please check your connection and try again.",
        [{ text: "OK" }]
      );
    });
  }, [selectedSessionId, backendUrl, getToken, setSelectedSessionId, postCancelResult]);

  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  if (tokenLoading) {
    return (
      <View style={[styles.centered, { paddingBottom: bottomPad }]}>
        <ActivityIndicator size="large" color="#1B4332" />
        <Text style={styles.loadingText}>Opening inventory…</Text>
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

  if (authRedirected) {
    return (
      <View style={[styles.centered, { paddingBottom: bottomPad }]}>
        <View style={styles.errorCard}>
          <Feather name="lock" size={36} color="#D97706" />
          <Text style={styles.errorTitle}>Authentication failed</Text>
          <Text style={styles.errorDesc}>
            Could not connect to the inventory page. Tap Retry to try again.
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

  const baseWebUrl = targetPath
    ? `https://app.fnbcostpro.com/${targetPath}?embedded=true${locationId ? `&location=${encodeURIComponent(locationId)}` : ""}`
    : INVENTORY_URL;
  const webViewUri = mobileToken
    ? `${baseWebUrl}&mobileToken=${encodeURIComponent(mobileToken)}`
    : null;

  const bridgeSessionId = cwBridgeTarget?.sessionId ?? selectedSessionId ?? null;

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
              The inventory page could not be loaded. Tap to try again.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.retryBtn, { opacity: pressed ? 0.75 : 1 }]}
              onPress={handleWebViewRetry}
              testID="webview-retry-btn"
            >
              <Feather name="refresh-cw" size={16} color="#fff" />
              <Text style={styles.retryBtnText}>Retry</Text>
            </Pressable>
          </View>
        </View>
      )}

      {!tokenLoading && !tokenError && (
        <Pressable
          style={({ pressed }) => [
            styles.fab,
            { bottom: bottomPad + 24 },
            pressed && { opacity: 0.85, transform: [{ scale: 0.96 }] },
          ]}
          onPress={handleScan}
          testID="inventory-scan-btn-fab"
        >
          <Text style={styles.fabIcon}>📷</Text>
        </Pressable>
      )}

      {cwBridgeTarget && bridgeSessionId && (
        <CatchWeightScanModal
          visible
          itemId={cwBridgeTarget.itemId || cwBridgeTarget.lineId}
          lineId={cwBridgeTarget.lineId}
          itemName={cwBridgeTarget.itemName}
          sessionId={bridgeSessionId}
          currentCount={0}
          onWeightApplied={(lineId, newCount) => {
            // Mark as applied FIRST so the trailing onClose (called ~900ms later
            // by the modal's animation) does not emit a false cancel event.
            cwDidApplyRef.current = true;
            postWeightResult(lineId, newCount);
            setCwBridgeTarget(null);
          }}
          onClose={() => {
            // Only post cancel if the weight was NOT already applied.
            // CatchWeightScanModal calls onClose ~900ms after a successful apply,
            // which would race with the success event if we always posted cancel here.
            if (!cwDidApplyRef.current) {
              postCancelResult(cwBridgeTarget.lineId);
            }
            cwDidApplyRef.current = false;
            setCwBridgeTarget(null);
          }}
        />
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
    fontSize: 18,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#111827",
    textAlign: "center",
  },
  errorDesc: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 21,
  },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#1B4332",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginTop: 4,
  },
  retryBtnText: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  headerCameraBtn: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  headerCameraText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#D97706",
  },
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#D97706",
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  fabIcon: {
    fontSize: 24,
    lineHeight: 30,
  },
});
