package appserver

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/session"
)

func (g *Server) handleMCPManagement(w http.ResponseWriter, r *http.Request, service *ai.Service, meta *session.Meta) {
	var catalog ai.MCPCatalog
	var err error
	action := "ai_mcp_list"
	if r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/ai/mcp" {
		catalog, err = service.ListMCPServers()
	} else {
		allowed := false
		switch r.Method {
		case http.MethodPut, http.MethodDelete:
			allowed = r.URL.Path == "/_redeven_proxy/api/ai/mcp"
		case http.MethodPost:
			allowed = r.URL.Path == "/_redeven_proxy/api/ai/mcp/check"
		}
		if !allowed {
			writeJSON(w, http.StatusMethodNotAllowed, apiResp{OK: false, Error: "method not allowed"})
			return
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 128<<10))
		decoder.DisallowUnknownFields()
		var input ai.MCPServerInput
		if decoder.Decode(&input) != nil || decoder.Decode(&struct{}{}) != io.EOF {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid MCP request"})
			return
		}
		switch r.Method {
		case http.MethodPut:
			action = "ai_mcp_save"
			catalog, err = service.SaveMCPServer(r.Context(), input)
		case http.MethodDelete:
			action = "ai_mcp_delete"
			catalog, err = service.DeleteMCPServer(input.ID, input.Revision)
		case http.MethodPost:
			action = "ai_mcp_check"
			catalog, err = service.CheckMCPServer(r.Context(), input.ID, input.Revision)
		}
	}
	if err != nil {
		g.appendAudit(meta, action, "failure", nil, err)
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
		return
	}
	g.appendAudit(meta, action, "success", nil, nil)
	writeJSON(w, http.StatusOK, apiResp{OK: true, Data: catalog})
}
