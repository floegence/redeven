package appserver

import (
	"net/http"

	"github.com/floegence/redeven/internal/ai"
)

func (g *Server) handleBrowserWorkspaceAPI(w http.ResponseWriter, r *http.Request) bool {
	const prefix = "/_redeven_proxy/api/browser/"
	switch r.URL.Path {
	case prefix + "recovery", prefix + "environment", prefix + "profiles", prefix + "workspace", prefix + "installation", prefix + "connections/cdp", prefix + "extension/setup", prefix + "extension/open", prefix + "extension/status", prefix + "extension/tabs":
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
	case r.URL.Path == prefix+"recovery" && r.Method == http.MethodPost:
		var request struct {
			Generation string `json:"expected_generation"`
		}
		if !decodeBrowserRequest(w, r, 4096, &request) {
			return true
		}
		data, err = g.browserRuntime.RecoverBrowser(r.Context(), meta, request.Generation)
	case r.URL.Path == prefix+"extension/setup" && r.Method == http.MethodPost:
		data, err = g.browserRuntime.BrowserExtensionSetup(r.Context(), meta)
	case r.URL.Path == prefix+"extension/status" && r.Method == http.MethodGet:
		data, err = g.browserRuntime.BrowserExtensionStatus(meta)
	case r.URL.Path == prefix+"extension/tabs" && r.Method == http.MethodGet:
		data, err = g.browserRuntime.BrowserExtensionTabs(r.Context(), meta, r.URL.Query().Get("profile_id"))
	case r.URL.Path == prefix+"extension/open" && r.Method == http.MethodPost:
		var request struct {
			Action string `json:"action"`
		}
		if !decodeBrowserRequest(w, r, 1024, &request) {
			return true
		}
		err = g.browserRuntime.OpenBrowserExtension(r.Context(), meta, request.Action)
	case r.URL.Path == prefix+"environment" && r.Method == http.MethodGet:
		data, err = g.browserRuntime.ComputerEnvironment(r.Context())
	case r.URL.Path == prefix+"profiles" && (r.Method == http.MethodGet || r.Method == http.MethodPost):
		var request struct {
			Name string `json:"name"`
		}
		if r.Method == http.MethodPost && !decodeBrowserRequest(w, r, 4096, &request) {
			return true
		}
		data, err = g.browserRuntime.ManagedBrowserProfiles(r.Context(), meta, request.Name)
	case r.URL.Path == prefix+"workspace" && r.Method == http.MethodPost:
		var request ai.BrowserWorkspaceRequest
		if !decodeBrowserRequest(w, r, 32768, &request) {
			return true
		}
		data, err = g.browserRuntime.OpenBrowserWorkspace(r.Context(), meta, request)
	case r.URL.Path == prefix+"connections/cdp" && r.Method == http.MethodPost:
		var request struct {
			Endpoint string `json:"endpoint"`
		}
		if !decodeBrowserRequest(w, r, 16384, &request) {
			return true
		}
		data, err = g.browserRuntime.BrowserTabs(r.Context(), request.Endpoint)
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
		case prefix + "extension/status", prefix + "extension/tabs":
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
