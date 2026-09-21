package appserver

import (
	"crypto/rand"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"html/template"
	"net/http"
	"strings"

	nativeapps "github.com/floegence/floe-native-apps"
	"github.com/floegence/redeven/internal/hostapps"
)

const hostApplicationsAPI = "/_redeven_proxy/api/host-applications"
const hostApplicationBoot = "/_redeven_host_app/"

func (g *Server) handleHostApplicationsAPI(w http.ResponseWriter, r *http.Request) bool {
	if r.URL.Path != hostApplicationsAPI && !strings.HasPrefix(r.URL.Path, hostApplicationsAPI+"/") {
		return false
	}
	permission := requiredPermissionFull
	if r.Method == http.MethodGet {
		permission = requiredPermissionRead
	}
	meta, ok := g.requireLocalAppPermission(w, r, localFloeAppAgent, permission)
	if !ok {
		return true
	}
	w.Header().Set("Cache-Control", "no-store")
	if g.hostApps == nil {
		writeHostAppError(w, hostapps.ErrUnavailable)
		return true
	}
	if r.URL.Path == hostApplicationsAPI+"/setup" || strings.HasPrefix(r.URL.Path, hostApplicationsAPI+"/setup/") {
		g.handleHostApplicationSetup(w, r, meta.UserPublicID)
		if r.Method != http.MethodGet {
			g.appendAudit(meta, "host_application_setup_request", "requested", map[string]any{"method": r.Method}, nil)
		}
		return true
	}
	switch {
	case r.Method == http.MethodGet && r.URL.Path == hostApplicationsAPI+"/sessions":
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: g.hostApps.Sessions(meta.UserPublicID)})
	case r.Method == http.MethodGet && r.URL.Path == hostApplicationsAPI:
		catalog, err := g.hostApps.Catalog(r.Context(), meta.UserPublicID, r.URL.Query().Get("locale"))
		if err != nil {
			writeHostAppError(w, err)
		} else {
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: catalog})
		}
	case r.Method == http.MethodPost && r.URL.Path == hostApplicationsAPI+"/permissions":
		var req struct {
			Permission string `json:"permission"`
		}
		if decodeManagedJSON(r, &req) != nil {
			writeHostAppError(w, hostapps.ErrInvalid)
			return true
		}
		if err := g.hostApps.Permissions(r.Context(), req.Permission); err != nil {
			writeHostAppError(w, err)
			return true
		}
		g.appendAudit(meta, "host_application_permission_request", "success", map[string]any{"permission": req.Permission}, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true})
	case r.Method == http.MethodPost && r.URL.Path == hostApplicationsAPI+"/sessions":
		var req hostapps.LaunchRequest
		if decodeManagedJSON(r, &req) != nil {
			writeHostAppError(w, hostapps.ErrInvalid)
			return true
		}
		view, err := g.hostApps.Launch(r.Context(), meta.UserPublicID, req)
		if err != nil {
			g.appendAudit(meta, "host_application_launch", "failure", map[string]any{"application_id": truncateString(req.ApplicationID, 160)}, err)
			writeHostAppError(w, err)
			return true
		}
		g.appendAudit(meta, "host_application_launch", "success", map[string]any{"application_id": view.Application.ID, "session_id": view.ID}, nil)
		writeJSON(w, http.StatusAccepted, apiResp{OK: true, Data: view})
	case r.Method == http.MethodPost && r.URL.Path == hostApplicationsAPI:
		var req hostapps.AddRequest
		if decodeManagedJSON(r, &req) != nil {
			writeHostAppError(w, hostapps.ErrInvalid)
			return true
		}
		err := g.hostApps.Add(r.Context(), req)
		if err != nil {
			writeHostAppError(w, err)
			return true
		}
		g.appendAudit(meta, "host_application_add", "success", map[string]any{"name": req.Name}, nil)
		writeJSON(w, http.StatusCreated, apiResp{OK: true})
	case r.Method == http.MethodDelete && strings.HasPrefix(r.URL.Path, hostApplicationsAPI+"/sessions/"):
		id := strings.TrimPrefix(r.URL.Path, hostApplicationsAPI+"/sessions/")
		if strings.Contains(id, "/") {
			writeHostAppError(w, hostapps.ErrNotFound)
			return true
		}
		err := g.hostApps.Stop(r.Context(), meta.UserPublicID, id)
		if err != nil {
			writeHostAppError(w, err)
			return true
		}
		g.appendAudit(meta, "host_application_stop", "success", map[string]any{"session_id": id}, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true})
	default:
		writeJSON(w, http.StatusNotFound, apiResp{OK: false, ErrorCode: "HOST_APP_NOT_FOUND", Error: "not found"})
	}
	return true
}

func writeHostAppError(w http.ResponseWriter, err error) {
	status, code := http.StatusInternalServerError, "HOST_APP_FAILED"
	switch {
	case errors.Is(err, nativeapps.ErrForbidden):
		status, code = http.StatusForbidden, "HOST_APP_FORBIDDEN"
	case errors.Is(err, nativeapps.ErrBusy):
		status, code = http.StatusConflict, "HOST_APP_SETUP_BUSY"
	case errors.Is(err, hostapps.ErrUnavailable), errors.Is(err, nativeapps.ErrUnsupported):
		status, code = http.StatusServiceUnavailable, "HOST_APP_UNAVAILABLE"
	case errors.Is(err, hostapps.ErrNotFound):
		status, code = http.StatusNotFound, "HOST_APP_NOT_FOUND"
	case errors.Is(err, hostapps.ErrInvalid), errors.Is(err, nativeapps.ErrInvalid):
		status, code = http.StatusBadRequest, "HOST_APP_INVALID"
	case errors.Is(err, hostapps.ErrLimit):
		status, code = http.StatusConflict, "HOST_APP_LIMIT"
	}
	writeJSON(w, status, apiResp{OK: false, Error: "Host application request failed", ErrorCode: code})
}

// guardHostApplicationForward keeps interactive application control behind the
// same full permission and owner boundary as launch, including alternate forwards
// to the same loopback listener. Xpra independently authenticates its WebSocket.
func (g *Server) guardHostApplicationForward(w http.ResponseWriter, r *http.Request, target, base string) bool {
	if g.hostApps == nil {
		return false
	}
	s, owner, found := g.hostApps.ForTarget(target)
	if !found {
		return false
	}
	return g.guardHostApplicationSession(w, r, s, owner, base)
}

func (g *Server) guardHostApplicationSession(w http.ResponseWriter, r *http.Request, s hostapps.Session, owner, base string) bool {
	meta, ok := g.requireLocalAppPermission(w, r, localFloeAppPortForward, requiredPermissionFull)
	if !ok {
		return true
	}
	if owner != meta.UserPublicID {
		http.Error(w, "permission denied", http.StatusForbidden)
		return true
	}
	path := strings.TrimPrefix(r.URL.Path, base)
	if path == hostApplicationBoot+"state" {
		w.Header().Set("Cache-Control", "no-store")
		password := ""
		if s.State == "running" || s.State == "starting" {
			password = g.hostApps.Password(s.ID)
		}
		writeJSON(w, http.StatusOK, map[string]any{"state": s.State, "error_code": s.ErrorCode, "password": password})
		return true
	}
	if path == hostApplicationBoot {
		g.serveHostApplicationBoot(w, r, s, base)
		return true
	}
	if s.State == "ended" || s.State == "failed" {
		http.Error(w, "application session ended", http.StatusGone)
		return true
	}
	return false
}

func (g *Server) serveHostApplicationBoot(w http.ResponseWriter, _ *http.Request, s hostapps.Session, base string) {
	var random [18]byte
	_, _ = rand.Read(random[:])
	nonce := base64.RawStdEncoding.EncodeToString(random[:])
	config, _ := json.Marshal(map[string]any{"base": base, "copy": s.Presentation, "icon": s.Application.Icon, "backend": s.Backend})
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; img-src data: blob:; connect-src 'self'; frame-src 'self'; script-src 'nonce-"+nonce+"'; style-src 'nonce-"+nonce+"'; base-uri 'none'; frame-ancestors 'none'")
	script := hostApplicationJS
	if s.Backend == "macos" {
		script = macHostApplicationJS
	}
	_ = hostApplicationBootTemplate.Execute(w, struct {
		Name, Nonce, Locale string
		Config, Script      template.JS
		Style               template.CSS
	}{s.Application.Name, nonce, s.Presentation.Locale, template.JS(config), template.JS(script), template.CSS(hostApplicationCSS)})
}

//go:embed host_application_viewer/viewer.html
var hostApplicationHTML string

//go:embed host_application_viewer/viewer.css
var hostApplicationCSS string

//go:embed host_application_viewer/viewer.js
var hostApplicationJS string

var hostApplicationBootTemplate = template.Must(template.New("host-app").Parse(hostApplicationHTML))

//go:embed host_application_viewer/macos.js
var macHostApplicationJS string
