package localui

import (
	"encoding/json"
	"io"
	"net/http"

	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
)

func (s *runtimeControlServer) handleGatewayCloudJoin(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r) {
		return
	}
	if r.Header.Get("Origin") != "" {
		writeRuntimeControlError(w, http.StatusForbidden, "GATEWAY_JOIN_TRUSTED_CHANNEL_REQUIRED", "Gateway enrollment requires the trusted Desktop management channel.")
		return
	}
	if r.Method != http.MethodPost {
		writeRuntimeControlError(w, http.StatusMethodNotAllowed, "RUNTIME_CONTROL_METHOD_NOT_ALLOWED", "Method not allowed.")
		return
	}
	var body struct {
		Material *gc.JoinMaterial `json:"material,omitempty"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	dec.DisallowUnknownFields()
	if dec.Decode(&body) != nil || dec.Decode(new(any)) != io.EOF {
		writeRuntimeControlError(w, http.StatusBadRequest, "GATEWAY_JOIN_INVALID", "Invalid Gateway join material.")
		return
	}
	phase, err := s.agent.JoinGatewayCloud(r.Context(), body.Material)
	if err != nil {
		writeRuntimeControlError(w, http.StatusConflict, "GATEWAY_JOIN_FAILED", "Gateway enrollment could not advance. Check the saved path and retry; bound environments require explicit migration.")
		return
	}
	s.notifyRuntimeServiceChanged()
	writeRuntimeControlJSON(w, http.StatusOK, runtimeControlEnvelope{OK: true, Data: map[string]any{"phase": phase, "runtime_service": s.agent.RuntimeServiceSnapshot()}})
}
