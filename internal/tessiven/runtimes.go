package tessiven

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/gatewayhost"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/session"
)

// RuntimeTarget describes one exact access path. Identity is an observed fact,
// never a permission or a reason to silently select another path.
type RuntimeTarget struct {
	RuntimeRef    string   `json:"runtime_ref"`
	Generation    string   `json:"generation"`
	Identity      string   `json:"identity,omitempty"`
	Name          string   `json:"name"`
	Source        string   `json:"source"`
	Location      string   `json:"location"`
	ObservedAt    string   `json:"observed_at"`
	Registered    bool     `json:"registered"`
	Online        *bool    `json:"online"`
	Connected     bool     `json:"connected"`
	Authenticated *bool    `json:"authenticated"`
	Actions       []string `json:"actions"`
	Reason        string   `json:"reason,omitempty"`
}
type RuntimeSource struct {
	Name     string `json:"name,omitempty"`
	Source   string `json:"source"`
	Location string `json:"location"`
	State    string `json:"state"`
	Reason   string `json:"reason,omitempty"`
}
type RuntimeDirectory struct {
	Targets []RuntimeTarget `json:"targets"`
	Sources []RuntimeSource `json:"sources"`
}
type RuntimeRequest struct {
	RuntimeRef  string `json:"runtime_ref"`
	Generation  string `json:"generation"`
	Identity    string `json:"identity,omitempty"`
	Action      string `json:"action"`
	RequestID   string `json:"request_id,omitempty"`
	OperationID string `json:"operation_id,omitempty"`
}
type RuntimeResult struct {
	RuntimeRef  string              `json:"runtime_ref"`
	Target      *RuntimeTarget      `json:"target,omitempty"`
	Status      string              `json:"status"`
	OperationID string              `json:"operation_id,omitempty"`
	Operation   any                 `json:"operation,omitempty"`
	Diagnostics *RuntimeDiagnostics `json:"diagnostics,omitempty"`
}

type RuntimeDiagnostics struct {
	RuntimeVersion     string `json:"runtime_version,omitempty"`
	CompatibilityEpoch int    `json:"compatibility_epoch,omitempty"`
	ControlState       string `json:"control_state,omitempty"`
	ControlReason      string `json:"control_reason,omitempty"`
}

func gatewayRuntimeRef(gatewayID, memberID string) string {
	return "gateway-host:" + gatewayID + ":member:" + memberID
}
func runtimeMutation(action string) bool {
	return action == "connect" || action == "start" || action == "stop" || action == "restart" || action == "update"
}
func (b *ResourceBackend) Runtimes(ctx context.Context, meta *session.Meta) (RuntimeDirectory, error) {
	meta = b.authorize(meta)
	directory := RuntimeDirectory{Targets: []RuntimeTarget{}, Sources: []RuntimeSource{}}
	if meta == nil || !meta.CanRead {
		return directory, ErrPermissionDenied
	}
	if b.Broker != nil && b.Broker.SourceActive(meta.DesktopSource) {
		var desktop RuntimeDirectory
		err := b.Broker.call(ctx, meta, RuntimeRequest{RuntimeRef: "", Action: "directory"}, "runtime", false, &desktop)
		if err == nil {
			directory.Targets = append(directory.Targets, desktop.Targets...)
			directory.Sources = append(directory.Sources, desktop.Sources...)
		} else {
			directory.Sources = append(directory.Sources, RuntimeSource{Source: "desktop", Location: "current_device", State: "unavailable", Reason: "desktop_disconnected"})
		}
	} else {
		directory.Sources = append(directory.Sources, RuntimeSource{Source: "desktop", Location: "current_device", State: "unavailable", Reason: "desktop_source_required"})
	}
	// Host catalog is available only to the authenticated local owner, never a
	// Cloud or public remote session with unrelated RWXA flags.
	if meta.UserPublicID != "user_local" || !meta.CanAdmin {
		return directory, nil
	}
	catalog, err := b.localGatewayCatalog(ctx)
	if err != nil {
		directory.Sources = append(directory.Sources, RuntimeSource{Source: "gateway_host", Location: "execution_machine", State: "unavailable", Reason: "gateway_unavailable"})
		return directory, nil
	}
	directory.Sources = append(directory.Sources, RuntimeSource{Name: catalog.Gateway.DisplayName, Source: "gateway_host", Location: "execution_machine", State: "available"})
	for _, member := range catalog.Members {
		if member.State != "active" {
			continue
		}
		ref := gatewayRuntimeRef(catalog.Gateway.GatewayID, member.MemberID)
		associated := false
		for i := range directory.Targets {
			target := &directory.Targets[i]
			if target.RuntimeRef == ref && target.Identity == member.RuntimePublicID {
				target.Location = "execution_machine"
				associated = true
			}
		}
		if associated {
			continue
		}
		online := member.Connected
		directory.Targets = append(directory.Targets, RuntimeTarget{RuntimeRef: gatewayRuntimeRef(catalog.Gateway.GatewayID, member.MemberID), Generation: strconv.FormatInt(member.MemberVersion, 10), Identity: member.RuntimePublicID, Name: member.DisplayName, Source: "gateway_host", Location: "execution_machine", ObservedAt: time.Now().UTC().Format(time.RFC3339Nano), Registered: true, Online: &online, Actions: []string{"status"}, Reason: "desktop_gateway_required"})
	}
	return directory, nil
}
func (b *ResourceBackend) localGatewayCatalog(ctx context.Context) (gp.CatalogResponse, error) {
	if b.GatewayCatalog != nil {
		return b.GatewayCatalog(ctx)
	}
	client, err := gatewayhost.Open(gatewayhost.DefaultRoot())
	if err != nil {
		return gp.CatalogResponse{}, err
	}
	defer client.Close()
	bounded, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return client.Catalog(bounded)
}
func (b *ResourceBackend) Runtime(ctx context.Context, meta *session.Meta, req RuntimeRequest) (RuntimeResult, error) {
	meta = b.authorize(meta)
	if meta == nil || !meta.CanRead {
		return RuntimeResult{}, ErrPermissionDenied
	}
	if runtimeMutation(req.Action) && (!meta.CanWrite || !meta.CanExecute) {
		return RuntimeResult{}, ErrPermissionDenied
	}
	if req.Action != "connect" && runtimeMutation(req.Action) && !meta.CanAdmin {
		return RuntimeResult{}, ErrPermissionDenied
	}
	switch req.Action {
	case "status", "diagnose", "operation", "connect", "start", "stop", "restart", "update":
	default:
		return RuntimeResult{}, ErrInvalidRequest
	}
	if req.RuntimeRef == "" || len(req.RuntimeRef) > 512 || req.Generation == "" || len(req.Generation) > 256 || len(req.Identity) > 256 || len(req.RequestID) > 128 || len(req.OperationID) > 256 {
		return RuntimeResult{}, ErrInvalidRequest
	}
	if runtimeMutation(req.Action) && req.RequestID == "" {
		return RuntimeResult{}, ErrInvalidRequest
	}
	if req.Action == "status" && strings.HasPrefix(req.RuntimeRef, "gateway-host:") && meta.UserPublicID == "user_local" && meta.CanAdmin && (b.Broker == nil || !b.Broker.SourceActive(meta.DesktopSource)) {
		catalog, err := b.localGatewayCatalog(ctx)
		if err != nil {
			return RuntimeResult{}, ErrTargetUnavailable
		}
		for _, member := range catalog.Members {
			if member.State == "active" && gatewayRuntimeRef(catalog.Gateway.GatewayID, member.MemberID) == req.RuntimeRef {
				if req.Generation != strconv.FormatInt(member.MemberVersion, 10) || req.Identity != member.RuntimePublicID {
					return RuntimeResult{}, ErrResourceChanged
				}
				online := member.Connected
				target := RuntimeTarget{RuntimeRef: req.RuntimeRef, Generation: req.Generation, Identity: member.RuntimePublicID, Name: member.DisplayName, Source: "gateway_host", Location: "execution_machine", ObservedAt: time.Now().UTC().Format(time.RFC3339Nano), Registered: true, Online: &online, Actions: []string{"status"}, Reason: "desktop_gateway_required"}
				return RuntimeResult{RuntimeRef: req.RuntimeRef, Status: "disconnected", Target: &target}, nil
			}
		}
		return RuntimeResult{}, ErrTargetUnavailable
	}
	if b.Broker == nil {
		return RuntimeResult{}, ErrTargetUnavailable
	}
	var result RuntimeResult
	err := b.Broker.call(ctx, meta, req, "runtime", runtimeMutation(req.Action), &result)
	if err == nil && result.RuntimeRef != req.RuntimeRef {
		if runtimeMutation(req.Action) {
			err = ErrOutcomeUnknown
		} else {
			err = ErrResourceChanged
		}
	}
	return result, err
}

// ExecuteBusiness is a fixed application operation on this Runtime only.
// Target session rights come from the authenticated HTTP session, never JSON.
func (b *ResourceBackend) ExecuteBusiness(ctx context.Context, meta *session.Meta, identity string, req ResourceRequest) (ResourceResult, error) {
	meta = b.authorize(meta)
	if b.RuntimeIdentity == nil || identity == "" || identity != b.RuntimeIdentity() {
		return ResourceResult{}, ErrResourceChanged
	}
	if req.RuntimeRef != "local:local" {
		return ResourceResult{}, ErrInvalidRequest
	}
	if meta == nil || !meta.CanRead || isResourceMutation(req.Action) && (!meta.CanWrite || !meta.CanExecute) {
		return ResourceResult{}, ErrPermissionDenied
	}
	switch req.Action {
	case "list", "inspect", "logs", "operation", "open", "start", "stop", "restart":
	default:
		return ResourceResult{}, ErrInvalidRequest
	}
	return b.ExecuteLocal(ctx, meta, req)
}
