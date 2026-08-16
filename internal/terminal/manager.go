package terminal

import (
	"context"
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
	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/logsafe"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionrpc"
)

const (
	TypeID_TERMINAL_SESSION_CREATE uint32 = 2001
	TypeID_TERMINAL_SESSION_LIST   uint32 = 2002
	TypeID_TERMINAL_HISTORY        uint32 = 2007
	TypeID_TERMINAL_CLEAR          uint32 = 2008

	TypeID_TERMINAL_SESSION_DELETE            uint32 = 2009
	TypeID_TERMINAL_NAME_UPDATE               uint32 = 2010 // notify (agent -> client): session name/working dir changed
	TypeID_TERMINAL_SESSIONS_CHANGED          uint32 = 2012 // notify (agent -> client): terminal sessions list changed
	TypeID_TERMINAL_FOREGROUND_COMMAND_UPDATE uint32 = 2013 // notify (agent -> client): shell-reported foreground command changed
	TypeID_TERMINAL_OUTPUT_ACTIVITY_UPDATE    uint32 = 2014 // notify (agent -> client): foreground command output activity changed
	TypeID_TERMINAL_EXECUTION_CONTEXT_UPDATE  uint32 = 2015 // notify (agent -> client): atomic location/application context changed
	TypeID_TERMINAL_WORK_STATE_UPDATE         uint32 = 2016 // notify (agent -> client): semantic work state changed

	terminalSemanticHistoryRPCPayloadBudget = 96 * 1024
)

var ErrSessionNotFound = errors.New("terminal session not found")

func terminalSemanticHistoryRPCPayloadSize(chunk termgo.SemanticHistoryChunk) (int, error) {
	encoded, err := json.Marshal(chunk)
	if err != nil {
		return 0, &sessionrpc.Error{Code: 500, Message: "failed to encode semantic history"}
	}
	if len(encoded) > terminalSemanticHistoryRPCPayloadBudget {
		return len(encoded), &sessionrpc.Error{Code: 413, Message: "terminal history page exceeds transport budget"}
	}
	return len(encoded), nil
}

type Manager struct {
	agentHomeAbs string
	scope        *filesystemscope.Registry
	log          *slog.Logger

	term                *termgo.Manager
	deleteSessionFunc   func(sessionID string) error
	activateSessionFunc func(ctx context.Context, sessionID string, cols int, rows int) error

	mu                    sync.Mutex
	writers               map[flowersec.RPCPeer]*controlSink
	sessionLifecycle      map[string]SessionLifecycleRecord
	localPathCapabilities map[string]string
	deleteOperations      map[string]*sessionDeleteOperation
	lifecycleHooks        map[int]SessionLifecycleHook
	nextLifecycleID       int
	workloadAdmission     func() (func(), error)
	workloadReleases      map[string]func()
}

type SessionInfo struct {
	ID                  string                   `json:"id"`
	Name                string                   `json:"name"`
	WorkingDir          string                   `json:"working_dir"`
	CreatedAtMs         int64                    `json:"created_at_ms"`
	LastActiveAtMs      int64                    `json:"last_active_at_ms"`
	IsActive            bool                     `json:"is_active"`
	ForegroundCommand   ForegroundCommandInfo    `json:"foreground_command"`
	OutputActivity      *OutputActivityInfo      `json:"output_activity,omitempty"`
	ExecutionContext    ExecutionContextInfo     `json:"execution_context"`
	WorkState           WorkStateInfo            `json:"work_state"`
	LocalPathCapability *LocalPathCapabilityInfo `json:"local_path_capability,omitempty"`
}

type LocalPathCapabilityInfo struct {
	WorkingDir string `json:"working_dir"`
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

type LocationInfo struct {
	Kind             string `json:"kind"`
	Phase            string `json:"phase"`
	Label            string `json:"label"`
	Authority        string `json:"authority"`
	WorkingDirectory string `json:"working_directory"`
	Source           string `json:"source"`
}

type ApplicationInfo struct {
	Kind        string `json:"kind"`
	Identity    string `json:"identity"`
	DisplayName string `json:"display_name"`
}

type ExecutionContextInfo struct {
	Location    LocationInfo    `json:"location"`
	Application ApplicationInfo `json:"application"`
	Revision    uint64          `json:"revision"`
	UpdatedAtMs int64           `json:"updated_at_ms"`
}

type WorkStateInfo struct {
	Phase                     string `json:"phase"`
	Source                    string `json:"source"`
	ContextRevision           uint64 `json:"context_revision"`
	ForegroundCommandRevision uint64 `json:"foreground_command_revision"`
	Revision                  uint64 `json:"revision"`
	UpdatedAtMs               int64  `json:"updated_at_ms"`
}

type slogTerminalLogger struct{ log *slog.Logger }

func (l slogTerminalLogger) Debug(msg string, kv ...any) {
	l.log.Debug(logsafe.Text(msg, 256), safeLogArgs(kv...)...)
}
func (l slogTerminalLogger) Info(msg string, kv ...any) {
	l.log.Info(logsafe.Text(msg, 256), safeLogArgs(kv...)...)
}
func (l slogTerminalLogger) Warn(msg string, kv ...any) {
	l.log.Warn(logsafe.Text(msg, 256), safeLogArgs(kv...)...)
}
func (l slogTerminalLogger) Error(msg string, kv ...any) {
	l.log.Error(logsafe.Text(msg, 256), safeLogArgs(kv...)...)
}

func safeLogArgs(kv ...any) []any {
	out := make([]any, len(kv))
	for i, value := range kv {
		switch typed := value.(type) {
		case string:
			out[i] = logsafe.Text(typed, 512)
		case error:
			out[i] = logsafe.Error(typed)
		default:
			out[i] = value
		}
	}
	return out
}

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

func newTerminalGoManagerConfig(shell string, _ string, log *slog.Logger) termgo.ManagerConfig {
	shellInitBaseDir := defaultRedevenShellInitBaseDir()
	return termgo.ManagerConfig{
		Logger:        slogTerminalLogger{log: log},
		EnvProvider:   termgo.DefaultEnvProvider{},
		ShellResolver: fixedShellResolver{shell: shell},
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
		agentHomeAbs:          scope.HomePathAbs(),
		scope:                 scope,
		log:                   log,
		writers:               make(map[flowersec.RPCPeer]*controlSink),
		sessionLifecycle:      make(map[string]SessionLifecycleRecord),
		localPathCapabilities: make(map[string]string),
		deleteOperations:      make(map[string]*sessionDeleteOperation),
		lifecycleHooks:        make(map[int]SessionLifecycleHook),
		workloadReleases:      make(map[string]func()),
	}

	m.term = termgo.NewManager(newTerminalGoManagerConfig(shell, m.agentHomeAbs, log))
	m.term.SetEventHandler(&eventHandler{m: m})
	m.deleteSessionFunc = m.deleteSessionNow
	m.activateSessionFunc = m.term.ActivateSessionContext

	return m
}

func (m *Manager) SetWorkloadAdmission(admit func() (func(), error)) {
	if m == nil {
		return
	}
	m.mu.Lock()
	m.workloadAdmission = admit
	m.mu.Unlock()
}

func (m *Manager) CreateSession(name string, workingDir string) (*SessionInfo, error) {
	sess, err := m.createSession(strings.TrimSpace(name), strings.TrimSpace(workingDir))
	if err != nil {
		return nil, err
	}
	info := sess.ToSessionInfo()
	return toSessionInfo(info, m.validatedLocalPathCapability(info)), nil
}

func (m *Manager) DeleteSession(sessionID string) error {
	return m.requestSessionDelete(sessionID, "", true)
}

func (m *Manager) Register(r *sessionrpc.Router, meta *session.Meta, streamServer flowersec.RPCPeer) func() {
	return m.RegisterWithAccessGate(r, meta, streamServer, nil)
}

func (m *Manager) RegisterWithAccessGate(r *sessionrpc.Router, meta *session.Meta, streamServer flowersec.RPCPeer, gate *accessgate.Gate) func() {
	if m == nil || r == nil {
		return func() {}
	}

	detachSink := m.AttachSink(meta, streamServer, gate)

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

		info := sess.ToSessionInfo()
		return &terminalCreateResp{Session: toWireSessionInfo(info, m.validatedLocalPathCapability(info))}, nil
	})

	// List sessions
	accessgate.RegisterTyped[terminalListReq, terminalListResp](r, TypeID_TERMINAL_SESSION_LIST, gate, meta, accessgate.RPCAccessProtected, func(_ context.Context, _ *terminalListReq) (*terminalListResp, error) {
		if err := requireProcessLaunchPermission(meta); err != nil {
			return nil, err
		}

		sessions := m.visibleSessionInfos()
		out := make([]*terminalSessionInfo, 0, len(sessions))
		for _, s := range sessions {
			out = append(out, toWireSessionInfo(s, m.validatedLocalPathCapability(s)))
		}
		return &terminalListResp{Sessions: out}, nil
	})

	// History is projected by the server-side Ghostty actor for the current
	// attachment. No raw PTY replay or browser checkpoint participates.
	accessgate.RegisterTyped[terminalSemanticHistoryReq, termgo.SemanticHistoryChunk](r, TypeID_TERMINAL_HISTORY, gate, meta, accessgate.RPCAccessProtected, func(_ context.Context, req *terminalSemanticHistoryReq) (*termgo.SemanticHistoryChunk, error) {
		if err := requireProcessLaunchPermission(meta); err != nil {
			return nil, err
		}
		if req == nil {
			return nil, &sessionrpc.Error{Code: 400, Message: "invalid payload"}
		}
		sessionID := strings.TrimSpace(req.SessionID)
		if sessionID == "" {
			return nil, &sessionrpc.Error{Code: 400, Message: "session_id is required"}
		}
		connectionID := strings.TrimSpace(req.ConnectionID)
		if connectionID == "" || req.TransportGeneration == 0 {
			return nil, &sessionrpc.Error{Code: 400, Message: "current terminal attachment is required"}
		}
		m.log.Debug("terminal semantic history request received",
			"transport_generation", req.TransportGeneration,
			"lane", req.Lane,
			"direction", req.Direction,
			"viewport_rows", req.ViewportRows,
			"scroll_delta_rows", req.ScrollDeltaRows,
			"has_anchor", strings.TrimSpace(req.Anchor) != "",
			"has_continuation", strings.TrimSpace(req.Continuation) != "",
		)

		if !m.sessionAvailableForInteraction(sessionID) {
			return nil, &sessionrpc.Error{Code: 404, Message: "terminal session not found"}
		}

		sess, ok := m.term.GetSession(sessionID)
		if !ok || sess == nil {
			return nil, &sessionrpc.Error{Code: 404, Message: "terminal session not found"}
		}
		chunk, err := sess.ReadSemanticHistory(connectionID, req.TransportGeneration, termgo.SemanticHistoryRequest{
			Continuation:    strings.TrimSpace(req.Continuation),
			Lane:            req.Lane,
			Anchor:          strings.TrimSpace(req.Anchor),
			SnapshotID:      strings.TrimSpace(req.SnapshotID),
			Direction:       req.Direction,
			Offset:          req.Offset,
			ScrollDeltaRows: req.ScrollDeltaRows,
			TargetOffset:    req.TargetOffset,
			ViewportRows:    req.ViewportRows,
		})
		if err != nil {
			m.log.Warn("terminal semantic history request failed",
				"transport_generation", req.TransportGeneration,
				"lane", req.Lane,
				"direction", req.Direction,
				"viewport_rows", req.ViewportRows,
				"scroll_delta_rows", req.ScrollDeltaRows,
				"has_anchor", strings.TrimSpace(req.Anchor) != "",
				"has_continuation", strings.TrimSpace(req.Continuation) != "",
				"error", err,
			)
			if errors.Is(err, termgo.ErrControllerTransport) {
				return nil, &sessionrpc.Error{Code: 409, Message: "terminal attachment changed"}
			}
			if errors.Is(err, termgo.ErrSemanticHistoryAnchor) {
				return nil, &sessionrpc.Error{Code: 409, Message: "terminal history anchor expired"}
			}
			if errors.Is(err, termgo.ErrSemanticHistorySuperseded) {
				return nil, &sessionrpc.Error{Code: 412, Message: "terminal history snapshot was superseded"}
			}
			return nil, &sessionrpc.Error{Code: 400, Message: "failed to read semantic history"}
		}
		payloadBytes, payloadErr := terminalSemanticHistoryRPCPayloadSize(chunk)
		if payloadErr != nil {
			m.log.Warn("terminal semantic history response exceeds RPC budget",
				"transport_generation", req.TransportGeneration,
				"lane", req.Lane,
				"direction", req.Direction,
				"viewport_rows", req.ViewportRows,
				"scroll_delta_rows", req.ScrollDeltaRows,
				"payload_bytes", payloadBytes,
				"budget_bytes", terminalSemanticHistoryRPCPayloadBudget,
				"error", payloadErr,
			)
			return nil, payloadErr
		}
		m.log.Debug("terminal semantic history response prepared",
			"transport_generation", req.TransportGeneration,
			"lane", req.Lane,
			"direction", req.Direction,
			"payload_bytes", payloadBytes,
			"snapshot_id", chunk.SnapshotID,
			"chunk_index", chunk.ChunkIndex,
			"chunk_count", chunk.ChunkCount,
			"offset", chunk.Offset,
			"total_rows", chunk.TotalRows,
			"has_previous", chunk.HasPrevious,
			"has_next", chunk.HasNext,
		)
		return &chunk, nil
	})

	// Clear is a semantic VT mutation owned by the same SessionActor as PTY
	// output, input, resize, history, and presentation capture.
	accessgate.RegisterTyped[terminalSemanticClearReq, terminalSemanticClearResp](r, TypeID_TERMINAL_CLEAR, gate, meta, accessgate.RPCAccessProtected, func(_ context.Context, req *terminalSemanticClearReq) (*terminalSemanticClearResp, error) {
		if err := requireProcessLaunchPermission(meta); err != nil {
			return nil, err
		}
		if req == nil {
			return nil, &sessionrpc.Error{Code: 400, Message: "invalid payload"}
		}
		sessionID := strings.TrimSpace(req.SessionID)
		connectionID := strings.TrimSpace(req.ConnectionID)
		if sessionID == "" {
			return nil, &sessionrpc.Error{Code: 400, Message: "session_id is required"}
		}
		if connectionID == "" || req.TransportGeneration == 0 {
			return nil, &sessionrpc.Error{Code: 400, Message: "current terminal attachment is required"}
		}
		if !m.sessionAvailableForInteraction(sessionID) {
			return nil, &sessionrpc.Error{Code: 404, Message: "terminal session not found"}
		}
		sess, ok := m.term.GetSession(sessionID)
		if !ok || sess == nil {
			return nil, &sessionrpc.Error{Code: 404, Message: "terminal session not found"}
		}
		presentation, err := sess.ClearSemanticScreen(connectionID, "local", req.TransportGeneration)
		if err != nil {
			switch {
			case errors.Is(err, termgo.ErrControllerTransport):
				return nil, &sessionrpc.Error{Code: 409, Message: "terminal attachment changed"}
			case errors.Is(err, termgo.ErrControllerPrincipal):
				return nil, &sessionrpc.Error{Code: 403, Message: "terminal controller belongs to another principal"}
			case errors.Is(err, termgo.ErrSemanticClearUnavailable):
				return nil, &sessionrpc.Error{Code: 409, Message: "terminal clear is unavailable"}
			default:
				m.log.Error("terminal semantic clear failed closed", "session_id", sessionID, "error", err)
				return nil, &sessionrpc.Error{Code: 500, Message: "failed to clear terminal content"}
			}
		}
		return &terminalSemanticClearResp{
			PresentationSequence: presentation.Sequence,
			ContentEpoch:         presentation.State.ContentEpoch,
		}, nil
	})

	// Delete session
	accessgate.RegisterTyped[terminalDeleteReq, terminalDeleteResp](r, TypeID_TERMINAL_SESSION_DELETE, gate, meta, accessgate.RPCAccessProtected, func(_ context.Context, req *terminalDeleteReq) (*terminalDeleteResp, error) {
		if err := requireProcessLaunchPermission(meta); err != nil {
			return nil, err
		}
		if req == nil {
			return nil, &sessionrpc.Error{Code: 400, Message: "invalid payload"}
		}
		sessionID := strings.TrimSpace(req.SessionID)
		if sessionID == "" {
			return nil, &sessionrpc.Error{Code: 400, Message: "session_id is required"}
		}
		if err := m.DeleteSession(sessionID); err != nil {
			if errors.Is(err, ErrSessionNotFound) {
				return nil, &sessionrpc.Error{Code: 404, Message: "terminal session not found"}
			}
			return nil, &sessionrpc.Error{Code: 500, Message: "failed to close terminal session"}
		}
		return &terminalDeleteResp{OK: true}, nil
	})

	return detachSink
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
		return &sessionrpc.Error{Code: 403, Message: "process permission denied: terminal requires write and execute permissions"}
	}
	return nil
}

// AttachSink binds outbound terminal lifecycle notifications to an established
// Flowersec RPC peer. Inbound RPC and stream handlers remain owned by the
// session handler registration path.
func (m *Manager) AttachSink(meta *session.Meta, streamServer flowersec.RPCPeer, gate *accessgate.Gate) func() {
	if m == nil || streamServer == nil || !session.AllowsProcessLaunch(meta) {
		return func() {}
	}
	writer, attached := m.ensureWriter(streamServer, meta, gate)
	if attached {
		m.replayCurrentMetadata(writer)
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			m.DetachSink(streamServer)
		})
	}
}

// DetachSink removes the control-plane notification sink bound to an RPC stream.
// Realtime terminal attachments are owned by independent terminal/live_v1 streams.
func (m *Manager) DetachSink(streamServer flowersec.RPCPeer) {
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
	clear(m.localPathCapabilities)
	m.mu.Unlock()
}

func (m *Manager) ensureWriter(streamServer flowersec.RPCPeer, meta *session.Meta, gate *accessgate.Gate) (*controlSink, bool) {
	if m == nil || streamServer == nil {
		return nil, false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if writer, ok := m.writers[streamServer]; ok {
		return writer, false
	}
	writer := newControlSink(streamServer, meta, gate, m.log)
	m.writers[streamServer] = writer
	return writer, true
}

func (m *Manager) replayCurrentMetadata(writer *controlSink) {
	if m == nil || m.term == nil || writer == nil {
		return
	}
	for _, terminalSession := range m.term.ListSessions() {
		if terminalSession == nil {
			continue
		}
		info := terminalSession.ToSessionInfo()
		if strings.TrimSpace(info.ID) == "" || m.sessionHidden(info.ID) {
			continue
		}
		payloads := []struct {
			typeID  uint32
			payload any
		}{
			{
				typeID: TypeID_TERMINAL_FOREGROUND_COMMAND_UPDATE,
				payload: terminalForegroundCommandUpdatePayload{
					SessionID:         info.ID,
					ForegroundCommand: toForegroundCommandInfo(info.ForegroundCommand),
				},
			},
			{
				typeID: TypeID_TERMINAL_EXECUTION_CONTEXT_UPDATE,
				payload: terminalExecutionContextUpdatePayload{
					SessionID:        info.ID,
					ExecutionContext: toExecutionContextInfo(info.ExecutionContext),
				},
			},
			{
				typeID: TypeID_TERMINAL_WORK_STATE_UPDATE,
				payload: terminalWorkStateUpdatePayload{
					SessionID: info.ID,
					WorkState: toWorkStateInfo(info.WorkState),
				},
			},
		}
		if outputActivity := toOptionalOutputActivityInfo(info.OutputActivity); outputActivity != nil {
			payloads = append(payloads, struct {
				typeID  uint32
				payload any
			}{
				typeID: TypeID_TERMINAL_OUTPUT_ACTIVITY_UPDATE,
				payload: terminalOutputActivityUpdatePayload{
					SessionID:      info.ID,
					OutputActivity: *outputActivity,
				},
			})
		}
		for _, current := range payloads {
			encoded, err := json.Marshal(current.payload)
			if err != nil {
				continue
			}
			writer.Send(sinkMsg{TypeID: current.typeID, Payload: encoded})
		}
	}
}

// broadcastNameUpdate sends a name/working directory update notification to all
// connected clients attached to the given session.
func (m *Manager) broadcastNameUpdate(sessionID string, newName string, workingDir string) {
	capability := m.reconcileLocalPathCapability(sessionID, workingDir, nil)
	m.broadcastNameUpdateWithCapability(sessionID, newName, workingDir, capability)
}

func (m *Manager) broadcastNameUpdateWithCapability(sessionID string, newName string, workingDir string, capability *LocalPathCapabilityInfo) {
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
		SessionID:           sessionID,
		NewName:             newName,
		WorkingDir:          workingDir,
		LocalPathCapability: capability,
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

func (m *Manager) broadcastExecutionContextUpdate(sessionID string, context termgo.TerminalExecutionContextInfo) {
	if m == nil || strings.TrimSpace(sessionID) == "" || m.sessionHidden(sessionID) {
		return
	}
	payload := terminalExecutionContextUpdatePayload{
		SessionID:        sessionID,
		ExecutionContext: toExecutionContextInfo(context),
	}
	m.broadcastTerminalMetadata(TypeID_TERMINAL_EXECUTION_CONTEXT_UPDATE, payload)
}

func (m *Manager) broadcastWorkStateUpdate(sessionID string, work termgo.TerminalWorkStateInfo) {
	if m == nil || strings.TrimSpace(sessionID) == "" || m.sessionHidden(sessionID) {
		return
	}
	payload := terminalWorkStateUpdatePayload{
		SessionID: sessionID,
		WorkState: toWorkStateInfo(work),
	}
	m.broadcastTerminalMetadata(TypeID_TERMINAL_WORK_STATE_UPDATE, payload)
}

func (m *Manager) broadcastTerminalMetadata(typeID uint32, payload any) {
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
	b, err := json.Marshal(payload)
	if err != nil {
		return
	}
	msg := sinkMsg{TypeID: typeID, Payload: b}
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
		return nil, &sessionrpc.Error{Code: 500, Message: "internal error"}
	}

	workingDirAbs, err := m.resolveWorkingDir(workingDir)
	if err != nil {
		switch {
		case errors.Is(err, filesystemscope.ErrPathOutsideScope):
			return nil, &sessionrpc.Error{Code: 403, Message: "working_dir outside filesystem scope"}
		case errors.Is(err, filesystemscope.ErrReadDenied):
			return nil, &sessionrpc.Error{Code: 403, Message: "read permission denied"}
		case os.IsNotExist(err):
			return nil, &sessionrpc.Error{Code: 404, Message: "working_dir not found"}
		case strings.Contains(err.Error(), "directory"):
			return nil, &sessionrpc.Error{Code: 400, Message: "working_dir is not a directory"}
		default:
			return nil, &sessionrpc.Error{Code: 400, Message: "invalid working_dir"}
		}
	}

	m.mu.Lock()
	admit := m.workloadAdmission
	m.mu.Unlock()
	release := func() {}
	if admit != nil {
		var err error
		release, err = admit()
		if err != nil {
			return nil, &sessionrpc.Error{Code: 409, Message: "Runtime lifecycle admission is closed"}
		}
		if release == nil {
			release = func() {}
		}
	}
	sess, err := m.term.CreateSession(name, workingDirAbs)
	if err != nil {
		release()
		m.log.Warn("terminal create failed", "error", err)
		return nil, &sessionrpc.Error{Code: 500, Message: "failed to create terminal session"}
	}
	sessionID := strings.TrimSpace(sess.ToSessionInfo().ID)
	if sessionID == "" {
		release()
		_ = sess.Close()
		return nil, &sessionrpc.Error{Code: 500, Message: "terminal session identity is unavailable"}
	}
	m.mu.Lock()
	m.workloadReleases[sessionID] = release
	m.mu.Unlock()
	return sess, nil
}

func (m *Manager) reconcileLocalPathCapability(sessionID string, workingDir string, context *termgo.TerminalExecutionContextInfo) *LocalPathCapabilityInfo {
	if m == nil {
		return nil
	}
	sessionID = strings.TrimSpace(sessionID)
	workingDir = strings.TrimSpace(workingDir)
	var currentContext termgo.TerminalExecutionContextInfo
	if context != nil {
		currentContext = *context
	} else if sess, ok := m.term.GetSession(sessionID); ok && sess != nil {
		currentContext = sess.ToSessionInfo().ExecutionContext
	}
	valid := sessionID != "" && workingDir != ""
	if valid {
		location := currentContext.Location
		valid = location.Kind == termgo.TerminalLocationLocal &&
			location.Phase == termgo.TerminalLocationPhaseReady &&
			location.Source == termgo.TerminalContextSourceShellIntegration &&
			strings.TrimSpace(location.WorkingDirectory) == workingDir
	}
	resolved := ""
	if valid {
		if candidate, err := m.resolveWorkingDir(workingDir); err == nil {
			resolved = candidate
		} else {
			valid = false
		}
	}
	m.mu.Lock()
	if m.localPathCapabilities == nil {
		m.localPathCapabilities = make(map[string]string)
	}
	if valid && resolved != "" {
		m.localPathCapabilities[sessionID] = resolved
	} else {
		delete(m.localPathCapabilities, sessionID)
	}
	m.mu.Unlock()
	if !valid || resolved == "" {
		return nil
	}
	return &LocalPathCapabilityInfo{WorkingDir: resolved}
}

func (m *Manager) validatedLocalPathCapability(info termgo.TerminalSessionInfo) string {
	if m == nil {
		return ""
	}
	sessionID := strings.TrimSpace(info.ID)
	grantedWorkingDir := m.localPathCapability(sessionID)
	if sessionID == "" || grantedWorkingDir == "" {
		return ""
	}
	location := info.ExecutionContext.Location
	valid := info.WorkingDir == grantedWorkingDir &&
		location.Kind == termgo.TerminalLocationLocal &&
		location.Phase == termgo.TerminalLocationPhaseReady &&
		location.Source == termgo.TerminalContextSourceShellIntegration &&
		location.WorkingDirectory == grantedWorkingDir
	if valid {
		resolved, err := m.resolveWorkingDir(grantedWorkingDir)
		valid = err == nil && resolved == grantedWorkingDir
	}
	if valid {
		return grantedWorkingDir
	}

	m.mu.Lock()
	if m.localPathCapabilities[sessionID] == grantedWorkingDir {
		delete(m.localPathCapabilities, sessionID)
	}
	m.mu.Unlock()
	return ""
}

func (m *Manager) localPathCapability(sessionID string) string {
	if m == nil {
		return ""
	}
	m.mu.Lock()
	workingDir := m.localPathCapabilities[strings.TrimSpace(sessionID)]
	m.mu.Unlock()
	return workingDir
}

type eventHandler struct{ m *Manager }

var (
	_ termgo.TerminalEventHandler                  = (*eventHandler)(nil)
	_ termgo.TerminalSessionMetadataEventHandler   = (*eventHandler)(nil)
	_ termgo.TerminalOutputActivityEventHandler    = (*eventHandler)(nil)
	_ termgo.TerminalExecutionContextEventHandler  = (*eventHandler)(nil)
	_ termgo.TerminalSemanticWorkStateEventHandler = (*eventHandler)(nil)
)

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

func (h *eventHandler) OnTerminalExecutionContextChanged(sessionID string, info termgo.TerminalExecutionContextInfo) {
	if h == nil || h.m == nil {
		return
	}
	if sess, ok := h.m.term.GetSession(sessionID); ok && sess != nil {
		sessionInfo := sess.ToSessionInfo()
		// Keep the product capability in lockstep with the authoritative context.
		// The name update is sent first so a stale local context can never retain
		// a previously granted Files target during a remote transition.
		capability := h.m.reconcileLocalPathCapability(sessionID, sessionInfo.WorkingDir, &info)
		h.m.broadcastNameUpdateWithCapability(sessionID, sessionInfo.Name, sessionInfo.WorkingDir, capability)
	} else {
		h.m.reconcileLocalPathCapability(sessionID, "", &info)
	}
	h.m.broadcastExecutionContextUpdate(sessionID, info)
}

func (h *eventHandler) OnTerminalSemanticWorkStateChanged(sessionID string, info termgo.TerminalWorkStateInfo) {
	if h == nil || h.m == nil {
		return
	}
	h.m.broadcastWorkStateUpdate(sessionID, info)
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
	// The product selected and resolved this launch directory. Establish the
	// grant before any client can observe the newly created session.
	h.m.reconcileLocalPathCapability(sessionID, info.WorkingDir, &info.ExecutionContext)
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
	h.m.mu.Lock()
	release := h.m.workloadReleases[sessionID]
	delete(h.m.workloadReleases, sessionID)
	h.m.mu.Unlock()
	if release != nil {
		release()
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
	ID                  string                   `json:"id"`
	Name                string                   `json:"name"`
	WorkingDir          string                   `json:"working_dir"`
	CreatedAtMs         int64                    `json:"created_at_ms"`
	LastActiveAtMs      int64                    `json:"last_active_at_ms"`
	IsActive            bool                     `json:"is_active"`
	ForegroundCommand   ForegroundCommandInfo    `json:"foreground_command"`
	OutputActivity      *OutputActivityInfo      `json:"output_activity,omitempty"`
	ExecutionContext    ExecutionContextInfo     `json:"execution_context"`
	WorkState           WorkStateInfo            `json:"work_state"`
	LocalPathCapability *LocalPathCapabilityInfo `json:"local_path_capability,omitempty"`
}

func toWireSessionInfo(info termgo.TerminalSessionInfo, localWorkingDir string) *terminalSessionInfo {
	localPathCapability := localPathCapabilityInfo(localWorkingDir)
	return &terminalSessionInfo{
		ID:                  info.ID,
		Name:                info.Name,
		WorkingDir:          info.WorkingDir,
		CreatedAtMs:         info.CreatedAt,
		LastActiveAtMs:      info.LastActive,
		IsActive:            info.IsActive,
		ForegroundCommand:   toForegroundCommandInfo(info.ForegroundCommand),
		OutputActivity:      toOptionalOutputActivityInfo(info.OutputActivity),
		ExecutionContext:    toExecutionContextInfo(info.ExecutionContext),
		WorkState:           toWorkStateInfo(info.WorkState),
		LocalPathCapability: localPathCapability,
	}
}

func toSessionInfo(info termgo.TerminalSessionInfo, localWorkingDir string) *SessionInfo {
	localPathCapability := localPathCapabilityInfo(localWorkingDir)
	return &SessionInfo{
		ID:                  info.ID,
		Name:                info.Name,
		WorkingDir:          info.WorkingDir,
		CreatedAtMs:         info.CreatedAt,
		LastActiveAtMs:      info.LastActive,
		IsActive:            info.IsActive,
		ForegroundCommand:   toForegroundCommandInfo(info.ForegroundCommand),
		OutputActivity:      toOptionalOutputActivityInfo(info.OutputActivity),
		ExecutionContext:    toExecutionContextInfo(info.ExecutionContext),
		WorkState:           toWorkStateInfo(info.WorkState),
		LocalPathCapability: localPathCapability,
	}
}

func localPathCapabilityInfo(localWorkingDir string) *LocalPathCapabilityInfo {
	workingDir := strings.TrimSpace(localWorkingDir)
	if workingDir == "" {
		return nil
	}
	return &LocalPathCapabilityInfo{WorkingDir: workingDir}
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

func toExecutionContextInfo(info termgo.TerminalExecutionContextInfo) ExecutionContextInfo {
	location := info.Location
	switch location.Kind {
	case termgo.TerminalLocationLocal, termgo.TerminalLocationRemote:
	default:
		location = termgo.TerminalLocationInfo{
			Kind:  termgo.TerminalLocationUnknown,
			Phase: termgo.TerminalLocationPhaseUnknown,
		}
	}
	switch location.Phase {
	case termgo.TerminalLocationPhaseUnknown, termgo.TerminalLocationPhaseOpening, termgo.TerminalLocationPhaseReady:
	default:
		location.Phase = termgo.TerminalLocationPhaseUnknown
	}
	switch location.Source {
	case termgo.TerminalContextSourceUnknown,
		termgo.TerminalContextSourceShellIntegration,
		termgo.TerminalContextSourceOSC7,
		termgo.TerminalContextSourceOSCTitle,
		termgo.TerminalContextSourceForegroundCandidate:
	default:
		location.Source = termgo.TerminalContextSourceUnknown
	}
	if location.Kind == termgo.TerminalLocationLocal {
		location.Label = ""
		location.Authority = ""
	}
	if location.Kind == termgo.TerminalLocationUnknown {
		location.Phase = termgo.TerminalLocationPhaseUnknown
		location.Label = ""
		location.Authority = ""
		location.WorkingDirectory = ""
		location.Source = termgo.TerminalContextSourceUnknown
	}

	application := info.Application
	switch application.Kind {
	case termgo.TerminalApplicationShell,
		termgo.TerminalApplicationAgentCLI,
		termgo.TerminalApplicationInteractiveApp:
	default:
		application = termgo.TerminalApplicationInfo{Kind: termgo.TerminalApplicationUnknown}
	}
	if application.Kind != termgo.TerminalApplicationAgentCLI {
		application.Identity = ""
	}
	if application.Kind == termgo.TerminalApplicationShell {
		application.DisplayName = ""
	}

	return ExecutionContextInfo{
		Location: LocationInfo{
			Kind:             string(location.Kind),
			Phase:            string(location.Phase),
			Label:            location.Label,
			Authority:        location.Authority,
			WorkingDirectory: location.WorkingDirectory,
			Source:           string(location.Source),
		},
		Application: ApplicationInfo{
			Kind:        string(application.Kind),
			Identity:    application.Identity,
			DisplayName: application.DisplayName,
		},
		Revision:    info.Revision,
		UpdatedAtMs: info.UpdatedAt,
	}
}

func toWorkStateInfo(info termgo.TerminalWorkStateInfo) WorkStateInfo {
	phase := info.Phase
	source := ""
	contextRevision := info.ContextRevision
	foregroundCommandRevision := info.ForegroundCommandRevision
	switch phase {
	case termgo.TerminalWorkIdle, termgo.TerminalWorkWorking, termgo.TerminalWorkWaitingUser:
		source = "semantic"
	default:
		phase = termgo.TerminalWorkUnknown
		source = ""
		contextRevision = 0
		foregroundCommandRevision = 0
	}
	return WorkStateInfo{
		Phase:                     string(phase),
		Source:                    source,
		ContextRevision:           contextRevision,
		ForegroundCommandRevision: foregroundCommandRevision,
		Revision:                  info.Revision,
		UpdatedAtMs:               info.UpdatedAt,
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
	SessionID           string                   `json:"session_id"`
	NewName             string                   `json:"new_name"`
	WorkingDir          string                   `json:"working_dir"`
	LocalPathCapability *LocalPathCapabilityInfo `json:"local_path_capability"`
}

type terminalForegroundCommandUpdatePayload struct {
	SessionID         string                `json:"session_id"`
	ForegroundCommand ForegroundCommandInfo `json:"foreground_command"`
}

type terminalOutputActivityUpdatePayload struct {
	SessionID      string             `json:"session_id"`
	OutputActivity OutputActivityInfo `json:"output_activity"`
}

type terminalExecutionContextUpdatePayload struct {
	SessionID        string               `json:"session_id"`
	ExecutionContext ExecutionContextInfo `json:"execution_context"`
}

type terminalWorkStateUpdatePayload struct {
	SessionID string        `json:"session_id"`
	WorkState WorkStateInfo `json:"work_state"`
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

type terminalSemanticHistoryReq struct {
	SessionID           string                          `json:"session_id"`
	ConnectionID        string                          `json:"connection_id"`
	TransportGeneration uint64                          `json:"transport_generation"`
	Continuation        string                          `json:"continuation,omitempty"`
	Lane                termgo.SemanticHistoryLane      `json:"lane,omitempty"`
	Anchor              string                          `json:"anchor,omitempty"`
	SnapshotID          string                          `json:"snapshot_id,omitempty"`
	Direction           termgo.SemanticHistoryDirection `json:"direction,omitempty"`
	Offset              int                             `json:"offset,omitempty"`
	ScrollDeltaRows     int                             `json:"scroll_delta_rows,omitempty"`
	TargetOffset        *int                            `json:"target_offset,omitempty"`
	ViewportRows        int                             `json:"viewport_rows,omitempty"`
}

type terminalSemanticClearReq struct {
	SessionID           string `json:"session_id"`
	ConnectionID        string `json:"connection_id"`
	TransportGeneration uint64 `json:"transport_generation"`
}

type terminalSemanticClearResp struct {
	PresentationSequence uint64 `json:"presentation_sequence"`
	ContentEpoch         uint64 `json:"content_epoch"`
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
	srv    flowersec.RPCPeer
	meta   session.Meta
	gate   *accessgate.Gate
	log    *slog.Logger
	mu     sync.Mutex
	closed bool
}

func newControlSink(srv flowersec.RPCPeer, meta *session.Meta, gate *accessgate.Gate, log *slog.Logger) *controlSink {
	var metaCopy session.Meta
	if meta != nil {
		metaCopy = *meta
	}
	return &controlSink{srv: srv, meta: metaCopy, gate: gate, log: log}
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
	if err := accessgate.RequireRPC(w.gate, &w.meta, accessgate.RPCAccessProtected); err != nil {
		return
	}
	if err := requireProcessLaunchPermission(&w.meta); err != nil {
		return
	}
	if err := w.srv.Notify(context.Background(), msg.TypeID, msg.Payload); err != nil && w.log != nil && !errors.Is(err, context.Canceled) {
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
