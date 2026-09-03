package managedwebservice

import (
	"context"
	"strings"
)

func (m *Manager) OpenSession(ctx context.Context, serviceID string) (*OpenSession, error) {
	service, forward, err := m.serviceAndForward(ctx, serviceID)
	if err != nil {
		return nil, err
	}
	if service.ObservedState != "running" {
		return nil, serviceError("SERVICE_NOT_RUNNING", "Start the managed Web Service before opening it.", 409, true, nil)
	}
	spec, _, err := effectiveSpecFromService(service)
	if err != nil {
		return nil, err
	}
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
			return nil, err
		}
	}
	return &OpenSession{Forward: *forward, AppPath: appPath}, nil
}
