package managedwebservice

import (
	"archive/tar"
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	pathpkg "path"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const maxNativeArchiveBytes = 4 * 1024 * 1024 * 1024
const maxNativeExtractedBytes = 4 * 1024 * 1024 * 1024

type nativeDriver struct {
	stateDir         string
	client           *http.Client
	packageOrigin    string
	packageInstaller func(context.Context, string, string, string, string) error
}

func (d *nativeDriver) Install(ctx context.Context, service *pfregistry.ManagedService, catalog catalogPayload, progress operationProgress) (string, string, error) {
	artifact, ok := catalog.Platforms[currentPlatformKey()]
	if !ok {
		return "", "", serviceError("PLATFORM_UNSUPPORTED", "This Redeven release does not include a host runtime for the Environment platform.", 409, false, nil)
	}
	packageOrigin := d.packageOrigin
	if packageOrigin == "" {
		packageOrigin = defaultNodePackageOrigin
	}
	if err := validateNativeArtifact(artifact, d.client, packageOrigin); err != nil {
		return "", "", err
	}
	installRoot := filepath.Join(d.stateDir, DeepSeekHarnessProductID, "native", DeepSeekHarnessVersion, currentPlatformKey())
	executable, err := d.installRuntimeBundle(ctx, service, artifact, installRoot, progress)
	return "", executable, err
}

func (d *nativeDriver) installRuntimeBundle(ctx context.Context, service *pfregistry.ManagedService, artifact nativeArtifact, installRoot string, progress operationProgress) (string, error) {
	executable := filepath.Join(installRoot, filepath.FromSlash(artifact.ExecutableRelPath))
	if err := verifyInstalledNativeRuntime(installRoot, artifact); err == nil {
		return executable, nil
	}
	if _, err := os.Stat(installRoot); err == nil {
		return "", serviceError("INSTALL_IDENTITY_CONFLICT", "An unexpected native installation already occupies the managed runtime path.", 409, false, nil)
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	stagingRoot := filepath.Join(d.stateDir, ".staging", service.ServiceID)
	_ = os.RemoveAll(stagingRoot)
	if err := os.MkdirAll(stagingRoot, 0o700); err != nil {
		return "", err
	}
	defer os.RemoveAll(stagingRoot)
	archivePath := filepath.Join(stagingRoot, "package.tar.gz")
	if err := downloadNativeArchive(ctx, d.client, artifact, archivePath, progress); err != nil {
		return "", err
	}
	progress("verifying", 3)
	if err := verifyNativeArchive(archivePath, artifact); err != nil {
		return "", err
	}
	extractRoot := filepath.Join(stagingRoot, "root")
	if err := extractNodeRuntimeArchive(archivePath, extractRoot); err != nil {
		return "", serviceError("ARCHIVE_INVALID", "The audited Node.js runtime could not be safely extracted.", 502, false, err)
	}
	stagedNode := filepath.Join(extractRoot, filepath.FromSlash(artifact.NodeRelPath))
	stagedNPMCLI := filepath.Join(extractRoot, filepath.FromSlash(artifact.NPMCLIRelPath))
	if !regularExecutable(stagedNode) || !regularFile(stagedNPMCLI) {
		return "", serviceError("ARCHIVE_LAYOUT_INVALID", "The audited Node.js runtime has an unexpected layout.", 502, false, nil)
	}
	nodeDigestBeforeInstall, err := fileSHA256(stagedNode)
	if err != nil {
		return "", err
	}
	if err := validateEmbeddedNativePackage(); err != nil {
		return "", err
	}
	appRoot := filepath.Join(extractRoot, "app")
	if err := os.MkdirAll(appRoot, 0o700); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(appRoot, "package.json"), nativePackageJSON, 0o600); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(appRoot, "package-lock.json"), nativePackageLock, 0o600); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(appRoot, ".npmrc"), nativeNPMConfig, 0o600); err != nil {
		return "", err
	}
	progress("installing", 4)
	installer := d.packageInstaller
	if installer == nil {
		installer = installNativePackages
	}
	if err := installer(ctx, stagedNode, stagedNPMCLI, appRoot, filepath.Join(stagingRoot, "npm-cache")); err != nil {
		return "", err
	}
	nodeDigestAfterInstall, err := fileSHA256(stagedNode)
	if err != nil {
		return "", err
	}
	if nodeDigestAfterInstall != nodeDigestBeforeInstall {
		return "", serviceError("RUNTIME_MUTATED_DURING_INSTALL", "A dependency lifecycle script modified the verified Node.js runtime.", 502, false, nil)
	}
	dshEntry := filepath.Join(appRoot, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")
	if !regularFile(dshEntry) {
		return "", serviceError("DEPENDENCY_LAYOUT_INVALID", "The fixed DeepSeek Harness package is missing its CLI entrypoint.", 502, false, nil)
	}
	launcher := nativeLauncher(artifact)
	stagedExecutable := filepath.Join(extractRoot, filepath.FromSlash(artifact.ExecutableRelPath))
	if err := os.MkdirAll(filepath.Dir(stagedExecutable), 0o700); err != nil {
		return "", err
	}
	if err := os.WriteFile(stagedExecutable, launcher, 0o700); err != nil {
		return "", err
	}
	manifestBytes, err := json.Marshal(expectedNativeRuntimeManifest(artifact, launcher, nodeDigestAfterInstall))
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(extractRoot, "redeven-runtime.json"), manifestBytes, 0o600); err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(installRoot), 0o700); err != nil {
		return "", err
	}
	if err := os.Rename(extractRoot, installRoot); err != nil {
		return "", err
	}
	return executable, nil
}

func validateNativeArtifact(artifact nativeArtifact, client *http.Client, packageOrigin string) error {
	if client == nil {
		return serviceError("DOWNLOAD_UNAVAILABLE", "The native package downloader is unavailable.", 503, true, nil)
	}
	if err := validatePackageURL(artifact.DownloadURL, packageOrigin); err != nil {
		return serviceError("PACKAGE_SOURCE_REJECTED", "The native package URL is outside the release-locked package origin.", 502, false, err)
	}
	digest, err := hex.DecodeString(strings.ToLower(strings.TrimSpace(artifact.SHA256)))
	if err != nil || len(digest) != sha256.Size {
		return serviceError("CATALOG_INVALID", "The native package SHA-256 is invalid.", 502, false, err)
	}
	if artifact.SizeBytes <= 0 || artifact.SizeBytes > maxNativeArchiveBytes {
		return serviceError("CATALOG_INVALID", "The native package size is invalid.", 502, false, nil)
	}
	for _, value := range []string{artifact.ArchiveRoot, artifact.NodeRelPath, artifact.NPMCLIRelPath, artifact.ExecutableRelPath} {
		rel := filepath.Clean(filepath.FromSlash(strings.TrimSpace(value)))
		if rel == "." || filepath.IsAbs(rel) || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return serviceError("CATALOG_INVALID", "The native package layout is invalid.", 502, false, nil)
		}
	}
	archiveRoot := filepath.Clean(filepath.FromSlash(artifact.ArchiveRoot))
	for _, value := range []string{artifact.NodeRelPath, artifact.NPMCLIRelPath} {
		rel, err := filepath.Rel(archiveRoot, filepath.Clean(filepath.FromSlash(value)))
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return serviceError("CATALOG_INVALID", "The native package runtime paths do not belong to its archive root.", 502, false, err)
		}
	}
	return nil
}

type nativeRuntimeManifest struct {
	SchemaVersion     int    `json:"schema_version"`
	BundleID          string `json:"bundle_id"`
	Platform          string `json:"platform"`
	NodeSHA256        string `json:"node_sha256"`
	NodeBinarySHA256  string `json:"node_binary_sha256"`
	PackageLockSHA256 string `json:"package_lock_sha256"`
	LauncherSHA256    string `json:"launcher_sha256"`
}

func expectedNativeRuntimeManifest(artifact nativeArtifact, launcher []byte, nodeBinarySHA256 string) nativeRuntimeManifest {
	launcherDigest := sha256.Sum256(launcher)
	return nativeRuntimeManifest{
		SchemaVersion:     1,
		BundleID:          deepSeekRuntimeBundleID,
		Platform:          currentPlatformKey(),
		NodeSHA256:        strings.ToLower(artifact.SHA256),
		NodeBinarySHA256:  nodeBinarySHA256,
		PackageLockSHA256: nativePackageLockSHA256,
		LauncherSHA256:    hex.EncodeToString(launcherDigest[:]),
	}
}

func verifyInstalledNativeRuntime(installRoot string, artifact nativeArtifact) error {
	launcher := nativeLauncher(artifact)
	nodePath := filepath.Join(installRoot, filepath.FromSlash(artifact.NodeRelPath))
	nodeDigest, err := fileSHA256(nodePath)
	if err != nil {
		return err
	}
	raw, err := os.ReadFile(filepath.Join(installRoot, "redeven-runtime.json"))
	if err != nil {
		return err
	}
	var actual nativeRuntimeManifest
	if err := decodeStrictJSON(raw, &actual); err != nil {
		return err
	}
	expected := expectedNativeRuntimeManifest(artifact, launcher, nodeDigest)
	if actual != expected {
		return errors.New("native runtime manifest does not match this Redeven release")
	}
	if !regularExecutable(nodePath) ||
		!regularFile(filepath.Join(installRoot, filepath.FromSlash(artifact.NPMCLIRelPath))) ||
		!regularFile(filepath.Join(installRoot, "app", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")) {
		return errors.New("native runtime files are incomplete")
	}
	executable := filepath.Join(installRoot, filepath.FromSlash(artifact.ExecutableRelPath))
	actualLauncher, err := os.ReadFile(executable)
	if err != nil || !bytes.Equal(actualLauncher, launcher) || !regularExecutable(executable) {
		return errors.New("native runtime launcher does not match this Redeven release")
	}
	for path, expectedBytes := range map[string][]byte{
		"app/package.json":      nativePackageJSON,
		"app/package-lock.json": nativePackageLock,
		"app/.npmrc":            nativeNPMConfig,
	} {
		actualBytes, err := os.ReadFile(filepath.Join(installRoot, filepath.FromSlash(path)))
		if err != nil || !bytes.Equal(actualBytes, expectedBytes) {
			return errors.New("native runtime dependency definition does not match this Redeven release")
		}
	}
	return nil
}

func fileSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	digest := sha256.New()
	if _, err := io.Copy(digest, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}

func validateEmbeddedNativePackage() error {
	packageDigest := sha256.Sum256(nativePackageJSON)
	lockDigest := sha256.Sum256(nativePackageLock)
	configDigest := sha256.Sum256(nativeNPMConfig)
	if hex.EncodeToString(packageDigest[:]) != nativePackageJSONSHA256 || hex.EncodeToString(lockDigest[:]) != nativePackageLockSHA256 || hex.EncodeToString(configDigest[:]) != nativeNPMConfigSHA256 {
		return serviceError("EMBEDDED_RUNTIME_INVALID", "The embedded DeepSeek Harness dependency lock does not match this Redeven release.", 500, false, nil)
	}
	return nil
}

func nativeLauncher(artifact nativeArtifact) []byte {
	return []byte(fmt.Sprintf("#!/bin/sh\nset -eu\nruntime_root=$(CDPATH= cd \"$(dirname \"$0\")/..\" && pwd)\nexec \"$runtime_root/%s\" \"$runtime_root/app/node_modules/@deepseek-ai/dsh/lib/bin.js\" \"$@\"\n", filepath.ToSlash(artifact.NodeRelPath)))
}

func regularFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

func regularExecutable(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular() && info.Mode()&0o111 != 0
}

func installNativePackages(ctx context.Context, nodePath, npmCLIPath, appRoot, cacheRoot string) error {
	configRoot := filepath.Join(filepath.Dir(cacheRoot), "npm-config")
	if err := os.MkdirAll(configRoot, 0o700); err != nil {
		return err
	}
	userConfig := filepath.Join(configRoot, "user.npmrc")
	globalConfig := filepath.Join(configRoot, "global.npmrc")
	for _, path := range []string{userConfig, globalConfig} {
		if err := os.WriteFile(path, nil, 0o600); err != nil {
			return err
		}
	}
	home := filepath.Join(filepath.Dir(cacheRoot), "home")
	if err := os.MkdirAll(home, 0o700); err != nil {
		return err
	}
	path := filepath.Dir(nodePath)
	if inherited := strings.TrimSpace(os.Getenv("PATH")); inherited != "" {
		path += string(os.PathListSeparator) + inherited
	}
	env := []string{
		"HOME=" + home,
		"PATH=" + path,
		"npm_config_registry=https://registry.npmjs.org/",
		"npm_config_cache=" + cacheRoot,
		"npm_config_userconfig=" + userConfig,
		"npm_config_globalconfig=" + globalConfig,
		"npm_config_audit=false",
		"npm_config_fund=false",
		"npm_config_update_notifier=false",
		"npm_config_progress=false",
		"npm_config_loglevel=warn",
	}
	for _, key := range []string{"HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS"} {
		if value := os.Getenv(key); value != "" {
			env = append(env, key+"="+value)
		}
	}
	commandArguments := append([]string{npmCLIPath}, nativePackageInstallArguments()...)
	cmd := exec.CommandContext(ctx, nodePath, commandArguments...)
	cmd.Dir = appRoot
	cmd.Env = env
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if err := cmd.Run(); err != nil {
		return serviceError("DEPENDENCY_INSTALL_FAILED", "The fixed DeepSeek Harness dependencies could not be installed from their integrity-locked packages.", 503, true, err)
	}
	return nil
}

type nativeArchiveProgressWriter struct {
	destination io.Writer
	reporter    *managedTransferProgressReporter
	progress    operationProgress
	transfer    pfregistry.ManagedOperationTransferProgress
}

func (w *nativeArchiveProgressWriter) Write(p []byte) (int, error) {
	written, err := w.destination.Write(p)
	w.transfer.DownloadedBytes += int64(written)
	w.report(false)
	return written, err
}

func (w *nativeArchiveProgressWriter) report(final bool) {
	var emit bool
	if final {
		w.transfer = w.reporter.observeFinal(w.transfer)
		emit = true
	} else {
		w.transfer, emit = w.reporter.observe(w.transfer)
	}
	if emit && w.progress != nil {
		w.progress("downloading", 2, w.transfer)
	}
}

func nativeArtifactProgressReference(artifact nativeArtifact) string {
	name := "native-package"
	if parsed, err := url.Parse(strings.TrimSpace(artifact.DownloadURL)); err == nil {
		candidate := pathpkg.Base(strings.TrimSuffix(parsed.Path, "/"))
		if decoded, decodeErr := url.PathUnescape(candidate); decodeErr == nil {
			candidate = decoded
		}
		if candidate != "" && candidate != "." && candidate != "/" {
			name = candidate
		}
	}
	return name + "@sha256:" + strings.ToLower(strings.TrimSpace(artifact.SHA256))
}

func downloadNativeArchive(ctx context.Context, client *http.Client, artifact nativeArtifact, destination string, progress operationProgress) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, artifact.DownloadURL, nil)
	if err != nil {
		return err
	}
	reporter := managedTransferProgressReporter{now: time.Now}
	writer := nativeArchiveProgressWriter{
		reporter: &reporter,
		progress: progress,
		transfer: pfregistry.ManagedOperationTransferProgress{
			Phase:             "downloading",
			ArtifactReference: nativeArtifactProgressReference(artifact),
			ArtifactIndex:     1,
			ArtifactTotal:     1,
			TotalBytes:        artifact.SizeBytes,
		},
	}
	writer.report(false)
	resp, err := client.Do(req)
	if err != nil {
		return serviceError("DOWNLOAD_FAILED", "The audited native package could not be downloaded.", 503, true, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return serviceError("DOWNLOAD_FAILED", "The audited native package could not be downloaded.", 503, true, fmt.Errorf("package returned %s", resp.Status))
	}
	if resp.ContentLength >= 0 && resp.ContentLength != artifact.SizeBytes {
		return serviceError("PACKAGE_SIZE_MISMATCH", "The native package size does not match the audited catalog.", 502, true, nil)
	}
	file, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	writer.destination = file
	written, copyErr := io.Copy(&writer, io.LimitReader(resp.Body, artifact.SizeBytes+1))
	closeErr := file.Close()
	if copyErr != nil {
		writer.report(true)
		return copyErr
	}
	if closeErr != nil {
		writer.report(true)
		return closeErr
	}
	if written != artifact.SizeBytes {
		writer.report(true)
		return serviceError("PACKAGE_SIZE_MISMATCH", "The native package size does not match the audited catalog.", 502, true, nil)
	}
	return nil
}

func verifyNativeArchive(path string, artifact nativeArtifact) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	hash := sha256.New()
	written, err := io.Copy(hash, file)
	if err != nil {
		return err
	}
	if written != artifact.SizeBytes || !strings.EqualFold(hex.EncodeToString(hash.Sum(nil)), artifact.SHA256) {
		return serviceError("PACKAGE_CHECKSUM_MISMATCH", "The native package checksum does not match the audited catalog.", 502, true, nil)
	}
	return nil
}

func extractManagedArchive(archivePath, destination string) error {
	return extractManagedArchiveWithOptions(archivePath, destination, false)
}

func extractNodeRuntimeArchive(archivePath, destination string) error {
	return extractManagedArchiveWithOptions(archivePath, destination, true)
}

func extractManagedArchiveWithOptions(archivePath, destination string, skipSymlinks bool) error {
	if err := os.MkdirAll(destination, 0o700); err != nil {
		return err
	}
	file, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer file.Close()
	gz, err := gzip.NewReader(file)
	if err != nil {
		return err
	}
	defer gz.Close()
	reader := tar.NewReader(gz)
	entries := 0
	var extractedBytes int64
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		entries++
		if entries > 500_000 {
			return errors.New("archive has too many entries")
		}
		name := filepath.Clean(filepath.FromSlash(header.Name))
		if name == "." {
			continue
		}
		if filepath.IsAbs(name) || name == ".." || strings.HasPrefix(name, ".."+string(filepath.Separator)) {
			return errors.New("archive path escapes destination")
		}
		target := filepath.Join(destination, name)
		rel, err := filepath.Rel(destination, target)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return errors.New("archive path escapes destination")
		}
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o700); err != nil {
				return err
			}
		case tar.TypeReg:
			if header.Size < 0 || header.Size > maxNativeArchiveBytes {
				return errors.New("archive entry size is invalid")
			}
			if header.Size > maxNativeExtractedBytes-extractedBytes {
				return errors.New("archive expands beyond the managed package limit")
			}
			extractedBytes += header.Size
			if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
				return err
			}
			mode := os.FileMode(header.Mode) & 0o777
			mode &^= 0o022
			if mode&0o111 == 0 {
				mode = 0o600
			} else {
				mode = 0o700
			}
			out, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
			if err != nil {
				return err
			}
			written, copyErr := io.CopyN(out, reader, header.Size)
			closeErr := out.Close()
			if copyErr != nil {
				return copyErr
			}
			if closeErr != nil {
				return closeErr
			}
			if written != header.Size {
				return io.ErrUnexpectedEOF
			}
		case tar.TypeSymlink:
			if !skipSymlinks {
				return errors.New("archive symbolic links are not allowed")
			}
		default:
			return fmt.Errorf("archive entry type %d is not allowed", header.Typeflag)
		}
	}
}

var (
	authorizationLogPattern = regexp.MustCompile(`(?i)(authorization["']?\s*[:=]\s*).*$`)
	credentialLogPattern    = regexp.MustCompile(`(?i)(api[_-]?key|access[_-]?token|secret)(["']?\s*[:=]\s*["']?)[^\s,"';&}]+`)
)

func redactLogLine(value string) string {
	value = authorizationLogPattern.ReplaceAllString(value, `$1[REDACTED]`)
	return credentialLogPattern.ReplaceAllString(value, `$1$2[REDACTED]`)
}
func tailRedactedFile(path string, tail int) (*LogResult, error) {
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return &LogResult{Lines: []string{}}, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	const maxRead = int64(2 * 1024 * 1024)
	if info.Size() > maxRead {
		_, _ = file.Seek(info.Size()-maxRead, io.SeekStart)
	}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	lines := make([]string, 0, tail)
	for scanner.Scan() {
		lines = append(lines, redactLogLine(scanner.Text()))
		if len(lines) > tail {
			copy(lines, lines[len(lines)-tail:])
			lines = lines[:tail]
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return &LogResult{Lines: lines}, nil
}
