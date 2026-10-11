package localui

import (
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/floegence/redeven/internal/tessiven"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

func (s *runtimeControlServer) handleTessivenHost(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r) {
		return
	}
	if s.appServer == nil {
		writeRuntimeControlError(w, 503, "TESSIVEN_UNAVAILABLE", "Tessiven is unavailable")
		return
	}
	if r.Method != http.MethodGet || r.URL.RawQuery != "" {
		writeRuntimeControlError(w, 400, "TESSIVEN_INVALID_REQUEST", "Invalid Tessiven host request")
		return
	}
	upgrade := websocket.Upgrader{CheckOrigin: func(req *http.Request) bool { return strictSameOriginWSRequest(req, false) }}
	source := uuid.NewString() + uuid.NewString()
	headers := http.Header{"X-Redeven-Tessiven-Source": []string{source}}
	conn, err := upgrade.Upgrade(w, r, headers)
	if err != nil {
		return
	}
	defer conn.Close()
	_ = conn.SetReadDeadline(time.Time{})
	_ = conn.SetWriteDeadline(time.Time{})
	_ = s.appServer.ServeTessivenHost(r.Context(), conn, source)
}
func (s *runtimeControlServer) handleTessivenTarget(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r) {
		return
	}
	if s.appServer == nil {
		writeRuntimeControlError(w, 503, "TESSIVEN_UNAVAILABLE", "Tessiven is unavailable")
		return
	}
	if r.Method != http.MethodPost || r.URL.RawQuery != "" {
		writeRuntimeControlError(w, 400, "TESSIVEN_INVALID_REQUEST", "Invalid Tessiven resource request")
		return
	}
	var req tessiven.TargetResourceRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 65536))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		writeRuntimeControlError(w, 400, "TESSIVEN_INVALID_REQUEST", "Invalid Tessiven resource request")
		return
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		writeRuntimeControlError(w, 400, "TESSIVEN_INVALID_REQUEST", "Expected one resource request")
		return
	}
	result, err := s.appServer.ExecuteTessivenTarget(r.Context(), req)
	if err != nil {
		status, code, message := tessiven.ResourceErrorDetails(err)
		writeRuntimeControlError(w, status, code, message)
		return
	}
	writeRuntimeControlJSON(w, 200, runtimeControlEnvelope{OK: true, Data: result})
}

func (s *runtimeControlServer) handleTessivenPreflight(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r) {
		return
	}
	if r.Method != http.MethodPost || r.URL.RawQuery != "" || s.appServer == nil {
		writeRuntimeControlError(w, 400, "TESSIVEN_INVALID_REQUEST", "Invalid Desktop source preflight")
		return
	}
	var req struct {
		Source      string                       `json:"source"`
		Scope       tessiven.DesktopSourceScope  `json:"scope"`
		Effect      string                       `json:"effect"`
		Permissions tessiven.ResourcePermissions `json:"permissions"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil || decoder.Decode(&struct{}{}) != io.EOF {
		writeRuntimeControlError(w, 400, "TESSIVEN_INVALID_REQUEST", "Invalid Desktop source preflight")
		return
	}
	if err := s.appServer.PreflightTessivenSource(req.Source, req.Scope, req.Permissions, req.Effect); err != nil {
		status, code, message := tessiven.ResourceErrorDetails(err)
		writeRuntimeControlError(w, status, code, message)
		return
	}
	writeRuntimeControlJSON(w, 200, runtimeControlEnvelope{OK: true})
}
