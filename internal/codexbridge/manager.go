package codexbridge

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/floegence/redeven-agent/internal/config"
)

var (
	ErrDisabled        = errors.New("codex integration is disabled")
	ErrThreadNotFound  = errors.New("codex thread not found")
	ErrRequestNotFound = errors.New("codex pending request not found")
	ErrInvalidResponse = errors.New("invalid codex request response")
)

type Options struct {
	Logger       *slog.Logger
	Config       *config.CodexConfig
	AgentHomeDir string
}

type Manager struct {
	log          *slog.Logger
	cfg          *config.CodexConfig
	agentHomeDir string

	startMu sync.Mutex
	mu      sync.Mutex

	proc       *appServerProcess
	lastError  string
	binaryPath string
	threads    map[string]*threadState

	nextCallID       atomic.Int64
	nextSubscriberID atomic.Int64
}

type threadState struct {
	thread       *Thread
	lastEventSeq int64
	events       []Event
	pending      map[string]*pendingRequestRecord
	subscribers  map[int64]chan Event
}

type pendingRequestRecord struct {
	request         PendingRequest
	rawID           json.RawMessage
	requestedPerms  *PermissionProfile
	additionalPerms *PermissionProfile
}

func NewManager(opts Options) (*Manager, error) {
	agentHomeDir := strings.TrimSpace(opts.AgentHomeDir)
	if agentHomeDir == "" {
		return nil, errors.New("missing AgentHomeDir")
	}
	logger := opts.Logger
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}
	if opts.Config != nil {
		opts.Config.Normalize()
		if err := opts.Config.Validate(); err != nil {
			return nil, err
		}
	}
	return &Manager{
		log:          logger,
		cfg:          opts.Config,
		agentHomeDir: agentHomeDir,
		threads:      make(map[string]*threadState),
	}, nil
}

func (m *Manager) Close() error {
	if m == nil {
		return nil
	}
	m.mu.Lock()
	proc := m.proc
	m.proc = nil
	m.mu.Unlock()
	if proc != nil {
		return proc.close()
	}
	return nil
}

func (m *Manager) UpdateConfig(next *config.CodexConfig) error {
	if m == nil {
		return nil
	}
	if next != nil {
		next.Normalize()
		if err := next.Validate(); err != nil {
			return err
		}
	}
	m.mu.Lock()
	proc := m.proc
	m.proc = nil
	m.cfg = next
	m.binaryPath = ""
	m.lastError = ""
	m.mu.Unlock()
	if proc != nil {
		return proc.close()
	}
	return nil
}

func (m *Manager) Status(_ context.Context) Status {
	if m == nil {
		return Status{}
	}
	out := Status{
		Enabled:      m.cfg != nil && m.cfg.Enabled,
		DefaultModel: "",
		AgentHomeDir: m.agentHomeDir,
	}
	if m.cfg != nil {
		out.DefaultModel = strings.TrimSpace(m.cfg.DefaultModel)
		out.ApprovalPolicy = m.cfg.ApprovalPolicyValue()
		out.SandboxMode = m.cfg.SandboxModeValue()
	}
	path, err := m.resolveBinaryPath()
	if err == nil {
		out.BinaryPath = path
	}
	m.mu.Lock()
	out.Error = strings.TrimSpace(m.lastError)
	out.Ready = m.proc != nil && out.Error == ""
	if m.binaryPath != "" {
		out.BinaryPath = m.binaryPath
	}
	m.mu.Unlock()
	if err != nil && out.Error == "" && out.Enabled {
		out.Error = err.Error()
	}
	return out
}

func (m *Manager) ListThreads(ctx context.Context, limit int) ([]Thread, error) {
	if !m.enabled() {
		return nil, ErrDisabled
	}
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	var resp wireThreadListResponse
	if err := m.call(ctx, "thread/list", wireThreadListParams{
		Limit:   limit,
		SortKey: "updated_at",
	}, &resp); err != nil {
		return nil, err
	}
	out := make([]Thread, 0, len(resp.Data))
	for i := range resp.Data {
		out = append(out, normalizeThread(resp.Data[i]))
	}
	return out, nil
}

func (m *Manager) OpenThread(ctx context.Context, threadID string) (*ThreadDetail, error) {
	if !m.enabled() {
		return nil, ErrDisabled
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return nil, ErrThreadNotFound
	}
	var resp wireThreadResumeResponse
	if err := m.call(ctx, "thread/resume", wireThreadResumeParams{
		ThreadID:               threadID,
		PersistExtendedHistory: false,
	}, &resp); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "not found") {
			return nil, ErrThreadNotFound
		}
		return nil, err
	}
	thread := normalizeThread(resp.Thread)
	m.mu.Lock()
	state := m.ensureThreadStateLocked(thread.ID)
	state.thread = &thread
	detail := m.buildThreadDetailLocked(state, thread)
	m.mu.Unlock()
	return &detail, nil
}

func (m *Manager) StartThread(ctx context.Context, req StartThreadRequest) (*Thread, error) {
	if !m.enabled() {
		return nil, ErrDisabled
	}
	cwd := strings.TrimSpace(req.CWD)
	if cwd == "" {
		cwd = m.agentHomeDir
	}
	model := strings.TrimSpace(req.Model)
	if model == "" {
		model = m.cfgDefaultModel()
	}
	var params wireThreadStartParams
	params.CWD = stringPtr(cwd)
	params.ApprovalPolicy = stringPtr(m.mapApprovalPolicy())
	params.Sandbox = stringPtr(m.mapSandboxMode())
	params.ServiceName = stringPtr("redeven_envapp")
	params.ExperimentalRawEvents = false
	params.PersistExtendedHistory = false
	if model != "" {
		params.Model = stringPtr(model)
	}
	var resp wireThreadStartResponse
	if err := m.call(ctx, "thread/start", params, &resp); err != nil {
		return nil, err
	}
	thread := normalizeThread(resp.Thread)
	m.mu.Lock()
	state := m.ensureThreadStateLocked(thread.ID)
	state.thread = &thread
	m.mu.Unlock()
	return &thread, nil
}

func (m *Manager) StartTurn(ctx context.Context, req StartTurnRequest) (*Turn, error) {
	if !m.enabled() {
		return nil, ErrDisabled
	}
	threadID := strings.TrimSpace(req.ThreadID)
	if threadID == "" {
		return nil, ErrThreadNotFound
	}
	text := strings.TrimSpace(req.InputText)
	if text == "" {
		return nil, errors.New("missing input_text")
	}
	var resp wireTurnStartResponse
	if err := m.call(ctx, "turn/start", wireTurnStartParams{
		ThreadID: threadID,
		Input: []wireUserInput{{
			Type: "text",
			Text: text,
		}},
	}, &resp); err != nil {
		return nil, err
	}
	turn := normalizeTurn(resp.Turn)
	return &turn, nil
}

func (m *Manager) ArchiveThread(ctx context.Context, threadID string) error {
	if !m.enabled() {
		return ErrDisabled
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return ErrThreadNotFound
	}
	if err := m.call(ctx, "thread/archive", wireThreadArchiveParams{ThreadID: threadID}, nil); err != nil {
		return err
	}
	m.mu.Lock()
	delete(m.threads, threadID)
	m.mu.Unlock()
	return nil
}

func (m *Manager) SubscribeThreadEvents(ctx context.Context, threadID string, afterSeq int64) ([]Event, <-chan Event, error) {
	if !m.enabled() {
		return nil, nil, ErrDisabled
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return nil, nil, ErrThreadNotFound
	}
	m.mu.Lock()
	state := m.ensureThreadStateLocked(threadID)
	snapshot := make([]Event, 0, len(state.events))
	for _, ev := range state.events {
		if ev.Seq > afterSeq {
			snapshot = append(snapshot, ev)
		}
	}
	subID := m.nextSubscriberID.Add(1)
	ch := make(chan Event, 64)
	state.subscribers[subID] = ch
	m.mu.Unlock()

	go func() {
		<-ctx.Done()
		m.mu.Lock()
		state := m.threads[threadID]
		if state != nil {
			if existing, ok := state.subscribers[subID]; ok {
				delete(state.subscribers, subID)
				close(existing)
			}
		}
		m.mu.Unlock()
	}()
	return snapshot, ch, nil
}

func (m *Manager) RespondToRequest(ctx context.Context, threadID string, requestID string, resp PendingRequestResponse) error {
	if !m.enabled() {
		return ErrDisabled
	}
	threadID = strings.TrimSpace(threadID)
	requestID = strings.TrimSpace(requestID)
	if threadID == "" || requestID == "" {
		return ErrRequestNotFound
	}
	m.mu.Lock()
	state := m.threads[threadID]
	var record *pendingRequestRecord
	if state != nil {
		record = state.pending[requestID]
	}
	m.mu.Unlock()
	if record == nil {
		return ErrRequestNotFound
	}

	switch record.request.Type {
	case "command_approval":
		return m.respondCommandApproval(ctx, record.rawID, resp.Decision)
	case "file_change_approval":
		return m.respondFileApproval(ctx, record.rawID, resp.Decision)
	case "user_input":
		return m.respondUserInput(ctx, record.rawID, resp.Answers)
	case "permissions":
		return m.respondPermissions(ctx, record.rawID, resp.Decision, record.requestedPerms)
	default:
		return ErrInvalidResponse
	}
}

func (m *Manager) respondCommandApproval(ctx context.Context, id json.RawMessage, decision string) error {
	payload := map[string]any{"decision": mapCommandDecision(decision)}
	return m.callWithRawID(ctx, id, payload)
}

func (m *Manager) respondFileApproval(ctx context.Context, id json.RawMessage, decision string) error {
	payload := map[string]any{"decision": mapFileDecision(decision)}
	return m.callWithRawID(ctx, id, payload)
}

func (m *Manager) respondUserInput(ctx context.Context, id json.RawMessage, answers map[string][]string) error {
	wireAnswers := map[string]map[string][]string{}
	for key, values := range answers {
		qid := strings.TrimSpace(key)
		if qid == "" {
			continue
		}
		wireAnswers[qid] = map[string][]string{"answers": append([]string(nil), values...)}
	}
	return m.callWithRawID(ctx, id, map[string]any{"answers": wireAnswers})
}

func (m *Manager) respondPermissions(ctx context.Context, id json.RawMessage, decision string, requested *PermissionProfile) error {
	scope := "turn"
	var granted map[string]any
	switch normalizeDecision(decision) {
	case "accept_for_session":
		scope = "session"
		fallthrough
	case "accept":
		granted = grantedPermissionsPayload(requested)
	case "decline", "cancel":
		granted = map[string]any{}
	default:
		return ErrInvalidResponse
	}
	return m.callWithRawID(ctx, id, map[string]any{
		"scope":       scope,
		"permissions": granted,
	})
}

func (m *Manager) callWithRawID(ctx context.Context, rawID json.RawMessage, result any) error {
	proc, err := m.ensureProcess(ctx)
	if err != nil {
		return err
	}
	if err := proc.respond(rawID, result); err != nil {
		m.recordError(err)
		return err
	}
	return nil
}

func (m *Manager) call(ctx context.Context, method string, params any, out any) error {
	proc, err := m.ensureProcess(ctx)
	if err != nil {
		return err
	}
	id := strconv.FormatInt(m.nextCallID.Add(1), 10)
	callCtx, cancel := withTimeout(ctx)
	defer cancel()
	err = proc.call(callCtx, id, method, params, out)
	if err != nil {
		m.recordError(err)
		m.mu.Lock()
		if m.proc == proc {
			m.proc = nil
		}
		m.mu.Unlock()
		return err
	}
	return nil
}

func (m *Manager) ensureProcess(ctx context.Context) (*appServerProcess, error) {
	if !m.enabled() {
		return nil, ErrDisabled
	}
	m.startMu.Lock()
	defer m.startMu.Unlock()

	m.mu.Lock()
	if m.proc != nil {
		select {
		case err := <-m.proc.done:
			m.lastError = err.Error()
			m.proc = nil
		default:
			proc := m.proc
			m.mu.Unlock()
			return proc, nil
		}
	}
	m.mu.Unlock()

	binaryPath, err := m.resolveBinaryPath()
	if err != nil {
		m.recordError(err)
		return nil, err
	}
	proc, err := startAppServerProcess(m.log, binaryPath, m.handleEnvelope)
	if err != nil {
		m.recordError(err)
		return nil, err
	}
	initCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	initParams := initializeParams{
		ClientInfo: clientInfo{
			Name:    "redeven_envapp",
			Title:   "Redeven Codex UI",
			Version: "1",
		},
		Capabilities: &initializeCapabilities{
			ExperimentalAPI: false,
		},
	}
	var initResp map[string]any
	if err := proc.call(initCtx, strconv.FormatInt(m.nextCallID.Add(1), 10), "initialize", initParams, &initResp); err != nil {
		_ = proc.close()
		m.recordError(err)
		return nil, err
	}
	if err := proc.notify("initialized", map[string]any{}); err != nil {
		_ = proc.close()
		m.recordError(err)
		return nil, err
	}
	m.mu.Lock()
	m.proc = proc
	m.binaryPath = binaryPath
	m.lastError = ""
	m.mu.Unlock()
	return proc, nil
}

func (m *Manager) handleEnvelope(env rpcEnvelope) {
	if strings.TrimSpace(env.Method) == "" {
		return
	}
	switch env.Method {
	case "thread/started":
		var msg wireThreadStartedNotification
		if json.Unmarshal(env.Params, &msg) == nil {
			thread := normalizeThread(msg.Thread)
			m.mu.Lock()
			state := m.ensureThreadStateLocked(thread.ID)
			state.thread = &thread
			m.appendEventLocked(state, Event{
				Type:     "thread_started",
				ThreadID: thread.ID,
				Thread:   &thread,
			})
			m.mu.Unlock()
		}
	case "turn/started":
		var msg wireTurnNotification
		if json.Unmarshal(env.Params, &msg) == nil {
			turn := normalizeTurn(msg.Turn)
			m.mu.Lock()
			state := m.ensureThreadStateLocked(msg.ThreadID)
			m.appendEventLocked(state, Event{
				Type:     "turn_started",
				ThreadID: strings.TrimSpace(msg.ThreadID),
				TurnID:   turn.ID,
				Turn:     &turn,
			})
			m.mu.Unlock()
		}
	case "turn/completed":
		var msg wireTurnNotification
		if json.Unmarshal(env.Params, &msg) == nil {
			turn := normalizeTurn(msg.Turn)
			m.mu.Lock()
			state := m.ensureThreadStateLocked(msg.ThreadID)
			m.appendEventLocked(state, Event{
				Type:     "turn_completed",
				ThreadID: strings.TrimSpace(msg.ThreadID),
				TurnID:   turn.ID,
				Turn:     &turn,
			})
			m.mu.Unlock()
		}
	case "item/started":
		var msg wireItemNotification
		if json.Unmarshal(env.Params, &msg) == nil {
			item := normalizeItem(msg.Item)
			m.mu.Lock()
			state := m.ensureThreadStateLocked(msg.ThreadID)
			m.appendEventLocked(state, Event{
				Type:     "item_started",
				ThreadID: strings.TrimSpace(msg.ThreadID),
				TurnID:   strings.TrimSpace(msg.TurnID),
				ItemID:   item.ID,
				Item:     &item,
			})
			m.mu.Unlock()
		}
	case "item/completed":
		var msg wireItemNotification
		if json.Unmarshal(env.Params, &msg) == nil {
			item := normalizeItem(msg.Item)
			m.mu.Lock()
			state := m.ensureThreadStateLocked(msg.ThreadID)
			m.appendEventLocked(state, Event{
				Type:     "item_completed",
				ThreadID: strings.TrimSpace(msg.ThreadID),
				TurnID:   strings.TrimSpace(msg.TurnID),
				ItemID:   item.ID,
				Item:     &item,
			})
			m.mu.Unlock()
		}
	case "item/agentMessage/delta":
		m.handleDeltaEvent(env.Params, "agent_message_delta")
	case "item/commandExecution/outputDelta":
		m.handleDeltaEvent(env.Params, "command_output_delta")
	case "item/reasoning/delta":
		m.handleDeltaEvent(env.Params, "reasoning_delta")
	case "thread/status/changed":
		var msg wireThreadStatusChangedNotification
		if json.Unmarshal(env.Params, &msg) == nil {
			m.mu.Lock()
			state := m.ensureThreadStateLocked(msg.ThreadID)
			if state.thread != nil {
				state.thread.Status = strings.TrimSpace(msg.Status.Type)
				state.thread.ActiveFlags = append([]string(nil), msg.Status.ActiveFlags...)
			}
			m.appendEventLocked(state, Event{
				Type:     "thread_status_changed",
				ThreadID: strings.TrimSpace(msg.ThreadID),
				Status:   strings.TrimSpace(msg.Status.Type),
				Flags:    append([]string(nil), msg.Status.ActiveFlags...),
			})
			m.mu.Unlock()
		}
	case "thread/archived":
		var msg wireThreadArchivedNotification
		if json.Unmarshal(env.Params, &msg) == nil {
			m.mu.Lock()
			state := m.ensureThreadStateLocked(msg.ThreadID)
			m.appendEventLocked(state, Event{
				Type:     "thread_archived",
				ThreadID: strings.TrimSpace(msg.ThreadID),
			})
			delete(m.threads, strings.TrimSpace(msg.ThreadID))
			m.mu.Unlock()
		}
	case "serverRequest/resolved":
		var msg wireServerRequestResolvedNotification
		if json.Unmarshal(env.Params, &msg) == nil {
			requestID := normalizeExternalRequestID(msg.RequestID)
			m.mu.Lock()
			state := m.ensureThreadStateLocked(msg.ThreadID)
			delete(state.pending, requestID)
			m.appendEventLocked(state, Event{
				Type:      "request_resolved",
				ThreadID:  strings.TrimSpace(msg.ThreadID),
				RequestID: requestID,
			})
			m.mu.Unlock()
		}
	case "item/commandExecution/requestApproval":
		m.handleCommandApprovalRequest(env)
	case "item/fileChange/requestApproval":
		m.handleFileApprovalRequest(env)
	case "item/tool/requestUserInput":
		m.handleUserInputRequest(env)
	case "item/permissions/requestApproval":
		m.handlePermissionsRequest(env)
	}
}

func (m *Manager) handleDeltaEvent(raw json.RawMessage, typ string) {
	var msg wireDeltaNotification
	if json.Unmarshal(raw, &msg) != nil {
		return
	}
	m.mu.Lock()
	state := m.ensureThreadStateLocked(msg.ThreadID)
	m.appendEventLocked(state, Event{
		Type:     typ,
		ThreadID: strings.TrimSpace(msg.ThreadID),
		TurnID:   strings.TrimSpace(msg.TurnID),
		ItemID:   strings.TrimSpace(msg.ItemID),
		Delta:    msg.Delta,
	})
	m.mu.Unlock()
}

func (m *Manager) handleCommandApprovalRequest(env rpcEnvelope) {
	var msg wireCommandApprovalRequest
	if json.Unmarshal(env.Params, &msg) != nil {
		return
	}
	requestID := normalizeExternalRequestID(env.ID)
	request := PendingRequest{
		ID:                    requestID,
		Type:                  "command_approval",
		ThreadID:              strings.TrimSpace(msg.ThreadID),
		TurnID:                strings.TrimSpace(msg.TurnID),
		ItemID:                strings.TrimSpace(msg.ItemID),
		Reason:                strings.TrimSpace(stringValue(msg.Reason)),
		Command:               strings.TrimSpace(stringValue(msg.Command)),
		CWD:                   strings.TrimSpace(stringValue(msg.CWD)),
		AvailableDecisions:    normalizeAvailableDecisions(msg.AvailableDecisions),
		AdditionalPermissions: normalizePermissionProfile(msg.AdditionalPermissions),
	}
	if len(request.AvailableDecisions) == 0 {
		request.AvailableDecisions = []string{"accept", "accept_for_session", "decline", "cancel"}
	}
	record := &pendingRequestRecord{
		request:         request,
		rawID:           append(json.RawMessage(nil), env.ID...),
		additionalPerms: normalizePermissionProfile(msg.AdditionalPermissions),
	}
	m.storePendingRequest(record)
}

func (m *Manager) handleFileApprovalRequest(env rpcEnvelope) {
	var msg wireFileChangeApprovalRequest
	if json.Unmarshal(env.Params, &msg) != nil {
		return
	}
	request := PendingRequest{
		ID:                 normalizeExternalRequestID(env.ID),
		Type:               "file_change_approval",
		ThreadID:           strings.TrimSpace(msg.ThreadID),
		TurnID:             strings.TrimSpace(msg.TurnID),
		ItemID:             strings.TrimSpace(msg.ItemID),
		Reason:             strings.TrimSpace(stringValue(msg.Reason)),
		GrantRoot:          strings.TrimSpace(stringValue(msg.GrantRoot)),
		AvailableDecisions: []string{"accept", "accept_for_session", "decline", "cancel"},
	}
	m.storePendingRequest(&pendingRequestRecord{
		request: request,
		rawID:   append(json.RawMessage(nil), env.ID...),
	})
}

func (m *Manager) handleUserInputRequest(env rpcEnvelope) {
	var msg wireUserInputRequest
	if json.Unmarshal(env.Params, &msg) != nil {
		return
	}
	request := PendingRequest{
		ID:        normalizeExternalRequestID(env.ID),
		Type:      "user_input",
		ThreadID:  strings.TrimSpace(msg.ThreadID),
		TurnID:    strings.TrimSpace(msg.TurnID),
		ItemID:    strings.TrimSpace(msg.ItemID),
		Questions: normalizeUserQuestions(msg.Questions),
	}
	m.storePendingRequest(&pendingRequestRecord{
		request: request,
		rawID:   append(json.RawMessage(nil), env.ID...),
	})
}

func (m *Manager) handlePermissionsRequest(env rpcEnvelope) {
	var msg wirePermissionsRequest
	if json.Unmarshal(env.Params, &msg) != nil {
		return
	}
	perms := normalizePermissionProfile(&msg.Permissions)
	request := PendingRequest{
		ID:                 normalizeExternalRequestID(env.ID),
		Type:               "permissions",
		ThreadID:           strings.TrimSpace(msg.ThreadID),
		TurnID:             strings.TrimSpace(msg.TurnID),
		ItemID:             strings.TrimSpace(msg.ItemID),
		Reason:             strings.TrimSpace(stringValue(msg.Reason)),
		Permissions:        perms,
		AvailableDecisions: []string{"accept", "accept_for_session", "decline", "cancel"},
	}
	m.storePendingRequest(&pendingRequestRecord{
		request:        request,
		rawID:          append(json.RawMessage(nil), env.ID...),
		requestedPerms: perms,
	})
}

func (m *Manager) storePendingRequest(record *pendingRequestRecord) {
	if record == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	state := m.ensureThreadStateLocked(record.request.ThreadID)
	state.pending[record.request.ID] = record
	requestCopy := record.request
	m.appendEventLocked(state, Event{
		Type:      "request_created",
		ThreadID:  record.request.ThreadID,
		TurnID:    record.request.TurnID,
		ItemID:    record.request.ItemID,
		RequestID: record.request.ID,
		Request:   &requestCopy,
	})
}

func (m *Manager) enabled() bool {
	return m != nil && m.cfg != nil && m.cfg.Enabled
}

func (m *Manager) resolveBinaryPath() (string, error) {
	m.mu.Lock()
	current := strings.TrimSpace(m.binaryPath)
	configured := ""
	if m.cfg != nil {
		configured = strings.TrimSpace(m.cfg.BinaryPath)
	}
	m.mu.Unlock()
	if current != "" {
		return current, nil
	}
	if configured != "" {
		return configured, nil
	}
	path, err := exec.LookPath("codex")
	if err != nil {
		return "", errors.New("codex binary not found; configure codex.binary_path or add codex to PATH")
	}
	return path, nil
}

func (m *Manager) ensureThreadStateLocked(threadID string) *threadState {
	threadID = strings.TrimSpace(threadID)
	state := m.threads[threadID]
	if state != nil {
		return state
	}
	state = &threadState{
		pending:     make(map[string]*pendingRequestRecord),
		subscribers: make(map[int64]chan Event),
	}
	m.threads[threadID] = state
	return state
}

func (m *Manager) appendEventLocked(state *threadState, ev Event) {
	if state == nil {
		return
	}
	state.lastEventSeq++
	ev.Seq = state.lastEventSeq
	state.events = append(state.events, ev)
	if len(state.events) > 400 {
		state.events = append([]Event(nil), state.events[len(state.events)-400:]...)
	}
	for id, ch := range state.subscribers {
		select {
		case ch <- ev:
		default:
			close(ch)
			delete(state.subscribers, id)
		}
	}
}

func (m *Manager) buildThreadDetailLocked(state *threadState, thread Thread) ThreadDetail {
	out := ThreadDetail{
		Thread:           thread,
		LastEventSeq:     state.lastEventSeq,
		ActiveStatus:     thread.Status,
		ActiveStatusFlag: append([]string(nil), thread.ActiveFlags...),
	}
	if len(state.pending) > 0 {
		out.PendingRequests = make([]PendingRequest, 0, len(state.pending))
		for _, req := range state.pending {
			out.PendingRequests = append(out.PendingRequests, req.request)
		}
	}
	return out
}

func (m *Manager) recordError(err error) {
	if err == nil {
		return
	}
	m.mu.Lock()
	m.lastError = strings.TrimSpace(err.Error())
	m.mu.Unlock()
}

func (m *Manager) cfgDefaultModel() string {
	if m == nil || m.cfg == nil {
		return ""
	}
	return strings.TrimSpace(m.cfg.DefaultModel)
}

func (m *Manager) mapApprovalPolicy() string {
	if m == nil || m.cfg == nil {
		return "on-request"
	}
	switch m.cfg.ApprovalPolicyValue() {
	case "untrusted":
		return "untrusted"
	case "on_failure":
		return "on-failure"
	case "never":
		return "never"
	default:
		return "on-request"
	}
}

func (m *Manager) mapSandboxMode() string {
	if m == nil || m.cfg == nil {
		return "workspace-write"
	}
	switch m.cfg.SandboxModeValue() {
	case "read_only":
		return "read-only"
	case "danger_full_access":
		return "danger-full-access"
	default:
		return "workspace-write"
	}
}

func stringPtr(v string) *string {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	out := strings.TrimSpace(v)
	return &out
}

func withTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	if _, ok := ctx.Deadline(); ok {
		return ctx, func() {}
	}
	return context.WithTimeout(ctx, 30*time.Second)
}

func normalizeDecision(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "accept", "approve":
		return "accept"
	case "accept_for_session", "acceptforsession":
		return "accept_for_session"
	case "decline", "deny":
		return "decline"
	case "cancel":
		return "cancel"
	default:
		return ""
	}
}

func mapCommandDecision(v string) any {
	switch normalizeDecision(v) {
	case "accept":
		return "accept"
	case "accept_for_session":
		return "acceptForSession"
	case "decline":
		return "decline"
	case "cancel":
		return "cancel"
	default:
		return "cancel"
	}
}

func mapFileDecision(v string) string {
	switch normalizeDecision(v) {
	case "accept":
		return "accept"
	case "accept_for_session":
		return "acceptForSession"
	case "decline":
		return "decline"
	default:
		return "cancel"
	}
}

func grantedPermissionsPayload(requested *PermissionProfile) map[string]any {
	if requested == nil {
		return map[string]any{}
	}
	out := map[string]any{}
	if requested.NetworkEnabled != nil {
		out["network"] = map[string]any{"enabled": *requested.NetworkEnabled}
	}
	fileSystem := map[string]any{}
	if len(requested.FileSystemRead) > 0 {
		fileSystem["read"] = append([]string(nil), requested.FileSystemRead...)
	}
	if len(requested.FileSystemWrite) > 0 {
		fileSystem["write"] = append([]string(nil), requested.FileSystemWrite...)
	}
	if len(fileSystem) > 0 {
		out["fileSystem"] = fileSystem
	}
	return out
}
