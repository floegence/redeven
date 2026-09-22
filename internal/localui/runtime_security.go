package localui

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/config"
)

func (s *runtimeControlServer) handleRuntimeSecurity(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r) {
		return
	}
	if s.accessGate == nil {
		writeRuntimeControlError(w, 503, "SECURITY_UNAVAILABLE", "Runtime security is unavailable.")
		return
	}
	if r.Method != http.MethodPost {
		writeRuntimeControlError(w, 405, "METHOD_NOT_ALLOWED", "Method not allowed.")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var req accessgate.SecurityRequest
	if err := decoder.Decode(&req); err != nil {
		writeRuntimeControlError(w, 400, "SECURITY_INVALID", "Invalid security request.")
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		writeRuntimeControlError(w, 400, "SECURITY_INVALID", "Expected one security request.")
		return
	}
	// Use the running listener's configuration, never an unsaved Desktop draft.
	if (req.Action == "setup" || req.Action == "replace" || req.Action == "commit") && s.accessCurrent.LocalUIProtocol != config.LocalUIProtocolHTTPS {
		writeRuntimeControlError(w, 409, "SECURITY_HTTPS_REQUIRED", "Apply HTTPS and restart this Runtime before enabling two-factor authentication.")
		return
	}
	result, err := s.accessGate.Manage("runtime-control", "Environment", req)
	if err != nil {
		writeRuntimeControlError(w, 400, accessgate.AuthenticationErrorCode(err), err.Error())
		return
	}
	if (req.Action == "commit" || req.Action == "recover") && s.afterSecurityChange != nil {
		s.afterSecurityChange()
	}
	writeRuntimeControlJSON(w, 200, runtimeControlEnvelope{OK: true, Data: struct {
		*accessgate.SecurityResult
		// The private management transport and saved configuration are not the public listener.
		HTTPSReady bool `json:"https_ready"`
	}{result, s.accessCurrent.LocalUIProtocol == config.LocalUIProtocolHTTPS}})
}
