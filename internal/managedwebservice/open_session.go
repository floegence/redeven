package managedwebservice

import (
	"context"
)

func (m *Manager) OpenSession(ctx context.Context, serviceID string, request OpenSessionRequest) (*OpenSession, error) {
	if err := validateRequestID(request.RequestID); err != nil {
		return nil, err
	}
	result := m.openFlights.DoChan(serviceID, func() (any, error) {
		m.mu.Lock()
		if m.closed {
			m.mu.Unlock()
			return nil, serviceError("RUNTIME_CLOSING", "The Runtime is reconnecting. Retry opening shortly.", 503, true, nil)
		}
		m.workers.Add(1)
		m.mu.Unlock()
		defer m.workers.Done()
		// One cancelled browser request must not cancel another caller's shared hook.
		openCtx, cancel := context.WithCancel(context.WithoutCancel(ctx))
		defer cancel()
		if m.managementCtx != nil {
			stop := context.AfterFunc(m.managementCtx, cancel)
			defer stop()
		}
		return m.openExistingSession(openCtx, serviceID)
	})
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case value := <-result:
		if value.Err != nil {
			return nil, value.Err
		}
		session := *value.Val.(*OpenSession)
		return &session, nil
	}
}

func (m *Manager) openExistingSession(ctx context.Context, serviceID string) (*OpenSession, error) {
	service, forward, err := m.serviceAndForward(ctx, serviceID)
	if err != nil {
		return nil, err
	}
	active, err := m.registry.GetActiveManagedOperation(ctx, serviceID)
	if err != nil {
		return nil, err
	}
	if active != nil {
		switch OperationAction(active.Action) {
		case ActionStart, ActionInstall, ActionRetryInstall, ActionRestart:
			return &OpenSession{State: "preparing", Operation: active}, nil
		default:
			return nil, serviceError("OPERATION_CONFLICT", "Another operation is changing this service.", 409, true, nil)
		}
	}
	running, err := m.observe(ctx, service)
	if err != nil {
		return nil, err
	}
	if !running {
		return nil, serviceError("SERVICE_NOT_RUNNING", "Start the managed Web Service before opening it.", 409, true, nil)
	}
	binding, err := decodeRuntimeBinding(service)
	if err != nil {
		return nil, err
	}
	var appPath string
	if binding.Deployment == DeploymentHost {
		driver, ok := m.host.(*hostScriptDriver)
		if !ok {
			return nil, serviceError("HOST_OPEN_TARGET_UNAVAILABLE", "The service opening information is unavailable.", 409, true, nil)
		}
		// The applied instance owns its verified entrance, even if its template has
		// changed or was removed. Never execute changed scripts against an old run.
		resolved, resolveErr := m.resolveCurrentRuntime(ctx, service)
		if resolveErr != nil || resolved.RuntimeSpecSHA256 != service.RuntimeSpecSHA256 {
			appPath, err = driver.readOpenSession(service, service.RuntimeIdentity)
		} else {
			resolved.applyTo(service)
			appPath, err = driver.prepareOpening(ctx, service, resolved.Spec)
		}
		if err != nil {
			return nil, err
		}
	} else {
		appPath, err = m.resolveStaticOpening(ctx, service)
		if err != nil {
			return nil, err
		}
	}
	if err := m.checkOpeningEndpoint(ctx, service); err != nil {
		return nil, err
	}
	current, currentForward, err := m.serviceAndForward(ctx, serviceID)
	if err != nil {
		return nil, err
	}
	if current.RuntimeIdentity != service.RuntimeIdentity || currentForward.ForwardID != forward.ForwardID {
		return nil, serviceError("RESOURCE_PLAN_STALE", "The service instance changed while its opening information was prepared. Open the current instance again.", 409, true, nil)
	}
	return &OpenSession{State: "ready", Forward: forward, AppPath: appPath}, nil
}
