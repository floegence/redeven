package agent

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/floegence/flowersec/flowersec-go/v5/egress"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaycloud"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
)

func gatewayProxy(cfg *config.Config) (*egress.HTTPSProxy, error) {
	if cfg == nil {
		return nil, errors.New("missing runtime configuration")
	}
	if cfg.GatewayCloud == nil {
		return nil, nil
	}
	return cfg.GatewayCloud.Proxy()
}
func gatewayFence(cfg *config.Config) *gc.BindingFence {
	if cfg == nil || cfg.GatewayCloud == nil {
		return nil
	}
	return cfg.GatewayCloud.Fence()
}

func (a *Agent) recoverGatewayCredentials(ctx context.Context) error {
	a.gatewayRecoveryMu.Lock()
	defer a.gatewayRecoveryMu.Unlock()
	a.mu.Lock()
	if a.cfg == nil || a.cfg.GatewayCloud == nil || a.cfg.GatewayCloud.Revoked {
		a.mu.Unlock()
		return gatewaycloud.ErrState
	}
	next := *a.cfg
	r := *next.GatewayCloud
	next.GatewayCloud = &r
	if r.DeliveryRequestID == "" {
		id, err := gatewaycloud.NewDeliveryID()
		if err != nil {
			a.mu.Unlock()
			return err
		}
		r.DeliveryRequestID = id
		if err := config.Save(a.configPath, &next); err != nil {
			a.mu.Unlock()
			return err
		}
		a.cfg = &next
	}
	a.mu.Unlock()
	if r.PendingGenerationRenewal {
		return a.finishGatewayGenerationRenewal(ctx, &r)
	}
	delivery, err := r.Recover(ctx)
	if err != nil {
		var cloud *gatewaycloud.CloudError
		if errors.As(err, &cloud) && cloud.Code == "GATEWAY_GENERATION_EXHAUSTED" {
			a.mu.Lock()
			if a.cfg.GatewayCloud == nil || a.cfg.GatewayCloud.Revoked || a.cfg.GatewayCloud.Binding == nil || *a.cfg.GatewayCloud.Binding != *r.Binding {
				a.mu.Unlock()
				return gatewaycloud.ErrState
			}
			updated := *a.cfg
			r.PendingGenerationRenewal = true
			updated.GatewayCloud = &r
			if saveErr := config.Save(a.configPath, &updated); saveErr != nil {
				a.mu.Unlock()
				return saveErr
			}
			a.cfg = &updated
			a.mu.Unlock()
			return a.finishGatewayGenerationRenewal(ctx, &r)
		}
		if r.ForgetExpiredDelivery(err) {
			a.mu.Lock()
			defer a.mu.Unlock()
			if a.cfg.GatewayCloud == nil || a.cfg.GatewayCloud.Revoked || a.cfg.GatewayCloud.RequestPublicID != r.RequestPublicID {
				return gatewaycloud.ErrState
			}
			updated := *a.cfg
			updated.GatewayCloud = &r
			if saveErr := config.Save(a.configPath, &updated); saveErr != nil {
				return saveErr
			}
			a.cfg = &updated
		}
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg.GatewayCloud == nil || a.cfg.GatewayCloud.Revoked || a.cfg.GatewayCloud.Binding == nil || *a.cfg.GatewayCloud.Binding != delivery.Binding || a.cfg.GatewayCloud.DeliveryRequestID != delivery.DeliveryRequestID {
		return gatewaycloud.ErrState
	}
	updated := *a.cfg
	if err := updated.ApplyGatewayDelivery(delivery); err != nil {
		return err
	}
	if err := config.Save(a.configPath, &updated); err != nil {
		return err
	}
	a.cfg = &updated
	a.controlBusinessRejected = false
	a.controlCredentialsUnavailable = false
	return nil
}

// observeGatewayCloud acts only on authenticated closure requests. Network
// failure never creates a new lifetime limit for existing data sessions.
func (a *Agent) observeGatewayCloud(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	closureCursor := ""
	for {
		cfg := a.remoteConfigSnapshot()
		if cfg == nil || cfg.GatewayCloud == nil {
			return
		}
		r := *cfg.GatewayCloud
		if r.PreviousPath != nil && !r.Revoked {
			if err := r.AcknowledgePreviousPath(ctx); err == nil {
				a.mu.Lock()
				if a.cfg.GatewayCloud != nil && a.cfg.GatewayCloud.RequestPublicID == r.RequestPublicID {
					next := *a.cfg
					clean := *a.cfg.GatewayCloud
					clean.PreviousPath = nil
					next.GatewayCloud = &clean
					if config.Save(a.configPath, &next) == nil {
						a.cfg = &next
					}
				}
				a.mu.Unlock()
			}
		}
		if !r.Revoked && (r.PendingCertificatePEM != "" || r.ClientExpiresAtUnixMS < time.Now().Add(30*24*time.Hour).UnixMilli()) {
			if err := a.renewGatewayCertificate(ctx); err == nil {
				cfg = a.remoteConfigSnapshot()
				r = *cfg.GatewayCloud
				// Restart only after releasing the recovery lock: the previous
				// controller may be waiting for that lock during acquisition.
				a.startOrRestartControlChannel()
			}
		}
		if !r.Revoked && r.PreviousPath == nil && (r.PendingPrivateKeyB64u != "" || r.KeyRotatedAtUnixMS < time.Now().Add(-30*24*time.Hour).UnixMilli()) {
			if a.rotateGatewayIdentity(ctx) == nil {
				r = *a.remoteConfigSnapshot().GatewayCloud
			}
		}
		// A revoked binding may still attempt its signed acknowledgement. It cannot
		// obtain control artifacts, which remain fenced by the canonical authority.
		r.Revoked = false
		status, err := r.StatusPage(ctx, closureCursor)
		if err == nil {
			closureCursor = status.NextClosureCursor
			for _, closure := range status.Closures {
				if r.Binding == nil || closure.BindingPublicID != r.Binding.PublicID || closure.GatewayPublicID != r.GatewayPublicID || closure.RuntimePublicID != r.RuntimePublicID {
					continue
				}
				// A delayed receipt for an older generation must not revoke a
				// newly approved path. Its sessions are still closed individually.
				if closure.Generation >= r.Binding.Generation {
					a.mu.Lock()
					current := a.cfg
					if current.GatewayCloud == nil || current.GatewayCloud.Binding == nil || *current.GatewayCloud.Binding != *r.Binding {
						a.mu.Unlock()
						break
					}
					next := *current
					revoked := *current.GatewayCloud
					revoked.Revoked = true
					next.GatewayCloud = &revoked
					saveErr := config.Save(a.configPath, &next)
					a.cfg = &next
					a.controlBusinessRejected = true
					a.mu.Unlock()
					a.stopControlChannel()
					a.closeGatewaySessions(closure.BindingPublicID, closure.Generation)
					if saveErr != nil {
						a.log.Warn("Gateway revocation persistence failed")
						continue
					}
				}
				if !a.closeGatewaySessions(closure.BindingPublicID, closure.Generation) {
					continue
				}
				identity, identityErr := r.Identity()
				if identityErr != nil {
					continue
				}
				identity.BindingPublicID = closure.BindingPublicID
				identity.BindingGeneration = closure.Generation
				client, clientErr := r.Client()
				if clientErr != nil {
					continue
				}
				if _, err := client.Acknowledge(ctx, identity, gc.ClosureAck{ClosurePublicID: closure.PublicID, Generation: closure.Generation, Side: "runtime"}); err != nil && ctx.Err() == nil {
					a.log.Debug("Gateway closure acknowledgement pending")
				}
				client.Close()
			}
			if a.adoptGatewayReapproval(status) == nil {
				if a.recoverGatewayCredentials(ctx) == nil && a.remoteConfigSnapshot().ValidateRemoteStrict() == nil {
					a.startOrRestartControlChannel()
				}
			}
		}
		// A stopped controller may have no usable pool after an offline restart.
		// Recovery is separately authenticated; observing an outage is never a revoke.
		a.mu.Lock()
		done := a.controlLoopDone
		current := a.cfg.GatewayCloud
		recoverable := current != nil && current.Binding != nil && !current.Revoked
		a.mu.Unlock()
		if recoverable && controlLoopStopped(done) {
			if a.recoverGatewayCredentials(ctx) == nil && a.remoteConfigSnapshot().ValidateRemoteStrict() == nil {
				a.startOrRestartControlChannel()
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// A revoked controller is removed entirely. Reapproval must still retry when
// the authority is temporarily unavailable on its first recovery attempt.
func controlLoopStopped(done <-chan struct{}) bool {
	if done == nil {
		return true
	}
	select {
	case <-done:
		return true
	default:
		return false
	}
}

// Reapproval is a new explicit administrator decision for the same locally
// consented path. Old credential pools are retired before adopting its version.
func (a *Agent) adoptGatewayReapproval(status *gc.RuntimeStatus) error {
	a.gatewayRecoveryMu.Lock()
	defer a.gatewayRecoveryMu.Unlock()
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg == nil || a.cfg.GatewayCloud == nil || status == nil {
		return gatewaycloud.ErrState
	}
	current := a.cfg.GatewayCloud
	b := status.Candidate.Binding
	if !current.Revoked || current.Binding == nil || status.Candidate.State != "published" || status.Candidate.RequestPublicID != current.RequestPublicID || b == nil || b.State != "active" || b.PublicID != current.Binding.PublicID || b.EnvPublicID != current.Binding.EnvPublicID || b.Region != current.Binding.Region || b.GatewayPublicID != current.GatewayPublicID || b.NamespacePublicID != current.NamespacePublicID || b.RuntimePublicID != current.RuntimePublicID || b.Generation <= current.Binding.Generation {
		return gatewaycloud.ErrState
	}
	for _, session := range a.sessions {
		if session != nil && session.gatewayBindingPublicID == current.Binding.PublicID && session.gatewayBindingGeneration <= current.Binding.Generation {
			return gatewaycloud.ErrState
		}
	}
	updated := *a.cfg
	route := *current
	route.Binding, route.Revoked, route.PendingGenerationRenewal, route.DeliveryRequestID = b, false, false, ""
	updated.GatewayCloud, updated.BindingGeneration, updated.ControlArtifactPool, updated.Direct = &route, b.Generation, nil, nil
	if err := config.Save(a.configPath, &updated); err != nil {
		return err
	}
	a.cfg = &updated
	return nil
}

// platformHTTPTransport reads the current explicit route for every official AI request.
func (a *Agent) platformHTTPTransport() (http.RoundTripper, error) {
	proxy, err := gatewayProxy(a.remoteConfigSnapshot())
	if err != nil {
		return nil, err
	}
	if proxy == nil {
		return &http.Transport{ResponseHeaderTimeout: 5 * time.Minute, IdleConnTimeout: 60 * time.Second}, nil
	}
	transport := proxy.HTTPTransport()
	transport.ResponseHeaderTimeout = 5 * time.Minute
	return transport, nil
}

func (a *Agent) renewGatewayCertificate(ctx context.Context) error {
	a.gatewayRecoveryMu.Lock()
	defer a.gatewayRecoveryMu.Unlock()
	cfg := a.remoteConfigSnapshot()
	if cfg == nil || cfg.GatewayCloud == nil || cfg.GatewayCloud.Revoked {
		return gatewaycloud.ErrState
	}
	current := *cfg.GatewayCloud
	err := current.RenewCertificate(ctx, func(next *gatewaycloud.RuntimeConfig) error {
		a.mu.Lock()
		defer a.mu.Unlock()
		if a.cfg.GatewayCloud == nil || a.cfg.GatewayCloud.Revoked || a.cfg.GatewayCloud.RequestPublicID != next.RequestPublicID {
			return gatewaycloud.ErrState
		}
		updated := *a.cfg
		copy := *next
		updated.GatewayCloud = &copy
		if err := config.Save(a.configPath, &updated); err != nil {
			return err
		}
		a.cfg = &updated
		return nil
	})
	return err
}

func (a *Agent) rotateGatewayIdentity(ctx context.Context) error {
	a.gatewayRecoveryMu.Lock()
	defer a.gatewayRecoveryMu.Unlock()
	cfg := a.remoteConfigSnapshot()
	if cfg == nil || cfg.GatewayCloud == nil || cfg.GatewayCloud.Revoked {
		return gatewaycloud.ErrState
	}
	current := *cfg.GatewayCloud
	return current.RotateIdentity(ctx, func(next *gatewaycloud.RuntimeConfig) error {
		a.mu.Lock()
		defer a.mu.Unlock()
		if a.cfg.GatewayCloud == nil || a.cfg.GatewayCloud.Revoked || a.cfg.GatewayCloud.RequestPublicID != next.RequestPublicID {
			return gatewaycloud.ErrState
		}
		updated := *a.cfg
		identity := *next
		updated.GatewayCloud = &identity
		if err := config.Save(a.configPath, &updated); err != nil {
			return err
		}
		a.cfg = &updated
		return nil
	})
}

// The caller holds gatewayRecoveryMu through durable intent, authority update,
// and local adoption, including retries after a lost authority response.
func (a *Agent) finishGatewayGenerationRenewal(ctx context.Context, r *gatewaycloud.RuntimeConfig) error {
	binding, err := r.RenewGeneration(ctx)
	if err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg.GatewayCloud == nil || a.cfg.GatewayCloud.Revoked || a.cfg.GatewayCloud.Binding == nil || *a.cfg.GatewayCloud.Binding != *r.Binding {
		return gatewaycloud.ErrState
	}
	updated := *a.cfg
	next := *r
	next.Binding, next.DeliveryRequestID, next.PendingGenerationRenewal = binding, "", false
	updated.GatewayCloud, updated.BindingGeneration, updated.ControlArtifactPool, updated.Direct = &next, binding.Generation, nil, nil
	if err := config.Save(a.configPath, &updated); err != nil {
		return err
	}
	a.cfg = &updated
	return nil
}

// closeGatewaySessions leaves local access and newer generations running. A
// receipt is emitted only after canceled sessions have left the registry.
func (a *Agent) closeGatewaySessions(bindingID string, generation int64) bool {
	a.mu.Lock()
	pending := false
	var cancels []context.CancelFunc
	for _, session := range a.sessions {
		if session == nil || session.gatewayBindingPublicID != bindingID || session.gatewayBindingGeneration > generation {
			continue
		}
		pending = true
		if session.cancel != nil {
			cancels = append(cancels, session.cancel)
		}
	}
	a.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
	return !pending
}
