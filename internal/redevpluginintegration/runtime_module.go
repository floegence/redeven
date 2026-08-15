package redevpluginintegration

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/floegence/redevplugin/v2/pkg/contracts"
	"github.com/floegence/redevplugin/v2/pkg/host"
	"github.com/floegence/redevplugin/v2/pkg/version"
)

const bundledRuntimeDescriptorName = ".redevplugin-release-artifacts-verified.json"

var officialRuntimeVersion = contracts.PackageSet().PlatformVersion

type bundledRuntimeReleaseDescriptor struct {
	SchemaVersion       string `json:"schema_version"`
	PlatformPublication struct {
		PlatformVersion   string `json:"platform_version"`
		ContractSetSHA256 string `json:"contract_set_sha256"`
	} `json:"platform_publication"`
	Runtime struct {
		Target string `json:"target"`
		Binary struct {
			Path   string `json:"path"`
			SHA256 string `json:"sha256"`
			Size   int64  `json:"size"`
		} `json:"binary"`
	} `json:"runtime"`
}

type runtimeModuleDependencies struct {
	Path          string
	ExecutionRoot string
}

// newOfficialRuntimeModule admits Redeven's product-built ReDevPlugin runtime
// through the released Host capability. ReDevPlugin exposes
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

	descriptor, err := BundledRuntimeDescriptor(filepath.Join(filepath.Dir(runtimePath), bundledRuntimeDescriptorName))
	if err != nil {
		return nil, err
	}
	if descriptor.BinarySHA256().String() == "" {
		return nil, errors.New("bundled runtime descriptor is incomplete")
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

func BundledRuntimeDescriptor(filename string) (host.RuntimeDescriptor, error) {
	return bundledRuntimeDescriptor(filename, runtime.GOOS+"/"+runtime.GOARCH)
}

func bundledRuntimeDescriptor(filename, expectedTarget string) (host.RuntimeDescriptor, error) {
	raw, err := os.ReadFile(filename)
	if err != nil {
		return host.RuntimeDescriptor{}, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	var release bundledRuntimeReleaseDescriptor
	if err := decoder.Decode(&release); err != nil {
		return host.RuntimeDescriptor{}, fmt.Errorf("decode bundled runtime descriptor: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return host.RuntimeDescriptor{}, errors.New("bundled runtime descriptor contains trailing data")
	}
	if release.SchemaVersion != "redeven.redevplugin_runtime_build.v1" ||
		release.PlatformPublication.PlatformVersion != officialRuntimeVersion ||
		release.Runtime.Target != expectedTarget ||
		release.Runtime.Binary.Path != "redevplugin-runtime" || release.Runtime.Binary.Size <= 0 ||
		release.PlatformPublication.ContractSetSHA256 != version.ContractSetSHA256 {
		return host.RuntimeDescriptor{}, errors.New("bundled runtime descriptor identity is invalid")
	}
	platformVersion, err := version.ParseSemVer(release.PlatformPublication.PlatformVersion)
	if err != nil {
		return host.RuntimeDescriptor{}, err
	}
	target, err := host.ParseRuntimeAdmissionTarget(release.Runtime.Target)
	if err != nil {
		return host.RuntimeDescriptor{}, err
	}
	rustIPC, err := host.ParseRustIPCVersion(version.RustIPCVersion)
	if err != nil {
		return host.RuntimeDescriptor{}, err
	}
	wasmABI, err := host.ParseWASMABIVersion(version.WASMABIVersion)
	if err != nil {
		return host.RuntimeDescriptor{}, err
	}
	contractSetSHA256, err := host.ParseSHA256Digest(release.PlatformPublication.ContractSetSHA256)
	if err != nil {
		return host.RuntimeDescriptor{}, err
	}
	binarySHA256, err := host.ParseSHA256Digest(release.Runtime.Binary.SHA256)
	if err != nil {
		return host.RuntimeDescriptor{}, err
	}
	return host.NewRuntimeDescriptor(host.RuntimeDescriptorOptions{
		PlatformVersion: platformVersion, Target: target, RustIPCVersion: rustIPC,
		WASMABIVersion: wasmABI, ContractSetSHA256: contractSetSHA256, BinarySHA256: binarySHA256,
	})
}
