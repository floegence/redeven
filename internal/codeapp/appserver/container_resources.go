package appserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
	"github.com/floegence/redeven/internal/containerresource"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/terminal"
)

const (
	containerResourcesAPIBase  = "/_redeven_proxy/api/container-resources"
	containerOperationsAPIBase = "/_redeven_proxy/api/container-resource-operations"
)

func (g *Server) handleContainerResourcesAPI(w http.ResponseWriter, r *http.Request) bool {
	if r == nil || (!strings.HasPrefix(r.URL.Path, containerResourcesAPIBase) && !strings.HasPrefix(r.URL.Path, containerOperationsAPIBase)) {
		return false
	}
	if g.containers == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "Containers are not ready", ErrorCode: "CONTAINER_RESOURCES_UNAVAILABLE"})
		return true
	}
	if strings.HasPrefix(r.URL.Path, containerOperationsAPIBase) {
		return g.handleContainerOperationRoute(w, r)
	}
	if g.handleContainerExecSessionRoute(w, r) {
		return true
	}
	if r.Method == http.MethodPost && r.URL.Path == containerResourcesAPIBase+"/preflights" {
		var request containerresource.PreflightRequest
		if err := decodeContainerResourceJSON(r, &request); err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		meta, ok := g.requirePermission(w, r, permissionForContainerMutation(request.Method))
		if !ok {
			return true
		}
		preflight, err := g.containers.Preflight(r.Context(), request)
		if err != nil {
			g.appendContainerAudit(meta, "container_resource_preflight", "failure", request.Method, containerresource.Preflight{}, err)
			writeContainerResourceError(w, err)
			return true
		}
		if preflight.Plan.RequiresAdmin && !meta.CanAdmin {
			err := errors.New("admin permission is required for this high-risk container operation")
			g.appendContainerAudit(meta, "container_resource_preflight", "failure", request.Method, preflight, err)
			writeJSON(w, http.StatusForbidden, apiResp{OK: false, Error: err.Error(), ErrorCode: "ADMIN_REQUIRED"})
			return true
		}
		g.appendContainerAudit(meta, "container_resource_preflight", "success", request.Method, preflight, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: preflight})
		return true
	}
	if strings.HasPrefix(r.URL.Path, containerResourcesAPIBase+"/compose-projects") && (r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodDelete) {
		return g.handleComposeDefinitionMutation(w, r)
	}
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
		return true
	}
	if _, ok := g.requirePermission(w, r, requiredPermissionRead); !ok {
		return true
	}
	return g.handleContainerReadRoute(w, r)
}

func (g *Server) handleContainerExecSessionRoute(w http.ResponseWriter, r *http.Request) bool {
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, containerResourcesAPIBase), "/")
	parts := []string{}
	if rest != "" {
		parts = strings.Split(rest, "/")
	}
	create := r.Method == http.MethodPost && len(parts) == 3 && parts[0] == "containers" && parts[2] == "exec-sessions"
	remove := r.Method == http.MethodDelete && len(parts) == 2 && parts[0] == "exec-sessions"
	if !create && !remove {
		return false
	}
	meta, ok := g.requirePermission(w, r, requiredPermissionReadExecute)
	if !ok {
		return true
	}
	manager, ok := g.term.(containerExecTerminalSessionManager)
	if !ok || manager == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "Container Exec is unavailable", ErrorCode: "CAPABILITY_UNSUPPORTED"})
		return true
	}
	if remove {
		sessionID, err := decodeResourcePathSegment(parts[1])
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		detail := map[string]any{"session_id": sessionID, "resource_kind": "container_exec"}
		if err := manager.DeleteContainerExecSession(sessionID, meta.UserPublicID); err != nil {
			if errors.Is(err, terminal.ErrSessionNotFound) {
				g.appendAudit(meta, "container_exec_session_close", "failure", detail, errors.New("container Exec session not found"))
				writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "Container Exec session not found", ErrorCode: "EXEC_SESSION_NOT_FOUND"})
				return true
			}
			g.appendAudit(meta, "container_exec_session_close", "failure", detail, errors.New("failed to close container Exec session"))
			writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: "Failed to close Container Exec session", ErrorCode: "EXEC_SESSION_CLOSE_FAILED"})
			return true
		}
		g.appendAudit(meta, "container_exec_session_close", "success", detail, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"session_id": sessionID}})
		return true
	}

	containerID, err := decodeResourcePathSegment(parts[1])
	if err != nil {
		writeContainerResourceError(w, err)
		return true
	}
	var request struct {
		Engine     containerengine.Engine     `json:"engine"`
		EndpointID containerengine.EndpointID `json:"endpoint_id"`
		Argv       []string                   `json:"argv,omitempty"`
	}
	if err := decodeContainerResourceJSON(r, &request); err != nil {
		writeContainerResourceError(w, err)
		return true
	}
	detail := map[string]any{
		"engine": request.Engine, "endpoint_id": request.EndpointID,
		"resource_kind": "container", "resource_identity": truncateString(containerID, 160),
	}
	program, err := g.containers.PrepareContainerExec(r.Context(), containerengine.ContainerExecRequest{
		Engine: request.Engine, EndpointID: request.EndpointID, ContainerID: containerID, Argv: request.Argv,
	})
	if err != nil {
		g.appendAudit(meta, "container_exec_session_create", "failure", detail, errors.New(publicContainerResourceMessage(err)))
		writeContainerResourceError(w, err)
		return true
	}
	info, err := manager.CreateContainerExecSession(terminal.ContainerExecSessionRequest{
		Name: "Container Exec", Executable: program.Executable, Args: program.Args, OwnerUserID: meta.UserPublicID,
	})
	if err != nil {
		g.appendAudit(meta, "container_exec_session_create", "failure", detail, errors.New("failed to create container Exec session"))
		writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: "Failed to create Container Exec session", ErrorCode: "EXEC_SESSION_CREATE_FAILED"})
		return true
	}
	detail["session_id"] = info.ID
	g.appendAudit(meta, "container_exec_session_create", "success", detail, nil)
	writeJSON(w, http.StatusCreated, apiResp{OK: true, Data: map[string]any{"session_id": info.ID}})
	return true
}

func (g *Server) handleContainerReadRoute(w http.ResponseWriter, r *http.Request) bool {
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, containerResourcesAPIBase), "/")
	parts := []string{}
	if rest != "" {
		parts = strings.Split(rest, "/")
	}
	if len(parts) == 1 && parts[0] == "runtimes" {
		if !containerQueryOnly(r.URL.Query()) {
			writeContainerResourceError(w, containerresource.ErrInvalidRequest)
			return true
		}
		response, err := g.containers.Runtimes(r.Context())
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: response})
		return true
	}
	if len(parts) == 1 && parts[0] == "services" {
		if !containerQueryOnly(r.URL.Query()) {
			writeContainerResourceError(w, containerresource.ErrInvalidRequest)
			return true
		}
		w.Header().Set("Cache-Control", "no-store")
		response, err := g.containers.ContainerServices(r.Context())
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: response})
		return true
	}
	if len(parts) == 3 && parts[0] == "services" && parts[2] == "configuration" {
		if !containerQueryOnly(r.URL.Query()) {
			writeContainerResourceError(w, containerresource.ErrInvalidRequest)
			return true
		}
		meta, ok := g.requirePermission(w, r, requiredPermissionAdmin)
		if !ok {
			return true
		}
		serviceID, err := decodeResourcePathSegment(parts[1])
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		w.Header().Set("Cache-Control", "no-store")
		configuration, err := g.containers.ContainerServiceConfiguration(r.Context(), serviceID)
		detail := map[string]any{"resource_kind": "container_service", "resource_identity": truncateString(serviceID, 160)}
		if err != nil {
			g.appendAudit(meta, "container_service_configuration_read", "failure", detail, errors.New(publicContainerResourceMessage(err)))
			writeContainerResourceError(w, err)
			return true
		}
		g.appendAudit(meta, "container_service_configuration_read", "success", detail, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: configuration})
		return true
	}
	if len(parts) == 0 {
		writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
		return true
	}
	engine, endpointID, err := containerRouteTarget(r, "")
	if err != nil {
		writeContainerResourceError(w, err)
		return true
	}
	switch parts[0] {
	case "containers":
		return g.handleContainerCollection(w, r, parts, engine, endpointID)
	case "images":
		return g.handleImageCollection(w, r, parts, engine, endpointID)
	case "volumes":
		return g.handleVolumeCollection(w, r, parts, engine, endpointID)
	case "volume-disk-usage":
		if len(parts) != 1 || !containerQueryOnly(r.URL.Query(), "engine", "endpoint_id") {
			writeContainerResourceError(w, containerresource.ErrInvalidRequest)
			return true
		}
		w.Header().Set("Cache-Control", "no-store")
		usage, err := g.containers.VolumeDiskUsage(r.Context(), containerengine.VolumeListRequest{Engine: engine, EndpointID: endpointID})
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: usage})
		return true
	case "compose-projects":
		return g.handleComposeCollection(w, r, parts, engine, endpointID)
	case "pods":
		return g.handlePodCollection(w, r, parts, engine, endpointID)
	default:
		writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
		return true
	}
}

func (g *Server) handleContainerCollection(w http.ResponseWriter, r *http.Request, parts []string, engine containerengine.Engine, endpointID containerengine.EndpointID) bool {
	if len(parts) == 1 {
		if !containerQueryOnly(r.URL.Query(), "engine", "endpoint_id", "all") {
			writeContainerResourceError(w, containerresource.ErrInvalidRequest)
			return true
		}
		all, err := parseOptionalBool(r.URL.Query().Get("all"))
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		items, err := g.containers.Containers(r.Context(), containerengine.ContainerListRequest{Engine: engine, EndpointID: endpointID, All: all})
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"containers": items}})
		return true
	}
	if len(parts) == 2 && parts[1] == "stats" {
		if !containerQueryOnly(r.URL.Query(), "engine", "endpoint_id") {
			writeContainerResourceError(w, containerresource.ErrInvalidRequest)
			return true
		}
		stats, err := g.containers.StatsCollection(r.Context(), containerengine.ContainerStatsCollectionRequest{Engine: engine, EndpointID: endpointID})
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: stats})
		return true
	}
	if len(parts) == 3 && parts[1] == "stats" && parts[2] == "events" {
		if !containerQueryOnly(r.URL.Query(), "engine", "endpoint_id", "interval_ms") {
			writeContainerResourceError(w, containerresource.ErrInvalidRequest)
			return true
		}
		interval, err := parseBoundedInt(r.URL.Query().Get("interval_ms"), 1500, 500, 10000)
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		g.streamContainerStatsCollection(w, r, containerengine.ContainerStatsCollectionRequest{Engine: engine, EndpointID: endpointID, IntervalMS: interval})
		return true
	}
	identity, err := decodeResourcePathSegment(parts[1])
	if err != nil {
		writeContainerResourceError(w, err)
		return true
	}
	if len(parts) == 2 {
		if !containerQueryOnly(r.URL.Query(), "engine", "endpoint_id") {
			writeContainerResourceError(w, containerresource.ErrInvalidRequest)
			return true
		}
		item, err := g.containers.Container(r.Context(), containerengine.ContainerInspectRequest{Engine: engine, EndpointID: endpointID, ContainerID: identity})
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: item})
		return true
	}
	if len(parts) == 3 && parts[2] == "logs" {
		if !containerQueryOnly(r.URL.Query(), "engine", "endpoint_id", "tail", "since_unix_ms") {
			writeContainerResourceError(w, containerresource.ErrInvalidRequest)
			return true
		}
		req, err := containerLogsRequest(r, engine, endpointID, identity)
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		result, err := g.containers.TailLogs(r.Context(), req)
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: result})
		return true
	}
	if len(parts) == 4 && parts[2] == "logs" && parts[3] == "events" {
		if !containerQueryOnly(r.URL.Query(), "engine", "endpoint_id", "tail", "since_unix_ms") {
			writeContainerResourceError(w, containerresource.ErrInvalidRequest)
			return true
		}
		req, err := containerLogsRequest(r, engine, endpointID, identity)
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		req.Follow = true
		g.streamContainerLogs(w, r, req)
		return true
	}
	if len(parts) == 3 && parts[2] == "stats" {
		if !containerQueryOnly(r.URL.Query(), "engine", "endpoint_id") {
			writeContainerResourceError(w, containerresource.ErrInvalidRequest)
			return true
		}
		stats, err := g.containers.Stats(r.Context(), containerengine.ContainerStatsWatchRequest{Engine: engine, EndpointID: endpointID, ContainerID: identity})
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: stats})
		return true
	}
	if len(parts) == 4 && parts[2] == "stats" && parts[3] == "events" {
		if !containerQueryOnly(r.URL.Query(), "engine", "endpoint_id", "interval_ms") {
			writeContainerResourceError(w, containerresource.ErrInvalidRequest)
			return true
		}
		interval, err := parseBoundedInt(r.URL.Query().Get("interval_ms"), 1000, 500, 10000)
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		g.streamContainerStats(w, r, containerengine.ContainerStatsWatchRequest{Engine: engine, EndpointID: endpointID, ContainerID: identity, IntervalMS: interval})
		return true
	}
	if len(parts) == 4 && parts[2] == "inspect" && parts[3] == "raw" {
		if !containerQueryOnly(r.URL.Query(), "engine", "endpoint_id") {
			writeContainerResourceError(w, containerresource.ErrInvalidRequest)
			return true
		}
		meta, ok := g.requirePermission(w, r, requiredPermissionAdmin)
		if !ok {
			return true
		}
		w.Header().Set("Cache-Control", "no-store")
		raw, err := g.containers.RawContainerInspect(r.Context(), containerengine.ContainerInspectRequest{Engine: engine, EndpointID: endpointID, ContainerID: identity})
		detail := map[string]any{"engine": engine, "endpoint_id": endpointID, "resource_kind": "container", "resource_identity": truncateString(identity, 160)}
		if err != nil {
			g.appendAudit(meta, "container_resource_raw_inspect", "failure", detail, errors.New(publicContainerResourceMessage(err)))
			writeContainerResourceError(w, err)
			return true
		}
		g.appendAudit(meta, "container_resource_raw_inspect", "success", detail, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: raw})
		return true
	}
	writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
	return true
}

func (g *Server) handleImageCollection(w http.ResponseWriter, r *http.Request, parts []string, engine containerengine.Engine, endpointID containerengine.EndpointID) bool {
	if !containerQueryOnly(r.URL.Query(), "engine", "endpoint_id") {
		writeContainerResourceError(w, containerresource.ErrInvalidRequest)
		return true
	}
	if len(parts) == 1 {
		items, err := g.containers.Images(r.Context(), containerengine.ImageListRequest{Engine: engine, EndpointID: endpointID})
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"images": items}})
		return true
	}
	identity, err := decodeResourcePathSegment(parts[1])
	if err != nil {
		writeContainerResourceError(w, err)
		return true
	}
	if len(parts) == 3 && parts[2] == "build-history" {
		items, err := g.containers.ImageBuildHistory(r.Context(), containerengine.ImageBuildHistoryRequest{Engine: engine, EndpointID: endpointID, Image: identity})
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"build_history": items}})
		return true
	}
	if len(parts) == 2 {
		item, err := g.containers.Image(r.Context(), containerengine.ImageInspectRequest{Engine: engine, EndpointID: endpointID, Image: identity})
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: item})
		return true
	}
	writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
	return true
}

func (g *Server) handleVolumeCollection(w http.ResponseWriter, r *http.Request, parts []string, engine containerengine.Engine, endpointID containerengine.EndpointID) bool {
	allowedQuery := []string{"engine", "endpoint_id"}
	if len(parts) >= 3 && parts[2] == "files" {
		allowedQuery = append(allowedQuery, "path")
	}
	if !containerQueryOnly(r.URL.Query(), allowedQuery...) {
		writeContainerResourceError(w, containerresource.ErrInvalidRequest)
		return true
	}
	if len(parts) == 1 {
		items, err := g.containers.Volumes(r.Context(), containerengine.VolumeListRequest{Engine: engine, EndpointID: endpointID})
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"volumes": items}})
		return true
	}
	if len(parts) == 2 {
		identity, err := decodeResourcePathSegment(parts[1])
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		item, err := g.containers.Volume(r.Context(), containerengine.VolumeInspectRequest{Engine: engine, EndpointID: endpointID, Name: identity})
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: item})
		return true
	}
	if len(parts) == 3 && parts[2] == "files" {
		identity, err := decodeResourcePathSegment(parts[1])
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		return g.handleVolumeFiles(w, r, engine, endpointID, identity, false)
	}
	if len(parts) == 4 && parts[2] == "files" && parts[3] == "content" {
		identity, err := decodeResourcePathSegment(parts[1])
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		return g.handleVolumeFiles(w, r, engine, endpointID, identity, true)
	}
	writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
	return true
}

func (g *Server) handleComposeCollection(w http.ResponseWriter, r *http.Request, parts []string, engine containerengine.Engine, endpointID containerengine.EndpointID) bool {
	if !containerQueryOnly(r.URL.Query(), "engine", "endpoint_id") {
		writeContainerResourceError(w, containerresource.ErrInvalidRequest)
		return true
	}
	if len(parts) == 1 {
		items, err := g.containers.ComposeProjects(r.Context(), containerengine.ComposeProjectListRequest{Engine: engine, EndpointID: endpointID})
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"compose_projects": items}})
		return true
	}
	if len(parts) == 2 {
		identity, err := decodeResourcePathSegment(parts[1])
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		item, management, err := g.containers.ComposeProject(r.Context(), containerengine.ComposeProjectRequest{Engine: engine, EndpointID: endpointID, ProjectID: identity})
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"project": item, "management": management}})
		return true
	}
	if len(parts) == 3 && parts[2] == "definition" {
		if _, ok := g.requirePermission(w, r, requiredPermissionAdmin); !ok {
			return true
		}
		identity, err := decodeResourcePathSegment(parts[1])
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		definition, err := g.containers.ComposeProjectDefinition(r.Context(), identity)
		if err != nil || definition.Engine != engine || definition.EndpointID != endpointID {
			if err == nil {
				err = containerresource.ErrComposeProjectDefinitionNotFound
			}
			writeContainerResourceError(w, err)
			return true
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: definition})
		return true
	}
	writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
	return true
}

func (g *Server) handleComposeDefinitionMutation(w http.ResponseWriter, r *http.Request) bool {
	meta, ok := g.requirePermission(w, r, requiredPermissionFull)
	if !ok {
		return true
	}
	if !meta.CanAdmin {
		writeJSON(w, http.StatusForbidden, apiResp{OK: false, Error: "admin permission denied", ErrorCode: "ADMIN_REQUIRED"})
		return true
	}
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, containerResourcesAPIBase+"/compose-projects"), "/")
	if r.Method == http.MethodPost && rest == "" {
		var input containerresource.ComposeProjectDefinitionInput
		if err := decodeContainerResourceJSON(r, &input); err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		definition, err := g.containers.CreateComposeProjectDefinition(r.Context(), input)
		detail := map[string]any{"engine": input.Engine, "endpoint_id": input.EndpointID, "resource_kind": "compose_project", "resource_identity": truncateString(input.Name, 160)}
		if err != nil {
			g.appendAudit(meta, "container_compose_project_save", "failure", detail, errors.New(publicContainerResourceMessage(err)))
			writeContainerResourceError(w, err)
			return true
		}
		detail["resource_identity"] = definition.ProjectID
		g.appendAudit(meta, "container_compose_project_save", "success", detail, nil)
		writeJSON(w, http.StatusCreated, apiResp{OK: true, Data: definition})
		return true
	}
	identity, err := decodeResourcePathSegment(rest)
	if err != nil {
		writeContainerResourceError(w, err)
		return true
	}
	current, err := g.containers.ComposeProjectDefinition(r.Context(), identity)
	if err != nil {
		writeContainerResourceError(w, err)
		return true
	}
	detail := map[string]any{"engine": current.Engine, "endpoint_id": current.EndpointID, "resource_kind": "compose_project", "resource_identity": current.ProjectID}
	if r.Method == http.MethodDelete {
		if err := g.containers.DeleteComposeProjectDefinition(r.Context(), identity); err != nil {
			g.appendAudit(meta, "container_compose_project_forget", "failure", detail, errors.New(publicContainerResourceMessage(err)))
			writeContainerResourceError(w, err)
			return true
		}
		g.appendAudit(meta, "container_compose_project_forget", "success", detail, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"project_id": identity}})
		return true
	}
	if r.Method == http.MethodPut {
		var input containerresource.ComposeProjectDefinitionInput
		if err := decodeContainerResourceJSON(r, &input); err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		definition, err := g.containers.UpdateComposeProjectDefinition(r.Context(), identity, input)
		if err != nil {
			g.appendAudit(meta, "container_compose_project_update", "failure", detail, errors.New(publicContainerResourceMessage(err)))
			writeContainerResourceError(w, err)
			return true
		}
		g.appendAudit(meta, "container_compose_project_update", "success", detail, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: definition})
		return true
	}
	writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
	return true
}

func (g *Server) handlePodCollection(w http.ResponseWriter, r *http.Request, parts []string, engine containerengine.Engine, endpointID containerengine.EndpointID) bool {
	if !containerQueryOnly(r.URL.Query(), "engine", "endpoint_id") {
		writeContainerResourceError(w, containerresource.ErrInvalidRequest)
		return true
	}
	if len(parts) == 1 {
		items, err := g.containers.Pods(r.Context(), containerengine.PodListRequest{Engine: engine, EndpointID: endpointID})
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"pods": items}})
		return true
	}
	if len(parts) == 2 {
		identity, err := decodeResourcePathSegment(parts[1])
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		item, err := g.containers.Pod(r.Context(), containerengine.PodRequest{Engine: engine, EndpointID: endpointID, PodID: identity})
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: item})
		return true
	}
	writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
	return true
}

func (g *Server) handleContainerOperationRoute(w http.ResponseWriter, r *http.Request) bool {
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, containerOperationsAPIBase), "/")
	parts := []string{}
	if rest != "" {
		parts = strings.Split(rest, "/")
	}
	if r.Method == http.MethodPost && len(parts) == 0 {
		var request containerresource.CreateOperationRequest
		if err := decodeContainerResourceJSON(r, &request); err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		meta, ok := g.requirePermission(w, r, permissionForContainerMutation(request.Method))
		if !ok {
			return true
		}
		preflight, err := g.containers.Preflight(r.Context(), containerresource.PreflightRequest{Method: request.Method, Request: request.Request})
		if err != nil {
			g.appendContainerAudit(meta, "container_resource_operation_create", "failure", request.Method, containerresource.Preflight{}, err)
			writeContainerResourceError(w, err)
			return true
		}
		if preflight.Plan.RequiresAdmin && !meta.CanAdmin {
			err := errors.New("admin permission is required for this high-risk container operation")
			g.appendContainerAudit(meta, "container_resource_operation_create", "failure", request.Method, preflight, err)
			writeJSON(w, http.StatusForbidden, apiResp{OK: false, Error: err.Error(), ErrorCode: "ADMIN_REQUIRED"})
			return true
		}
		operation, err := g.containers.CreateOperation(r.Context(), request)
		if err != nil {
			g.appendContainerAudit(meta, "container_resource_operation_create", "failure", request.Method, preflight, err)
			writeContainerResourceError(w, err)
			return true
		}
		g.appendContainerAudit(meta, "container_resource_operation_create", "success", request.Method, preflight, nil)
		writeJSON(w, http.StatusAccepted, apiResp{OK: true, Data: operation})
		return true
	}
	if r.Method == http.MethodGet && len(parts) == 0 {
		if _, ok := g.requirePermission(w, r, requiredPermissionRead); !ok {
			return true
		}
		if !containerQueryOnly(r.URL.Query(), "limit") {
			writeContainerResourceError(w, containerresource.ErrInvalidRequest)
			return true
		}
		limit, err := parseBoundedInt(r.URL.Query().Get("limit"), 100, 1, 200)
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		operations, err := g.containers.Operations(r.Context(), limit)
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"operations": operations}})
		return true
	}
	if len(parts) == 0 {
		writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
		return true
	}
	operationID, err := decodeResourcePathSegment(parts[0])
	if err != nil {
		writeContainerResourceError(w, err)
		return true
	}
	if r.Method == http.MethodGet && len(parts) == 1 {
		if _, ok := g.requirePermission(w, r, requiredPermissionRead); !ok {
			return true
		}
		op, err := g.containers.Operation(r.Context(), operationID)
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: op})
		return true
	}
	if r.Method == http.MethodPost && len(parts) == 2 && parts[1] == "cancel" {
		meta, ok := g.requirePermission(w, r, requiredPermissionReadExecute)
		if !ok {
			return true
		}
		op, err := g.containers.CancelOperation(r.Context(), operationID)
		if err != nil {
			g.appendAudit(meta, "container_resource_operation_cancel", "failure", map[string]any{"operation_id": operationID}, errors.New(publicContainerResourceMessage(err)))
			writeContainerResourceError(w, err)
			return true
		}
		g.appendAudit(meta, "container_resource_operation_cancel", "success", map[string]any{"operation_id": operationID, "method": op.Method}, nil)
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: op})
		return true
	}
	if r.Method == http.MethodGet && len(parts) == 2 && parts[1] == "events" {
		if _, ok := g.requirePermission(w, r, requiredPermissionRead); !ok {
			return true
		}
		if !containerQueryOnly(r.URL.Query(), "after_sequence") {
			writeContainerResourceError(w, containerresource.ErrInvalidRequest)
			return true
		}
		after, err := parseBoundedInt64(r.URL.Query().Get("after_sequence"), 0, 0, 1<<62)
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		g.streamContainerOperationEvents(w, r, operationID, after)
		return true
	}
	if r.Method == http.MethodGet && len(parts) == 3 && parts[1] == "events" && parts[2] == "snapshot" {
		if _, ok := g.requirePermission(w, r, requiredPermissionRead); !ok {
			return true
		}
		if !containerQueryOnly(r.URL.Query(), "after_sequence") {
			writeContainerResourceError(w, containerresource.ErrInvalidRequest)
			return true
		}
		after, err := parseBoundedInt64(r.URL.Query().Get("after_sequence"), 0, 0, 1<<62)
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		events, err := g.containers.Events(r.Context(), operationID, after)
		if err != nil {
			writeContainerResourceError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"events": events}})
		return true
	}
	writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
	return true
}

func permissionForContainerMutation(method containerengine.Method) requiredPermission {
	switch method {
	case containerengine.MethodStart, containerengine.MethodStop, containerengine.MethodRestart,
		containerengine.MethodPause, containerengine.MethodUnpause, containerengine.MethodKill,
		containerengine.MethodComposeProjectsStart, containerengine.MethodComposeProjectsStop, containerengine.MethodComposeProjectsRestart,
		containerengine.MethodPodsStart, containerengine.MethodPodsStop, containerengine.MethodPodsRestart:
		return requiredPermissionReadExecute
	default:
		return requiredPermissionFull
	}
}

func (g *Server) appendContainerAudit(meta *session.Meta, action, status string, method containerengine.Method, preflight containerresource.Preflight, err error) {
	detail := map[string]any{"method": method}
	if preflight.Engine != "" {
		detail["engine"] = preflight.Engine
		detail["endpoint_id"] = preflight.EndpointID
		detail["resource_kind"] = preflight.ResourceKind
		detail["resource_identity"] = truncateString(preflight.ResourceIdentity, 160)
		detail["request_hash"] = preflight.RequestHash
		detail["plan_hash"] = preflight.PlanHash
	}
	if err != nil {
		err = errors.New(publicContainerResourceMessage(err))
	}
	g.appendAudit(meta, action, status, detail, err)
}

func (g *Server) streamContainerOperationEvents(w http.ResponseWriter, r *http.Request, operationID string, after int64) {
	baseline, events, err := g.containers.Subscribe(r.Context(), operationID, after)
	if err != nil {
		writeContainerResourceError(w, err)
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: "streaming is unavailable"})
		return
	}
	setContainerSSEHeaders(w)
	for _, event := range baseline {
		if err := writeContainerSSE(w, "operation", event); err != nil {
			return
		}
	}
	flusher.Flush()
	for {
		select {
		case <-r.Context().Done():
			return
		case event, ok := <-events:
			if !ok {
				return
			}
			if err := writeContainerSSE(w, "operation", event); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (g *Server) streamContainerLogs(w http.ResponseWriter, r *http.Request, req containerengine.LogsTailRequest) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: "streaming is unavailable"})
		return
	}
	setContainerSSEHeaders(w)
	err := g.containers.FollowLogs(r.Context(), req, containerengine.LogLineSinkFunc(func(ctx context.Context, line containerengine.LogLine) error {
		if err := writeContainerSSE(w, "log", line); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	}))
	if err != nil && r.Context().Err() == nil {
		_ = writeContainerSSE(w, "error", map[string]string{"code": publicContainerResourceCode(err), "message": publicContainerResourceMessage(err)})
		flusher.Flush()
	}
}

func (g *Server) streamContainerStats(w http.ResponseWriter, r *http.Request, req containerengine.ContainerStatsWatchRequest) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: "streaming is unavailable"})
		return
	}
	setContainerSSEHeaders(w)
	ticker := time.NewTicker(time.Duration(req.IntervalMS) * time.Millisecond)
	defer ticker.Stop()
	for {
		stats, err := g.containers.Stats(r.Context(), req)
		if err != nil {
			_ = writeContainerSSE(w, "error", map[string]string{"code": publicContainerResourceCode(err), "message": publicContainerResourceMessage(err)})
			flusher.Flush()
			return
		}
		if err := writeContainerSSE(w, "stats", stats); err != nil {
			return
		}
		flusher.Flush()
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
		}
	}
}

func (g *Server) streamContainerStatsCollection(w http.ResponseWriter, r *http.Request, req containerengine.ContainerStatsCollectionRequest) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: "streaming is unavailable"})
		return
	}
	setContainerSSEHeaders(w)
	ticker := time.NewTicker(time.Duration(req.IntervalMS) * time.Millisecond)
	defer ticker.Stop()
	for {
		stats, err := g.containers.StatsCollection(r.Context(), req)
		if err != nil {
			_ = writeContainerSSE(w, "error", map[string]string{"code": publicContainerResourceCode(err), "message": publicContainerResourceMessage(err)})
			flusher.Flush()
			return
		}
		if err := writeContainerSSE(w, "stats", stats); err != nil {
			return
		}
		flusher.Flush()
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
		}
	}
}

func (g *Server) handleVolumeFiles(w http.ResponseWriter, r *http.Request, engine containerengine.Engine, endpointID containerengine.EndpointID, identity string, content bool) bool {
	meta, ok := g.requirePermission(w, r, requiredPermissionAdmin)
	if !ok {
		return true
	}
	req := containerengine.VolumeFileRequest{Engine: engine, EndpointID: endpointID, Name: identity, Path: r.URL.Query().Get("path")}
	detail := map[string]any{"engine": engine, "endpoint_id": endpointID, "resource_kind": "volume", "resource_identity": truncateString(identity, 160), "content": content}
	w.Header().Set("Cache-Control", "no-store")
	if content {
		item, err := g.containers.ReadVolumeFile(r.Context(), req)
		if err != nil {
			g.appendAudit(meta, "container_resource_file_read", "failure", detail, errors.New(publicContainerResourceMessage(err)))
			writeContainerResourceError(w, err)
			return true
		}
		g.appendAudit(meta, "container_resource_file_read", "success", detail, nil)
		writeContainerFileContent(w, item)
		return true
	}
	listing, err := g.containers.ListVolumeFiles(r.Context(), req)
	if err != nil {
		g.appendAudit(meta, "container_resource_file_list", "failure", detail, errors.New(publicContainerResourceMessage(err)))
		writeContainerResourceError(w, err)
		return true
	}
	g.appendAudit(meta, "container_resource_file_list", "success", detail, nil)
	writeJSON(w, http.StatusOK, apiResp{OK: true, Data: listing})
	return true
}

func writeContainerFileContent(w http.ResponseWriter, item containerengine.ResourceFileContent) {
	mediaType := strings.TrimSpace(item.MediaType)
	if mediaType == "" {
		mediaType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", mediaType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": item.Name}))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(item.Data)
}

func writeContainerSSE(w io.Writer, eventType string, payload any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", eventType, raw)
	return err
}

func setContainerSSEHeaders(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
}

func containerRouteTarget(r *http.Request, endpointPath string) (containerengine.Engine, containerengine.EndpointID, error) {
	engine, err := parseContainerEngine(r.URL.Query().Get("engine"))
	if err != nil {
		return "", "", err
	}
	rawEndpoint := strings.TrimSpace(r.URL.Query().Get("endpoint_id"))
	if endpointPath != "" {
		rawEndpoint, err = decodeResourcePathSegment(endpointPath)
		if err != nil {
			return "", "", err
		}
	}
	endpointID := containerengine.EndpointID(rawEndpoint)
	if endpointID != "" && !endpointID.Valid() {
		return "", "", fmt.Errorf("%w: endpoint_id is invalid", containerresource.ErrInvalidRequest)
	}
	return engine, endpointID, nil
}

func parseContainerEngine(raw string) (containerengine.Engine, error) {
	engine := containerengine.Engine(strings.TrimSpace(raw))
	if !engine.Valid() {
		return "", fmt.Errorf("%w: engine must be docker or podman", containerresource.ErrInvalidRequest)
	}
	return engine, nil
}

func containerLogsRequest(r *http.Request, engine containerengine.Engine, endpointID containerengine.EndpointID, identity string) (containerengine.LogsTailRequest, error) {
	tail, err := parseBoundedInt(r.URL.Query().Get("tail"), 200, 1, 5000)
	if err != nil {
		return containerengine.LogsTailRequest{}, err
	}
	since, err := parseBoundedInt64(r.URL.Query().Get("since_unix_ms"), 0, 0, 1<<62)
	if err != nil {
		return containerengine.LogsTailRequest{}, err
	}
	return containerengine.LogsTailRequest{Engine: engine, EndpointID: endpointID, ContainerID: identity, TailLines: tail, SinceUnixMs: since}, nil
}

func decodeResourcePathSegment(raw string) (string, error) {
	value, err := url.PathUnescape(strings.TrimSpace(raw))
	if err != nil || value == "" || len(value) > 512 || strings.ContainsAny(value, "/\\\x00\r\n") {
		return "", fmt.Errorf("%w: resource identity is invalid", containerresource.ErrInvalidRequest)
	}
	return value, nil
}

func decodeContainerResourceJSON(r *http.Request, target any) error {
	if r == nil || r.Body == nil {
		return containerresource.ErrInvalidRequest
	}
	decoder := json.NewDecoder(io.LimitReader(r.Body, (1<<20)+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("%w: invalid json", containerresource.ErrInvalidRequest)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("%w: body must contain one object", containerresource.ErrInvalidRequest)
	}
	return nil
}

func containerQueryOnly(query url.Values, allowed ...string) bool {
	allowedSet := make(map[string]struct{}, len(allowed))
	for _, key := range allowed {
		allowedSet[key] = struct{}{}
	}
	for key, values := range query {
		if _, ok := allowedSet[key]; !ok || len(values) != 1 {
			return false
		}
	}
	return true
}

func parseOptionalBool(raw string) (bool, error) {
	if strings.TrimSpace(raw) == "" {
		return false, nil
	}
	value, err := strconv.ParseBool(raw)
	if err != nil {
		return false, fmt.Errorf("%w: invalid boolean", containerresource.ErrInvalidRequest)
	}
	return value, nil
}

func parseBoundedInt(raw string, fallback, minimum, maximum int) (int, error) {
	if strings.TrimSpace(raw) == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < minimum || value > maximum {
		return 0, fmt.Errorf("%w: numeric query is out of range", containerresource.ErrInvalidRequest)
	}
	return value, nil
}

func parseBoundedInt64(raw string, fallback, minimum, maximum int64) (int64, error) {
	if strings.TrimSpace(raw) == "" {
		return fallback, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < minimum || value > maximum {
		return 0, fmt.Errorf("%w: numeric query is out of range", containerresource.ErrInvalidRequest)
	}
	return value, nil
}

func writeContainerResourceError(w http.ResponseWriter, err error) {
	status := http.StatusBadRequest
	switch {
	case errors.Is(err, containerengine.ErrComposeProjectNotFound):
		status = http.StatusNotFound
	case errors.Is(err, containerengine.ErrComposeConfigurationUnavailable):
		status = http.StatusConflict
	case errors.Is(err, containerengine.ErrResourceFileLimit), errors.Is(err, containerengine.ErrCommandOutputLimit):
		status = http.StatusRequestEntityTooLarge
	case errors.Is(err, containerresource.ErrOperationNotFound), errors.Is(err, containerresource.ErrComposeProjectDefinitionNotFound), errors.Is(err, containerengine.ErrContainerNotFound), errors.Is(err, containerengine.ErrImageNotFound), errors.Is(err, containerengine.ErrEndpointNotFound), errors.Is(err, containerengine.ErrContainerServiceNotFound):
		status = http.StatusNotFound
	case errors.Is(err, containerresource.ErrManagedByWebService), errors.Is(err, containerengine.ErrPermissionDenied):
		status = http.StatusForbidden
	case errors.Is(err, containerresource.ErrPreflightStale), errors.Is(err, containerresource.ErrIdempotencyConflict), errors.Is(err, containerresource.ErrOperationTerminal), errors.Is(err, containerengine.ErrResourcePlanStale), errors.Is(err, containerengine.ErrContainerNotRunning), errors.Is(err, containerengine.ErrNothingToPrune), errors.Is(err, containerengine.ErrReferenceStateIncomplete), errors.Is(err, containerengine.ErrContainerServiceConfigConflict):
		status = http.StatusConflict
	case errors.Is(err, containerengine.ErrEngineUnavailable), errors.Is(err, containerengine.ErrCLIUnavailable), errors.Is(err, containerengine.ErrBackendUnreachable), errors.Is(err, containerengine.ErrDaemonStopped), errors.Is(err, containerengine.ErrResourceCapabilityUnsupported), errors.Is(err, containerengine.ErrContainerServiceUnavailable), errors.Is(err, containerengine.ErrContainerServiceActionUnsupported), errors.Is(err, containerengine.ErrContainerServiceConfigReadOnly), errors.Is(err, containerengine.ErrContainerServiceRecoveryRequired):
		status = http.StatusServiceUnavailable
	case errors.Is(err, containerengine.ErrEngineTimeout), errors.Is(err, context.DeadlineExceeded):
		status = http.StatusGatewayTimeout
	}
	writeJSON(w, status, apiResp{OK: false, Error: publicContainerResourceMessage(err), ErrorCode: publicContainerResourceCode(err)})
}

func publicContainerResourceCode(err error) string {
	switch {
	case errors.Is(err, containerengine.ErrComposeProjectNotFound):
		return "COMPOSE_PROJECT_NOT_FOUND"
	case errors.Is(err, containerengine.ErrComposeConfigurationUnavailable):
		return "COMPOSE_CONFIGURATION_UNAVAILABLE"
	case errors.Is(err, containerresource.ErrInvalidRequest):
		return "REQUEST_INVALID"
	case errors.Is(err, containerresource.ErrPreflightStale), errors.Is(err, containerengine.ErrResourcePlanStale):
		return "PREFLIGHT_STALE"
	case errors.Is(err, containerengine.ErrNothingToPrune):
		return "NOTHING_TO_PRUNE"
	case errors.Is(err, containerengine.ErrReferenceStateIncomplete):
		return "REFERENCE_STATE_INCOMPLETE"
	case errors.Is(err, containerresource.ErrIdempotencyConflict):
		return "IDEMPOTENCY_CONFLICT"
	case errors.Is(err, containerresource.ErrOperationNotFound):
		return "OPERATION_NOT_FOUND"
	case errors.Is(err, containerresource.ErrComposeProjectDefinitionNotFound):
		return "COMPOSE_PROJECT_NOT_FOUND"
	case errors.Is(err, containerresource.ErrOperationTerminal):
		return "OPERATION_TERMINAL"
	case errors.Is(err, containerresource.ErrManagedByWebService):
		return "MANAGED_BY_WEB_SERVICE"
	case errors.Is(err, containerengine.ErrContainerNotFound):
		return "CONTAINER_NOT_FOUND"
	case errors.Is(err, containerengine.ErrContainerNotRunning):
		return "CONTAINER_NOT_RUNNING"
	case errors.Is(err, containerengine.ErrImageNotFound):
		return "IMAGE_NOT_FOUND"
	case errors.Is(err, containerengine.ErrEndpointNotFound):
		return "ENDPOINT_NOT_FOUND"
	case errors.Is(err, containerengine.ErrContainerServiceNotFound):
		return "CONTAINER_SERVICE_NOT_FOUND"
	case errors.Is(err, containerengine.ErrContainerServiceConfigConflict):
		return "CONTAINER_SERVICE_CONFIGURATION_CONFLICT"
	case errors.Is(err, containerengine.ErrContainerServiceConfigInvalid):
		return "CONTAINER_SERVICE_CONFIGURATION_INVALID"
	case errors.Is(err, containerengine.ErrContainerServiceConfigReadOnly):
		return "CONTAINER_SERVICE_CONFIGURATION_READ_ONLY"
	case errors.Is(err, containerengine.ErrContainerServiceActionUnsupported):
		return "CONTAINER_SERVICE_ACTION_UNSUPPORTED"
	case errors.Is(err, containerengine.ErrContainerServiceRecoveryRequired):
		return "SERVICE_RECOVERY_REQUIRED"
	case errors.Is(err, containerengine.ErrPermissionDenied):
		return "ENGINE_PERMISSION_DENIED"
	case errors.Is(err, containerengine.ErrEngineTimeout), errors.Is(err, context.DeadlineExceeded):
		return "ENGINE_TIMEOUT"
	case errors.Is(err, containerengine.ErrResourceCapabilityUnsupported):
		return "CAPABILITY_UNSUPPORTED"
	case errors.Is(err, containerengine.ErrResourceFileLimit), errors.Is(err, containerengine.ErrCommandOutputLimit):
		return "RESOURCE_FILE_LIMIT"
	case errors.Is(err, containerengine.ErrEngineUnavailable), errors.Is(err, containerengine.ErrCLIUnavailable), errors.Is(err, containerengine.ErrBackendUnreachable), errors.Is(err, containerengine.ErrDaemonStopped):
		return "ENGINE_UNAVAILABLE"
	default:
		return "CONTAINER_RESOURCE_ERROR"
	}
}

func publicContainerResourceMessage(err error) string {
	switch publicContainerResourceCode(err) {
	case "REQUEST_INVALID":
		return "The container request is invalid."
	case "PREFLIGHT_STALE":
		return "The reviewed container plan is stale. Review it again before continuing."
	case "NOTHING_TO_PRUNE":
		return "There are no unused resources to clean up."
	case "REFERENCE_STATE_INCOMPLETE":
		return "Resource usage could not be confirmed. Refresh and try again."
	case "IDEMPOTENCY_CONFLICT":
		return "This request identifier is already used by another operation."
	case "OPERATION_NOT_FOUND":
		return "The container operation was not found."
	case "COMPOSE_PROJECT_NOT_FOUND":
		return "The Compose project was not found. Refresh and try again."
	case "COMPOSE_CONFIGURATION_UNAVAILABLE":
		return "The Compose configuration files are missing or unreadable. Restore access to the files before trying this action again."
	case "OPERATION_TERMINAL":
		return "The container operation has already finished."
	case "MANAGED_BY_WEB_SERVICE":
		return "This resource is managed by Web Services. Open its service to make lifecycle changes."
	case "CONTAINER_NOT_FOUND":
		return "The container was not found."
	case "CONTAINER_NOT_RUNNING":
		return "Start the container before opening Exec."
	case "IMAGE_NOT_FOUND":
		return "The image was not found."
	case "ENDPOINT_NOT_FOUND":
		return "The container engine endpoint was not found."
	case "CONTAINER_SERVICE_NOT_FOUND":
		return "The container service was not found. Refresh and try again."
	case "CONTAINER_SERVICE_CONFIGURATION_CONFLICT":
		return "The container service configuration changed. Reload it before saving."
	case "CONTAINER_SERVICE_CONFIGURATION_INVALID":
		return "The container service configuration is invalid."
	case "CONTAINER_SERVICE_CONFIGURATION_READ_ONLY":
		return "This container service configuration is managed outside Redeven."
	case "CONTAINER_SERVICE_ACTION_UNSUPPORTED":
		return "Manage this container service with its official host tool."
	case "SERVICE_RECOVERY_REQUIRED":
		return "The container service could not be recovered automatically. Review its host configuration before retrying."
	case "ENGINE_PERMISSION_DENIED":
		return "The container engine denied this request."
	case "ENGINE_TIMEOUT":
		return "The container engine did not respond in time."
	case "CAPABILITY_UNSUPPORTED":
		return "This resource is not supported by the selected engine."
	case "RESOURCE_FILE_LIMIT":
		return "This file request exceeds the safe local processing limit."
	case "ENGINE_UNAVAILABLE":
		return "The selected container engine is unavailable."
	default:
		return "The container request could not be completed."
	}
}
