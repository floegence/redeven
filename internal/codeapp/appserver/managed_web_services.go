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
)

func (g *Server) handleManagedWebServicesAPI(w http.ResponseWriter, r *http.Request) bool {
	if r == nil || (!strings.HasPrefix(r.URL.Path, managedServicesAPIBase) && !strings.HasPrefix(r.URL.Path, managedOperationsAPIBase)) {
		return false
	}
	if g.managed == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "managed Web Services are not ready", ErrorCode: "MANAGED_WEB_SERVICES_UNAVAILABLE"})
		return true
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

func (g *Server) handleManagedServiceRoute(w http.ResponseWriter, r *http.Request) bool {
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, managedServicesAPIBase+"/"), "/")
	parts := strings.Split(rest, "/")
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" {
		writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
		return true
	}
	serviceID, action := strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
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
	if err := decodeManagedJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json", ErrorCode: "REQUEST_INVALID"})
		return true
	}
	detail := map[string]any{"service_id": serviceID, "action": string(req.Action), "delete_data": req.DeleteData}
	if req.DeleteData && req.Action == managedwebservice.ActionUninstall && !meta.CanAdmin {
		err := errors.New("admin permission is required to delete managed service data")
		g.appendAudit(meta, "managed_web_service_uninstall", "failure", detail, err)
		writeJSON(w, http.StatusForbidden, apiResp{OK: false, Error: err.Error(), ErrorCode: "ADMIN_REQUIRED"})
		return true
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
	decoder := json.NewDecoder(io.LimitReader(r.Body, 64*1024))
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
