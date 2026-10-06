package agent

import (
	"context"
	"errors"
	"runtime"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaycloud"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
)

// JoinGatewayCloud advances one durable enrollment stage over the trusted
// Runtime control channel. Closing Desktop pauses polling without undoing
// recorded consent. Bound environments require explicit migration instead.
func (a *Agent) JoinGatewayCloud(ctx context.Context, material *gc.JoinMaterial) (string, error) {
	if a == nil {
		return "", gatewaycloud.ErrState
	}
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
			a.startGatewayCloudObserver()
			a.startOrRestartControlChannel()
		}
	}()
	a.mu.Lock()
	if a.cfg == nil || a.cfg.GatewayCloudMigration != nil || (a.cfg.EnvironmentID != "" && a.cfg.GatewayCloud == nil) {
		a.mu.Unlock()
		return "", gatewaycloud.ErrState
	}
	if a.cfg.GatewayCloud == nil {
		if material == nil {
			a.mu.Unlock()
			return "", gatewaycloud.ErrState
		}
		next := *a.cfg
		if err := next.EnsureRuntimeIDs(); err != nil {
			a.mu.Unlock()
			return "", err
		}
		route, err := gatewaycloud.PrepareRuntime(*material, next.LocalEnvironmentPublicID)
		if err != nil {
			a.mu.Unlock()
			return "", err
		}
		next.GatewayCloud = route
		if err := config.Save(a.configPath, &next); err != nil {
			a.mu.Unlock()
			return "", err
		}
		a.cfg = &next
	}
	route := *a.cfg.GatewayCloud
	a.mu.Unlock()
	if material != nil && (material.RequestPublicID != route.RequestPublicID || material.CloudOrigin != route.CloudOrigin || material.GatewayPublicID != route.GatewayPublicID || material.NamespacePublicID != route.NamespacePublicID) {
		return "", gatewaycloud.ErrState
	}
	if route.Revoked {
		return "", gatewaycloud.ErrState
	}
	persist := func(delivery *gatewaycloud.CredentialDelivery) error {
		a.mu.Lock()
		defer a.mu.Unlock()
		if a.cfg.GatewayCloud == nil || a.cfg.GatewayCloud.RequestPublicID != route.RequestPublicID || a.cfg.GatewayCloud.Revoked {
			return gatewaycloud.ErrState
		}
		next := *a.cfg
		copy := route
		next.GatewayCloud = &copy
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
	if route.ClientCertificatePEM == "" {
		if err := route.Enroll(ctx); err != nil {
			return "", err
		}
		return "verifying", persist(nil)
	}
	if route.JoinToken != "" {
		if _, err := route.Join(ctx, gc.RuntimeMetadata{Hostname: hostnameBestEffort(), OS: runtime.GOOS, Arch: runtime.GOARCH, Version: a.version}); err != nil {
			return "", err
		}
	}
	status, err := route.Status(ctx)
	if err != nil {
		return "", err
	}
	if status.Candidate.State == "revoked" || status.Candidate.State == "unpublished" {
		return "", gatewaycloud.ErrState
	}
	b := status.Candidate.Binding
	if b == nil {
		return "awaiting_approval", nil
	}
	if b.State != "active" || b.GatewayPublicID != route.GatewayPublicID || b.NamespacePublicID != route.NamespacePublicID || b.RuntimePublicID != route.RuntimePublicID {
		return "", gatewaycloud.ErrState
	}
	if route.JoinToken == "" {
		a.mu.Lock()
		registered := a.controlRegistered
		a.mu.Unlock()
		if registered {
			return "connected", nil
		}
		return "connecting", nil
	}
	route.Binding = b
	if route.DeliveryRequestID == "" {
		route.DeliveryRequestID, err = gatewaycloud.NewDeliveryID()
		if err != nil {
			return "", err
		}
	}
	if err := persist(nil); err != nil {
		return "", err
	}
	delivery, err := route.Recover(ctx)
	if route.ForgetExpiredDelivery(err) {
		if saveErr := persist(nil); saveErr != nil {
			return "", saveErr
		}
	}
	if err != nil {
		var cloud *gatewaycloud.CloudError
		if errors.As(err, &cloud) && cloud.Code == "GATEWAY_ENVIRONMENT_PENDING" {
			// Publication commits before the asynchronous Region projection.
			// Keep polling the same durable delivery until that projection exists.
			return "connecting", nil
		}
		return "", err
	}
	return "connecting", persist(delivery)
}

func (a *Agent) startGatewayCloudObserver() {
	a.mu.Lock()
	ctx := a.runCtx
	a.mu.Unlock()
	if ctx != nil {
		a.gatewayObserverOnce.Do(func() { go a.observeGatewayCloud(ctx) })
	}
}
