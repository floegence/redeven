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
)

var (
	ErrUnavailable     = errors.New("codex is not available on this host")
	ErrThreadNotFound  = errors.New("codex thread not found")
	ErrRequestNotFound = errors.New("codex pending request not found")
	ErrInvalidResponse = errors.New("invalid codex request response")
)

type Options struct {
	Logger       *slog.Logger
	AgentHomeDir string
}

type Manager struct {
	log          *slog.Logger
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
	thread         *Thread
	runtimeConfig  ThreadRuntimeConfig
	tokenUsage     *ThreadTokenUsage
	lastAppliedSeq int64
	liveLoaded     bool
	events         []Event
	pending        map[string]*pendingRequestRecord
	subscribers    map[int64]chan Event
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
	return &Manager{
		log:          logger,
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

func (m *Manager) Status(_ context.Context) Status {
	if m == nil {
		return Status{}
	}
	out := Status{
		AgentHomeDir: m.agentHomeDir,
	}
	path, err := m.resolveBinaryPath()
	if err == nil {
		out.Available = true
		out.BinaryPath = path
	}
	m.mu.Lock()
	out.Error = strings.TrimSpace(m.lastError)
	out.Ready = m.proc != nil && out.Error == ""
	if m.binaryPath != "" {
		out.BinaryPath = m.binaryPath
	}
	m.mu.Unlock()
	if err != nil && out.Error == "" {
		out.Error = err.Error()
	}
	return out
}

func (m *Manager) ListThreads(ctx context.Context, limit int) ([]Thread, error) {
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

func (m *Manager) ReadThread(ctx context.Context, threadID string) (*ThreadDetail, error) {
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return nil, ErrThreadNotFound
	}
	var resp wireThreadReadResponse
	if err := m.call(ctx, "thread/read", wireThreadReadParams{
		ThreadID:     threadID,
		IncludeTurns: true,
	}, &resp); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "not found") {
			return nil, ErrThreadNotFound
		}
		return nil, err
	}
	thread := normalizeThread(resp.Thread)
	m.mu.Lock()
	state := m.ensureThreadStateLocked(thread.ID)
	projectedThread := mergeProjectedThread(state, thread)
	state.thread = &projectedThread
	if isLoadedThreadStatus(thread.Status) {
		state.liveLoaded = true
	}
	detail := m.buildThreadDetailLocked(state, projectedThread)
	m.mu.Unlock()
	return &detail, nil
}

func (m *Manager) StartThread(ctx context.Context, req StartThreadRequest) (*ThreadDetail, error) {
	cwd := strings.TrimSpace(req.CWD)
	if cwd == "" {
		cwd = m.agentHomeDir
	}
	model := strings.TrimSpace(req.Model)
	approvalPolicy := normalizeApprovalPolicyRequest(req.ApprovalPolicy)
	sandboxMode := normalizeSandboxModeRequest(req.SandboxMode)
	approvalsReviewer := normalizeApprovalsReviewer(req.ApprovalsReviewer)
	var params wireThreadStartParams
	params.CWD = stringPtr(cwd)
	params.ServiceName = stringPtr("redeven_envapp")
	params.ExperimentalRawEvents = true
	params.PersistExtendedHistory = true
	if model != "" {
		params.Model = stringPtr(model)
	}
	if approvalPolicy != "" {
		params.ApprovalPolicy = stringPtr(approvalPolicy)
	}
	if sandboxMode != "" {
		params.Sandbox = stringPtr(sandboxMode)
	}
	if approvalsReviewer != "" {
		params.ApprovalsReviewer = stringPtr(approvalsReviewer)
	}
	var resp wireThreadStartResponse
	if err := m.call(ctx, "thread/start", params, &resp); err != nil {
		return nil, err
	}
	thread := normalizeThread(resp.Thread)
	runtimeConfig := normalizeThreadRuntimeConfig(
		resp.Model,
		resp.ModelProvider,
		resp.CWD,
		resp.ApprovalPolicy,
		resp.ApprovalsReviewer,
		resp.Sandbox,
		resp.ReasoningEffort,
	)
	m.mu.Lock()
	state := m.ensureThreadStateLocked(thread.ID)
	state.thread = &thread
	state.runtimeConfig = runtimeConfig
	state.liveLoaded = true
	detail := m.buildThreadDetailLocked(state, thread)
	m.mu.Unlock()
	return &detail, nil
}

func (m *Manager) ensureThreadLoaded(ctx context.Context, threadID string) error {
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return ErrThreadNotFound
	}
	m.mu.Lock()
	state := m.ensureThreadStateLocked(threadID)
	if state.liveLoaded {
		m.mu.Unlock()
		return nil
	}
	m.mu.Unlock()

	var resp wireThreadResumeResponse
	if err := m.call(ctx, "thread/resume", wireThreadResumeParams{
		ThreadID:               threadID,
		PersistExtendedHistory: true,
	}, &resp); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "not found") {
			return ErrThreadNotFound
		}
		return err
	}

	thread := normalizeThread(resp.Thread)
	runtimeConfig := normalizeThreadRuntimeConfig(
		resp.Model,
		resp.ModelProvider,
		resp.CWD,
		resp.ApprovalPolicy,
		resp.ApprovalsReviewer,
		resp.Sandbox,
		resp.ReasoningEffort,
	)

	m.mu.Lock()
	state = m.ensureThreadStateLocked(thread.ID)
	projectedThread := mergeProjectedThread(state, thread)
	state.thread = &projectedThread
	state.runtimeConfig = runtimeConfig
	state.liveLoaded = true
	m.mu.Unlock()
	return nil
}

func (m *Manager) ReadCapabilities(ctx context.Context, cwd string) (*Capabilities, error) {
	cwd = strings.TrimSpace(cwd)
	if cwd == "" {
		cwd = m.agentHomeDir
	}
	includeHidden := false
	var modelResp wireModelListResponse
	if err := m.call(ctx, "model/list", wireModelListParams{
		IncludeHidden: &includeHidden,
	}, &modelResp); err != nil {
		return nil, err
	}
	var configResp wireConfigReadResponse
	if err := m.call(ctx, "config/read", wireConfigReadParams{
		IncludeLayers: false,
		CWD:           stringPtr(cwd),
	}, &configResp); err != nil {
		return nil, err
	}
	var requirementsResp wireConfigRequirementsReadResponse
	if err := m.call(ctx, "configRequirements/read", map[string]any{}, &requirementsResp); err != nil {
		return nil, err
	}
	out := &Capabilities{
		EffectiveConfig: normalizeEffectiveConfig(configResp.Config, cwd),
		Requirements:    normalizeConfigRequirements(requirementsResp.Requirements),
	}
	if len(modelResp.Data) > 0 {
		out.Models = make([]ModelOption, 0, len(modelResp.Data))
		for i := range modelResp.Data {
			out.Models = append(out.Models, normalizeModelOption(modelResp.Data[i]))
		}
	}
	return out, nil
}

func (m *Manager) StartTurn(ctx context.Context, req StartTurnRequest) (*Turn, error) {
	threadID := strings.TrimSpace(req.ThreadID)
	if threadID == "" {
		return nil, ErrThreadNotFound
	}
	if err := m.ensureThreadLoaded(ctx, threadID); err != nil {
		return nil, err
	}
	inputs := make([]wireUserInput, 0, len(req.Inputs)+1)
	if text := strings.TrimSpace(req.InputText); text != "" {
		inputs = append(inputs, wireUserInput{
			Type: "text",
			Text: text,
		})
	}
	for i := range req.Inputs {
		inputType := strings.TrimSpace(req.Inputs[i].Type)
		if inputType == "" {
			continue
		}
		entry := wireUserInput{
			Type: inputType,
			Text: strings.TrimSpace(req.Inputs[i].Text),
			URL:  strings.TrimSpace(req.Inputs[i].URL),
			Path: strings.TrimSpace(req.Inputs[i].Path),
			Name: strings.TrimSpace(req.Inputs[i].Name),
		}
		inputs = append(inputs, entry)
	}
	if len(inputs) == 0 {
		return nil, errors.New("missing inputs")
	}
	approvalPolicy := normalizeApprovalPolicyRequest(req.ApprovalPolicy)
	sandboxMode := normalizeSandboxModeRequest(req.SandboxMode)
	approvalsReviewer := normalizeApprovalsReviewer(req.ApprovalsReviewer)
	var resp wireTurnStartResponse
	params := wireTurnStartParams{
		ThreadID: threadID,
		Input:    inputs,
		CWD:      stringPtr(req.CWD),
		Model:    stringPtr(req.Model),
		Effort:   stringPtr(req.Effort),
	}
	if approvalPolicy != "" {
		params.ApprovalPolicy = stringPtr(approvalPolicy)
	}
	if approvalsReviewer != "" {
		params.ApprovalsReviewer = stringPtr(approvalsReviewer)
	}
	if policy := buildSandboxPolicyRequest(sandboxMode); policy != nil {
		params.SandboxPolicy = policy
	}
	if err := m.call(ctx, "turn/start", params, &resp); err != nil {
		return nil, err
	}
	turn := normalizeTurn(resp.Turn)
	m.mu.Lock()
	if state := m.threads[threadID]; state != nil {
		thread := ensureProjectedThread(state, threadID)
		upsertProjectedTurn(thread, turn)
		if thread.Preview == "" {
			thread.Preview = strings.TrimSpace(req.InputText)
		}
		thread.UpdatedAtUnixS = time.Now().Unix()
		if nextCWD := strings.TrimSpace(req.CWD); nextCWD != "" {
			state.runtimeConfig.CWD = nextCWD
		}
		if nextModel := strings.TrimSpace(req.Model); nextModel != "" {
			state.runtimeConfig.Model = nextModel
		}
		if nextEffort := strings.TrimSpace(req.Effort); nextEffort != "" {
			state.runtimeConfig.ReasoningEffort = nextEffort
		}
		if approvalPolicy != "" {
			state.runtimeConfig.ApprovalPolicy = approvalPolicy
		}
		if sandboxMode != "" {
			state.runtimeConfig.SandboxMode = sandboxMode
		}
		if approvalsReviewer != "" {
			state.runtimeConfig.ApprovalsReviewer = approvalsReviewer
		}
	}
	m.mu.Unlock()
	return &turn, nil
}

func (m *Manager) ArchiveThread(ctx context.Context, threadID string) error {
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return ErrThreadNotFound
	}
	if err := m.call(ctx, "thread/archive", wireThreadArchiveParams{ThreadID: threadID}, nil); err != nil {
		return err
	}
	m.mu.Lock()
	if state := m.threads[threadID]; state != nil {
		thread := ensureProjectedThread(state, threadID)
		thread.Status = "archived"
		thread.ActiveFlags = nil
		thread.UpdatedAtUnixS = time.Now().Unix()
		state.liveLoaded = false
	}
	m.mu.Unlock()
	return nil
}

func (m *Manager) SubscribeThreadEvents(ctx context.Context, threadID string, afterSeq int64) ([]Event, <-chan Event, error) {
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
			ExperimentalAPI: true,
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
			projectedThread := mergeProjectedThread(state, thread)
			state.thread = &projectedThread
			state.liveLoaded = true
			threadCopy := cloneThread(projectedThread)
			m.appendEventLocked(state, Event{
				Type:     "thread_started",
				ThreadID: thread.ID,
				Thread:   &threadCopy,
			})
			m.mu.Unlock()
		}
	case "turn/started":
		var msg wireTurnNotification
		if json.Unmarshal(env.Params, &msg) == nil {
			threadID := strings.TrimSpace(msg.ThreadID)
			turn := normalizeTurn(msg.Turn)
			m.mu.Lock()
			state := m.ensureThreadStateLocked(threadID)
			thread := ensureProjectedThread(state, threadID)
			upsertProjectedTurn(thread, turn)
			thread.UpdatedAtUnixS = time.Now().Unix()
			turnCopy := cloneTurn(turn)
			m.appendEventLocked(state, Event{
				Type:     "turn_started",
				ThreadID: threadID,
				TurnID:   turn.ID,
				Turn:     &turnCopy,
			})
			m.mu.Unlock()
		}
	case "turn/completed":
		var msg wireTurnNotification
		if json.Unmarshal(env.Params, &msg) == nil {
			threadID := strings.TrimSpace(msg.ThreadID)
			turn := normalizeTurn(msg.Turn)
			m.mu.Lock()
			state := m.ensureThreadStateLocked(threadID)
			thread := ensureProjectedThread(state, threadID)
			upsertProjectedTurn(thread, turn)
			thread.UpdatedAtUnixS = time.Now().Unix()
			turnCopy := cloneTurn(turn)
			m.appendEventLocked(state, Event{
				Type:     "turn_completed",
				ThreadID: threadID,
				TurnID:   turn.ID,
				Turn:     &turnCopy,
			})
			m.mu.Unlock()
		}
	case "item/started":
		var msg wireItemNotification
		if json.Unmarshal(env.Params, &msg) == nil {
			threadID := strings.TrimSpace(msg.ThreadID)
			turnID := strings.TrimSpace(msg.TurnID)
			item := normalizeItem(msg.Item)
			m.mu.Lock()
			state := m.ensureThreadStateLocked(threadID)
			thread := ensureProjectedThread(state, threadID)
			turn := ensureProjectedTurn(thread, turnID)
			upsertProjectedItem(turn, item)
			thread.UpdatedAtUnixS = time.Now().Unix()
			itemCopy := cloneItem(item)
			m.appendEventLocked(state, Event{
				Type:     "item_started",
				ThreadID: threadID,
				TurnID:   turnID,
				ItemID:   item.ID,
				Item:     &itemCopy,
			})
			m.mu.Unlock()
		}
	case "item/completed":
		var msg wireItemNotification
		if json.Unmarshal(env.Params, &msg) == nil {
			threadID := strings.TrimSpace(msg.ThreadID)
			turnID := strings.TrimSpace(msg.TurnID)
			item := normalizeItem(msg.Item)
			m.mu.Lock()
			state := m.ensureThreadStateLocked(threadID)
			thread := ensureProjectedThread(state, threadID)
			turn := ensureProjectedTurn(thread, turnID)
			upsertProjectedItem(turn, item)
			thread.UpdatedAtUnixS = time.Now().Unix()
			itemCopy := cloneItem(item)
			m.appendEventLocked(state, Event{
				Type:     "item_completed",
				ThreadID: threadID,
				TurnID:   turnID,
				ItemID:   item.ID,
				Item:     &itemCopy,
			})
			m.mu.Unlock()
		}
	case "item/agentMessage/delta":
		m.handleDeltaEvent(env.Params, "agent_message_delta", "agentMessage")
	case "item/commandExecution/outputDelta":
		m.handleDeltaEvent(env.Params, "command_output_delta", "commandExecution")
	case "item/fileChange/outputDelta":
		m.handleDeltaEvent(env.Params, "file_change_delta", "fileChange")
	case "item/plan/delta":
		m.handleDeltaEvent(env.Params, "plan_delta", "plan")
	case "item/reasoningSummary/textDelta":
		m.handleReasoningSummaryTextDelta(env.Params)
	case "item/reasoningSummary/partAdded":
		m.handleReasoningSummaryPartAdded(env.Params)
	case "item/reasoning/textDelta":
		m.handleReasoningTextDelta(env.Params)
	case "item/reasoning/delta":
		m.handleDeltaEvent(env.Params, "reasoning_delta", "reasoning")
	case "rawResponseItem/completed":
		m.handleRawResponseItemCompleted(env.Params)
	case "thread/status/changed":
		var msg wireThreadStatusChangedNotification
		if json.Unmarshal(env.Params, &msg) == nil {
			threadID := strings.TrimSpace(msg.ThreadID)
			m.mu.Lock()
			state := m.ensureThreadStateLocked(threadID)
			thread := ensureProjectedThread(state, threadID)
			thread.Status = strings.TrimSpace(msg.Status.Type)
			thread.ActiveFlags = append([]string(nil), msg.Status.ActiveFlags...)
			thread.UpdatedAtUnixS = time.Now().Unix()
			state.liveLoaded = isLoadedThreadStatus(thread.Status)
			m.appendEventLocked(state, Event{
				Type:     "thread_status_changed",
				ThreadID: threadID,
				Status:   strings.TrimSpace(msg.Status.Type),
				Flags:    append([]string(nil), msg.Status.ActiveFlags...),
			})
			m.mu.Unlock()
		}
	case "thread/name/updated":
		var msg wireThreadNameUpdatedNotification
		if json.Unmarshal(env.Params, &msg) == nil {
			threadID := strings.TrimSpace(msg.ThreadID)
			threadName := strings.TrimSpace(stringValue(msg.ThreadName))
			m.mu.Lock()
			state := m.ensureThreadStateLocked(threadID)
			thread := ensureProjectedThread(state, threadID)
			thread.Name = threadName
			thread.UpdatedAtUnixS = time.Now().Unix()
			m.appendEventLocked(state, Event{
				Type:       "thread_name_updated",
				ThreadID:   threadID,
				ThreadName: threadName,
			})
			m.mu.Unlock()
		}
	case "thread/tokenUsage/updated":
		var msg wireThreadTokenUsageUpdatedNotification
		if json.Unmarshal(env.Params, &msg) == nil {
			threadID := strings.TrimSpace(msg.ThreadID)
			turnID := strings.TrimSpace(msg.TurnID)
			tokenUsage := normalizeThreadTokenUsage(msg.TokenUsage)
			m.mu.Lock()
			state := m.ensureThreadStateLocked(threadID)
			state.tokenUsage = cloneThreadTokenUsage(tokenUsage)
			if thread := ensureProjectedThread(state, threadID); thread != nil {
				thread.UpdatedAtUnixS = time.Now().Unix()
			}
			m.appendEventLocked(state, Event{
				Type:       "thread_token_usage_updated",
				ThreadID:   threadID,
				TurnID:     turnID,
				TokenUsage: cloneThreadTokenUsage(tokenUsage),
			})
			m.mu.Unlock()
		}
	case "thread/archived":
		var msg wireThreadArchivedNotification
		if json.Unmarshal(env.Params, &msg) == nil {
			threadID := strings.TrimSpace(msg.ThreadID)
			m.mu.Lock()
			state := m.ensureThreadStateLocked(threadID)
			thread := ensureProjectedThread(state, threadID)
			thread.Status = "archived"
			thread.ActiveFlags = nil
			thread.UpdatedAtUnixS = time.Now().Unix()
			state.liveLoaded = false
			m.appendEventLocked(state, Event{
				Type:     "thread_archived",
				ThreadID: threadID,
			})
			m.mu.Unlock()
		}
	case "thread/unarchived":
		var msg wireThreadUnarchivedNotification
		if json.Unmarshal(env.Params, &msg) == nil {
			threadID := strings.TrimSpace(msg.ThreadID)
			m.mu.Lock()
			state := m.ensureThreadStateLocked(threadID)
			thread := ensureProjectedThread(state, threadID)
			if strings.TrimSpace(thread.Status) == "archived" {
				thread.Status = "notLoaded"
			}
			thread.ActiveFlags = nil
			thread.UpdatedAtUnixS = time.Now().Unix()
			state.liveLoaded = false
			m.appendEventLocked(state, Event{
				Type:     "thread_unarchived",
				ThreadID: threadID,
			})
			m.mu.Unlock()
		}
	case "thread/closed":
		var msg wireThreadClosedNotification
		if json.Unmarshal(env.Params, &msg) == nil {
			threadID := strings.TrimSpace(msg.ThreadID)
			m.mu.Lock()
			state := m.ensureThreadStateLocked(threadID)
			thread := ensureProjectedThread(state, threadID)
			thread.Status = "notLoaded"
			thread.ActiveFlags = nil
			thread.UpdatedAtUnixS = time.Now().Unix()
			state.liveLoaded = false
			m.appendEventLocked(state, Event{
				Type:     "thread_closed",
				ThreadID: threadID,
			})
			m.mu.Unlock()
		}
	case "error":
		var msg wireErrorNotification
		if json.Unmarshal(env.Params, &msg) == nil {
			threadID := strings.TrimSpace(msg.ThreadID)
			turnID := strings.TrimSpace(msg.TurnID)
			message := strings.TrimSpace(msg.Error.Message)
			m.mu.Lock()
			state := m.ensureThreadStateLocked(threadID)
			if !msg.WillRetry {
				thread := ensureProjectedThread(state, threadID)
				thread.Status = "systemError"
				thread.ActiveFlags = nil
				thread.UpdatedAtUnixS = time.Now().Unix()
			}
			m.appendEventLocked(state, Event{
				Type:      "error",
				ThreadID:  threadID,
				TurnID:    turnID,
				Error:     message,
				WillRetry: msg.WillRetry,
			})
			m.mu.Unlock()
		}
	case "serverRequest/resolved":
		var msg wireServerRequestResolvedNotification
		if json.Unmarshal(env.Params, &msg) == nil {
			requestID := normalizeExternalRequestID(msg.RequestID)
			threadID := strings.TrimSpace(msg.ThreadID)
			m.mu.Lock()
			state := m.ensureThreadStateLocked(threadID)
			delete(state.pending, requestID)
			m.appendEventLocked(state, Event{
				Type:      "request_resolved",
				ThreadID:  threadID,
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

func (m *Manager) handleDeltaEvent(raw json.RawMessage, typ string, itemType string) {
	var msg wireDeltaNotification
	if json.Unmarshal(raw, &msg) != nil {
		return
	}
	threadID := strings.TrimSpace(msg.ThreadID)
	turnID := strings.TrimSpace(msg.TurnID)
	itemID := strings.TrimSpace(msg.ItemID)
	m.mu.Lock()
	state := m.ensureThreadStateLocked(threadID)
	thread := ensureProjectedThread(state, threadID)
	turn := ensureProjectedTurn(thread, turnID)
	item := ensureProjectedItem(turn, itemID, itemType)
	switch typ {
	case "agent_message_delta", "plan_delta", "reasoning_delta":
		appendProjectedItemText(item, msg.Delta)
	case "command_output_delta":
		item.AggregatedOutput += msg.Delta
	case "file_change_delta":
		appendProjectedFileChange(item, msg.Delta)
	}
	thread.UpdatedAtUnixS = time.Now().Unix()
	m.appendEventLocked(state, Event{
		Type:     typ,
		ThreadID: threadID,
		TurnID:   turnID,
		ItemID:   itemID,
		Delta:    msg.Delta,
	})
	m.mu.Unlock()
}

func (m *Manager) handleReasoningSummaryTextDelta(raw json.RawMessage) {
	var msg wireReasoningSummaryTextDeltaNotification
	if json.Unmarshal(raw, &msg) != nil {
		return
	}
	threadID := strings.TrimSpace(msg.ThreadID)
	turnID := strings.TrimSpace(msg.TurnID)
	itemID := strings.TrimSpace(msg.ItemID)
	summaryIndex := msg.SummaryIndex
	m.mu.Lock()
	state := m.ensureThreadStateLocked(threadID)
	thread := ensureProjectedThread(state, threadID)
	turn := ensureProjectedTurn(thread, turnID)
	item := ensureProjectedItem(turn, itemID, "reasoning")
	appendProjectedItemSummary(item, summaryIndex, msg.Delta)
	thread.UpdatedAtUnixS = time.Now().Unix()
	m.appendEventLocked(state, Event{
		Type:         "reasoning_summary_delta",
		ThreadID:     threadID,
		TurnID:       turnID,
		ItemID:       itemID,
		Delta:        msg.Delta,
		SummaryIndex: &summaryIndex,
	})
	m.mu.Unlock()
}

func (m *Manager) handleReasoningSummaryPartAdded(raw json.RawMessage) {
	var msg wireReasoningSummaryPartAddedNotification
	if json.Unmarshal(raw, &msg) != nil {
		return
	}
	threadID := strings.TrimSpace(msg.ThreadID)
	turnID := strings.TrimSpace(msg.TurnID)
	itemID := strings.TrimSpace(msg.ItemID)
	summaryIndex := msg.SummaryIndex
	m.mu.Lock()
	state := m.ensureThreadStateLocked(threadID)
	thread := ensureProjectedThread(state, threadID)
	turn := ensureProjectedTurn(thread, turnID)
	item := ensureProjectedItem(turn, itemID, "reasoning")
	appendProjectedItemSummary(item, summaryIndex, "")
	thread.UpdatedAtUnixS = time.Now().Unix()
	m.appendEventLocked(state, Event{
		Type:         "reasoning_summary_part_added",
		ThreadID:     threadID,
		TurnID:       turnID,
		ItemID:       itemID,
		SummaryIndex: &summaryIndex,
	})
	m.mu.Unlock()
}

func (m *Manager) handleReasoningTextDelta(raw json.RawMessage) {
	var msg wireReasoningTextDeltaNotification
	if json.Unmarshal(raw, &msg) != nil {
		return
	}
	threadID := strings.TrimSpace(msg.ThreadID)
	turnID := strings.TrimSpace(msg.TurnID)
	itemID := strings.TrimSpace(msg.ItemID)
	contentIndex := msg.ContentIndex
	m.mu.Lock()
	state := m.ensureThreadStateLocked(threadID)
	thread := ensureProjectedThread(state, threadID)
	turn := ensureProjectedTurn(thread, turnID)
	item := ensureProjectedItem(turn, itemID, "reasoning")
	appendProjectedItemContent(item, contentIndex, msg.Delta)
	thread.UpdatedAtUnixS = time.Now().Unix()
	m.appendEventLocked(state, Event{
		Type:         "reasoning_delta",
		ThreadID:     threadID,
		TurnID:       turnID,
		ItemID:       itemID,
		Delta:        msg.Delta,
		ContentIndex: &contentIndex,
	})
	m.mu.Unlock()
}

func (m *Manager) handleRawResponseItemCompleted(raw json.RawMessage) {
	var msg wireRawResponseItemCompletedNotification
	if json.Unmarshal(raw, &msg) != nil {
		return
	}
	threadID := strings.TrimSpace(msg.ThreadID)
	turnID := strings.TrimSpace(msg.TurnID)
	m.mu.Lock()
	state := m.ensureThreadStateLocked(threadID)
	item, ok := normalizeRawResponseItem(
		msg.Item,
		turnID+":raw:"+strconv.FormatInt(state.lastAppliedSeq+1, 10),
	)
	if !ok {
		m.mu.Unlock()
		return
	}
	thread := ensureProjectedThread(state, threadID)
	turn := ensureProjectedTurn(thread, turnID)
	upsertProjectedItem(turn, item)
	thread.UpdatedAtUnixS = time.Now().Unix()
	itemCopy := cloneItem(item)
	m.appendEventLocked(state, Event{
		Type:     "item_completed",
		ThreadID: threadID,
		TurnID:   turnID,
		ItemID:   item.ID,
		Item:     &itemCopy,
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
	state.liveLoaded = true
	if thread := ensureProjectedThread(state, record.request.ThreadID); thread != nil {
		thread.UpdatedAtUnixS = time.Now().Unix()
	}
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

func (m *Manager) resolveBinaryPath() (string, error) {
	m.mu.Lock()
	current := strings.TrimSpace(m.binaryPath)
	m.mu.Unlock()
	if current != "" {
		return current, nil
	}
	if path := strings.TrimSpace(lookPathFromLoginShell("codex")); path != "" {
		return path, nil
	}
	path, err := exec.LookPath("codex")
	if err != nil {
		return "", fmtUnavailable()
	}
	return path, nil
}

func lookPathFromLoginShell(binaryName string) string {
	binaryName = strings.TrimSpace(binaryName)
	if binaryName == "" {
		return ""
	}
	out, err := exec.Command("bash", "-lc", `type -P "$0"`, binaryName).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
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
	state.lastAppliedSeq++
	ev.Seq = state.lastAppliedSeq
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
		Thread:            cloneThread(thread),
		RuntimeConfig:     state.runtimeConfig,
		TokenUsage:        cloneThreadTokenUsage(state.tokenUsage),
		LastAppliedSeq:    state.lastAppliedSeq,
		ActiveStatus:      thread.Status,
		ActiveStatusFlags: append([]string(nil), thread.ActiveFlags...),
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

func fmtUnavailable() error {
	return errors.Join(ErrUnavailable, errors.New("host codex binary not found on PATH; install Codex on this machine and ensure `codex` is available"))
}

func normalizeApprovalPolicyRequest(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "untrusted", "unlesstrusted":
		return "untrusted"
	case "on-failure", "onfailure":
		return "on-failure"
	case "on-request", "onrequest":
		return "on-request"
	case "never":
		return "never"
	default:
		return ""
	}
}

func normalizeSandboxModeRequest(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "read-only", "readonly":
		return "read-only"
	case "workspace-write", "workspacewrite":
		return "workspace-write"
	case "danger-full-access", "dangerfullaccess":
		return "danger-full-access"
	default:
		return ""
	}
}

func normalizeApprovalsReviewer(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "user":
		return "user"
	case "guardian_subagent", "guardiansubagent":
		return "guardian_subagent"
	default:
		return ""
	}
}

func buildSandboxPolicyRequest(mode string) *wireSandboxPolicy {
	switch normalizeSandboxModeRequest(mode) {
	case "read-only":
		return &wireSandboxPolicy{Type: "readOnly"}
	case "workspace-write":
		return &wireSandboxPolicy{
			Type:                "workspaceWrite",
			WritableRoots:       []string{},
			NetworkAccess:       false,
			ExcludeTmpdirEnvVar: false,
			ExcludeSlashTmp:     false,
		}
	case "danger-full-access":
		return &wireSandboxPolicy{Type: "dangerFullAccess"}
	default:
		return nil
	}
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
