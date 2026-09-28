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
	case r.Method == http.MethodGet && r.URL.Path == hostApplicationsAPI+"/running":
		running, err := g.hostApps.Running(r.Context(), meta.UserPublicID)
		if err != nil {
			writeHostAppError(w, err)
		} else {
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: running})
		}
	case r.Method == http.MethodPost && (r.URL.Path == hostApplicationsAPI+"/quit" || r.URL.Path == hostApplicationsAPI+"/terminate"):
		var req hostapps.QuitRequest
		if decodeManagedJSON(r, &req) != nil {
			writeHostAppError(w, hostapps.ErrInvalid)
			return true
		}
		action := "host_application_quit"
		var err error
		if r.URL.Path == hostApplicationsAPI+"/terminate" {
			action = "host_application_force_quit"
			err = g.hostApps.Terminate(r.Context(), meta.UserPublicID, req)
		} else {
			err = g.hostApps.Quit(r.Context(), meta.UserPublicID, req)
		}
		if err != nil {
			g.appendAudit(meta, action, "failure", map[string]any{"application_id": truncateString(req.ApplicationID, 160)}, err)
			writeHostAppError(w, err)
			return true
		}
		g.appendAudit(meta, action, "requested", map[string]any{"application_id": req.ApplicationID}, nil)
		writeJSON(w, http.StatusAccepted, apiResp{OK: true})
	case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, hostApplicationsAPI+"/sessions/") && strings.HasSuffix(r.URL.Path, "/detach"):
		id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, hostApplicationsAPI+"/sessions/"), "/detach")
		if id == "" || strings.Contains(id, "/") {
			writeHostAppError(w, hostapps.ErrNotFound)
			return true
		}
		if err := g.hostApps.Detach(r.Context(), meta.UserPublicID, id); err != nil {
			writeHostAppError(w, err)
			return true
		}
		g.appendAudit(meta, "host_application_detach", "success", map[string]any{"session_id": id}, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true})
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
	var unavailable *nativeapps.LaunchUnavailable
	if errors.As(err, &unavailable) {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "Host application launch is unavailable", "error_code": "HOST_APP_" + strings.ToUpper(hostapps.LaunchFailureCode(unavailable.Code)),
			"launch_diagnostic": hostapps.LaunchDiagnostic{Code: unavailable.Code, Stage: unavailable.Stage}})
		return
	}
	status, code := http.StatusInternalServerError, "HOST_APP_FAILED"
	switch {
	case errors.Is(err, hostapps.ErrViewerPreparation):
		status, code = http.StatusServiceUnavailable, "HOST_APP_VIEWER_PREPARATION_FAILED"
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
	case errors.Is(err, hostapps.ErrQuitRejected):
		status, code = http.StatusConflict, "HOST_APP_QUIT_REJECTED"
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
		writeJSON(w, http.StatusOK, map[string]any{"state": s.State, "error_code": s.ErrorCode, "end_reason": s.EndReason, "password": password, "launch_diagnostic": s.LaunchDiagnostic})
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
	config, _ := json.Marshal(map[string]any{"base": base, "copy": s.Presentation, "icon": s.Application.Icon, "backend": s.Backend, "initial": map[string]string{"state": s.State, "end_reason": s.EndReason, "error_code": s.ErrorCode}})
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; img-src data: blob:; connect-src 'self'; frame-src 'self'; script-src 'nonce-"+nonce+"'; style-src 'nonce-"+nonce+"'; base-uri 'none'; frame-ancestors 'none'")
	var script string
	switch s.Backend {
	case "linux":
		script = hostApplicationJS
	case "macos":
		script = macHostApplicationJS
	case "wayland":
		script = string(nativeapps.CursorClientSource()) + "\n" + linuxHostApplicationJS
	default:
		http.Error(w, "unsupported host application backend", http.StatusServiceUnavailable)
		return
	}
	_ = hostApplicationBootTemplate.Execute(w, struct {
		Name, Nonce, Locale, Theme string
		Config, Script             template.JS
		Style                      template.CSS
	}{s.Application.Name, nonce, s.Presentation.Locale, s.Presentation.ShellTheme, template.JS(config), template.JS(hostApplicationCatalogJS + "\n" + hostApplicationViewportJS + "\n" + hostApplicationInputJS + "\n" + hostApplicationPointerJS + "\n" + hostApplicationAppearanceJS + "\n" + hostApplicationConnectionJS + "\n" + hostApplicationToolbarJS + "\n" + hostApplicationCanvasJS + "\n" + script), template.CSS(hostApplicationAppearanceCSS + "\n" + hostApplicationInputCSS + "\n" + hostApplicationPointerCSS + "\n" + hostApplicationCSS)})
}

//go:embed host_application_viewer/viewer.html
var hostApplicationHTML string

//go:embed host_application_viewer/appearance.generated.css
var hostApplicationAppearanceCSS string

//go:embed host_application_viewer/catalog.generated.js
var hostApplicationCatalogJS string

//go:embed host_application_viewer/viewport.generated.js
var hostApplicationViewportJS string

//go:embed host_application_viewer/remote-input.generated.js
var hostApplicationInputJS string

//go:embed host_application_viewer/remote-input.generated.css
var hostApplicationInputCSS string

//go:embed host_application_viewer/remote-pointer.generated.js
var hostApplicationPointerJS string

//go:embed host_application_viewer/remote-pointer.generated.css
var hostApplicationPointerCSS string

//go:embed host_application_viewer/appearance.js
var hostApplicationAppearanceJS string

//go:embed host_application_viewer/viewer.css
var hostApplicationCSS string

//go:embed host_application_viewer/connection.js
var hostApplicationConnectionJS string

//go:embed host_application_viewer/viewer.js
var hostApplicationJS string

var hostApplicationBootTemplate = template.Must(template.New("host-app").Parse(hostApplicationHTML))

//go:embed host_application_viewer/macos.js
var macHostApplicationJS string

//go:embed host_application_viewer/canvas.js
var hostApplicationCanvasJS string

//go:embed host_application_viewer/linux.js
var linuxHostApplicationJS string

//go:embed host_application_viewer/toolbar.js
var hostApplicationToolbarJS string

func (g *Server) serveHostApplicationAssets(w http.ResponseWriter, r *http.Request, role originRole) {
	w.Header().Set("Cache-Control", "no-store")
	if (role != originRoleEnv && role != originRolePortForward) || g.hostApps == nil {
		http.NotFound(w, r)
		return
	}
	meta, ok := g.requireLocalAppPermission(w, r, localFloeAppPortForward, requiredPermissionFull)
	if !ok {
		return
	}
	// Remote port-forward origins must still name an admitted application share.
	// LAN assets arrive through the authenticated Env origin, without a share ID.
	if role == originRolePortForward {
		id, valid := portForwardIDFromRequest(r)
		s, owner, found := g.hostApps.ForForward(id)
		if !valid || !found || owner != meta.UserPublicID || (s.State != "starting" && s.State != "running") {
			http.NotFound(w, r)
			return
		}
	}
	digest, resource, ok := strings.Cut(strings.TrimPrefix(r.URL.Path, hostapps.ClientAssetsPath), "/")
	if !ok || len(digest) != 64 || resource == "" {
		http.NotFound(w, r)
		return
	}
	assets := g.hostApps.ClientAssets(meta.UserPublicID, digest)
	if assets == nil {
		http.NotFound(w, r)
		return
	}
	next := r.Clone(r.Context())
	next.URL.Path, next.URL.RawPath = "/"+resource, ""
	assets.ServeHTTP(w, next)
}
