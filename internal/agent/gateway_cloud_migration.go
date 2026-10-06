package agent

import (
	"context"
	"errors"
	"runtime"
	"strings"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaycloud"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
)

// ConsentGatewayUserMigration runs only while the caller holds the Runtime state
// lock. It reuses the normal durable spend boundary and proves the old binding
// through a real Flowersec control session carried over the new Gateway path.
func ConsentGatewayUserMigration(ctx context.Context, configPath, stateDir string, cfg *config.Config, target *gatewaycloud.RuntimeConfig) (next *config.Config, resultErr error) {
	if cfg == nil || target == nil || cfg.GatewayCloud != nil || cfg.EnvironmentID == "" || cfg.ProviderOrigin != target.CloudOrigin || cfg.ControlplaneBaseURL != target.RegionOrigin || cfg.LocalEnvironmentPublicID != target.RuntimePublicID {
		return cfg, gatewaycloud.ErrState
	}
	if err := cfg.ValidateRemoteStrict(); err != nil {
		return cfg, err
	}
	a := &Agent{cfg: cfg, configPath: configPath, stateDir: stateDir}
	defer func() { next = a.cfg }()
	client, err := target.Client()
	if err != nil {
		return cfg, err
	}
	defer client.Close()
	identity, err := target.Identity()
	if err != nil {
		return cfg, err
	}
	proof, err := client.Sign(ctx, identity, gc.PurposeUserMigration, gc.UserMigrationConsent{TargetRequestPublicID: target.RequestPublicID, EnvPublicID: cfg.EnvironmentID, Generation: cfg.BindingGeneration})
	if err != nil {
		return cfg, err
	}
	entry, generation, err := a.acquireControlArtifactEntry()
	if err != nil {
		return cfg, errors.New("current Cloud binding has no usable control credential; reauthorize it before migration")
	}
	artifact, err := flowersec.ParseArtifact(entry.ArtifactJSON)
	if err != nil {
		return cfg, err
	}
	lease, err := flowersec.NewArtifactLease(artifact, func(ctx context.Context) error {
		return a.commitControlArtifactPoolSpend(ctx, generation, entry.Sequence, entry.ArtifactDigest, entry.ArtifactJSON, entry.ExpiresAtUnixS)
	})
	if err != nil {
		return cfg, err
	}
	proxy, err := target.Proxy()
	if err != nil {
		return cfg, err
	}
	session, err := flowersec.Connect(ctx, lease, flowersec.ConnectorOptions{HTTPSProxy: proxy, Origin: strings.TrimRight(cfg.ControlplaneBaseURL, "/"), ConnectTimeout: 15 * time.Second, RPCHandlers: flowersec.NewRPCHandlers()})
	if err != nil {
		return cfg, err
	}
	defer session.Close()
	_, err = callControlJSON[registerReq, registerResp](ctx, a, session.RPC(), controlRPCTypeRegister, &registerReq{EnvPublicID: cfg.EnvironmentID, LocalEnvironmentPublicID: cfg.LocalEnvironmentPublicID, BindingGeneration: generation, ControlArtifactSequence: entry.Sequence, ControlArtifactChannelID: entry.ChannelID, AgentInstanceID: cfg.AgentInstanceID, Version: "gateway-migration-v1", OS: runtime.GOOS, Arch: runtime.GOARCH, Hostname: hostnameBestEffort(), EffectiveRunMode: "remote", RemoteEnabled: true})
	if err != nil {
		return cfg, err
	}
	_, err = callControlJSON[gc.SignedRequest, gc.Candidate](ctx, a, session.RPC(), controlRPCTypeGatewayMigration, &proof)
	return a.cfg, err
}
