package agent

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaycloud"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

type gatewayStatusClient struct {
	key    [32]byte
	client *gatewaycloud.Client
	local  *gatewaymembership.EndpointClient
	public *gatewaymembership.EndpointClient
	ctx    context.Context
	cancel context.CancelFunc
}

// gatewayStatusClientKey includes every identity and transport fence, never
// mutable observations or artifact-pool state. The digest is never persisted.
func gatewayStatusClientKey(route *gatewaycloud.RuntimeConfig, member *gatewaymembership.RuntimeConfig) ([32]byte, bool) {
	if route == nil || member == nil || member.Leaving || member.PendingJoin != nil || route.ValidateMember(member) != nil {
		return [32]byte{}, false
	}
	value := struct {
		CloudOrigin, RegionOrigin, Namespace, Gateway, Runtime, Request, Key string
		Binding                                                              *gc.Binding
		Revoked                                                              bool
		MemberID                                                             string
		MemberVersion                                                        int64
		Endpoints                                                            []gp.GatewayEndpoint
		Root, Certificate, ClientKey                                         string
	}{route.CloudOrigin, route.RegionOrigin, route.NamespacePublicID, route.GatewayPublicID, route.RuntimePublicID, route.RequestPublicID, route.PrivateKeyB64u, route.Binding, route.Revoked, member.MemberID, member.MemberVersion, member.ConnectionEndpoints(), member.GatewayTLSRootPEM, member.ClientCertificatePEM, member.ClientPrivateKeyPEM}
	raw, err := json.Marshal(value)
	return sha256.Sum256(raw), err == nil
}

// setRemoteConfigLocked cancels an obsolete observer before exposing its new
// configuration. Connection mutations serialize on Agent.mu; persistence
// shares config's per-path lock with local settings mutations.
func (a *Agent) setRemoteConfigLocked(next *config.Config) {
	if cached := a.gatewayStatusClient; cached != nil {
		var key [32]byte
		var valid bool
		if next != nil {
			key, valid = gatewayStatusClientKey(next.GatewayPublication, next.CloudGateway())
		}
		if !valid || key != cached.key {
			cached.cancel()
			cached.close()
			a.gatewayStatusClient = nil
		}
	}
	a.cfg = next
}
func (a *Agent) closeGatewayStatusClient() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if cached := a.gatewayStatusClient; cached != nil {
		cached.cancel()
		cached.close()
		a.gatewayStatusClient = nil
	}
}
func (a *Agent) acquireGatewayStatusClient(ctx context.Context, route *gatewaycloud.RuntimeConfig, member *gatewaymembership.RuntimeConfig) (*gatewayStatusClient, error) {
	key, valid := gatewayStatusClientKey(route, member)
	if !valid {
		return nil, gatewaycloud.ErrState
	}
	a.mu.Lock()
	if a.cfg == nil {
		a.mu.Unlock()
		return nil, gatewaycloud.ErrState
	}
	current, valid := gatewayStatusClientKey(a.cfg.GatewayPublication, a.cfg.CloudGateway())
	if !valid || key != current {
		a.mu.Unlock()
		return nil, gatewaycloud.ErrState
	}
	cached := a.gatewayStatusClient
	if cached == nil || cached.key != key {
		if cached != nil {
			cached.cancel()
			cached.close()
		}
		public, err := gatewaymembership.NewEndpointClient(member, false)
		if err != nil {
			a.mu.Unlock()
			return nil, err
		}
		observation := *route
		observation.Revoked = false
		// Public closure observation remains available with expired credentials.
		// Authenticated callers below still fail closed if their client is absent.
		client, _ := observation.Client(member)
		local, _ := gatewaymembership.NewEndpointClient(member, true)
		parent := a.runCtx
		if parent == nil {
			parent = context.WithoutCancel(ctx)
		}
		lifetime, cancel := context.WithCancel(parent)
		cached = &gatewayStatusClient{key: key, client: client, local: local, public: public, ctx: lifetime, cancel: cancel}
		a.gatewayStatusClient = cached
	}
	a.mu.Unlock()
	return cached, nil
}
func (a *Agent) gatewayStatusPage(ctx context.Context, route *gatewaycloud.RuntimeConfig, member *gatewaymembership.RuntimeConfig, after string) (result *gc.RuntimeStatus, callErr error) {
	start := time.Now()
	defer func() {
		if a.gatewayStatusObserver != nil && ctx.Err() != context.Canceled {
			a.gatewayStatusObserver(time.Since(start), callErr)
		}
	}()
	if _, err := member.TLSConfig(true); err != nil {
		return nil, err
	}
	cached, err := a.acquireGatewayStatusClient(ctx, route, member)
	if err != nil {
		return nil, err
	}
	callCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	stop := context.AfterFunc(cached.ctx, cancel)
	defer stop()
	identity, err := route.Identity()
	if err != nil {
		return nil, err
	}
	// Closure observation remains available after revoke. It grants no recovery
	// or data-session access; the authority still consumes a fresh signed proof.
	identity.BindingPublicID, identity.BindingGeneration = "", 0
	if cached.client == nil {
		return nil, gatewaycloud.ErrState
	}
	return cached.client.RuntimeStatusPage(callCtx, identity, route.RequestPublicID, after)
}

func (c *gatewayStatusClient) close() { c.client.Close(); c.local.Close(); c.public.Close() }
func (a *Agent) gatewayMemberCloudContext(ctx context.Context, cfg *config.Config, out *gp.MemberCloudContext) error {
	if cfg.GatewayPublication == nil {
		return cfg.CloudGateway().Request(ctx, "/v5/member/cloud", gp.CatalogRequest{ProtocolVersion: gp.Version}, out, true)
	}
	cached, err := a.acquireGatewayStatusClient(ctx, cfg.GatewayPublication, cfg.CloudGateway())
	if err != nil {
		return err
	}
	callCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	stop := context.AfterFunc(cached.ctx, cancel)
	defer stop()
	if cached.local == nil {
		return gatewaymembership.ErrDenied
	}
	return cached.local.Request(callCtx, "/v5/member/cloud", gp.CatalogRequest{ProtocolVersion: gp.Version}, out)
}
func (a *Agent) gatewayClosureObservation(ctx context.Context, cfg *config.Config) (*gc.RuntimeClosureExchangeResponse, error) {
	cached, err := a.acquireGatewayStatusClient(ctx, cfg.GatewayPublication, cfg.CloudGateway())
	if err != nil {
		return nil, err
	}
	callCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	stop := context.AfterFunc(cached.ctx, cancel)
	defer stop()
	return cfg.GatewayPublication.ObserveClosureUsing(callCtx, cfg.CloudGateway(), cached.public)
}
