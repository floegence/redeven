package appserver

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/session"
)

func newFSFileTestServer(t *testing.T, home string, meta session.Meta, policy *config.PermissionPolicy) (*Server, string) {
	t.Helper()

	cfgPath := writeTestConfig(t)
	if policy != nil {
		cfg, err := config.Load(cfgPath)
		if err != nil {
			t.Fatalf("config.Load: %v", err)
		}
		cfg.AgentHomeDir = home
		cfg.PermissionPolicy = policy
		if err := config.Save(cfgPath, cfg); err != nil {
			t.Fatalf("config.Save: %v", err)
		}
	}

	scope, err := newFSFileTestScope(home)
	if err != nil {
		t.Fatalf("newFSFileTestScope: %v", err)
	}

	channelID := "ch_fs_file_test"
	srv, err := New(Options{
		Backend:            &stubBackend{},
		DistFS:             fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}},
		ConfigPath:         cfgPath,
		AgentHomeDir:       home,
		FilesystemScope:    scope,
		ResolveSessionMeta: resolveMetaForTest(channelID, meta),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return srv, envOriginWithChannel(channelID)
}

func newFSFileTestScope(home string) (*filesystemscope.Registry, error) {
	return filesystemscope.NewRegistry(&config.Config{
		AgentHomeDir: home,
		FilesystemScope: &config.FilesystemScope{
			SchemaVersion: config.FilesystemScopeSchemaVersionV1,
			DefaultRootID: "home",
			Roots: []config.FilesystemRootPolicy{
				{
					ID:    "home",
					Label: "Home",
					Path:  home,
					Kind:  config.FilesystemRootHome,
					Permissions: config.FilesystemPermissionSet{
						Read:  true,
						Write: true,
					},
					System: true,
				},
			},
		},
	})
}

func fsFileResourcePath(path string) string {
	return localAPIFileEndpointPath + "?path=" + url.QueryEscape(path)
}

func performFSFileRequest(srv *Server, method string, target string, origin string, rangeHeader string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, fsFileResourcePath(target), nil)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}
	rr := httptest.NewRecorder()
	srv.serveHTTP(rr, req)
	return rr
}

func performFSAPIRequest(srv *Server, method string, target string, origin string, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rr := httptest.NewRecorder()
	srv.serveHTTP(rr, req)
	return rr
}

func decodeFSAPIEnvelope(t *testing.T, rr *httptest.ResponseRecorder) struct {
	OK    bool            `json:"ok"`
	Error string          `json:"error"`
	Data  json.RawMessage `json:"data"`
} {
	t.Helper()
	var out struct {
		OK    bool            `json:"ok"`
		Error string          `json:"error"`
		Data  json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("json.Unmarshal response: %v body=%s", err, rr.Body.String())
	}
	return out
}

func TestServerFSFileResourceServesRangeAndHead(t *testing.T) {
	t.Parallel()

	home := t.TempDir()
	mediaPath := filepath.Join(home, "clip.mp4")
	if err := os.WriteFile(mediaPath, []byte("0123456789abcdef"), 0o600); err != nil {
		t.Fatalf("os.WriteFile: %v", err)
	}

	srv, origin := newFSFileTestServer(t, home, session.Meta{CanRead: true}, nil)

	getResp := performFSFileRequest(srv, http.MethodGet, mediaPath, origin, "")
	if getResp.Code != http.StatusOK {
		t.Fatalf("GET status = %d, want %d body=%s", getResp.Code, http.StatusOK, getResp.Body.String())
	}
	if ct := getResp.Header().Get("Content-Type"); !strings.HasPrefix(ct, "video/mp4") {
		t.Fatalf("Content-Type = %q, want video/mp4", ct)
	}
	if cache := getResp.Header().Get("Cache-Control"); cache != "private, no-store" {
		t.Fatalf("Cache-Control = %q, want private, no-store", cache)
	}
	if cors := getResp.Header().Get("Access-Control-Allow-Origin"); cors != "" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want empty", cors)
	}
	if body := getResp.Body.String(); body != "0123456789abcdef" {
		t.Fatalf("GET body = %q", body)
	}

	headResp := performFSFileRequest(srv, http.MethodHead, mediaPath, origin, "")
	if headResp.Code != http.StatusOK {
		t.Fatalf("HEAD status = %d, want %d body=%s", headResp.Code, http.StatusOK, headResp.Body.String())
	}
	if headResp.Body.Len() != 0 {
		t.Fatalf("HEAD body length = %d, want 0", headResp.Body.Len())
	}
	if got := headResp.Header().Get("Content-Length"); got != "16" {
		t.Fatalf("HEAD Content-Length = %q, want 16", got)
	}

	rangeResp := performFSFileRequest(srv, http.MethodGet, mediaPath, origin, "bytes=2-5")
	if rangeResp.Code != http.StatusPartialContent {
		t.Fatalf("Range status = %d, want %d body=%s", rangeResp.Code, http.StatusPartialContent, rangeResp.Body.String())
	}
	if got := rangeResp.Header().Get("Content-Range"); got != "bytes 2-5/16" {
		t.Fatalf("Content-Range = %q, want bytes 2-5/16", got)
	}
	if got := rangeResp.Header().Get("Accept-Ranges"); got != "bytes" {
		t.Fatalf("Accept-Ranges = %q, want bytes", got)
	}
	if body := rangeResp.Body.String(); body != "2345" {
		t.Fatalf("Range body = %q, want 2345", body)
	}

	invalidRangeResp := performFSFileRequest(srv, http.MethodGet, mediaPath, origin, "bytes=99-120")
	if invalidRangeResp.Code != http.StatusRequestedRangeNotSatisfiable {
		t.Fatalf("invalid Range status = %d, want %d", invalidRangeResp.Code, http.StatusRequestedRangeNotSatisfiable)
	}
}

func TestServerFSAPIServesPathContextAndDirectoryList(t *testing.T) {
	t.Parallel()

	home := t.TempDir()
	homeReal, err := filepath.EvalSymlinks(home)
	if err != nil {
		t.Fatalf("EvalSymlinks(home): %v", err)
	}
	project := filepath.Join(home, "project")
	hidden := filepath.Join(home, ".hidden")
	filePath := filepath.Join(home, "notes.txt")
	if err := os.Mkdir(project, 0o755); err != nil {
		t.Fatalf("os.Mkdir(project): %v", err)
	}
	if err := os.Mkdir(hidden, 0o755); err != nil {
		t.Fatalf("os.Mkdir(hidden): %v", err)
	}
	if err := os.WriteFile(filePath, []byte("note"), 0o600); err != nil {
		t.Fatalf("os.WriteFile: %v", err)
	}

	srv, origin := newFSFileTestServer(t, home, session.Meta{CanRead: true}, nil)

	ctxResp := performFSAPIRequest(srv, http.MethodGet, localAPIFSPathContextEndpointPath, origin, "")
	if ctxResp.Code != http.StatusOK {
		t.Fatalf("path context status = %d, want %d body=%s", ctxResp.Code, http.StatusOK, ctxResp.Body.String())
	}
	ctxEnvelope := decodeFSAPIEnvelope(t, ctxResp)
	if !ctxEnvelope.OK {
		t.Fatalf("path context ok=false error=%q", ctxEnvelope.Error)
	}
	var pathContext struct {
		AgentHomePathAbs string `json:"agent_home_path_abs"`
		HomePathAbs      string `json:"home_path_abs"`
		Roots            []struct {
			Path string `json:"path"`
		} `json:"roots"`
	}
	if err := json.Unmarshal(ctxEnvelope.Data, &pathContext); err != nil {
		t.Fatalf("json.Unmarshal path context: %v", err)
	}
	if pathContext.AgentHomePathAbs != homeReal || pathContext.HomePathAbs != homeReal {
		t.Fatalf("path context home = (%q, %q), want %q", pathContext.AgentHomePathAbs, pathContext.HomePathAbs, homeReal)
	}
	if len(pathContext.Roots) != 1 || pathContext.Roots[0].Path != homeReal {
		t.Fatalf("path context roots = %#v, want home root", pathContext.Roots)
	}

	listResp := performFSAPIRequest(srv, http.MethodPost, localAPIFSListEndpointPath, origin, fmt.Sprintf(`{"path":%q}`, home))
	if listResp.Code != http.StatusOK {
		t.Fatalf("list status = %d, want %d body=%s", listResp.Code, http.StatusOK, listResp.Body.String())
	}
	listEnvelope := decodeFSAPIEnvelope(t, listResp)
	if !listEnvelope.OK {
		t.Fatalf("list ok=false error=%q", listEnvelope.Error)
	}
	var list struct {
		Entries []struct {
			Name        string `json:"name"`
			Path        string `json:"path"`
			IsDirectory bool   `json:"is_directory"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(listEnvelope.Data, &list); err != nil {
		t.Fatalf("json.Unmarshal list: %v", err)
	}
	names := map[string]bool{}
	for _, entry := range list.Entries {
		names[entry.Name] = true
		if entry.Name == "project" && (!entry.IsDirectory || entry.Path != project) {
			t.Fatalf("project entry = %#v, want directory at %q", entry, project)
		}
	}
	if !names["project"] || !names["notes.txt"] {
		t.Fatalf("list names = %#v, want project and notes.txt", names)
	}
	if names[".hidden"] {
		t.Fatalf("hidden entry returned with show_hidden=false")
	}

	hiddenResp := performFSAPIRequest(srv, http.MethodPost, localAPIFSListEndpointPath, origin, fmt.Sprintf(`{"path":%q,"show_hidden":true}`, home))
	if hiddenResp.Code != http.StatusOK {
		t.Fatalf("hidden list status = %d, want %d body=%s", hiddenResp.Code, http.StatusOK, hiddenResp.Body.String())
	}
	hiddenEnvelope := decodeFSAPIEnvelope(t, hiddenResp)
	var hiddenList struct {
		Entries []struct {
			Name string `json:"name"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(hiddenEnvelope.Data, &hiddenList); err != nil {
		t.Fatalf("json.Unmarshal hidden list: %v", err)
	}
	foundHidden := false
	for _, entry := range hiddenList.Entries {
		if entry.Name == ".hidden" {
			foundHidden = true
			break
		}
	}
	if !foundHidden {
		t.Fatalf("show_hidden=true list did not include .hidden: %#v", hiddenList.Entries)
	}
}

func TestServerFSAPIListRejectsInvalidPathsAndMissingPermission(t *testing.T) {
	t.Parallel()

	home := t.TempDir()
	filePath := filepath.Join(home, "notes.txt")
	if err := os.WriteFile(filePath, []byte("note"), 0o600); err != nil {
		t.Fatalf("os.WriteFile: %v", err)
	}
	missingPath := filepath.Join(home, "missing")
	outsidePath := filepath.Join(t.TempDir(), "outside")
	if err := os.Mkdir(outsidePath, 0o755); err != nil {
		t.Fatalf("os.Mkdir(outside): %v", err)
	}

	srv, origin := newFSFileTestServer(t, home, session.Meta{CanRead: true}, nil)
	for _, tc := range []struct {
		name       string
		path       string
		wantStatus int
		wantError  string
	}{
		{name: "missing", path: missingPath, wantStatus: http.StatusNotFound, wantError: "not found"},
		{name: "not directory", path: filePath, wantStatus: http.StatusBadRequest, wantError: "path is not a directory"},
		{name: "outside scope", path: outsidePath, wantStatus: http.StatusForbidden, wantError: "path outside filesystem scope"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resp := performFSAPIRequest(srv, http.MethodPost, localAPIFSListEndpointPath, origin, fmt.Sprintf(`{"path":%q}`, tc.path))
			if resp.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d body=%s", resp.Code, tc.wantStatus, resp.Body.String())
			}
			envelope := decodeFSAPIEnvelope(t, resp)
			if envelope.OK || envelope.Error != tc.wantError {
				t.Fatalf("envelope = %#v, want ok=false error=%q", envelope, tc.wantError)
			}
		})
	}

	noReadSrv, noReadOrigin := newFSFileTestServer(t, home, session.Meta{CanRead: false}, nil)
	resp := performFSAPIRequest(noReadSrv, http.MethodGet, localAPIFSPathContextEndpointPath, noReadOrigin, "")
	if resp.Code != http.StatusForbidden {
		t.Fatalf("no read path context status = %d, want %d body=%s", resp.Code, http.StatusForbidden, resp.Body.String())
	}
	resp = performFSAPIRequest(noReadSrv, http.MethodPost, localAPIFSListEndpointPath, noReadOrigin, fmt.Sprintf(`{"path":%q}`, home))
	if resp.Code != http.StatusForbidden {
		t.Fatalf("no read list status = %d, want %d body=%s", resp.Code, http.StatusForbidden, resp.Body.String())
	}
}

func TestServerFSFileResourceAllowsLargeMediaRange(t *testing.T) {
	t.Parallel()

	home := t.TempDir()
	mediaPath := filepath.Join(home, "large.webm")
	f, err := os.Create(mediaPath)
	if err != nil {
		t.Fatalf("os.Create: %v", err)
	}
	if _, err := f.Seek(64<<20, io.SeekStart); err != nil {
		t.Fatalf("Seek: %v", err)
	}
	if _, err := f.Write([]byte("abcdef")); err != nil {
		t.Fatalf("Write: %v", err)
	}
	if err := f.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	srv, origin := newFSFileTestServer(t, home, session.Meta{CanRead: true}, nil)
	resp := performFSFileRequest(srv, http.MethodGet, mediaPath, origin, "bytes=0-3")
	if resp.Code != http.StatusPartialContent {
		t.Fatalf("status = %d, want %d body=%s", resp.Code, http.StatusPartialContent, resp.Body.String())
	}
	if got := resp.Header().Get("Content-Range"); got != fmt.Sprintf("bytes 0-3/%d", (64<<20)+6) {
		t.Fatalf("Content-Range = %q", got)
	}
}

func TestServerFSFileResourceRejectsUnauthorizedOriginsAndPermissions(t *testing.T) {
	t.Parallel()

	home := t.TempDir()
	filePath := filepath.Join(home, "clip.mp4")
	if err := os.WriteFile(filePath, []byte("media"), 0o600); err != nil {
		t.Fatalf("os.WriteFile: %v", err)
	}

	srv, origin := newFSFileTestServer(t, home, session.Meta{CanRead: true}, nil)

	codespaceResp := performFSFileRequest(srv, http.MethodGet, filePath, strings.Replace(origin, "env-", "cs-", 1), "")
	if codespaceResp.Code != http.StatusNotFound {
		t.Fatalf("codespace status = %d, want %d", codespaceResp.Code, http.StatusNotFound)
	}

	unknownResp := performFSFileRequest(srv, http.MethodGet, filePath, "https://example.com", "")
	if unknownResp.Code != http.StatusNotFound {
		t.Fatalf("unknown origin status = %d, want %d", unknownResp.Code, http.StatusNotFound)
	}

	gwNoRead, noReadOrigin := newFSFileTestServer(t, home, session.Meta{CanRead: false}, nil)
	noReadResp := performFSFileRequest(gwNoRead, http.MethodGet, filePath, noReadOrigin, "")
	if noReadResp.Code != http.StatusForbidden {
		t.Fatalf("no-read status = %d, want %d", noReadResp.Code, http.StatusForbidden)
	}

	noOriginReq := httptest.NewRequest(http.MethodGet, fsFileResourcePath(filePath), nil)
	noOriginReq.Host = "env-123.example.com"
	noOriginResp := httptest.NewRecorder()
	srv.serveHTTP(noOriginResp, noOriginReq)
	if noOriginResp.Code != http.StatusBadRequest {
		t.Fatalf("missing channel label status = %d, want %d", noOriginResp.Code, http.StatusBadRequest)
	}
}

func TestServerFSFileResourceRejectsScopeAndUnsupportedTypes(t *testing.T) {
	t.Parallel()

	home := t.TempDir()
	outside := t.TempDir()
	pdfPath := filepath.Join(home, "doc.pdf")
	dirPath := filepath.Join(home, "folder")
	outsidePath := filepath.Join(outside, "clip.mp4")
	unsupportedPath := filepath.Join(home, "archive.bin")
	htmlPath := filepath.Join(home, "page.html")
	jsPath := filepath.Join(home, "script.js")
	svgPath := filepath.Join(home, "vector.svg")

	if err := os.WriteFile(pdfPath, []byte("%PDF"), 0o600); err != nil {
		t.Fatalf("write pdf: %v", err)
	}
	if err := os.Mkdir(dirPath, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(outsidePath, []byte("media"), 0o600); err != nil {
		t.Fatalf("write outside: %v", err)
	}
	if err := os.WriteFile(unsupportedPath, []byte{0, 1, 2}, 0o600); err != nil {
		t.Fatalf("write unsupported: %v", err)
	}
	if err := os.WriteFile(htmlPath, []byte("<script>fetch('/_redeven_proxy/api/settings')</script>"), 0o600); err != nil {
		t.Fatalf("write html: %v", err)
	}
	if err := os.WriteFile(jsPath, []byte("fetch('/_redeven_proxy/api/settings')"), 0o600); err != nil {
		t.Fatalf("write js: %v", err)
	}
	if err := os.WriteFile(svgPath, []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script /></svg>`), 0o600); err != nil {
		t.Fatalf("write svg: %v", err)
	}

	srv, origin := newFSFileTestServer(t, home, session.Meta{CanRead: true}, nil)

	outsideResp := performFSFileRequest(srv, http.MethodGet, outsidePath, origin, "")
	if outsideResp.Code != http.StatusForbidden {
		t.Fatalf("outside status = %d, want %d", outsideResp.Code, http.StatusForbidden)
	}

	dirResp := performFSFileRequest(srv, http.MethodGet, dirPath, origin, "")
	if dirResp.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("dir status = %d, want %d", dirResp.Code, http.StatusUnsupportedMediaType)
	}

	unsupportedResp := performFSFileRequest(srv, http.MethodGet, unsupportedPath, origin, "")
	if unsupportedResp.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("unsupported status = %d, want %d", unsupportedResp.Code, http.StatusUnsupportedMediaType)
	}
	for _, activePath := range []string{htmlPath, jsPath, svgPath} {
		activeResp := performFSFileRequest(srv, http.MethodGet, activePath, origin, "")
		if activeResp.Code != http.StatusUnsupportedMediaType {
			t.Fatalf("active content %s status = %d, want %d", filepath.Base(activePath), activeResp.Code, http.StatusUnsupportedMediaType)
		}
	}

	pdfResp := performFSFileRequest(srv, http.MethodGet, pdfPath, origin, "")
	if pdfResp.Code != http.StatusOK {
		t.Fatalf("pdf status = %d, want %d body=%s", pdfResp.Code, http.StatusOK, pdfResp.Body.String())
	}
	if ct := pdfResp.Header().Get("Content-Type"); ct != "application/pdf" {
		t.Fatalf("pdf Content-Type = %q, want application/pdf", ct)
	}
}

func TestServerFSFileResourceHonorsLocalUIReadCap(t *testing.T) {
	t.Parallel()

	home := t.TempDir()
	filePath := filepath.Join(home, "clip.mp4")
	if err := os.WriteFile(filePath, []byte("media"), 0o600); err != nil {
		t.Fatalf("os.WriteFile: %v", err)
	}

	noRead := config.PermissionSet{Read: false, Write: false, Execute: false}
	policy := &config.PermissionPolicy{SchemaVersion: 1, LocalMax: &noRead}
	srv, _ := newFSFileTestServer(t, home, session.Meta{CanRead: true}, policy)

	req := WithLocalUIEnvRoute(httptest.NewRequest(http.MethodGet, fsFileResourcePath(filePath), bytes.NewReader(nil)))
	resp := httptest.NewRecorder()
	srv.serveHTTP(resp, req)
	if resp.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d body=%s", resp.Code, http.StatusForbidden, resp.Body.String())
	}
}

func TestServerFSFileContentTypeFallbacks(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"clip.mp4":   "video/mp4",
		"clip.m4v":   "video/x-m4v",
		"clip.webm":  "video/webm",
		"clip.mov":   "video/quicktime",
		"clip.mkv":   "video/x-matroska",
		"song.mp3":   "audio/mpeg",
		"song.m4a":   "audio/mp4",
		"song.aac":   "audio/aac",
		"song.wav":   "audio/wav",
		"song.ogg":   "audio/ogg",
		"song.opus":  "audio/ogg",
		"song.flac":  "audio/flac",
		"image.webp": "image/webp",
	}
	for name, want := range cases {
		if got := fsFileContentType(name); got != want {
			t.Fatalf("fsFileContentType(%q) = %q, want %q", name, got, want)
		}
	}
}
