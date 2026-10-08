package localui

import (
	"encoding/json"
	"io"
	"net/http"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func (s *runtimeControlServer) handleGatewayJoin(w http.ResponseWriter, r *http.Request) {
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
		Invitation        gp.MemberInvitation `json:"invitation"`
		EnvironmentChoice string              `json:"environment_choice,omitempty"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	dec.DisallowUnknownFields()
	if dec.Decode(&body) != nil || dec.Decode(new(any)) != io.EOF {
		writeRuntimeControlError(w, http.StatusBadRequest, "GATEWAY_JOIN_INVALID", "Invalid Gateway invitation.")
		return
	}
	var err error
	switch r.URL.Path {
	case "/v2/gateway/update-endpoints":
		if body.EnvironmentChoice != "" {
			writeRuntimeControlError(w, http.StatusBadRequest, "GATEWAY_ENDPOINTS_INVALID", "A connection endpoint update cannot change the Cloud environment.")
			return
		}
		err = s.agent.UpdateGatewayEndpoints(body.Invitation)
	case "/v2/gateway/replace":
		err = s.agent.ReplaceGateway(body.Invitation, body.EnvironmentChoice)
	default:
		err = s.agent.JoinGateway(body.Invitation, body.EnvironmentChoice)
	}
	if err != nil {
		writeRuntimeControlError(w, http.StatusConflict, "GATEWAY_JOIN_FAILED", "Gateway enrollment could not start. Check the invitation or explicitly leave the current Gateway.")
		return
	}
	s.notifyRuntimeServiceChanged()
	writeRuntimeControlJSON(w, http.StatusOK, runtimeControlEnvelope{OK: true, Data: s.agent.GatewayMembershipStatus()})
}

func (s *runtimeControlServer) handleGatewayStatus(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r) {
		return
	}
	if r.Header.Get("Origin") != "" {
		writeRuntimeControlError(w, http.StatusForbidden, "GATEWAY_TRUSTED_CHANNEL_REQUIRED", "Gateway configuration requires trusted Runtime management.")
		return
	}
	if r.Method != http.MethodGet {
		writeRuntimeControlError(w, http.StatusMethodNotAllowed, "RUNTIME_CONTROL_METHOD_NOT_ALLOWED", "Method not allowed.")
		return
	}
	writeRuntimeControlJSON(w, http.StatusOK, runtimeControlEnvelope{OK: true, Data: s.agent.GatewayMembershipStatus()})
}

func (s *runtimeControlServer) handleGatewayRetry(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r) {
		return
	}
	if r.Header.Get("Origin") != "" {
		writeRuntimeControlError(w, http.StatusForbidden, "GATEWAY_TRUSTED_CHANNEL_REQUIRED", "Gateway configuration requires trusted Runtime management.")
		return
	}
	if r.Method != http.MethodPost {
		writeRuntimeControlError(w, http.StatusMethodNotAllowed, "RUNTIME_CONTROL_METHOD_NOT_ALLOWED", "Method not allowed.")
		return
	}
	if err := s.agent.RetryGatewayMembership(); err != nil {
		writeRuntimeControlError(w, http.StatusConflict, "GATEWAY_RETRY_FAILED", "Gateway reconnection could not start.")
		return
	}
	writeRuntimeControlJSON(w, http.StatusOK, runtimeControlEnvelope{OK: true, Data: s.agent.GatewayMembershipStatus()})
}

func (s *runtimeControlServer) handleGatewayLeave(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r) {
		return
	}
	if r.Header.Get("Origin") != "" {
		writeRuntimeControlError(w, http.StatusForbidden, "GATEWAY_TRUSTED_CHANNEL_REQUIRED", "Gateway configuration requires trusted Runtime management.")
		return
	}
	if r.Method != http.MethodPost {
		writeRuntimeControlError(w, http.StatusMethodNotAllowed, "RUNTIME_CONTROL_METHOD_NOT_ALLOWED", "Method not allowed.")
		return
	}
	if err := s.agent.LeaveGateway(); err != nil {
		writeRuntimeControlError(w, http.StatusConflict, "GATEWAY_LEAVE_FAILED", "Gateway removal could not be saved. Retry the operation.")
		return
	}
	s.notifyRuntimeServiceChanged()
	writeRuntimeControlJSON(w, http.StatusOK, runtimeControlEnvelope{OK: true, Data: s.agent.GatewayMembershipStatus()})
}
