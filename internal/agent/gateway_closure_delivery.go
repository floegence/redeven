package agent

import (
	"context"
	"slices"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaycloud"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/gatewaymembership"
)

// observeGatewayClosure remains reachable after member revocation. The relay
// returns no access authority, and session closure is still confirmed locally.
func (a *Agent) observeGatewayClosure(ctx context.Context) {
	cfg := a.remoteConfigSnapshot()
	if cfg == nil || cfg.GatewayPublication == nil || cfg.GatewayPublication.Binding == nil || cfg.Gateway == nil || cfg.Gateway.Leaving {
		return
	}
	route := cfg.GatewayPublication
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	result, err := route.ObserveClosure(ctx, cfg.Gateway)
	if err != nil || result.Closure == nil {
		return
	}
	a.mu.Lock()
	if a.cfg.GatewayPublication == nil || a.cfg.GatewayPublication.Fence() == nil || *a.cfg.GatewayPublication.Fence() != *route.Fence() {
		a.mu.Unlock()
		return
	}
	next := *a.cfg
	next.GatewayPublication = next.GatewayPublication.Clone()
	next.GatewayPublication.Revoked = true
	next.ControlArtifactPool, next.Direct = nil, nil
	// Fence this process even when the outbox is full or the disk is unavailable.
	// No receipt can be sent until the exact revoked state is persisted later.
	err = next.QueueGatewayClosure()
	if err == nil {
		err = config.Save(a.configPath, &next)
	}
	a.cfg = &next
	if err != nil {
		a.controlBusinessRejected = true
	}
	a.mu.Unlock()
	a.stopControlChannel()
	a.closeGatewaySessions(route.Binding.PublicID, route.Binding.Generation)
}

func (a *Agent) saveGatewayClosure(fence gc.BindingFence, update *gatewaycloud.ClosureDelivery) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	next := *a.cfg
	next.GatewayClosureOutbox = append([]gatewaycloud.ClosureDelivery(nil), a.cfg.GatewayClosureOutbox...)
	found := -1
	for i, item := range next.GatewayClosureOutbox {
		if item.Receipt.Binding == fence {
			found = i
			break
		}
	}
	if found < 0 {
		return gatewaycloud.ErrState
	}
	if update == nil {
		next.GatewayClosureOutbox = append(next.GatewayClosureOutbox[:found], next.GatewayClosureOutbox[found+1:]...)
	} else {
		next.GatewayClosureOutbox[found] = update.Clone()
	}
	if err := config.Save(a.configPath, &next); err != nil {
		return err
	}
	a.cfg = &next
	return nil
}

// Drain one item per observation cycle. Rotating the cursor prevents an offline
// old Gateway from blocking receipts belonging to another retired path.
func (a *Agent) drainGatewayClosure(ctx context.Context, cursor int) int {
	a.mu.Lock()
	if a.cfg == nil || len(a.cfg.GatewayClosureOutbox) == 0 {
		a.mu.Unlock()
		return 0
	}
	index := cursor % len(a.cfg.GatewayClosureOutbox)
	item := a.cfg.GatewayClosureOutbox[index].Clone()
	a.mu.Unlock()
	fence := item.Receipt.Binding
	if item.Evidence != nil {
		// The current generation must already be retired, even when the registry is empty.
		cfg := a.remoteConfigSnapshot()
		if current := cfg.GatewayPublication; current != nil && current.Fence() != nil && *current.Fence() == fence && !current.Revoked {
			return index + 1
		}
		if !a.closeGatewaySessions(fence.PublicID, fence.Generation) {
			return index + 1
		}
		if item.Seal(time.Now()) != nil || a.saveGatewayClosure(fence, &item) != nil {
			return index + 1
		}
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	result, err := item.Deliver(ctx)
	if err != nil || !result.Accepted {
		return index + 1
	}
	if a.saveGatewayClosure(fence, nil) != nil {
		return index + 1
	}
	return index
}

func (a *Agent) drainGatewayRemoval(ctx context.Context, cursor int) int {
	a.mu.Lock()
	if a.cfg == nil || len(a.cfg.GatewayRemovalOutbox) == 0 {
		a.mu.Unlock()
		return 0
	}
	index := cursor % len(a.cfg.GatewayRemovalOutbox)
	item := a.cfg.GatewayRemovalOutbox[index]
	a.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if item.Deliver(ctx) != nil {
		return index + 1
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	next := *a.cfg
	next.GatewayRemovalOutbox = append([]gatewaymembership.RemovalDelivery(nil), a.cfg.GatewayRemovalOutbox...)
	for i, current := range next.GatewayRemovalOutbox {
		if current.MemberID == item.MemberID && slices.Equal(current.GatewayEndpoints, item.GatewayEndpoints) {
			next.GatewayRemovalOutbox = append(next.GatewayRemovalOutbox[:i], next.GatewayRemovalOutbox[i+1:]...)
			if config.Save(a.configPath, &next) == nil {
				a.cfg = &next
			}
			break
		}
	}
	return index
}
