package agent

import (
	"context"
	"runtime"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaycloud"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

// advanceGatewayPublication follows the sole locally approved membership. It
// has no separate invitation or local consent entry point for Cloud access.
func (a *Agent) advanceGatewayPublication(ctx context.Context) error {
	a.providerLinkMu.Lock()
	defer a.providerLinkMu.Unlock()
	a.gatewayRecoveryMu.Lock()
	restart := false
	defer func() {
		a.gatewayRecoveryMu.Unlock()
		if restart {
			if a.code != nil {
				_ = a.code.SetControlplaneBaseURL(a.remoteConfigSnapshot().ControlplaneBaseURL)
			}
			a.startOrRestartControlChannel()
		}
	}()
	cfg := a.remoteConfigSnapshot()
	member := cfg.Gateway
	if member == nil || member.Leaving || member.PendingJoin != nil {
		return gatewaycloud.ErrState
	}
	var association gp.MemberCloudContext
	if err := member.Request(ctx, "/v4/member/cloud", gp.CatalogRequest{ProtocolVersion: gp.Version}, &association, true); err != nil {
		return err
	}
	a.mu.Lock()
	if a.cfg.Gateway == nil || a.cfg.Gateway.MemberID != member.MemberID || a.cfg.Gateway.MemberVersion != member.MemberVersion {
		a.mu.Unlock()
		return gatewaycloud.ErrState
	}
	a.gatewayCloudState, a.gatewayCloudMemberID = association.State, member.MemberID
	a.mu.Unlock()
	if cfg.GatewayPublication != nil && cfg.GatewayPublication.Binding != nil {
		return nil
	}
	// Existing identities require the explicit migration/conversion transaction.
	if (cfg.GatewayMigrationEvidence != nil || cfg.EnvironmentID != "") && cfg.GatewayPublication == nil && cfg.GatewayEnvironmentChoice == "" {
		return gatewaycloud.ErrState
	}
	if !association.Allowed {
		return gatewaycloud.ErrState
	}
	route := cfg.GatewayPublication.Clone()
	if route == nil {
		var err error
		route, err = gatewaycloud.PrepareRuntime(member, association)
		if err != nil {
			return err
		}
	}
	if cfg.GatewayEnvironmentChoice == "new" {
		route.NewEnvironment = true
	}
	if cfg.GatewayEnvironmentChoice == "preserve" && cfg.GatewayMigrationEvidence != nil {
		evidence := cfg.GatewayMigrationEvidence
		if evidence.CloudOrigin != route.CloudOrigin || evidence.NamespacePublicID != route.NamespacePublicID || evidence.RegionOrigin != route.RegionOrigin || evidence.RuntimePublicID != route.RuntimePublicID {
			return gatewaycloud.ErrState
		}
		route.PreviousBinding = evidence.Clone()
	}
	if route.Revoked || route.GatewayPublicID != association.GatewayPublicID || route.NamespacePublicID != association.NamespacePublicID || route.CloudOrigin != association.CloudOrigin || route.RegionOrigin != association.RegionOrigin {
		return gatewaycloud.ErrState
	}
	persist := func(delivery *gatewaycloud.CredentialDelivery) error {
		a.mu.Lock()
		defer a.mu.Unlock()
		if a.cfg.Gateway == nil || a.cfg.Gateway.Leaving || a.cfg.Gateway.MemberID != member.MemberID || a.cfg.Gateway.MemberVersion != member.MemberVersion {
			return gatewaycloud.ErrState
		}
		if current := a.cfg.GatewayPublication; current != nil && (current.RequestPublicID != route.RequestPublicID || current.Revoked) {
			return gatewaycloud.ErrState
		}
		next := *a.cfg
		next.GatewayPublication = route.Clone()
		if delivery != nil {
			if err := next.ApplyGatewayDelivery(delivery); err != nil {
				return err
			}
		}
		if err := config.Save(a.configPath, &next); err != nil {
			return err
		}
		a.cfg = &next
		if delivery != nil {
			a.enableProviderControlChannelLocked()
			restart = true
		}
		return nil
	}
	// Persist the independent Cloud key before submitting any proof.
	if err := persist(nil); err != nil {
		return err
	}
	if !route.Proven {
		candidate, err := route.Join(ctx, member, gc.RuntimeMetadata{Hostname: hostnameBestEffort(), OS: runtime.GOOS, Arch: runtime.GOARCH, Version: a.version})
		if err != nil {
			return err
		}
		if candidate.MemberID != member.MemberID || candidate.MemberVersion != member.MemberVersion || candidate.RequestPublicID != route.RequestPublicID {
			return gatewaycloud.ErrState
		}
		route.Proven = true
		if err := persist(nil); err != nil {
			return err
		}
	}
	status, err := route.Status(ctx, member)
	if err != nil {
		return err
	}
	b := status.Candidate.Binding
	if b == nil {
		if cfg.GatewayEnvironmentChoice != "preserve" {
			return nil
		}
		if cfg.GatewayMigrationEvidence != nil {
			if status.Candidate.MigrationSource != nil {
				return nil
			}
			return cfg.GatewayMigrationEvidence.ConsentPreservation(ctx, member, route)
		}
		if status.Candidate.UserMigrationSource != nil {
			return nil
		}
		return a.consentGatewayUserMigration(ctx, route)
	}
	if cfg.GatewayEnvironmentChoice == "preserve" && b.EnvPublicID != cfg.EnvironmentID {
		return gatewaycloud.ErrState
	}
	if status.Candidate.State != "published" || b.MemberID != member.MemberID || b.MemberVersion != member.MemberVersion || b.State != "active" || b.GatewayPublicID != route.GatewayPublicID || b.NamespacePublicID != route.NamespacePublicID || b.RuntimePublicID != route.RuntimePublicID {
		return gatewaycloud.ErrState
	}
	route.Binding = b
	if route.DeliveryRequestID == "" {
		route.DeliveryRequestID, err = gatewaycloud.NewDeliveryID()
		if err != nil {
			return err
		}
	}
	if err := persist(nil); err != nil {
		return err
	}
	delivery, err := route.Recover(ctx, member)
	if route.ForgetExpiredDelivery(err) {
		if saveErr := persist(nil); saveErr != nil {
			return saveErr
		}
	}
	if err != nil {
		return err
	}
	return persist(delivery)
}

func (a *Agent) startGatewayCloudObserver() {
	a.mu.Lock()
	ctx := a.runCtx
	a.mu.Unlock()
	if ctx != nil {
		a.gatewayObserverOnce.Do(func() { go a.observeGatewayCloud(ctx) })
	}
}
