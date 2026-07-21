package terminal

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"

	termgo "github.com/floegence/floeterm/terminal-go"
	livev1 "github.com/floegence/floeterm/terminal-go/livev1"
	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/session"
)

const (
	TypeID_TERMINAL_SESSION_CREATE uint32 = 2001
	TypeID_TERMINAL_SESSION_LIST   uint32 = 2002
	TypeID_TERMINAL_HISTORY        uint32 = 2007
	TypeID_TERMINAL_CLEAR          uint32 = 2008

	TypeID_TERMINAL_SESSION_DELETE            uint32 = 2009
	TypeID_TERMINAL_NAME_UPDATE               uint32 = 2010 // notify (agent -> client): session name/working dir changed
	TypeID_TERMINAL_SESSION_STATS             uint32 = 2011 // history buffer stats (client -> agent)
	TypeID_TERMINAL_SESSIONS_CHANGED          uint32 = 2012 // notify (agent -> client): terminal sessions list changed
	TypeID_TERMINAL_FOREGROUND_COMMAND_UPDATE uint32 = 2013 // notify (agent -> client): shell-reported foreground command changed
	TypeID_TERMINAL_OUTPUT_ACTIVITY_UPDATE    uint32 = 2014 // notify (agent -> client): foreground command output activity changed
)

const (
	defaultTerminalHistoryPageChunks = 2048
	maxTerminalHistoryPageChunks     = 4096
	defaultTerminalHistoryPageBytes  = 384 * 1024
	maxTerminalHistoryPageBytes      = 512 * 1024
	terminalHistoryBufferSize        = 2048
	terminalHistoryBufferMaxChunks   = 65536
	terminalHistoryBufferMaxBytes    = 8 * 1024 * 1024
)

var ErrSessionNotFound = errors.New("terminal session not found")

type Manager struct {
	agentHomeAbs string
	scope        *filesystemscope.Registry
	log          *slog.Logger

	term                *termgo.Manager
	deleteSessionFunc   func(sessionID string) error
	activateSessionFunc func(ctx context.Context, sessionID string, cols int, rows int) error

	mu               sync.Mutex
	writers          map[*rpc.Server]*controlSink
	sessionLifecycle map[string]SessionLifecycleRecord
	deleteOperations map[string]*sessionDeleteOperation
	lifecycleHooks   map[int]SessionLifecycleHook
	nextLifecycleID  int
}

type SessionInfo struct {
	ID                string                `json:"id"`
	Name              string                `json:"name"`
	WorkingDir        string                `json:"working_dir"`
	CreatedAtMs       int64                 `json:"created_at_ms"`
	LastActiveAtMs    int64                 `json:"last_active_at_ms"`
	IsActive          bool                  `json:"is_active"`
	ForegroundCommand ForegroundCommandInfo `json:"foreground_command"`
	OutputActivity    *OutputActivityInfo   `json:"output_activity,omitempty"`
}

type ForegroundCommandInfo struct {
	Phase       string `json:"phase"`
	DisplayName string `json:"display_name"`
	Revision    uint64 `json:"revision"`
	UpdatedAtMs int64  `json:"updated_at_ms"`
}

type OutputActivityInfo struct {
	Phase       string `json:"phase"`
	Revision    uint64 `json:"revision"`
	UpdatedAtMs int64  `json:"updated_at_ms"`
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

func (r fixedShellResolver) ResolveShellContext(ctx context.Context, logger termgo.Logger) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	return r.ResolveShell(logger), nil
}

func newTerminalGoManagerConfig(shell string, log *slog.Logger) termgo.ManagerConfig {
	shellInitBaseDir := defaultRedevenShellInitBaseDir()
	return termgo.ManagerConfig{
		Logger:                 slogTerminalLogger{log: log},
		EnvProvider:            termgo.DefaultEnvProvider{},
		ShellResolver:          fixedShellResolver{shell: shell},
		HistoryBufferSize:      terminalHistoryBufferSize,
		HistoryBufferMaxChunks: terminalHistoryBufferMaxChunks,
		HistoryBufferMaxBytes:  terminalHistoryBufferMaxBytes,
		ShellArgsProvider: termgo.DefaultShellArgsProvider{
			ShellInitBaseDir:       shellInitBaseDir,
			EnableCommandLifecycle: true,
		},
		ShellInitWriter: termgo.DefaultShellInitWriter{
			BaseDir:                shellInitBaseDir,
			EnableCommandLifecycle: true,
		},
	}
}

func NewManager(shell string, agentHomeAbs string, log *slog.Logger) *Manager {
	scope, err := filesystemscope.NewDefaultRegistry(agentHomeAbs)
	if err != nil {
		panic(err)
	}
	return NewManagerWithScope(shell, scope, log)
}

func NewManagerWithScope(shell string, scope *filesystemscope.Registry, log *slog.Logger) *Manager {
	if scope == nil {
		panic("nil filesystem scope")
	}
	if log == nil {
		log = slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}

	m := &Manager{
		agentHomeAbs:     scope.HomePathAbs(),
		scope:            scope,
		log:              log,
		writers:          make(map[*rpc.Server]*controlSink),
		sessionLifecycle: make(map[string]SessionLifecycleRecord),
		deleteOperations: make(map[string]*sessionDeleteOperation),
		lifecycleHooks:   make(map[int]SessionLifecycleHook),
	}

	m.term = termgo.NewManager(newTerminalGoManagerConfig(shell, log))
	m.term.SetEventHandler(&eventHandler{m: m})
	m.deleteSessionFunc = m.deleteSessionNow
	m.activateSessionFunc = m.term.ActivateSessionContext

	return m
}

func (m *Manager) CreateSession(name string, workingDir string) (*SessionInfo, error) {
	sess, err := m.createSession(strings.TrimSpace(name), strings.TrimSpace(workingDir))
	if err != nil {
		return nil, err
	}
	return toSessionInfo(sess.ToSessionInfo()), nil
}

func (m *Manager) DeleteSession(sessionID string) error {
	return m.requestSessionDelete(sessionID, "", true)
}

func (m *Manager) Register(r *rpc.Router, meta *session.Meta, streamServer *rpc.Server) func() {
	return m.RegisterWithAccessGate(r, meta, streamServer, nil)
}

func (m *Manager) RegisterWithAccessGate(r *rpc.Router, meta *session.Meta, streamServer *rpc.Server, gate *accessgate.Gate) func() {
	if m == nil || r == nil {
		return func() {}
	}

	if session.AllowsProcessLaunch(meta) && streamServer != nil {
		m.ensureWriter(streamServer)
	}

	// Create session
	accessgate.RegisterTyped[terminalCreateReq, terminalCreateResp](r, TypeID_TERMINAL_SESSION_CREATE, gate, meta, accessgate.RPCAccessProtected, func(_ context.Context, req *terminalCreateReq) (*terminalCreateResp, error) {
		if err := requireProcessLaunchPermission(meta); err != nil {
			return nil, err
		}
		if req == nil {
			req = &terminalCreateReq{}
		}

		sess, err := m.createSession(strings.TrimSpace(req.Name), strings.TrimSpace(req.WorkingDir))
		if err != nil {
			return nil, err
		}

		return &terminalCreateResp{Session: toWireSessionInfo(sess.ToSessionInfo())}, nil
	})

	// List sessions
	accessgate.RegisterTyped[terminalListReq, terminalListResp](r, TypeID_TERMINAL_SESSION_LIST, gate, meta, accessgate.RPCAccessProtected, func(_ context.Context, _ *terminalListReq) (*terminalListResp, error) {
		if err := requireProcessLaunchPermission(meta); err != nil {
			return nil, err
		}

		sessions := m.visibleSessionInfos()
		out := make([]*terminalSessionInfo, 0, len(sessions))
		for _, s := range sessions {
			out = append(out, toWireSessionInfo(s))
		}
		return &terminalListResp{Sessions: out}, nil
	})

	// History
	accessgate.RegisterTyped[terminalHistoryReq, terminalHistoryResp](r, TypeID_TERMINAL_HISTORY, gate, meta, accessgate.RPCAccessProtected, func(_ context.Context, req *terminalHistoryReq) (*terminalHistoryResp, error) {
		if err := requireProcessLaunchPermission(meta); err != nil {
			return nil, err
		}
		if req == nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid payload"}
		}
		sessionID := strings.TrimSpace(req.SessionID)
		if sessionID == "" {
			return nil, &rpc.Error{Code: 400, Message: "session_id is required"}
		}
		if req.HistoryGeneration < 0 {
			return nil, &rpc.Error{Code: 400, Message: "history_generation must be non-negative"}
		}

		if !m.sessionAvailableForInteraction(sessionID) {
			return nil, &rpc.Error{Code: 404, Message: "terminal session not found"}
		}

		sess, ok := m.term.GetSession(sessionID)
		if !ok || sess == nil {
			return nil, &rpc.Error{Code: 404, Message: "terminal session not found"}
		}

		page, err := sess.GetHistoryPage(normalizeTerminalHistoryPageOptions(req))
		if err != nil {
			m.log.Warn("terminal history failed", "session_id", sessionID, "error", err)
			return nil, &rpc.Error{Code: 500, Message: "failed to read history"}
		}

		return terminalHistoryRespFromPage(page), nil
	})

	// Session stats (history buffer size, etc.)
	accessgate.RegisterTyped[terminalStatsReq, terminalStatsResp](r, TypeID_TERMINAL_SESSION_STATS, gate, meta, accessgate.RPCAccessProtected, func(_ context.Context, req *terminalStatsReq) (*terminalStatsResp, error) {
		if err := requireProcessLaunchPermission(meta); err != nil {
			return nil, err
		}
		if req == nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid payload"}
		}
		sessionID := strings.TrimSpace(req.SessionID)
		if sessionID == "" {
			return nil, &rpc.Error{Code: 400, Message: "session_id is required"}
		}
		if !m.sessionAvailableForInteraction(sessionID) {
			return nil, &rpc.Error{Code: 404, Message: "terminal session not found"}
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
	accessgate.RegisterTyped[terminalClearReq, terminalClearResp](r, TypeID_TERMINAL_CLEAR, gate, meta, accessgate.RPCAccessProtected, func(_ context.Context, req *terminalClearReq) (*terminalClearResp, error) {
		if err := requireProcessLaunchPermission(meta); err != nil {
			return nil, err
		}
		if req == nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid payload"}
		}
		sessionID := strings.TrimSpace(req.SessionID)
		if sessionID == "" {
			return nil, &rpc.Error{Code: 400, Message: "session_id is required"}
		}
		if !m.sessionAvailableForInteraction(sessionID) {
			return nil, &rpc.Error{Code: 404, Message: "terminal session not found"}
		}
		if err := m.term.ClearSessionHistory(sessionID); err != nil {
			return nil, &rpc.Error{Code: 404, Message: "terminal session not found"}
		}
		return &terminalClearResp{OK: true}, nil
	})

	// Delete session
	accessgate.RegisterTyped[terminalDeleteReq, terminalDeleteResp](r, TypeID_TERMINAL_SESSION_DELETE, gate, meta, accessgate.RPCAccessProtected, func(_ context.Context, req *terminalDeleteReq) (*terminalDeleteResp, error) {
		if err := requireProcessLaunchPermission(meta); err != nil {
			return nil, err
		}
		if req == nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid payload"}
		}
		sessionID := strings.TrimSpace(req.SessionID)
		if sessionID == "" {
			return nil, &rpc.Error{Code: 400, Message: "session_id is required"}
		}
		if err := m.DeleteSession(sessionID); err != nil {
			if errors.Is(err, ErrSessionNotFound) {
				return nil, &rpc.Error{Code: 404, Message: "terminal session not found"}
			}
			return nil, &rpc.Error{Code: 500, Message: "failed to close terminal session"}
		}
		return &terminalDeleteResp{OK: true}, nil
	})

	return func() {
		m.DetachSink(streamServer)
	}
}

// ServeLiveStream serves the only realtime terminal transport. Catalog,
// history, and lifecycle notifications remain on the RPC control plane.
func (m *Manager) ServeLiveStream(
	ctx context.Context,
	stream io.ReadWriteCloser,
	meta *session.Meta,
	gate *accessgate.Gate,
) error {
	if m == nil || stream == nil {
		return errors.New("terminal live stream is unavailable")
	}
	backend := livev1.NewManagerBackend(m.term, livev1.ManagerBackendOptions{
		Authorize: func(_ context.Context, _ *termgo.Session, attach livev1.Attach) error {
			if err := accessgate.RequireRPC(gate, meta, accessgate.RPCAccessProtected); err != nil {
				return err
			}
			if err := requireProcessLaunchPermission(meta); err != nil {
				return err
			}
			if !m.sessionAvailableForInteraction(strings.TrimSpace(attach.SessionID)) {
				return livev1.ErrSessionNotFound
			}
			return nil
		},
		Activate: func(activateCtx context.Context, sessionID string, cols int, rows int) error {
			activate := m.activateSessionFunc
			if activate == nil {
				activate = m.term.ActivateSessionContext
			}
			return activate(activateCtx, sessionID, cols, rows)
		},
	})
	return livev1.NewService(backend).Serve(ctx, stream)
}

func requireProcessLaunchPermission(meta *session.Meta) error {
	if !session.AllowsProcessLaunch(meta) {
		return &rpc.Error{Code: 403, Message: "process permission denied: terminal requires write and execute permissions"}
	}
	return nil
}

// DetachSink removes the control-plane notification sink bound to an RPC stream.
// Realtime terminal attachments are owned by independent terminal/live_v1 streams.
func (m *Manager) DetachSink(streamServer *rpc.Server) {
	if m == nil || streamServer == nil {
		return
	}
	m.mu.Lock()
	writer := m.writers[streamServer]
	delete(m.writers, streamServer)
	m.mu.Unlock()

	if writer != nil {
		writer.Close()
	}
}

// Cleanup terminates all running terminal sessions (best-effort).
func (m *Manager) Cleanup() {
	if m == nil || m.term == nil {
		return
	}
	m.mu.Lock()
	writers := make([]*controlSink, 0, len(m.writers))
	for sink, writer := range m.writers {
		writers = append(writers, writer)
		delete(m.writers, sink)
	}
	m.mu.Unlock()
	for _, writer := range writers {
		writer.Close()
	}
	m.term.Cleanup()
	m.mu.Lock()
	clear(m.sessionLifecycle)
	m.mu.Unlock()
}

func (m *Manager) ensureWriter(streamServer *rpc.Server) {
	if m == nil || streamServer == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.writers[streamServer]; ok {
		return
	}
	m.writers[streamServer] = newControlSink(streamServer, m.log)
}

// broadcastNameUpdate sends a name/working directory update notification to all
// connected clients attached to the given session.
func (m *Manager) broadcastNameUpdate(sessionID string, newName string, workingDir string) {
	if m == nil || sessionID == "" {
		return
	}
	if m.sessionHidden(sessionID) {
		return
	}

	var writers []*controlSink
	m.mu.Lock()
	if len(m.writers) > 0 {
		writers = make([]*controlSink, 0, len(m.writers))
		for _, writer := range m.writers {
			if writer != nil {
				writers = append(writers, writer)
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
		WorkingDir: workingDir,
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return
	}

	msg := sinkMsg{TypeID: TypeID_TERMINAL_NAME_UPDATE, Payload: b}
	for _, w := range writers {
		w.Send(msg)
	}
}

func (m *Manager) broadcastForegroundCommandUpdate(sessionID string, command termgo.TerminalForegroundCommandInfo) {
	if m == nil || strings.TrimSpace(sessionID) == "" || m.sessionHidden(sessionID) {
		return
	}

	var writers []*controlSink
	m.mu.Lock()
	if len(m.writers) > 0 {
		writers = make([]*controlSink, 0, len(m.writers))
		for _, writer := range m.writers {
			if writer != nil {
				writers = append(writers, writer)
			}
		}
	}
	m.mu.Unlock()
	if len(writers) == 0 {
		return
	}

	payload := terminalForegroundCommandUpdatePayload{
		SessionID:         sessionID,
		ForegroundCommand: toForegroundCommandInfo(command),
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return
	}
	msg := sinkMsg{TypeID: TypeID_TERMINAL_FOREGROUND_COMMAND_UPDATE, Payload: b}
	for _, writer := range writers {
		writer.Send(msg)
	}
}

func (m *Manager) broadcastOutputActivityUpdate(sessionID string, activity termgo.TerminalOutputActivityInfo) {
	if m == nil || strings.TrimSpace(sessionID) == "" || m.sessionHidden(sessionID) {
		return
	}

	var writers []*controlSink
	m.mu.Lock()
	if len(m.writers) > 0 {
		writers = make([]*controlSink, 0, len(m.writers))
		for _, writer := range m.writers {
			if writer != nil {
				writers = append(writers, writer)
			}
		}
	}
	m.mu.Unlock()
	if len(writers) == 0 {
		return
	}

	payload := terminalOutputActivityUpdatePayload{
		SessionID:      sessionID,
		OutputActivity: toOutputActivityInfo(activity),
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return
	}
	msg := sinkMsg{TypeID: TypeID_TERMINAL_OUTPUT_ACTIVITY_UPDATE, Payload: b}
	for _, writer := range writers {
		writer.Send(msg)
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

	var writers []*controlSink
	m.mu.Lock()
	if len(m.writers) > 0 {
		writers = make([]*controlSink, 0, len(m.writers))
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
		w.Send(msg)
	}
}

func (m *Manager) createSession(name string, workingDir string) (*termgo.Session, error) {
	if m == nil {
		return nil, &rpc.Error{Code: 500, Message: "internal error"}
	}

	workingDirAbs, err := m.resolveWorkingDir(workingDir)
	if err != nil {
		switch {
		case errors.Is(err, filesystemscope.ErrPathOutsideScope):
			return nil, &rpc.Error{Code: 403, Message: "working_dir outside filesystem scope"}
		case errors.Is(err, filesystemscope.ErrReadDenied):
			return nil, &rpc.Error{Code: 403, Message: "read permission denied"}
		case os.IsNotExist(err):
			return nil, &rpc.Error{Code: 404, Message: "working_dir not found"}
		case strings.Contains(err.Error(), "directory"):
			return nil, &rpc.Error{Code: 400, Message: "working_dir is not a directory"}
		default:
			return nil, &rpc.Error{Code: 400, Message: "invalid working_dir"}
		}
	}

	sess, err := m.term.CreateSession(name, workingDirAbs)
	if err != nil {
		m.log.Warn("terminal create failed", "error", err)
		return nil, &rpc.Error{Code: 500, Message: "failed to create terminal session"}
	}
	return sess, nil
}

type eventHandler struct{ m *Manager }

var (
	_ termgo.TerminalEventHandler                = (*eventHandler)(nil)
	_ termgo.TerminalSessionMetadataEventHandler = (*eventHandler)(nil)
	_ termgo.TerminalOutputActivityEventHandler  = (*eventHandler)(nil)
)

func (h *eventHandler) OnTerminalData(_ string, _ termgo.TerminalOutputEvent) {
	if h == nil || h.m == nil {
		return
	}
}

func (h *eventHandler) OnTerminalNameChanged(sessionID string, oldName string, newName string, workingDir string) {
	if h == nil || h.m == nil {
		return
	}
	// Broadcast name/working directory update to all connected clients.
	// This allows the frontend to update the terminal tab title in real-time.
	h.m.broadcastNameUpdate(sessionID, newName, workingDir)
}

func (h *eventHandler) OnTerminalSessionMetadataChanged(sessionID string, info termgo.TerminalSessionInfo) {
	if h == nil || h.m == nil {
		return
	}
	h.m.broadcastForegroundCommandUpdate(sessionID, info.ForegroundCommand)
}

func (h *eventHandler) OnTerminalOutputActivityChanged(sessionID string, info termgo.TerminalOutputActivityInfo) {
	if h == nil || h.m == nil {
		return
	}
	h.m.broadcastOutputActivityUpdate(sessionID, info)
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
	h.m.trackSessionOpen(sessionID)

	payload := terminalSessionsChangedPayload{
		Reason:      "created",
		SessionID:   sessionID,
		TimestampMs: time.Now().UnixMilli(),
		Lifecycle:   string(SessionLifecycleOpen),
	}
	h.m.broadcastSessionsChanged(payload)
	h.m.emitSessionLifecycleEvent(sessionLifecycleEventFromPayload(payload))
}

func (h *eventHandler) OnTerminalSessionClosed(sessionID string) {
	if h == nil || h.m == nil {
		return
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return
	}

	reason := h.m.finalizeSessionClosed(sessionID)
	payload := terminalSessionsChangedPayload{
		Reason:      reason,
		SessionID:   sessionID,
		TimestampMs: time.Now().UnixMilli(),
		Lifecycle:   string(SessionLifecycleClosed),
	}
	h.m.broadcastSessionsChanged(payload)
	h.m.emitSessionLifecycleEvent(sessionLifecycleEventFromPayload(payload))
}

func (h *eventHandler) OnTerminalError(sessionID string, err error) {
	if h == nil || h.m == nil {
		return
	}
	h.m.log.Warn("terminal session error", "session_id", sessionID, "error", err)
}

// --- wire types (snake_case JSON) ---

type terminalSessionInfo struct {
	ID                string                `json:"id"`
	Name              string                `json:"name"`
	WorkingDir        string                `json:"working_dir"`
	CreatedAtMs       int64                 `json:"created_at_ms"`
	LastActiveAtMs    int64                 `json:"last_active_at_ms"`
	IsActive          bool                  `json:"is_active"`
	ForegroundCommand ForegroundCommandInfo `json:"foreground_command"`
	OutputActivity    *OutputActivityInfo   `json:"output_activity,omitempty"`
}

func toWireSessionInfo(info termgo.TerminalSessionInfo) *terminalSessionInfo {
	return &terminalSessionInfo{
		ID:                info.ID,
		Name:              info.Name,
		WorkingDir:        info.WorkingDir,
		CreatedAtMs:       info.CreatedAt,
		LastActiveAtMs:    info.LastActive,
		IsActive:          info.IsActive,
		ForegroundCommand: toForegroundCommandInfo(info.ForegroundCommand),
		OutputActivity:    toOptionalOutputActivityInfo(info.OutputActivity),
	}
}

func toSessionInfo(info termgo.TerminalSessionInfo) *SessionInfo {
	return &SessionInfo{
		ID:                info.ID,
		Name:              info.Name,
		WorkingDir:        info.WorkingDir,
		CreatedAtMs:       info.CreatedAt,
		LastActiveAtMs:    info.LastActive,
		IsActive:          info.IsActive,
		ForegroundCommand: toForegroundCommandInfo(info.ForegroundCommand),
		OutputActivity:    toOptionalOutputActivityInfo(info.OutputActivity),
	}
}

func toForegroundCommandInfo(info termgo.TerminalForegroundCommandInfo) ForegroundCommandInfo {
	return ForegroundCommandInfo{
		Phase:       string(info.Phase),
		DisplayName: info.DisplayName,
		Revision:    info.Revision,
		UpdatedAtMs: info.UpdatedAt,
	}
}

func toOptionalOutputActivityInfo(info termgo.TerminalOutputActivityInfo) *OutputActivityInfo {
	if info.Phase == "" && info.Revision == 0 && info.UpdatedAt == 0 {
		return nil
	}
	activity := toOutputActivityInfo(info)
	return &activity
}

func toOutputActivityInfo(info termgo.TerminalOutputActivityInfo) OutputActivityInfo {
	phase := string(info.Phase)
	switch info.Phase {
	case termgo.OutputActivityUnknown, termgo.OutputActivityStreaming, termgo.OutputActivitySettled:
	default:
		phase = string(termgo.OutputActivityUnknown)
	}
	return OutputActivityInfo{
		Phase:       phase,
		Revision:    info.Revision,
		UpdatedAtMs: info.UpdatedAt,
	}
}

type terminalCreateReq struct {
	Name       string `json:"name,omitempty"`
	WorkingDir string `json:"working_dir,omitempty"`
}

type terminalCreateResp struct {
	Session *terminalSessionInfo `json:"session"`
}

type terminalListReq struct{}

type terminalListResp struct {
	Sessions []*terminalSessionInfo `json:"sessions"`
}

type terminalNameUpdatePayload struct {
	SessionID  string `json:"session_id"`
	NewName    string `json:"new_name"`
	WorkingDir string `json:"working_dir"`
}

type terminalForegroundCommandUpdatePayload struct {
	SessionID         string                `json:"session_id"`
	ForegroundCommand ForegroundCommandInfo `json:"foreground_command"`
}

type terminalOutputActivityUpdatePayload struct {
	SessionID      string             `json:"session_id"`
	OutputActivity OutputActivityInfo `json:"output_activity"`
}

type terminalSessionsChangedPayload struct {
	Reason         string `json:"reason"`
	SessionID      string `json:"session_id,omitempty"`
	TimestampMs    int64  `json:"timestamp_ms,omitempty"`
	Lifecycle      string `json:"lifecycle,omitempty"`
	Hidden         bool   `json:"hidden,omitempty"`
	OwnerWidgetID  string `json:"owner_widget_id,omitempty"`
	FailureCode    string `json:"failure_code,omitempty"`
	FailureMessage string `json:"failure_message,omitempty"`
}

type terminalHistoryReq struct {
	SessionID         string `json:"session_id"`
	StartSeq          int64  `json:"start_seq"`
	EndSeq            int64  `json:"end_seq"`
	HistoryGeneration int64  `json:"history_generation,omitempty"`
	LimitChunks       int    `json:"limit_chunks,omitempty"`
	MaxBytes          int    `json:"max_bytes,omitempty"`
}

type terminalHistoryChunk struct {
	Sequence    int64  `json:"sequence"`
	TimestampMs int64  `json:"timestamp_ms"`
	DataB64     string `json:"data_b64"`
}

type terminalHistoryResp struct {
	Chunks                 []terminalHistoryChunk `json:"chunks"`
	NextStartSeq           int64                  `json:"next_start_seq,omitempty"`
	HasMore                bool                   `json:"has_more,omitempty"`
	FirstSequence          int64                  `json:"first_sequence,omitempty"`
	LastSequence           int64                  `json:"last_sequence,omitempty"`
	FirstRetainedSequence  int64                  `json:"first_retained_sequence"`
	CoveredThroughSequence int64                  `json:"covered_through_sequence"`
	SnapshotEndSequence    int64                  `json:"snapshot_end_sequence"`
	HistoryGeneration      int64                  `json:"history_generation"`
	HistoryReset           bool                   `json:"history_reset"`
	HistoryTruncated       bool                   `json:"history_truncated"`
	CoveredBytes           int64                  `json:"covered_bytes,omitempty"`
	TotalBytes             int64                  `json:"total_bytes,omitempty"`
}

func normalizeTerminalHistoryPageOptions(req *terminalHistoryReq) termgo.HistoryPageOptions {
	if req == nil {
		return termgo.HistoryPageOptions{
			LimitChunks: defaultTerminalHistoryPageChunks,
			MaxBytes:    defaultTerminalHistoryPageBytes,
		}
	}

	limitChunks := req.LimitChunks
	if limitChunks <= 0 {
		limitChunks = defaultTerminalHistoryPageChunks
	}
	if limitChunks > maxTerminalHistoryPageChunks {
		limitChunks = maxTerminalHistoryPageChunks
	}

	maxBytes := req.MaxBytes
	if maxBytes <= 0 {
		maxBytes = defaultTerminalHistoryPageBytes
	}
	if maxBytes > maxTerminalHistoryPageBytes {
		maxBytes = maxTerminalHistoryPageBytes
	}

	return termgo.HistoryPageOptions{
		StartSeq:          req.StartSeq,
		EndSeq:            req.EndSeq,
		HistoryGeneration: req.HistoryGeneration,
		LimitChunks:       limitChunks,
		MaxBytes:          maxBytes,
	}
}

func terminalHistoryRespFromPage(page termgo.HistoryPage) *terminalHistoryResp {
	out := make([]terminalHistoryChunk, 0, len(page.Chunks))
	for _, c := range page.Chunks {
		out = append(out, terminalHistoryChunk{
			Sequence:    c.Sequence,
			TimestampMs: c.Timestamp,
			DataB64:     base64.StdEncoding.EncodeToString(c.Data),
		})
	}

	return &terminalHistoryResp{
		Chunks:                 out,
		NextStartSeq:           page.NextStartSeq,
		HasMore:                page.HasMore,
		FirstSequence:          page.FirstSequence,
		LastSequence:           page.LastSequence,
		FirstRetainedSequence:  page.FirstRetainedSequence,
		CoveredThroughSequence: page.CoveredThroughSequence,
		SnapshotEndSequence:    page.SnapshotEndSequence,
		HistoryGeneration:      page.HistoryGeneration,
		HistoryReset:           page.HistoryReset,
		HistoryTruncated:       page.HistoryTruncated,
		CoveredBytes:           page.CoveredBytes,
		TotalBytes:             page.TotalBytes,
	}
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

func (m *Manager) resolveWorkingDir(workingDir string) (string, error) {
	if m == nil {
		return "", errors.New("nil manager")
	}
	if strings.TrimSpace(workingDir) == "" {
		workingDir = m.agentHomeAbs
	}
	resolved, err := m.scope.Resolve(workingDir, filesystemscope.ResolveOptions{RequireExisting: true, RequireDir: true})
	return resolved.RealAbs, err
}

// --- async notify sink ---

type sinkMsg struct {
	TypeID  uint32
	Payload json.RawMessage
}

type controlSink struct {
	srv    *rpc.Server
	log    *slog.Logger
	mu     sync.Mutex
	closed bool
}

func newControlSink(srv *rpc.Server, log *slog.Logger) *controlSink {
	return &controlSink{srv: srv, log: log}
}

func (w *controlSink) Send(msg sinkMsg) {
	if w == nil {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed || w.srv == nil {
		return
	}
	if err := w.srv.Notify(msg.TypeID, msg.Payload); err != nil && w.log != nil && !errors.Is(err, context.Canceled) {
		w.log.Debug("terminal control notify failed", "error", err)
	}
}

func (w *controlSink) Close() {
	if w == nil {
		return
	}
	w.mu.Lock()
	w.closed = true
	w.mu.Unlock()
}
