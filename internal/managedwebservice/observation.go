package managedwebservice

import (
	"context"
	"net"
	"path/filepath"
	"strconv"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

// Observation never starts, stops, or reinstalls an application.
type runtimeObserver interface {
	Observe(context.Context, *pfregistry.ManagedService) (bool, error)
}

func (d *hostScriptDriver) Observe(ctx context.Context, service *pfregistry.ManagedService) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	_, running, err := d.recoverPersistedProcess(service)
	return running, err
}

func (d *containerTemplateDriver) Observe(ctx context.Context, service *pfregistry.ManagedService) (bool, error) {
	if d.adapter == nil {
		return false, serviceError("CONTAINER_INSPECTION_FAILED", "The container engine is unavailable.", 503, true, nil)
	}
	container, exists, err := d.ownedContainer(ctx, service)
	return exists && container.State == containerengine.ContainerStateRunning, err
}

func (d *composeTemplateDriver) Observe(ctx context.Context, service *pfregistry.ManagedService) (bool, error) {
	if service.RuntimeIdentity == "" {
		return false, nil
	}
	if d.adapter == nil {
		return false, serviceError("COMPOSE_INSPECTION_FAILED", "The container engine is unavailable.", 503, true, nil)
	}
	images, err := d.expectedImages(service)
	if err != nil {
		return false, err
	}
	details, err := d.verifyOwnedProject(ctx, service, images)
	if err != nil {
		return false, err
	}
	if len(details.Containers) != len(images) {
		return false, nil
	}
	for _, container := range details.Containers {
		if container.State != containerengine.ContainerStateRunning {
			return false, nil
		}
	}
	return true, nil
}

func (m *Manager) observe(ctx context.Context, service *pfregistry.ManagedService) (bool, error) {
	binding, err := decodeRuntimeBinding(service)
	if err != nil {
		return false, err
	}
	observer, ok := m.driver(binding.Deployment).(runtimeObserver)
	if !ok {
		return false, serviceError("RUNTIME_INSPECTION_UNAVAILABLE", "The service runtime cannot be inspected.", 503, true, nil)
	}
	checkCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	running, err := observer.Observe(checkCtx, service)
	observed := "stopped"
	if err != nil {
		observed = "unknown"
	} else if running {
		observed = "running"
	}
	if service.ObservedState != observed {
		if updateErr := m.registry.UpdateManagedServiceIfRuntimeMatches(ctx, service.ServiceID, service.RuntimeIdentity, service.RuntimeSpecSHA256, pfregistry.ManagedServicePatch{ObservedState: &observed}); updateErr != nil {
			return false, updateErr
		}
		service.ObservedState = observed
	}
	return running, err
}

func (m *Manager) isClosing() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.closed
}

func (m *Manager) startOutputMaintenance(ctx context.Context) {
	m.mu.Lock()
	if m.closed || m.maintenanceCancel != nil {
		m.mu.Unlock()
		return
	}
	maintenanceCtx, cancel := context.WithCancel(ctx)
	m.maintenanceCancel = cancel
	m.workers.Add(1)
	m.mu.Unlock()
	go func() {
		defer m.workers.Done()
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-maintenanceCtx.Done():
				return
			case <-ticker.C:
				services, err := m.registry.ListManagedServices(maintenanceCtx)
				if err != nil {
					continue
				}
				driver, ok := m.host.(*hostScriptDriver)
				if !ok {
					continue
				}
				for _, service := range services {
					if state, err := driver.readRunState(&service); err == nil && state.OutputMode == "private_file" {
						_ = truncatePrivateOutput(filepath.Join(driver.runDirectory(&service), "output"), hostPrivateOutputLimit)
					}
				}
			}
		}
	}()
}

// Endpoint availability is separate from process ownership and running state.
func (m *Manager) checkOpeningEndpoint(ctx context.Context, service *pfregistry.ManagedService) error {
	if m.healthCheck != nil {
		return m.healthCheck(ctx, service)
	}
	dialer := net.Dialer{Timeout: 500 * time.Millisecond}
	connection, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(service.RuntimePort)))
	if err != nil {
		return serviceError("SERVICE_ENDPOINT_UNAVAILABLE", "The service process is running, but its local endpoint is not accepting connections. Retry opening shortly.", 409, true, nil)
	}
	return connection.Close()
}
