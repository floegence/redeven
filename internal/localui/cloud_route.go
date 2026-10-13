package localui

import (
	"encoding/json"
	"io"
	"net/http"

	rc "github.com/floegence/redeven/internal/runtimecloud/protocol"
)

func (s *runtimeControlServer) cloudRouteRequest(w http.ResponseWriter, r *http.Request, out any) bool {
	if !s.require(w, r) {
		return false
	}
	if r.Method != http.MethodPost {
		writeRuntimeControlError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed.")
		return false
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if decoder.Decode(out) != nil || decoder.Decode(new(any)) != io.EOF {
		writeRuntimeControlError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid Cloud route operation.")
		return false
	}
	return true
}

func (s *runtimeControlServer) handleCloudRoutePreflight(w http.ResponseWriter, r *http.Request) {
	var request rc.RoutePreflightRequest
	if !s.cloudRouteRequest(w, r, &request) {
		return
	}
	result, err := s.agent.PreflightCloudRoute(r.Context(), request)
	if err != nil {
		writeRuntimeControlError(w, http.StatusConflict, "ROUTE_PREFLIGHT_FAILED", "The selected route could not be verified. The current route is still selected; retry or choose another route.")
		return
	}
	writeRuntimeControlJSON(w, http.StatusOK, runtimeControlEnvelope{OK: true, Data: result})
}

func (s *runtimeControlServer) handleCloudRouteCommit(w http.ResponseWriter, r *http.Request) {
	var request rc.RouteCommitRequest
	if !s.cloudRouteRequest(w, r, &request) {
		return
	}
	result, err := s.agent.CommitCloudRoute(r.Context(), request)
	if err != nil {
		writeRuntimeControlError(w, http.StatusConflict, "ROUTE_COMMIT_FAILED", "The route changed or could not be saved. Query the original operation, then review the current route before retrying.")
		return
	}
	s.notifyRuntimeServiceChanged()
	writeRuntimeControlJSON(w, http.StatusOK, runtimeControlEnvelope{OK: true, Data: result})
}

func (s *runtimeControlServer) handleCloudRouteOperation(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r) {
		return
	}
	var result *rc.RouteOperation
	var err error
	switch r.Method {
	case http.MethodGet:
		result, err = s.agent.CloudRouteOperation(r.PathValue("operationId"))
	case http.MethodDelete:
		result, err = s.agent.CancelCloudRoute(r.PathValue("operationId"))
	default:
		writeRuntimeControlError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed.")
		return
	}
	if err != nil {
		writeRuntimeControlError(w, http.StatusNotFound, "ROUTE_OPERATION_NOT_FOUND", "This route operation was not found. Review the current route before starting another operation.")
		return
	}
	writeRuntimeControlJSON(w, http.StatusOK, runtimeControlEnvelope{OK: true, Data: result})
}

func (s *runtimeControlServer) handleCloudRetry(w http.ResponseWriter, r *http.Request) {
	var request rc.RetryRequest
	if !s.cloudRouteRequest(w, r, &request) {
		return
	}
	result, err := s.agent.RetryCloud(r.Context(), request.ExpectedAssociationRevision)
	if err != nil {
		writeRuntimeControlError(w, http.StatusConflict, "CLOUD_RETRY_REJECTED", "Review the current Cloud association and selected route before retrying.")
		return
	}
	s.notifyRuntimeServiceChanged()
	writeRuntimeControlJSON(w, http.StatusOK, runtimeControlEnvelope{OK: true, Data: result})
}
