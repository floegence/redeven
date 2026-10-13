package agent

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/runtimecloud"
	rc "github.com/floegence/redeven/internal/runtimecloud/protocol"
)

func (a *Agent) registerCloudClosureHandler(handlers *flowersec.RPCHandlers, owner *config.Config) error {
	return handlers.HandleRPC(rc.ControlRPCClosure, func(ctx context.Context, payload json.RawMessage) (any, *flowersec.RPCError) {
		var delivery rc.ClosureDelivery
		if err := decodeExactControlJSON(payload, &delivery); err != nil || !delivery.Valid() || delivery.Binding.EnvPublicID != owner.EnvironmentID || delivery.Binding.PublicID != cloudBinding(owner).PublicID || delivery.Binding.RuntimePublicID != owner.CloudAssociation.RuntimePublicID || delivery.Binding.NamespacePublicID != owner.CloudAssociation.NamespacePublicID || delivery.Binding.CloudID != owner.CloudAssociation.CloudID {
			return nil, &flowersec.RPCError{Code: 400, Message: "invalid Cloud closure"}
		}
		if err := a.applyCloudClosure(ctx, owner, delivery.Closure); err != nil {
			return nil, &flowersec.RPCError{Code: 409, Message: err.Error()}
		}
		return rc.ClosureAck{ClosurePublicID: delivery.Closure.PublicID, BindingPublicID: delivery.Closure.BindingPublicID, Generation: delivery.Closure.Generation}, nil
	})
}

// applyCloudClosure fences new grants before waiting for canceled sessions to
// leave the registry. The receipt is durable only after actual session closure.
func (a *Agent) applyCloudClosure(ctx context.Context, owner *config.Config, closure rc.Closure) error {
	if owner == nil || owner.CloudAssociation == nil || closure.RuntimePublicID != owner.CloudAssociation.RuntimePublicID || closure.BindingPublicID == "" || closure.PublicID == "" || closure.Generation < 1 || (owner.CloudAssociation.Binding != nil && closure.BindingPublicID != owner.CloudAssociation.Binding.PublicID) {
		return &runtimecloud.ProtocolError{Message: "Cloud closure identity mismatch"}
	}
	a.mu.Lock()
	if !sameCloudOwner(owner, a.cfg) {
		a.mu.Unlock()
		return errors.New("cloud connection owner changed")
	}
	if binding := a.cfg.CloudAssociation.Binding; binding != nil && closure.BindingPublicID == binding.PublicID && closure.Generation >= binding.Generation {
		a.cfg.CloudAssociation = a.cfg.CloudAssociation.Clone()
		a.cfg.CloudAssociation.ApprovalState, a.cfg.CloudAssociation.ReasonCode = rc.ApprovalRevoked, rc.ReasonRevoked
		a.cfg.ControlArtifactPool = nil
		a.controlBusinessRejected = true
	}
	a.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for !a.closeCloudSessions(closure.BindingPublicID, closure.Generation) {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-tick.C:
		}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if !sameCloudOwner(owner, a.cfg) {
		return errors.New("cloud connection owner changed")
	}
	next := *a.cfg
	next.CloudAssociation = next.CloudAssociation.Clone()
	receipt := rc.ClosureAck{ClosurePublicID: closure.PublicID, BindingPublicID: closure.BindingPublicID, Generation: closure.Generation}
	for _, pending := range next.CloudAssociation.ClosureOutbox {
		if pending == receipt {
			return config.SaveConnection(a.configPath, &next)
		}
	}
	if len(next.CloudAssociation.ClosureOutbox) >= 4096 {
		return errors.New("cloud closure receipt queue is full; retry after pending receipts are confirmed")
	}
	next.CloudAssociation.ClosureOutbox = append(next.CloudAssociation.ClosureOutbox, receipt)
	if err := config.SaveConnection(a.configPath, &next); err != nil {
		return err
	}
	a.setRemoteConfigLocked(&next)
	return nil
}

// Receipt delivery shares the established session's heartbeat schedule. An
// empty queue makes no HTTP request; unavailable delivery never drops receipts.
func (a *Agent) maintainCloudClosureOutbox(ctx context.Context, owner *config.Config, client **runtimecloud.Client) {
	current := a.remoteConfigSnapshot()
	if current == nil || current.CloudAssociation == nil || len(current.CloudAssociation.ClosureOutbox) == 0 || !sameCloudOwner(owner, current) {
		return
	}
	var err error
	if *client == nil {
		*client, err = runtimeCloudHTTPClient(current, a.controlTrustRoots)
	}
	if err == nil {
		callCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		err = a.flushCloudClosureOutbox(callCtx, owner, *client)
		cancel()
	}
	if err != nil && a.log != nil {
		a.log.Warn("Cloud closure receipts remain pending", "error", err)
	}
}
