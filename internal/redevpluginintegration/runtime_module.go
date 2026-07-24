package redevpluginintegration

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/floegence/redevplugin/pkg/host"
	"github.com/floegence/redevplugin/pkg/version"
)

const officialRuntimeVersion = "0.6.10"

type runtimeModuleDependencies struct {
	Path          string
	ExecutionRoot string
}

// newOfficialRuntimeModule admits Redeven's product-built ReDevPlugin runtime
// through the released Host capability. ReDevPlugin v0.6 intentionally exposes
// runtime admission only on Linux; other platforms keep the plugin management
// surface available without claiming worker execution support.
func newOfficialRuntimeModule(ctx context.Context, deps runtimeModuleDependencies) (*host.RuntimeModule, error) {
	runtimePath := strings.TrimSpace(deps.Path)
	if runtimePath == "" || !filepath.IsAbs(runtimePath) || filepath.Clean(runtimePath) != runtimePath || filepath.Base(runtimePath) != "redevplugin-runtime" {
		return nil, errors.New("official runtime path must be an absolute canonical path named redevplugin-runtime")
	}
	executionRootPath := strings.TrimSpace(deps.ExecutionRoot)
	if executionRootPath == "" || !filepath.IsAbs(executionRootPath) || filepath.Clean(executionRootPath) != executionRootPath {
		return nil, errors.New("official runtime execution root must be an absolute canonical path")
	}
	if runtime.GOOS != "linux" {
		return nil, nil
	}
	if err := os.MkdirAll(executionRootPath, 0o700); err != nil {
		return nil, err
	}
	if err := os.Chmod(executionRootPath, 0o700); err != nil {
		return nil, err
	}

	platformVersion, err := version.ParseSemVer(officialRuntimeVersion)
	if err != nil {
		return nil, err
	}
	target, err := host.ParseRuntimeAdmissionTarget(runtime.GOOS + "/" + runtime.GOARCH)
	if err != nil {
		return nil, err
	}
	rustIPC, err := host.ParseRustIPCVersion(version.RustIPCVersion)
	if err != nil {
		return nil, err
	}
	wasmABI, err := host.ParseWASMABIVersion(version.WASMABIVersion)
	if err != nil {
		return nil, err
	}
	contractSetSHA256, err := host.ParseSHA256Digest(version.ContractSetSHA256)
	if err != nil {
		return nil, err
	}
	binarySHA256Value, err := sha256File(runtimePath)
	if err != nil {
		return nil, err
	}
	binarySHA256, err := host.ParseSHA256Digest(binarySHA256Value)
	if err != nil {
		return nil, err
	}
	descriptor, err := host.NewRuntimeDescriptor(host.RuntimeDescriptorOptions{
		PlatformVersion:   platformVersion,
		Target:            target,
		RustIPCVersion:    rustIPC,
		WASMABIVersion:    wasmABI,
		ContractSetSHA256: contractSetSHA256,
		BinarySHA256:      binarySHA256,
	})
	if err != nil {
		return nil, err
	}
	binaryName, err := host.NewRuntimeBinaryName(filepath.Base(runtimePath))
	if err != nil {
		return nil, err
	}
	runtimeRoot, err := os.Open(filepath.Dir(runtimePath))
	if err != nil {
		return nil, err
	}
	defer runtimeRoot.Close()
	executionRoot, err := os.Open(executionRootPath)
	if err != nil {
		return nil, err
	}
	defer executionRoot.Close()
	executable, err := host.OpenVerifiedExecutable(ctx, host.VerifiedExecutableOptions{
		RootDir:            runtimeRoot,
		ExecutionRoot:      executionRoot,
		RelativeName:       binaryName,
		ExpectedDescriptor: descriptor,
	})
	if err != nil {
		return nil, err
	}
	module, err := host.NewRuntimeModule(executable, host.RuntimeModuleOptions{})
	if err != nil {
		_, _ = executable.Close()
		return nil, err
	}
	return module, nil
}

func sha256File(filename string) (string, error) {
	file, err := os.Open(filename)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}
