package localui

import (
	"encoding/json"
	"io"
	"net/http"

	"context"
	"errors"
	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/agent"
	"github.com/floegence/redeven/internal/gatewaymembership"
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
		PreviewID string `json:"preview_id"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	dec.DisallowUnknownFields()
	if dec.Decode(&body) != nil || dec.Decode(new(any)) != io.EOF {
		writeRuntimeControlError(w, http.StatusBadRequest, "GATEWAY_JOIN_INVALID", "Invalid Gateway confirmation.")
		return
	}
	purpose := "join"
	switch r.URL.Path {
	case "/v2/gateway/update-endpoints":
		purpose = "update-endpoints"
	case "/v2/gateway/replace":
		purpose = "replace"
	}
	if err := s.agent.ConfirmGatewayPreview(body.PreviewID, purpose, ""); err != nil {
		code := gatewayEnrollmentErrorCode(err)
		writeRuntimeControlError(w, http.StatusConflict, code, "Gateway confirmation failed. Verify the address and a fresh invitation code, then confirm again.")
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
	var body struct {
		GatewayID string `json:"gateway_id"`
	}
	if r.Body != nil && r.ContentLength != 0 {
		dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048))
		dec.DisallowUnknownFields()
		if dec.Decode(&body) != nil || dec.Decode(new(any)) != io.EOF {
			writeRuntimeControlError(w, http.StatusBadRequest, "GATEWAY_RETRY_INVALID", "Select a Gateway connection.")
			return
		}
	}
	if err := s.agent.RetryGatewayMembership(body.GatewayID); err != nil {
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
	var body struct {
		GatewayID               string `json:"gateway_id"`
		CloudImpactAcknowledged bool   `json:"cloud_impact_acknowledged"`
	}
	if r.Body != nil && r.ContentLength != 0 {
		dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048))
		dec.DisallowUnknownFields()
		if dec.Decode(&body) != nil || dec.Decode(new(any)) != io.EOF {
			writeRuntimeControlError(w, http.StatusBadRequest, "GATEWAY_LEAVE_INVALID", "Select a Gateway connection.")
			return
		}
	}
	if err := s.agent.UnpairGateway(body.GatewayID, body.CloudImpactAcknowledged); err != nil {
		code := "GATEWAY_LEAVE_FAILED"
		if errors.Is(err, agent.ErrGatewayCloudImpactRequired) {
			code = "GATEWAY_CLOUD_IMPACT_REQUIRED"
		}
		writeRuntimeControlError(w, http.StatusConflict, code, "Gateway removal requires the selected member and confirmation of any Cloud interruption.")
		return
	}

	s.notifyRuntimeServiceChanged()
	writeRuntimeControlJSON(w, http.StatusOK, runtimeControlEnvelope{OK: true, Data: s.agent.GatewayMembershipStatus()})
}

func gatewayEnrollmentErrorCode(err error) string {
	var exchange *flowersec.InvitationExchangeError
	if errors.As(err, &exchange) {
		return exchange.Code
	}
	switch {
	case errors.Is(err, agent.ErrGatewayPreviewExpired):
		return "GATEWAY_PREVIEW_EXPIRED"
	case errors.Is(err, agent.ErrGatewayPreviewChanged):
		return "GATEWAY_PREVIEW_CHANGED"
	case errors.Is(err, gatewaymembership.ErrInvalidProof):
		return "GATEWAY_IDENTITY_FAILED"
	case errors.Is(err, gatewaymembership.ErrConflict):
		return "GATEWAY_MEMBERSHIP_CONFLICT"
	case errors.Is(err, context.Canceled):
		return "GATEWAY_PREVIEW_CANCELED"
	case errors.Is(err, context.DeadlineExceeded):
		return "GATEWAY_UNREACHABLE"
	default:
		return "GATEWAY_UNREACHABLE"
	}
}

func (s *runtimeControlServer) handleGatewayPreview(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r) {
		return
	}
	if r.Header.Get("Origin") != "" {
		writeRuntimeControlError(w, http.StatusForbidden, "GATEWAY_TRUSTED_CHANNEL_REQUIRED", "Gateway verification requires trusted Runtime management.")
		return
	}
	if r.Method != http.MethodPost {
		writeRuntimeControlError(w, http.StatusMethodNotAllowed, "RUNTIME_CONTROL_METHOD_NOT_ALLOWED", "Method not allowed.")
		return
	}
	var body struct {
		Address string `json:"address"`
		Code    string `json:"code"`
		Purpose string `json:"purpose"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&body) != nil || decoder.Decode(new(any)) != io.EOF {
		writeRuntimeControlError(w, http.StatusBadRequest, "GATEWAY_PREVIEW_INVALID", "Enter the Gateway address and invitation code.")
		return
	}
	preview, err := s.agent.PreviewGateway(r.Context(), body.Address, body.Code, body.Purpose)
	if err != nil {
		writeRuntimeControlError(w, http.StatusConflict, gatewayEnrollmentErrorCode(err), "Gateway verification failed. Check the address and invitation code.")
		return
	}
	writeRuntimeControlJSON(w, http.StatusOK, runtimeControlEnvelope{OK: true, Data: preview})
}

func (s *runtimeControlServer) handleGatewayPublish(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r) {
		return
	}
	if r.Header.Get("Origin") != "" {
		writeRuntimeControlError(w, http.StatusForbidden, "GATEWAY_TRUSTED_CHANNEL_REQUIRED", "Cloud publication requires trusted Runtime management.")
		return
	}
	if r.Method != http.MethodPost {
		writeRuntimeControlError(w, http.StatusMethodNotAllowed, "RUNTIME_CONTROL_METHOD_NOT_ALLOWED", "Method not allowed.")
		return
	}
	var body struct {
		GatewayID         string `json:"gateway_id"`
		EnvironmentChoice string `json:"environment_choice,omitempty"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048))
	dec.DisallowUnknownFields()
	if dec.Decode(&body) != nil || dec.Decode(new(any)) != io.EOF || body.GatewayID == "" {
		writeRuntimeControlError(w, http.StatusBadRequest, "GATEWAY_PUBLICATION_INVALID", "Select a Gateway and a Cloud publication choice.")
		return
	}
	if err := s.agent.PublishGateway(body.GatewayID, body.EnvironmentChoice); err != nil {
		writeRuntimeControlError(w, http.StatusConflict, "GATEWAY_PUBLICATION_FAILED", "Cloud publication could not be saved. Check the selected Gateway and ownership choice.")
		return
	}
	s.notifyRuntimeServiceChanged()
	writeRuntimeControlJSON(w, http.StatusOK, runtimeControlEnvelope{OK: true, Data: s.agent.GatewayMembershipStatus()})
}
