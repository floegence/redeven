package appserver

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/ai/agentplugins"
	"github.com/floegence/redeven/internal/session"
)

func (g *Server) handleAgentPlugins(w http.ResponseWriter, r *http.Request, svc *ai.Service, meta *session.Meta) {
	path := strings.TrimPrefix(r.URL.Path, "/_redeven_proxy/api/ai/agent-plugins")
	var result any
	var err error
	if r.Method == http.MethodGet {
		switch path {
		case "":
			result, err = svc.ListAgentPlugins(meta)
		case "/operation":
			result, err = svc.AgentPluginOperation(meta, r.URL.Query().Get("id"))
		case "/catalog":
			result, err = svc.AgentPluginCatalog(r.Context(), meta, r.URL.Query().Get("id"))
		default:
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not_found"})
			return
		}
	} else {
		decode := func(v any) bool {
			d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 128<<10))
			d.DisallowUnknownFields()
			if d.Decode(v) != nil || d.Decode(new(any)) != io.EOF {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid_request"})
				return false
			}
			return true
		}
		switch {
		case r.Method == http.MethodPost && path == "/prepare":
			var req agentplugins.PrepareRequest
			if !decode(&req) {
				return
			}
			result, err = svc.PrepareAgentPlugin(r.Context(), meta, req)
		case r.Method == http.MethodPost && path == "/commit":
			var req agentplugins.CommitRequest
			if !decode(&req) {
				return
			}
			result, err = svc.CommitAgentPlugin(meta, req)
		case r.Method == http.MethodPut && path == "":
			var req agentplugins.Change
			if !decode(&req) {
				return
			}
			result, err = svc.ChangeAgentPlugin(meta, req)
		case r.Method == http.MethodDelete && path == "":
			var req struct {
				ID         string `json:"id"`
				Revision   int64  `json:"revision"`
				DeleteData bool   `json:"delete_data"`
			}
			if !decode(&req) {
				return
			}
			err = svc.RemoveAgentPlugin(meta, req.ID, req.Revision, req.DeleteData)
		case r.Method == http.MethodPost && path == "/check":
			var req struct {
				ID        string `json:"id"`
				Revision  int64  `json:"revision"`
				Component string `json:"component"`
			}
			if !decode(&req) {
				return
			}
			err = svc.CheckAgentPlugin(r.Context(), meta, req.ID, req.Revision, req.Component)
		case r.Method == http.MethodPut && path == "/credentials":
			var req struct {
				ID        string            `json:"id"`
				Revision  int64             `json:"revision"`
				Component string            `json:"component"`
				Values    map[string]string `json:"values"`
			}
			if !decode(&req) {
				return
			}
			result, err = svc.ConfigureAgentPlugin(meta, req.ID, req.Revision, req.Component, req.Values)
		case r.Method == http.MethodPost && path == "/sources":
			var req struct {
				URL      string `json:"url"`
				Revision int64  `json:"revision"`
			}
			if !decode(&req) {
				return
			}
			result, err = svc.AddAgentPluginSource(r.Context(), meta, req.URL, req.Revision)
		case r.Method == http.MethodDelete && path == "/sources":
			var req struct {
				ID       string `json:"id"`
				Revision int64  `json:"revision"`
			}
			if !decode(&req) {
				return
			}
			err = svc.RemoveAgentPluginSource(meta, req.ID, req.Revision)
		default:
			writeJSON(w, http.StatusMethodNotAllowed, apiResp{OK: false, Error: "method_not_allowed"})
			return
		}
	}
	if err != nil {
		code := err.Error()
		status := http.StatusBadRequest
		if errors.Is(err, agentplugins.ErrConflict) || errors.Is(err, agentplugins.ErrBusy) {
			status = http.StatusConflict
		}
		if code == "process_permission_required" || code == "management_permission_required" {
			status = http.StatusForbidden
		}
		g.appendAudit(meta, "ai_agent_plugins", "failure", map[string]any{"action": path}, errors.New("agent plugin operation failed"))
		writeJSON(w, status, apiResp{OK: false, Error: code})
		return
	}
	if r.Method != http.MethodGet {
		g.appendAudit(meta, "ai_agent_plugins", "success", map[string]any{"action": path}, nil)
	}
	writeJSON(w, http.StatusOK, apiResp{OK: true, Data: result})
}
