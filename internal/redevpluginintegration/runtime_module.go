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

	"github.com/floegence/redevplugin/v3/pkg/host"
	"github.com/floegence/redevplugin/v3/pkg/runtimetarget"
	"github.com/floegence/redevplugin/v3/pkg/version"
)

const bundledRuntimeDescriptorName = ".redevplugin-release-artifacts-verified.json"

var officialRuntimeVersion = version.CurrentPlatformVersion()

type bundledRuntimeReleaseDescriptor struct {
	SchemaVersion   string `json:"schema_version"`
	PlatformRelease struct {
		PlatformVersion string `json:"platform_version"`
	} `json:"platform_release"`
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

type runtimeExecutableOpener func(context.Context, host.VerifiedExecutableOptions) (*host.VerifiedExecutable, error)

// newOfficialRuntimeModule admits Redeven's product-built ReDevPlugin runtime
// through the released Host capability. ReDevPlugin exposes
// runtime admission only on Linux; other platforms keep the plugin management
// surface available without claiming worker execution support.
func newOfficialRuntimeModule(ctx context.Context, deps runtimeModuleDependencies) (*host.RuntimeModule, error) {
	return newOfficialRuntimeModuleForPlatform(ctx, deps, runtime.GOOS+"/"+runtime.GOARCH, host.OpenVerifiedExecutable)
}

func newOfficialRuntimeModuleForPlatform(
	ctx context.Context,
	deps runtimeModuleDependencies,
	platform string,
	openExecutable runtimeExecutableOpener,
) (*host.RuntimeModule, error) {
	runtimePath := strings.TrimSpace(deps.Path)
	if runtimePath == "" || !filepath.IsAbs(runtimePath) || filepath.Clean(runtimePath) != runtimePath || filepath.Base(runtimePath) != "redevplugin-runtime" {
		return nil, errors.New("official runtime path must be an absolute canonical path named redevplugin-runtime")
	}
	executionRootPath := strings.TrimSpace(deps.ExecutionRoot)
	if executionRootPath == "" || !filepath.IsAbs(executionRootPath) || filepath.Clean(executionRootPath) != executionRootPath {
		return nil, errors.New("official runtime execution root must be an absolute canonical path")
	}
	if !strings.HasPrefix(platform, "linux/") {
		return nil, nil
	}
	if openExecutable == nil {
		return nil, errors.New("runtime executable opener is required")
	}
	if err := os.MkdirAll(executionRootPath, 0o700); err != nil {
		return nil, err
	}
	if err := os.Chmod(executionRootPath, 0o700); err != nil {
		return nil, err
	}

	descriptor, err := bundledRuntimeDescriptor(
		filepath.Join(filepath.Dir(runtimePath), bundledRuntimeDescriptorName),
		platform,
	)
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
	executable, err := openExecutable(ctx, host.VerifiedExecutableOptions{
		RootDir:                  runtimeRoot,
		ExecutionRoot:            executionRoot,
		RelativeName:             binaryName,
		ExpectedArtifactIdentity: descriptor,
	})
	if err != nil {
		// Worker execution is an optional Host module. Older Linux kernels can
		// reject the released sealed-memfd admission primitive; keep plugin
		// management and the rest of Env App available without weakening or
		// replacing ReDevPlugin's executable verification.
		if errors.Is(err, host.ErrRuntimeAdmissionUnsupported) {
			return nil, nil
		}
		return nil, err
	}
	module, err := host.NewRuntimeModule(executable, host.RuntimeModuleOptions{})
	if err != nil {
		_, _ = executable.Close()
		return nil, err
	}
	return module, nil
}

func BundledRuntimeDescriptor(filename string) (host.RuntimeArtifactIdentity, error) {
	return bundledRuntimeDescriptor(filename, runtime.GOOS+"/"+runtime.GOARCH)
}

func bundledRuntimeDescriptor(filename, expectedTarget string) (host.RuntimeArtifactIdentity, error) {
	raw, err := os.ReadFile(filename)
	if err != nil {
		return host.RuntimeArtifactIdentity{}, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	var release bundledRuntimeReleaseDescriptor
	if err := decoder.Decode(&release); err != nil {
		return host.RuntimeArtifactIdentity{}, fmt.Errorf("decode bundled runtime descriptor: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return host.RuntimeArtifactIdentity{}, errors.New("bundled runtime descriptor contains trailing data")
	}
	if release.SchemaVersion != "redeven.redevplugin_runtime_build.v1" ||
		release.PlatformRelease.PlatformVersion != officialRuntimeVersion ||
		release.Runtime.Target != expectedTarget ||
		release.Runtime.Binary.Path != "redevplugin-runtime" || release.Runtime.Binary.Size <= 0 {
		return host.RuntimeArtifactIdentity{}, errors.New("bundled runtime descriptor identity is invalid")
	}
	platformVersion, err := version.ParseSemVer(release.PlatformRelease.PlatformVersion)
	if err != nil {
		return host.RuntimeArtifactIdentity{}, err
	}
	target, err := runtimetarget.Parse(release.Runtime.Target)
	if err != nil {
		return host.RuntimeArtifactIdentity{}, err
	}
	binarySHA256, err := host.ParseSHA256Digest(release.Runtime.Binary.SHA256)
	if err != nil {
		return host.RuntimeArtifactIdentity{}, err
	}
	return host.NewRuntimeArtifactIdentity(host.RuntimeArtifactIdentityOptions{
		PlatformVersion: platformVersion,
		Target:          target,
		BinarySHA256:    binarySHA256,
	})
}
