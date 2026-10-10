package agent

import (
	"context"
	"errors"
	"runtime"
	"sync"

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

func (a *Agent) GatewayMembership(ids ...string) *gatewaymembership.RuntimeConfig {
	if a == nil {
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg == nil {
		return nil
	}
	if len(ids) > 0 {
		return a.cfg.GatewayMember(ids[0]).Clone()
	}
	if member := a.cfg.CloudGateway(); member != nil {
		return member.Clone()
	}
	return a.cfg.GatewayMember("").Clone()
}

func (a *Agent) persistGatewayMemberFor(id string, member *gatewaymembership.RuntimeConfig) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg == nil {
		return gatewaymembership.ErrState
	}
	current := a.cfg.GatewayMember(id)
	if current == nil || member == nil && !current.Leaving || member != nil && (current.MemberID != member.MemberID || current.GatewayID != member.GatewayID || current.Revision != member.Revision) {
		return gatewaymembership.ErrConflict
	}
	next := *a.cfg
	if (member == nil || member.Leaving) && a.cfg.CloudGateway() != nil && a.cfg.CloudGateway().GatewayID == id {
		if err := next.RetireGatewayPublication(); err != nil {
			return err
		}
		next.GatewayCloudMemberID = ""
	}
	if member != nil {
		member = member.Clone()
		member.Revision++
	}
	next.SetGatewayMember(id, member)
	if err := config.Save(a.configPath, &next); err != nil {
		return err
	}
	if !sameControlBinding(a.cfg, &next) && a.controlCancel != nil {
		a.controlCancel()
	}
	a.cfg = &next
	return nil
}

func (a *Agent) persistGatewayMember(member *gatewaymembership.RuntimeConfig) error {
	if member == nil {
		current := a.GatewayMembership()
		if current == nil {
			return gatewaymembership.ErrConflict
		}
		return a.persistGatewayMemberFor(current.GatewayID, nil)
	}
	id := member.GatewayID
	err := a.persistGatewayMemberFor(id, member)
	if err == nil {
		member.Revision++
	}
	return err
}

// Each member has an independent published SDK reconnect controller.
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
		connection, err := gatewaymembership.NewRuntimeConnection(func() *gatewaymembership.RuntimeConfig { return a.GatewayMembership(id) }, func(next *gatewaymembership.RuntimeConfig) error {
			err := a.persistGatewayMemberFor(id, next)
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

func (a *Agent) stopGatewayMemberLocked(ids ...string) {
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
	a.stopGatewayMemberLocked(invitation.GatewayID)
	member := a.GatewayMembership(invitation.GatewayID)
	var err error
	if member == nil {
		err = gatewaymembership.ErrState
	} else if member.PendingEndpointUpdate == nil || member.PendingEndpointUpdate.InvitationID != invitation.InvitationID {
		member, err = member.PrepareConnectionEndpoints(invitation)
		if err == nil {
			err = a.persistGatewayMember(member)
		}
	}
	// Repeated consent retains the staged request. Only the reconnect controller
	// owns its delivery, including response recovery and cancellation.
	restartErr := a.startGatewayMemberLocked()
	if err != nil {
		return err
	}
	return restartErr
}

func (a *Agent) changeGateway(invitation gp.EnrollmentDescriptor, choice string, replace bool) error {
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
	next, err := prepare(invitation, gp.MemberMetadata{Hostname: hostnameBestEffort(), OS: runtime.GOOS, Arch: runtime.GOARCH, Version: a.version}, choice)
	if err != nil {
		a.mu.Unlock()
		return err
	}
	if err = config.Save(a.configPath, next); err != nil {
		a.mu.Unlock()
		return err
	}
	publication := a.cfg.GatewayPublication.Clone()
	a.cfg = next
	a.mu.Unlock()
	if replace {
		a.stopGatewayMemberLocked()
		if previous != nil {
			a.stopControlChannel()
		}
		if publication != nil && publication.Binding != nil {
			a.closeGatewaySessions(publication.Binding.PublicID, publication.Binding.Generation)
		}
	}
	return a.startGatewayMemberLocked()
}

type GatewayMembershipStatus struct {
	Joined                bool                      `json:"joined"`
	GatewayID             string                    `json:"gateway_id,omitempty"`
	GatewayName           string                    `json:"gateway_name,omitempty"`
	Endpoints             []gp.GatewayEndpoint      `json:"endpoints,omitempty"`
	LastEndpointID        string                    `json:"last_endpoint_id,omitempty"`
	MemberID              string                    `json:"member_id,omitempty"`
	Phase                 string                    `json:"phase"`
	ExistingEnvironmentID string                    `json:"existing_environment_id,omitempty"`
	RejoinRequired        bool                      `json:"rejoin_required,omitempty"`
	PublicationErrorCode  string                    `json:"publication_error_code,omitempty"`
	CloudPublication      bool                      `json:"cloud_publication,omitempty"`
	Memberships           []GatewayMembershipStatus `json:"memberships,omitempty"`
}

func (a *Agent) GatewayMembershipStatus() GatewayMembershipStatus {
	a.gatewayMember.mu.Lock()
	defer a.gatewayMember.mu.Unlock()
	cfg := a.remoteConfigSnapshot()
	if cfg == nil {
		return GatewayMembershipStatus{Phase: "not_joined"}
	}
	out := GatewayMembershipStatus{Phase: "not_joined", ExistingEnvironmentID: cfg.EnvironmentID, RejoinRequired: cfg.GatewayRejoinRequired}
	for _, member := range cfg.Gateways {
		status := GatewayMembershipStatus{Joined: true, GatewayID: member.GatewayID, GatewayName: member.GatewayName, Endpoints: member.ConnectionEndpoints(), LastEndpointID: member.LastEndpointID, MemberID: member.MemberID, Phase: "gateway_offline"}
		if member.PendingJoin != nil {
			status.Phase = "joining"
		}
		if member.Leaving {
			status.Phase = "removal_pending"
		} else if running := a.gatewayMember.connections[member.GatewayID]; running != nil {
			switch running.connection.Snapshot().State {
			case flowersec.ConnectionConnected:
				status.Phase = "joined"
			case flowersec.ConnectionFailed:
				status.Phase = "reauthorization_required"
			}
		}
		status.CloudPublication = cfg.CloudGateway() != nil && cfg.CloudGateway().MemberID == member.MemberID
		if status.CloudPublication && status.Phase == "joined" {
			a.mu.Lock()
			route := a.cfg.GatewayPublication
			if route != nil {
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
			if a.cfg.GatewayEnvironmentChoice == "preserve" && (route == nil || route.Binding == nil) {
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
		}
		out.Memberships = append(out.Memberships, status)
	}
	if len(out.Memberships) > 0 {
		out.Joined = true
		out.Phase = "joined"
	}
	if len(out.Memberships) == 1 {
		members := out.Memberships
		out = members[0]
		out.Memberships = members
		out.ExistingEnvironmentID = cfg.EnvironmentID
	}
	return out
}

func (a *Agent) RetryGatewayMembership(ids ...string) error {
	a.gatewayMember.mu.Lock()
	defer a.gatewayMember.mu.Unlock()
	if len(ids) > 0 && ids[0] != "" && a.GatewayMembership(ids[0]) == nil {
		return gatewaymembership.ErrState
	}
	for id, running := range a.gatewayMember.connections {
		if len(ids) == 0 || ids[0] == "" || ids[0] == id {
			running.connection.RetryNow()
		}
	}
	return a.startGatewayMemberLocked()
}

func (a *Agent) CloseGatewayMembership() {
	if a == nil {
		return
	}
	a.gatewayMember.mu.Lock()
	defer a.gatewayMember.mu.Unlock()
	a.stopGatewayMemberLocked()
}

var ErrGatewayCloudImpactRequired = errors.New("GATEWAY_CLOUD_IMPACT_REQUIRED")

func (a *Agent) LeaveGateway(ids ...string) error {
	id := ""
	if len(ids) > 0 {
		id = ids[0]
	}
	return a.leaveGateway(id, true)
}
func (a *Agent) UnpairGateway(id string, cloudImpactAcknowledged bool) error {
	return a.leaveGateway(id, cloudImpactAcknowledged)
}
func (a *Agent) leaveGateway(id string, cloudImpactAcknowledged bool) error {
	a.cloudLinkMu.Lock()
	defer a.cloudLinkMu.Unlock()
	a.gatewayMember.mu.Lock()
	defer a.gatewayMember.mu.Unlock()
	member := a.GatewayMembership(id)
	if member == nil {
		if len(a.remoteConfigSnapshot().Gateways) == 0 {
			return nil
		}
		return gatewaymembership.ErrConflict
	}
	cfg := a.remoteConfigSnapshot()
	affected := cfg.CloudGateway() != nil && cfg.CloudGateway().MemberID == member.MemberID
	if affected && !cloudImpactAcknowledged {
		return ErrGatewayCloudImpactRequired
	}
	a.stopGatewayMemberLocked(member.GatewayID)
	if !member.Leaving {
		member.Leaving = true
		if err := a.persistGatewayMember(member); err != nil {
			_ = a.startGatewayMemberLocked()
			return err
		}
	}
	if affected {
		a.stopControlChannel()
		if cfg.GatewayPublication != nil && cfg.GatewayPublication.Binding != nil {
			a.closeGatewaySessions(cfg.GatewayPublication.Binding.PublicID, cfg.GatewayPublication.Binding.Generation)
		}
	}
	return a.startGatewayMemberLocked()
}

func (a *Agent) PublishGateway(gatewayID, choice string) error {
	a.cloudLinkMu.Lock()
	defer a.cloudLinkMu.Unlock()
	a.mu.Lock()
	defer a.mu.Unlock()
	next, err := a.cfg.PrepareGatewayPublication(gatewayID, choice)
	if err != nil {
		return err
	}
	if err = config.Save(a.configPath, next); err != nil {
		return err
	}
	a.cfg = next
	if a.controlCancel != nil {
		a.controlCancel()
	}
	return nil
}
