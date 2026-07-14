package terminal

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"

	termgo "github.com/floegence/floeterm/terminal-go"
	rpcwirev1 "github.com/floegence/flowersec/flowersec-go/gen/flowersec/rpc/v1"
	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/session"
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

const (
	defaultTerminalHistoryPageChunks = 256
	maxTerminalHistoryPageChunks     = 512
	defaultTerminalHistoryPageBytes  = 384 * 1024
	maxTerminalHistoryPageBytes      = 512 * 1024
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
	writers          map[*rpc.Server]*sinkWriter
	byServer         map[*rpc.Server]map[string]sinkAttachment
	bySession        map[string]map[*rpc.Server]sinkAttachment
	attachStates     map[*rpc.Server]map[string]*sinkAttachState
	closedSinks      map[*rpc.Server]struct{} // best-effort marker to avoid repeated work
	sessionLifecycle map[string]SessionLifecycleRecord
	deleteOperations map[string]*sessionDeleteOperation
	lifecycleHooks   map[int]SessionLifecycleHook
	nextLifecycleID  int
}

type sinkAttachment struct {
	connID            string
	liveAfterSequence int64
	generation        int64
	activation        *sessionAttachActivation
}

type sinkAttachState struct {
	latest  sinkAttachment
	pending map[int64]*sessionAttachActivation
}

type sessionAttachActivation struct {
	ctx    context.Context
	cancel context.CancelFunc
	done   chan struct{}
	once   sync.Once
	err    error
}

func newSessionAttachActivation() *sessionAttachActivation {
	ctx, cancel := context.WithCancel(context.Background())
	return &sessionAttachActivation{ctx: ctx, cancel: cancel, done: make(chan struct{})}
}

func (a *sessionAttachActivation) complete(err error) {
	if a == nil {
		return
	}
	a.once.Do(func() {
		a.err = err
		close(a.done)
		a.cancel()
	})
}

func (a *sessionAttachActivation) waitContext(ctx context.Context) error {
	if a == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case <-a.done:
		return a.err
	case <-ctx.Done():
		select {
		case <-a.done:
			return a.err
		default:
			return ctx.Err()
		}
	}
}

func (a *sessionAttachActivation) wait() error {
	return a.waitContext(context.Background())
}

func (a *sessionAttachActivation) context() context.Context {
	if a == nil || a.ctx == nil {
		return context.Background()
	}
	return a.ctx
}

func (a *sessionAttachActivation) completedResult() (error, bool) {
	if a == nil {
		return nil, false
	}
	select {
	case <-a.done:
		return a.err, true
	default:
		return nil, false
	}
}

func completePendingAttachState(state *sinkAttachState, result error) {
	if state == nil {
		return
	}
	for _, activation := range state.pending {
		activation.complete(result)
	}
}

type SessionInfo struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	WorkingDir     string `json:"working_dir"`
	CreatedAtMs    int64  `json:"created_at_ms"`
	LastActiveAtMs int64  `json:"last_active_at_ms"`
	IsActive       bool   `json:"is_active"`
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
		Logger:                slogTerminalLogger{log: log},
		EnvProvider:           termgo.DefaultEnvProvider{},
		ShellResolver:         fixedShellResolver{shell: shell},
		HistoryBufferMaxBytes: terminalHistoryBufferMaxBytes,
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
		writers:          make(map[*rpc.Server]*sinkWriter),
		byServer:         make(map[*rpc.Server]map[string]sinkAttachment),
		bySession:        make(map[string]map[*rpc.Server]sinkAttachment),
		attachStates:     make(map[*rpc.Server]map[string]*sinkAttachState),
		closedSinks:      make(map[*rpc.Server]struct{}),
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

func (m *Manager) Register(r *rpc.Router, meta *session.Meta, streamServer *rpc.Server) {
	m.RegisterWithAccessGate(r, meta, streamServer, nil)
}

func (m *Manager) RegisterWithAccessGate(r *rpc.Router, meta *session.Meta, streamServer *rpc.Server, gate *accessgate.Gate) {
	if m == nil || r == nil {
		return
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

	// Attach session: bind terminal output notifications to this RPC stream and register a connection.
	accessgate.RegisterTyped[terminalAttachReq, terminalAttachResp](r, TypeID_TERMINAL_SESSION_ATTACH, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *terminalAttachReq) (*terminalAttachResp, error) {
		if err := requireProcessLaunchPermission(meta); err != nil {
			return nil, err
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
		if req.AttachGeneration <= 0 {
			return nil, &rpc.Error{Code: 400, Message: "attach_generation is required"}
		}

		historyBoundarySequence, err := m.attachSessionContext(
			ctx,
			sessionID,
			connID,
			req.Cols,
			req.Rows,
			streamServer,
			req.AttachGeneration,
		)
		if err != nil {
			return nil, err
		}

		return &terminalAttachResp{
			OK:                      true,
			HistoryBoundarySequence: historyBoundarySequence,
		}, nil
	})

	// Terminal input (notify)
	r.Register(TypeID_TERMINAL_INPUT, func(_ context.Context, payload json.RawMessage) (json.RawMessage, *rpcwirev1.RpcError) {
		if err := accessgate.RequireRPC(gate, meta, accessgate.RPCAccessProtected); err != nil {
			return nil, rpc.ToWireError(err)
		}
		if err := requireProcessLaunchPermission(meta); err != nil {
			return nil, rpc.ToWireError(err)
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
		if err := accessgate.RequireRPC(gate, meta, accessgate.RPCAccessProtected); err != nil {
			return nil, rpc.ToWireError(err)
		}
		if err := requireProcessLaunchPermission(meta); err != nil {
			return nil, rpc.ToWireError(err)
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
}

func requireProcessLaunchPermission(meta *session.Meta) error {
	if !session.AllowsProcessLaunch(meta) {
		return &rpc.Error{Code: 403, Message: "process permission denied: terminal requires write and execute permissions"}
	}
	return nil
}

// DetachSink removes all terminal attachments bound to the given RPC stream.
func (m *Manager) DetachSink(streamServer *rpc.Server) {
	if m == nil || streamServer == nil {
		return
	}

	var writer *sinkWriter

	m.mu.Lock()
	if sessions := m.byServer[streamServer]; len(sessions) > 0 {
		for sessionID, attachment := range sessions {
			if bySess := m.bySession[sessionID]; bySess != nil {
				delete(bySess, streamServer)
				if len(bySess) == 0 {
					delete(m.bySession, sessionID)
				}
			}
			if !m.sessionConnectionOwnedLocked(sessionID, attachment.connID) {
				if sess, ok := m.term.GetSession(sessionID); ok && sess != nil {
					sess.RemoveConnection(attachment.connID)
				}
			}
		}
		delete(m.byServer, streamServer)
	}
	if states := m.attachStates[streamServer]; states != nil {
		closedErr := &rpc.Error{Code: 410, Message: "terminal connection closed"}
		for _, state := range states {
			completePendingAttachState(state, closedErr)
		}
		delete(m.attachStates, streamServer)
	}
	writer = m.writers[streamServer]
	delete(m.writers, streamServer)
	m.closedSinks[streamServer] = struct{}{}
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
	sinks := make(map[*rpc.Server]struct{}, len(m.byServer)+len(m.attachStates)+len(m.writers))
	for sink := range m.byServer {
		sinks[sink] = struct{}{}
	}
	for sink := range m.attachStates {
		sinks[sink] = struct{}{}
	}
	for sink := range m.writers {
		sinks[sink] = struct{}{}
	}
	m.mu.Unlock()
	for sink := range sinks {
		m.DetachSink(sink)
	}
	m.term.Cleanup()
	m.mu.Lock()
	clear(m.sessionLifecycle)
	m.mu.Unlock()
}

func (m *Manager) completePendingSessionAttachesLocked(sessionID string, result error) {
	if m == nil || sessionID == "" {
		return
	}
	for _, states := range m.attachStates {
		completePendingAttachState(states[sessionID], result)
	}
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
	if _, closed := m.closedSinks[sink]; closed {
		return
	}
	if _, ok := m.writers[sink]; ok {
		return
	}
	m.writers[sink] = newSinkWriter(sink, m.log)
}

var (
	errTerminalAttachSinkClosed = errors.New("terminal attach sink closed")
	errTerminalAttachSuperseded = errors.New("terminal attach superseded")
)

func terminalAttachClosedError() error {
	return &rpc.Error{Code: 410, Message: "terminal connection closed"}
}

func terminalAttachSupersededError() error {
	return &rpc.Error{Code: 409, Message: "terminal attach superseded"}
}

func terminalAttachSessionNotFoundError() error {
	return &rpc.Error{Code: 404, Message: "terminal session not found"}
}

func (m *Manager) attachSinkLocked(
	sessionID string,
	connID string,
	sink *rpc.Server,
	generation int64,
	captureHistoryBoundary func() int64,
	removePreviousConnection func(connID string),
) (sinkAttachment, bool, error) {
	if m == nil || sink == nil || sessionID == "" || connID == "" || generation <= 0 || captureHistoryBoundary == nil {
		return sinkAttachment{}, false, errTerminalAttachSuperseded
	}
	if _, closed := m.closedSinks[sink]; closed {
		return sinkAttachment{}, false, errTerminalAttachSinkClosed
	}

	var existing sinkAttachment
	hasExisting := false
	if servers := m.bySession[sessionID]; servers != nil {
		existing, hasExisting = servers[sink]
	}
	var state *sinkAttachState
	if states := m.attachStates[sink]; states != nil {
		state = states[sessionID]
	}
	highWater := int64(0)
	if state != nil {
		highWater = state.latest.generation
	}
	if hasExisting && existing.generation > highWater {
		highWater = existing.generation
	}
	if generation < highWater {
		return sinkAttachment{}, false, errTerminalAttachSuperseded
	}
	if generation == highWater {
		if state != nil && state.latest.generation == generation && state.latest.connID == connID {
			return state.latest, false, nil
		}
		if hasExisting && existing.generation == generation && existing.connID == connID {
			return existing, false, nil
		}
		return sinkAttachment{}, false, errTerminalAttachSuperseded
	}

	attachment := sinkAttachment{
		connID:            connID,
		liveAfterSequence: captureHistoryBoundary(),
		generation:        generation,
		activation:        newSessionAttachActivation(),
	}
	if _, ok := m.writers[sink]; !ok {
		m.writers[sink] = newSinkWriter(sink, m.log)
	}
	sessions := m.byServer[sink]
	if sessions == nil {
		sessions = make(map[string]sinkAttachment)
		m.byServer[sink] = sessions
	}
	sessions[sessionID] = attachment

	servers := m.bySession[sessionID]
	if servers == nil {
		servers = make(map[*rpc.Server]sinkAttachment)
		m.bySession[sessionID] = servers
	}
	servers[sink] = attachment
	if m.attachStates == nil {
		m.attachStates = make(map[*rpc.Server]map[string]*sinkAttachState)
	}
	states := m.attachStates[sink]
	if states == nil {
		states = make(map[string]*sinkAttachState)
		m.attachStates[sink] = states
	}
	state = states[sessionID]
	if state == nil {
		state = &sinkAttachState{pending: make(map[int64]*sessionAttachActivation)}
		states[sessionID] = state
	}
	if state.pending == nil {
		state.pending = make(map[int64]*sessionAttachActivation)
	}
	for pendingGeneration, pendingActivation := range state.pending {
		if pendingGeneration < generation {
			pendingActivation.complete(terminalAttachSupersededError())
			delete(state.pending, pendingGeneration)
		}
	}
	state.latest = attachment
	state.pending[generation] = attachment.activation
	if hasExisting && existing.connID != connID && removePreviousConnection != nil && !m.sessionConnectionOwnedLocked(sessionID, existing.connID) {
		removePreviousConnection(existing.connID)
	}
	return attachment, true, nil
}

func sameSinkAttachment(left sinkAttachment, right sinkAttachment) bool {
	return left.connID == right.connID && left.generation == right.generation
}

func (m *Manager) finishAttachOperation(
	sessionID string,
	sink *rpc.Server,
	attachment sinkAttachment,
	result error,
) error {
	if attachment.activation == nil {
		return result
	}

	m.mu.Lock()
	if result == nil {
		result = m.currentAttachOperationErrorLocked(sessionID, sink, attachment)
	}
	attachment.activation.complete(result)
	if states := m.attachStates[sink]; states != nil {
		if state := states[sessionID]; state != nil {
			if activation := state.pending[attachment.generation]; activation == attachment.activation {
				delete(state.pending, attachment.generation)
			}
		}
	}
	m.mu.Unlock()
	return attachment.activation.waitContext(context.Background())
}

func (m *Manager) currentAttachOperationErrorLocked(
	sessionID string,
	sink *rpc.Server,
	attachment sinkAttachment,
) error {
	if _, closed := m.closedSinks[sink]; closed {
		return terminalAttachClosedError()
	}
	if record, exists := m.sessionLifecycle[sessionID]; exists && record.hiddenFromUI() {
		return terminalAttachSessionNotFoundError()
	}
	if sess, ok := m.term.GetSession(sessionID); !ok || sess == nil {
		return terminalAttachSessionNotFoundError()
	}
	if current, ok := m.bySession[sessionID][sink]; !ok || !sameSinkAttachment(current, attachment) {
		return terminalAttachSupersededError()
	}
	if current, ok := m.byServer[sink][sessionID]; !ok || !sameSinkAttachment(current, attachment) {
		return terminalAttachSupersededError()
	}
	states := m.attachStates[sink]
	if states == nil {
		return terminalAttachSupersededError()
	}
	state := states[sessionID]
	if state == nil || !sameSinkAttachment(state.latest, attachment) {
		return terminalAttachSupersededError()
	}
	return nil
}

func (m *Manager) sessionConnectionOwnedLocked(sessionID string, connID string) bool {
	if m == nil || sessionID == "" || connID == "" {
		return false
	}
	for _, attachment := range m.bySession[sessionID] {
		if attachment.connID == connID {
			return true
		}
	}
	return false
}

func (m *Manager) rollbackSessionAttachment(
	sessionID string,
	sink *rpc.Server,
	attachment sinkAttachment,
	removeConnection func(connID string),
) {
	if m == nil || sink == nil || sessionID == "" {
		return
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	servers := m.bySession[sessionID]
	current, ok := servers[sink]
	if ok && !sameSinkAttachment(current, attachment) {
		return
	}
	if ok {
		delete(servers, sink)
		if len(servers) == 0 {
			delete(m.bySession, sessionID)
		}
	}
	if sessions := m.byServer[sink]; sessions != nil {
		if indexed, exists := sessions[sessionID]; exists && sameSinkAttachment(indexed, attachment) {
			delete(sessions, sessionID)
			if len(sessions) == 0 {
				delete(m.byServer, sink)
			}
		}
	}
	if removeConnection != nil && !m.sessionConnectionOwnedLocked(sessionID, attachment.connID) {
		removeConnection(attachment.connID)
	}
}

func (m *Manager) broadcast(sessionID string, sequence int64, payload json.RawMessage) {
	if m == nil || sessionID == "" || sequence <= 0 || len(payload) == 0 {
		return
	}

	var writers []*sinkWriter
	m.mu.Lock()
	if record, ok := m.sessionLifecycle[sessionID]; ok && record.hiddenFromUI() {
		m.mu.Unlock()
		return
	}
	if bySess := m.bySession[sessionID]; bySess != nil {
		writers = make([]*sinkWriter, 0, len(bySess))
		for srv, attachment := range bySess {
			if sequence <= attachment.liveAfterSequence {
				continue
			}
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
	if m.sessionHidden(sessionID) {
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
		WorkingDir: workingDir,
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
	if !m.sessionAvailableForInteraction(sessionID) {
		return &rpc.Error{Code: 404, Message: "terminal session not found"}
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

func (m *Manager) attachSession(
	sessionID string,
	connID string,
	cols int,
	rows int,
	streamServer *rpc.Server,
	attachGeneration int64,
) (int64, error) {
	return m.attachSessionContext(
		context.Background(),
		sessionID,
		connID,
		cols,
		rows,
		streamServer,
		attachGeneration,
	)
}

func (m *Manager) attachSessionContext(
	callerCtx context.Context,
	sessionID string,
	connID string,
	cols int,
	rows int,
	streamServer *rpc.Server,
	attachGeneration int64,
) (int64, error) {
	if m == nil {
		return 0, &rpc.Error{Code: 500, Message: "internal error"}
	}
	sessionID = strings.TrimSpace(sessionID)
	connID = strings.TrimSpace(connID)
	if sessionID == "" {
		return 0, &rpc.Error{Code: 400, Message: "session_id is required"}
	}
	if connID == "" {
		return 0, &rpc.Error{Code: 400, Message: "conn_id is required"}
	}
	if cols <= 0 || rows <= 0 {
		return 0, &rpc.Error{Code: 400, Message: "cols and rows are required"}
	}
	if streamServer != nil && attachGeneration <= 0 {
		return 0, &rpc.Error{Code: 400, Message: "attach_generation is required"}
	}

	sess, ok := m.term.GetSession(sessionID)
	if !ok || sess == nil {
		return 0, &rpc.Error{Code: 404, Message: "terminal session not found"}
	}

	var attachment sinkAttachment
	attachmentCreated := false
	m.mu.Lock()
	if record, exists := m.sessionLifecycle[sessionID]; exists && record.hiddenFromUI() {
		m.mu.Unlock()
		return 0, &rpc.Error{Code: 404, Message: "terminal session not found"}
	}
	currentSession, sessionStillRegistered := m.term.GetSession(sessionID)
	if !sessionStillRegistered || currentSession != sess {
		m.mu.Unlock()
		return 0, &rpc.Error{Code: 404, Message: "terminal session not found"}
	}
	var historyBoundarySequence int64
	if streamServer != nil {
		var attachErr error
		attachment, attachmentCreated, attachErr = m.attachSinkLocked(
			sessionID,
			connID,
			streamServer,
			attachGeneration,
			func() int64 {
				return sess.AddConnectionWithHistoryBoundary(connID, cols, rows)
			},
			sess.RemoveConnection,
		)
		if attachErr != nil {
			m.mu.Unlock()
			switch {
			case errors.Is(attachErr, errTerminalAttachSinkClosed):
				return 0, &rpc.Error{Code: 410, Message: "terminal connection closed"}
			case errors.Is(attachErr, errTerminalAttachSuperseded):
				return 0, &rpc.Error{Code: 409, Message: "terminal attach superseded"}
			default:
				return 0, &rpc.Error{Code: 500, Message: "failed to attach terminal session"}
			}
		}
		historyBoundarySequence = attachment.liveAfterSequence
	} else {
		historyBoundarySequence = sess.AddConnectionWithHistoryBoundary(connID, cols, rows)
	}
	m.mu.Unlock()

	if streamServer != nil && !attachmentCreated && attachment.activation != nil {
		if err := attachment.activation.waitContext(callerCtx); err != nil {
			return 0, err
		}
		return historyBoundarySequence, nil
	}
	if sess.IsActive() {
		return historyBoundarySequence, m.finishAttachOperation(sessionID, streamServer, attachment, nil)
	}
	if streamServer != nil {
		go m.runAttachActivation(sessionID, connID, cols, rows, streamServer, attachment, sess)
		if err := attachment.activation.waitContext(callerCtx); err != nil {
			return 0, err
		}
		return historyBoundarySequence, nil
	}

	activateSession := m.activateSessionFunc
	if activateSession == nil {
		activateSession = m.term.ActivateSessionContext
	}
	if err := activateSession(attachment.activation.context(), sessionID, cols, rows); err != nil {
		if completedResult, completed := attachment.activation.completedResult(); completed {
			return 0, m.finishAttachOperation(sessionID, streamServer, attachment, completedResult)
		}
		if streamServer != nil && attachmentCreated {
			m.rollbackSessionAttachment(sessionID, streamServer, attachment, sess.RemoveConnection)
		} else if streamServer == nil {
			sess.RemoveConnection(connID)
		}
		m.log.Warn("terminal attach activation failed", "session_id", sessionID, "conn_id", connID, "error", err)
		attachErr := &rpc.Error{Code: 500, Message: "failed to attach terminal session"}
		return 0, m.finishAttachOperation(sessionID, streamServer, attachment, attachErr)
	}

	return historyBoundarySequence, m.finishAttachOperation(sessionID, streamServer, attachment, nil)
}

func (m *Manager) runAttachActivation(
	sessionID string,
	connID string,
	cols int,
	rows int,
	streamServer *rpc.Server,
	attachment sinkAttachment,
	sess *termgo.Session,
) {
	activateSession := m.activateSessionFunc
	if activateSession == nil {
		activateSession = m.term.ActivateSessionContext
	}
	if err := activateSession(attachment.activation.context(), sessionID, cols, rows); err != nil {
		if completedResult, completed := attachment.activation.completedResult(); completed {
			_ = m.finishAttachOperation(sessionID, streamServer, attachment, completedResult)
			return
		}
		m.rollbackSessionAttachment(sessionID, streamServer, attachment, sess.RemoveConnection)
		m.log.Warn("terminal attach activation failed", "session_id", sessionID, "conn_id", connID, "error", err)
		_ = m.finishAttachOperation(
			sessionID,
			streamServer,
			attachment,
			&rpc.Error{Code: 500, Message: "failed to attach terminal session"},
		)
		return
	}

	_ = m.finishAttachOperation(sessionID, streamServer, attachment, nil)
}

func (m *Manager) resize(sessionID string, connID string, cols int, rows int) error {
	if m == nil {
		return &rpc.Error{Code: 500, Message: "internal error"}
	}
	if sessionID == "" {
		return &rpc.Error{Code: 400, Message: "session_id is required"}
	}
	if !m.sessionAvailableForInteraction(sessionID) {
		return &rpc.Error{Code: 404, Message: "terminal session not found"}
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
	h.m.broadcast(sessionID, sequenceNumber, b)
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

func toSessionInfo(info termgo.TerminalSessionInfo) *SessionInfo {
	return &SessionInfo{
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
}

type terminalCreateResp struct {
	Session *terminalSessionInfo `json:"session"`
}

type terminalListReq struct{}

type terminalListResp struct {
	Sessions []*terminalSessionInfo `json:"sessions"`
}

type terminalAttachReq struct {
	SessionID        string `json:"session_id"`
	ConnID           string `json:"conn_id"`
	Cols             int    `json:"cols"`
	Rows             int    `json:"rows"`
	AttachGeneration int64  `json:"attach_generation"`
}

type terminalAttachResp struct {
	OK                      bool  `json:"ok"`
	HistoryBoundarySequence int64 `json:"history_boundary_sequence"`
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

type sinkWriter struct {
	srv *rpc.Server
	log *slog.Logger

	ch   chan sinkMsg
	stop chan struct{}
	once sync.Once
	done chan struct{}
}

func newSinkWriter(srv *rpc.Server, log *slog.Logger) *sinkWriter {
	w := &sinkWriter{
		srv:  srv,
		log:  log,
		ch:   make(chan sinkMsg, 256),
		stop: make(chan struct{}),
		done: make(chan struct{}),
	}
	go w.loop()
	return w
}

func (w *sinkWriter) loop() {
	defer close(w.done)
	for {
		select {
		case <-w.stop:
			return
		default:
		}

		var msg sinkMsg
		select {
		case <-w.stop:
			return
		case msg = <-w.ch:
		}
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
	case <-w.stop:
		return
	default:
	}

	// Best-effort: if the consumer is slow, drop messages. Clients can recover via history replay.
	select {
	case <-w.done:
	case <-w.stop:
	case w.ch <- msg:
	default:
	}
}

func (w *sinkWriter) Close() {
	if w == nil {
		return
	}
	w.once.Do(func() {
		close(w.stop)
	})
	<-w.done
}
