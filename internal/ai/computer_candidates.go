package ai

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"sort"
	"strings"
	"time"
)

// Candidates are short-lived discovery facts, not grants or a second selection
// store. Only the Runtime can turn their opaque references into connections.
type ComputerCandidate struct {
	CandidateRef string `json:"candidate_ref"`
	TargetID     string `json:"target_id,omitempty"`
	Kind         string `json:"kind"`
	DisplayName  string `json:"display_name"`
	ProfileName  string `json:"profile_name,omitempty"`
	Title        string `json:"title,omitempty"`
	URL          string `json:"url,omitempty"`
	AppBundleID  string `json:"app_bundle_id,omitempty"`
	OpenerTabID  string `json:"opener_tab_id,omitempty"`
	State        string `json:"state"`
	NewTab       bool   `json:"new_tab,omitempty"`
}

type ComputerTargetInventory struct {
	BrowserSource       string              `json:"browser_source"`
	ConnectionRequired  bool                `json:"connection_required,omitempty"`
	CurrentTargetID     string              `json:"current_target_id"`
	DefaultCandidateRef string              `json:"default_candidate_ref,omitempty"`
	Candidates          []ComputerCandidate `json:"candidates"`
}

type computerCandidate struct {
	view       ComputerCandidate
	threadID   string
	connection *ComputerBrowserConnection
	expires    time.Time
}

func (r *ComputerUseRuntime) rememberComputerCandidate(threadID string, view ComputerCandidate, connection *ComputerBrowserConnection) (ComputerCandidate, error) {
	now := time.Now()
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return view, errors.New("computer runtime is closed")
	}
	if r.candidates == nil {
		r.candidates = make(map[string]computerCandidate)
	}
	for ref, candidate := range r.candidates {
		if !candidate.expires.After(now) {
			delete(r.candidates, ref)
			continue
		}
		prior := candidate.view
		prior.CandidateRef = ""
		if candidate.threadID == threadID && prior == view && (candidate.connection == nil && connection == nil || candidate.connection != nil && connection != nil && *candidate.connection == *connection) {
			view.CandidateRef = ref
			return view, nil
		}
	}
	// Bounded even when many conversations discover resources without using them.
	if len(r.candidates) >= 2048 {
		var oldest string
		var expiry time.Time
		for ref, candidate := range r.candidates {
			if oldest == "" || candidate.expires.Before(expiry) {
				oldest, expiry = ref, candidate.expires
			}
		}
		delete(r.candidates, oldest)
	}
	seed := make([]byte, 16)
	if _, err := rand.Read(seed); err != nil {
		return view, err
	}
	view.CandidateRef = "candidate-" + hex.EncodeToString(seed)
	r.candidates[view.CandidateRef] = computerCandidate{view: view, threadID: threadID, connection: connection, expires: now.Add(10 * time.Minute)}
	return view, nil
}

func (r *ComputerUseRuntime) computerCandidate(threadID, ref string) (computerCandidate, error) {
	r.mu.RLock()
	candidate, exists := r.candidates[ref]
	closed := r.closed
	r.mu.RUnlock()
	if closed || !exists || candidate.threadID != threadID || !candidate.expires.After(time.Now()) {
		return computerCandidate{}, &targetToolPolicyError{code: "target_selection_stale"}
	}
	return candidate, nil
}

func (r *ComputerUseRuntime) extensionProfiles() []ComputerExtensionProfile {
	return r.extensionStatus().Profiles
}

func (r *ComputerUseRuntime) extensionTabs(ctx context.Context, profileID string) ([]ComputerBrowserTab, error) {
	client, err := r.extensionClient(profileID)
	if err != nil {
		return nil, err
	}
	return client.tabs(ctx)
}

func (r *ComputerUseRuntime) computerTargetState(target TargetDescriptor, threadID string) string {
	r.mu.RLock()
	control := r.controls[target.ID]
	r.mu.RUnlock()
	if control != nil {
		control.mu.Lock()
		busy := control.threadID != "" && control.threadID != threadID
		paused := control.threadID == threadID && control.pause != nil
		control.mu.Unlock()
		if busy {
			return "in_use"
		}
		if paused {
			return "user_control"
		}
	}
	if target.Kind == "desktop.screen" && target.ID == "desktop-main" && !target.Ready {
		return target.State
	}
	if target.Ready {
		return "ready"
	}
	return target.State
}

type computerBrowserProfile struct {
	name       string
	kind       string
	connection ComputerBrowserConnection
}

func (r *ComputerUseRuntime) personalBrowserProfiles() []computerBrowserProfile {
	profiles := []computerBrowserProfile{}
	for _, profile := range r.extensionProfiles() {
		profiles = append(profiles, computerBrowserProfile{name: profile.Name, kind: "browser.connected", connection: ComputerBrowserConnection{ExtensionProfileID: profile.ID, NewTab: true}})
	}
	r.mu.RLock()
	seen := map[string]bool{}
	for _, adapter := range r.executors {
		e, ok := adapter.(*PlaywrightTargetExecutor)
		if !ok || e.ManagedAttachment || e.CDPURL == "" {
			continue
		}
		key := e.CDPURL + "\x00" + e.BrowserContextID
		if seen[key] {
			continue
		}
		seen[key] = true
		profiles = append(profiles, computerBrowserProfile{name: "Connected Chrome", kind: "browser.connected", connection: ComputerBrowserConnection{CDPURL: e.CDPURL, ProfileID: e.BrowserContextID, NewTab: true}})
	}
	r.mu.RUnlock()
	sort.Slice(profiles, func(i, j int) bool {
		return computerProfileIdentity(profiles[i].connection) < computerProfileIdentity(profiles[j].connection)
	})
	return profiles
}

func computerProfileIdentity(connection ComputerBrowserConnection) string {
	if connection.ExtensionProfileID != "" {
		return "extension:" + connection.ExtensionProfileID
	}
	if connection.ManagedProfileID != "" {
		return "managed:" + connection.ManagedProfileID
	}
	return "cdp:" + connection.CDPURL + "\x00" + connection.ProfileID
}

// Inventory never starts a managed profile or creates a page.
func (r *ComputerUseRuntime) candidateBrowserTabs(ctx context.Context, connection ComputerBrowserConnection) ([]ComputerBrowserTab, error) {
	if connection.ExtensionProfileID != "" {
		return r.extensionTabs(ctx, connection.ExtensionProfileID)
	}
	if connection.ManagedProfileID != "" {
		r.connectMu.Lock()
		defer r.connectMu.Unlock()
		profile := r.managedProfiles[connection.ManagedProfileID]
		if profile == nil {
			return nil, nil
		}
		if profile.stopped() {
			delete(r.managedProfiles, connection.ManagedProfileID)
			return nil, nil
		}
		tabs, err := profile.call(ctx, "inventory")
		if ctx.Err() == nil && profile.stopped() {
			// A dead managed process needs no manual pairing. Discovery offers
			// a new page; only an authorized selection may restart the profile.
			delete(r.managedProfiles, connection.ManagedProfileID)
			return nil, nil
		}
		return tabs, err
	}
	tabs, err := r.BrowserTabs(ctx, connection.CDPURL)
	result := []ComputerBrowserTab{}
	for _, tab := range tabs {
		if tab.ProfileID == connection.ProfileID {
			result = append(result, tab)
		}
	}
	return result, err
}

func (r *ComputerUseRuntime) ComputerTargets(ctx context.Context, call TargetToolCall, policy ToolTargetPolicy) (ComputerTargetInventory, error) {
	inventory := ComputerTargetInventory{Candidates: []ComputerCandidate{}, BrowserSource: "auto"}
	var options struct {
		BrowserSource string `json:"browser_source"`
	}
	if len(call.Arguments) > 0 && json.Unmarshal(call.Arguments, &options) != nil {
		return inventory, errors.New("invalid browser source")
	}
	if options.BrowserSource != "" {
		inventory.BrowserSource = options.BrowserSource
	}
	source := inventory.BrowserSource
	if source != "auto" && source != "system" && source != "managed" {
		return inventory, errors.New("invalid browser source")
	}
	if err := r.authorizeComputerCall(ctx, &call); err != nil {
		return inventory, err
	}
	if call.RunID != "" {
		if err := r.requireComputerSelectionOpen(call); err != nil {
			return inventory, err
		}
	}
	if call.ThreadID == "" || r.targetBindings() == nil {
		return inventory, errors.New("computer discovery requires a thread")
	}
	selected, err := r.targetBindings().GetComputerTarget(ctx, call.ThreadID)
	if err != nil {
		return inventory, err
	}
	inventory.CurrentTargetID = selected
	targets := r.registry.Snapshot()
	if source == "auto" {
		targets, err = r.ListComputerTargets(ctx)
	}
	if err != nil {
		return inventory, err
	}

	for _, target := range targets {
		if (target.Kind == "browser.managed" && !r.managedBrowserEnabled()) || !targetAllowedByPolicy(policy, target.ID) || target.ID == "browser-main" || r.browserTargetHasInventory(target.ID) || (source == "system" && target.Kind != "browser.connected") || (source == "managed" && target.Kind != "browser.managed") {
			continue
		}
		if err := r.appendComputerCandidate(&inventory, call.ThreadID, ComputerCandidate{TargetID: target.ID, Kind: target.Kind, DisplayName: target.DisplayName, URL: target.CurrentURL, AppBundleID: target.AppBundleID, State: r.computerTargetState(target, call.ThreadID)}, nil); err != nil {
			return inventory, err
		}
	}
	allowNewPages := len(normalizeToolTargetPolicy(policy).AllowedTargetIDs) == 0
	profiles := []computerBrowserProfile{}
	if source != "managed" {
		profiles = r.personalBrowserProfiles()
	}
	if source != "system" && r.managedBrowserEnabled() {
		r.connectMu.Lock()
		managed, managedErr := r.managedProfilesLocked()
		r.connectMu.Unlock()
		if managedErr != nil && allowNewPages {
			if err := r.appendComputerCandidate(&inventory, call.ThreadID, ComputerCandidate{Kind: "browser.managed", DisplayName: "Headless Chromium", State: "setup_required"}, nil); err != nil {
				return inventory, err
			}
		}
		for _, profile := range managed {
			profiles = append(profiles, computerBrowserProfile{name: profile.Name, kind: "browser.managed", connection: ComputerBrowserConnection{ManagedProfileID: profile.ID, NewTab: true}})
		}
	}
	defaultProfile, _ := defaultComputerBrowserProfile(profiles)

	for _, profile := range profiles {
		connection := profile.connection
		profileName := profile.name
		if connection.ManagedProfileID == "browser-main" {
			profileName = ""
		}
		tabs, tabsErr := r.candidateBrowserTabs(ctx, connection)
		state := "ready"
		if profile.kind == "browser.managed" {
			if _, err := r.requireManagedBrowser(); err != nil {
				state = "installation_required"
			}
		}
		if tabsErr != nil {
			state = "connection_required"
		}
		if allowNewPages {
			if err := r.appendComputerCandidate(&inventory, call.ThreadID, ComputerCandidate{Kind: profile.kind, DisplayName: computerBrowserDisplayName(profile), ProfileName: profileName, NewTab: true, State: state}, &connection); err != nil {
				return inventory, err
			}
			if (state == "ready" || state == "installation_required") && computerProfileIdentity(connection) == computerProfileIdentity(defaultProfile.connection) {
				inventory.DefaultCandidateRef = inventory.Candidates[len(inventory.Candidates)-1].CandidateRef
			}
		}
		for _, tab := range tabs {
			var targetID string
			if connection.ExtensionProfileID != "" {
				targetID = r.extensionTabTargetID(connection.ExtensionProfileID, tab.ID)
			} else {
				endpoint := connection.CDPURL
				if connection.ManagedProfileID != "" {
					r.connectMu.Lock()
					if running := r.managedProfiles[connection.ManagedProfileID]; running != nil {
						endpoint = running.endpoint
					}
					r.connectMu.Unlock()
				}
				targetID = r.managedTabTargetID(endpoint, tab.ID)
			}
			if !allowNewPages && (targetID == "" || !targetAllowedByPolicy(policy, targetID)) {
				continue
			}
			target := TargetDescriptor{ID: targetID, Ready: true}
			view := ComputerCandidate{TargetID: targetID, Kind: profile.kind, DisplayName: computerBrowserDisplayName(profile), ProfileName: profileName, Title: tab.Title, URL: tab.URL, OpenerTabID: tab.OpenerTabID, State: r.computerTargetState(target, call.ThreadID)}
			tabConnection := connection
			tabConnection.NewTab, tabConnection.TabID, tabConnection.TabTitle, tabConnection.TabURL = false, tab.ID, tab.Title, tab.URL
			if err := r.appendComputerCandidate(&inventory, call.ThreadID, view, &tabConnection); err != nil {
				return inventory, err
			}
		}
	}
	for _, candidate := range inventory.Candidates {
		if candidate.TargetID == selected && strings.HasPrefix(candidate.Kind, "browser.") && candidate.State == "ready" {
			inventory.DefaultCandidateRef = candidate.CandidateRef
			break
		}
	}
	if source == "system" {
		if len(normalizeToolTargetPolicy(policy).AllowedTargetIDs) > 0 && len(inventory.Candidates) == 0 {
			return inventory, computerTargetFailure(call, "TARGET_NOT_ALLOWED")
		}
		inventory.ConnectionRequired = true
		for _, candidate := range inventory.Candidates {
			if candidate.Kind == "browser.connected" && (candidate.State == "ready" || candidate.State == "in_use" || candidate.State == "user_control") {
				inventory.ConnectionRequired = false
				break
			}
		}
	}
	return inventory, ctx.Err()
}

// Registered browser adapters retain identity, not proof that their page is
// still open. Their candidates come exclusively from fresh browser inventory.
func (r *ComputerUseRuntime) browserTargetHasInventory(targetID string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	switch executor := r.executors[targetID].(type) {
	case *PlaywrightTargetExecutor:
		return executor.CDPURL != ""
	case *extensionTargetExecutor:
		return true
	default:
		return false
	}
}

func (r *ComputerUseRuntime) extensionTabTargetID(profileID, tabID string) string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for id, executor := range r.executors {
		if e, ok := executor.(*extensionTargetExecutor); ok && e.client.profile.ID == profileID && e.tabID == tabID {
			return id
		}
	}
	return ""
}
func (r *ComputerUseRuntime) managedTabTargetID(endpoint, tabID string) string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for id, executor := range r.executors {
		if e, ok := executor.(*PlaywrightTargetExecutor); ok && e.CDPURL == endpoint && e.TabID == tabID {
			return id
		}
	}
	return ""
}

func (r *ComputerUseRuntime) SelectComputerCandidate(ctx context.Context, call TargetToolCall, ref string, policy ToolTargetPolicy) (TargetDescriptor, error) {
	if err := r.authorizeComputerCall(ctx, &call); err != nil {
		return TargetDescriptor{}, err
	}
	candidate, err := r.computerCandidate(call.ThreadID, ref)
	if err != nil {
		return TargetDescriptor{}, err
	}
	if err = r.requireComputerSelectionOpen(call); err != nil {
		return TargetDescriptor{}, err
	}
	if candidate.connection != nil && len(normalizeToolTargetPolicy(policy).AllowedTargetIDs) > 0 &&
		(candidate.connection.NewTab || candidate.view.TargetID == "" || !targetAllowedByPolicy(policy, candidate.view.TargetID)) {
		return TargetDescriptor{}, computerTargetFailure(call, "TARGET_NOT_ALLOWED")
	}
	var target TargetDescriptor
	if candidate.connection != nil {
		connection := *candidate.connection
		if !connection.NewTab {
			tabs, tabsErr := r.candidateBrowserTabs(ctx, connection)
			matched := false
			for _, tab := range tabs {
				if tab.ID == connection.TabID && tab.URL == connection.TabURL && tab.Title == connection.TabTitle {
					matched = true
					break
				}
			}
			if tabsErr != nil || !matched {
				return target, &targetToolPolicyError{code: "target_selection_stale"}
			}
		}
		if candidate.view.TargetID != "" {
			target, err = r.ResolveTarget(ctx, candidate.view.TargetID)
			if err == nil && r.computerTargetState(target, call.ThreadID) == "in_use" {
				return target, computerTargetFailure(call, "TARGET_IN_USE")
			}
		}
		if err != nil {
			return target, err
		}
		if err = r.authorizeComputerCall(ctx, &call); err != nil {
			return target, err
		}
		if err = r.requireComputerSelectionOpen(call); err != nil {
			return target, err
		}
		target, err = r.ConnectBrowser(ctx, connection)
	} else {
		if candidate.view.TargetID == "" {
			return target, &targetToolPolicyError{code: "target_setup_required"}
		}
		target, err = r.ResolveTarget(ctx, candidate.view.TargetID)
		if err == nil && strings.HasPrefix(target.ID, "macos-window-") {
			_, err = r.ListComputerTargets(ctx)
			if err == nil {
				target, err = r.ResolveTarget(ctx, candidate.view.TargetID)
				if err == nil && (target.AppBundleID != candidate.view.AppBundleID || target.DisplayName != candidate.view.DisplayName) {
					err = &targetToolPolicyError{code: "target_selection_stale"}
				}
			}
		}
	}
	if err != nil {
		return target, err
	}
	if !targetAllowedByPolicy(policy, target.ID) {
		return target, computerTargetFailure(call, "TARGET_NOT_ALLOWED")
	}
	return r.selectComputerTarget(ctx, call, target)
}

// UI and model selection share readiness, current permissions and the same
// target gate. A rejected selection never changes the durable working position.
func (r *ComputerUseRuntime) selectComputerTarget(ctx context.Context, call TargetToolCall, target TargetDescriptor) (TargetDescriptor, error) {
	if err := r.authorizeComputerCall(ctx, &call); err != nil {
		return target, err
	}
	if err := r.requireComputerSelectionOpen(call); err != nil {
		return target, err
	}
	var err error
	target, err = r.PrepareTarget(ctx, target)
	if err != nil {
		return target, err
	}
	if !target.Ready {
		return target, &targetToolPolicyError{code: targetReadinessErrorCode(target), target: target.ID, targetState: target.State, repairAction: targetRepairAction(target)}
	}
	call.TargetID = target.ID
	control := r.controlForTarget(target.ID)
	select {
	case <-ctx.Done():
		return target, ctx.Err()
	case control.gate <- struct{}{}:
	}
	defer func() { <-control.gate }()
	control.mu.Lock()
	busy := control.threadID != "" && (control.threadID != call.ThreadID || call.RunID == "" || control.runID != "" && control.runID != call.RunID)
	pauseErr := control.pauseError(call)
	control.mu.Unlock()
	if busy {
		return target, computerTargetFailure(call, "TARGET_IN_USE")
	}
	if pauseErr != nil {
		return target, pauseErr
	}
	if err = r.authorizeComputerCall(ctx, &call); err != nil {
		return target, err
	}
	if err = r.requireComputerSelectionOpen(call); err != nil {
		return target, err
	}
	r.mu.RLock()
	executor, closed := r.executors[target.ID], r.closed
	r.mu.RUnlock()
	if closed || executor == nil {
		return target, computerTargetFailure(call, "TARGET_CONNECTION_REQUIRED")
	}
	if strings.HasPrefix(target.Kind, "browser.") {
		selection := call
		selection.ToolName = "computer.select_target"
		selection.Arguments = nil
		result, selectErr := executor.ExecuteTargetTool(ctx, selection)
		if selectErr != nil {
			return target, selectErr
		}
		if takeoverResult(result, nil) {
			control.recordPause(call, result, nil)
			return target, &targetToolPolicyError{code: "interaction_takeover_required", target: target.ID, safety: result.Safety}
		}
	}
	if err = r.BindThreadTarget(ctx, call.ThreadID, target.ID); err != nil {
		return target, err
	}
	if call.RunID != "" {
		control.mu.Lock()
		control.threadID, control.turnID, control.runID = call.ThreadID, call.TurnID, call.RunID
		control.mu.Unlock()
	}
	r.releasePreviousComputerTarget(call)
	slog.Info("computer target selected", "thread_id", call.ThreadID, "target_id", target.ID, "source", target.Kind)
	return target, nil
}

func (r *run) execComputerManagement(ctx context.Context, toolID, toolName string, args map[string]any) (any, error) {
	host, ok := r.targetToolExecutor.(*ComputerUseRuntime)
	if !ok {
		return nil, errors.New("computer runtime is unavailable")
	}
	runID, threadID, turnID := r.floretCanonicalIdentity()
	call := TargetToolCall{ThreadID: threadID, TurnID: turnID, RunID: runID, ToolCallID: toolID, ToolName: toolName, revalidate: r.computerToolRevalidator(toolID, toolName)}
	if toolName == "computer.targets" {
		call.Arguments, _ = json.Marshal(args)
		inventory, err := host.ComputerTargets(ctx, call, r.toolTargetPolicy)
		if err != nil {
			return nil, err
		}
		if inventory.ConnectionRequired {
			return computerConnectionExecution(), nil
		}
		return inventory, nil
	}
	ref := strings.TrimSpace(anyToString(args["candidate_ref"]))
	if frozen, ok := ctx.Value(computerAuthorizedCandidateKey{}).(string); ok && ref != frozen {
		return nil, errors.New("computer candidate authorization changed")
	}
	target, err := host.SelectComputerCandidate(ctx, call, ref, r.toolTargetPolicy)
	if err != nil {
		return nil, err
	}
	return targetToolExecution{TargetID: target.ID, Payload: map[string]any{"target_id": target.ID, "target_name": target.DisplayName, "target_kind": target.Kind, "capabilities": target.Capabilities, "execution_location": target.Locality, "selected": true, "next_step": "Observe the selected page or application before acting."}}, nil
}

// Default selection describes a new task page without launching anything. The
// profile participates in the identity, so a changed connection cannot replace
// an already authorized resource between planning and execution.
func (r *ComputerUseRuntime) defaultThreadBrowser(threadID string) (TargetDescriptor, error) {
	profiles := r.personalBrowserProfiles()
	if r.managedBrowserEnabled() {
		profiles = append(profiles, computerBrowserProfile{name: "Default", kind: "browser.managed", connection: ComputerBrowserConnection{ManagedProfileID: "browser-main", NewTab: true}})
	}
	selected, err := defaultComputerBrowserProfile(profiles)
	if err != nil {
		return TargetDescriptor{}, err
	}
	connection := selected.connection
	kind, name, profile := selected.kind, computerBrowserDisplayName(selected), computerProfileIdentity(connection)

	digest := sha256.Sum256([]byte(threadID + "\x00" + profile))
	return TargetDescriptor{ID: "task-browser-" + hex.EncodeToString(digest[:16]), Kind: kind, DisplayName: name, Locality: "local", State: "stopped", Capabilities: []string{"observe", "interaction"}, connection: &connection}, nil
}

func (r *ComputerUseRuntime) requireComputerSelectionOpen(call TargetToolCall) error {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for targetID, control := range r.controls {
		control.mu.Lock()
		var err error
		if control.threadID == call.ThreadID {
			blocked := call
			blocked.TargetID = targetID
			err = control.pauseError(blocked)
		}
		control.mu.Unlock()
		if err != nil {
			return err
		}
	}
	return nil
}

func computerBrowserDisplayName(profile computerBrowserProfile) string {
	if profile.kind == "browser.managed" {
		if profile.connection.ManagedProfileID == "browser-main" {
			return "Headless Chromium"
		}
		return "Headless Chromium — " + profile.name
	}
	return "Connected browser — " + profile.name
}

// One rule for both discovery and direct first-use planning.
func defaultComputerBrowserProfile(profiles []computerBrowserProfile) (computerBrowserProfile, error) {
	var personal []computerBrowserProfile
	var managed computerBrowserProfile
	for _, profile := range profiles {
		if profile.kind == "browser.connected" {
			personal = append(personal, profile)
		}
		if profile.connection.ManagedProfileID == "browser-main" {
			managed = profile
		}
	}
	if len(personal) > 1 {
		return computerBrowserProfile{}, &targetToolPolicyError{code: "target_ambiguous"}
	}
	if len(personal) == 1 {
		return personal[0], nil
	}
	if managed.kind != "" {
		return managed, nil
	}
	return computerBrowserProfile{}, &targetToolPolicyError{code: "target_connection_required"}
}

func (r *ComputerUseRuntime) appendComputerCandidate(inventory *ComputerTargetInventory, threadID string, view ComputerCandidate, connection *ComputerBrowserConnection) error {
	if len(inventory.Candidates) >= 1024 {
		return errors.New("computer inventory exceeds its limit")
	}
	candidate, err := r.rememberComputerCandidate(threadID, view, connection)
	if err == nil {
		for i, prior := range inventory.Candidates {
			if view.TargetID != "" && prior.TargetID == view.TargetID {
				inventory.Candidates[i] = candidate
				return nil
			}
		}
		inventory.Candidates = append(inventory.Candidates, candidate)
	}
	return err
}
