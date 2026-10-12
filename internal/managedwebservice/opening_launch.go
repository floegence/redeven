package managedwebservice

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

type serviceOpeningLaunch struct {
	Generation string
	Port       int
	ReadOutput func(context.Context) ([]byte, error)
}

type openingLaunchProvider interface {
	OpeningLaunch(context.Context, *pfregistry.ManagedService) (serviceOpeningLaunch, error)
}

func (m *Manager) openingLaunch(ctx context.Context, service *pfregistry.ManagedService) (serviceOpeningLaunch, error) {
	binding, err := decodeRuntimeBinding(service)
	if err != nil {
		return serviceOpeningLaunch{}, err
	}
	provider, ok := m.driver(binding.Deployment).(openingLaunchProvider)
	if !ok {
		return serviceOpeningLaunch{}, serviceError("SERVICE_OPEN_TARGET_UNAVAILABLE", "The runtime cannot verify this service entrance.", 409, true, nil)
	}
	return provider.OpeningLaunch(ctx, service)
}

func (d *hostScriptDriver) OpeningLaunch(ctx context.Context, s *pfregistry.ManagedService) (serviceOpeningLaunch, error) {
	if _, running, err := d.recoverPersistedProcess(s); err != nil || !running {
		return serviceOpeningLaunch{}, serviceError("SERVICE_NOT_RUNNING", "The service process is not running.", 409, true, nil)
	}
	return serviceOpeningLaunch{Generation: s.RuntimeIdentity, Port: s.RuntimePort, ReadOutput: func(context.Context) ([]byte, error) {
		path := filepath.Join(d.runDirectory(s), "output")
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > 16*1024*1024 {
			return nil, serviceError("OPENING_URL_MISSING", "No private startup output remains. Restart explicitly to produce a new entrance.", 409, true, nil)
		}
		file, err := os.Open(path)
		if err != nil {
			return nil, err
		}
		defer file.Close()
		actual, err := file.Stat()
		if err != nil || !os.SameFile(info, actual) {
			return nil, serviceError("OPENING_OUTPUT_UNAVAILABLE", "The private output identity changed.", 409, true, nil)
		}
		raw, err := io.ReadAll(io.LimitReader(file, 16*1024*1024+1))
		if len(raw) > 16*1024*1024 {
			return nil, serviceError("OPENING_OUTPUT_LIMIT", "The private output exceeds its read limit.", 409, true, nil)
		}
		return raw, err
	}}, nil
}

func launchFromContainer(ctx context.Context, adapter *containerengine.Adapter, item containerengine.ContainerInspect, s *pfregistry.ManagedService) (serviceOpeningLaunch, error) {
	started, err := time.Parse(time.RFC3339Nano, item.StartedAt)
	if err != nil || started.IsZero() || item.State != containerengine.ContainerStateRunning {
		return serviceOpeningLaunch{}, serviceError("OPENING_GENERATION_UNAVAILABLE", "The current container launch cannot be verified. Check the service again.", 409, true, nil)
	}
	port := 0
	for _, p := range item.Ports {
		if p.HostIP == "127.0.0.1" && p.HostPort == s.RuntimePort && p.Protocol == "tcp" {
			if port != 0 {
				return serviceOpeningLaunch{}, serviceError("OPENING_ENTRY_AMBIGUOUS", "The protected Web entrance is not unique.", 409, false, nil)
			}
			port = p.Port
		}
	}
	if port == 0 {
		return serviceOpeningLaunch{}, serviceError("OPENING_ENTRY_UNAVAILABLE", "The applied protected Web port cannot be verified.", 409, false, nil)
	}
	return serviceOpeningLaunch{Generation: "container:" + item.ContainerID + ":" + item.StartedAt, Port: port, ReadOutput: func(ctx context.Context) ([]byte, error) {
		return adapter.StartupLogs(ctx, containerengine.ContainerInspectRequest{Engine: containerengine.EngineDocker, ContainerID: item.ContainerID}, item.StartedAt)
	}}, nil
}

func (d *containerTemplateDriver) OpeningLaunch(ctx context.Context, s *pfregistry.ManagedService) (serviceOpeningLaunch, error) {
	item, exists, err := d.ownedContainer(ctx, s)
	if err != nil {
		return serviceOpeningLaunch{}, err
	}
	if !exists {
		return serviceOpeningLaunch{}, serviceError("SERVICE_NOT_RUNNING", "The managed container is missing.", 409, true, nil)
	}
	return launchFromContainer(ctx, d.adapter, item, s)
}

func (d *composeTemplateDriver) OpeningLaunch(ctx context.Context, s *pfregistry.ManagedService) (serviceOpeningLaunch, error) {
	images, err := d.expectedImages(s)
	if err != nil {
		return serviceOpeningLaunch{}, err
	}
	project, err := d.verifyOwnedProject(ctx, s, images)
	if err != nil {
		return serviceOpeningLaunch{}, err
	}
	var entry *containerengine.ContainerInspect
	for _, c := range project.Containers {
		inspected, err := d.adapter.Inspect(ctx, containerengine.ContainerInspectRequest{Engine: containerengine.EngineDocker, ContainerID: c.ContainerID})
		if err != nil {
			return serviceOpeningLaunch{}, err
		}
		for _, p := range inspected.Container.Ports {
			if p.HostIP == "127.0.0.1" && p.HostPort == s.RuntimePort && p.Protocol == "tcp" {
				if entry != nil {
					return serviceOpeningLaunch{}, serviceError("OPENING_ENTRY_AMBIGUOUS", "The applied Compose project has more than one Web entrance.", 409, false, nil)
				}
				item := inspected.Container
				entry = &item
			}
		}
	}
	if entry == nil {
		return serviceOpeningLaunch{}, serviceError("OPENING_ENTRY_UNAVAILABLE", "The applied Compose Web entrance cannot be verified.", 409, true, nil)
	}
	return launchFromContainer(ctx, d.adapter, *entry, s)
}
