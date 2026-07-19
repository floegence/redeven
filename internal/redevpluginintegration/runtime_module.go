package redevpluginintegration

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/floegence/redevplugin/pkg/bridge"
	"github.com/floegence/redevplugin/pkg/connectivity"
	"github.com/floegence/redevplugin/pkg/host"
	"github.com/floegence/redevplugin/pkg/observability"
	"github.com/floegence/redevplugin/pkg/pluginpkg"
	"github.com/floegence/redevplugin/pkg/runtimeclient"
	"github.com/floegence/redevplugin/pkg/runtimetarget"
	"github.com/floegence/redevplugin/pkg/version"
)

const (
	officialRuntimeVersion               = "0.5.1"
	officialRuntimeShardCount            = 1
	officialRuntimeHandshakeTimeout      = 5 * time.Second
	officialRuntimeHeartbeatInterval     = 2 * time.Second
	officialRuntimeMaxHeartbeatStaleness = 5 * time.Second
)

type runtimeModuleDependencies struct {
	Path             string
	Diagnostics      observability.DiagnosticsSink
	Assets           pluginpkg.AssetStore
	SurfaceTokens    *bridge.SurfaceTokenService
	PluginData       host.PluginData
	Connectivity     connectivity.Broker
	NetworkExecutor  connectivity.NetworkExecutor
	LeaseReplayStore runtimeclient.RuntimeLeaseReplayStore
}

func newOfficialRuntimeModule(deps runtimeModuleDependencies) (*host.RuntimeModule, error) {
	runtimePath := strings.TrimSpace(deps.Path)
	if runtimePath == "" || !filepath.IsAbs(runtimePath) || filepath.Clean(runtimePath) != runtimePath {
		return nil, errors.New("official runtime path must be an absolute canonical path")
	}
	if deps.Diagnostics == nil || deps.Assets == nil || deps.SurfaceTokens == nil || deps.PluginData == nil ||
		deps.Connectivity == nil || deps.NetworkExecutor == nil || deps.LeaseReplayStore == nil {
		return nil, errors.New("official runtime host services are incomplete")
	}
	target, err := runtimetarget.Current()
	if err != nil {
		return nil, err
	}
	runtimeVersion, err := version.ParseSemVer(officialRuntimeVersion)
	if err != nil {
		return nil, err
	}
	descriptor, err := runtimeclient.NewRuntimeDescriptor(
		runtimeVersion,
		target,
		version.RustIPCVersion,
		version.WASMABIVersion,
		officialRuntimeSHA256(target),
	)
	if err != nil {
		return nil, err
	}
	manager, err := runtimeclient.NewProcessManager(runtimeclient.ProcessManagerOptions{
		ShardCount: officialRuntimeShardCount,
		Supervisor: runtimeclient.ProcessSupervisorOptions{
			RuntimePath:           runtimePath,
			Descriptor:            descriptor,
			Diagnostics:           deps.Diagnostics,
			Artifacts:             runtimeArtifactProvider{assets: deps.Assets},
			HandleGrants:          runtimeHandleGrantValidator{tokens: deps.SurfaceTokens},
			RuntimeLeaseReplays:   deps.LeaseReplayStore,
			StorageFiles:          deps.PluginData,
			StorageKV:             deps.PluginData,
			StorageSQLite:         deps.PluginData,
			Connectivity:          deps.Connectivity,
			NetworkExecutor:       deps.NetworkExecutor,
			HandshakeTimeout:      officialRuntimeHandshakeTimeout,
			HeartbeatInterval:     officialRuntimeHeartbeatInterval,
			MaxHeartbeatStaleness: officialRuntimeMaxHeartbeatStaleness,
			Limits:                runtimeclient.DefaultRuntimeLimits(),
		},
	})
	if err != nil {
		return nil, err
	}
	return &host.RuntimeModule{Manager: manager}, nil
}

func officialRuntimeSHA256(target runtimetarget.Target) string {
	switch target {
	case runtimetarget.DarwinARM64:
		return "fea17883ff27e943eeebc8bf9a68bd3d8c535b95d278fb18da0c3ec3d165dcca"
	case runtimetarget.DarwinAMD64:
		return "eca4f841c60a3e2cb4e76c51567ed7d1cab60a16396db6cbdbaf3d1cc9559841"
	case runtimetarget.LinuxARM64:
		return "95cd87a998d8ae5c6ea3451551e72c69b8f5e27040b1016fcd39333e2b251b45"
	case runtimetarget.LinuxAMD64:
		return "4f9ccbe61463fa7dc0053086dca128743b493b74f5b4535994d6dbccde55aef4"
	default:
		return ""
	}
}

type runtimeArtifactProvider struct {
	assets pluginpkg.AssetStore
}

func (p runtimeArtifactProvider) ReadArtifact(ctx context.Context, req runtimeclient.ArtifactRequest) (runtimeclient.ArtifactResult, error) {
	asset, err := p.assets.ReadAsset(ctx, req.PackageHash, req.Artifact)
	if err != nil {
		return runtimeclient.ArtifactResult{}, err
	}
	if strings.TrimSpace(asset.Entry.SHA256) == "" || asset.Entry.SHA256 != req.ArtifactSHA256 {
		return runtimeclient.ArtifactResult{}, runtimeclient.ErrRuntimeArtifactDigest
	}
	return runtimeclient.ArtifactResult{Content: append([]byte(nil), asset.Content...), SHA256: asset.Entry.SHA256}, nil
}

type runtimeHandleGrantValidator struct {
	tokens *bridge.SurfaceTokenService
}

func (v runtimeHandleGrantValidator) ValidateHandleGrant(_ context.Context, req runtimeclient.HandleGrantValidationRequest) (runtimeclient.HandleGrantValidationResult, error) {
	if v.tokens == nil {
		return runtimeclient.HandleGrantValidationResult{}, errors.New("runtime handle grant validator is unavailable")
	}
	record, err := v.tokens.ValidateHandleGrant(bridge.ValidateHandleGrantRequest{
		HandleGrantToken: req.HandleGrantToken,
		Audience: bridge.Audience{
			PluginInstanceID:     req.PluginInstanceID,
			ActiveFingerprint:    req.ActiveFingerprint,
			RuntimeInstanceID:    req.RuntimeInstanceID,
			RuntimeGenerationID:  req.RuntimeGenerationID,
			RuntimeShardID:       req.RuntimeShardID,
			OwnerSessionHash:     req.OwnerSessionHash,
			OwnerUserHash:        req.OwnerUserHash,
			OwnerEnvHash:         req.OwnerEnvHash,
			SessionChannelIDHash: req.SessionChannelIDHash,
			HandleID:             req.HandleID,
			Method:               req.Method,
			ResourceScope:        req.ResourceScope,
		},
		Revision: bridge.RevisionBinding{
			PolicyRevision:     req.PolicyRevision,
			ManagementRevision: req.ManagementRevision,
			RevokeEpoch:        req.RevokeEpoch,
		},
	})
	if err != nil {
		return runtimeclient.HandleGrantValidationResult{}, err
	}
	if record.Audience.ResourceScope != req.ResourceScope {
		return runtimeclient.HandleGrantValidationResult{}, fmt.Errorf("%w: runtime handle grant scope", host.ErrOwnerScopeMismatch)
	}
	return runtimeclient.HandleGrantValidationResult{
		HandleGrantID:       record.TokenID,
		HandleID:            record.Audience.HandleID,
		Method:              record.Audience.Method,
		RuntimeGenerationID: record.Audience.RuntimeGenerationID,
		ResourceScope:       record.Audience.ResourceScope,
		MaxBytesPerSecond:   record.Limits.MaxBytesPerSecond,
		MaxTotalBytes:       record.Limits.MaxTotalBytes,
	}, nil
}
