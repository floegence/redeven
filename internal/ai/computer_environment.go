package ai

import (
	"context"
	"errors"
	"os"
	"runtime"

	"github.com/floegence/redeven/internal/session"
)

// Environment capability is a current, read-only observation. It never grants
// access, creates a browser page, or starts a private desktop.
type ComputerCapability struct {
	State        string              `json:"state"`
	Reason       string              `json:"reason,omitempty"`
	Missing      []string            `json:"missing,omitempty"`
	Components   []ComputerComponent `json:"components,omitempty"`
	Repair       string              `json:"repair,omitempty"`
	Packages     []string            `json:"packages,omitempty"`
	SetupCommand string              `json:"setup_command,omitempty"`
}

type ComputerComponent struct {
	ID         string `json:"id"`
	Path       string `json:"path"`
	Overridden bool   `json:"overridden,omitempty"`
}

type ComputerEnvironment struct {
	BrowserService BrowserServiceStatus    `json:"browser_service"`
	Hostname       string                  `json:"hostname"`
	Platform       string                  `json:"platform"`
	Managed        ComputerCapability      `json:"managed"`
	Desktop        ComputerCapability      `json:"desktop"`
	Chrome         ComputerExtensionStatus `json:"chrome"`
}

func computerCapabilityFailure(err error) ComputerCapability {
	capability := ComputerCapability{State: "setup_required", Reason: "capability_unavailable"}
	var startup *TargetStartupError
	if errors.As(err, &startup) {
		capability.Reason = startup.Reason
		if startup.Code == "TARGET_PERMISSION_REQUIRED" {
			capability.State = "permission_required"
		}
	}
	return capability
}

func (s *Service) ComputerEnvironment(ctx context.Context, meta *session.Meta) (ComputerEnvironment, error) {
	if err := requireRWX(meta); err != nil {
		return ComputerEnvironment{}, err
	}
	host, ok := s.targetToolExecutor.(*ComputerUseRuntime)
	if !ok {
		return ComputerEnvironment{}, errors.New("computer runtime unavailable")
	}
	return host.ComputerEnvironment(ctx)
}

func (r *ComputerUseRuntime) ComputerEnvironment(ctx context.Context) (ComputerEnvironment, error) {
	hostname, err := os.Hostname()
	if err != nil {
		return ComputerEnvironment{}, err
	}
	result := ComputerEnvironment{Hostname: hostname, Platform: runtime.GOOS,
		Managed: ComputerCapability{State: "setup_required", Reason: "browser_adapter_unavailable"},
		Desktop: ComputerCapability{State: "setup_required", Reason: "desktop_adapter_unavailable"}}
	r.mu.RLock()
	closed := r.closed
	r.mu.RUnlock()
	if closed {
		return result, errors.New("computer runtime is closed")
	}
	result.BrowserService = r.browserServiceSnapshot()
	result.Chrome = r.extensionStatus()
	r.connectMu.Lock()
	_, managedErr := r.managedProfilesLocked()
	if managedErr == nil {
		resources, resourceErr := r.managedResources()
		if resourceErr == nil {
			resourceErr = resources.CheckComputerSetup()
		}
		if resourceErr == nil {
			result.Managed = ComputerCapability{State: "on_demand"}
		} else {
			result.Managed = computerCapabilityFailure(resourceErr)
		}
	} else {
		result.Managed = computerCapabilityFailure(managedErr)
	}
	r.connectMu.Unlock()
	if r.browserInstallation != nil {
		state := r.browserInstallation.Snapshot()
		if !state.Enabled {
			result.Managed = ComputerCapability{State: "disabled"}
		} else if result.Managed.State == "on_demand" && state.Launch.State != "ready" {
			result.Managed = ComputerCapability{State: state.Launch.State, Reason: state.Launch.Reason}
		}
	}
	if r.browserInstallationErr != nil {
		result.Managed = ComputerCapability{State: "setup_required", Reason: "browser_settings_unavailable"}
	}
	r.mu.RLock()
	native := r.executors["desktop-main"]
	private := r.executors["xvfb-main"]
	r.mu.RUnlock()
	if checker, ok := native.(*NativeDesktopTargetExecutor); ok {
		if err := checker.CheckComputerSetup(ctx); err != nil {
			result.Desktop = computerCapabilityFailure(err)
		} else {
			result.Desktop = ComputerCapability{State: "ready"}
		}
	} else if inspector, ok := private.(interface{ InspectComputerSetup() ComputerCapability }); ok {
		result.Desktop = inspector.InspectComputerSetup()
	}
	return result, ctx.Err()
}

// Verification is an explicit user action. It does not change a conversation's
// selected target or interrupt a task already using the private desktop.
func (s *Service) VerifyComputerDesktop(ctx context.Context, meta *session.Meta) (ComputerCapability, error) {
	if err := requireRWX(meta); err != nil {
		return ComputerCapability{}, err
	}
	r, ok := s.targetToolExecutor.(*ComputerUseRuntime)
	if !ok {
		return ComputerCapability{}, errors.New("computer runtime unavailable")
	}
	control := r.controlForTarget("xvfb-main")
	select {
	case <-ctx.Done():
		return ComputerCapability{}, ctx.Err()
	case control.gate <- struct{}{}:
	}
	defer func() { <-control.gate }()
	control.mu.Lock()
	busy := control.threadID != "" || control.pause != nil
	control.mu.Unlock()
	if busy {
		return ComputerCapability{State: "in_use", Reason: "desktop_in_use"}, nil
	}
	r.mu.RLock()
	executor, closed := r.executors["xvfb-main"], r.closed
	r.mu.RUnlock()
	verifier, ok := executor.(interface {
		VerifyComputerSetup(context.Context) ComputerCapability
	})
	if closed || !ok {
		return ComputerCapability{}, errors.New("private desktop unavailable")
	}
	result := verifier.VerifyComputerSetup(ctx)
	return result, ctx.Err()
}

// Advanced discovery uses the same expiring, thread-scoped candidates as all
// other page selection. Merely entering an endpoint never connects a page.
func (s *Service) ComputerBrowserCandidates(ctx context.Context, meta *session.Meta, threadID, endpoint string) (ComputerTargetInventory, error) {
	if err := requireRWX(meta); err != nil {
		return ComputerTargetInventory{}, err
	}
	if err := s.requireEndpointThreadAuthority(ctx, meta.EndpointID, threadID); err != nil {
		return ComputerTargetInventory{}, err
	}
	host, ok := s.targetToolExecutor.(*ComputerUseRuntime)
	if !ok {
		return ComputerTargetInventory{}, errors.New("computer runtime unavailable")
	}
	return host.computerBrowserCandidates(ctx, threadID, endpoint, s.ToolTargetPolicy())
}

func (r *ComputerUseRuntime) computerBrowserCandidates(ctx context.Context, threadID, endpoint string, policy ToolTargetPolicy) (ComputerTargetInventory, error) {
	call := TargetToolCall{ThreadID: threadID, ToolName: "computer.targets"}
	inventory, err := r.ComputerTargets(ctx, call, policy)
	if err != nil {
		return inventory, err
	}
	if len(normalizeToolTargetPolicy(policy).AllowedTargetIDs) > 0 {
		return inventory, computerTargetFailure(call, "TARGET_NOT_ALLOWED")
	}
	tabs, err := r.BrowserTabs(ctx, endpoint)
	if err != nil {
		return inventory, err
	}
	for _, tab := range tabs {
		connection := ComputerBrowserConnection{CDPURL: endpoint, ProfileID: tab.ProfileID, TabID: tab.ID, TabTitle: tab.Title, TabURL: tab.URL}
		if err := connection.validate(); err != nil {
			return inventory, err
		}
		target := TargetDescriptor{ID: r.managedTabTargetID(endpoint, tab.ID), Ready: true}
		view := ComputerCandidate{TargetID: target.ID, Kind: "browser.connected", DisplayName: "Chromium", ProfileName: tab.ProfileID, Title: tab.Title, URL: tab.URL, State: r.computerTargetState(target, threadID)}
		if err := r.appendComputerCandidate(&inventory, threadID, view, &connection); err != nil {
			return inventory, err
		}
	}
	return inventory, ctx.Err()
}
