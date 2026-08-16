package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

func TestLocalUIReverseProxyRewritesAuthorityOriginAndJSON(t *testing.T) {
	t.Helper()
	var gotHost, gotOrigin, gotEncoding string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHost = r.Host
		gotOrigin = r.Header.Get("Origin")
		gotEncoding = r.Header.Get("Accept-Encoding")
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"direct_ws_url":"ws://`+r.Host+`/direct"}`)
	}))
	defer upstream.Close()

	target, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatal(err)
	}
	proxy := httptest.NewServer(newLocalUIReverseProxy(target, "127.0.0.1:41234", "", false, nil))
	defer proxy.Close()

	req, err := http.NewRequest(http.MethodGet, proxy.URL+"/api/local/runtime", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Origin", proxy.URL)
	req.Header.Set("Accept-Encoding", "gzip")
	response, err := proxy.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if gotHost != target.Host || gotOrigin != target.Scheme+"://"+target.Host || gotEncoding != "identity" {
		t.Fatalf("upstream authority = %q, Origin = %q, encoding = %q", gotHost, gotOrigin, gotEncoding)
	}
	if strings.Contains(string(body), target.Host) || !strings.Contains(string(body), "127.0.0.1:41234") {
		t.Fatalf("rewritten JSON = %s", body)
	}
}

func TestLocalUIReverseProxyCarriesWebSocketWithRewrittenOrigin(t *testing.T) {
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool {
		return r.Header.Get("Origin") == "http://"+r.Host
	}}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		connection, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer connection.Close()
		messageType, message, err := connection.ReadMessage()
		if err == nil {
			_ = connection.WriteMessage(messageType, message)
		}
	}))
	defer upstream.Close()

	target, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatal(err)
	}
	proxy := httptest.NewServer(newLocalUIReverseProxy(target, "127.0.0.1:41234", "", false, nil))
	defer proxy.Close()
	proxyWSURL := "ws" + strings.TrimPrefix(proxy.URL, "http") + "/flowersec/direct"
	header := http.Header{"Origin": []string{proxy.URL}}
	connection, response, err := websocket.DefaultDialer.Dial(proxyWSURL, header)
	if err != nil {
		if response != nil {
			t.Fatalf("websocket dial status = %d: %v", response.StatusCode, err)
		}
		t.Fatal(err)
	}
	defer connection.Close()
	if err := connection.WriteMessage(websocket.TextMessage, []byte("ready")); err != nil {
		t.Fatal(err)
	}
	_, message, err := connection.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	if string(message) != "ready" {
		t.Fatalf("websocket echo = %q", message)
	}
}

func TestTrustedLocalUIBridgeProxyPreservesSignedArtifactAuthority(t *testing.T) {
	var gotHost, gotOrigin string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHost = r.Host
		gotOrigin = r.Header.Get("Origin")
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/local/direct/connect_artifact" {
			_, _ = io.WriteString(w, `{"signed_artifact":"`+r.Host+`","internal":"127.0.0.1:23998"}`)
			return
		}
		_, _ = io.WriteString(w, `{"local_ui_url":"http://127.0.0.1:23998/"}`)
	}))
	defer upstream.Close()
	target, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatal(err)
	}
	proxy := httptest.NewServer(newLocalUIReverseProxy(target, "unused.invalid:1", "127.0.0.1:23998", true, nil))
	defer proxy.Close()

	req, err := http.NewRequest(http.MethodPost, proxy.URL+"/api/local/direct/connect_artifact", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Origin", proxy.URL)
	response, err := proxy.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	proxyAuthority := strings.TrimPrefix(proxy.URL, "http://")
	if gotHost != proxyAuthority || gotOrigin != proxy.URL {
		t.Fatalf("trusted upstream authority = %q, Origin = %q", gotHost, gotOrigin)
	}
	if !strings.Contains(string(body), proxyAuthority) || !strings.Contains(string(body), "127.0.0.1:23998") || strings.Contains(string(body), target.Host) {
		t.Fatalf("trusted bridge response was mutated: %s", body)
	}
	health, err := proxy.Client().Get(proxy.URL + "/api/local/runtime/health")
	if err != nil {
		t.Fatal(err)
	}
	healthBody, err := io.ReadAll(health.Body)
	_ = health.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(healthBody), "unused.invalid:1") || strings.Contains(string(healthBody), "127.0.0.1:23998") {
		t.Fatalf("trusted bridge health authority was not rewritten: %s", healthBody)
	}
}
