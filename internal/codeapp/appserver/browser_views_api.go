package appserver

import (
	"net/http"
	"strings"

	"github.com/floegence/redeven/internal/ai"
)

func (g *Server) handleBrowserViewsAPI(w http.ResponseWriter, r *http.Request) bool {
	const prefix = "/_redeven_proxy/api/browser/views"
	if r.URL.Path != prefix && !strings.HasPrefix(r.URL.Path, prefix+"/") {
		return false
	}
	meta, ok := g.requirePermission(w, r, requiredPermissionFull)
	if !ok || !g.requireBrowserRuntime(w) {
		return true
	}
	if r.URL.Path == prefix && r.Method == http.MethodPost {
		var request ai.BrowserViewRequest
		if !decodeBrowserRequest(w, r, 32768, &request) {
			return true
		}
		view, err := g.browserRuntime.OpenBrowserView(r.Context(), meta, request)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "browser_view_unavailable"})
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: view})
		return true
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, prefix+"/"), "/")
	if len(parts) == 2 && parts[0] != "" && parts[1] == "preferences" && r.Method == http.MethodPut {
		var request struct {
			Visible *bool `json:"visible"`
			Audio   *bool `json:"audio"`
		}
		if !decodeBrowserRequest(w, r, 4096, &request) {
			return true
		}
		if request.Visible == nil || request.Audio == nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid_json"})
			return true
		}
		writeBrowserViewMutation(w, g.browserRuntime.SetBrowserViewPreferences(r.Context(), meta, parts[0], *request.Visible, *request.Audio))
		return true
	}
	if len(parts) == 2 && parts[0] != "" && (parts[1] == "resource" || parts[1] == "download") {
		g.serveBrowserFile(w, r, meta, parts[0], parts[1])
		return true
	}
	if len(parts) == 1 && parts[0] != "" && r.Method == http.MethodDelete {
		writeBrowserViewMutation(w, g.browserRuntime.CloseBrowserView(r.Context(), meta, parts[0]))
		return true
	}
	if len(parts) == 2 && parts[0] != "" && parts[1] == "control" {
		if r.Method == http.MethodPost {
			var request struct {
				Target   string `json:"target"`
				Takeover bool   `json:"takeover"`
				Private  bool   `json:"private"`
			}
			if !decodeBrowserRequest(w, r, 4096, &request) {
				return true
			}
			token, err := g.browserRuntime.AcquireBrowserViewControl(r.Context(), meta, parts[0], request.Target, request.Takeover, request.Private)
			if err != nil {
				writeJSON(w, http.StatusConflict, apiResp{OK: false, Error: "browser_control_unavailable"})
				return true
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]string{"token": token}})
			return true
		}
		if r.Method == http.MethodDelete {
			var request struct {
				Token string `json:"token"`
			}
			if !decodeBrowserRequest(w, r, 4096, &request) {
				return true
			}
			writeBrowserViewMutation(w, g.browserRuntime.ReleaseBrowserViewControl(r.Context(), meta, parts[0], request.Token))
			return true
		}
	}
	writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
	return true
}

func writeBrowserViewMutation(w http.ResponseWriter, err error) {
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "browser_view_unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, apiResp{OK: true})
}
