package localui

import (
	"errors"
	"io"
	"net/http"

	"github.com/floegence/redeven/internal/webbinding"
)

// Binding consent is a host-owner action. A native bridge token, application
// password, Gateway session or forwarded header cannot invoke this route.
func (s *runtimeControlServer) handleWebBindings(w http.ResponseWriter, r *http.Request) {
	owner, ok := r.Context().Value(ownerSocketControlKey{}).(*runtimeControlServer)
	if !ok || owner != s {
		writeRuntimeControlError(w, 403, "WEB_BINDING_OWNER_REQUIRED", "Manage Web entry consent on this Runtime host.")
		return
	}
	if !s.require(w, r) {
		return
	}
	if s.webBindings == nil {
		writeRuntimeControlError(w, 503, "WEB_BINDING_UNAVAILABLE", "Web entry bindings are unavailable.")
		return
	}
	switch r.Method {
	case http.MethodGet:
		bindings, err := s.webBindings.List()
		if err != nil {
			writeRuntimeControlError(w, 503, "WEB_BINDING_UNAVAILABLE", "Cannot read Web entry bindings.")
			return
		}
		writeRuntimeControlJSON(w, 200, runtimeControlEnvelope{OK: true, Data: bindings})
	case http.MethodPut:
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 4096))
		if err != nil {
			writeRuntimeControlError(w, 400, "WEB_BINDING_INVALID", "Invalid Web entry binding.")
			return
		}
		binding, err := webbinding.Decode(raw)
		if err != nil || binding.RuntimeID != s.agent.RuntimePublicID() {
			writeRuntimeControlError(w, 400, "WEB_BINDING_INVALID", "Use this Runtime identity and an exact HTTPS entry origin.")
			return
		}
		next, err := s.webBindings.Put(binding, binding.Revision)
		if err != nil {
			status, code := 503, "WEB_BINDING_UNAVAILABLE"
			if errors.Is(err, webbinding.ErrConflict) {
				status, code = 409, "WEB_BINDING_CONFLICT"
			}
			if errors.Is(err, webbinding.ErrDenied) {
				status, code = 400, "WEB_BINDING_INVALID"
			}
			if errors.Is(err, webbinding.ErrCapacity) {
				status, code = 429, "WEB_BINDING_CAPACITY"
			}
			writeRuntimeControlError(w, status, code, "Cannot update Web entry consent. Reload the current binding and retry.")
			return
		}
		writeRuntimeControlJSON(w, 200, runtimeControlEnvelope{OK: true, Data: next})
	default:
		w.Header().Set("Allow", "GET, PUT")
		writeRuntimeControlError(w, 405, "METHOD_NOT_ALLOWED", "Method not allowed.")
	}
}
