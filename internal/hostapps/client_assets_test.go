package hostapps

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	nativeapps "github.com/floegence/floe-native-apps"
)

func TestApplicationUpgradeKeepsPreparedSnapshotsSeparate(t *testing.T) {
	root := t.TempDir()
	if err := os.CopyFS(root, os.DirFS("testdata/client")); err != nil {
		t.Fatal(err)
	}
	old, err := nativeapps.OpenClientAssets(root)
	if err != nil {
		t.Fatal(err)
	}
	oldRequest := httptest.NewRequest(http.MethodGet, "http://host/js/FloeInput.js", nil)
	oldResponse := httptest.NewRecorder()
	old.ServeHTTP(oldResponse, oldRequest)
	// A new launch prepares new bytes even when the installed component recipe
	// is unchanged. An existing application's snapshot must retain its identity.
	if err := os.WriteFile(filepath.Join(root, "js/FloeInput.js"), []byte("// Newly published prepared input adapter.\n"), 0600); err != nil {
		t.Fatal(err)
	}
	current, err := nativeapps.OpenClientAssets(root)
	if err != nil {
		t.Fatal(err)
	}
	if old.Digest() == current.Digest() {
		t.Fatal("changed preparation reused the old asset cache")
	}
	m := New(t.TempDir(), t.TempDir(), nil)
	m.applications["old"] = &linuxApplication{record: linuxApplicationRecord{Owner: "alice"}, assets: old}
	m.applications["new"] = &linuxApplication{record: linuxApplicationRecord{Owner: "alice"}, assets: current}
	if m.ClientAssets("alice", old.Digest()) != old || m.ClientAssets("alice", current.Digest()) != current || m.ClientAssets("bob", current.Digest()) != nil {
		t.Fatal("upgrade changed resource ownership or snapshot selection")
	}
	oldRequest.Header.Set("If-None-Match", oldResponse.Header().Get("ETag"))
	cached := httptest.NewRecorder()
	old.ServeHTTP(cached, oldRequest)
	if cached.Code != http.StatusNotModified {
		t.Fatal("running application's cached resources changed")
	}
	updated := httptest.NewRecorder()
	current.ServeHTTP(updated, oldRequest)
	if updated.Code != http.StatusOK || updated.Body.String() == oldResponse.Body.String() {
		t.Fatal("new application reused an old cache validator")
	}
	m.applications["old"].ended = true
	if m.ClientAssets("alice", old.Digest()) != nil || m.ClientAssets("alice", current.Digest()) != current {
		t.Fatal("ending old application revoked the new snapshot")
	}
}

func TestApplicationProxyPreservesSharingHostAndTargetRouting(t *testing.T) {
	requests := make(chan *http.Request, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests <- r.Clone(r.Context())
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()
	proxy, address, err := newApplicationProxy(upstream.URL+"/native?owned=1", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer proxy.Close()
	request, err := http.NewRequest(http.MethodGet, "http://"+address+"/socket?view=2", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Host = "sharing.local"
	request.Header.Set("Origin", "http://sharing.local")
	request.Header.Set("Accept-Encoding", "br")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	received := <-requests
	if received.Host != request.Host || received.URL.RequestURI() != "/native/socket?owned=1&view=2" || received.Header.Get("Origin") != request.Header.Get("Origin") {
		t.Fatalf("sharing request changed: %s %s %s", received.Host, received.URL.RequestURI(), received.Header.Get("Origin"))
	}
	if received.Header.Get("Accept-Encoding") == "br" {
		t.Fatal("client compression bypassed transport decompression")
	}
}

func TestApplicationSharesReuseAssetsWithoutCachingSessionDocuments(t *testing.T) {
	root, _ := filepath.Abs("testdata/client")
	assets, err := nativeapps.OpenClientAssets(root)
	if err != nil {
		t.Fatal(err)
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Header().Set("Cache-Control", "public, max-age=3600")
		w.Header().Set("ETag", `"private-document"`)
		_, _ = io.WriteString(w, `<script src="js/Client.js"></script><script src="default-settings.txt"></script>`)
	}))
	defer upstream.Close()
	for range 2 {
		proxy, address, err := newApplicationProxy(upstream.URL, assets)
		if err != nil {
			t.Fatal(err)
		}
		res, err := http.Get("http://" + address + "/index.html")
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		proxy.Close()
		expected := ClientAssetsPath + assets.Digest() + "/js/Client.js"
		if !strings.Contains(string(body), expected) || !strings.Contains(string(body), `src="default-settings.txt"`) {
			t.Fatalf("incorrect resource routing: %s", body)
		}
		if res.Header.Get("Cache-Control") != "no-store" || res.Header.Get("ETag") != "" {
			t.Fatalf("private document cacheable: %v", res.Header)
		}
	}
	m := New(t.TempDir(), t.TempDir(), nil)
	app := &linuxApplication{record: linuxApplicationRecord{Owner: "alice"}, assets: assets}
	m.applications["instance"] = app
	if m.ClientAssets("alice", assets.Digest()) != assets || m.ClientAssets("bob", assets.Digest()) != nil || m.ClientAssets("alice", strings.Repeat("0", 64)) != nil {
		t.Fatal("resource lookup lost owner or version binding")
	}
	app.ended = true
	if m.ClientAssets("alice", assets.Digest()) != nil {
		t.Fatal("ended application still exposes assets")
	}
}
