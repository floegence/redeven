package localui

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/config"
)

type RuntimeAccessUpdate struct {
	Bind         string `json:"local_ui_bind"`
	Protocol     string `json:"local_ui_protocol"`
	PasswordMode string `json:"local_ui_password_mode"`
	Password     string `json:"local_ui_password"`
}

func SaveRuntimeAccess(layout config.StateLayout, input RuntimeAccessUpdate) (*config.EnvironmentCatalogAccess, error) {
	if err := config.ValidateLocalUIProtocol(input.Protocol); err != nil {
		return nil, err
	}
	bind, err := ParseBind(input.Bind)
	if err != nil {
		return nil, err
	}
	// Validate both persisted records before changing either one. A failed
	// catalog write must not silently rotate the next-start credential.
	previousAccess, err := config.ReadEnvironmentCatalogAccess(layout)
	if err != nil {
		return nil, err
	}
	previousHash, err := accessgate.ReadPasswordHash(layout.StateDir)
	if err != nil {
		return nil, err
	}
	var hash []byte
	switch input.PasswordMode {
	case "keep":
		hash = previousHash
		// A retained Desktop credential can establish a missing verifier, but
		// must never replace the current server-owned password.
		if len(hash) == 0 && input.Password != "" {
			hash, err = accessgate.HashPassword(input.Password)
		}
		if err == nil && len(hash) == 0 && previousAccess != nil && previousAccess.LocalUIPasswordConfigured {
			return nil, fmt.Errorf("stored environment password is missing; supply the existing password or set a new one explicitly")
		}
	case "replace":
		hash, err = accessgate.HashPassword(input.Password)
	case "clear":
		if input.Password != "" {
			return nil, fmt.Errorf("clear cannot include a replacement password")
		}
	default:
		return nil, fmt.Errorf("choose keep, replace, or clear for the environment password")
	}
	if err != nil {
		return nil, err
	}
	if bind.IsNetworkExposure() && len(hash) == 0 {
		return nil, fmt.Errorf("network access requires an environment password")
	}
	access := config.EnvironmentCatalogAccess{LocalUIBind: bind.ListenLabel(), LocalUIProtocol: input.Protocol, LocalUIPasswordConfigured: len(hash) > 0}
	passwordChanged := !bytes.Equal(hash, previousHash)
	if passwordChanged {
		if err := accessgate.WritePasswordHash(layout.StateDir, hash); err != nil {
			return nil, err
		}
	}
	if err := config.UpdateEnvironmentCatalogAccess(layout, access); err != nil {
		if passwordChanged {
			if restoreErr := accessgate.WritePasswordHash(layout.StateDir, previousHash); restoreErr != nil {
				return nil, errors.Join(err, fmt.Errorf("restore environment password after failed settings save: %w", restoreErr))
			}
		}
		return nil, err
	}
	return &access, nil
}

func (s *runtimeControlServer) handleRuntimeAccess(w http.ResponseWriter, r *http.Request) {
	if !s.require(w, r) {
		return
	}
	if s.accessLayout == nil {
		writeRuntimeControlError(w, http.StatusServiceUnavailable, "RUNTIME_ACCESS_UNAVAILABLE", "Runtime access configuration is unavailable.")
		return
	}
	s.accessMu.Lock()
	defer s.accessMu.Unlock()
	var access *config.EnvironmentCatalogAccess
	var err error
	switch r.Method {
	case http.MethodGet:
		access, err = config.ReadEnvironmentCatalogAccess(*s.accessLayout)
	case http.MethodPut:
		var input RuntimeAccessUpdate
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&input); err != nil {
			writeRuntimeControlError(w, http.StatusBadRequest, "RUNTIME_ACCESS_INVALID", "Invalid access settings.")
			return
		}
		if err := decoder.Decode(new(any)); err != io.EOF {
			writeRuntimeControlError(w, http.StatusBadRequest, "RUNTIME_ACCESS_INVALID", "Expected one access settings object.")
			return
		}
		access, err = SaveRuntimeAccess(*s.accessLayout, input)
	default:
		writeRuntimeControlError(w, http.StatusMethodNotAllowed, "RUNTIME_CONTROL_METHOD_NOT_ALLOWED", "Method not allowed.")
		return
	}
	if err != nil {
		writeRuntimeControlError(w, http.StatusBadRequest, "RUNTIME_ACCESS_INVALID", err.Error())
		return
	}
	hash, err := accessgate.ReadPasswordHash(s.accessLayout.StateDir)
	if err != nil {
		writeRuntimeControlError(w, http.StatusBadRequest, "RUNTIME_ACCESS_INVALID", err.Error())
		return
	}
	var startedAt int64
	if s.agent != nil {
		startedAt = s.agent.ProcessStartedAtUnixMS()
	}
	writeRuntimeControlJSON(w, http.StatusOK, runtimeControlEnvelope{OK: true, Data: struct {
		*config.EnvironmentCatalogAccess
		RestartRequired        bool  `json:"restart_required"`
		RuntimeStartedAtUnixMS int64 `json:"runtime_started_at_unix_ms"`
	}{access, access != nil && (*access != s.accessCurrent || !bytes.Equal(hash, s.accessPasswordHash)), startedAt}})
}
