package agent

import (
	"context"
	"runtime"
	"sync"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

type gatewayMemberOwner struct {
	mu          sync.Mutex
	ctx         context.Context
	application func(string) gatewaymembership.RuntimeApplication
	connection  *gatewaymembership.RuntimeConnection
	cancel      context.CancelFunc
	done        chan struct{}
}

func (a *Agent) GatewayMembership() *gatewaymembership.RuntimeConfig {
	if a == nil {
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg == nil {
		return nil
	}
	return a.cfg.Gateway.Clone()
}

func (a *Agent) persistGatewayMember(member *gatewaymembership.RuntimeConfig) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if member == nil && a.cfg != nil && a.cfg.Gateway != nil && a.cfg.Gateway.Leaving {
		next := *a.cfg
		if err := next.RetireGatewayPublication(); err != nil {
			return err
		}
		next.Gateway = nil
		if err := config.Save(a.configPath, &next); err != nil {
			return err
		}
		a.cfg = &next
		return nil
	}
	if a.cfg == nil || a.cfg.Gateway == nil || member == nil || a.cfg.Gateway.MemberID != member.MemberID || a.cfg.Gateway.GatewayID != member.GatewayID || a.cfg.Gateway.Revision != member.Revision {
		return gatewaymembership.ErrConflict
	}
	next := *a.cfg
	next.Gateway = member.Clone()
	if member.Leaving {
		if err := next.RetireGatewayPublication(); err != nil {
			return err
		}
	}
	next.Gateway.Revision++
	if err := config.Save(a.configPath, &next); err != nil {
		return err
	}
	if !sameControlBinding(a.cfg, &next) && a.controlCancel != nil {
		// The controller owns an immutable proxy. Its existing lifecycle observer
		// restarts it from the saved configuration without closing data sessions.
		a.controlCancel()
	}
	a.cfg = &next
	member.Revision = next.Gateway.Revision
	return nil
}

// StartGatewayMembership attaches the public application handler once. The SDK
// controller owns reconnection; this owner changes only on explicit membership edits.
func (a *Agent) StartGatewayMembership(ctx context.Context, application func(string) gatewaymembership.RuntimeApplication) error {
	if a == nil {
		return nil
	}
	a.gatewayMember.mu.Lock()
	defer a.gatewayMember.mu.Unlock()
	a.gatewayMember.ctx, a.gatewayMember.application = ctx, application
	return a.startGatewayMemberLocked()
}

func (a *Agent) startGatewayMemberLocked() error {
	if a.gatewayMember.ctx == nil || a.gatewayMember.application == nil || a.GatewayMembership() == nil {
		return nil
	}
	if a.gatewayMember.connection != nil {
		select {
		case <-a.gatewayMember.done:
			a.gatewayMember.connection = nil
		default:
			a.gatewayMember.connection.RetryNow()
			return nil
		}
	}
	connection, err := gatewaymembership.NewRuntimeConnection(a.GatewayMembership, a.persistGatewayMember)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(a.gatewayMember.ctx)
	done := make(chan struct{})
	a.gatewayMember.connection, a.gatewayMember.cancel, a.gatewayMember.done = connection, cancel, done
	application := a.gatewayMember.application
	go func() { defer close(done); _ = connection.Run(ctx, application) }()
	return nil
}

func (a *Agent) JoinGateway(invitation gp.MemberInvitation, choice string) error {
	return a.changeGateway(invitation, choice, false)
}
func (a *Agent) ReplaceGateway(invitation gp.MemberInvitation, choice string) error {
	return a.changeGateway(invitation, choice, true)
}

func (a *Agent) UpdateGatewayEndpoints(invitation gp.MemberInvitation) error {
	a.gatewayMember.mu.Lock()
	defer a.gatewayMember.mu.Unlock()
	// Join the credential writer before taking its current revision.
	a.stopGatewayMemberLocked()
	member, err := a.GatewayMembership().PrepareConnectionEndpoints(invitation)
	if err == nil {
		err = a.persistGatewayMember(member)
	}
	restartErr := a.startGatewayMemberLocked()
	if err != nil {
		return err
	}
	return restartErr
}
func (a *Agent) changeGateway(invitation gp.MemberInvitation, choice string, replace bool) error {
	a.cloudLinkMu.Lock()
	defer a.cloudLinkMu.Unlock()
	a.gatewayMember.mu.Lock()
	defer a.gatewayMember.mu.Unlock()
	a.mu.Lock()
	if a.cfg == nil {
		a.mu.Unlock()
		return gatewaymembership.ErrState
	}
	previous := a.cfg.GatewayPublication.Clone()
	prepare := a.cfg.PrepareGatewayJoin
	if replace {
		prepare = a.cfg.PrepareGatewayReplacement
	}
	next, err := prepare(invitation, gp.MemberMetadata{Hostname: hostnameBestEffort(), OS: runtime.GOOS, Arch: runtime.GOARCH, Version: a.version}, choice)
	if err != nil {
		a.mu.Unlock()
		return err
	}
	if err := config.Save(a.configPath, next); err != nil {
		a.mu.Unlock()
		return err
	}
	a.cfg = next
	a.mu.Unlock()
	a.stopControlChannel()
	if replace {
		a.stopGatewayMemberLocked()
		if previous != nil && previous.Binding != nil {
			a.closeGatewaySessions(previous.Binding.PublicID, previous.Binding.Generation)
		}
	}
	return a.startGatewayMemberLocked()
}

type GatewayMembershipStatus struct {
	PublicationErrorCode  string               `json:"publication_error_code,omitempty"`
	Joined                bool                 `json:"joined"`
	GatewayID             string               `json:"gateway_id,omitempty"`
	Endpoints             []gp.GatewayEndpoint `json:"endpoints,omitempty"`
	LastEndpointID        string               `json:"last_endpoint_id,omitempty"`
	MemberID              string               `json:"member_id,omitempty"`
	Phase                 string               `json:"phase"`
	ExistingEnvironmentID string               `json:"existing_environment_id,omitempty"`
	RejoinRequired        bool                 `json:"rejoin_required,omitempty"`
}

func (a *Agent) GatewayMembershipStatus() GatewayMembershipStatus {
	a.gatewayMember.mu.Lock()
	defer a.gatewayMember.mu.Unlock()
	member := a.GatewayMembership()
	if member == nil {
		cfg := a.remoteConfigSnapshot()
		return GatewayMembershipStatus{Phase: "not_joined", ExistingEnvironmentID: cfg.EnvironmentID, RejoinRequired: cfg.GatewayRejoinRequired}
	}
	status := GatewayMembershipStatus{Joined: true, GatewayID: member.GatewayID, Endpoints: member.ConnectionEndpoints(), LastEndpointID: member.LastEndpointID, MemberID: member.MemberID, Phase: "gateway_offline", ExistingEnvironmentID: a.remoteConfigSnapshot().EnvironmentID}
	if member.PendingJoin != nil {
		status.Phase = "joining"
	}
	if member.Leaving {
		status.Phase = "removal_pending"
		return status
	}
	if a.gatewayMember.connection != nil {
		switch a.gatewayMember.connection.Snapshot().State {
		case flowersec.ConnectionConnected:
			status.Phase = "joined"
			a.mu.Lock()
			if a.cfg.GatewayPublication != nil {
				route := a.cfg.GatewayPublication
				switch {
				case route.Revoked:
					status.Phase = "cloud_denied"
				case route.Binding == nil:
					status.Phase = "cloud_pending"
				case a.controlRegistered:
					status.Phase = "accessible"
				default:
					status.Phase = "cloud_control_offline"
				}
			}
			if a.cfg.GatewayEnvironmentChoice == "preserve" && (a.cfg.GatewayPublication == nil || a.cfg.GatewayPublication.Binding == nil) {
				status.Phase = "migration_pending"
			}
			if a.gatewayCloudMemberID == member.MemberID {
				status.PublicationErrorCode = a.gatewayCloudError
				switch a.gatewayCloudState {
				case "cloud_denied", "unpublished":
					status.Phase = "cloud_denied"
				case "cloud_approval_required":
					status.Phase = "cloud_pending"
				case "awaiting_cloud_approval":
					if status.Phase == "joined" {
						status.Phase = "cloud_pending"
					}
				}
			}
			a.mu.Unlock()
		case flowersec.ConnectionFailed:
			status.Phase = "reauthorization_required"
		}
	}
	return status
}

func (a *Agent) RetryGatewayMembership() error {
	a.gatewayMember.mu.Lock()
	defer a.gatewayMember.mu.Unlock()
	return a.startGatewayMemberLocked()
}

// CloseGatewayMembership joins the connection owner before Local UI releases
// application state. No reverse stream can outlive its public handler.
func (a *Agent) CloseGatewayMembership() {
	if a == nil {
		return
	}
	a.gatewayMember.mu.Lock()
	defer a.gatewayMember.mu.Unlock()
	a.stopGatewayMemberLocked()
}

func (a *Agent) stopGatewayMemberLocked() {
	if a.gatewayMember.cancel != nil {
		a.gatewayMember.cancel()
		<-a.gatewayMember.done
	}
	a.gatewayMember.connection, a.gatewayMember.cancel, a.gatewayMember.done = nil, nil, nil
}

func (a *Agent) LeaveGateway() error {
	a.gatewayMember.mu.Lock()
	defer a.gatewayMember.mu.Unlock()
	// Join the previous writer before reading its final revision. Rotation or
	// one-time ticket spending must not race with the durable leaving intent.
	a.stopGatewayMemberLocked()
	member := a.GatewayMembership()
	if member == nil {
		return nil
	}
	publication := a.remoteConfigSnapshot().GatewayPublication
	if !member.Leaving {
		member.Leaving = true
		if err := a.persistGatewayMember(member); err != nil {
			_ = a.startGatewayMemberLocked()
			return err
		}
	}
	a.stopControlChannel()
	if publication != nil && publication.Binding != nil {
		a.closeGatewaySessions(publication.Binding.PublicID, publication.Binding.Generation)
	}
	// Fence local reverse access before starting the durable removal delivery.
	return a.startGatewayMemberLocked()
}
