package appserver

import (
	"encoding/json"
	"io"
	"net/http"
	"runtime"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/browserbridge"
	"github.com/floegence/redeven/internal/hostapps"
)

func (g *Server) handleBrowserConnectionAPI(w http.ResponseWriter, r *http.Request) bool {
	const prefix = "/_redeven_proxy/api/browser/"
	switch r.URL.Path {
	case prefix + "installation", prefix + "extension/setup", prefix + "extension/open", prefix + "extension/status", prefix + "extension/remote":
	default:
		return false
	}
	meta, ok := g.requirePermission(w, r, requiredPermissionFull)
	if !ok || !g.requireBrowserRuntime(w) {
		return true
	}
	var data any
	var err error
	switch {
	case r.URL.Path == prefix+"extension/remote" && r.Method == http.MethodPost:
		var request struct {
			InstallationID string `json:"installation_id"`
		}
		if !decodeBrowserRequest(w, r, 1024, &request) {
			return true
		}
		if runtime.GOOS != "linux" || g.hostApps == nil {
			writeHostAppError(w, hostapps.ErrUnavailable)
			return true
		}
		installation, resolveErr := browserbridge.ResolveInstallation(request.InstallationID)
		if resolveErr != nil || !installation.Installed {
			writeHostAppError(w, hostapps.ErrNotFound)
			return true
		}
		var setup ai.ComputerExtensionSetup
		setup, err = g.browserRuntime.BrowserExtensionSetup(r.Context(), meta, request.InstallationID)
		if err != nil {
			g.writeComputerExtensionFailure(w, err, "prepare")
			return true
		}
		data, err = g.hostApps.PrepareBrowser(r.Context(), meta.UserPublicID, request.InstallationID, setup.NativeHost)
		if err != nil {
			writeHostAppError(w, err)
			return true
		}
		g.appendAudit(meta, "flower_browser_prepare", "success", map[string]any{"installation_id": request.InstallationID}, nil)
	case r.URL.Path == prefix+"extension/setup" && r.Method == http.MethodPost:
		var request struct {
			InstallationID string `json:"installation_id"`
		}
		if !decodeBrowserRequest(w, r, 1024, &request) {
			return true
		}
		data, err = g.browserRuntime.BrowserExtensionSetup(r.Context(), meta, request.InstallationID)
	case r.URL.Path == prefix+"extension/status" && r.Method == http.MethodGet:
		data, err = g.browserRuntime.BrowserExtensionStatus(meta)
	case r.URL.Path == prefix+"extension/open" && r.Method == http.MethodPost:
		var request struct {
			Action         string `json:"action"`
			InstallationID string `json:"installation_id"`
		}
		if !decodeBrowserRequest(w, r, 1024, &request) {
			return true
		}
		err = g.browserRuntime.OpenBrowserExtension(r.Context(), meta, request.Action, request.InstallationID)
	case r.URL.Path == prefix+"installation" && r.Method == http.MethodGet:
		data, err = g.browserRuntime.ComputerBrowserInstallation(r.Context(), meta)
	case r.URL.Path == prefix+"installation" && r.Method == http.MethodPut:
		var request struct {
			Enabled *bool `json:"enabled"`
		}
		if !decodeBrowserRequest(w, r, 4096, &request) {
			return true
		}
		if request.Enabled == nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid_json"})
			return true
		}
		data, err = g.browserRuntime.SetComputerBrowserEnabled(r.Context(), meta, *request.Enabled)
	case r.URL.Path == prefix+"installation" && r.Method == http.MethodPost:
		var request ai.ComputerBrowserInstallRequest
		if !decodeBrowserRequest(w, r, 360*1024, &request) {
			return true
		}
		data, err = g.browserRuntime.InstallComputerBrowser(r.Context(), meta, request)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
		return true
	}
	if err != nil {
		stage := ""
		switch r.URL.Path {
		case prefix + "extension/setup":
			stage = "prepare"
		case prefix + "extension/open":
			stage = "open"
		case prefix + "extension/status":
			stage = "check"
		}
		if stage != "" {
			g.writeComputerExtensionFailure(w, err, stage)
			return true
		}
		writeBrowserFailure(w, err)
	} else {
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: data})
	}
	return true
}

func (g *Server) requireBrowserRuntime(w http.ResponseWriter) bool {
	if g != nil && g.browserRuntime != nil {
		return true
	}
	writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "browser_unavailable"})
	return false
}

func decodeBrowserRequest(w http.ResponseWriter, r *http.Request, limit int64, value any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit))
	dec.DisallowUnknownFields()
	if dec.Decode(value) != nil || dec.Decode(&struct{}{}) != io.EOF {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid_json"})
		return false
	}
	return true
}

func writeBrowserFailure(w http.ResponseWriter, err error) {
	code := ai.BrowserErrorCode(err)
	status := http.StatusConflict
	if code == "BROWSER_SERVICE_FAILED" || code == "BROWSER_OPEN_FAILED" {
		status = http.StatusServiceUnavailable
	}
	if code == "BROWSER_OPEN_TIMEOUT" {
		status = http.StatusGatewayTimeout
	}
	writeJSON(w, status, apiResp{OK: false, Error: "Browser operation could not be completed", ErrorCode: code})
}
