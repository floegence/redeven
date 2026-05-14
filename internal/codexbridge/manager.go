package codexbridge

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/floegence/redeven/internal/diagnostics"
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
	Shell        string
	Diagnostics  *diagnostics.Store
}

type Manager struct {
	log          *slog.Logger
	agentHomeDir string
	shell        string
	diag         *diagnostics.Store

	startMu sync.Mutex
	mu      sync.Mutex

	proc       *appServerProcess
	lastError  string
	binaryPath string
	threads    map[string]*threadState

	nextCallID       atomic.Int64
	nextSubscriberID atomic.Int64
	runtimeEpoch     atomic.Int64
}

type threadState struct {
	thread         *Thread
	runtimeConfig  ThreadRuntimeConfig
	tokenUsage     *ThreadTokenUsage
	lastAppliedSeq int64
	liveLoaded     bool
	events         []Event
	stream         ThreadStreamState
	pending        map[string]*pendingRequestRecord
	subscribers    map[int64]*threadSubscriber
}

type threadSubscriber struct {
	id              int64
	ch              chan Event
	afterSeq        int64
	createdAtUnixMs int64
	lagDropped      int64
}

type pendingRequestRecord struct {
	request         PendingRequest
	rawID           json.RawMessage
	requestedPerms  *PermissionProfile
	additionalPerms *PermissionProfile
}

const (
	threadEventRetentionLimit = 400
	threadSubscriberBuffer    = 64
)

func isBestEffortEvent(eventType string) bool {
	switch strings.TrimSpace(eventType) {
	case "command_output_delta", "file_change_delta", "thread_token_usage_updated":
		return true
	default:
		return false
	}
}

func (m *Manager) runtimeEpochValue() int64 {
	if m == nil {
		return 1
	}
	if epoch := m.runtimeEpoch.Load(); epoch > 0 {
		return epoch
	}
	return 1
}

func (m *Manager) ensureThreadStreamStateLocked(state *threadState) {
	if state == nil {
		return
	}
	if state.stream.StreamEpoch <= 0 {
		state.stream.StreamEpoch = m.runtimeEpochValue()
	}
	state.stream.LastAppliedSeq = state.lastAppliedSeq
	switch len(state.events) {
	case 0:
		if state.lastAppliedSeq <= 0 {
			state.stream.OldestRetainedSeq = 0
		} else {
			state.stream.OldestRetainedSeq = state.lastAppliedSeq + 1
		}
	default:
		state.stream.OldestRetainedSeq = state.events[0].Seq
	}
}

func (m *Manager) logStreamDiagnostic(kind string, message string, detail map[string]any) {
	if m == nil || m.diag == nil || !m.diag.Enabled() {
		return
	}
	m.diag.Append(diagnostics.Event{
		Scope:   diagnostics.ScopeCodexBridge,
		Kind:    strings.TrimSpace(kind),
		Message: strings.TrimSpace(message),
		Detail:  detail,
	})
}

func (m *Manager) invalidateLiveThreadsLocked() {
	for _, state := range m.threads {
		if state != nil {
			state.liveLoaded = false
		}
	}
}

func isThreadNotFoundError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, ErrThreadNotFound) {
		return true
	}
	if rpcErr, ok := asRPCMethodError(err); ok {
		message := strings.ToLower(strings.TrimSpace(rpcErr.Message))
		if strings.Contains(message, "thread not found") {
			return true
		}
		method := strings.ToLower(strings.TrimSpace(rpcErr.Method))
		if (method == "turn/start" || method == "thread/resume" || method == "thread/read") && strings.Contains(message, "not found") {
			return true
		}
	}
	return strings.Contains(strings.ToLower(err.Error()), "thread not found")
}

func isThreadNotMaterializedError(err error) bool {
	if err == nil {
		return false
	}
	lowerMessage := strings.ToLower(strings.TrimSpace(err.Error()))
	if strings.Contains(lowerMessage, "not materialized yet") &&
		strings.Contains(lowerMessage, "before first user message") {
		return true
	}
	rpcErr, ok := asRPCMethodError(err)
	if !ok {
		return false
	}
	method := strings.ToLower(strings.TrimSpace(rpcErr.Method))
	if method != "thread/read" {
		return false
	}
	message := strings.ToLower(strings.TrimSpace(rpcErr.Message))
	return strings.Contains(message, "not materialized yet") &&
		(strings.Contains(message, "includeturns is unavailable") ||
			strings.Contains(message, "before first user message"))
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
	manager := &Manager{
		log:          logger,
		agentHomeDir: agentHomeDir,
		shell:        strings.TrimSpace(opts.Shell),
		diag:         opts.Diagnostics,
		threads:      make(map[string]*threadState),
	}
	return manager, nil
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

func (m *Manager) ListThreads(ctx context.Context, req ListThreadsRequest) ([]Thread, error) {
	limit := req.Limit
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	var resp wireThreadListResponse
	if err := m.call(ctx, "thread/list", wireThreadListParams{
		Limit:    limit,
		SortKey:  "updated_at",
		Archived: req.Archived,
	}, &resp); err != nil {
		return nil, err
	}
	out := make([]Thread, 0, len(resp.Data))
	for i := range resp.Data {
		out = append(out, normalizeThread(resp.Data[i]))
	}
	return out, nil
}

func (m *Manager) readThreadSnapshot(ctx context.Context, threadID string, includeTurns bool) (Thread, error) {
	var resp wireThreadReadResponse
	if err := m.call(ctx, "thread/read", wireThreadReadParams{
		ThreadID:     threadID,
		IncludeTurns: includeTurns,
	}, &resp); err != nil {
		return Thread{}, err
	}
	return normalizeThread(resp.Thread), nil
}

func (m *Manager) ReadThread(ctx context.Context, threadID string) (*ThreadDetail, error) {
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return nil, ErrThreadNotFound
	}
	thread, err := m.readThreadSnapshot(ctx, threadID, true)
	if err != nil {
		if isThreadNotFoundError(err) {
			return nil, ErrThreadNotFound
		}
		if !isThreadNotMaterializedError(err) {
			return nil, err
		}
		thread, err = m.readThreadSnapshot(ctx, threadID, false)
		if err != nil {
			if isThreadNotFoundError(err) {
				return nil, ErrThreadNotFound
			}
			return nil, err
		}
	}
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
		if isThreadNotFoundError(err) {
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
		Operations:      defaultCapabilityOperations(),
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
	inputs := buildWireUserInputs(req.InputText, req.Inputs)
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
		if !isThreadNotFoundError(err) {
			return nil, wrapTurnCallError("turn/start", err)
		}
		m.mu.Lock()
		if state := m.threads[threadID]; state != nil {
			state.liveLoaded = false
		}
		m.mu.Unlock()
		if loadErr := m.ensureThreadLoaded(ctx, threadID); loadErr != nil {
			return nil, loadErr
		}
		if retryErr := m.call(ctx, "turn/start", params, &resp); retryErr != nil {
			if isThreadNotFoundError(retryErr) {
				return nil, ErrThreadNotFound
			}
			return nil, wrapTurnCallError("turn/start", retryErr)
		}
	}
	turn := normalizeTurn(resp.Turn)
	applyTurnSteerability(&turn, "regular", true)
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

func (m *Manager) SteerTurn(ctx context.Context, req SteerTurnRequest) (*Turn, error) {
	threadID := strings.TrimSpace(req.ThreadID)
	expectedTurnID := strings.TrimSpace(req.ExpectedTurnID)
	if threadID == "" || expectedTurnID == "" {
		return nil, ErrThreadNotFound
	}
	if err := m.ensureThreadLoaded(ctx, threadID); err != nil {
		return nil, err
	}
	inputs := buildWireUserInputs("", req.Inputs)
	if len(inputs) == 0 {
		return nil, errors.New("missing inputs")
	}
	var resp wireTurnSteerResponse
	params := wireTurnSteerParams{
		ThreadID:       threadID,
		Input:          inputs,
		ExpectedTurnID: expectedTurnID,
	}
	if err := m.call(ctx, "turn/steer", params, &resp); err != nil {
		if isThreadNotFoundError(err) {
			return nil, ErrThreadNotFound
		}
		return nil, wrapTurnCallError("turn/steer", err)
	}
	turn := Turn{
		ID:     strings.TrimSpace(resp.TurnID),
		Status: "in_progress",
	}
	applyTurnSteerability(&turn, "regular", true)
	m.mu.Lock()
	state := m.ensureThreadStateLocked(threadID)
	thread := ensureProjectedThread(state, threadID)
	upsertProjectedTurn(thread, turn)
	thread.UpdatedAtUnixS = time.Now().Unix()
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

func (m *Manager) UnarchiveThread(ctx context.Context, threadID string) error {
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return ErrThreadNotFound
	}
	var resp wireThreadUnarchiveResponse
	if err := m.call(ctx, "thread/unarchive", wireThreadUnarchiveParams{ThreadID: threadID}, &resp); err != nil {
		if isThreadNotFoundError(err) {
			return ErrThreadNotFound
		}
		return err
	}
	thread := normalizeThread(resp.Thread)
	m.mu.Lock()
	state := m.ensureThreadStateLocked(threadID)
	projectedThread := mergeProjectedThread(state, thread)
	projectedThread.Status = "notLoaded"
	projectedThread.ActiveFlags = nil
	projectedThread.UpdatedAtUnixS = time.Now().Unix()
	state.thread = &projectedThread
	state.liveLoaded = false
	m.mu.Unlock()
	return nil
}

func (m *Manager) ForkThread(ctx context.Context, req ForkThreadRequest) (*ThreadDetail, error) {
	threadID := strings.TrimSpace(req.ThreadID)
	if threadID == "" {
		return nil, ErrThreadNotFound
	}
	approvalPolicy := normalizeApprovalPolicyRequest(req.ApprovalPolicy)
	sandboxMode := normalizeSandboxModeRequest(req.SandboxMode)
	approvalsReviewer := normalizeApprovalsReviewer(req.ApprovalsReviewer)
	params := wireThreadForkParams{
		ThreadID:               threadID,
		Model:                  stringPtr(req.Model),
		PersistExtendedHistory: true,
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
	var resp wireThreadForkResponse
	if err := m.call(ctx, "thread/fork", params, &resp); err != nil {
		if isThreadNotFoundError(err) {
			return nil, ErrThreadNotFound
		}
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
	state.liveLoaded = isLoadedThreadStatus(thread.Status)
	detail := m.buildThreadDetailLocked(state, thread)
	m.mu.Unlock()
	return &detail, nil
}

func (m *Manager) InterruptTurn(ctx context.Context, req InterruptTurnRequest) error {
	threadID := strings.TrimSpace(req.ThreadID)
	turnID := strings.TrimSpace(req.TurnID)
	if threadID == "" || turnID == "" {
		return ErrThreadNotFound
	}
	if err := m.call(ctx, "turn/interrupt", wireTurnInterruptParams{
		ThreadID: threadID,
		TurnID:   turnID,
	}, nil); err != nil {
		if isThreadNotFoundError(err) {
			return ErrThreadNotFound
		}
		return err
	}
	m.mu.Lock()
	if state := m.threads[threadID]; state != nil {
		thread := ensureProjectedThread(state, threadID)
		thread.UpdatedAtUnixS = time.Now().Unix()
	}
	m.mu.Unlock()
	return nil
}

func (m *Manager) StartReview(ctx context.Context, req StartReviewRequest) (*ThreadDetail, error) {
	threadID := strings.TrimSpace(req.ThreadID)
	if threadID == "" {
		return nil, ErrThreadNotFound
	}
	if err := m.ensureThreadLoaded(ctx, threadID); err != nil {
		return nil, err
	}
	var resp wireReviewStartResponse
	if err := m.call(ctx, "review/start", wireReviewStartParams{
		ThreadID: threadID,
		Target: wireReviewTarget{
			Type: normalizeReviewTarget(req.Target),
		},
	}, &resp); err != nil {
		if isThreadNotFoundError(err) {
			return nil, ErrThreadNotFound
		}
		return nil, wrapTurnCallError("review/start", err)
	}
	reviewThreadID := strings.TrimSpace(resp.ReviewThreadID)
	if reviewThreadID != "" && reviewThreadID != threadID {
		return m.ReadThread(ctx, reviewThreadID)
	}
	turn := normalizeTurn(resp.Turn)
	applyTurnSteerability(&turn, "review", false)
	m.mu.Lock()
	state := m.ensureThreadStateLocked(threadID)
	thread := ensureProjectedThread(state, threadID)
	upsertProjectedTurn(thread, turn)
	thread.UpdatedAtUnixS = time.Now().Unix()
	detail := m.buildThreadDetailLocked(state, *thread)
	m.mu.Unlock()
	return &detail, nil
}

func (m *Manager) SubscribeThreadEvents(ctx context.Context, threadID string, afterSeq int64) ([]Event, <-chan Event, error) {
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return nil, nil, ErrThreadNotFound
	}
	m.mu.Lock()
	state := m.ensureThreadStateLocked(threadID)
	m.ensureThreadStreamStateLocked(state)
	desynced := afterSeq > 0 && state.stream.OldestRetainedSeq > 0 && afterSeq < state.stream.OldestRetainedSeq-1
	lastAppliedSeq := state.lastAppliedSeq
	oldestRetainedSeq := state.stream.OldestRetainedSeq
	streamEpoch := state.stream.StreamEpoch
	snapshot := make([]Event, 0, len(state.events))
	if desynced {
		stream := cloneThreadStreamState(state.stream)
		snapshot = append(snapshot, Event{
			Seq:      afterSeq,
			Type:     "stream_desynced",
			ThreadID: threadID,
			Stream:   &stream,
			Transport: &EventTransport{
				State:         "desynced",
				Reason:        "requested sequence is older than the retained event window",
				ResetRequired: true,
			},
		})
	} else {
		for _, ev := range state.events {
			if ev.Seq > afterSeq {
				snapshot = append(snapshot, ev)
			}
		}
	}
	if desynced {
		m.mu.Unlock()
		ch := make(chan Event)
		close(ch)
		m.logStreamDiagnostic("subscription_desynced", "codex thread stream continuity was lost before subscribe", map[string]any{
			"thread_id":           threadID,
			"after_seq":           afterSeq,
			"last_applied_seq":    lastAppliedSeq,
			"oldest_retained_seq": oldestRetainedSeq,
			"stream_epoch":        streamEpoch,
		})
		return snapshot, ch, nil
	}
	subID := m.nextSubscriberID.Add(1)
	ch := make(chan Event, threadSubscriberBuffer)
	state.subscribers[subID] = &threadSubscriber{
		id:              subID,
		ch:              ch,
		afterSeq:        afterSeq,
		createdAtUnixMs: time.Now().UnixMilli(),
	}
	m.mu.Unlock()
	m.logStreamDiagnostic("subscription_started", "codex thread subscriber attached", map[string]any{
		"thread_id":           threadID,
		"subscriber_id":       subID,
		"after_seq":           afterSeq,
		"snapshot_events":     len(snapshot),
		"last_applied_seq":    lastAppliedSeq,
		"oldest_retained_seq": oldestRetainedSeq,
		"stream_epoch":        streamEpoch,
	})

	go func() {
		<-ctx.Done()
		m.mu.Lock()
		state := m.threads[threadID]
		if state != nil {
			if existing, ok := state.subscribers[subID]; ok && existing != nil {
				delete(state.subscribers, subID)
				close(existing.ch)
			}
		}
		m.mu.Unlock()
		m.logStreamDiagnostic("subscription_closed", "codex thread subscriber closed", map[string]any{
			"thread_id":     threadID,
			"subscriber_id": subID,
			"after_seq":     afterSeq,
		})
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
		if _, ok := asRPCMethodError(err); ok {
			return err
		}
		m.recordError(err)
		m.mu.Lock()
		if m.proc == proc {
			m.proc = nil
			m.invalidateLiveThreadsLocked()
		}
		m.mu.Unlock()
		m.logStreamDiagnostic("runtime_call_failed", "codex app-server transport call failed", map[string]any{
			"method": method,
			"error":  err.Error(),
		})
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
			m.invalidateLiveThreadsLocked()
			m.logStreamDiagnostic("runtime_disconnected", "codex app-server process exited", map[string]any{
				"error": err.Error(),
			})
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
	proc, err := startAppServerProcess(m.log, m.shell, binaryPath, m.handleEnvelope)
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
	nextEpoch := m.runtimeEpoch.Add(1)
	m.proc = proc
	m.binaryPath = binaryPath
	m.lastError = ""
	for _, state := range m.threads {
		if state == nil {
			continue
		}
		state.stream.StreamEpoch = nextEpoch
		m.ensureThreadStreamStateLocked(state)
	}
	m.mu.Unlock()
	m.logStreamDiagnostic("runtime_connected", "codex app-server process connected", map[string]any{
		"binary_path":   binaryPath,
		"runtime_epoch": nextEpoch,
	})
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
			item := normalizeProjectedItemForLifecycle(normalizeItem(msg.Item), projectedItemLifecycleStarted)
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
			item := normalizeProjectedItemForLifecycle(normalizeItem(msg.Item), projectedItemLifecycleCompleted)
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
			m.evictPendingRequestsLocked(state, threadID)
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
	item = normalizeProjectedItemForLifecycle(item, projectedItemLifecycleCompleted)
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

func (m *Manager) evictPendingRequestsLocked(state *threadState, threadID string) {
	if state == nil || len(state.pending) == 0 {
		return
	}
	requestIDs := make([]string, 0, len(state.pending))
	for requestID := range state.pending {
		requestIDs = append(requestIDs, requestID)
	}
	sort.Strings(requestIDs)
	for _, requestID := range requestIDs {
		delete(state.pending, requestID)
		m.appendEventLocked(state, Event{
			Type:      "request_evicted",
			ThreadID:  threadID,
			RequestID: requestID,
		})
	}
	m.logStreamDiagnostic("requests_evicted", "codex thread pending requests were evicted from projected state", map[string]any{
		"thread_id":        threadID,
		"evicted_count":    len(requestIDs),
		"request_ids":      requestIDs,
		"last_applied_seq": state.lastAppliedSeq,
		"stream_epoch":     state.stream.StreamEpoch,
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
	if path := strings.TrimSpace(lookPathFromLoginShell(m.shell, "codex")); path != "" {
		return path, nil
	}
	path, err := exec.LookPath("codex")
	if err != nil {
		return "", fmtUnavailable()
	}
	return path, nil
}

func lookPathFromLoginShell(shell string, binaryName string) string {
	binaryName = strings.TrimSpace(binaryName)
	if binaryName == "" {
		return ""
	}
	shellPath, err := resolveInteractiveLoginShell(shell)
	if err != nil {
		return ""
	}
	out, err := exec.Command(shellPath, "-l", "-i", "-c", `type -P "$0"`, binaryName).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func (m *Manager) ensureThreadStateLocked(threadID string) *threadState {
	threadID = strings.TrimSpace(threadID)
	state := m.threads[threadID]
	if state != nil {
		m.ensureThreadStreamStateLocked(state)
		return state
	}
	state = &threadState{
		pending:     make(map[string]*pendingRequestRecord),
		subscribers: make(map[int64]*threadSubscriber),
		stream: ThreadStreamState{
			StreamEpoch: m.runtimeEpochValue(),
		},
	}
	m.ensureThreadStreamStateLocked(state)
	m.threads[threadID] = state
	return state
}

func (m *Manager) appendEventLocked(state *threadState, ev Event) {
	if state == nil {
		return
	}
	state.lastAppliedSeq++
	ev.Seq = state.lastAppliedSeq
	nowUnixMs := time.Now().UnixMilli()
	state.stream.LastEventAtUnixMs = nowUnixMs
	state.events = append(state.events, ev)
	if len(state.events) > threadEventRetentionLimit {
		state.events = append([]Event(nil), state.events[len(state.events)-threadEventRetentionLimit:]...)
	}
	m.ensureThreadStreamStateLocked(state)
	streamCopy := cloneThreadStreamState(state.stream)
	ev.Stream = &streamCopy
	state.events[len(state.events)-1].Stream = &streamCopy
	// Best-effort deltas may be dropped for a backpressured subscriber, but
	// lossless events force a detach so the browser can rebind explicitly.
	for id, subscriber := range state.subscribers {
		if subscriber == nil {
			delete(state.subscribers, id)
			continue
		}
		deliver := ev
		if subscriber.lagDropped > 0 {
			deliver.Transport = &EventTransport{
				State:         "lagged",
				Reason:        "best-effort stream events were dropped while the subscriber was backpressured",
				DroppedEvents: subscriber.lagDropped,
			}
		}
		select {
		case subscriber.ch <- deliver:
			if subscriber.lagDropped > 0 {
				m.logStreamDiagnostic("subscriber_recovered", "codex thread subscriber recovered after backpressure", map[string]any{
					"thread_id":        ev.ThreadID,
					"subscriber_id":    subscriber.id,
					"after_seq":        subscriber.afterSeq,
					"dropped_events":   subscriber.lagDropped,
					"last_applied_seq": state.lastAppliedSeq,
					"stream_epoch":     state.stream.StreamEpoch,
				})
				subscriber.lagDropped = 0
			}
		default:
			if isBestEffortEvent(ev.Type) {
				subscriber.lagDropped++
				if subscriber.lagDropped == 1 {
					m.logStreamDiagnostic("subscriber_lagged", "codex thread subscriber started dropping best-effort events", map[string]any{
						"thread_id":           ev.ThreadID,
						"subscriber_id":       subscriber.id,
						"after_seq":           subscriber.afterSeq,
						"event_type":          ev.Type,
						"last_applied_seq":    state.lastAppliedSeq,
						"oldest_retained_seq": state.stream.OldestRetainedSeq,
						"stream_epoch":        state.stream.StreamEpoch,
					})
				}
				continue
			}
			close(subscriber.ch)
			delete(state.subscribers, id)
			m.logStreamDiagnostic("subscriber_desynced", "codex thread subscriber was detached after lossless event backpressure", map[string]any{
				"thread_id":           ev.ThreadID,
				"subscriber_id":       subscriber.id,
				"after_seq":           subscriber.afterSeq,
				"event_type":          ev.Type,
				"lag_dropped_events":  subscriber.lagDropped,
				"last_applied_seq":    state.lastAppliedSeq,
				"oldest_retained_seq": state.stream.OldestRetainedSeq,
				"stream_epoch":        state.stream.StreamEpoch,
			})
		}
	}
}

func (m *Manager) buildThreadDetailLocked(state *threadState, thread Thread) ThreadDetail {
	m.ensureThreadStreamStateLocked(state)
	out := ThreadDetail{
		Thread:            cloneThread(thread),
		RuntimeConfig:     state.runtimeConfig,
		TokenUsage:        cloneThreadTokenUsage(state.tokenUsage),
		LastAppliedSeq:    state.lastAppliedSeq,
		Stream:            cloneThreadStreamState(state.stream),
		ActiveStatus:      thread.Status,
		ActiveStatusFlags: append([]string(nil), thread.ActiveFlags...),
	}
	if len(state.pending) > 0 {
		out.PendingRequests = make([]PendingRequest, 0, len(state.pending))
		for _, req := range state.pending {
			out.PendingRequests = append(out.PendingRequests, req.request)
		}
		sort.Slice(out.PendingRequests, func(i, j int) bool {
			return out.PendingRequests[i].ID < out.PendingRequests[j].ID
		})
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
	return errors.Join(ErrUnavailable, errors.New("host codex binary not found on PATH; install Codex on this host and ensure `codex` is available"))
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

func normalizeReviewTarget(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "", "uncommitted_changes", "uncommittedchanges":
		return "uncommittedChanges"
	default:
		return "uncommittedChanges"
	}
}

func defaultCapabilityOperations() []OperationName {
	return []OperationName{
		OperationThreadArchive,
		OperationThreadFork,
		OperationTurnSteer,
		OperationTurnInterrupt,
		OperationReviewStart,
	}
}

func applyTurnSteerability(turn *Turn, kind string, acceptsSteer bool) {
	if turn == nil {
		return
	}
	if normalizedKind := strings.TrimSpace(kind); normalizedKind != "" {
		turn.Kind = normalizedKind
	}
	turn.AcceptsSteer = boolPtr(acceptsSteer)
}

func buildWireUserInputs(inputText string, entries []UserInputEntry) []wireUserInput {
	out := make([]wireUserInput, 0, len(entries)+1)
	if text := strings.TrimSpace(inputText); text != "" {
		out = append(out, wireUserInput{
			Type: "text",
			Text: text,
		})
	}
	for i := range entries {
		inputType := strings.TrimSpace(entries[i].Type)
		if inputType == "" {
			continue
		}
		entry := wireUserInput{
			Type: inputType,
			Text: strings.TrimSpace(entries[i].Text),
			URL:  strings.TrimSpace(entries[i].URL),
			Path: strings.TrimSpace(entries[i].Path),
			Name: strings.TrimSpace(entries[i].Name),
		}
		out = append(out, entry)
	}
	return out
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

func boolPtr(v bool) *bool {
	out := v
	return &out
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
