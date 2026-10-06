package tessiven

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
	"github.com/floegence/redeven/internal/containerresource"
	"github.com/floegence/redeven/internal/managedwebservice"
	"github.com/floegence/redeven/internal/session"
)

var (
	ErrOutcomeUnknown       = errors.New("the service action outcome is unknown; inspect the original manager before issuing another action")
	ErrPermissionDenied     = errors.New("tessiven resource permission denied")
	ErrTargetUnavailable    = errors.New("the exact Runtime target has no available authorized connection")
	ErrHistoricalOperation  = errors.New("service operations are disabled for historical or archived canvases")
	ErrResourceChanged      = errors.New("the resource identity changed; inspect it again before acting")
	ErrOperationUnavailable = errors.New("the resource does not support this operation")
)

type ResourceRequest struct {
	CanvasID    string   `json:"canvas_id,omitempty"`
	VersionID   int64    `json:"version_id,omitempty"`
	InstanceID  string   `json:"instance_id,omitempty"`
	RuntimeRef  string   `json:"runtime_ref"`
	Binding     *Binding `json:"binding,omitempty"`
	Action      string   `json:"action"`
	RequestID   string   `json:"request_id,omitempty"`
	Identity    string   `json:"identity,omitempty"`
	OperationID string   `json:"operation_id,omitempty"`
}
type ResourceInspection struct {
	RuntimeRef string   `json:"runtime_ref"`
	Binding    Binding  `json:"binding"`
	Name       string   `json:"name"`
	State      string   `json:"state"`
	ObservedAt string   `json:"observed_at"`
	Identity   string   `json:"identity"`
	Actions    []string `json:"actions"`
	Operation  any      `json:"operation,omitempty"`
}
type ResourceResult struct {
	RuntimeRef string               `json:"runtime_ref"`
	Resources  []ResourceInspection `json:"resources,omitempty"`
	Inspection *ResourceInspection  `json:"inspection,omitempty"`
	Operation  any                  `json:"operation,omitempty"`
	Logs       any                  `json:"logs,omitempty"`
	Opening    any                  `json:"opening,omitempty"`
}

// ResourceBackend routes only explicit product operations. It is not an HTTP
// proxy or a second management state machine.
type ResourceBackend struct {
	Broker     *Broker
	Library    *Service
	Managed    managedwebservice.Backend
	Containers *containerresource.Service
	Remote     func(context.Context, *session.Meta, ResourceRequest) (ResourceResult, error)
}

func isResourceMutation(action string) bool {
	return action == "start" || action == "stop" || action == "restart" || action == "open"
}
func (b *ResourceBackend) Execute(ctx context.Context, meta *session.Meta, req ResourceRequest) (ResourceResult, error) {
	if meta == nil || !meta.CanRead {
		return ResourceResult{}, ErrPermissionDenied
	}
	switch req.Action {
	case "inspect", "list", "logs", "operation", "open", "start", "stop", "restart":
	default:
		return ResourceResult{}, ErrInvalidRequest
	}
	if isResourceMutation(req.Action) && !meta.CanExecute {
		return ResourceResult{}, ErrPermissionDenied
	}
	if req.InstanceID != "" {
		if req.CanvasID == "" || req.VersionID <= 0 || b.Library == nil {
			return ResourceResult{}, ErrInvalidRequest
		}
		v, err := b.Library.Version(ctx, req.CanvasID, req.VersionID)
		if err != nil {
			return ResourceResult{}, err
		}
		if isResourceMutation(req.Action) {
			c, err := b.Library.Canvas(ctx, req.CanvasID)
			if err != nil {
				return ResourceResult{}, err
			}
			if c.LatestVersion != req.VersionID || c.Archived {
				return ResourceResult{}, ErrHistoricalOperation
			}
		}
		found := false
		for _, instance := range v.Document.Instances {
			if instance.ID == req.InstanceID {
				found = true
				req.Binding = instance.Binding
				req.RuntimeRef = ""
				for _, node := range v.Document.Nodes {
					if node.ID == instance.NodeRef {
						req.RuntimeRef = node.RuntimeRef
						break
					}
				}
				break
			}
		}
		if !found {
			return ResourceResult{}, ErrNotFound
		}
	} else if isResourceMutation(req.Action) {
		return ResourceResult{}, ErrInvalidRequest
	}
	if req.RuntimeRef == "" {
		return ResourceResult{}, ErrInvalidRequest
	}
	if req.RuntimeRef != "local:local" {
		if b.Remote == nil {
			if b.Broker != nil {
				return b.Broker.Execute(ctx, meta, req)
			}
			return ResourceResult{}, ErrTargetUnavailable
		}
		return b.Remote(ctx, meta, req)
	}
	return b.ExecuteLocal(ctx, meta, req)
}

// ExecuteLocal is used after the target connection has been selected and
// authorized by its owning adapter. It never follows a remote reference.
func (b *ResourceBackend) ExecuteLocal(ctx context.Context, meta *session.Meta, req ResourceRequest) (ResourceResult, error) {
	out := ResourceResult{RuntimeRef: req.RuntimeRef}
	if meta == nil || !meta.CanRead {
		return out, ErrPermissionDenied
	}
	if isResourceMutation(req.Action) && (!meta.CanExecute || (req.Binding != nil && req.Binding.Owner == "managed_service" && !meta.CanWrite)) {
		return out, ErrPermissionDenied
	}
	if req.Action == "list" {
		if b.Managed != nil {
			services, err := b.Managed.List(ctx)
			if err != nil {
				return out, err
			}
			for _, service := range services {
				inspection := inspectManaged(req.RuntimeRef, service)
				if !meta.CanExecute || !meta.CanWrite {
					inspection.Actions = []string{"inspect", "logs"}
				}
				out.Resources = append(out.Resources, inspection)
			}
		}
		if b.Containers != nil {
			runtimes, err := b.Containers.Runtimes(ctx)
			if err != nil {
				return out, err
			}
			for _, runtime := range runtimes.Engines {
				if runtime.State != containerengine.RuntimeStateReady || runtime.EndpointID == "" {
					continue
				}
				items, err := b.Containers.Containers(ctx, containerengine.ContainerListRequest{Engine: runtime.Engine, EndpointID: runtime.EndpointID, All: true})
				if err != nil {
					return out, err
				}
				for _, item := range items {
					if item.Management.Managed {
						continue
					}
					binding := Binding{Owner: "container", ResourceID: item.ContainerID, Engine: string(runtime.Engine), EndpointID: string(runtime.EndpointID)}
					result, err := b.ExecuteLocal(ctx, meta, ResourceRequest{RuntimeRef: req.RuntimeRef, Binding: &binding, Action: "inspect"})
					if err != nil {
						return out, err
					}
					out.Resources = append(out.Resources, *result.Inspection)
				}
			}
		}
		return out, nil
	}
	if req.Binding == nil {
		return out, ErrOperationUnavailable
	}
	binding := *req.Binding
	var inspection ResourceInspection
	switch binding.Owner {
	case "managed_service":
		if b.Managed == nil {
			return out, ErrOperationUnavailable
		}
		services, err := b.Managed.List(ctx)
		if err != nil {
			return out, err
		}
		found := false
		for _, service := range services {
			if service.ServiceID == binding.ResourceID {
				inspection = inspectManaged(req.RuntimeRef, service)
				found = true
				break
			}
		}
		if !found {
			return out, ErrNotFound
		}
	case "container":
		if b.Containers == nil || binding.Engine == "" || binding.EndpointID == "" {
			return out, ErrOperationUnavailable
		}
		detail, err := b.Containers.Container(ctx, containerengine.ContainerInspectRequest{Engine: containerengine.Engine(binding.Engine), EndpointID: containerengine.EndpointID(binding.EndpointID), ContainerID: binding.ResourceID})
		if err != nil {
			return out, err
		}
		if detail.ContainerID != binding.ResourceID {
			return out, ErrResourceChanged
		}
		inspection = ResourceInspection{RuntimeRef: req.RuntimeRef, Binding: binding, Name: detail.Name, State: string(detail.State), ObservedAt: time.Now().UTC().Format(time.RFC3339Nano), Identity: fmt.Sprintf("%s:%d", detail.ContainerID, detail.CreatedAtUnixMs), Actions: []string{"inspect", "logs"}}
		if !detail.Management.Managed {
			inspection.Actions = append(inspection.Actions, "start", "stop", "restart")
		}
	default:
		return out, ErrOperationUnavailable
	}
	inspection.Binding.Identity = inspection.Identity
	if !meta.CanExecute || (binding.Owner == "managed_service" && !meta.CanWrite) {
		inspection.Actions = []string{"inspect", "logs"}
	}
	out.Inspection = &inspection
	if req.Action == "inspect" {
		return out, nil
	}
	if req.Action == "operation" {
		if req.OperationID == "" {
			return out, ErrInvalidRequest
		}
		if binding.Owner == "managed_service" {
			operation, err := b.Managed.Operation(ctx, req.OperationID)
			if err != nil {
				return out, err
			}
			if operation.ServiceID != binding.ResourceID {
				return out, ErrNotFound
			}
			out.Operation = operation
		} else {
			operation, err := b.Containers.Operation(ctx, req.OperationID)
			if err != nil {
				return out, err
			}
			if operation.ResourceIdentity != binding.ResourceID || string(operation.Engine) != binding.Engine || string(operation.EndpointID) != binding.EndpointID {
				return out, ErrNotFound
			}
			out.Operation = operation
		}
		return out, nil
	}
	if req.Action == "logs" {
		var err error
		if binding.Owner == "managed_service" {
			out.Logs, err = b.Managed.Logs(ctx, binding.ResourceID, 200)
		} else {
			out.Logs, err = b.Containers.TailLogs(ctx, containerengine.LogsTailRequest{Engine: containerengine.Engine(binding.Engine), EndpointID: containerengine.EndpointID(binding.EndpointID), ContainerID: binding.ResourceID, TailLines: 200})
		}
		return out, err
	}
	allowed := false
	for _, action := range inspection.Actions {
		allowed = allowed || action == req.Action
	}
	if !allowed {
		return out, ErrOperationUnavailable
	}
	if !requestIDPattern.MatchString(req.RequestID) || req.Identity == "" {
		return out, ErrInvalidRequest
	}
	if req.Identity != inspection.Identity || (binding.Identity != "" && binding.Identity != inspection.Identity) {
		return out, ErrResourceChanged
	}
	if binding.Owner == "managed_service" {
		if req.Action == "open" {
			opening, err := b.Managed.OpenSession(ctx, binding.ResourceID, managedwebservice.OpenSessionRequest{RequestID: req.RequestID})
			out.Opening = opening
			return out, err
		}
		operation, err := b.Managed.Operate(ctx, binding.ResourceID, managedwebservice.OperationRequest{RequestID: req.RequestID, Action: managedwebservice.OperationAction(req.Action), Administrator: meta.CanAdmin})
		out.Operation = operation
		return out, err
	}
	method := map[string]containerengine.Method{"start": containerengine.MethodStart, "stop": containerengine.MethodStop, "restart": containerengine.MethodRestart}[req.Action]
	if method == "" {
		return out, ErrOperationUnavailable
	}
	payload, _ := json.Marshal(containerengine.ContainerStartRequest{Engine: containerengine.Engine(binding.Engine), EndpointID: containerengine.EndpointID(binding.EndpointID), ContainerID: binding.ResourceID})
	preflight, err := b.Containers.Preflight(ctx, containerresource.PreflightRequest{Method: method, Request: payload})
	if err != nil {
		return out, err
	}
	if preflight.Plan.RequiresAdmin && !meta.CanAdmin {
		return out, ErrPermissionDenied
	}
	operation, err := b.Containers.CreateOperation(ctx, containerresource.CreateOperationRequest{RequestID: req.RequestID, Method: method, Request: payload, RequestHash: preflight.RequestHash, PlanHash: preflight.PlanHash})
	out.Operation = operation
	return out, err
}
func inspectManaged(runtime string, service managedwebservice.ServiceView) ResourceInspection {
	identity := fmt.Sprintf("%s:%d", service.ServiceID, service.CreatedAtUnixMs)
	actions := []string{"inspect", "logs"}
	for _, item := range []struct {
		name string
		cap  managedwebservice.ActionCapability
	}{{"open", service.Actions.Open}, {"start", service.Actions.Start}, {"stop", service.Actions.Stop}, {"restart", service.Actions.Restart}} {
		if item.cap.Available {
			actions = append(actions, item.name)
		}
	}
	return ResourceInspection{RuntimeRef: runtime, Binding: Binding{Owner: "managed_service", ResourceID: service.ServiceID, Identity: identity}, Identity: identity, Name: service.Name, State: service.Status, ObservedAt: time.Now().UTC().Format(time.RFC3339Nano), Actions: actions, Operation: service.ActiveOperation}
}

// ResourceError preserves a classified manager refusal across the host bridge.
// Only public manager messages cross this boundary; underlying causes do not.
type ResourceError struct {
	Code    string
	Message string
	Status  int
}

func (e *ResourceError) Error() string { return e.Message }
func ResourceErrorDetails(err error) (int, string, string) {
	var remote *ResourceError
	if errors.As(err, &remote) {
		return remote.Status, remote.Code, remote.Message
	}
	var managed *managedwebservice.Error
	if errors.As(err, &managed) {
		return managed.HTTPStatus, managed.Code, managed.Message
	}
	switch {
	case errors.Is(err, ErrOutcomeUnknown):
		return 409, "TESSIVEN_OUTCOME_UNKNOWN", ErrOutcomeUnknown.Error()
	case errors.Is(err, ErrPermissionDenied):
		return 403, "TESSIVEN_PERMISSION_DENIED", ErrPermissionDenied.Error()
	case errors.Is(err, ErrResourceChanged):
		return 409, "TESSIVEN_RESOURCE_CHANGED", ErrResourceChanged.Error()
	case errors.Is(err, ErrNotFound), errors.Is(err, containerengine.ErrContainerNotFound):
		return 404, "TESSIVEN_NOT_FOUND", "The referenced resource no longer exists"
	case errors.Is(err, ErrInvalidRequest):
		return 400, "TESSIVEN_INVALID_REQUEST", ErrInvalidRequest.Error()
	case errors.Is(err, ErrOperationUnavailable), errors.Is(err, containerresource.ErrManagedByWebService):
		return 409, "TESSIVEN_OPERATION_UNAVAILABLE", ErrOperationUnavailable.Error()
	case errors.Is(err, ErrTargetUnavailable):
		return 409, "TESSIVEN_TARGET_UNAVAILABLE", ErrTargetUnavailable.Error()
	default:
		return 500, "TESSIVEN_RESOURCE_FAILED", "The resource manager could not complete the request"
	}
}
