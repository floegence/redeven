package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/session"
)

type ComputerBrowserConnection struct {
	nativeTargetID     string // Runtime-owned stable native identity for workspace resolution.
	privatePopup       bool   // Set only by the shared source owner's managed popup event.
	ManagedProfileID   string `json:"managed_profile_id,omitempty"`
	ExtensionProfileID string `json:"extension_profile_id,omitempty"`
	NewTab             bool   `json:"new_tab,omitempty"`
	CDPURL             string `json:"cdp_url"`
	TabID              string `json:"tab_id"`
	TabTitle           string `json:"tab_title,omitempty"`
	TabURL             string `json:"tab_url,omitempty"`
	ProfileID          string `json:"profile_id"`
}

func (c ComputerBrowserConnection) validate() error {
	if c.ManagedProfileID != "" {
		if len(c.ManagedProfileID) > 64 || c.ExtensionProfileID != "" || c.CDPURL != "" || c.ProfileID != "" || c.NewTab == (c.TabID != "") || len(c.TabID) > 256 {
			return errors.New("invalid managed browser connection")
		}
		return nil
	}
	if c.ExtensionProfileID != "" {
		if len(c.ExtensionProfileID) > 64 || c.CDPURL != "" || c.ProfileID != "" || (c.NewTab && c.TabID != "") || (!c.NewTab && c.TabID == "") {
			return errors.New("invalid extension connection")
		}
		if !c.NewTab {
			if c.TabURL == "" || len(c.TabURL) > 8192 || len(c.TabTitle) > 512 {
				return errors.New("refresh and select a browser tab")
			}
			id, err := strconv.ParseUint(c.TabID, 10, 32)
			if err != nil || id == 0 {
				return errors.New("invalid browser tab")
			}
		} else if c.TabURL != "" || c.TabTitle != "" {
			return errors.New("a new tab has no prior selection")
		}
		return nil
	}
	if len(c.TabURL) > 8192 || len(c.TabTitle) > 512 || c.NewTab == (c.TabID != "") || len(c.CDPURL) > 8192 || len(c.TabID) > 256 || len(c.ProfileID) > 256 || strings.TrimSpace(c.ProfileID) == "" {
		return errors.New("select a browser profile and tab")
	}
	endpoint, err := url.Parse(c.CDPURL)
	if err != nil || endpoint.Hostname() == "" || endpoint.User != nil || endpoint.Fragment != "" || (endpoint.Scheme != "http" && endpoint.Scheme != "https" && endpoint.Scheme != "ws" && endpoint.Scheme != "wss") {
		return errors.New("invalid browser endpoint")
	}
	return nil
}

type ComputerBrowserTab struct {
	Availability          string   `json:"availability,omitempty"`
	Pinned                bool     `json:"pinned,omitempty"`
	Loading               bool     `json:"loading,omitempty"`
	WindowID              int      `json:"window_id,omitempty"`
	Index                 int      `json:"index,omitempty"`
	NativeTargetID        string   `json:"native_target_id,omitempty"`
	OpenerNativeTargetIDs []string `json:"opener_native_target_ids,omitempty"`
	Private               bool     `json:"private,omitempty"`
	OpenerTabIDs          []string `json:"opener_tab_ids,omitempty"`
	OpenerTabID           string   `json:"opener_tab_id,omitempty"`
	ID                    string   `json:"id"`
	ProfileID             string   `json:"profile_id"`
	Title                 string   `json:"title"`
	URL                   string   `json:"url"`
}

func (s *Service) ComputerBrowserTabs(ctx context.Context, meta *session.Meta, endpoint string) ([]ComputerBrowserTab, error) {
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	host, ok := s.targetToolExecutor.(*ComputerUseRuntime)
	if !ok {
		return nil, errors.New("computer runtime is unavailable")
	}
	return host.BrowserTabs(ctx, endpoint)
}

func (r *ComputerUseRuntime) BrowserTabs(ctx context.Context, endpoint string) ([]ComputerBrowserTab, error) {
	tabs, err := r.cdpBrowserTabs(ctx, endpoint, "inventory", "")
	if err != nil {
		return nil, err
	}
	r.connectMu.Lock()
	defer r.connectMu.Unlock()
	tabs, err = r.browserInventoryPrivacy(ctx, endpoint, tabs)
	return slices.DeleteFunc(tabs, func(tab ComputerBrowserTab) bool { return tab.Private }), err
}

func (r *ComputerUseRuntime) cdpBrowserTabs(ctx context.Context, endpoint, command, profile string) ([]ComputerBrowserTab, error) {
	u, err := url.Parse(endpoint)
	if err != nil || u.Hostname() == "" || u.User != nil || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "ws" && u.Scheme != "wss") {
		return nil, errors.New("invalid browser connection endpoint")
	}
	base, err := r.registry.ResolveTarget(ctx, "current")
	if err != nil {
		return nil, err
	}
	r.mu.RLock()
	managed, ok := r.executors[base.ID].(*PlaywrightTargetExecutor)
	closed := r.closed
	r.mu.RUnlock()
	if !ok || closed || !filepath.IsAbs(managed.NodeBinary) || !filepath.IsAbs(managed.HelperPath) {
		return nil, errors.New("browser inventory unavailable")
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, managed.NodeBinary, filepath.Join(filepath.Dir(managed.HelperPath), "redevenBrowserInventory.mjs"), endpoint, command, profile)
	var output limitedComputerOutput
	cmd.Stdout = &output
	if err := cmd.Run(); err != nil {
		if command == "new_tab" {
			return nil, errBrowserOutcomeUnknown
		}
		return nil, &TargetStartupError{Code: "TARGET_CONNECTION_REQUIRED", Reason: "browser_inventory_unavailable"}
	}
	var result struct {
		ProtocolVersion int                  `json:"protocol_version"`
		Tabs            []ComputerBrowserTab `json:"tabs"`
		Error           string               `json:"error"`
	}
	if json.Unmarshal(output.body, &result) != nil || result.ProtocolVersion != 2 || result.Error != "" || len(result.Tabs) > 128 {
		if command == "new_tab" {
			return nil, errBrowserOutcomeUnknown
		}
		return nil, errors.New("invalid browser inventory")
	}
	return result.Tabs, nil
}

type limitedComputerOutput struct{ body []byte }

func (o *limitedComputerOutput) Write(data []byte) (int, error) {
	if len(o.body)+len(data) > 262144 {
		return 0, errors.New("computer output exceeds its limit")
	}
	o.body = append(o.body, data...)
	return len(data), nil
}

func (s *Service) DisconnectComputerBrowser(ctx context.Context, meta *session.Meta, targetID string) error {
	if err := requireRWX(meta); err != nil {
		return err
	}
	host, ok := s.targetToolExecutor.(*ComputerUseRuntime)
	if !ok {
		return errors.New("computer runtime is unavailable")
	}
	return host.disconnectBrowser(ctx, targetID)
}

func (r *ComputerUseRuntime) disconnectBrowser(ctx context.Context, targetID string) error {
	r.connectMu.Lock()
	defer r.connectMu.Unlock()
	target, err := r.registry.ResolveTarget(ctx, targetID)
	if err != nil || target.ID != targetID || (target.Kind != "browser.connected" && (target.Kind != "browser.managed" || target.ID == "browser-main")) {
		return errors.New("select a connected browser target")
	}
	r.mu.Lock()
	executor := r.executors[targetID]
	delete(r.executors, targetID)
	r.registry.remove(targetID)
	if sampler := r.liveFrames[targetID]; sampler != nil {
		sampler.cancel()
	}
	r.mu.Unlock()
	r.releaseScripts(func(key computerScriptKey) bool { return key.target == targetID })
	if closer, ok := executor.(interface{ Close() error }); ok {
		return closer.Close()
	}
	return nil
}

// CDP endpoint/profile identities originate in the authenticated connection UI.
// Each actual tab has one adapter; selecting another tab never replaces it.
func (r *ComputerUseRuntime) connectCDPBrowserLocked(ctx context.Context, connection ComputerBrowserConnection, targetID string) (TargetDescriptor, error) {
	command := "inventory"
	if connection.NewTab {
		command = "new_tab"
	}
	tabs, err := r.cdpBrowserTabs(ctx, connection.CDPURL, command, connection.ProfileID)
	if err != nil {
		return TargetDescriptor{}, err
	}
	tabs, err = r.browserInventoryPrivacy(ctx, connection.CDPURL, tabs)
	if err != nil {
		return TargetDescriptor{}, err
	}
	var chosen *ComputerBrowserTab
	for i := range tabs {
		if tabs[i].ProfileID == connection.ProfileID && (connection.NewTab || tabs[i].ID == connection.TabID) {
			chosen = &tabs[i]
			break
		}
	}
	if chosen == nil || chosen.Private || (!connection.NewTab && connection.TabURL != "" && (connection.TabURL != chosen.URL || connection.TabTitle != chosen.Title)) {
		return TargetDescriptor{}, &targetToolPolicyError{code: "target_selection_stale"}
	}
	if existing := r.managedTabTargetID(connection.CDPURL, chosen.ID); existing != "" {
		return r.ResolveTarget(ctx, existing)
	}
	if targetID == "" {
		digest := sha256.Sum256([]byte(r.browserServiceSnapshot().Generation + "\x00" + connection.CDPURL + "\x00" + chosen.ProfileID + "\x00" + chosen.ID))
		targetID = "connected-" + hex.EncodeToString(digest[:16])
	}
	resources, err := r.managedResources()
	if err != nil {
		return TargetDescriptor{}, err
	}
	executor := NewPlaywrightTargetExecutor(resources.NodeBinary, resources.HelperPath, resources.ProfileDir)
	executor.CDPURL, executor.TabID, executor.BrowserContextID = connection.CDPURL, chosen.ID, chosen.ProfileID
	executor.sourceHost, err = r.browserSourceHostLocked(ctx)
	if err != nil {
		return TargetDescriptor{}, err
	}
	target := TargetDescriptor{ID: targetID, Kind: "browser.connected", DisplayName: "Connected Chrome", Locality: "local", Capabilities: []string{"observe", "interaction"}, Ready: true, State: "ready", PermissionState: "granted"}
	if err := executor.EnsureTargetReady(ctx, targetID); err != nil {
		_ = executor.Close()
		return TargetDescriptor{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.registry.Register(target); err != nil {
		_ = executor.Close()
		return TargetDescriptor{}, err
	}
	r.executors[targetID] = executor
	return target, nil
}
