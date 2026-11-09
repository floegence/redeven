package appserver

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func pictureRequest(t *testing.T, server *Server, method, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, hostApplicationsAPI+"/picture", strings.NewReader(body))
	r.Header.Set("Origin", envOriginWithChannel("ch_picture"))
	w := httptest.NewRecorder()
	if !server.handleHostApplicationsAPI(w, r) {
		t.Fatal("picture route not handled")
	}
	return w
}

func readPicture(t *testing.T, response *httptest.ResponseRecorder) config.HostApplicationPicture {
	t.Helper()
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("authenticated picture response must not be cached")
	}
	if response.Code != http.StatusOK {
		t.Fatalf("picture response: %d %s", response.Code, response.Body.String())
	}
	var envelope struct {
		OK   bool                          `json:"ok"`
		Data config.HostApplicationPicture `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil || !envelope.OK {
		t.Fatalf("invalid picture envelope: %v %s", err, response.Body.String())
	}
	return envelope.Data
}

func TestHostApplicationPictureUsesAuthenticatedOwnerAndPersistsAcrossRestart(t *testing.T) {
	path := writeTestConfig(t)
	server := func(owner string) *Server {
		return &Server{configPath: path, resolveSessionMeta: resolveMetaForTest("ch_picture", session.Meta{UserPublicID: owner, CanRead: true, CanWrite: true, CanExecute: true})}
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	alice := server("alice")
	got := readPicture(t, pictureRequest(t, alice, http.MethodGet, ""))
	if got != (config.HostApplicationPicture{Mode: "auto"}) {
		t.Fatalf("unexpected default: %+v", got)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatal("opening settings changed persisted configuration")
	}
	body := `{"mode":"smooth","max_dimension":2560,"frame_rate":60}`
	want := config.HostApplicationPicture{Mode: "smooth", MaxDimension: 2560, FrameRate: 60}
	if got := readPicture(t, pictureRequest(t, alice, http.MethodPut, body)); got != want {
		t.Fatalf("saved %+v", got)
	}
	if got := readPicture(t, pictureRequest(t, server("bob"), http.MethodGet, "")); got.Mode != "auto" {
		t.Fatal("alice preference leaked to bob")
	}
	readPicture(t, pictureRequest(t, server("bob"), http.MethodPut, `{"mode":"data","max_dimension":1600,"frame_rate":15}`))
	if got := readPicture(t, pictureRequest(t, server("alice"), http.MethodGet, "")); got != want {
		t.Fatalf("restart lost alice: %+v", got)
	}
	loaded, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.HostApplicationPictures) != 2 || loaded.HostApplicationPictures["bob"].Mode != "data" {
		t.Fatal("owner records not preserved")
	}
}

func TestHostApplicationPictureRequiresReadAndFullMutationPermission(t *testing.T) {
	for _, permissions := range []session.Meta{
		{UserPublicID: "alice"}, {UserPublicID: "alice", CanRead: true},
		{UserPublicID: "alice", CanRead: true, CanWrite: true}, {UserPublicID: "alice", CanRead: true, CanExecute: true},
		{UserPublicID: "alice", CanRead: true, CanWrite: true, CanExecute: true},
	} {
		server := &Server{configPath: writeTestConfig(t), resolveSessionMeta: resolveMetaForTest("ch_picture", permissions)}
		before, _ := os.ReadFile(server.configPath)
		response := pictureRequest(t, server, http.MethodGet, "")
		wantRead := http.StatusForbidden
		if permissions.CanRead {
			wantRead = http.StatusOK
		}
		if response.Code != wantRead {
			t.Fatalf("read permissions %+v: %d", permissions, response.Code)
		}
		response = pictureRequest(t, server, http.MethodPut, `{"mode":"clarity","max_dimension":0,"frame_rate":0}`)
		full := permissions.CanRead && permissions.CanWrite && permissions.CanExecute
		wantWrite := http.StatusForbidden
		if full {
			wantWrite = http.StatusOK
		}
		if response.Code != wantWrite {
			t.Fatalf("write permissions %+v: %d %s", permissions, response.Code, response.Body.String())
		}
		if !full {
			after, _ := os.ReadFile(server.configPath)
			if string(before) != string(after) {
				t.Fatal("forbidden mutation changed preferences")
			}
		}
	}
}

func TestHostApplicationPictureRejectsMalformedPayloadWithoutChangingConfiguration(t *testing.T) {
	server := &Server{configPath: writeTestConfig(t), resolveSessionMeta: resolveMetaForTest("ch_picture", session.Meta{UserPublicID: "alice", CanRead: true, CanWrite: true, CanExecute: true})}
	readPicture(t, pictureRequest(t, server, http.MethodPut, `{"mode":"clarity","max_dimension":1920,"frame_rate":30}`))
	before, _ := os.ReadFile(server.configPath)
	for _, body := range []string{
		`{}`, `null`, `{"mode":"bogus"}`, `{"mode":"auto","max_dimension":-1}`, `{"mode":"auto","frame_rate":120}`,
		`{"mode":"auto","owner":"bob"}`, `{"mode":"auto","max_dimension":"1920"}`, `{"mode":"auto"}{"mode":"data"}`,
	} {
		response := pictureRequest(t, server, http.MethodPut, body)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("invalid payload admitted: %s: %d %s", body, response.Code, response.Body.String())
		}
		after, _ := os.ReadFile(server.configPath)
		if string(before) != string(after) {
			t.Fatalf("invalid payload mutated configuration: %s", body)
		}
	}
	if got := pictureRequest(t, server, http.MethodDelete, ""); got.Code != http.StatusMethodNotAllowed {
		t.Fatalf("unsupported mutation: %d", got.Code)
	}
	response := httptest.NewRecorder()
	server.handleHostApplicationPicture(response, httptest.NewRequest(http.MethodPut, hostApplicationsAPI+"/picture", strings.NewReader(`{"mode":"auto"}`)), &session.Meta{})
	if response.Code != http.StatusForbidden {
		t.Fatal("missing authenticated owner admitted")
	}
}

func TestHostApplicationPictureViewerIsReadOnlyAndOwnerScoped(t *testing.T) {
	path := writeTestConfig(t)
	_, err := config.Update(path, func(cfg *config.Config) error {
		cfg.HostApplicationPictures = map[string]config.HostApplicationPicture{"alice": {Mode: "smooth", MaxDimension: 1920, FrameRate: 60}}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, owner := range []string{"alice", "bob"} {
		server := &Server{configPath: path, hostApps: &hostAppsStub{}, resolveSessionMeta: resolveMetaForTest("ch_picture", session.Meta{UserPublicID: owner, CanRead: true, CanWrite: true, CanExecute: true})}
		for _, method := range []string{http.MethodGet, http.MethodPut, http.MethodPost, http.MethodDelete} {
			r := httptest.NewRequest(method, hostApplicationBoot+"picture", strings.NewReader(`{"mode":"data"}`))
			r.Header.Set("Origin", envOriginWithChannel("ch_picture"))
			w := httptest.NewRecorder()
			if !server.guardHostApplicationForward(w, r, "http://127.0.0.1:40000", "") {
				t.Fatal("viewer route not guarded")
			}
			if owner != "alice" {
				if w.Code != http.StatusForbidden {
					t.Fatalf("viewer owner mismatch admitted: %d", w.Code)
				}
				continue
			}
			if method == http.MethodGet {
				if got := readPicture(t, w); got.Mode != "smooth" {
					t.Fatal("viewer did not read canonical preference")
				}
			} else if w.Code != http.StatusMethodNotAllowed {
				t.Fatalf("viewer mutation allowed: %s %d", method, w.Code)
			}
		}
	}
	loaded, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.HostApplicationPictures["alice"].Mode != "smooth" {
		t.Fatal("viewer changed preference")
	}
}
