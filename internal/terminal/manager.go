package terminal

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	termgo "github.com/floegence/floeterm/terminal-go"
	rpcwirev1 "github.com/floegence/flowersec/flowersec-go/gen/flowersec/rpc/v1"
	"github.com/floegence/flowersec/flowersec-go/rpc"
	rpctyped "github.com/floegence/flowersec/flowersec-go/rpc/typed"
	"github.com/floegence/redeven-agent/internal/session"
)

const (
	TypeID_TERMINAL_SESSION_CREATE uint32 = 2001
	TypeID_TERMINAL_SESSION_LIST   uint32 = 2002
	TypeID_TERMINAL_SESSION_ATTACH uint32 = 2003

	TypeID_TERMINAL_OUTPUT  uint32 = 2004 // notify (agent -> client)
	TypeID_TERMINAL_RESIZE  uint32 = 2005 // notify (client -> agent)
	TypeID_TERMINAL_INPUT   uint32 = 2006 // notify (client -> agent)
	TypeID_TERMINAL_HISTORY uint32 = 2007
	TypeID_TERMINAL_CLEAR   uint32 = 2008

	TypeID_TERMINAL_SESSION_DELETE   uint32 = 2009
	TypeID_TERMINAL_NAME_UPDATE      uint32 = 2010 // notify (agent -> client): session name/working dir changed
	TypeID_TERMINAL_SESSION_STATS    uint32 = 2011 // history buffer stats (client -> agent)
	TypeID_TERMINAL_SESSIONS_CHANGED uint32 = 2012 // notify (agent -> client): terminal sessions list changed
)

type Manager struct {
	root string
	log  *slog.Logger

	term *termgo.Manager

	mu              sync.Mutex
	writers         map[*rpc.Server]*sinkWriter
	byServer        map[*rpc.Server]map[string]string // server -> session_id -> conn_id
	bySession       map[string]map[*rpc.Server]string // session_id -> server -> conn_id
	closedSinks     map[*rpc.Server]struct{}          // best-effort marker to avoid repeated work
	deleteRequested map[string]struct{}               // session_id -> delete requested (used for lifecycle reason)
}

type slogTerminalLogger struct{ log *slog.Logger }

func (l slogTerminalLogger) Debug(msg string, kv ...any) { l.log.Debug(msg, kv...) }
func (l slogTerminalLogger) Info(msg string, kv ...any)  { l.log.Info(msg, kv...) }
func (l slogTerminalLogger) Warn(msg string, kv ...any)  { l.log.Warn(msg, kv...) }
func (l slogTerminalLogger) Error(msg string, kv ...any) { l.log.Error(msg, kv...) }

type fixedShellResolver struct {
	shell string
}

func (r fixedShellResolver) ResolveShell(logger termgo.Logger) string {
	shell := strings.TrimSpace(r.shell)
	if shell != "" {
		if _, err := os.Stat(shell); err == nil {
			return shell
		}
		logger.Warn("configured shell missing; falling back", "shell", shell)
	}
	return termgo.DefaultShellResolver{}.ResolveShell(logger)
}

func NewManager(shell string, root string, log *slog.Logger) *Manager {
	if abs, err := filepath.Abs(strings.TrimSpace(root)); err == nil && abs != "" {
		root = abs
	}
	root = filepath.Clean(root)
	if log == nil {
		log = slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}

	m := &Manager{
		root:            root,
		log:             log,
		writers:         make(map[*rpc.Server]*sinkWriter),
		byServer:        make(map[*rpc.Server]map[string]string),
		bySession:       make(map[string]map[*rpc.Server]string),
		closedSinks:     make(map[*rpc.Server]struct{}),
		deleteRequested: make(map[string]struct{}),
	}

	cfg := termgo.ManagerConfig{
		Logger:        slogTerminalLogger{log: log},
		ShellResolver: fixedShellResolver{shell: shell},
	}
	m.term = termgo.NewManager(cfg)
	m.term.SetEventHandler(&eventHandler{m: m})

	return m
}

func (m *Manager) Register(r *rpc.Router, meta *session.Meta, streamServer *rpc.Server) {
	if m == nil || r == nil {
		return
	}

	if meta != nil && meta.CanExecute && streamServer != nil {
		m.ensureWriter(streamServer)
	}

	// Create session
	rpctyped.Register[terminalCreateReq, terminalCreateResp](r, TypeID_TERMINAL_SESSION_CREATE, func(_ context.Context, req *terminalCreateReq) (*terminalCreateResp, error) {
		if meta == nil || !meta.CanExecute {
			return nil, &rpc.Error{Code: 403, Message: "execute permission denied"}
		}
		if req == nil {
			req = &terminalCreateReq{}
		}

		cols := req.Cols
		rows := req.Rows
		if cols <= 0 || rows <= 0 {
			return nil, &rpc.Error{Code: 400, Message: "cols and rows are required"}
		}

		workingDirAbs, err := m.resolveCwd(req.WorkingDir)
		if err != nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid working_dir"}
		}

		name := strings.TrimSpace(req.Name)
		sess, err := m.term.CreateSession(name, workingDirAbs, cols, rows)
		if err != nil {
			m.log.Warn("terminal create failed", "error", err)
			return nil, &rpc.Error{Code: 500, Message: "failed to create terminal session"}
		}

		info := sess.ToSessionInfo()
		info.WorkingDir = m.virtualPathFromAbs(info.WorkingDir)

		return &terminalCreateResp{Session: toWireSessionInfo(info)}, nil
	})

	// List sessions
	rpctyped.Register[terminalListReq, terminalListResp](r, TypeID_TERMINAL_SESSION_LIST, func(_ context.Context, _ *terminalListReq) (*terminalListResp, error) {
		if meta == nil || !meta.CanExecute {
			return nil, &rpc.Error{Code: 403, Message: "execute permission denied"}
		}

		sessions := m.term.ListSessions()
		out := make([]*terminalSessionInfo, 0, len(sessions))
		for _, s := range sessions {
			if s == nil {
				continue
			}
			info := s.ToSessionInfo()
			info.WorkingDir = m.virtualPathFromAbs(info.WorkingDir)
			out = append(out, toWireSessionInfo(info))
		}
		return &terminalListResp{Sessions: out}, nil
	})

	// Attach session: bind terminal output notifications to this RPC stream and register a connection.
	rpctyped.Register[terminalAttachReq, terminalAttachResp](r, TypeID_TERMINAL_SESSION_ATTACH, func(_ context.Context, req *terminalAttachReq) (*terminalAttachResp, error) {
		if meta == nil || !meta.CanExecute {
			return nil, &rpc.Error{Code: 403, Message: "execute permission denied"}
		}
		if streamServer == nil {
			return nil, &rpc.Error{Code: 500, Message: "internal error"}
		}

		if req == nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid payload"}
		}
		sessionID := strings.TrimSpace(req.SessionID)
		connID := strings.TrimSpace(req.ConnID)
		if sessionID == "" {
			return nil, &rpc.Error{Code: 400, Message: "session_id is required"}
		}
		if connID == "" {
			return nil, &rpc.Error{Code: 400, Message: "conn_id is required"}
		}
		if req.Cols <= 0 || req.Rows <= 0 {
			return nil, &rpc.Error{Code: 400, Message: "cols and rows are required"}
		}

		sess, ok := m.term.GetSession(sessionID)
		if !ok || sess == nil {
			return nil, &rpc.Error{Code: 404, Message: "terminal session not found"}
		}

		m.attachSink(sessionID, connID, streamServer)
		sess.AddConnection(connID, req.Cols, req.Rows)

		return &terminalAttachResp{OK: true}, nil
	})

	// Terminal input (notify)
	r.Register(TypeID_TERMINAL_INPUT, func(_ context.Context, payload json.RawMessage) (json.RawMessage, *rpcwirev1.RpcError) {
		if meta == nil || !meta.CanExecute {
			return nil, rpc.ToWireError(&rpc.Error{Code: 403, Message: "execute permission denied"})
		}
		var msg terminalInputPayload
		if err := json.Unmarshal(payload, &msg); err != nil {
			return nil, rpc.ToWireError(&rpc.Error{Code: 400, Message: "invalid payload"})
		}
		if err := m.write(strings.TrimSpace(msg.SessionID), strings.TrimSpace(msg.ConnID), strings.TrimSpace(msg.DataB64)); err != nil {
			return nil, rpc.ToWireError(err)
		}
		return nil, nil
	})

	// Resize (notify)
	r.Register(TypeID_TERMINAL_RESIZE, func(_ context.Context, payload json.RawMessage) (json.RawMessage, *rpcwirev1.RpcError) {
		if meta == nil || !meta.CanExecute {
			return nil, rpc.ToWireError(&rpc.Error{Code: 403, Message: "execute permission denied"})
		}
		var msg terminalResizePayload
		if err := json.Unmarshal(payload, &msg); err != nil {
			return nil, rpc.ToWireError(&rpc.Error{Code: 400, Message: "invalid payload"})
		}
		if err := m.resize(strings.TrimSpace(msg.SessionID), strings.TrimSpace(msg.ConnID), msg.Cols, msg.Rows); err != nil {
			return nil, rpc.ToWireError(err)
		}
		return nil, nil
	})

	// History
	rpctyped.Register[terminalHistoryReq, terminalHistoryResp](r, TypeID_TERMINAL_HISTORY, func(_ context.Context, req *terminalHistoryReq) (*terminalHistoryResp, error) {
		if meta == nil || !meta.CanExecute {
			return nil, &rpc.Error{Code: 403, Message: "execute permission denied"}
		}
		if req == nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid payload"}
		}
		sessionID := strings.TrimSpace(req.SessionID)
		if sessionID == "" {
			return nil, &rpc.Error{Code: 400, Message: "session_id is required"}
		}

		sess, ok := m.term.GetSession(sessionID)
		if !ok || sess == nil {
			return nil, &rpc.Error{Code: 404, Message: "terminal session not found"}
		}

		chunks, err := sess.GetHistoryFromSequence(req.StartSeq)
		if err != nil {
			m.log.Warn("terminal history failed", "session_id", sessionID, "error", err)
			return nil, &rpc.Error{Code: 500, Message: "failed to read history"}
		}

		endSeq := req.EndSeq
		out := make([]terminalHistoryChunk, 0, len(chunks))
		for _, c := range chunks {
			if endSeq > 0 && c.Sequence > endSeq {
				continue
			}
			out = append(out, terminalHistoryChunk{
				Sequence:    c.Sequence,
				TimestampMs: c.Timestamp,
				DataB64:     base64.StdEncoding.EncodeToString(c.Data),
			})
		}
		return &terminalHistoryResp{Chunks: out}, nil
	})

	// Session stats (history buffer size, etc.)
	rpctyped.Register[terminalStatsReq, terminalStatsResp](r, TypeID_TERMINAL_SESSION_STATS, func(_ context.Context, req *terminalStatsReq) (*terminalStatsResp, error) {
		if meta == nil || !meta.CanExecute {
			return nil, &rpc.Error{Code: 403, Message: "execute permission denied"}
		}
		if req == nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid payload"}
		}
		sessionID := strings.TrimSpace(req.SessionID)
		if sessionID == "" {
			return nil, &rpc.Error{Code: 400, Message: "session_id is required"}
		}

		sess, ok := m.term.GetSession(sessionID)
		if !ok || sess == nil {
			return nil, &rpc.Error{Code: 404, Message: "terminal session not found"}
		}

		stats, err := sess.GetHistoryStats()
		if err != nil {
			m.log.Warn("terminal stats failed", "session_id", sessionID, "error", err)
			return nil, &rpc.Error{Code: 500, Message: "failed to read stats"}
		}

		return &terminalStatsResp{
			History: terminalHistoryStats{
				TotalBytes: stats.TotalBytes,
			},
		}, nil
	})

	// Clear history
	rpctyped.Register[terminalClearReq, terminalClearResp](r, TypeID_TERMINAL_CLEAR, func(_ context.Context, req *terminalClearReq) (*terminalClearResp, error) {
		if meta == nil || !meta.CanExecute {
			return nil, &rpc.Error{Code: 403, Message: "execute permission denied"}
		}
		if req == nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid payload"}
		}
		sessionID := strings.TrimSpace(req.SessionID)
		if sessionID == "" {
			return nil, &rpc.Error{Code: 400, Message: "session_id is required"}
		}
		if err := m.term.ClearSessionHistory(sessionID); err != nil {
			return nil, &rpc.Error{Code: 404, Message: "terminal session not found"}
		}
		return &terminalClearResp{OK: true}, nil
	})

	// Delete session
	rpctyped.Register[terminalDeleteReq, terminalDeleteResp](r, TypeID_TERMINAL_SESSION_DELETE, func(_ context.Context, req *terminalDeleteReq) (*terminalDeleteResp, error) {
		if meta == nil || !meta.CanExecute {
			return nil, &rpc.Error{Code: 403, Message: "execute permission denied"}
		}
		if req == nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid payload"}
		}
		sessionID := strings.TrimSpace(req.SessionID)
		if sessionID == "" {
			return nil, &rpc.Error{Code: 400, Message: "session_id is required"}
		}
		m.markDeleteRequested(sessionID)
		if err := m.term.DeleteSession(sessionID); err != nil {
			m.unmarkDeleteRequested(sessionID)
			return nil, &rpc.Error{Code: 404, Message: "terminal session not found"}
		}
		return &terminalDeleteResp{OK: true}, nil
	})
}

// DetachSink removes all terminal attachments bound to the given RPC stream.
func (m *Manager) DetachSink(streamServer *rpc.Server) {
	if m == nil || streamServer == nil {
		return
	}

	var toRemove []sinkDetach
	var writer *sinkWriter

	m.mu.Lock()
	if sessions := m.byServer[streamServer]; len(sessions) > 0 {
		for sessionID, connID := range sessions {
			toRemove = append(toRemove, sinkDetach{sessionID: sessionID, connID: connID})
			if bySess := m.bySession[sessionID]; bySess != nil {
				delete(bySess, streamServer)
				if len(bySess) == 0 {
					delete(m.bySession, sessionID)
				}
			}
		}
		delete(m.byServer, streamServer)
	}
	writer = m.writers[streamServer]
	delete(m.writers, streamServer)
	m.closedSinks[streamServer] = struct{}{}
	m.mu.Unlock()

	for _, item := range toRemove {
		sess, ok := m.term.GetSession(item.sessionID)
		if !ok || sess == nil {
			continue
		}
		sess.RemoveConnection(item.connID)
	}

	if writer != nil {
		writer.Close()
	}
}

// Cleanup terminates all running terminal sessions (best-effort).
func (m *Manager) Cleanup() {
	if m == nil || m.term == nil {
		return
	}
	m.term.Cleanup()
}

type sinkDetach struct {
	sessionID string
	connID    string
}

func (m *Manager) ensureWriter(sink *rpc.Server) {
	if m == nil || sink == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.writers[sink]; ok {
		return
	}
	m.writers[sink] = newSinkWriter(sink, m.log)
}

func (m *Manager) markDeleteRequested(sessionID string) {
	if m == nil || sessionID == "" {
		return
	}
	m.mu.Lock()
	m.deleteRequested[sessionID] = struct{}{}
	m.mu.Unlock()
}

func (m *Manager) unmarkDeleteRequested(sessionID string) {
	if m == nil || sessionID == "" {
		return
	}
	m.mu.Lock()
	delete(m.deleteRequested, sessionID)
	m.mu.Unlock()
}

func (m *Manager) takeDeleteRequested(sessionID string) bool {
	if m == nil || sessionID == "" {
		return false
	}
	m.mu.Lock()
	_, ok := m.deleteRequested[sessionID]
	if ok {
		delete(m.deleteRequested, sessionID)
	}
	m.mu.Unlock()
	return ok
}

func (m *Manager) attachSink(sessionID string, connID string, sink *rpc.Server) {
	if m == nil || sink == nil || sessionID == "" || connID == "" {
		return
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if _, ok := m.writers[sink]; !ok {
		m.writers[sink] = newSinkWriter(sink, m.log)
	}

	sessions := m.byServer[sink]
	if sessions == nil {
		sessions = make(map[string]string)
		m.byServer[sink] = sessions
	}
	sessions[sessionID] = connID

	servers := m.bySession[sessionID]
	if servers == nil {
		servers = make(map[*rpc.Server]string)
		m.bySession[sessionID] = servers
	}
	servers[sink] = connID
}

func (m *Manager) broadcast(sessionID string, payload json.RawMessage) {
	if m == nil || sessionID == "" || len(payload) == 0 {
		return
	}

	var writers []*sinkWriter
	m.mu.Lock()
	if bySess := m.bySession[sessionID]; bySess != nil {
		writers = make([]*sinkWriter, 0, len(bySess))
		for srv := range bySess {
			if w := m.writers[srv]; w != nil {
				writers = append(writers, w)
			}
		}
	}
	m.mu.Unlock()

	if len(writers) == 0 {
		return
	}

	msg := sinkMsg{TypeID: TypeID_TERMINAL_OUTPUT, Payload: payload}
	for _, w := range writers {
		w.TrySend(msg)
	}
}

// broadcastNameUpdate sends a name/working directory update notification to all
// connected clients attached to the given session.
func (m *Manager) broadcastNameUpdate(sessionID string, newName string, workingDir string) {
	if m == nil || sessionID == "" {
		return
	}

	var writers []*sinkWriter
	m.mu.Lock()
	if bySess := m.bySession[sessionID]; bySess != nil {
		writers = make([]*sinkWriter, 0, len(bySess))
		for srv := range bySess {
			if w := m.writers[srv]; w != nil {
				writers = append(writers, w)
			}
		}
	}
	m.mu.Unlock()

	if len(writers) == 0 {
		return
	}

	payload := terminalNameUpdatePayload{
		SessionID:  sessionID,
		NewName:    newName,
		WorkingDir: m.virtualPathFromAbs(workingDir),
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return
	}

	msg := sinkMsg{TypeID: TypeID_TERMINAL_NAME_UPDATE, Payload: b}
	for _, w := range writers {
		w.TrySend(msg)
	}
}

func (m *Manager) broadcastSessionsChanged(payload terminalSessionsChangedPayload) {
	if m == nil || strings.TrimSpace(payload.Reason) == "" {
		return
	}

	b, err := json.Marshal(payload)
	if err != nil || len(b) == 0 {
		return
	}

	var writers []*sinkWriter
	m.mu.Lock()
	if len(m.writers) > 0 {
		writers = make([]*sinkWriter, 0, len(m.writers))
		for _, w := range m.writers {
			if w != nil {
				writers = append(writers, w)
			}
		}
	}
	m.mu.Unlock()

	if len(writers) == 0 {
		return
	}

	msg := sinkMsg{TypeID: TypeID_TERMINAL_SESSIONS_CHANGED, Payload: b}
	for _, w := range writers {
		w.TrySend(msg)
	}
}

func (m *Manager) write(sessionID string, connID string, dataB64 string) error {
	if m == nil {
		return &rpc.Error{Code: 500, Message: "internal error"}
	}
	if sessionID == "" {
		return &rpc.Error{Code: 400, Message: "session_id is required"}
	}
	if connID == "" {
		return &rpc.Error{Code: 400, Message: "conn_id is required"}
	}
	if dataB64 == "" {
		return nil
	}

	sess, ok := m.term.GetSession(sessionID)
	if !ok || sess == nil {
		return &rpc.Error{Code: 404, Message: "terminal session not found"}
	}

	b, err := base64.StdEncoding.DecodeString(dataB64)
	if err != nil {
		return &rpc.Error{Code: 400, Message: "invalid base64"}
	}

	if err := sess.WriteDataWithSource(b, connID); err != nil {
		return &rpc.Error{Code: 500, Message: "write failed"}
	}
	return nil
}

func (m *Manager) resize(sessionID string, connID string, cols int, rows int) error {
	if m == nil {
		return &rpc.Error{Code: 500, Message: "internal error"}
	}
	if sessionID == "" {
		return &rpc.Error{Code: 400, Message: "session_id is required"}
	}
	if connID == "" {
		return &rpc.Error{Code: 400, Message: "conn_id is required"}
	}
	if cols <= 0 || rows <= 0 {
		return &rpc.Error{Code: 400, Message: "cols and rows are required"}
	}

	sess, ok := m.term.GetSession(sessionID)
	if !ok || sess == nil {
		return &rpc.Error{Code: 404, Message: "terminal session not found"}
	}

	// Note: resize may arrive before attach completes; terminal-go will ignore unknown conn_id.
	sess.UpdateConnectionSize(connID, cols, rows)
	return nil
}

type eventHandler struct{ m *Manager }

func (h *eventHandler) OnTerminalData(sessionID string, data []byte, sequenceNumber int64, isEcho bool, originalSource string) {
	if h == nil || h.m == nil {
		return
	}
	msg := terminalOutputPayload{
		SessionID:      sessionID,
		DataB64:        base64.StdEncoding.EncodeToString(data),
		Sequence:       sequenceNumber,
		TimestampMs:    time.Now().UnixMilli(),
		EchoOfInput:    isEcho,
		OriginalSource: originalSource,
	}
	b, _ := json.Marshal(msg)
	h.m.broadcast(sessionID, b)
}

func (h *eventHandler) OnTerminalNameChanged(sessionID string, oldName string, newName string, workingDir string) {
	if h == nil || h.m == nil {
		return
	}
	// Broadcast name/working directory update to all connected clients.
	// This allows the frontend to update the terminal tab title in real-time.
	h.m.broadcastNameUpdate(sessionID, newName, workingDir)
}

func (h *eventHandler) OnTerminalSessionCreated(session *termgo.Session) {
	if h == nil || h.m == nil || session == nil {
		return
	}
	info := session.ToSessionInfo()
	sessionID := strings.TrimSpace(info.ID)
	if sessionID == "" {
		return
	}

	h.m.broadcastSessionsChanged(terminalSessionsChangedPayload{
		Reason:      "created",
		SessionID:   sessionID,
		TimestampMs: time.Now().UnixMilli(),
	})
}

func (h *eventHandler) OnTerminalSessionClosed(sessionID string) {
	if h == nil || h.m == nil {
		return
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return
	}

	reason := "closed"
	if h.m.takeDeleteRequested(sessionID) {
		reason = "deleted"
	}

	h.m.broadcastSessionsChanged(terminalSessionsChangedPayload{
		Reason:      reason,
		SessionID:   sessionID,
		TimestampMs: time.Now().UnixMilli(),
	})
}

func (h *eventHandler) OnTerminalError(sessionID string, err error) {
	if h == nil || h.m == nil {
		return
	}
	h.m.log.Warn("terminal session error", "session_id", sessionID, "error", err)
}

// --- wire types (snake_case JSON) ---

type terminalSessionInfo struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	WorkingDir     string `json:"working_dir"`
	CreatedAtMs    int64  `json:"created_at_ms"`
	LastActiveAtMs int64  `json:"last_active_at_ms"`
	IsActive       bool   `json:"is_active"`
}

func toWireSessionInfo(info termgo.TerminalSessionInfo) *terminalSessionInfo {
	return &terminalSessionInfo{
		ID:             info.ID,
		Name:           info.Name,
		WorkingDir:     info.WorkingDir,
		CreatedAtMs:    info.CreatedAt,
		LastActiveAtMs: info.LastActive,
		IsActive:       info.IsActive,
	}
}

type terminalCreateReq struct {
	Name       string `json:"name,omitempty"`
	WorkingDir string `json:"working_dir,omitempty"`
	Cols       int    `json:"cols"`
	Rows       int    `json:"rows"`
}

type terminalCreateResp struct {
	Session *terminalSessionInfo `json:"session"`
}

type terminalListReq struct{}

type terminalListResp struct {
	Sessions []*terminalSessionInfo `json:"sessions"`
}

type terminalAttachReq struct {
	SessionID string `json:"session_id"`
	ConnID    string `json:"conn_id"`
	Cols      int    `json:"cols"`
	Rows      int    `json:"rows"`
}

type terminalAttachResp struct {
	OK bool `json:"ok"`
}

type terminalInputPayload struct {
	SessionID string `json:"session_id"`
	ConnID    string `json:"conn_id"`
	DataB64   string `json:"data_b64"`
}

type terminalOutputPayload struct {
	SessionID      string `json:"session_id"`
	DataB64        string `json:"data_b64"`
	Sequence       int64  `json:"sequence,omitempty"`
	TimestampMs    int64  `json:"timestamp_ms,omitempty"`
	EchoOfInput    bool   `json:"echo_of_input,omitempty"`
	OriginalSource string `json:"original_source,omitempty"`
}

type terminalResizePayload struct {
	SessionID string `json:"session_id"`
	ConnID    string `json:"conn_id"`
	Cols      int    `json:"cols"`
	Rows      int    `json:"rows"`
}

type terminalNameUpdatePayload struct {
	SessionID  string `json:"session_id"`
	NewName    string `json:"new_name"`
	WorkingDir string `json:"working_dir"`
}

type terminalSessionsChangedPayload struct {
	Reason      string `json:"reason"`
	SessionID   string `json:"session_id,omitempty"`
	TimestampMs int64  `json:"timestamp_ms,omitempty"`
}

type terminalHistoryReq struct {
	SessionID string `json:"session_id"`
	StartSeq  int64  `json:"start_seq"`
	EndSeq    int64  `json:"end_seq"`
}

type terminalHistoryChunk struct {
	Sequence    int64  `json:"sequence"`
	TimestampMs int64  `json:"timestamp_ms"`
	DataB64     string `json:"data_b64"`
}

type terminalHistoryResp struct {
	Chunks []terminalHistoryChunk `json:"chunks"`
}

type terminalStatsReq struct {
	SessionID string `json:"session_id"`
}

type terminalHistoryStats struct {
	TotalBytes int64 `json:"total_bytes"`
}

type terminalStatsResp struct {
	History terminalHistoryStats `json:"history"`
}

type terminalClearReq struct {
	SessionID string `json:"session_id"`
}

type terminalClearResp struct {
	OK bool `json:"ok"`
}

type terminalDeleteReq struct {
	SessionID string `json:"session_id"`
}

type terminalDeleteResp struct {
	OK bool `json:"ok"`
}

// --- virtual working dir helpers ---

func (m *Manager) resolveCwd(cwd string) (string, error) {
	if m == nil {
		return "", errors.New("nil manager")
	}
	cwd = strings.TrimSpace(cwd)
	if cwd == "" {
		cwd = "/"
	}

	// Virtual paths are POSIX-like absolute paths starting with "/".
	cwd = strings.ReplaceAll(cwd, "\\", "/")
	if !strings.HasPrefix(cwd, "/") {
		cwd = "/" + cwd
	}

	vp := path.Clean(cwd)
	if vp == "." {
		vp = "/"
	}
	if !strings.HasPrefix(vp, "/") {
		vp = "/" + vp
	}

	rel := strings.TrimPrefix(vp, "/")
	relOS := filepath.FromSlash(rel)
	if relOS != "" && filepath.IsAbs(relOS) {
		return "", errors.New("invalid absolute path")
	}

	abs := filepath.Clean(filepath.Join(m.root, relOS))
	ok, err := isWithinRoot(abs, m.root)
	if err != nil || !ok {
		return "", errors.New("path escapes root")
	}
	return abs, nil
}

func (m *Manager) virtualPathFromAbs(abs string) string {
	abs = filepath.Clean(strings.TrimSpace(abs))
	root := filepath.Clean(m.root)
	if abs == "" || root == "" {
		return "/"
	}

	rel, err := filepath.Rel(root, abs)
	if err != nil {
		return "/"
	}
	rel = filepath.Clean(rel)
	if rel == "." {
		return "/"
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "/"
	}
	return "/" + filepath.ToSlash(rel)
}

func isWithinRoot(path string, root string) (bool, error) {
	path = filepath.Clean(path)
	root = filepath.Clean(root)
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false, err
	}
	rel = filepath.Clean(rel)
	if rel == "." {
		return true, nil
	}
	if rel == ".." {
		return false, nil
	}
	if strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return false, nil
	}
	return true, nil
}

// --- async notify sink ---

type sinkMsg struct {
	TypeID  uint32
	Payload json.RawMessage
}

type sinkWriter struct {
	srv *rpc.Server
	log *slog.Logger

	ch   chan sinkMsg
	once sync.Once
	done chan struct{}
}

func newSinkWriter(srv *rpc.Server, log *slog.Logger) *sinkWriter {
	w := &sinkWriter{
		srv:  srv,
		log:  log,
		ch:   make(chan sinkMsg, 256),
		done: make(chan struct{}),
	}
	go w.loop()
	return w
}

func (w *sinkWriter) loop() {
	defer close(w.done)
	for msg := range w.ch {
		if w.srv == nil {
			return
		}
		if err := w.srv.Notify(msg.TypeID, msg.Payload); err != nil {
			// Stream likely closed. The upper layer will call DetachSink via defer.
			if w.log != nil && !errors.Is(err, context.Canceled) {
				w.log.Debug("terminal notify failed", "error", err)
			}
			return
		}
	}
}

func (w *sinkWriter) TrySend(msg sinkMsg) {
	if w == nil {
		return
	}
	select {
	case <-w.done:
		return
	default:
	}

	// Best-effort: if the consumer is slow, drop messages. Clients can recover via history replay.
	select {
	case w.ch <- msg:
	default:
	}
}

func (w *sinkWriter) Close() {
	if w == nil {
		return
	}
	w.once.Do(func() {
		close(w.ch)
	})
	<-w.done
}
