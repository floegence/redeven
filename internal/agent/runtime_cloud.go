package agent

import (
	"context"
	"crypto/ed25519"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"net/http"
	"slices"
	"time"

	"github.com/floegence/flowersec/flowersec-go/v5/egress"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaymembership"
	"github.com/floegence/redeven/internal/runtimecloud"
	rc "github.com/floegence/redeven/internal/runtimecloud/protocol"
	"github.com/floegence/redeven/internal/runtimeservice"
)

// sameCloudOwner fences local intent and transport without confusing a new
// approved generation with a route change or a different connection owner.
func sameCloudOwner(left, right *config.Config) bool {
	return right != nil && right.CloudAssociation != nil && right.CloudAssociation.Enabled && sameCloudRouteOwner(left, right)
}

func sameCloudRouteOwner(left, right *config.Config) bool {
	if left == nil || right == nil || left.CloudAssociation == nil || right.CloudAssociation == nil || left.CloudRoute == nil || right.CloudRoute == nil {
		return false
	}
	a, b := left.CloudAssociation, right.CloudAssociation
	if a.Revision != b.Revision || a.Enabled != b.Enabled || a.CloudID != b.CloudID || a.CloudOrigin != b.CloudOrigin || a.NamespacePublicID != b.NamespacePublicID || a.RuntimePublicID != b.RuntimePublicID || a.PublicKeyB64u != b.PublicKeyB64u || *left.CloudRoute != *right.CloudRoute {
		return false
	}
	if right.CloudRoute.Kind == config.CloudRouteDirect {
		return true
	}
	lm, rm := left.CloudRouteMember(), right.CloudRouteMember()
	return lm != nil && rm != nil && !rm.Leaving && lm.MemberID == rm.MemberID && lm.MemberVersion == rm.MemberVersion && lm.GatewayID == rm.GatewayID && slices.Equal(lm.ConnectionEndpoints(), rm.ConnectionEndpoints()) && lm.GatewayTLSRootPEM == rm.GatewayTLSRootPEM && lm.ClientCertificatePEM == rm.ClientCertificatePEM && lm.ClientPrivateKeyPEM == rm.ClientPrivateKeyPEM
}

func runtimeCloudProxy(cfg *config.Config) (*egress.HTTPSProxy, error) {
	return cfg.CloudProxy()
}

func runtimeCloudHTTPClient(cfg *config.Config, roots *x509.CertPool) (*runtimecloud.Client, error) {
	proxy, err := runtimeCloudProxy(cfg)
	if err != nil {
		return nil, err
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if proxy != nil {
		transport = proxy.HTTPTransport()
	}
	transport.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: roots}
	transport.MaxIdleConns = 16
	transport.MaxIdleConnsPerHost = 4
	transport.MaxConnsPerHost = 8
	transport.IdleConnTimeout = 5 * time.Minute
	return runtimecloud.NewClient(cfg.CloudAssociation.CloudOrigin, transport)
}

// recoverRuntimeCloud runs only from Flowersec's credential source. Online
// heartbeats and reserve top-ups never start a parallel state observer.
func (a *Agent) recoverRuntimeCloud(ctx context.Context, owner *config.Config, client *runtimecloud.Client) (*rc.RecoverResponse, error) {
	a.mu.Lock()
	if !sameCloudOwner(owner, a.cfg) {
		a.mu.Unlock()
		return nil, errors.New("cloud connection owner changed")
	}
	next := *a.cfg
	association := next.CloudAssociation.Clone()
	next.CloudAssociation = association
	if association.DeliveryRequestID == "" {
		id, err := runtimecloud.NewOperationID()
		if err != nil {
			a.mu.Unlock()
			return nil, err
		}
		association.DeliveryRequestID = id
		if err := config.SaveConnection(a.configPath, &next); err != nil {
			a.mu.Unlock()
			return nil, err
		}
		a.setRemoteConfigLocked(&next)
	}
	a.mu.Unlock()
	key, err := association.Identity()
	if err != nil {
		return nil, err
	}
	bindingID := ""
	if association.Binding != nil {
		bindingID = association.Binding.PublicID
	}
	if err := a.flushCloudClosureOutbox(ctx, owner, client); err != nil && runtimecloud.Terminal(err) {
		return nil, err
	}
	var result *rc.RecoverResponse
	if !association.EnrollmentSubmitted && association.EnrollmentAuthorization != nil {
		var member *gatewaymembership.RuntimeConfig
		for _, candidate := range next.Gateways {
			if candidate.MemberID == association.EnrollmentAuthorization.MemberID {
				member = candidate
			}
		}
		if member == nil {
			return nil, errors.New("gateway enrollment member is unavailable")
		}
		memberKey, decodeErr := base64.RawURLEncoding.DecodeString(member.PrivateKeyB64u)
		if decodeErr != nil || len(memberKey) != ed25519.PrivateKeySize {
			return nil, errors.New("gateway enrollment member identity is invalid")
		}
		result, err = client.Enroll(ctx, association.NamespacePublicID, key, ed25519.PrivateKey(memberKey), rc.EnrollRequest{OperationID: association.EnrollmentOperationID, RuntimePublicID: association.RuntimePublicID, PublicKeyB64u: association.PublicKeyB64u, Authorization: *association.EnrollmentAuthorization, Metadata: association.EnrollmentMetadata})
	} else {
		result, err = client.Recover(ctx, association.NamespacePublicID, association.RuntimePublicID, bindingID, key, rc.RecoverRequest{RuntimePublicID: association.RuntimePublicID, BindingPublicID: bindingID, DeliveryRequestID: association.DeliveryRequestID})
	}

	if runtimecloud.DeliveryExpired(err) {
		a.mu.Lock()
		defer a.mu.Unlock()
		if !sameCloudOwner(owner, a.cfg) || a.cfg.CloudAssociation.DeliveryRequestID != association.DeliveryRequestID {
			return nil, errors.New("cloud delivery owner changed")
		}
		updated := *a.cfg
		updated.CloudAssociation = updated.CloudAssociation.Clone()
		id, generateErr := runtimecloud.NewOperationID()
		if generateErr != nil {
			return nil, generateErr
		}
		updated.CloudAssociation.DeliveryRequestID = id
		updated.CloudAssociation.EnrollmentSubmitted = true
		updated.CloudAssociation.EnrollmentAuthorization = nil
		if saveErr := config.SaveConnection(a.configPath, &updated); saveErr != nil {
			return nil, saveErr
		}
		a.setRemoteConfigLocked(&updated)
		return nil, err
	}
	if err != nil {
		return nil, err
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if result.State != rc.ApprovalApproved && association.Binding != nil {
		a.closeCloudSessions(bindingID, association.Binding.Generation)
	}
	seenCursors := map[string]bool{}
	for page := 0; ; page++ {
		for _, closure := range result.Closures {
			if err := a.applyCloudClosure(ctx, owner, closure); err != nil {
				return nil, err
			}
		}
		if result.NextClosureCursor == "" {
			break
		}
		if page >= 127 || seenCursors[result.NextClosureCursor] {
			return nil, &runtimecloud.ProtocolError{Message: "Cloud closure pagination did not advance"}
		}
		seenCursors[result.NextClosureCursor] = true
		previous := result
		result, err = client.Recover(ctx, association.NamespacePublicID, association.RuntimePublicID, bindingID, key, rc.RecoverRequest{ClosureAfter: result.NextClosureCursor, RuntimePublicID: association.RuntimePublicID, BindingPublicID: bindingID, DeliveryRequestID: association.DeliveryRequestID})
		if err != nil {
			return nil, err
		}
		if previous.Binding != nil && result.Binding != nil && (previous.Binding.PublicID != result.Binding.PublicID || previous.Binding.Generation > result.Binding.Generation) {
			return nil, &runtimecloud.ProtocolError{Message: "Cloud binding regressed during closure pagination"}
		}
	}
	if err := a.flushCloudClosureOutbox(ctx, owner, client); err != nil && runtimecloud.Terminal(err) {
		return nil, err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if !sameCloudOwner(owner, a.cfg) {
		return nil, errors.New("cloud connection owner changed")
	}
	updated := *a.cfg
	updated.CloudAssociation = updated.CloudAssociation.Clone()
	updated.CloudAssociation.ApprovalState, updated.CloudAssociation.ReasonCode = result.State, result.ReasonCode
	updated.CloudAssociation.EnrollmentSubmitted = true
	updated.CloudAssociation.EnrollmentAuthorization = nil
	if result.State == rc.ApprovalApproved {
		if err := updated.ApplyCloudDelivery(result.Delivery); err != nil {
			return nil, err
		}
	} else {
		updated.ControlArtifactPool = nil
		if result.Binding != nil {
			binding := *result.Binding
			updated.CloudAssociation.Binding = &binding
			updated.BindingGeneration = binding.Generation
		}
	}
	if err := config.SaveConnection(a.configPath, &updated); err != nil {
		// A known revocation takes effect even if the durable config cannot be
		// saved. The failed persistence remains visible; no old reserve is used.
		if result.State != rc.ApprovalApproved {
			a.cfg.ControlArtifactPool = nil
			a.controlBusinessRejected = true
		}
		return nil, err
	}
	a.setRemoteConfigLocked(&updated)
	a.controlBusinessRejected = result.State != rc.ApprovalApproved
	return result, nil
}

func cloudBinding(cfg *config.Config) rc.BindingFence {
	if cfg == nil || cfg.CloudAssociation == nil || cfg.CloudAssociation.Binding == nil {
		return rc.BindingFence{}
	}
	return cfg.CloudAssociation.Binding.BindingFence
}

// A terminal identity/protocol failure is an actionable local state. It never
// leaves an old reserve usable or starts another recovery loop.
func (a *Agent) recordCloudTerminal(owner *config.Config, cause error) {
	a.mu.Lock()
	if !sameCloudOwner(owner, a.cfg) {
		a.mu.Unlock()
		return
	}
	next := *a.cfg
	next.CloudAssociation = next.CloudAssociation.Clone()
	next.CloudAssociation.ApprovalState, next.CloudAssociation.ReasonCode = rc.ApprovalActionRequired, "PROTOCOL_ERROR"
	var remote *runtimecloud.Error
	if errors.As(cause, &remote) {
		next.CloudAssociation.ApprovalState, next.CloudAssociation.ReasonCode = rc.ApprovalIdentityRequired, remote.Code
	}
	next.ControlArtifactPool = nil
	a.controlBusinessRejected = true
	if err := config.SaveConnection(a.configPath, &next); err != nil && a.log != nil {
		a.log.Error("Cloud action required; configuration persistence failed", "reason_code", next.CloudAssociation.ReasonCode, "error", err)
	}
	a.setRemoteConfigLocked(&next)
	a.mu.Unlock()
	if owner.CloudAssociation.Binding != nil {
		a.closeCloudSessions(owner.CloudAssociation.Binding.PublicID, owner.CloudAssociation.Binding.Generation)
	}
}

// Receipts remain durable until the original identity confirms the exact
// closure. They may travel through a subsequently selected legal route.
func (a *Agent) flushCloudClosureOutbox(ctx context.Context, owner *config.Config, client *runtimecloud.Client) error {
	snapshot := a.remoteConfigSnapshot()
	if snapshot == nil || snapshot.CloudAssociation == nil {
		return errors.New("cloud association is unavailable")
	}
	for _, receipt := range snapshot.CloudAssociation.ClosureOutbox {
		if !sameCloudOwner(owner, a.remoteConfigSnapshot()) {
			return errors.New("cloud connection owner changed")
		}
		key, err := owner.CloudAssociation.Identity()
		if err != nil {
			return err
		}
		closed, err := client.Acknowledge(ctx, owner.CloudAssociation.NamespacePublicID, owner.CloudAssociation.RuntimePublicID, key, receipt)
		if err != nil {
			return err
		}
		if closed.PublicID != receipt.ClosurePublicID || closed.BindingPublicID != receipt.BindingPublicID || closed.Generation != receipt.Generation || closed.RuntimePublicID != owner.CloudAssociation.RuntimePublicID || !closed.RuntimeClosed {
			return &runtimecloud.ProtocolError{Message: "Cloud closure receipt mismatch"}
		}
		a.mu.Lock()
		if !sameCloudOwner(owner, a.cfg) {
			a.mu.Unlock()
			return errors.New("cloud connection owner changed")
		}
		next := *a.cfg
		next.CloudAssociation = next.CloudAssociation.Clone()
		remaining := next.CloudAssociation.ClosureOutbox[:0]
		for _, pending := range next.CloudAssociation.ClosureOutbox {
			if pending != receipt {
				remaining = append(remaining, pending)
			}
		}
		next.CloudAssociation.ClosureOutbox = remaining
		err = config.SaveConnection(a.configPath, &next)
		if err == nil {
			a.setRemoteConfigLocked(&next)
		}
		a.mu.Unlock()
		if err != nil {
			return err
		}
	}
	return nil
}

// Local intent is stopped even when Cloud is unreachable. No detach or new
// identity is inferred from a network failure, and pending receipts survive.
// cloudLinkMu is held by the single operation coordinator.
func (a *Agent) disconnectCloudAssociation(ctx context.Context) (*CloudLinkResponse, error) {
	if ctx != nil && ctx.Err() != nil {
		return nil, ctx.Err()
	}
	before := a.remoteConfigSnapshot()
	if before == nil || before.CloudAssociation == nil || before.CloudRoute == nil {
		return nil, errors.New("cloud association is unavailable")
	}
	if !before.CloudAssociation.Enabled {
		return &CloudLinkResponse{Binding: a.CloudLinkBinding()}, nil
	}
	next, err := config.Update(a.configPath, func(current *config.Config) error {
		if !sameCloudOwner(before, current) {
			return config.ErrCloudRouteConflict
		}
		current.CloudAssociation = current.CloudAssociation.Clone()
		current.CloudAssociation.Enabled = false
		current.CloudAssociation.Revision++
		current.ControlArtifactPool = nil
		return nil
	})
	if err != nil {
		return nil, err
	}
	a.mu.Lock()
	a.setRemoteConfigLocked(next)
	a.controlChannelEnabled, a.remoteEnabled, a.effectiveRunMode = false, false, "local"
	a.mu.Unlock()
	a.stopControlChannel()
	a.closeCloudRouteSessions(before.CloudRoute.Revision)
	return &CloudLinkResponse{Binding: runtimeservice.CloudLinkBinding{State: runtimeservice.CloudLinkStateUnbound, LastDisconnectedAtUnixMS: time.Now().UnixMilli()}}, nil
}

// RetryCloud changes only local intent and starts the sole control owner.
// Reapproval remains a Cloud decision; a local retry cannot restore authority.
func (a *Agent) RetryCloud(ctx context.Context, expectedRevision int64) (*rc.Status, error) {
	a.cloudLinkMu.Lock()
	defer a.cloudLinkMu.Unlock()
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	next, err := config.Update(a.configPath, func(current *config.Config) error {
		if current.CloudAssociation == nil || current.CloudAssociation.Revision != expectedRevision || expectedRevision == 1<<63-1 {
			return config.ErrCloudRouteConflict
		}
		if err := current.ValidateCloudRoute(); err != nil {
			return err
		}
		current.CloudAssociation = current.CloudAssociation.Clone()
		current.CloudAssociation.Enabled = true
		current.CloudAssociation.Revision++
		return nil
	})
	if err != nil {
		return nil, err
	}
	a.mu.Lock()
	a.setRemoteConfigLocked(next)
	a.controlChannelEnabled, a.remoteEnabled, a.effectiveRunMode = true, true, "hybrid"
	running := a.runCtx != nil
	a.mu.Unlock()
	if running {
		a.startOrRestartControlChannel()
	}
	return a.CloudLinkBinding().Cloud, nil
}
