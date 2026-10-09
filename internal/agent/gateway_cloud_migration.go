package agent

import (
	"context"
	"errors"
	"runtime"
	"strings"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/gatewaycloud"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
)

var errGatewayBindingProofRequired = errors.New("current Cloud binding requires reauthorization before migration")

// consentGatewayUserMigration runs under cloudLinkMu and gatewayRecoveryMu.
// The live Agent owns durable credential spending; there is no parallel writer.
func (a *Agent) consentGatewayUserMigration(ctx context.Context, target *gatewaycloud.RuntimeConfig) error {
	cfg := a.remoteConfigSnapshot()
	if cfg == nil || target == nil || cfg.GatewayEnvironmentChoice != "preserve" || cfg.EnvironmentID == "" || cfg.CloudOrigin != target.CloudOrigin || cfg.AccessPointOrigin != target.RegionOrigin || cfg.LocalEnvironmentPublicID != target.RuntimePublicID {
		return gatewaycloud.ErrState
	}
	original := *cfg
	original.Gateway, original.GatewayPublication = nil, nil
	if err := original.ValidateRemoteStrict(); err != nil {
		return errGatewayBindingProofRequired
	}
	client, err := target.Client(cfg.Gateway)
	if err != nil {
		return err
	}
	defer client.Close()
	identity, err := target.Identity()
	if err != nil {
		return err
	}
	proof, err := client.Sign(ctx, identity, gc.PurposeUserMigration, gc.UserMigrationConsent{TargetRequestPublicID: target.RequestPublicID, EnvPublicID: cfg.EnvironmentID, Generation: cfg.BindingGeneration})
	if err != nil {
		return err
	}
	entry, generation, err := a.acquireControlArtifactEntry()
	if err != nil {
		return errGatewayBindingProofRequired
	}
	artifact, err := flowersec.ParseArtifact(entry.ArtifactJSON)
	if err != nil {
		return err
	}
	lease, err := flowersec.NewArtifactLease(artifact, func(ctx context.Context) error {
		return a.commitControlArtifactPoolSpend(ctx, generation, entry.Sequence, entry.ArtifactDigest, entry.ArtifactJSON, entry.ExpiresAtUnixS)
	})
	if err != nil {
		return err
	}
	proxy, err := target.Proxy(cfg.Gateway)
	if err != nil {
		return err
	}
	session, err := flowersec.Connect(ctx, lease, flowersec.ConnectorOptions{HTTPSProxy: proxy, Origin: strings.TrimRight(cfg.AccessPointOrigin, "/"), ConnectTimeout: 15 * time.Second, RPCHandlers: flowersec.NewRPCHandlers()})
	if err != nil {
		return err
	}
	defer session.Close()
	_, err = callControlJSON[registerReq, registerResp](ctx, a, session.RPC(), controlRPCTypeRegister, &registerReq{EnvPublicID: cfg.EnvironmentID, LocalEnvironmentPublicID: cfg.LocalEnvironmentPublicID, BindingGeneration: generation, ControlArtifactSequence: entry.Sequence, ControlArtifactChannelID: entry.ChannelID, AgentInstanceID: cfg.AgentInstanceID, Version: "gateway-migration-v2", OS: runtime.GOOS, Arch: runtime.GOARCH, Hostname: hostnameBestEffort(), EffectiveRunMode: "remote", RemoteEnabled: true})
	if err != nil {
		return err
	}
	_, err = callControlJSON[gc.SignedRequest, gc.Candidate](ctx, a, session.RPC(), controlRPCTypeGatewayMigration, &proof)
	return err
}
