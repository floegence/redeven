package appserver

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	termgo "github.com/floegence/floeterm/terminal-go"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionrpc"
	"github.com/floegence/redeven/internal/terminal"
)

type terminalHistoryRetentionManager interface {
	HistoryRetentionAvailable() bool
	SetHistoryRetentionDefaults(termgo.HistoryRetentionLimits) error
	SessionHistoryRetention(*session.Meta, string, string, uint64, *termgo.HistoryRetentionLimits) (termgo.HistoryRetentionState, error)
}

func (g *Server) handleTerminalHistoryRetentionAPI(w http.ResponseWriter, r *http.Request) bool {
	if r.URL.Path != "/_redeven_proxy/api/terminal/history-retention" {
		return false
	}
	permission := requiredPermissionRead
	if r.Method == http.MethodPut {
		permission = requiredPermissionAdmin
	}
	meta, ok := g.requirePermission(w, r, permission)
	if !ok {
		return true
	}
	manager, ok := g.term.(terminalHistoryRetentionManager)
	if !ok || manager == nil || !manager.HistoryRetentionAvailable() {
		writeJSON(w, http.StatusNotImplemented, apiResp{OK: false, Error: "terminal history retention unavailable"})
		return true
	}
	fail := func(err error) {
		status := http.StatusInternalServerError
		var rpc *sessionrpc.Error
		if errors.As(err, &rpc) {
			status = int(rpc.Code)
		} else if errors.Is(err, terminal.ErrSessionNotFound) {
			status = 404
		} else if errors.Is(err, termgo.ErrHistoryRetentionUnavailable) {
			status = 501
		}
		writeJSON(w, status, apiResp{OK: false, Error: err.Error()})
	}
	switch r.Method {
	case http.MethodGet:
		id := strings.TrimSpace(r.URL.Query().Get("session_id"))
		if id != "" {
			state, err := manager.SessionHistoryRetention(meta, id, "", 0, nil)
			if err != nil {
				fail(err)
			} else {
				writeJSON(w, 200, apiResp{OK: true, Data: state})
			}
			return true
		}
		cfg, err := g.loadConfigLocked()
		if err != nil {
			fail(err)
			return true
		}
		writeJSON(w, 200, apiResp{OK: true, Data: struct {
			Supported bool                          `json:"supported"`
			CanManage bool                          `json:"can_manage"`
			Defaults  termgo.HistoryRetentionLimits `json:"defaults"`
		}{true, meta.CanAdmin, cfg.TerminalHistoryRetention}})
	case http.MethodPut, http.MethodPost:
		var body struct {
			SessionID           string                         `json:"session_id,omitempty"`
			ConnectionID        string                         `json:"connection_id,omitempty"`
			TransportGeneration uint64                         `json:"transport_generation,omitempty"`
			Limits              *termgo.HistoryRetentionLimits `json:"limits"`
		}
		dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&body); err != nil || body.Limits == nil || dec.Decode(&struct{}{}) != io.EOF {
			writeJSON(w, 400, apiResp{OK: false, Error: "invalid history retention request"})
			return true
		}
		if err := body.Limits.Validate(); err != nil {
			writeJSON(w, 400, apiResp{OK: false, Error: err.Error()})
			return true
		}
		if r.Method == http.MethodPost {
			if strings.TrimSpace(body.SessionID) == "" || strings.TrimSpace(body.ConnectionID) == "" || body.TransportGeneration == 0 {
				writeJSON(w, 400, apiResp{OK: false, Error: "current terminal attachment is required"})
				return true
			}
			state, err := manager.SessionHistoryRetention(meta, body.SessionID, body.ConnectionID, body.TransportGeneration, body.Limits)
			if err != nil {
				fail(err)
			} else {
				writeJSON(w, 200, apiResp{OK: true, Data: state})
			}
			return true
		}
		if body.SessionID != "" || body.ConnectionID != "" || body.TransportGeneration != 0 {
			writeJSON(w, 400, apiResp{OK: false, Error: "defaults cannot target an existing session"})
			return true
		}
		// Serialize persistence and activation, including concurrent settings saves.
		g.configUpdateMu.Lock()
		cfg, err := config.Update(g.configPath, func(c *config.Config) error { c.TerminalHistoryRetention = body.Limits.Clone(); return nil })
		if err == nil {
			err = manager.SetHistoryRetentionDefaults(cfg.TerminalHistoryRetention)
		}
		g.configUpdateMu.Unlock()
		if err != nil {
			fail(err)
			return true
		}
		g.appendAudit(meta, "terminal_history_defaults_update", "success", map[string]any{"limits": cfg.TerminalHistoryRetention}, nil)
		writeJSON(w, 200, apiResp{OK: true, Data: cfg.TerminalHistoryRetention})
	default:
		writeJSON(w, 405, apiResp{OK: false, Error: "method not allowed"})
	}
	return true
}
