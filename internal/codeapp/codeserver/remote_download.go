package codeserver

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	defaultBrowserEditorCatalogURL    = "https://version.agent.redeven.com/v1/browser-editor/code-server/latest.json"
	defaultBrowserEditorPackageOrigin = "https://agent.package.redeven.com"
	defaultRemoteHeaderTimeout        = 60 * time.Second
	defaultRemoteDownloadIdleTimeout  = 90 * time.Second
	defaultRemoteProgressInterval     = 250 * time.Millisecond
	maxBrowserEditorCatalogBytes      = 2 * 1024 * 1024
)

type remoteDownloadConfig struct {
	catalogURL       string
	packageOrigin    string
	transport        http.RoundTripper
	headerTimeout    time.Duration
	idleTimeout      time.Duration
	progressInterval time.Duration
}

type remoteCatalog struct {
	SchemaVersion  int                              `json:"schema_version"`
	Engine         string                           `json:"engine"`
	GeneratedAt    string                           `json:"generated_at"`
	Source         remoteCatalogSource              `json:"source"`
	Latest         remoteCatalogLatest              `json:"latest"`
	Platforms      map[string]remoteCatalogPlatform `json:"platforms"`
	MirrorComplete bool                             `json:"mirror_complete"`
}

type remoteCatalogSource struct {
	Kind       string `json:"kind"`
	Repo       string `json:"repo"`
	ReleaseTag string `json:"release_tag"`
	ReleaseURL string `json:"release_url"`
}

type remoteCatalogLatest struct {
	Version    string `json:"version"`
	ReleaseTag string `json:"release_tag"`
}

type remoteCatalogPlatform struct {
	OS          string `json:"os"`
	Arch        string `json:"arch"`
	Libc        string `json:"libc"`
	PlatformID  string `json:"platform_id"`
	AssetName   string `json:"asset_name"`
	DownloadURL string `json:"download_url"`
	SHA256      string `json:"sha256"`
	SizeBytes   int64  `json:"size_bytes"`
	Compression string `json:"compression"`
	RootDirHint string `json:"root_dir_hint"`
}

type remoteBrowserEditorAsset struct {
	Manifest    WorkspaceEngineArtifactManifest
	DownloadURL string
	AssetName   string
}

type setupOperationError struct {
	code string
	err  error
}

func (e *setupOperationError) Error() string {
	if e == nil || e.err == nil {
		return "browser editor setup failed"
	}
	return e.err.Error()
}

func (e *setupOperationError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.err
}

func setupError(code string, err error) error {
	return &setupOperationError{code: code, err: err}
}

func defaultRemoteDownloadConfig() remoteDownloadConfig {
	return remoteDownloadConfig{
		catalogURL:       defaultBrowserEditorCatalogURL,
		packageOrigin:    defaultBrowserEditorPackageOrigin,
		headerTimeout:    defaultRemoteHeaderTimeout,
		idleTimeout:      defaultRemoteDownloadIdleTimeout,
		progressInterval: defaultRemoteProgressInterval,
	}
}

func (m *RuntimeManager) runRemoteDownloadSetupOperation(ctx context.Context, operationID string) {
	asset, err := m.resolveRemoteBrowserEditorAsset(ctx)
	if err == nil {
		m.setSetupTargetVersion(operationID, asset.Manifest.Version)
		m.setSetupStage(operationID, RuntimeOperationStageDownloading)
		m.setSetupTransferProgress(operationID, 0, asset.Manifest.Archive.SizeBytes, false)
		m.appendSetupLog(operationID, "Downloading the Browser Editor package through the environment network.")
		var archivePath string
		var fromCache bool
		archivePath, fromCache, err = m.ensureRemoteBrowserEditorArchive(ctx, operationID, asset)
		if err == nil {
			m.setSetupTransferProgress(operationID, asset.Manifest.Archive.SizeBytes, asset.Manifest.Archive.SizeBytes, fromCache)
			if fromCache {
				m.appendSetupLog(operationID, "Using the verified Browser Editor cache for this environment platform.")
			}
			_, err = m.installWorkspaceEnginePackage(context.Background(), ctx, operationID, archivePath, asset.Manifest)
		}
	}
	if err == nil {
		return
	}
	if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
		m.finishSetupOperation(operationID, "", "", true)
		return
	}
	code := "environment_download_failed"
	var operationErr *setupOperationError
	if errors.As(err, &operationErr) && strings.TrimSpace(operationErr.code) != "" {
		code = operationErr.code
	}
	m.appendSetupLog(operationID, "Browser Editor setup failed: "+err.Error())
	m.finishSetupOperation(operationID, code, err.Error(), false)
}

func (m *RuntimeManager) resolveRemoteBrowserEditorAsset(ctx context.Context) (remoteBrowserEditorAsset, error) {
	catalogURL, err := url.Parse(strings.TrimSpace(m.remoteDownload.catalogURL))
	if err != nil || catalogURL.Scheme == "" || catalogURL.Host == "" {
		return remoteBrowserEditorAsset{}, setupError("catalog_invalid", errors.New("Redeven Browser Editor catalog URL is invalid"))
	}
	client := m.remoteHTTPClient(catalogURL, false)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, catalogURL.String(), nil)
	if err != nil {
		return remoteBrowserEditorAsset{}, setupError("catalog_request_failed", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Redeven-Runtime")
	response, err := client.Do(req)
	if err != nil {
		return remoteBrowserEditorAsset{}, setupError("catalog_request_failed", fmt.Errorf("could not reach the Redeven Browser Editor catalog: %w", err))
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return remoteBrowserEditorAsset{}, setupError("catalog_request_failed", fmt.Errorf("Redeven Browser Editor catalog returned HTTP %d", response.StatusCode))
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxBrowserEditorCatalogBytes+1))
	if err != nil {
		return remoteBrowserEditorAsset{}, setupError("catalog_request_failed", fmt.Errorf("could not read the Redeven Browser Editor catalog: %w", err))
	}
	if len(body) > maxBrowserEditorCatalogBytes {
		return remoteBrowserEditorAsset{}, setupError("catalog_invalid", errors.New("Redeven Browser Editor catalog is too large"))
	}
	var catalog remoteCatalog
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&catalog); err != nil {
		return remoteBrowserEditorAsset{}, setupError("catalog_invalid", fmt.Errorf("Redeven Browser Editor catalog is invalid JSON: %w", err))
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return remoteBrowserEditorAsset{}, setupError("catalog_invalid", errors.New("Redeven Browser Editor catalog contains trailing JSON content"))
	}
	return validateRemoteBrowserEditorCatalog(catalog, currentWorkspaceEnginePlatform(), m.remoteDownload.packageOrigin)
}

func validateRemoteBrowserEditorCatalog(
	catalog remoteCatalog,
	platform WorkspaceEnginePlatform,
	packageOrigin string,
) (remoteBrowserEditorAsset, error) {
	if catalog.SchemaVersion != workspaceEngineManifestSchemaVersion {
		return remoteBrowserEditorAsset{}, setupError("catalog_invalid", fmt.Errorf("Redeven Browser Editor catalog schema version %d is not supported", catalog.SchemaVersion))
	}
	if strings.TrimSpace(catalog.Engine) != workspaceEngineNameCodeServer {
		return remoteBrowserEditorAsset{}, setupError("catalog_invalid", errors.New("Redeven Browser Editor catalog has an unsupported engine"))
	}
	if !catalog.MirrorComplete {
		return remoteBrowserEditorAsset{}, setupError("catalog_incomplete", errors.New("Redeven Browser Editor catalog is not fully mirrored"))
	}
	if !platform.Supported {
		return remoteBrowserEditorAsset{}, setupError("platform_unsupported", errors.New(platform.Message))
	}
	version := strings.TrimSpace(catalog.Latest.Version)
	releaseTag := strings.TrimSpace(catalog.Latest.ReleaseTag)
	if version == "" || releaseTag == "" {
		return remoteBrowserEditorAsset{}, setupError("catalog_invalid", errors.New("Redeven Browser Editor catalog is missing the latest version"))
	}
	entry, ok := remoteCatalogPlatformFor(catalog.Platforms, platform)
	if !ok {
		return remoteBrowserEditorAsset{}, setupError("catalog_platform_missing", fmt.Errorf("Redeven Browser Editor catalog does not include %s/%s", platform.OS, platform.Arch))
	}
	if strings.TrimSpace(entry.OS) != platform.OS || strings.TrimSpace(entry.Arch) != platform.Arch {
		return remoteBrowserEditorAsset{}, setupError("catalog_invalid", errors.New("Redeven Browser Editor catalog package platform does not match this environment"))
	}
	if platform.OS == "linux" && strings.TrimSpace(entry.Libc) != "glibc" {
		return remoteBrowserEditorAsset{}, setupError("catalog_invalid", errors.New("Redeven Browser Editor catalog package does not target Linux glibc"))
	}
	if strings.TrimSpace(entry.PlatformID) == "" || strings.TrimSpace(entry.AssetName) == "" || strings.TrimSpace(entry.RootDirHint) == "" {
		return remoteBrowserEditorAsset{}, setupError("catalog_invalid", errors.New("Redeven Browser Editor catalog has an incomplete platform package entry"))
	}
	if strings.TrimSpace(entry.Compression) != "tar.gz" {
		return remoteBrowserEditorAsset{}, setupError("catalog_invalid", fmt.Errorf("Redeven Browser Editor catalog package compression %q is not supported", entry.Compression))
	}
	sha256 := strings.ToLower(strings.TrimSpace(entry.SHA256))
	decodedSHA, err := hex.DecodeString(sha256)
	if err != nil || len(decodedSHA) != 32 {
		return remoteBrowserEditorAsset{}, setupError("catalog_invalid", errors.New("Redeven Browser Editor catalog package SHA-256 is invalid"))
	}
	if entry.SizeBytes <= 0 || entry.SizeBytes > defaultWorkspaceEngineArchiveLimit {
		return remoteBrowserEditorAsset{}, setupError("catalog_invalid", errors.New("Redeven Browser Editor catalog package size is invalid"))
	}
	packageURL, err := validateRemotePackageURL(entry.DownloadURL, packageOrigin)
	if err != nil {
		return remoteBrowserEditorAsset{}, setupError("package_source_rejected", err)
	}
	manifestPlatform := platform
	if platform.OS == "linux" && manifestPlatform.Libc == "unknown" {
		manifestPlatform.Libc = ""
	}
	manifest := WorkspaceEngineArtifactManifest{
		SchemaVersion: workspaceEngineManifestSchemaVersion,
		Engine:        workspaceEngineNameCodeServer,
		Version:       version,
		Source: WorkspaceEngineArtifactSource{
			Kind:       strings.TrimSpace(catalog.Source.Kind),
			ReleaseURL: strings.TrimSpace(catalog.Source.ReleaseURL),
			AssetName:  strings.TrimSpace(entry.AssetName),
		},
		Platform: manifestPlatform,
		Archive: WorkspaceEngineArchive{
			SHA256:      sha256,
			SizeBytes:   entry.SizeBytes,
			Compression: "tar.gz",
		},
		Layout: WorkspaceEngineArchiveLayout{
			BinaryRelPath: "bin/code-server",
			RootDirHint:   strings.TrimSpace(entry.RootDirHint),
		},
	}
	if err := validateWorkspaceEngineManifest(manifest, platform); err != nil {
		return remoteBrowserEditorAsset{}, setupError("catalog_invalid", err)
	}
	return remoteBrowserEditorAsset{
		Manifest:    manifest,
		DownloadURL: packageURL.String(),
		AssetName:   strings.TrimSpace(entry.AssetName),
	}, nil
}

func remoteCatalogPlatformFor(platforms map[string]remoteCatalogPlatform, platform WorkspaceEnginePlatform) (remoteCatalogPlatform, bool) {
	keys := []string{strings.TrimSpace(platform.PlatformID)}
	if platform.OS == "linux" {
		keys = append(keys, platform.OS+"-"+platform.Arch+"-glibc")
	} else {
		keys = append(keys, platform.OS+"-"+platform.Arch)
	}
	for _, key := range keys {
		if entry, ok := platforms[key]; ok {
			return entry, true
		}
	}
	return remoteCatalogPlatform{}, false
}

func validateRemotePackageURL(rawURL string, packageOrigin string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return nil, errors.New("Redeven Browser Editor package URL is invalid")
	}
	origin, err := url.Parse(strings.TrimSpace(packageOrigin))
	if err != nil || origin.Scheme == "" || origin.Host == "" {
		return nil, errors.New("Redeven Browser Editor package origin is invalid")
	}
	if parsed.Scheme != "https" || !sameURLOrigin(parsed, origin) || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, errors.New("Redeven Browser Editor package URL is outside the approved package service")
	}
	return parsed, nil
}

func sameURLOrigin(left *url.URL, right *url.URL) bool {
	return strings.EqualFold(left.Scheme, right.Scheme) && strings.EqualFold(left.Host, right.Host)
}

func (m *RuntimeManager) remoteHTTPClient(initialURL *url.URL, packageRequest bool) *http.Client {
	transport := m.remoteDownload.transport
	if transport == nil {
		base := http.DefaultTransport.(*http.Transport).Clone()
		base.Proxy = http.ProxyFromEnvironment
		base.ResponseHeaderTimeout = positiveDuration(m.remoteDownload.headerTimeout, defaultRemoteHeaderTimeout)
		transport = base
	}
	return &http.Client{
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return errors.New("too many Browser Editor download redirects")
			}
			if packageRequest {
				_, err := validateRemotePackageURL(req.URL.String(), m.remoteDownload.packageOrigin)
				if err != nil {
					return errors.New("Browser Editor package redirect left the approved package service")
				}
				return nil
			}
			if !sameURLOrigin(req.URL, initialURL) {
				return errors.New("Browser Editor catalog redirect changed origin")
			}
			return nil
		},
	}
}

func positiveDuration(value time.Duration, fallback time.Duration) time.Duration {
	if value > 0 {
		return value
	}
	return fallback
}

func (m *RuntimeManager) ensureRemoteBrowserEditorArchive(
	ctx context.Context,
	operationID string,
	asset remoteBrowserEditorAsset,
) (string, bool, error) {
	platform := currentWorkspaceEnginePlatform()
	archivePath := remoteCacheArchivePath(m.stateRoot, platform, asset.Manifest.Version, asset.AssetName)
	manifestPath := remoteCacheManifestPath(m.stateRoot, platform, asset.Manifest.Version)
	if remoteCacheMatches(archivePath, manifestPath, asset.Manifest) {
		return archivePath, true, nil
	}
	_ = os.RemoveAll(filepath.Dir(archivePath))

	packageURL, err := validateRemotePackageURL(asset.DownloadURL, m.remoteDownload.packageOrigin)
	if err != nil {
		return "", false, setupError("package_source_rejected", err)
	}
	downloadCtx, cancelDownload := context.WithCancelCause(ctx)
	defer cancelDownload(nil)
	client := m.remoteHTTPClient(packageURL, true)
	req, err := http.NewRequestWithContext(downloadCtx, http.MethodGet, packageURL.String(), nil)
	if err != nil {
		return "", false, setupError("environment_download_failed", err)
	}
	req.Header.Set("Accept", "application/octet-stream")
	req.Header.Set("User-Agent", "Redeven-Runtime")
	response, err := client.Do(req)
	if err != nil {
		return "", false, setupError("environment_download_failed", fmt.Errorf("environment could not reach the Redeven package service: %w", err))
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", false, setupError("environment_download_failed", fmt.Errorf("Redeven package service returned HTTP %d", response.StatusCode))
	}
	if response.ContentLength > 0 && response.ContentLength != asset.Manifest.Archive.SizeBytes {
		return "", false, setupError("environment_download_size_mismatch", fmt.Errorf("Browser Editor package response size is %d bytes, expected %d", response.ContentLength, asset.Manifest.Archive.SizeBytes))
	}

	tempPath := remoteDownloadTempPath(m.stateRoot, platform, operationID)
	defer os.Remove(tempPath)
	if err := os.MkdirAll(filepath.Dir(tempPath), 0o700); err != nil {
		return "", false, setupError("environment_download_write_failed", err)
	}
	out, err := os.OpenFile(tempPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return "", false, setupError("environment_download_write_failed", err)
	}
	completed, downloadErr := m.copyRemoteDownload(
		downloadCtx,
		cancelDownload,
		operationID,
		out,
		response.Body,
		asset.Manifest.Archive.SizeBytes,
	)
	closeErr := out.Close()
	if downloadErr != nil {
		return "", false, downloadErr
	}
	if closeErr != nil {
		return "", false, setupError("environment_download_write_failed", closeErr)
	}
	if completed != asset.Manifest.Archive.SizeBytes {
		return "", false, setupError("environment_download_size_mismatch", fmt.Errorf("Browser Editor package download ended at %d bytes, expected %d", completed, asset.Manifest.Archive.SizeBytes))
	}
	if err := verifyWorkspaceEngineArchive(tempPath, asset.Manifest); err != nil {
		return "", false, setupError("artifact_validation_failed", err)
	}
	if err := os.MkdirAll(filepath.Dir(archivePath), 0o700); err != nil {
		return "", false, setupError("environment_download_write_failed", err)
	}
	if err := os.Rename(tempPath, archivePath); err != nil {
		return "", false, setupError("environment_download_write_failed", err)
	}
	if err := saveRemoteCacheManifest(manifestPath, asset.Manifest); err != nil {
		_ = os.RemoveAll(filepath.Dir(archivePath))
		return "", false, setupError("environment_download_write_failed", err)
	}
	pruneRemotePlatformCache(remotePlatformCacheRoot(m.stateRoot, platform), asset.Manifest.Version)
	return archivePath, false, nil
}

func (m *RuntimeManager) copyRemoteDownload(
	ctx context.Context,
	cancel context.CancelCauseFunc,
	operationID string,
	destination *os.File,
	source io.Reader,
	expectedBytes int64,
) (int64, error) {
	buffer := make([]byte, 256*1024)
	var completed int64
	lastProgressAt := time.Time{}
	idleTimeout := positiveDuration(m.remoteDownload.idleTimeout, defaultRemoteDownloadIdleTimeout)
	progressInterval := positiveDuration(m.remoteDownload.progressInterval, defaultRemoteProgressInterval)
	for {
		idleErr := setupError(
			"environment_download_idle_timeout",
			fmt.Errorf("Browser Editor package download received no data for %s", idleTimeout),
		)
		idleTimer := time.AfterFunc(idleTimeout, func() {
			cancel(idleErr)
		})
		readBytes, readErr := source.Read(buffer)
		if !idleTimer.Stop() {
			if cause := context.Cause(ctx); cause != nil {
				return completed, cause
			}
		}
		if cause := context.Cause(ctx); cause != nil {
			return completed, cause
		}
		if readBytes > 0 {
			completed += int64(readBytes)
			if completed > expectedBytes {
				return completed, setupError("environment_download_size_mismatch", errors.New("Browser Editor package download exceeded the catalog size"))
			}
			if _, err := destination.Write(buffer[:readBytes]); err != nil {
				return completed, setupError("environment_download_write_failed", err)
			}
			now := m.now()
			if lastProgressAt.IsZero() || now.Sub(lastProgressAt) >= progressInterval || completed == expectedBytes {
				m.setSetupTransferProgress(operationID, completed, expectedBytes, false)
				lastProgressAt = now
			}
		}
		if errors.Is(readErr, io.EOF) {
			return completed, nil
		}
		if readErr != nil {
			return completed, setupError("environment_download_failed", readErr)
		}
	}
}

func remotePlatformCacheRoot(stateRoot string, platform WorkspaceEnginePlatform) string {
	return filepath.Join(sharedDownloadsRoot(stateRoot), "remote", sanitizePathSegment(platform.PlatformID))
}

func remoteCacheArchivePath(stateRoot string, platform WorkspaceEnginePlatform, version string, assetName string) string {
	return filepath.Join(remotePlatformCacheRoot(stateRoot, platform), sanitizePathSegment(version), filepath.Base(assetName))
}

func remoteCacheManifestPath(stateRoot string, platform WorkspaceEnginePlatform, version string) string {
	return filepath.Join(remotePlatformCacheRoot(stateRoot, platform), sanitizePathSegment(version), "manifest.json")
}

func remoteDownloadTempPath(stateRoot string, platform WorkspaceEnginePlatform, operationID string) string {
	return filepath.Join(remotePlatformCacheRoot(stateRoot, platform), sanitizePathSegment(operationID)+".download.tmp")
}

func remoteCacheMatches(archivePath string, manifestPath string, expected WorkspaceEngineArtifactManifest) bool {
	body, err := os.ReadFile(manifestPath)
	if err != nil {
		return false
	}
	var cached WorkspaceEngineArtifactManifest
	if err := json.Unmarshal(body, &cached); err != nil || cached != expected {
		return false
	}
	return verifyWorkspaceEngineArchive(archivePath, expected) == nil
}

func saveRemoteCacheManifest(path string, manifest WorkspaceEngineArtifactManifest) error {
	body, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(body, '\n'), 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func pruneRemotePlatformCache(platformRoot string, latestVersion string) {
	entries, err := os.ReadDir(platformRoot)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.IsDir() && entry.Name() != sanitizePathSegment(latestVersion) {
			_ = os.RemoveAll(filepath.Join(platformRoot, entry.Name()))
		}
	}
}
