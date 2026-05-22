package codeserver

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
)

const (
	workspaceEngineManifestSchemaVersion = 1
	workspaceEngineNameCodeServer        = "code-server"
	defaultWorkspaceEngineArchiveLimit   = 256 * 1024 * 1024
)

type WorkspaceEnginePlatform struct {
	OS              string `json:"os"`
	Arch            string `json:"arch"`
	Libc            string `json:"libc,omitempty"`
	LibcVersion     string `json:"libc_version,omitempty"`
	PlatformID      string `json:"platform_id"`
	Supported       bool   `json:"supported"`
	UnsupportedCode string `json:"unsupported_code,omitempty"`
	Message         string `json:"message,omitempty"`
}

type WorkspaceEngineArtifactSource struct {
	Kind       string `json:"kind"`
	ReleaseURL string `json:"release_url,omitempty"`
	AssetName  string `json:"asset_name,omitempty"`
}

type WorkspaceEngineArchive struct {
	SHA256      string `json:"sha256"`
	SizeBytes   int64  `json:"size_bytes"`
	Compression string `json:"compression"`
}

type WorkspaceEngineArchiveLayout struct {
	BinaryRelPath string `json:"binary_relpath"`
	RootDirHint   string `json:"root_dir_hint,omitempty"`
}

type WorkspaceEngineArtifactManifest struct {
	SchemaVersion int                           `json:"schema_version"`
	Engine        string                        `json:"engine"`
	Version       string                        `json:"version"`
	Source        WorkspaceEngineArtifactSource `json:"source"`
	Platform      WorkspaceEnginePlatform       `json:"platform"`
	Archive       WorkspaceEngineArchive        `json:"archive"`
	Layout        WorkspaceEngineArchiveLayout  `json:"layout"`
}

func currentWorkspaceEnginePlatform() WorkspaceEnginePlatform {
	osName := runtime.GOOS
	arch := runtime.GOARCH
	platform := WorkspaceEnginePlatform{
		OS:         osName,
		Arch:       arch,
		PlatformID: osName + "-" + arch,
		Supported:  true,
	}
	switch osName {
	case "darwin":
		switch arch {
		case "amd64", "arm64":
			return platform
		default:
			platform.Supported = false
			platform.UnsupportedCode = "unsupported_arch"
			platform.Message = "This macOS architecture is not supported by the managed code workspace engine."
			return platform
		}
	case "linux":
		platform.Libc, platform.LibcVersion = detectLinuxLibc()
		if platform.Libc == "" {
			platform.Libc = "unknown"
		}
		platform.PlatformID = osName + "-" + arch + "-" + platform.Libc
		switch arch {
		case "amd64", "arm64":
		default:
			platform.Supported = false
			platform.UnsupportedCode = "unsupported_arch"
			platform.Message = "This Linux architecture is not supported by the managed code workspace engine."
			return platform
		}
		if platform.Libc != "glibc" && platform.Libc != "unknown" {
			platform.Supported = false
			platform.UnsupportedCode = "unsupported_libc"
			platform.Message = "This Linux distribution is not supported by the managed code workspace engine."
			return platform
		}
		return platform
	default:
		platform.Supported = false
		platform.UnsupportedCode = "unsupported_os"
		platform.Message = "This operating system is not supported by the managed code workspace engine."
		return platform
	}
}

func detectLinuxLibc() (string, string) {
	if runtime.GOOS != "linux" {
		return "", ""
	}
	if body, err := os.ReadFile("/usr/bin/ldd"); err == nil {
		return parseLibcFromText(string(body))
	}
	if body, err := os.ReadFile("/bin/ldd"); err == nil {
		return parseLibcFromText(string(body))
	}
	return "unknown", ""
}

func parseLibcFromText(text string) (string, string) {
	lower := strings.ToLower(text)
	if strings.Contains(lower, "musl") {
		return "musl", ""
	}
	if strings.Contains(lower, "glibc") || strings.Contains(lower, "gnu libc") {
		return "glibc", ""
	}
	return "unknown", ""
}

func validateWorkspaceEngineManifest(manifest WorkspaceEngineArtifactManifest, current WorkspaceEnginePlatform) error {
	if manifest.SchemaVersion != workspaceEngineManifestSchemaVersion {
		return fmt.Errorf("unsupported workspace engine manifest schema version %d", manifest.SchemaVersion)
	}
	if strings.TrimSpace(manifest.Engine) != workspaceEngineNameCodeServer {
		return fmt.Errorf("unsupported workspace engine %q", strings.TrimSpace(manifest.Engine))
	}
	if strings.TrimSpace(manifest.Version) == "" {
		return errors.New("workspace engine manifest is missing version")
	}
	if !current.Supported {
		if current.Message != "" {
			return errors.New(current.Message)
		}
		return errors.New("this platform is not supported by the managed code workspace engine")
	}
	if strings.TrimSpace(manifest.Platform.OS) != strings.TrimSpace(current.OS) ||
		strings.TrimSpace(manifest.Platform.Arch) != strings.TrimSpace(current.Arch) {
		return fmt.Errorf("workspace engine package platform %s/%s does not match this runtime %s/%s",
			manifest.Platform.OS, manifest.Platform.Arch, current.OS, current.Arch)
	}
	if strings.TrimSpace(manifest.Platform.Libc) != "" && strings.TrimSpace(current.Libc) != "" &&
		strings.TrimSpace(manifest.Platform.Libc) != strings.TrimSpace(current.Libc) {
		return fmt.Errorf("workspace engine package libc %s does not match this runtime libc %s",
			manifest.Platform.Libc, current.Libc)
	}
	if strings.TrimSpace(manifest.Archive.SHA256) == "" {
		return errors.New("workspace engine manifest is missing archive sha256")
	}
	if _, err := hex.DecodeString(strings.TrimSpace(manifest.Archive.SHA256)); err != nil {
		return fmt.Errorf("workspace engine archive sha256 is invalid: %w", err)
	}
	if manifest.Archive.SizeBytes <= 0 {
		return errors.New("workspace engine manifest is missing archive size")
	}
	if manifest.Archive.SizeBytes > defaultWorkspaceEngineArchiveLimit {
		return fmt.Errorf("workspace engine archive is too large: %d bytes", manifest.Archive.SizeBytes)
	}
	if strings.TrimSpace(manifest.Archive.Compression) != "tar.gz" {
		return fmt.Errorf("unsupported workspace engine archive compression %q", manifest.Archive.Compression)
	}
	if !safeRelativePath(normalizedWorkspaceEngineBinaryRelPath(manifest)) {
		return errors.New("workspace engine binary path is unsafe")
	}
	return nil
}

func verifyWorkspaceEngineArchive(path string, manifest WorkspaceEngineArtifactManifest) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return errors.New("missing workspace engine archive path")
	}
	fi, err := os.Stat(path)
	if err != nil {
		return err
	}
	if fi.Size() != manifest.Archive.SizeBytes {
		return fmt.Errorf("workspace engine archive size mismatch: got %d, want %d", fi.Size(), manifest.Archive.SizeBytes)
	}
	hash := sha256.New()
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := io.Copy(hash, f); err != nil {
		return err
	}
	actual := hex.EncodeToString(hash.Sum(nil))
	if actual != strings.ToLower(strings.TrimSpace(manifest.Archive.SHA256)) {
		return fmt.Errorf("workspace engine archive checksum mismatch: got %s", actual)
	}
	return nil
}

func installWorkspaceEngineArchive(ctx context.Context, archivePath string, stagePrefix string, manifest WorkspaceEngineArtifactManifest) error {
	if err := validateWorkspaceEngineManifest(manifest, currentWorkspaceEnginePlatform()); err != nil {
		return err
	}
	if err := verifyWorkspaceEngineArchive(archivePath, manifest); err != nil {
		return err
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := os.RemoveAll(stagePrefix); err != nil {
		return err
	}
	if err := os.MkdirAll(stagePrefix, 0o700); err != nil {
		return err
	}
	if err := extractWorkspaceEngineArchive(ctx, archivePath, stagePrefix); err != nil {
		_ = os.RemoveAll(stagePrefix)
		return err
	}
	binaryPath := filepath.Join(stagePrefix, filepath.FromSlash(normalizedWorkspaceEngineBinaryRelPath(manifest)))
	if _, err := os.Stat(binaryPath); err != nil {
		return fmt.Errorf("workspace engine binary not found after extract: %w", err)
	}
	return nil
}

func extractWorkspaceEngineArchive(ctx context.Context, archivePath string, dest string) error {
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

	tr := tar.NewReader(gz)
	var total int64
	var root string
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return err
		}
		cleanName, err := cleanArchivePath(hdr.Name)
		if err != nil {
			return err
		}
		if root == "" {
			root = firstArchiveSegment(cleanName)
		}
		rel := stripArchiveRoot(cleanName, root)
		if rel == "" {
			continue
		}
		target := filepath.Join(dest, filepath.FromSlash(rel))
		if !strings.HasPrefix(filepath.Clean(target)+string(os.PathSeparator), filepath.Clean(dest)+string(os.PathSeparator)) {
			return fmt.Errorf("workspace engine archive entry escapes target directory: %s", hdr.Name)
		}
		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o700); err != nil {
				return err
			}
		case tar.TypeReg:
			total += hdr.Size
			if total > defaultWorkspaceEngineArchiveLimit {
				return fmt.Errorf("workspace engine archive extracts too much data: %d bytes", total)
			}
			if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
				return err
			}
			mode := os.FileMode(0o600)
			if hdr.FileInfo().Mode()&0o111 != 0 {
				mode = 0o700
			}
			out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
			if err != nil {
				return err
			}
			_, copyErr := io.Copy(out, io.LimitReader(tr, hdr.Size))
			closeErr := out.Close()
			if copyErr != nil {
				return copyErr
			}
			if closeErr != nil {
				return closeErr
			}
		case tar.TypeSymlink, tar.TypeLink:
			return fmt.Errorf("workspace engine archive links are not allowed: %s", hdr.Name)
		default:
			continue
		}
	}
	return nil
}

func cleanArchivePath(raw string) (string, error) {
	name := strings.TrimSpace(filepath.ToSlash(raw))
	if name == "" {
		return "", errors.New("workspace engine archive contains an empty path")
	}
	if strings.HasPrefix(name, "/") {
		return "", fmt.Errorf("workspace engine archive contains absolute path: %s", raw)
	}
	clean := path.Clean(name)
	if clean == "." || clean == "" {
		return "", errors.New("workspace engine archive contains an empty path")
	}
	if strings.HasPrefix(clean, "../") || clean == ".." || strings.Contains(clean, "/../") {
		return "", fmt.Errorf("workspace engine archive contains unsafe path: %s", raw)
	}
	return clean, nil
}

func firstArchiveSegment(name string) string {
	parts := strings.Split(strings.Trim(name, "/"), "/")
	if len(parts) == 0 {
		return ""
	}
	return parts[0]
}

func stripArchiveRoot(name string, root string) string {
	name = strings.Trim(name, "/")
	root = strings.Trim(root, "/")
	if root == "" {
		return name
	}
	if name == root {
		return ""
	}
	prefix := root + "/"
	if strings.HasPrefix(name, prefix) {
		return strings.TrimPrefix(name, prefix)
	}
	return name
}

func safeRelativePath(raw string) bool {
	clean := path.Clean(filepath.ToSlash(strings.TrimSpace(raw)))
	return clean != "." && clean != "" && !strings.HasPrefix(clean, "/") &&
		clean != ".." && !strings.HasPrefix(clean, "../") && !strings.Contains(clean, "/../")
}

func normalizedWorkspaceEngineBinaryRelPath(manifest WorkspaceEngineArtifactManifest) string {
	binaryRelPath := strings.TrimSpace(manifest.Layout.BinaryRelPath)
	if binaryRelPath == "" {
		binaryRelPath = filepath.Join("bin", codeServerBinaryName())
	}
	return path.Clean(filepath.ToSlash(binaryRelPath))
}
