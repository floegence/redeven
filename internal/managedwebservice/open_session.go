package managedwebservice

import (
	"context"
)

type sharedOpenSession struct {
	session   *OpenSession
	refreshed bool
}

func (m *Manager) OpenSession(ctx context.Context, serviceID string, request OpenSessionRequest) (*OpenSession, error) {
	if err := validateRequestID(request.RequestID); err != nil {
		return nil, err
	}
	for {
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
			session, err := m.openExistingSession(openCtx, serviceID, request.Refresh)
			return sharedOpenSession{session, request.Refresh}, err
		})
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case value := <-result:
			if value.Err != nil {
				return nil, value.Err
			}
			shared := value.Val.(sharedOpenSession)
			if request.Refresh && !shared.refreshed {
				continue
			}
			session := *shared.session
			return &session, nil
		}
	}
}

func (m *Manager) openExistingSession(ctx context.Context, serviceID string, refresh bool) (*OpenSession, error) {
	service, forward, err := m.serviceAndForward(ctx, serviceID)
	if err != nil {
		return nil, err
	}
	m.requestMu.Lock()
	if m.templateSourceUses == nil {
		m.templateSourceUses = map[string]int{}
	}
	m.templateSourceUses[service.TemplateID]++
	m.requestMu.Unlock()
	defer func() {
		m.requestMu.Lock()
		m.templateSourceUses[service.TemplateID]--
		if m.templateSourceUses[service.TemplateID] == 0 {
			delete(m.templateSourceUses, service.TemplateID)
		}
		m.requestMu.Unlock()
	}()
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
	launch, err := m.openingLaunch(ctx, service)
	if err != nil {
		return nil, err
	}
	appPath, bootstrap, err := m.prepareServiceOpening(ctx, service, launch, openingPreparation{Refresh: refresh})
	if err != nil {
		return nil, err
	}
	if err := m.checkOpeningEndpoint(ctx, service); err != nil {
		return nil, err
	}
	current, currentForward, err := m.serviceAndForward(ctx, serviceID)
	if err != nil {
		return nil, err
	}
	currentLaunch, launchErr := m.openingLaunch(ctx, current)
	active, activeErr := m.registry.GetActiveManagedOperation(ctx, serviceID)
	if launchErr != nil || activeErr != nil || active != nil || currentLaunch.Generation != launch.Generation || current.RuntimeIdentity != service.RuntimeIdentity || current.RuntimeSpecSHA256 != service.RuntimeSpecSHA256 || *currentForward != *forward {
		return nil, serviceError("RESOURCE_PLAN_STALE", "The service instance changed while its opening information was prepared. Open the current instance again.", 409, true, nil)
	}
	session := &OpenSession{State: "ready", Forward: forward, AppPath: appPath, LaunchGeneration: launch.Generation}
	if bootstrap {
		session.ManagedEntrance = &ManagedEntranceContext{ServiceID: serviceID, LaunchGeneration: launch.Generation}
	}
	return session, nil
}
