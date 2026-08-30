package redevpluginruntime

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"

	"github.com/floegence/redevplugin/v3/pkg/version"
)

const (
	binaryName     = "redevplugin-runtime"
	descriptorName = ".redevplugin-release-artifacts-verified.json"
)

// InstallAt writes the minimal executable needed to exercise native runtime
// admission without starting a worker.
func InstallAt(root string) (func() error, error) {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		return func() error { return nil }, nil
	}
	header, err := executableHeader(runtime.GOOS, runtime.GOARCH)
	if err != nil {
		return nil, err
	}
	root, err = filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("resolve ReDevPlugin fixture root: %w", err)
	}
	path := filepath.Join(root, binaryName)
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o500)
	if errors.Is(err, os.ErrExist) {
		if err := preserveExistingFixture(path, header, 0o500); err != nil {
			return nil, err
		}
		return installDescriptor(root, header)
	}
	if err != nil {
		return nil, fmt.Errorf("create ReDevPlugin runtime fixture: %w", err)
	}
	binaryCleanup := removeFixture(path, "ReDevPlugin runtime fixture")
	if written, err := file.Write(header); err != nil || written != len(header) {
		_ = file.Close()
		_ = binaryCleanup()
		if err != nil {
			return nil, fmt.Errorf("write ReDevPlugin runtime fixture: %w", err)
		}
		return nil, fmt.Errorf("write ReDevPlugin runtime fixture: wrote %d of %d bytes", written, len(header))
	}
	if err := file.Close(); err != nil {
		_ = binaryCleanup()
		return nil, fmt.Errorf("close ReDevPlugin runtime fixture: %w", err)
	}
	descriptorCleanup, err := installDescriptor(root, header)
	if err != nil {
		_ = binaryCleanup()
		return nil, err
	}
	return combineCleanup(descriptorCleanup, binaryCleanup), nil
}

// InstallSiblingOfCurrentExecutable follows the same canonical sibling rule as
// the production Redeven runtime resolver.
func InstallSiblingOfCurrentExecutable() (func() error, error) {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		return func() error { return nil }, nil
	}
	executable, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("resolve test executable: %w", err)
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil {
		return nil, fmt.Errorf("resolve test executable symlinks: %w", err)
	}
	return InstallAt(filepath.Dir(executable))
}

func executableHeader(goos, goarch string) ([]byte, error) {
	switch goos {
	case "linux":
		return elfHeader(goarch)
	case "darwin":
		return machOHeader(goarch)
	default:
		return nil, fmt.Errorf("unsupported ReDevPlugin runtime fixture target %q", goos+"/"+goarch)
	}
}

func preserveExistingFixture(path string, expected []byte, mode os.FileMode) error {
	info, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("inspect existing ReDevPlugin runtime fixture: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode().Perm() != mode {
		return fmt.Errorf("refuse to replace existing ReDevPlugin runtime fixture %q", path)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read existing ReDevPlugin runtime fixture: %w", err)
	}
	if !bytes.Equal(data, expected) {
		return fmt.Errorf("refuse to replace existing ReDevPlugin runtime fixture %q", path)
	}
	return nil
}

func installDescriptor(root string, binary []byte) (func() error, error) {
	digest := sha256.Sum256(binary)
	descriptor := struct {
		SchemaVersion   string `json:"schema_version"`
		PlatformRelease struct {
			PlatformVersion string `json:"platform_version"`
		} `json:"platform_release"`
		Runtime struct {
			Target string `json:"target"`
			Binary struct {
				Path   string `json:"path"`
				SHA256 string `json:"sha256"`
				Size   int    `json:"size"`
			} `json:"binary"`
		} `json:"runtime"`
	}{
		SchemaVersion: "redeven.redevplugin_runtime_build.v1",
	}
	descriptor.PlatformRelease.PlatformVersion = version.CurrentPlatformVersion()
	descriptor.Runtime.Target = runtime.GOOS + "/" + runtime.GOARCH
	descriptor.Runtime.Binary.Path = binaryName
	descriptor.Runtime.Binary.SHA256 = hex.EncodeToString(digest[:])
	descriptor.Runtime.Binary.Size = len(binary)
	raw, err := json.Marshal(descriptor)
	if err != nil {
		return nil, fmt.Errorf("encode ReDevPlugin runtime fixture descriptor: %w", err)
	}

	path := filepath.Join(root, descriptorName)
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, os.ErrExist) {
		if err := preserveExistingFixture(path, raw, 0o600); err != nil {
			return nil, err
		}
		return func() error { return nil }, nil
	}
	if err != nil {
		return nil, fmt.Errorf("create ReDevPlugin runtime fixture descriptor: %w", err)
	}
	cleanup := removeFixture(path, "ReDevPlugin runtime fixture descriptor")
	if written, err := file.Write(raw); err != nil || written != len(raw) {
		_ = file.Close()
		_ = cleanup()
		if err != nil {
			return nil, fmt.Errorf("write ReDevPlugin runtime fixture descriptor: %w", err)
		}
		return nil, fmt.Errorf("write ReDevPlugin runtime fixture descriptor: wrote %d of %d bytes", written, len(raw))
	}
	if err := file.Close(); err != nil {
		_ = cleanup()
		return nil, fmt.Errorf("close ReDevPlugin runtime fixture descriptor: %w", err)
	}
	return cleanup, nil
}

func removeFixture(path, label string) func() error {
	var cleanupOnce sync.Once
	var cleanupErr error
	return func() error {
		cleanupOnce.Do(func() {
			if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
				cleanupErr = fmt.Errorf("remove %s: %w", label, err)
			}
		})
		return cleanupErr
	}
}

func combineCleanup(cleanups ...func() error) func() error {
	var cleanupOnce sync.Once
	var cleanupErr error
	return func() error {
		cleanupOnce.Do(func() {
			for _, cleanup := range cleanups {
				if err := cleanup(); err != nil && cleanupErr == nil {
					cleanupErr = err
				}
			}
		})
		return cleanupErr
	}
}

func elfHeader(goarch string) ([]byte, error) {
	var machine uint16
	switch goarch {
	case "amd64":
		machine = 62
	case "arm64":
		machine = 183
	default:
		return nil, fmt.Errorf("unsupported ReDevPlugin runtime fixture architecture %q", goarch)
	}

	header := make([]byte, 64)
	copy(header, []byte{0x7f, 'E', 'L', 'F', 2, 1, 1})
	binary.LittleEndian.PutUint16(header[16:], 3)
	binary.LittleEndian.PutUint16(header[18:], machine)
	binary.LittleEndian.PutUint32(header[20:], 1)
	binary.LittleEndian.PutUint16(header[52:], 64)
	binary.LittleEndian.PutUint16(header[54:], 56)
	binary.LittleEndian.PutUint16(header[58:], 64)
	return header, nil
}

func machOHeader(goarch string) ([]byte, error) {
	var cpu uint32
	switch goarch {
	case "amd64":
		cpu = 0x01000007
	case "arm64":
		cpu = 0x0100000c
	default:
		return nil, fmt.Errorf("unsupported ReDevPlugin runtime fixture architecture %q", goarch)
	}

	header := make([]byte, 32)
	binary.LittleEndian.PutUint32(header[0:], 0xfeedfacf)
	binary.LittleEndian.PutUint32(header[4:], cpu)
	binary.LittleEndian.PutUint32(header[12:], 2)
	return header, nil
}
