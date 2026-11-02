package agent

import (
	"context"
	"errors"
	"runtime"
	"sync"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

type gatewayMemberConnection struct {
	connection *gatewaymembership.RuntimeConnection
	cancel     context.CancelFunc
	done       chan struct{}
}
type gatewayMemberOwner struct {
	previews    map[string]gatewayPreview
	mu          sync.Mutex
	ctx         context.Context
	application func(string) gatewaymembership.RuntimeApplication
	connections map[string]*gatewayMemberConnection
}

func (a *Agent) GatewayAttachment(ids ...string) *gatewaymembership.RuntimeConfig {
	if a == nil {
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg == nil {
		return nil
	}
	if len(ids) > 0 {
		return a.cfg.RuntimeAttachment(ids[0]).Clone()
	}
	return a.cfg.RuntimeAttachment("").Clone()
}

func (a *Agent) persistRuntimeAttachmentFor(id string, member *gatewaymembership.RuntimeConfig) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg == nil {
		return gatewaymembership.ErrState
	}
	current := a.cfg.RuntimeAttachment(id)
	if current == nil || member == nil && !current.Leaving || member != nil && (current.AttachmentID != member.AttachmentID || current.GatewayID != member.GatewayID || current.Revision != member.Revision) {
		return gatewaymembership.ErrConflict
	}
	next := *a.cfg
	if member != nil {
		member = member.Clone()
		member.Revision++
	}
	next.SetRuntimeAttachment(id, member)
	if err := config.SaveConnection(a.configPath, &next); err != nil {
		return err
	}
	if !sameControlBinding(a.cfg, &next) && a.controlCancel != nil {
		a.controlCancel()
	}
	a.setRemoteConfigLocked(&next)
	return nil
}

func (a *Agent) persistRuntimeAttachment(member *gatewaymembership.RuntimeConfig) error {
	if member == nil {
		current := a.GatewayAttachment()
		if current == nil {
			return gatewaymembership.ErrConflict
		}
		return a.persistRuntimeAttachmentFor(current.GatewayID, nil)
	}
	id := member.GatewayID
	err := a.persistRuntimeAttachmentFor(id, member)
	if err == nil {
		member.Revision++
	}
	return err
}

// Each member has an independent published SDK reconnect controller.
func (a *Agent) StartGatewayAttachment(ctx context.Context, application func(string) gatewaymembership.RuntimeApplication) error {
	if a == nil {
		return nil
	}
	a.gatewayMember.mu.Lock()
	defer a.gatewayMember.mu.Unlock()
	a.gatewayMember.ctx, a.gatewayMember.application = ctx, application
	return a.startRuntimeAttachmentLocked()
}

func (a *Agent) startRuntimeAttachmentLocked() error {
	if a.gatewayMember.ctx == nil || a.gatewayMember.application == nil {
		return nil
	}
	if a.gatewayMember.connections == nil {
		a.gatewayMember.connections = map[string]*gatewayMemberConnection{}
	}
	cfg := a.remoteConfigSnapshot()
	if cfg == nil {
		return gatewaymembership.ErrState
	}
	application := a.gatewayMember.application
	for _, member := range cfg.Gateways {
		id := member.GatewayID
		if running := a.gatewayMember.connections[id]; running != nil {
			select {
			case <-running.done:
				delete(a.gatewayMember.connections, id)
			default:
				continue
			}
		}
		connection, err := gatewaymembership.NewRuntimeConnection(func() *gatewaymembership.RuntimeConfig { return a.GatewayAttachment(id) }, func(next *gatewaymembership.RuntimeConfig) error {
			err := a.persistRuntimeAttachmentFor(id, next)
			if err == nil && next != nil {
				next.Revision++
			}
			return err
		})
		if err != nil {
			return err
		}
		ctx, cancel := context.WithCancel(a.gatewayMember.ctx)
		running := &gatewayMemberConnection{connection: connection, cancel: cancel, done: make(chan struct{})}
		a.gatewayMember.connections[id] = running
		go func() { defer close(running.done); _ = connection.Run(ctx, application) }()
	}
	return nil
}

func (a *Agent) stopRuntimeAttachmentLocked(ids ...string) {
	for id, running := range a.gatewayMember.connections {
		if len(ids) > 0 && id != ids[0] {
			continue
		}
		running.cancel()
		<-running.done
		delete(a.gatewayMember.connections, id)
	}
}

func (a *Agent) updateGatewayEndpoints(invitation gp.EnrollmentDescriptor) error {
	a.stopRuntimeAttachmentLocked(invitation.GatewayID)
	member := a.GatewayAttachment(invitation.GatewayID)
	var err error
	if member == nil {
		err = gatewaymembership.ErrState
	} else if member.PendingEndpointUpdate == nil || member.PendingEndpointUpdate.InvitationID != invitation.InvitationID {
		member, err = member.PrepareConnectionEndpoints(invitation)
		if err == nil {
			err = a.persistRuntimeAttachment(member)
		}
	}
	// Repeated consent retains the staged request. Only the reconnect controller
	// owns its delivery, including response recovery and cancellation.
	restartErr := a.startRuntimeAttachmentLocked()
	if err != nil {
		return err
	}
	return restartErr
}

func (a *Agent) changeGateway(invitation gp.EnrollmentDescriptor, replace bool) error {
	a.mu.Lock()
	if a.cfg == nil {
		a.mu.Unlock()
		return gatewaymembership.ErrState
	}
	previous := a.cfg.CloudGateway().Clone()
	prepare := a.cfg.PrepareGatewayJoin
	if replace {
		prepare = a.cfg.PrepareGatewayReplacement
	}
	next, err := prepare(invitation, gp.MemberMetadata{Hostname: hostnameBestEffort(), OS: runtime.GOOS, Arch: runtime.GOARCH, Version: a.version})
	if err != nil {
		a.mu.Unlock()
		return err
	}
	if err = config.SaveConnection(a.configPath, next); err != nil {
		a.mu.Unlock()
		return err
	}
	a.setRemoteConfigLocked(next)
	a.mu.Unlock()
	if replace {
		a.stopRuntimeAttachmentLocked()
		if previous != nil {
			a.stopControlChannel()
		}
		if previous != nil && next.CloudRoute != nil {
			a.closeCloudRouteSessions(next.CloudRoute.Revision)
		}
	}
	return a.startRuntimeAttachmentLocked()
}

func (a *Agent) GatewayAttachmentStatus() gatewaymembership.AttachmentSnapshot {
	a.gatewayMember.mu.Lock()
	defer a.gatewayMember.mu.Unlock()
	cfg := a.remoteConfigSnapshot()
	if cfg == nil {
		return gatewaymembership.ObserveAttachments(nil, "", true, nil, time.Now())
	}
	connections := make(map[string]flowersec.ConnectionSnapshot, len(a.gatewayMember.connections))
	for id, running := range a.gatewayMember.connections {
		connections[id] = running.connection.Snapshot()
	}
	selected := ""
	if cfg.CloudRoute != nil && cfg.CloudRoute.Kind == config.CloudRouteGateway {
		selected = cfg.CloudRoute.AttachmentID
	}
	return gatewaymembership.ObserveAttachments(cfg.Gateways, selected, true, connections, time.Now())
}

func (a *Agent) RetryGatewayAttachment(ids ...string) error {
	a.gatewayMember.mu.Lock()
	defer a.gatewayMember.mu.Unlock()
	if len(ids) > 0 && ids[0] != "" && a.GatewayAttachment(ids[0]) == nil {
		return gatewaymembership.ErrState
	}
	for id, running := range a.gatewayMember.connections {
		if len(ids) == 0 || ids[0] == "" || ids[0] == id {
			running.connection.RetryNow()
		}
	}
	return a.startRuntimeAttachmentLocked()
}

func (a *Agent) CloseGatewayAttachment() {
	if a == nil {
		return
	}
	a.gatewayMember.mu.Lock()
	defer a.gatewayMember.mu.Unlock()
	a.stopRuntimeAttachmentLocked()
}

var ErrGatewayRouteImpactRequired = errors.New("GATEWAY_ROUTE_IMPACT_REQUIRED")

func (a *Agent) LeaveGateway(ids ...string) error {
	id := ""
	if len(ids) > 0 {
		id = ids[0]
	}
	return a.leaveGateway(id, true)
}
func (a *Agent) UnpairGateway(id string, routeImpactAcknowledged bool) error {
	return a.leaveGateway(id, routeImpactAcknowledged)
}
func (a *Agent) leaveGateway(id string, routeImpactAcknowledged bool) error {
	a.cloudLinkMu.Lock()
	defer a.cloudLinkMu.Unlock()
	a.gatewayMember.mu.Lock()
	defer a.gatewayMember.mu.Unlock()
	member := a.GatewayAttachment(id)
	if member == nil {
		if len(a.remoteConfigSnapshot().Gateways) == 0 {
			return nil
		}
		return gatewaymembership.ErrConflict
	}
	cfg := a.remoteConfigSnapshot()
	affected := cfg.CloudGateway() != nil && cfg.CloudGateway().AttachmentID == member.AttachmentID
	if affected && !routeImpactAcknowledged {
		return ErrGatewayRouteImpactRequired
	}
	a.stopRuntimeAttachmentLocked(member.GatewayID)
	if !member.Leaving {
		member.Leaving = true
		if err := a.persistRuntimeAttachment(member); err != nil {
			_ = a.startRuntimeAttachmentLocked()
			return err
		}
	}
	if affected {
		a.stopControlChannel()
		if cfg.CloudRoute != nil {
			a.closeCloudRouteSessions(cfg.CloudRoute.Revision)
		}
	}
	return a.startRuntimeAttachmentLocked()
}

// RuntimePublicID is the persistent local identity, independent of Cloud routes.
func (a *Agent) RuntimePublicID() string {
	if a == nil {
		return ""
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg == nil {
		return ""
	}
	return a.cfg.LocalEnvironmentPublicID
}
