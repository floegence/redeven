package ai

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/session"
)

type ComputerBrowserConnection struct {
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
		if c.TabURL != "" || c.TabTitle != "" || len(c.ManagedProfileID) > 64 || c.ExtensionProfileID != "" || c.CDPURL != "" || c.ProfileID != "" || c.NewTab == (c.TabID != "") || len(c.TabID) > 256 {
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
	if c.TabURL != "" || c.TabTitle != "" || c.NewTab || len(c.CDPURL) > 8192 || len(c.TabID) > 256 || len(c.ProfileID) > 256 || strings.TrimSpace(c.TabID) == "" || strings.TrimSpace(c.ProfileID) == "" {
		return errors.New("select a browser profile and tab")
	}
	endpoint, err := url.Parse(c.CDPURL)
	if err != nil || endpoint.Hostname() == "" || endpoint.User != nil || endpoint.Fragment != "" || (endpoint.Scheme != "http" && endpoint.Scheme != "https" && endpoint.Scheme != "ws" && endpoint.Scheme != "wss") {
		return errors.New("invalid browser endpoint")
	}
	return nil
}

type ComputerBrowserTab struct {
	ID        string `json:"id"`
	ProfileID string `json:"profile_id"`
	Title     string `json:"title"`
	URL       string `json:"url"`
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
	cmd := exec.CommandContext(ctx, managed.NodeBinary, filepath.Join(filepath.Dir(managed.HelperPath), "redevenBrowserInventory.mjs"), endpoint)
	var output limitedComputerOutput
	cmd.Stdout = &output
	if err := cmd.Run(); err != nil {
		return nil, &TargetStartupError{Code: "TARGET_CONNECTION_REQUIRED", Reason: "browser_inventory_unavailable"}
	}
	var result struct {
		ProtocolVersion int                  `json:"protocol_version"`
		Tabs            []ComputerBrowserTab `json:"tabs"`
		Error           string               `json:"error"`
	}
	if json.Unmarshal(output.body, &result) != nil || result.ProtocolVersion != 2 || result.Error != "" || len(result.Tabs) > 128 {
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
