package managedwebservice

import (
	"context"
	"strings"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func (m *Manager) OpenSession(ctx context.Context, serviceID string, request OpenSessionRequest) (*OpenSession, error) {
	if err := validateRequestID(request.RequestID); err != nil {
		return nil, err
	}
	service, forward, err := m.serviceAndForward(ctx, serviceID)
	if err != nil {
		return nil, err
	}
	active, err := m.registry.GetActiveManagedOperation(ctx, service.ServiceID)
	if err != nil {
		return nil, err
	}
	if active != nil {
		if OperationAction(active.Action) == ActionRestart {
			return &OpenSession{State: "preparing", Operation: active}, nil
		}
		return nil, serviceError("OPERATION_CONFLICT", "Another operation is already running for this managed Web Service.", 409, true, nil)
	}
	if service.ObservedState != "running" {
		return nil, serviceError("SERVICE_NOT_RUNNING", "Start the managed Web Service before opening it.", 409, true, nil)
	}
	resolved, err := m.resolveCurrentRuntime(ctx, service)
	if err != nil {
		return nil, err
	}
	resolved.applyTo(service)
	if service.RuntimeSpecSHA256 != resolved.RuntimeSpecSHA256 {
		return m.prepareOpenSession(ctx, service, request.RequestID)
	}
	spec := resolved.Spec
	appPath := strings.TrimSpace(spec.Endpoint.Path)
	if appPath == "" {
		appPath = "/"
	}
	if spec.Kind == DeploymentHost && spec.Host != nil && spec.Host.OpenTarget != nil {
		driver, ok := m.host.(*hostScriptDriver)
		if !ok {
			return nil, serviceError("HOST_OPEN_TARGET_UNAVAILABLE", "The Host service startup URL is unavailable.", 409, true, nil)
		}
		appPath, err = driver.resolveOpenSession(service)
		if err != nil {
			code, _, _, retryable := ErrorDetails(err)
			if retryable && (code == "HOST_OPEN_TARGET_UNAVAILABLE" || code == "HOST_OPEN_TARGET_INVALID") {
				return m.prepareOpenSession(ctx, service, request.RequestID)
			}
			return nil, err
		}
	}
	return &OpenSession{State: "ready", Forward: forward, AppPath: appPath}, nil
}

func (m *Manager) prepareOpenSession(ctx context.Context, service *pfregistry.ManagedService, requestID string) (*OpenSession, error) {
	active, err := m.registry.GetActiveManagedOperation(ctx, service.ServiceID)
	if err != nil {
		return nil, err
	}
	if active != nil {
		if OperationAction(active.Action) == ActionRestart {
			return &OpenSession{State: "preparing", Operation: active}, nil
		}
		return nil, serviceError("OPERATION_CONFLICT", "Another operation is already running for this managed Web Service.", 409, true, nil)
	}
	operation, err := m.Operate(ctx, service.ServiceID, OperationRequest{RequestID: requestID, Action: ActionRestart})
	if err != nil {
		if code, _, _, _ := ErrorDetails(err); code == "OPERATION_CONFLICT" {
			active, readErr := m.registry.GetActiveManagedOperation(ctx, service.ServiceID)
			if readErr == nil && active != nil && OperationAction(active.Action) == ActionRestart {
				return &OpenSession{State: "preparing", Operation: active}, nil
			}
		}
		return nil, err
	}
	return &OpenSession{State: "preparing", Operation: operation}, nil
}
