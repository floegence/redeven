package codeserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type remoteRoundTripFunc func(*http.Request) (*http.Response, error)

func (fn remoteRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func remoteURLHost(t *testing.T, rawURL string) string {
	t.Helper()
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" {
		t.Fatalf("parse remote URL %q: %v", rawURL, err)
	}
	return parsed.Host
}

func validRemoteCatalog(manifest WorkspaceEngineArtifactManifest, downloadURL string) remoteCatalog {
	platform := manifest.Platform
	return remoteCatalog{
		SchemaVersion: workspaceEngineManifestSchemaVersion,
		Engine:        workspaceEngineNameCodeServer,
		GeneratedAt:   "2026-07-15T00:00:00Z",
		Source: remoteCatalogSource{
			Kind:       "github_release",
			Repo:       "coder/code-server",
			ReleaseTag: "v" + manifest.Version,
			ReleaseURL: "https://github.com/coder/code-server/releases/tag/v" + manifest.Version,
		},
		Latest: remoteCatalogLatest{
			Version:    manifest.Version,
			ReleaseTag: "v" + manifest.Version,
		},
		Platforms: map[string]remoteCatalogPlatform{
			platform.PlatformID: {
				OS:          platform.OS,
				Arch:        platform.Arch,
				Libc:        platform.Libc,
				PlatformID:  platform.PlatformID,
				AssetName:   manifest.Source.AssetName,
				DownloadURL: downloadURL,
				SHA256:      manifest.Archive.SHA256,
				SizeBytes:   manifest.Archive.SizeBytes,
				Compression: manifest.Archive.Compression,
				RootDirHint: manifest.Layout.RootDirHint,
			},
		},
		MirrorComplete: true,
	}
}

func cloneRemoteCatalog(t *testing.T, catalog remoteCatalog) remoteCatalog {
	t.Helper()
	body, err := json.Marshal(catalog)
	if err != nil {
		t.Fatalf("marshal catalog: %v", err)
	}
	var cloned remoteCatalog
	if err := json.Unmarshal(body, &cloned); err != nil {
		t.Fatalf("unmarshal catalog: %v", err)
	}
	return cloned
}

func setupOperationErrorCode(err error) string {
	var operationErr *setupOperationError
	if errors.As(err, &operationErr) {
		return operationErr.code
	}
	return ""
}

func TestValidateRemoteBrowserEditorCatalog(t *testing.T) {
	manifest, _ := writeFakeWorkspaceEngineArchive(t, "4.128.0", t.TempDir())
	packageURL := defaultBrowserEditorPackageOrigin + "/browser-editor/code-server/v4.128.0/" + manifest.Source.AssetName
	base := validRemoteCatalog(manifest, packageURL)
	if asset, err := validateRemoteBrowserEditorCatalog(base, manifest.Platform, defaultBrowserEditorPackageOrigin); err != nil {
		t.Fatalf("validateRemoteBrowserEditorCatalog(valid) error = %v", err)
	} else if asset.Manifest.Version != manifest.Version || asset.DownloadURL != packageURL {
		t.Fatalf("asset=%+v, want version %q and URL %q", asset, manifest.Version, packageURL)
	}

	tests := []struct {
		name string
		edit func(*remoteCatalog)
		code string
	}{
		{name: "schema", edit: func(c *remoteCatalog) { c.SchemaVersion++ }, code: "catalog_invalid"},
		{name: "engine", edit: func(c *remoteCatalog) { c.Engine = "other" }, code: "catalog_invalid"},
		{name: "mirror incomplete", edit: func(c *remoteCatalog) { c.MirrorComplete = false }, code: "catalog_incomplete"},
		{name: "platform missing", edit: func(c *remoteCatalog) { c.Platforms = map[string]remoteCatalogPlatform{} }, code: "catalog_platform_missing"},
		{name: "compression", edit: func(c *remoteCatalog) {
			entry := c.Platforms[manifest.Platform.PlatformID]
			entry.Compression = "zip"
			c.Platforms[manifest.Platform.PlatformID] = entry
		}, code: "catalog_invalid"},
		{name: "sha", edit: func(c *remoteCatalog) {
			entry := c.Platforms[manifest.Platform.PlatformID]
			entry.SHA256 = "not-a-sha"
			c.Platforms[manifest.Platform.PlatformID] = entry
		}, code: "catalog_invalid"},
		{name: "size", edit: func(c *remoteCatalog) {
			entry := c.Platforms[manifest.Platform.PlatformID]
			entry.SizeBytes = 0
			c.Platforms[manifest.Platform.PlatformID] = entry
		}, code: "catalog_invalid"},
		{name: "source", edit: func(c *remoteCatalog) {
			entry := c.Platforms[manifest.Platform.PlatformID]
			entry.DownloadURL = "https://example.com/browser-editor.tar.gz"
			c.Platforms[manifest.Platform.PlatformID] = entry
		}, code: "package_source_rejected"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			catalog := cloneRemoteCatalog(t, base)
			test.edit(&catalog)
			_, err := validateRemoteBrowserEditorCatalog(catalog, manifest.Platform, defaultBrowserEditorPackageOrigin)
			if code := setupOperationErrorCode(err); code != test.code {
				t.Fatalf("error=%v code=%q, want %q", err, code, test.code)
			}
		})
	}
}

func TestResolveRemoteBrowserEditorAssetRejectsUnknownAndTrailingJSON(t *testing.T) {
	manifest, _ := writeFakeWorkspaceEngineArchive(t, "4.128.0", t.TempDir())
	catalog := validRemoteCatalog(
		manifest,
		defaultBrowserEditorPackageOrigin+"/browser-editor/code-server/v4.128.0/"+manifest.Source.AssetName,
	)
	validBody, err := json.Marshal(catalog)
	if err != nil {
		t.Fatalf("marshal catalog: %v", err)
	}
	var withUnknown map[string]any
	if err := json.Unmarshal(validBody, &withUnknown); err != nil {
		t.Fatalf("unmarshal catalog: %v", err)
	}
	withUnknown["download_url"] = "https://example.com/client-injected"
	unknownBody, err := json.Marshal(withUnknown)
	if err != nil {
		t.Fatalf("marshal unknown catalog: %v", err)
	}

	for _, test := range []struct {
		name string
		body []byte
	}{
		{name: "unknown field", body: unknownBody},
		{name: "trailing JSON", body: append(append([]byte{}, validBody...), []byte(` {"extra":true}`)...)},
	} {
		t.Run(test.name, func(t *testing.T) {
			mgr := newTestRuntimeManager(t)
			mgr.remoteDownload.transport = remoteRoundTripFunc(func(request *http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: http.StatusOK,
					Header:     make(http.Header),
					Body:       io.NopCloser(bytes.NewReader(test.body)),
					Request:    request,
				}, nil
			})
			_, err := mgr.resolveRemoteBrowserEditorAsset(context.Background())
			if code := setupOperationErrorCode(err); code != "catalog_invalid" {
				t.Fatalf("error=%v code=%q, want catalog_invalid", err, code)
			}
		})
	}
}

func TestRemoteHTTPClientUsesEnvironmentProxyAndRejectsCrossOriginRedirects(t *testing.T) {
	t.Setenv("HTTPS_PROXY", "http://127.0.0.1:18888")
	mgr := newTestRuntimeManager(t)
	initialURL, err := url.Parse(defaultBrowserEditorCatalogURL)
	if err != nil {
		t.Fatalf("parse catalog URL: %v", err)
	}
	client := mgr.remoteHTTPClient(initialURL, false)
	transport, ok := client.Transport.(*http.Transport)
	if !ok || transport.Proxy == nil {
		t.Fatalf("transport=%T proxy=%v, want environment proxy support", client.Transport, transport)
	}
	request, _ := http.NewRequest(http.MethodGet, defaultBrowserEditorCatalogURL, nil)
	proxyURL, err := transport.Proxy(request)
	if err != nil || proxyURL == nil || proxyURL.String() != "http://127.0.0.1:18888" {
		t.Fatalf("proxy=%v err=%v, want configured HTTPS_PROXY", proxyURL, err)
	}

	crossOrigin, _ := http.NewRequest(http.MethodGet, "https://example.com/catalog.json", nil)
	if err := client.CheckRedirect(crossOrigin, []*http.Request{request}); err == nil {
		t.Fatal("catalog cross-origin redirect error = nil")
	}
	packageURL, _ := url.Parse(defaultBrowserEditorPackageOrigin + "/browser-editor/code-server/package.tar.gz")
	packageClient := mgr.remoteHTTPClient(packageURL, true)
	allowedPackage, _ := http.NewRequest(http.MethodGet, defaultBrowserEditorPackageOrigin+"/browser-editor/code-server/other.tar.gz", nil)
	if err := packageClient.CheckRedirect(allowedPackage, []*http.Request{request}); err != nil {
		t.Fatalf("same-origin package redirect error = %v", err)
	}
	if err := packageClient.CheckRedirect(crossOrigin, []*http.Request{request}); err == nil {
		t.Fatal("package cross-origin redirect error = nil")
	}
}

type progressResponseBody struct {
	data      []byte
	chunkSize int
	onRead    func()
}

func (body *progressResponseBody) Read(destination []byte) (int, error) {
	if body.onRead != nil {
		body.onRead()
	}
	if len(body.data) == 0 {
		return 0, io.EOF
	}
	length := min(len(destination), body.chunkSize, len(body.data))
	copy(destination, body.data[:length])
	body.data = body.data[length:]
	return length, nil
}

func (body *progressResponseBody) Close() error { return nil }

func TestRemoteDownloadSetupUsesVerifiedCacheAndReportsMonotonicProgress(t *testing.T) {
	stateDir := t.TempDir()
	stateRoot := t.TempDir()
	manifest, archivePath := writeFakeWorkspaceEngineArchive(t, "4.128.0", stateRoot)
	archive, err := os.ReadFile(archivePath)
	if err != nil {
		t.Fatalf("read archive: %v", err)
	}
	packageURL := defaultBrowserEditorPackageOrigin + "/browser-editor/code-server/v4.128.0/" + manifest.Source.AssetName
	catalogBody, err := json.Marshal(validRemoteCatalog(manifest, packageURL))
	if err != nil {
		t.Fatalf("marshal catalog: %v", err)
	}

	var packageCalls atomic.Int32
	var progressMu sync.Mutex
	progressSnapshots := make([]int64, 0, 16)
	catalogHost := remoteURLHost(t, defaultBrowserEditorCatalogURL)
	packageHost := remoteURLHost(t, defaultBrowserEditorPackageOrigin)
	mgr := NewRuntimeManager(RuntimeManagerOptions{StateDir: stateDir, StateRoot: stateRoot})
	mgr.remoteDownload.progressInterval = time.Nanosecond
	mgr.remoteDownload.transport = remoteRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		switch request.URL.Host {
		case catalogHost:
			return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(catalogBody)), Request: request}, nil
		case packageHost:
			packageCalls.Add(1)
			body := &progressResponseBody{
				data:      append([]byte(nil), archive...),
				chunkSize: max(1, len(archive)/4),
				onRead: func() {
					status := mgr.Status(context.Background())
					if status.Operation.Transfer != nil {
						progressMu.Lock()
						progressSnapshots = append(progressSnapshots, status.Operation.Transfer.ReceivedBytes)
						progressMu.Unlock()
					}
				},
			}
			return &http.Response{
				StatusCode:    http.StatusOK,
				Header:        make(http.Header),
				Body:          body,
				ContentLength: int64(len(archive)),
				Request:       request,
			}, nil
		default:
			return nil, errors.New("unexpected remote host " + request.URL.Host)
		}
	})

	if _, err := mgr.CreateSetupOperation(context.Background(), "remote:first", BrowserEditorInstallMethodRemoteDownload, nil); err != nil {
		t.Fatalf("CreateSetupOperation(first) error = %v", err)
	}
	first := waitForOperationState(t, mgr, RuntimeOperationStateSucceeded)
	if first.Operation.OperationID != "remote:first" || first.Operation.InstallMethod != BrowserEditorInstallMethodRemoteDownload {
		t.Fatalf("operation=%+v, want first remote operation", first.Operation)
	}
	if first.Operation.Transfer == nil || first.Operation.Transfer.ReceivedBytes != manifest.Archive.SizeBytes || first.Operation.Transfer.FromCache {
		t.Fatalf("transfer=%+v, want downloaded full package", first.Operation.Transfer)
	}
	progressMu.Lock()
	for index := 1; index < len(progressSnapshots); index++ {
		if progressSnapshots[index] < progressSnapshots[index-1] {
			t.Fatalf("progress snapshots are not monotonic: %v", progressSnapshots)
		}
	}
	progressMu.Unlock()

	if _, err := mgr.CreateSetupOperation(context.Background(), "remote:cached", BrowserEditorInstallMethodRemoteDownload, nil); err != nil {
		t.Fatalf("CreateSetupOperation(cached) error = %v", err)
	}
	cached := waitForOperationState(t, mgr, RuntimeOperationStateSucceeded)
	if cached.Operation.Transfer == nil || !cached.Operation.Transfer.FromCache {
		t.Fatalf("cached transfer=%+v, want verified cache hit", cached.Operation.Transfer)
	}
	if calls := packageCalls.Load(); calls != 1 {
		t.Fatalf("package calls=%d, want 1 after cache hit", calls)
	}

	asset, err := validateRemoteBrowserEditorCatalog(validRemoteCatalog(manifest, packageURL), manifest.Platform, defaultBrowserEditorPackageOrigin)
	if err != nil {
		t.Fatalf("validate catalog: %v", err)
	}
	cachePath := remoteCacheArchivePath(stateRoot, manifest.Platform, manifest.Version, asset.AssetName)
	if err := os.WriteFile(cachePath, []byte("corrupt"), 0o600); err != nil {
		t.Fatalf("corrupt cache: %v", err)
	}
	staleRoot := filepath.Join(remotePlatformCacheRoot(stateRoot, manifest.Platform), "4.127.0")
	if err := os.MkdirAll(staleRoot, 0o700); err != nil {
		t.Fatalf("create stale cache: %v", err)
	}
	if _, err := mgr.CreateSetupOperation(context.Background(), "remote:repair-cache", BrowserEditorInstallMethodRemoteDownload, nil); err != nil {
		t.Fatalf("CreateSetupOperation(repair cache) error = %v", err)
	}
	repaired := waitForOperationState(t, mgr, RuntimeOperationStateSucceeded)
	if repaired.Operation.Transfer == nil || repaired.Operation.Transfer.FromCache {
		t.Fatalf("repaired transfer=%+v, want cache miss after invalidation", repaired.Operation.Transfer)
	}
	if calls := packageCalls.Load(); calls != 2 {
		t.Fatalf("package calls=%d, want 2 after invalid cache", calls)
	}
	if _, err := os.Stat(staleRoot); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stale cache should be pruned, err=%v", err)
	}
}

type blockingResponseBody struct {
	ctx     context.Context
	started chan struct{}
	once    sync.Once
	closed  atomic.Bool
}

func (body *blockingResponseBody) Read([]byte) (int, error) {
	body.once.Do(func() { close(body.started) })
	<-body.ctx.Done()
	return 0, body.ctx.Err()
}

func (body *blockingResponseBody) Close() error {
	body.closed.Store(true)
	return nil
}

func TestRemoteDownloadIdleTimeoutAndCancellationCleanTemporaryFiles(t *testing.T) {
	for _, test := range []struct {
		name      string
		cancel    bool
		wantState RuntimeOperationState
		wantCode  string
	}{
		{name: "idle timeout", wantState: RuntimeOperationStateFailed, wantCode: "environment_download_idle_timeout"},
		{name: "cancel", cancel: true, wantState: RuntimeOperationStateCancelled},
	} {
		t.Run(test.name, func(t *testing.T) {
			stateDir := t.TempDir()
			stateRoot := t.TempDir()
			manifest, _ := writeFakeWorkspaceEngineArchive(t, "4.128.0", stateRoot)
			packageURL := defaultBrowserEditorPackageOrigin + "/browser-editor/code-server/v4.128.0/" + manifest.Source.AssetName
			catalogBody, err := json.Marshal(validRemoteCatalog(manifest, packageURL))
			if err != nil {
				t.Fatalf("marshal catalog: %v", err)
			}
			started := make(chan struct{})
			var packageBody *blockingResponseBody
			mgr := NewRuntimeManager(RuntimeManagerOptions{StateDir: stateDir, StateRoot: stateRoot})
			mgr.remoteDownload.idleTimeout = 40 * time.Millisecond
			if test.cancel {
				mgr.remoteDownload.idleTimeout = 5 * time.Second
			}
			catalogHost := remoteURLHost(t, defaultBrowserEditorCatalogURL)
			mgr.remoteDownload.transport = remoteRoundTripFunc(func(request *http.Request) (*http.Response, error) {
				if request.URL.Host == catalogHost {
					return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(catalogBody)), Request: request}, nil
				}
				packageBody = &blockingResponseBody{ctx: request.Context(), started: started}
				return &http.Response{
					StatusCode:    http.StatusOK,
					Header:        make(http.Header),
					Body:          packageBody,
					ContentLength: manifest.Archive.SizeBytes,
					Request:       request,
				}, nil
			})
			operationID := "remote:" + strings.ReplaceAll(test.name, " ", "-")
			if _, err := mgr.CreateSetupOperation(context.Background(), operationID, BrowserEditorInstallMethodRemoteDownload, nil); err != nil {
				t.Fatalf("CreateSetupOperation() error = %v", err)
			}
			select {
			case <-started:
			case <-time.After(5 * time.Second):
				t.Fatal("package download did not start")
			}
			if test.cancel {
				if _, err := mgr.CancelSetupOperation(context.Background(), operationID); err != nil {
					t.Fatalf("CancelSetupOperation() error = %v", err)
				}
			}
			status := waitForOperationState(t, mgr, test.wantState)
			if status.Operation.LastErrorCode != test.wantCode {
				t.Fatalf("last_error_code=%q, want %q", status.Operation.LastErrorCode, test.wantCode)
			}
			tempPath := remoteDownloadTempPath(stateRoot, manifest.Platform, operationID)
			if _, err := os.Stat(tempPath); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("temporary download should be removed, err=%v", err)
			}
			if packageBody == nil || !packageBody.closed.Load() {
				t.Fatal("package response body was not closed")
			}
		})
	}
}
