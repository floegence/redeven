package appserver

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	nativeapps "github.com/floegence/floe-native-apps"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/remotedesktop"
)

const remoteDesktopAPI = "/_redeven_proxy/api/remote-desktop"

func (g *Server) handleRemoteDesktopAPI(w http.ResponseWriter, r *http.Request) bool {
	if r.URL.Path != remoteDesktopAPI && !strings.HasPrefix(r.URL.Path, remoteDesktopAPI+"/") {
		return false
	}
	permission := requiredPermissionFull
	if r.Method == http.MethodGet && (r.URL.Path == remoteDesktopAPI || r.URL.Path == remoteDesktopAPI+"/setup" || r.URL.Path == remoteDesktopAPI+"/service") {
		permission = requiredPermissionRead
	}
	meta, ok := g.requireLocalAppPermission(w, r, localFloeAppAgent, permission)
	if !ok {
		return true
	}
	w.Header().Set("Cache-Control", "no-store")
	if g.remoteDesktop == nil {
		writeDesktopError(w, remotedesktop.ErrUnavailable)
		return true
	}
	owner := meta.UserPublicID
	var value any
	var err error
	action := ""
	switch {
	case r.URL.Path == remoteDesktopAPI && r.Method == http.MethodGet:
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		var status remotedesktop.Status
		status, err = g.remoteDesktop.Status(ctx, owner)
		if err == nil {
			cfg, loadErr := g.loadConfigLocked()
			if loadErr != nil {
				err = loadErr
			} else {
				status.Unattended = cfg.RemoteDesktop.RememberApproval()
				status.ApprovalPolicy = "session"
				if status.Unattended {
					status.ApprovalPolicy = "persistent"
				}
				if cfg.RemoteDesktop != nil {
					status.LastDisplayID = cfg.RemoteDesktop.LastDisplayID
				}
			}
			value = status
		}
	case r.URL.Path == remoteDesktopAPI+"/settings" && r.Method == http.MethodPut:
		var setting struct {
			Unattended *bool `json:"unattended"`
		}
		if decodeManagedJSON(r, &setting) != nil || setting.Unattended == nil {
			err = remotedesktop.ErrInvalid
			break
		}
		// Enabling reuse never grants OS permission. The native adapter still
		// requires an actual grant and returns host-action-required if absent.
		_, err = g.updateConfigLocked(func(cfg *config.Config) error {
			if cfg.RemoteDesktop == nil {
				cfg.RemoteDesktop = &config.RemoteDesktopConfig{}
			}
			cfg.RemoteDesktop.Unattended = *setting.Unattended
			cfg.RemoteDesktop.ApprovalPreferenceSet = true
			return nil
		})
		if err == nil {
			g.remoteDesktop.SetUnattended(*setting.Unattended)
		}
		policy := "session"
		if *setting.Unattended {
			policy = "persistent"
		}
		value = map[string]any{"unattended": *setting.Unattended, "approval_policy": policy}
		action = "remote_desktop_settings"
	case r.URL.Path == remoteDesktopAPI+"/authorization" && r.Method == http.MethodDelete:
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		err = g.remoteDesktop.ForgetAuthorization(ctx)
		value = map[string]string{"authorization": "needs_consent"}
		action = "remote_desktop_forget_authorization"
	case r.URL.Path == remoteDesktopAPI+"/setup" && r.Method == http.MethodGet:
		value, err = g.remoteDesktop.SetupStatus(owner)
	case r.URL.Path == remoteDesktopAPI+"/service" && r.Method == http.MethodGet:
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		value, err = g.remoteDesktop.SystemServiceStatus(ctx, owner)
	case r.URL.Path == remoteDesktopAPI+"/service/install" && r.Method == http.MethodPost:
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
		defer cancel()
		value, err = g.remoteDesktop.InstallLoginService(ctx, owner)
		action = "remote_desktop_service_install"
	case r.URL.Path == remoteDesktopAPI+"/service/install" && r.Method == http.MethodDelete:
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		value, err = g.remoteDesktop.UninstallLoginService(ctx, owner)
		action = "remote_desktop_service_install_cancel"
	case r.URL.Path == remoteDesktopAPI+"/service" && r.Method == http.MethodDelete:
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
		defer cancel()
		value, err = g.remoteDesktop.UninstallLoginService(ctx, owner)
		action = "remote_desktop_service_uninstall"
	case r.URL.Path == remoteDesktopAPI+"/setup" && r.Method == http.MethodPost:
		var req struct {
			RequestID string `json:"request_id"`
		}
		if decodeManagedJSON(r, &req) != nil {
			err = remotedesktop.ErrInvalid
			break
		}
		value, err = g.remoteDesktop.StartSetup(owner, req.RequestID)
		action = "remote_desktop_setup"
	case strings.HasPrefix(r.URL.Path, remoteDesktopAPI+"/setup/") && r.Method == http.MethodDelete:
		value, err = g.remoteDesktop.CancelSetup(owner, strings.TrimPrefix(r.URL.Path, remoteDesktopAPI+"/setup/"))
		action = "remote_desktop_setup_cancel"
	case r.URL.Path == remoteDesktopAPI+"/sessions" && r.Method == http.MethodPost:
		var req remotedesktop.CreateRequest
		if decodeManagedJSON(r, &req) != nil {
			err = remotedesktop.ErrInvalid
			break
		}
		cfg, loadErr := g.loadConfigLocked()
		if loadErr != nil {
			err = loadErr
			break
		}
		if req.DisplayID == "" && cfg.RemoteDesktop != nil {
			req.DisplayID = cfg.RemoteDesktop.LastDisplayID
		}
		value, err = g.remoteDesktop.Create(r.Context(), owner, req, cfg.RemoteDesktop.RememberApproval())
		action = "remote_desktop_connect"
	case strings.HasPrefix(r.URL.Path, remoteDesktopAPI+"/sessions/"):
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, remoteDesktopAPI+"/sessions/"), "/")
		if len(parts) == 1 && r.Method == http.MethodDelete {
			err = g.remoteDesktop.Disconnect(owner, parts[0])
			action = "remote_desktop_disconnect"
			break
		}
		if len(parts) == 1 && r.Method == http.MethodGet {
			value, err = g.remoteDesktop.Get(owner, parts[0])
			break
		}
		if len(parts) != 2 || r.Method != http.MethodPost {
			err = remotedesktop.ErrNotFound
			break
		}
		var req struct {
			Mode      string `json:"mode"`
			DisplayID string `json:"display_id"`
			Takeover  bool   `json:"takeover"`
		}
		if decodeManagedJSON(r, &req) != nil {
			err = remotedesktop.ErrInvalid
			break
		}
		switch parts[1] {
		case "mode":
			err = g.remoteDesktop.Change(owner, parts[0], "set_mode", req.Mode, req.Takeover)
			action = "remote_desktop_mode"
		case "takeover":
			err = g.remoteDesktop.Change(owner, parts[0], "set_mode", "control", true)
			action = "remote_desktop_takeover"
		case "display":
			err = g.remoteDesktop.Change(owner, parts[0], "select_display", req.DisplayID, false)
			action = "remote_desktop_display"
		case "lock":
			err = g.remoteDesktop.Change(owner, parts[0], "lock", "", false)
			action = "remote_desktop_lock"
		default:
			err = remotedesktop.ErrNotFound
		}
	default:
		err = remotedesktop.ErrNotFound
	}
	if action != "" {
		result := "success"
		if err != nil {
			result = "failure"
		}
		g.appendAudit(meta, action, result, nil, err)
	}
	if err != nil {
		writeDesktopError(w, err)
	} else {
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: value})
	}
	return true
}
func writeDesktopError(w http.ResponseWriter, err error) {
	status, code := http.StatusServiceUnavailable, "DESKTOP_UNAVAILABLE"
	switch {
	case errors.Is(err, remotedesktop.ErrForbidden), errors.Is(err, nativeapps.ErrForbidden):
		status, code = http.StatusForbidden, "DESKTOP_FORBIDDEN"
	case errors.Is(err, remotedesktop.ErrInvalid), errors.Is(err, nativeapps.ErrInvalid):
		status, code = http.StatusBadRequest, "DESKTOP_INVALID"
	case errors.Is(err, remotedesktop.ErrNotFound):
		status, code = http.StatusNotFound, "DESKTOP_NOT_FOUND"
	case errors.Is(err, remotedesktop.ErrControlInUse):
		status, code = http.StatusConflict, "DESKTOP_CONTROL_IN_USE"
	case errors.Is(err, remotedesktop.ErrAuthorizationBusy):
		status, code = http.StatusConflict, "DESKTOP_AUTHORIZATION_BUSY"
	case errors.Is(err, remotedesktop.ErrServiceAuthorization):
		status, code = http.StatusConflict, "DESKTOP_SERVICE_AUTHORIZATION_REQUIRED"
	case errors.Is(err, remotedesktop.ErrServiceUnsupported):
		status, code = http.StatusNotImplemented, "DESKTOP_SERVICE_UNSUPPORTED"
	case errors.Is(err, remotedesktop.ErrServiceUnavailable):
		status, code = http.StatusServiceUnavailable, "DESKTOP_SERVICE_UNAVAILABLE"
	case errors.Is(err, nativeapps.ErrBusy):
		status, code = http.StatusConflict, "DESKTOP_SETUP_BUSY"
	}
	writeJSON(w, status, apiResp{OK: false, Error: "Remote desktop request failed", ErrorCode: code})
}

// All forward aliases, assets and both media channels retain full permission
// and session ownership. View-only is a control mode, never a permission grant.
func (g *Server) guardRemoteDesktopSession(w http.ResponseWriter, r *http.Request, s remotedesktop.Session, owner, base string) bool {
	meta, ok := g.requireLocalAppPermission(w, r, localFloeAppPortForward, requiredPermissionFull)
	if !ok {
		return true
	}
	if owner != meta.UserPublicID {
		writeDesktopError(w, remotedesktop.ErrForbidden)
		return true
	}
	path := strings.TrimPrefix(r.URL.Path, base)
	if !requireWindowSessionTransport(w, r, path) {
		return true
	}
	if path == windowTransportScript {
		g.serveDistFile(w, r, "window-transport.js")
		return true
	}
	w.Header().Set("Cache-Control", "no-store")
	switch {
	case path == remotedesktop.ViewerPath && r.Method == http.MethodGet:
		g.serveRemoteDesktop(w, r, s, base)
		return true
	case path == remotedesktop.ViewerPath+"ticket" && r.Method == http.MethodPost:
		ticket, err := g.remoteDesktop.Ticket(owner, s.ID)
		if err != nil {
			writeDesktopError(w, err)
		} else {
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: ticket})
		}
		return true
	case path == remotedesktop.ViewerPath+"disconnect" && r.Method == http.MethodPost:
		err := g.remoteDesktop.Disconnect(owner, s.ID)
		if err != nil {
			writeDesktopError(w, err)
		} else {
			writeJSON(w, http.StatusOK, apiResp{OK: true})
		}
		g.appendAudit(meta, "remote_desktop_disconnect", "requested", map[string]any{"session_id": s.ID}, err)
		return true
	case strings.HasPrefix(path, remotedesktop.ViewerPath+"assets/") && r.Method == http.MethodGet:
		serveRemoteDesktopAsset(w, r, strings.TrimPrefix(path, remotedesktop.ViewerPath+"assets/"))
		return true
	case path == remotedesktop.ViewerPath+"control" || path == remotedesktop.ViewerPath+"media":
		return false
	default:
		http.NotFound(w, r)
		return true
	}
}
