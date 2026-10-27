package ai

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"unicode/utf8"
)

// Application discovery is a bounded catalog query, not a target or grant.
type computerNativeApplication struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	AppBundleID string `json:"app_bundle_id"`
	State       string `json:"state"`
}

func (e *NativeDesktopTargetExecutor) applications(ctx context.Context, query string) ([]computerNativeApplication, error) {
	args, _ := json.Marshal(map[string]string{"query": query})
	result, err := e.ExecuteTargetTool(ctx, TargetToolCall{TargetID: "desktop-main", ToolName: "computer.applications", Arguments: args})
	if err != nil {
		return nil, err
	}
	payload, _ := result.Result.(map[string]any)
	body, _ := json.Marshal(payload["applications"])
	var apps []computerNativeApplication
	if json.Unmarshal(body, &apps) != nil || apps == nil || len(apps) > 64 {
		return nil, errors.New("invalid native application inventory")
	}
	for _, app := range apps {
		if !strings.HasPrefix(app.ID, "macos-") || app.AppBundleID == "" || app.DisplayName == "" || (app.State != "running" && app.State != "not_running") {
			return nil, errors.New("invalid native application")
		}
	}
	return apps, nil
}

func (r *ComputerUseRuntime) nativeComputerExecutor() *NativeDesktopTargetExecutor {
	r.mu.RLock()
	defer r.mu.RUnlock()
	native, _ := r.executors["desktop-main"].(*NativeDesktopTargetExecutor)
	return native
}

func (r *ComputerUseRuntime) computerApplicationCandidates(ctx context.Context, call TargetToolCall, policy ToolTargetPolicy, inventory ComputerTargetInventory, query string) (ComputerTargetInventory, error) {
	if utf8.RuneCountInString(query) > 120 || strings.TrimSpace(query) == "" || inventory.BrowserSource != "auto" {
		return inventory, computerTargetFailure(call, "INVALID_REQUEST")
	}
	native := r.nativeComputerExecutor()
	if native == nil {
		return inventory, computerTargetFailure(call, "TARGET_CAPABILITY_UNAVAILABLE")
	}
	targets, err := r.ListComputerTargets(ctx)
	if err != nil {
		return inventory, err
	}
	for _, target := range targets {
		if target.Kind != "desktop.window" || !targetAllowedByPolicy(policy, target.ID) || (!strings.Contains(strings.ToLower(target.DisplayName), strings.ToLower(query)) && !strings.Contains(strings.ToLower(target.AppBundleID), strings.ToLower(query))) {
			continue
		}
		if err := r.appendComputerCandidate(&inventory, call.ThreadID, ComputerCandidate{TargetID: target.ID, Kind: target.Kind, DisplayName: target.DisplayName, AppBundleID: target.AppBundleID, State: r.computerTargetState(target, call.ThreadID)}, nil); err != nil {
			return inventory, err
		}
	}
	if len(normalizeToolTargetPolicy(policy).AllowedTargetIDs) > 0 {
		return inventory, nil
	}
	apps, err := native.applications(ctx, query)
	if err != nil {
		return inventory, err
	}
	for _, app := range apps {
		if err := r.appendComputerCandidate(&inventory, call.ThreadID, ComputerCandidate{ApplicationID: app.ID, Kind: "desktop.application", DisplayName: app.DisplayName, AppBundleID: app.AppBundleID, State: app.State}, nil); err != nil {
			return inventory, err
		}
	}
	return inventory, nil
}

type computerApplicationSelection struct {
	state      string
	candidates []ComputerCandidate
	cause      error
}

func (e *computerApplicationSelection) Unwrap() error { return e.cause }

func (e *computerApplicationSelection) Error() string {
	return "Application opened; choose an accessible window (" + e.state + ")"
}

func (r *ComputerUseRuntime) selectComputerApplication(ctx context.Context, call TargetToolCall, candidate ComputerCandidate, policy ToolTargetPolicy) (TargetDescriptor, error) {
	var target TargetDescriptor
	if len(normalizeToolTargetPolicy(policy).AllowedTargetIDs) > 0 {
		return target, computerTargetFailure(call, "TARGET_NOT_ALLOWED")
	}
	native := r.nativeComputerExecutor()
	if native == nil {
		return target, computerTargetFailure(call, "TARGET_CAPABILITY_UNAVAILABLE")
	}
	control := r.controlForTarget("desktop-main")
	select {
	case <-ctx.Done():
		return target, ctx.Err()
	case control.gate <- struct{}{}:
	}
	defer func() { <-control.gate }()
	if err := r.authorizeComputerCall(ctx, &call); err != nil {
		return target, err
	}
	if err := r.requireComputerSelectionOpen(call); err != nil {
		return target, err
	}
	for _, existing := range r.registry.Snapshot() {
		if existing.AppBundleID != candidate.AppBundleID {
			continue
		}
		owned := r.controlForTarget(existing.ID)
		owned.mu.Lock()
		busy := owned.threadID != "" && (owned.threadID != call.ThreadID || owned.runID != "" && owned.runID != call.RunID)
		pause := owned.pauseError(call)
		owned.mu.Unlock()
		if busy {
			return target, computerTargetFailure(call, "TARGET_IN_USE")
		}
		if pause != nil {
			return target, pause
		}
	}
	if !call.fullAccess && (!slices.Contains(call.allowedApps, candidate.AppBundleID) || !call.allowForeground) {
		safety := &InteractionSafetyDecision{Level: "takeover", RequiredApp: candidate.AppBundleID}
		if !call.allowForeground {
			safety.ReasonCodes = []string{"foreground_permission"}
		}
		return target, &targetToolPolicyError{code: "interaction_takeover_required", tool: call.ToolName, safety: safety}
	}
	launch := call
	launch.TargetID, launch.ToolName = "desktop-main", "computer.open_application"
	launch.Arguments, _ = json.Marshal(map[string]string{"application_id": candidate.ApplicationID, "app_bundle_id": candidate.AppBundleID})
	result, err := native.ExecuteTargetTool(ctx, launch)
	if err != nil {
		return target, err
	}
	payload, _ := result.Result.(map[string]any)
	body, _ := json.Marshal(payload["targets"])
	var windows []TargetDescriptor
	if payload["action_executed"] != true || json.Unmarshal(body, &windows) != nil || windows == nil || len(windows) > 128 {
		return target, errComputerEffectUnknown
	}
	selection := &computerApplicationSelection{state: "no_accessible_window", candidates: []ComputerCandidate{}}
	for _, window := range windows {
		if !strings.HasPrefix(window.ID, "macos-window-") || window.Kind != "desktop.window" || window.AppBundleID != candidate.AppBundleID {
			return target, errComputerEffectUnknown
		}
		if err := r.registry.Register(window); err != nil {
			selection.state, selection.cause = "selection_failed", err
			return target, selection
		}
		r.mu.Lock()
		r.executors[window.ID] = native
		r.mu.Unlock()
		view, err := r.rememberComputerCandidate(call.ThreadID, ComputerCandidate{TargetID: window.ID, Kind: window.Kind, DisplayName: window.DisplayName, AppBundleID: window.AppBundleID, State: r.computerTargetState(window, call.ThreadID)}, nil)
		if err != nil {
			selection.state, selection.cause = "selection_failed", err
			return target, selection
		}
		selection.candidates = append(selection.candidates, view)
	}
	if len(windows) == 1 {
		selected, err := r.selectComputerTarget(ctx, call, windows[0])
		if err != nil {
			selection.state, selection.cause = "selection_failed", err
			return selected, selection
		}
		return selected, nil
	}
	if len(windows) > 1 {
		selection.state = "choose_window"
	}
	return target, selection
}
