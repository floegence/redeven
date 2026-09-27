package hostapps

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	nativeapps "github.com/floegence/floe-native-apps"
)

func TestApplicationUpgradePinsResourcesToActiveShares(t *testing.T) {
	root := viewerSourceFixture(t)
	old, err := nativeapps.PrepareViewer(root)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "js/Keycodes.js")
	if err := os.WriteFile(path, []byte("/* changed current publisher resource */"), 0600); err != nil {
		t.Fatal(err)
	}
	current, err := nativeapps.PrepareViewer(root)
	if err != nil {
		t.Fatal(err)
	}
	if old.Assets().Digest() == current.Assets().Digest() {
		t.Fatal("changed bytes reused the old content version")
	}
	app := &linuxApplication{record: linuxApplicationRecord{Owner: "alice"}}
	m := New(t.TempDir(), t.TempDir(), nil)
	m.sessions["old"] = &ownedSession{owner: "alice", application: app, viewer: old, view: Session{State: "running"}}
	m.sessions["new"] = &ownedSession{owner: "alice", application: app, viewer: current, view: Session{State: "running"}}
	if m.ClientAssets("alice", old.Assets().Digest()) != old.Assets() || m.ClientAssets("alice", current.Assets().Digest()) != current.Assets() || m.ClientAssets("bob", current.Assets().Digest()) != nil {
		t.Fatal("share snapshot ownership changed")
	}
	request := httptest.NewRequest("GET", "/js/Keycodes.js", nil)
	before := httptest.NewRecorder()
	old.Assets().ServeHTTP(before, request)
	request.Header.Set("If-None-Match", before.Header().Get("ETag"))
	cached := httptest.NewRecorder()
	old.Assets().ServeHTTP(cached, request)
	updated := httptest.NewRecorder()
	current.Assets().ServeHTTP(updated, request)
	if cached.Code != 304 || updated.Code != 200 || updated.Body.String() == before.Body.String() {
		t.Fatal("snapshot validators crossed versions")
	}
	m.sessions["old"].stopping = true
	if m.ClientAssets("alice", old.Assets().Digest()) != nil || m.ClientAssets("alice", current.Assets().Digest()) != current.Assets() || app.ended {
		t.Fatal("retiring a share changed the application or another snapshot")
	}
	m.sessions["new"].view.State = "ended"
	if m.ClientAssets("alice", current.Assets().Digest()) != nil {
		t.Fatal("retired share exposes resources")
	}
}

func TestApplicationProxyPreservesSharingHostAndTargetRouting(t *testing.T) {
	requests := make(chan *http.Request, 1)
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests <- r.Clone(r.Context())
		w.WriteHeader(http.StatusNoContent)
	}))
	defer backend.Close()
	proxy, address, err := newApplicationProxy(backend.URL+"/native?owned=1", viewerFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	defer proxy.Close()
	request, _ := http.NewRequest("GET", "http://"+address+"/index.html?view=2", nil)
	request.Host = "sharing.local"
	request.Header.Set("Origin", "http://sharing.local")
	request.Header.Set("Connection", "Upgrade")
	request.Header.Set("Upgrade", "websocket")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	received := <-requests
	if received.Host != request.Host || received.URL.RequestURI() != "/native/index.html?owned=1&view=2" || received.Header.Get("Origin") != request.Header.Get("Origin") {
		t.Fatal("sharing host or transport routing changed")
	}
	if response.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("transport response is cacheable")
	}
}

func TestApplicationShareServesMatchingCurrentDocumentWithoutReadingLegacyTree(t *testing.T) {
	viewer := viewerFixture(t)
	var calls atomic.Int32
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		io.WriteString(w, "obsolete application document or asset")
	}))
	defer backend.Close()
	proxy, address, err := newApplicationProxy(backend.URL, viewer)
	if err != nil {
		t.Fatal(err)
	}
	defer proxy.Close()
	for _, path := range []string{"/", "/index.html", "/default-settings.txt", "/js/Client.js", "/old.html"} {
		response, err := http.Get("http://" + address + path)
		if err != nil {
			t.Fatal(err)
		}
		data, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.Header.Get("Cache-Control") != "no-store" || response.Header.Get("ETag") != "" {
			t.Fatal("private response is cacheable")
		}
		switch path {
		case "/", "/index.html":
			if response.StatusCode != 200 || !strings.Contains(string(data), ClientAssetsPath+viewer.Assets().Digest()+"/js/FloeViewer.js") {
				t.Fatal("document and resources differ")
			}
		case "/default-settings.txt":
			if response.StatusCode != 200 || len(data) != 0 {
				t.Fatal("current defaults inherited legacy settings")
			}
		default:
			if response.StatusCode != 404 {
				t.Fatal("legacy asset alias remains reachable")
			}
		}
	}
	if calls.Load() != 0 {
		t.Fatal("viewer read the retained application's old resource tree")
	}
	if _, _, err := newApplicationProxy(backend.URL, nil); err != ErrViewerPreparation {
		t.Fatal("missing preparation did not fail explicitly")
	}
}
