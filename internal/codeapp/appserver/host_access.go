package appserver

import (
	"context"
	"net/http"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/hostapps"
	"github.com/floegence/redeven/internal/session"
)

func (g *Server) hostAccessState(desktop bool) (string, error) {
	cfg, err := g.loadConfigLocked()
	if err != nil || cfg.HostAccess == nil {
		return "", err
	}
	if desktop {
		return cfg.HostAccess.Desktop, nil
	}
	return cfg.HostAccess.Applications, nil
}

func resolvedHostAccess(state string, ready bool) string {
	if state != "" {
		return state
	}
	if ready {
		return "enabled"
	}
	return "unconfigured"
}

// initializeHostAccess preserves already usable legacy features once. Later OS
// authorization changes are readiness only, never a product enable decision.
// Probes observe capabilities; they do not prompt, install, or create sessions.
func (g *Server) initializeHostAccess(ctx context.Context, owner string) error {
	g.hostAccessMu.Lock()
	defer g.hostAccessMu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	cfg, err := g.loadConfigLocked()
	if err != nil {
		return err
	}
	if cfg.HostAccess != nil && cfg.HostAccess.Applications != "" && cfg.HostAccess.Desktop != "" {
		return nil
	}
	apps, desktop := "unconfigured", "unconfigured"
	if g.hostApps != nil {
		catalog, err := g.hostApps.Catalog(ctx, owner, "en-US")
		if err != nil {
			return err
		}
		apps = resolvedHostAccess("", catalog.Availability.Ready || len(catalog.Sessions) > 0)
	}
	if g.remoteDesktop != nil {
		status, err := g.remoteDesktop.StatusTarget(ctx, owner, "")
		if err != nil {
			return err
		}
		desktop = resolvedHostAccess("", status.Capabilities.Screen || cfg.RemoteDesktop != nil)
	}
	initializedApps := cfg.HostAccess == nil || cfg.HostAccess.Applications == ""
	initializedDesktop := cfg.HostAccess == nil || cfg.HostAccess.Desktop == ""
	cfg, err = g.updateConfigLocked(func(cfg *config.Config) error {
		if cfg.HostAccess == nil {
			cfg.HostAccess = &config.HostAccessConfig{}
		}
		if cfg.HostAccess.Applications == "" {
			cfg.HostAccess.Applications = apps
		}
		if cfg.HostAccess.Desktop == "" {
			cfg.HostAccess.Desktop = desktop
		}
		return nil
	})
	if err == nil {
		if initializedApps {
			err = g.applyHostAccess(ctx, false, cfg.HostAccess.Applications)
		}
		if initializedDesktop {
			desktopErr := g.applyHostAccess(ctx, true, cfg.HostAccess.Desktop)
			if err == nil {
				err = desktopErr
			}
		}
	}
	return err
}

func (g *Server) applyHostAccess(ctx context.Context, desktop bool, state string) error {
	enabled := config.HostAccessAllowed(state)
	if desktop {
		if g.remoteDesktop != nil {
			g.remoteDesktop.SetAccessEnabled(enabled)
		}
		return nil
	}
	if access, ok := g.hostApps.(hostapps.AccessControl); ok {
		return access.SetAccessEnabled(ctx, enabled)
	}
	return nil
}

func (g *Server) allowHostAccess(w http.ResponseWriter, desktop bool) bool {
	state, err := g.hostAccessState(desktop)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, ErrorCode: "HOST_ACCESS_UNAVAILABLE", Error: "Host access settings are unavailable"})
		return false
	}
	if !config.HostAccessAllowed(state) {
		writeJSON(w, http.StatusConflict, apiResp{OK: false, ErrorCode: "HOST_ACCESS_DISABLED", Error: "Complete host access setup before connecting"})
		return false
	}
	return true
}

func (g *Server) updateHostAccess(w http.ResponseWriter, r *http.Request, meta *session.Meta, desktop bool) {
	var req struct {
		State string `json:"state"`
	}
	if decodeManagedJSON(r, &req) != nil || (req.State != "enabled" && req.State != "paused" && req.State != "unconfigured") {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, ErrorCode: "HOST_ACCESS_INVALID", Error: "An explicit access state is required"})
		return
	}
	g.hostAccessMu.Lock()
	defer g.hostAccessMu.Unlock()
	_, err := g.updateConfigLocked(func(cfg *config.Config) error {
		if cfg.HostAccess == nil {
			cfg.HostAccess = &config.HostAccessConfig{}
		}
		if desktop {
			cfg.HostAccess.Desktop = req.State
			if req.State == "unconfigured" {
				cfg.RemoteDesktop = nil
			}
		} else {
			cfg.HostAccess.Applications = req.State
		}
		return nil
	})
	if err == nil {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 15*time.Second)
		err = g.applyHostAccess(ctx, desktop, req.State)
		cancel()
	}
	feature := "applications"
	if desktop {
		feature = "desktop"
	}
	outcome := "success"
	if err != nil {
		outcome = "failure"
	}
	g.appendAudit(meta, "host_access_settings", outcome, map[string]any{"feature": feature, "state": req.State}, err)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, ErrorCode: "HOST_ACCESS_UPDATE_FAILED", Error: "Refresh host access settings to check the outcome"})
		return
	}
	writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]string{"state": req.State}})
}
