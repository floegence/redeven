package appserver

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/floegence/redeven/internal/managedwebservice"
)

func (g *Server) handleManagedTemplateSourceRoute(w http.ResponseWriter, r *http.Request, parts []string) bool {
	if len(parts) == 0 || (parts[0] != "source-discovery" && parts[0] != "source-previews" && parts[0] != "source-confirmations") {
		return false
	}
	meta, ok := g.requireLocalAppPermission(w, r, localFloeAppPortForward, requiredPermissionFull)
	if !ok {
		return true
	}
	backend, ok := g.managed.(managedwebservice.TemplateSourceBackend)
	if !ok {
		writeJSON(w, http.StatusNotImplemented, apiResp{OK: false, ErrorCode: "TEMPLATE_SOURCE_UNAVAILABLE", Error: "Template source import requires an updated Runtime."})
		return true
	}
	owner := strings.Join([]string{meta.NamespacePublicID, meta.UserPublicID, meta.EndpointID, meta.ChannelID}, "\x00")
	w.Header().Set("Cache-Control", "no-store")
	decode := func(target any) bool {
		r.Body = http.MaxBytesReader(w, r.Body, 24*1024*1024)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(target); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, ErrorCode: "REQUEST_INVALID", Error: "Invalid template source request."})
			return false
		}
		var trailing any
		if err := decoder.Decode(&trailing); err != io.EOF {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, ErrorCode: "REQUEST_INVALID", Error: "Invalid template source request."})
			return false
		}
		return true
	}
	switch {
	case r.Method == http.MethodPost && len(parts) == 3 && parts[0] == "source-previews" && parts[2] == "file":
		var req struct {
			Path string `json:"path"`
		}
		if !decode(&req) {
			return true
		}
		result, err := backend.PreviewTemplateSourceFile(r.Context(), owner, parts[1], req.Path)
		if err != nil {
			writeManagedWebServiceError(w, err)
		} else {
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: result})
		}
		return true
	case r.Method == http.MethodPost && len(parts) == 1 && parts[0] == "source-discovery":
		var req managedwebservice.TemplateSourceDiscoverRequest
		if !decode(&req) {
			return true
		}
		result, err := backend.DiscoverTemplateSources(r.Context(), req)
		if err != nil {
			writeManagedWebServiceError(w, err)
		} else {
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: result})
		}
		return true
	case r.Method == http.MethodPost && len(parts) == 1 && parts[0] == "source-previews":
		var req managedwebservice.TemplateSourceInspectRequest
		if !decode(&req) {
			return true
		}
		result, err := backend.InspectTemplateSource(r.Context(), owner, req)
		if err != nil {
			writeManagedWebServiceError(w, err)
		} else {
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: result})
		}
		return true
	case r.Method == http.MethodPost && len(parts) == 1 && parts[0] == "source-confirmations":
		var req managedwebservice.TemplateSourceConfirmRequest
		if !decode(&req) {
			return true
		}
		result, err := backend.ConfirmTemplateSource(r.Context(), owner, req)
		detail := map[string]any{"candidate_id": truncateString(req.CandidateID, 80), "source_sha256": truncateString(req.SHA256, 64)}
		if err != nil {
			g.appendAudit(meta, "managed_web_service_template_source_confirm", "failure", detail, err)
			writeManagedWebServiceError(w, err)
		} else {
			detail["template_id"] = result.TemplateID
			g.appendAudit(meta, "managed_web_service_template_source_confirm", "success", detail, nil)
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: result})
		}
		return true
	case r.Method == http.MethodDelete && len(parts) == 2 && parts[0] == "source-previews":
		if err := backend.DiscardTemplateSource(r.Context(), owner, parts[1]); err != nil {
			writeManagedWebServiceError(w, err)
		} else {
			writeJSON(w, http.StatusOK, apiResp{OK: true})
		}
		return true
	default:
		writeJSON(w, http.StatusMethodNotAllowed, apiResp{OK: false, ErrorCode: "REQUEST_INVALID", Error: "Unsupported template source action."})
		return true
	}
}
