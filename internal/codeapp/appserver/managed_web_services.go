package appserver

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/managedwebservice"
)

const (
	managedServicesAPIBase   = "/_redeven_proxy/api/managed-web-services"
	managedOperationsAPIBase = "/_redeven_proxy/api/managed-web-service-operations"
	managedTemplatesAPIBase  = "/_redeven_proxy/api/managed-web-service-templates"
)

func (g *Server) handleManagedWebServicesAPI(w http.ResponseWriter, r *http.Request) bool {
	if r == nil || (!strings.HasPrefix(r.URL.Path, managedServicesAPIBase) && !strings.HasPrefix(r.URL.Path, managedOperationsAPIBase) && !strings.HasPrefix(r.URL.Path, managedTemplatesAPIBase)) {
		return false
	}
	if g.managed == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "managed Web Services are not ready", ErrorCode: "MANAGED_WEB_SERVICES_UNAVAILABLE"})
		return true
	}
	if strings.HasPrefix(r.URL.Path, managedTemplatesAPIBase) {
		return g.handleManagedTemplateRoute(w, r)
	}

	switch {
	case r.Method == http.MethodGet && r.URL.Path == managedServicesAPIBase+"/catalog":
		if _, ok := g.requireLocalAppPermission(w, r, localFloeAppPortForward, requiredPermissionRead); !ok {
			return true
		}
		catalog, err := g.managed.Catalog(r.Context())
		if err != nil {
			writeManagedWebServiceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"templates": catalog}})
		return true
	case r.Method == http.MethodGet && r.URL.Path == managedServicesAPIBase:
		if _, ok := g.requireLocalAppPermission(w, r, localFloeAppPortForward, requiredPermissionRead); !ok {
			return true
		}
		services, err := g.managed.List(r.Context())
		if err != nil {
			writeManagedWebServiceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"services": services}})
		return true
	case r.Method == http.MethodPost && r.URL.Path == managedServicesAPIBase:
		meta, ok := g.requireLocalAppPermission(w, r, localFloeAppPortForward, requiredPermissionFull)
		if !ok {
			return true
		}
		var req managedwebservice.CreateRequest
		if err := decodeManagedJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json", ErrorCode: "REQUEST_INVALID"})
			return true
		}
		detail := map[string]any{"template_id": truncateString(req.TemplateID, 80), "deployment": truncateString(string(req.Deployment), 20), "workspace_path": truncateString(req.WorkspacePath, 160)}
		result, err := g.managed.Create(r.Context(), req)
		if err != nil {
			g.appendAudit(meta, "managed_web_service_install", "failure", detail, err)
			writeManagedWebServiceError(w, err)
			return true
		}
		detail["service_id"], detail["operation_id"] = result.Service.ServiceID, result.Operation.OperationID
		g.appendAudit(meta, "managed_web_service_install", "success", detail, nil)
		writeJSON(w, http.StatusAccepted, apiResp{OK: true, Data: result})
		return true
	}

	if strings.HasPrefix(r.URL.Path, managedOperationsAPIBase+"/") {
		return g.handleManagedOperationRoute(w, r)
	}
	if strings.HasPrefix(r.URL.Path, managedServicesAPIBase+"/") {
		return g.handleManagedServiceRoute(w, r)
	}
	writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
	return true
}

func (g *Server) handleManagedTemplateRoute(w http.ResponseWriter, r *http.Request) bool {
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, managedTemplatesAPIBase), "/")
	parts := []string{}
	if rest != "" {
		parts = strings.Split(rest, "/")
	}
	if r.Method == http.MethodGet && len(parts) == 0 {
		if _, ok := g.requireLocalAppPermission(w, r, localFloeAppPortForward, requiredPermissionRead); !ok {
			return true
		}
		templates, err := g.managed.Catalog(r.Context())
		if err != nil {
			writeManagedWebServiceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"templates": templates}})
		return true
	}
	if r.Method == http.MethodPost && len(parts) == 1 && parts[0] == "validate" {
		if _, ok := g.requireLocalAppPermission(w, r, localFloeAppPortForward, requiredPermissionFull); !ok {
			return true
		}
		var req managedwebservice.TemplateWriteRequest
		if err := decodeManagedTemplateJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json", ErrorCode: "REQUEST_INVALID"})
			return true
		}
		if err := g.managed.ValidateTemplate(r.Context(), req); err != nil {
			writeManagedWebServiceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"valid": true}})
		return true
	}
	if r.Method == http.MethodPost && len(parts) == 2 && strings.TrimSpace(parts[0]) != "" && parts[1] == "release-candidates" {
		if _, ok := g.requireLocalAppPermission(w, r, localFloeAppPortForward, requiredPermissionFull); !ok {
			return true
		}
		var req managedwebservice.ReleaseCandidateRequest
		if err := decodeManagedJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json", ErrorCode: "REQUEST_INVALID"})
			return true
		}
		result, err := g.managed.TemplateReleaseCandidates(r.Context(), parts[0], req)
		if err != nil {
			writeManagedWebServiceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: result})
		return true
	}
	if r.Method == http.MethodPost && len(parts) == 0 {
		meta, ok := g.requireLocalAppPermission(w, r, localFloeAppPortForward, requiredPermissionFull)
		if !ok {
			return true
		}
		var req managedwebservice.TemplateWriteRequest
		if err := decodeManagedTemplateJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json", ErrorCode: "REQUEST_INVALID"})
			return true
		}
		detail := templateAuditDetail(req.Name, req.Spec.Kind)
		template, err := g.managed.CreateTemplate(r.Context(), req)
		if err != nil {
			g.appendAudit(meta, "managed_web_service_template_create", "failure", detail, err)
			writeManagedWebServiceError(w, err)
			return true
		}
		detail["template_id"], detail["revision"] = template.TemplateID, template.Revision
		g.appendAudit(meta, "managed_web_service_template_create", "success", detail, nil)
		writeJSON(w, http.StatusCreated, apiResp{OK: true, Data: template})
		return true
	}
	if len(parts) == 1 && strings.TrimSpace(parts[0]) != "" {
		templateID := strings.TrimSpace(parts[0])
		if r.Method == http.MethodGet {
			if _, ok := g.requireLocalAppPermission(w, r, localFloeAppPortForward, requiredPermissionRead); !ok {
				return true
			}
			template, err := g.managed.Template(r.Context(), templateID)
			if err != nil {
				writeManagedWebServiceError(w, err)
				return true
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: template})
			return true
		}
		meta, ok := g.requireLocalAppPermission(w, r, localFloeAppPortForward, requiredPermissionFull)
		if !ok {
			return true
		}
		if r.Method == http.MethodPut {
			var req managedwebservice.TemplateWriteRequest
			if err := decodeManagedTemplateJSON(r, &req); err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json", ErrorCode: "REQUEST_INVALID"})
				return true
			}
			detail := templateAuditDetail(req.Name, req.Spec.Kind)
			detail["template_id"] = templateID
			template, err := g.managed.UpdateTemplate(r.Context(), templateID, req)
			if err != nil {
				g.appendAudit(meta, "managed_web_service_template_update", "failure", detail, err)
				writeManagedWebServiceError(w, err)
				return true
			}
			detail["revision"] = template.Revision
			g.appendAudit(meta, "managed_web_service_template_update", "success", detail, nil)
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: template})
			return true
		}
		if r.Method == http.MethodDelete {
			detail := map[string]any{"template_id": templateID}
			if err := g.managed.DeleteTemplate(r.Context(), templateID); err != nil {
				g.appendAudit(meta, "managed_web_service_template_delete", "failure", detail, err)
				writeManagedWebServiceError(w, err)
				return true
			}
			g.appendAudit(meta, "managed_web_service_template_delete", "success", detail, nil)
			writeJSON(w, http.StatusOK, apiResp{OK: true})
			return true
		}
	}
	if r.Method == http.MethodPost && len(parts) == 2 && strings.TrimSpace(parts[0]) != "" && parts[1] == "duplicate" {
		meta, ok := g.requireLocalAppPermission(w, r, localFloeAppPortForward, requiredPermissionFull)
		if !ok {
			return true
		}
		var req managedwebservice.TemplateDuplicateRequest
		if err := decodeManagedJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json", ErrorCode: "REQUEST_INVALID"})
			return true
		}
		detail := map[string]any{"source_template_id": strings.TrimSpace(parts[0]), "name": truncateString(req.Name, 80)}
		template, err := g.managed.DuplicateTemplate(r.Context(), parts[0], req)
		if err != nil {
			g.appendAudit(meta, "managed_web_service_template_duplicate", "failure", detail, err)
			writeManagedWebServiceError(w, err)
			return true
		}
		detail["template_id"], detail["revision"] = template.TemplateID, template.Revision
		g.appendAudit(meta, "managed_web_service_template_duplicate", "success", detail, nil)
		writeJSON(w, http.StatusCreated, apiResp{OK: true, Data: template})
		return true
	}
	writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
	return true
}

func templateAuditDetail(name string, deployment managedwebservice.Deployment) map[string]any {
	return map[string]any{"name": truncateString(name, 80), "deployment": truncateString(string(deployment), 20)}
}

func (g *Server) handleManagedServiceRoute(w http.ResponseWriter, r *http.Request) bool {
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, managedServicesAPIBase+"/"), "/")
	parts := strings.Split(rest, "/")
	if len(parts) == 3 && strings.TrimSpace(parts[0]) != "" && parts[1] == "reconfigure" && parts[2] == "preflight" && r.Method == http.MethodPost {
		if _, ok := g.requireLocalAppPermission(w, r, localFloeAppPortForward, requiredPermissionFull); !ok {
			return true
		}
		var draft managedwebservice.ReconfigureDraft
		if err := decodeManagedJSONLimit(r, &draft, 768*1024); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json", ErrorCode: "REQUEST_INVALID"})
			return true
		}
		plan, err := g.managed.PreflightReconfigure(r.Context(), strings.TrimSpace(parts[0]), draft)
		if err != nil {
			writeManagedWebServiceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: plan})
		return true
	}
	if len(parts) == 2 && strings.TrimSpace(parts[0]) != "" && parts[1] == "update-plans" && r.Method == http.MethodPost {
		if _, ok := g.requireLocalAppPermission(w, r, localFloeAppPortForward, requiredPermissionFull); !ok {
			return true
		}
		var req managedwebservice.UpdatePlanRequest
		if err := decodeManagedJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json", ErrorCode: "REQUEST_INVALID"})
			return true
		}
		plan, err := g.managed.CreateUpdatePlan(r.Context(), strings.TrimSpace(parts[0]), req)
		if err != nil {
			writeManagedWebServiceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: plan})
		return true
	}
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" {
		writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
		return true
	}
	serviceID, action := strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
	if r.Method == http.MethodPost && action == "release-candidates" {
		if _, ok := g.requireLocalAppPermission(w, r, localFloeAppPortForward, requiredPermissionFull); !ok {
			return true
		}
		var req managedwebservice.ReleaseCandidateRequest
		if err := decodeManagedJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json", ErrorCode: "REQUEST_INVALID"})
			return true
		}
		result, err := g.managed.ServiceReleaseCandidates(r.Context(), serviceID, req)
		if err != nil {
			writeManagedWebServiceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: result})
		return true
	}
	if r.Method == http.MethodGet && action == "settings" {
		if _, ok := g.requireLocalAppPermission(w, r, localFloeAppPortForward, requiredPermissionRead); !ok {
			return true
		}
		settings, err := g.managed.Settings(r.Context(), serviceID)
		if err != nil {
			writeManagedWebServiceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: settings})
		return true
	}
	if r.Method == http.MethodPatch && action == "settings" {
		meta, ok := g.requireLocalAppPermission(w, r, localFloeAppPortForward, requiredPermissionFull)
		if !ok {
			return true
		}
		var req managedwebservice.ServiceMetadataPatch
		if err := decodeManagedJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json", ErrorCode: "REQUEST_INVALID"})
			return true
		}
		settings, err := g.managed.UpdateSettings(r.Context(), serviceID, req)
		if err != nil {
			g.appendAudit(meta, "managed_web_service_settings", "failure", map[string]any{"service_id": serviceID}, err)
			writeManagedWebServiceError(w, err)
			return true
		}
		g.appendAudit(meta, "managed_web_service_settings", "success", map[string]any{"service_id": serviceID}, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: settings})
		return true
	}
	if r.Method == http.MethodGet && action == "logs" {
		if _, ok := g.requireLocalAppPermission(w, r, localFloeAppPortForward, requiredPermissionRead); !ok {
			return true
		}
		tail := 200
		if raw := strings.TrimSpace(r.URL.Query().Get("tail")); raw != "" {
			value, err := strconv.Atoi(raw)
			if err != nil || value < 1 || value > 1000 {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "tail must be between 1 and 1000", ErrorCode: "REQUEST_INVALID"})
				return true
			}
			tail = value
		}
		logs, err := g.managed.Logs(r.Context(), serviceID, tail)
		if err != nil {
			writeManagedWebServiceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: logs})
		return true
	}
	if r.Method != http.MethodPost || action != "operations" {
		writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
		return true
	}
	meta, ok := g.requireLocalAppPermission(w, r, localFloeAppPortForward, requiredPermissionFull)
	if !ok {
		return true
	}
	var req managedwebservice.OperationRequest
	if err := decodeManagedJSONLimit(r, &req, 768*1024); err != nil {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json", ErrorCode: "REQUEST_INVALID"})
		return true
	}
	detail := map[string]any{"service_id": serviceID, "action": string(req.Action), "delete_data": req.DeleteData, "delete_workspace": req.DeleteWorkspace}
	req.Administrator = meta.CanAdmin
	if (req.DeleteData || req.DeleteWorkspace) && req.Action == managedwebservice.ActionUninstall && !meta.CanAdmin {
		err := errors.New("admin permission is required to delete managed service data")
		g.appendAudit(meta, "managed_web_service_uninstall", "failure", detail, err)
		writeJSON(w, http.StatusForbidden, apiResp{OK: false, Error: err.Error(), ErrorCode: "ADMIN_REQUIRED"})
		return true
	}
	if req.Reconfigure != nil {
		req.Reconfigure.Administrator = meta.CanAdmin
	}
	op, err := g.managed.Operate(r.Context(), serviceID, req)
	auditAction := "managed_web_service_" + strings.TrimSpace(string(req.Action))
	if err != nil {
		g.appendAudit(meta, auditAction, "failure", detail, err)
		writeManagedWebServiceError(w, err)
		return true
	}
	detail["operation_id"] = op.OperationID
	g.appendAudit(meta, auditAction, "success", detail, nil)
	writeJSON(w, http.StatusAccepted, apiResp{OK: true, Data: op})
	return true
}

func (g *Server) handleManagedOperationRoute(w http.ResponseWriter, r *http.Request) bool {
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, managedOperationsAPIBase+"/"), "/")
	parts := strings.Split(rest, "/")
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" {
		writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
		return true
	}
	operationID, action := strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
	if r.Method == http.MethodPost && action == "cancel" {
		meta, ok := g.requireLocalAppPermission(w, r, localFloeAppPortForward, requiredPermissionFull)
		if !ok {
			return true
		}
		op, err := g.managed.Cancel(r.Context(), operationID)
		detail := map[string]any{"operation_id": operationID}
		if err != nil {
			g.appendAudit(meta, "managed_web_service_operation_cancel", "failure", detail, err)
			writeManagedWebServiceError(w, err)
			return true
		}
		g.appendAudit(meta, "managed_web_service_operation_cancel", "success", detail, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: op})
		return true
	}
	if r.Method == http.MethodGet && action == "events" {
		if _, ok := g.requireLocalAppPermission(w, r, localFloeAppPortForward, requiredPermissionRead); !ok {
			return true
		}
		g.streamManagedOperationEvents(w, r, operationID)
		return true
	}
	writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
	return true
}

func (g *Server) streamManagedOperationEvents(w http.ResponseWriter, r *http.Request, operationID string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: "streaming is unavailable"})
		return
	}
	events, unsubscribe, err := g.managed.Subscribe(operationID)
	if err != nil {
		writeManagedWebServiceError(w, err)
		return
	}
	defer unsubscribe()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()
	keepAlive := time.NewTicker(15 * time.Second)
	defer keepAlive.Stop()
	first := true
	for {
		select {
		case <-r.Context().Done():
			return
		case <-keepAlive.C:
			if _, err := io.WriteString(w, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		case op := <-events:
			raw, err := json.Marshal(op)
			if err != nil {
				return
			}
			eventName := "update"
			if first {
				eventName = "snapshot"
				first = false
			}
			if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", eventName, raw); err != nil {
				return
			}
			flusher.Flush()
			if op.State == "succeeded" || op.State == "failed" || op.State == "cancelled" || op.State == "interrupted" {
				return
			}
		}
	}
}

func decodeManagedJSON(r *http.Request, destination any) error {
	return decodeManagedJSONLimit(r, destination, 64*1024)
}

func decodeManagedTemplateJSON(r *http.Request, destination any) error {
	return decodeManagedJSONLimit(r, destination, 768*1024)
}

func decodeManagedJSONLimit(r *http.Request, destination any, limit int64) error {
	decoder := json.NewDecoder(io.LimitReader(r.Body, limit))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("trailing json")
		}
		return err
	}
	return nil
}

func writeManagedWebServiceError(w http.ResponseWriter, err error) {
	code, message, status, retryable := managedwebservice.ErrorDetails(err)
	writeJSON(w, status, apiResp{OK: false, Error: message, ErrorCode: code, Data: map[string]any{"retryable": retryable}})
}
