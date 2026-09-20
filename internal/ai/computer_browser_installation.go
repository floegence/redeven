package ai

import (
	"context"
	"encoding/base64"
	"errors"
	"log/slog"
	"path/filepath"

	"github.com/floegence/redeven/internal/browserinstall"
	"github.com/floegence/redeven/internal/session"
)

// ConfigureManagedBrowser is called once by the product runtime before serving.
// Helpers remain immutable; downloaded browsers and preferences live in state.
func (r *ComputerUseRuntime) ConfigureManagedBrowser(stateDirectory string) {
	pkg, err := browserinstall.NativePackage()
	if err == nil {
		r.browserInstallation, err = browserinstall.New(filepath.Join(stateDirectory, "browser"), pkg)
	}
	r.browserInstallationErr = err
}
func (r *ComputerUseRuntime) managedBrowserEnabled() bool {
	return r.browserInstallationErr == nil && (r.browserInstallation == nil || r.browserInstallation.Snapshot().Enabled)
}
func (r *ComputerUseRuntime) requireManagedBrowser() (string, error) {
	if r.browserInstallationErr != nil {
		return "", r.browserInstallationErr
	}
	if r.browserInstallation == nil {
		return "", nil
	}
	return r.browserInstallation.Executable()
}
func (r *ComputerUseRuntime) checkManagedTarget(targetID string) error {
	target, err := r.registry.ResolveTarget(context.Background(), targetID)
	if err == nil && target.Kind == "browser.managed" {
		_, err = r.requireManagedBrowser()
		return err
	}
	return nil
}
func (s *Service) browserInstaller(meta *session.Meta) (*ComputerUseRuntime, error) {
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	host, ok := s.targetToolExecutor.(*ComputerUseRuntime)
	if !ok || host.browserInstallation == nil {
		return nil, errors.New("browser installer unavailable")
	}
	return host, nil
}
func (s *Service) ComputerBrowserInstallation(_ context.Context, meta *session.Meta) (browserinstall.Status, error) {
	host, err := s.browserInstaller(meta)
	if err != nil {
		return browserinstall.Status{}, err
	}
	return host.browserInstallation.Snapshot(), nil
}
func (s *Service) SetComputerBrowserEnabled(_ context.Context, meta *session.Meta, enabled bool) (browserinstall.Status, error) {
	host, err := s.browserInstaller(meta)
	if err != nil {
		return browserinstall.Status{}, err
	}
	status, err := host.browserInstallation.SetEnabled(enabled)
	if err == nil {
		slog.Info("built-in browser preference changed", "enabled", enabled)
	}
	if err == nil && !enabled {
		host.connectMu.Lock()
		for _, profile := range host.managedProfiles {
			profile.close()
		}
		clear(host.managedProfiles)
		host.connectMu.Unlock()
	}
	return status, err
}

type ComputerBrowserInstallRequest struct {
	Action      string `json:"action"`
	PackageID   string `json:"package_id,omitempty"`
	Source      string `json:"source,omitempty"`
	OperationID string `json:"operation_id,omitempty"`
	Offset      int64  `json:"offset,omitempty"`
	Data        string `json:"data,omitempty"`
}

func (s *Service) InstallComputerBrowser(_ context.Context, meta *session.Meta, request ComputerBrowserInstallRequest) (browserinstall.Status, error) {
	host, err := s.browserInstaller(meta)
	if err != nil {
		return browserinstall.Status{}, err
	}
	manager := host.browserInstallation
	switch request.Action {
	case "start":
		status, err := manager.Start(request.PackageID, request.Source)
		if err == nil {
			slog.Info("browser installation confirmed", "source", request.Source, "package_id", request.PackageID)
		}
		return status, err
	case "chunk":
		bytes, err := base64.StdEncoding.DecodeString(request.Data)
		if err != nil {
			return browserinstall.Status{}, err
		}
		return manager.WriteChunk(request.OperationID, request.Offset, bytes)
	case "complete":
		return manager.CompleteUpload(request.OperationID)
	case "cancel":
		return manager.Cancel(request.OperationID)
	default:
		return browserinstall.Status{}, errors.New("invalid browser installation action")
	}
}
