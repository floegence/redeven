package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/floegence/floret/observation"
	"github.com/floegence/redeven/internal/ai/threadstore"
	aitools "github.com/floegence/redeven/internal/ai/tools"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/okf"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/websearch"
)

type runOptions struct {
	Log             *slog.Logger
	StateDir        string
	AgentHomeDir    string
	WorkingDir      string
	FilesystemScope *filesystemscope.Registry
	Shell           string

	AIConfig *config.AIConfig

	SessionMeta         *session.Meta
	ResolveProviderKey  func(providerID string) (string, bool, error)
	ResolveWebSearchKey func(providerID string) (string, bool, error)
	DesktopModelSource  *desktopModelSourceClient

	RunID        string
	ChannelID    string
	EndpointID   string
	ThreadID     string
	UserPublicID string
	MessageID    string

	MaxWallTime         time.Duration
	IdleTimeout         time.Duration
	ToolApprovalTimeout time.Duration
	StreamWriteTimeout  time.Duration

	UploadsDir       string
	ThreadsDB        *threadstore.Store
	PersistOpTimeout time.Duration

	OnStreamEvent func(any)
	Writer        http.ResponseWriter

	SubagentDepth         int
	AllowSubagentDelegate bool
	ToolAllowlist         []string
	ForceReadonlyExec     bool
	NoUserInteraction     bool
	SkillManager          *skillManager
	ToolTargetPolicy      ToolTargetPolicy
	TargetToolExecutor    TargetToolExecutor

	terminalExecRunner func(ctx context.Context, inv terminalExecInvocation) (terminalExecOutcome, error)
}

type run struct {
	log *slog.Logger

	stateDir     string
	agentHomeDir string
	workingDir   string
	scope        *filesystemscope.Registry
	shell        string
	cfg          *config.AIConfig
	runMode      string

	sessionMeta         *session.Meta
	resolveProviderKey  func(providerID string) (string, bool, error)
	resolveWebSearchKey func(providerID string) (string, bool, error)
	desktopModelSource  *desktopModelSourceClient

	id           string
	channelID    string
	endpointID   string
	threadID     string
	userPublicID string
	messageID    string

	maxWallTime    time.Duration
	idleTimeout    time.Duration
	toolApprovalTO time.Duration
	activityCh     chan struct{}
	doneCh         chan struct{}
	doneOnce       sync.Once

	muCancel           sync.Mutex
	cancelReason       string // "canceled"|"timed_out"|""
	endReason          string // "complete"|"canceled"|"timed_out"|"disconnected"|"error"
	runErrorCode       string
	cancelRequested    bool
	cancelFn           context.CancelFunc
	detached           atomic.Bool // hard-canceled: stop emitting realtime events and skip thread state updates
	busyCount          atomic.Int32
	runtimeToolCalls   atomic.Int64
	runtimeTokens      atomic.Int64
	assistantPersisted atomic.Bool

	uploadsDir       string
	threadsDB        *threadstore.Store
	persistOpTimeout time.Duration

	onStreamEvent func(any)
	w             http.ResponseWriter
	stream        *ndjsonStream

	mu              sync.Mutex
	toolApprovals   map[string]*toolApprovalRequest
	waitingApproval bool

	muLifecycle         sync.Mutex
	lastLifecyclePhase  string
	lastLifecycleAt     time.Time
	lifecycleMinEmitGap time.Duration

	nextBlockIndex            int
	currentTextBlockIndex     int
	needNewTextBlock          bool
	currentThinkingBlockIndex int
	needNewThinkingBlock      bool
	activitySegmentActive     bool
	activitySegmentBlockIndex int

	muAssistant               sync.Mutex
	assistantCreatedAtUnixMs  int64
	assistantBlocks           []any
	assistantAnswer           assistantAnswerState
	activitySegmentEvents     []observation.Event
	activityTimelineProjected bool
	activityFileActions       map[string]FlowerActivityFileAction
	activityFileActionSeq     int64
	waitingPrompt             *RequestUserInputPrompt
	providerContinuation      threadstore.ThreadProviderContinuation

	finalizationReason string
	currentModelID     string

	webSearchToolEnabled bool
	webSearchMode        string

	collectedWebSources            map[string]SourceRef // url -> source
	collectedWebSourceOrder        []string
	sourcesActivityAlreadyRecorded bool

	subagentDepth         int
	allowSubagentDelegate bool
	toolAllowlist         map[string]struct{}
	forceReadonlyExec     bool
	noUserInteraction     bool
	toolTargetPolicy      ToolTargetPolicy
	targetToolExecutor    TargetToolExecutor

	skillManager    *skillManager
	subagentManager *subagentManager

	terminalExecRunner func(ctx context.Context, inv terminalExecInvocation) (terminalExecOutcome, error)
}

type assistantAnswerState struct {
	CanonicalMarkdown string
}

type assistantMarkdownUpdate struct {
	index int
	start bool
	block persistedMarkdownBlock
}

type toolApprovalRequest struct {
	decision      chan bool
	toolName      string
	requestedAtMs int64
	expiresAtMs   int64
	resolved      bool
}

func newRun(opts runOptions) *run {
	var runMeta *session.Meta
	if opts.SessionMeta != nil {
		metaCopy := *opts.SessionMeta
		runMeta = &metaCopy
	}

	runID := strings.TrimSpace(opts.RunID)
	if runID == "" {
		if id, err := NewRunID(); err == nil {
			runID = id
		}
	}

	agentHomeDir := strings.TrimSpace(opts.AgentHomeDir)
	workingDir := strings.TrimSpace(opts.WorkingDir)
	if workingDir == "" {
		workingDir = agentHomeDir
	}

	r := &run{
		log:                       opts.Log,
		stateDir:                  strings.TrimSpace(opts.StateDir),
		agentHomeDir:              agentHomeDir,
		workingDir:                workingDir,
		scope:                     opts.FilesystemScope,
		shell:                     strings.TrimSpace(opts.Shell),
		cfg:                       opts.AIConfig,
		sessionMeta:               runMeta,
		resolveProviderKey:        opts.ResolveProviderKey,
		resolveWebSearchKey:       opts.ResolveWebSearchKey,
		desktopModelSource:        opts.DesktopModelSource,
		id:                        runID,
		channelID:                 strings.TrimSpace(opts.ChannelID),
		endpointID:                strings.TrimSpace(opts.EndpointID),
		threadID:                  strings.TrimSpace(opts.ThreadID),
		userPublicID:              strings.TrimSpace(opts.UserPublicID),
		messageID:                 strings.TrimSpace(opts.MessageID),
		uploadsDir:                strings.TrimSpace(opts.UploadsDir),
		threadsDB:                 opts.ThreadsDB,
		persistOpTimeout:          opts.PersistOpTimeout,
		onStreamEvent:             opts.OnStreamEvent,
		w:                         opts.Writer,
		toolApprovals:             make(map[string]*toolApprovalRequest),
		maxWallTime:               opts.MaxWallTime,
		idleTimeout:               opts.IdleTimeout,
		toolApprovalTO:            opts.ToolApprovalTimeout,
		doneCh:                    make(chan struct{}),
		lifecycleMinEmitGap:       600 * time.Millisecond,
		collectedWebSources:       make(map[string]SourceRef),
		collectedWebSourceOrder:   make([]string, 0, 8),
		currentThinkingBlockIndex: -1,
		activitySegmentActive:     false,
		activitySegmentBlockIndex: -1,
		activitySegmentEvents:     make([]observation.Event, 0, 8),
		activityFileActions:       make(map[string]FlowerActivityFileAction),
		subagentDepth:             opts.SubagentDepth,
		forceReadonlyExec:         opts.ForceReadonlyExec,
		toolTargetPolicy:          normalizeToolTargetPolicy(opts.ToolTargetPolicy),
		targetToolExecutor:        opts.TargetToolExecutor,
		skillManager:              opts.SkillManager,
		noUserInteraction:         opts.NoUserInteraction,
		allowSubagentDelegate: func() bool {
			if opts.AllowSubagentDelegate {
				return true
			}
			return opts.SubagentDepth <= 0
		}(),
		terminalExecRunner: opts.terminalExecRunner,
	}
	if r.terminalExecRunner == nil {
		r.terminalExecRunner = defaultTerminalExecRunner
	}
	if r.idleTimeout > 0 {
		r.activityCh = make(chan struct{}, 1)
	}
	if len(opts.ToolAllowlist) > 0 {
		r.toolAllowlist = make(map[string]struct{}, len(opts.ToolAllowlist))
		for _, name := range opts.ToolAllowlist {
			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}
			r.toolAllowlist[name] = struct{}{}
		}
	}
	if opts.Writer != nil {
		r.stream = newNDJSONStream(r.w, opts.StreamWriteTimeout)
	}
	return r
}

func (r *run) touchActivity() {
	if r == nil || r.activityCh == nil {
		return
	}
	select {
	case r.activityCh <- struct{}{}:
	default:
	}
}

func (r *run) beginBusy() func() {
	if r == nil {
		return func() {}
	}
	r.busyCount.Add(1)
	return func() {
		r.busyCount.Add(-1)
	}
}

func (r *run) isBusy() bool {
	if r == nil {
		return false
	}
	return r.busyCount.Load() > 0
}

func (r *run) isWaitingApproval() bool {
	if r == nil {
		return false
	}
	r.mu.Lock()
	v := r.waitingApproval
	r.mu.Unlock()
	return v
}

func (r *run) runIdleWatchdog(ctx context.Context) {
	if r == nil || ctx == nil || r.idleTimeout <= 0 || r.activityCh == nil {
		return
	}
	idleTimer := time.NewTimer(r.idleTimeout)
	defer idleTimer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-r.doneCh:
			return
		case <-r.activityCh:
			if !idleTimer.Stop() {
				select {
				case <-idleTimer.C:
				default:
				}
			}
			idleTimer.Reset(r.idleTimeout)
		case <-idleTimer.C:
			// Waiting for the user is not an "idle" run. That lifecycle is bounded by the
			// per-approval timeout (toolApprovalTO), plus the run's max wall time.
			if r.isWaitingApproval() || r.isBusy() {
				idleTimer.Reset(r.idleTimeout)
				continue
			}
			r.requestCancel("timed_out")
			return
		}
	}
}

func (r *run) requestCancel(reason string) {
	if r == nil {
		return
	}
	reason = strings.TrimSpace(reason)
	r.muCancel.Lock()
	if reason != "" && r.cancelReason == "" {
		r.cancelReason = reason
	}
	alreadyRequested := r.cancelRequested
	r.cancelRequested = true
	cancelFn := r.cancelFn
	r.muCancel.Unlock()
	if alreadyRequested || cancelFn == nil {
		if r.subagentManager != nil {
			r.subagentManager.closeAll()
		}
		return
	}

	// Cancel is a hard instruction:
	// - signal: cancel context immediately to stop new sampling/tool dispatch
	// - grace/force: re-signal after a short delay in case something is stuck
	cancelFn()
	if r.subagentManager != nil {
		r.subagentManager.closeAll()
	}
	go func() {
		timer := time.NewTimer(500 * time.Millisecond)
		defer timer.Stop()
		select {
		case <-r.doneCh:
			return
		case <-timer.C:
			cancelFn()
		}
	}()
}

func (r *run) getCancelReason() string {
	if r == nil {
		return ""
	}
	r.muCancel.Lock()
	v := strings.TrimSpace(r.cancelReason)
	r.muCancel.Unlock()
	return v
}

func (r *run) setEndReason(reason string) {
	if r == nil {
		return
	}
	r.muCancel.Lock()
	r.endReason = strings.TrimSpace(reason)
	r.muCancel.Unlock()
}

func (r *run) setRunErrorCode(code string) {
	if r == nil {
		return
	}
	r.muCancel.Lock()
	r.runErrorCode = strings.TrimSpace(code)
	r.muCancel.Unlock()
}

func (r *run) getRunErrorCode() string {
	if r == nil {
		return ""
	}
	r.muCancel.Lock()
	v := strings.TrimSpace(r.runErrorCode)
	r.muCancel.Unlock()
	return v
}

func (r *run) getEndReason() string {
	if r == nil {
		return ""
	}
	r.muCancel.Lock()
	v := strings.TrimSpace(r.endReason)
	r.muCancel.Unlock()
	return v
}

func (r *run) setFinalizationReason(reason string) {
	if r == nil {
		return
	}
	r.muCancel.Lock()
	r.finalizationReason = strings.TrimSpace(reason)
	r.muCancel.Unlock()
}

func (r *run) getFinalizationReason() string {
	if r == nil {
		return ""
	}
	r.muCancel.Lock()
	v := strings.TrimSpace(r.finalizationReason)
	r.muCancel.Unlock()
	return v
}

func (r *run) setProviderContinuationCandidate(cont threadstore.ThreadProviderContinuation) {
	if r == nil {
		return
	}
	r.muAssistant.Lock()
	r.providerContinuation = cont.Normalized()
	r.muAssistant.Unlock()
}

func (r *run) getProviderContinuationCandidate() threadstore.ThreadProviderContinuation {
	if r == nil {
		return threadstore.ThreadProviderContinuation{}
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	return r.providerContinuation.Normalized()
}

func (r *run) recordRuntimeToolCall() {
	if r == nil {
		return
	}
	r.runtimeToolCalls.Add(1)
}

func (r *run) recordRuntimeTurnUsage(usage TurnUsage, estimateTokens int) {
	if r == nil {
		return
	}
	total := usage.InputTokens + usage.OutputTokens + usage.ReasoningTokens
	if total <= 0 && estimateTokens > 0 {
		total = int64(estimateTokens)
	}
	if total <= 0 {
		return
	}
	r.runtimeTokens.Add(total)
}

func (r *run) runtimeStatsSnapshot() (toolCalls int64, tokens int64) {
	if r == nil {
		return 0, 0
	}
	return r.runtimeToolCalls.Load(), r.runtimeTokens.Load()
}

func (r *run) cancel() {
	if r == nil {
		return
	}

	r.muCancel.Lock()
	r.cancelRequested = true
	cancelFn := r.cancelFn
	r.muCancel.Unlock()

	if cancelFn != nil {
		cancelFn()
	}
	if r.subagentManager != nil {
		r.subagentManager.closeAll()
	}

}

func (r *run) markDetached() {
	if r == nil {
		return
	}
	r.detached.Store(true)
}

func (r *run) isDetached() bool {
	if r == nil {
		return true
	}
	return r.detached.Load()
}

func (r *run) sendStreamEvent(ev any) {
	if r == nil || ev == nil {
		return
	}

	r.touchActivity()
	if !r.detached.Load() && r.onStreamEvent != nil {
		r.onStreamEvent(ev)
	}
	if r.stream == nil {
		return
	}
	publicEvent, ok := sanitizePublicStreamEvent(ev)
	if !ok {
		return
	}
	if err := r.stream.send(publicEvent); err != nil {
		if r.log != nil {
			r.log.Debug("ai stream sink write failed", "run_id", r.id, "error", err)
		}
	}
}

func sanitizePublicStreamEvent(ev any) (any, bool) {
	blockSet, ok := ev.(streamEventBlockSet)
	if !ok || !isActivityTimelineBlockValue(blockSet.Block) {
		return ev, true
	}
	block, err := SanitizeActivityTimelineBlockValue(blockSet.Block)
	if err != nil {
		return nil, false
	}
	blockSet.Block = block
	return blockSet, true
}

func isActivityTimelineBlockValue(value any) bool {
	switch v := value.(type) {
	case ActivityTimelineBlock:
		return true
	case *ActivityTimelineBlock:
		return v != nil
	case map[string]any:
		return strings.TrimSpace(anyToString(v["type"])) == activityTimelineBlockType
	default:
		return false
	}
}

func (r *run) markDone() {
	if r == nil || r.doneCh == nil {
		return
	}
	r.doneOnce.Do(func() {
		close(r.doneCh)
	})
}

func (r *run) markAssistantPersisted() {
	if r == nil {
		return
	}
	r.assistantPersisted.Store(true)
}

func (r *run) assistantAlreadyPersisted() bool {
	return r != nil && r.assistantPersisted.Load()
}

func (r *run) debug(event string, attrs ...any) {
	if r == nil || r.log == nil {
		return
	}
	event = strings.TrimSpace(event)
	if event == "" {
		event = "ai.run"
	}
	base := []any{
		"event", event,
		"run_id", strings.TrimSpace(r.id),
		"thread_id", strings.TrimSpace(r.threadID),
		"endpoint_id", strings.TrimSpace(r.endpointID),
		"channel_id", strings.TrimSpace(r.channelID),
	}
	base = append(base, attrs...)
	r.log.Debug("ai run", base...)
}

func normalizeLifecyclePhase(raw string) string {
	phase := strings.TrimSpace(strings.ToLower(raw))
	switch phase {
	case "start", "planning":
		return "planning"
	case "tool_call", "tool", "executing_tools":
		return "executing_tools"
	case "synthesis", "synthesizing":
		return "synthesizing"
	case "end", "finalizing", "finish":
		return "finalizing"
	default:
		if phase == "" {
			return ""
		}
		return phase
	}
}

func (r *run) emitLifecyclePhase(raw string, diag map[string]any) {
	if r == nil {
		return
	}
	phase := normalizeLifecyclePhase(raw)
	if phase == "" {
		return
	}
	now := time.Now()
	r.muLifecycle.Lock()
	if strings.EqualFold(strings.TrimSpace(r.lastLifecyclePhase), phase) && r.lifecycleMinEmitGap > 0 && !r.lastLifecycleAt.IsZero() {
		if now.Sub(r.lastLifecycleAt) < r.lifecycleMinEmitGap {
			r.muLifecycle.Unlock()
			return
		}
	}
	r.lastLifecyclePhase = phase
	r.lastLifecycleAt = now
	r.muLifecycle.Unlock()

	eventDiag := map[string]any{"phase": phase}
	for k, v := range diag {
		eventDiag[k] = v
	}
	r.sendStreamEvent(streamEventLifecyclePhase{
		Type:      "lifecycle-phase",
		MessageID: strings.TrimSpace(r.messageID),
		Phase:     phase,
		Diag:      eventDiag,
	})
}

func errorString(err error) string {
	if err == nil {
		return ""
	}
	return strings.TrimSpace(err.Error())
}

func (r *run) persistTimeout() time.Duration {
	if r == nil {
		return 0
	}
	if r.persistOpTimeout > 0 {
		return r.persistOpTimeout
	}
	return 10 * time.Second
}

func (r *run) persistRunRecord(state RunState, errCode string, errMessage string, startedAt int64, endedAt int64) {
	if r == nil || r.threadsDB == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), r.persistTimeout())
	defer cancel()
	now := time.Now().UnixMilli()
	state = NormalizeRunState(string(state))
	rec := threadstore.RunRecord{
		RunID:           strings.TrimSpace(r.id),
		EndpointID:      strings.TrimSpace(r.endpointID),
		ThreadID:        strings.TrimSpace(r.threadID),
		MessageID:       strings.TrimSpace(r.messageID),
		State:           string(state),
		ErrorCode:       strings.TrimSpace(errCode),
		ErrorMessage:    strings.TrimSpace(errMessage),
		AttemptCount:    1,
		StartedAtUnixMs: startedAt,
		EndedAtUnixMs:   endedAt,
		UpdatedAtUnixMs: now,
	}
	_ = r.threadsDB.UpsertRun(ctx, rec)
}

func (r *run) persistRunEvent(eventType string, streamKind RealtimeStreamKind, payload map[string]any) {
	if r == nil || r.threadsDB == nil {
		return
	}
	eventType = strings.TrimSpace(eventType)
	if eventType == "" {
		return
	}
	if payload == nil {
		payload = map[string]any{}
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), r.persistTimeout())
	defer cancel()
	_ = r.threadsDB.AppendRunEvent(ctx, threadstore.RunEventRecord{
		EndpointID:  strings.TrimSpace(r.endpointID),
		ThreadID:    strings.TrimSpace(r.threadID),
		RunID:       strings.TrimSpace(r.id),
		StreamKind:  string(streamKind),
		EventType:   eventType,
		PayloadJSON: truncateRunes(string(b), 6000),
		AtUnixMs:    time.Now().UnixMilli(),
	})
}

func (r *run) persistToolCall(rec threadstore.ToolCallRecord) {
	if r == nil || r.threadsDB == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), r.persistTimeout())
	defer cancel()
	_ = r.threadsDB.UpsertToolCall(ctx, rec)
}

func executionSpanID(runID string, name string, token string) string {
	runID = strings.TrimSpace(runID)
	name = strings.TrimSpace(name)
	token = strings.TrimSpace(token)
	sum := sha256.Sum256([]byte(runID + "|" + name + "|" + token))
	return "span_" + hex.EncodeToString(sum[:12])
}

func (r *run) persistExecutionSpan(rec threadstore.ExecutionSpanRecord) {
	if r == nil || r.threadsDB == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), r.persistTimeout())
	defer cancel()
	_ = r.threadsDB.UpsertExecutionSpan(ctx, rec)
}

func sanitizeLogText(raw string, maxRunes int) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	cleaned := strings.Map(func(r rune) rune {
		switch {
		case r == '\n', r == '\r', r == '\t':
			return ' '
		case r < 0x20 || r == 0x7f:
			return ' '
		default:
			return r
		}
	}, raw)
	cleaned = strings.Join(strings.Fields(cleaned), " ")
	if maxRunes > 0 {
		rs := []rune(cleaned)
		if len(rs) > maxRunes {
			return string(rs[:maxRunes]) + "... (truncated)"
		}
	}
	return cleaned
}

func isSensitiveLogKey(key string) bool {
	k := strings.ToLower(strings.TrimSpace(key))
	if k == "" {
		return false
	}
	direct := map[string]struct{}{
		"content_utf8":   {},
		"content_base64": {},
		"stdin":          {},
		"api_key":        {},
		"apikey":         {},
		"authorization":  {},
		"cookie":         {},
		"set_cookie":     {},
		"password":       {},
		"secret":         {},
		"token":          {},
	}
	if _, ok := direct[k]; ok {
		return true
	}
	return strings.Contains(k, "token") || strings.Contains(k, "secret") || strings.Contains(k, "password") || strings.Contains(k, "api_key")
}

func redactAnyForLog(key string, in any, depth int) any {
	if depth > 4 {
		return "[omitted]"
	}
	if isSensitiveLogKey(key) {
		switch v := in.(type) {
		case string:
			return fmt.Sprintf("[redacted:%d chars]", utf8.RuneCountInString(v))
		case []byte:
			return fmt.Sprintf("[redacted:%d bytes]", len(v))
		default:
			return "[redacted]"
		}
	}
	switch v := in.(type) {
	case string:
		return sanitizeLogText(v, 200)
	case []byte:
		return fmt.Sprintf("[bytes:%d]", len(v))
	case map[string]any:
		out := make(map[string]any, len(v))
		for k, vv := range v {
			out[k] = redactAnyForLog(k, vv, depth+1)
		}
		return out
	case []any:
		limit := len(v)
		if limit > 8 {
			limit = 8
		}
		out := make([]any, 0, limit+1)
		for i := 0; i < limit; i++ {
			out = append(out, redactAnyForLog("", v[i], depth+1))
		}
		if len(v) > limit {
			out = append(out, fmt.Sprintf("[... %d more items]", len(v)-limit))
		}
		return out
	default:
		return in
	}
}

func redactToolArgsForLog(toolName string, args map[string]any) map[string]any {
	_ = toolName
	if args == nil {
		return map[string]any{}
	}
	out := make(map[string]any, len(args))
	for k, v := range args {
		out[k] = redactAnyForLog(k, v, 0)
	}
	return out
}

func summarizeStdinForPersist(in string) map[string]any {
	if in == "" {
		return map[string]any{"redacted": true, "bytes": 0, "lines": 0}
	}
	lines := 1 + strings.Count(in, "\n")
	return map[string]any{
		"redacted": true,
		"bytes":    len(in),
		"lines":    lines,
	}
}

func redactAnyForPersist(key string, in any, depth int) any {
	if depth > 4 {
		return "[omitted]"
	}
	if strings.EqualFold(strings.TrimSpace(key), "stdin") {
		switch v := in.(type) {
		case string:
			return summarizeStdinForPersist(v)
		case []byte:
			if len(v) == 0 {
				return map[string]any{"redacted": true, "bytes": 0}
			}
			return map[string]any{"redacted": true, "bytes": len(v)}
		default:
			if in == nil {
				return nil
			}
			return "[redacted]"
		}
	}
	if isSensitiveLogKey(key) {
		switch v := in.(type) {
		case string:
			return fmt.Sprintf("[redacted:%d chars]", utf8.RuneCountInString(v))
		case []byte:
			return fmt.Sprintf("[redacted:%d bytes]", len(v))
		default:
			return "[redacted]"
		}
	}
	switch v := in.(type) {
	case string:
		return v
	case []byte:
		return fmt.Sprintf("[bytes:%d]", len(v))
	case map[string]any:
		out := make(map[string]any, len(v))
		for k, vv := range v {
			out[k] = redactAnyForPersist(k, vv, depth+1)
		}
		return out
	case []any:
		limit := len(v)
		if limit > 8 {
			limit = 8
		}
		out := make([]any, 0, limit+1)
		for i := 0; i < limit; i++ {
			out = append(out, redactAnyForPersist("", v[i], depth+1))
		}
		if len(v) > limit {
			out = append(out, fmt.Sprintf("[... %d more items]", len(v)-limit))
		}
		return out
	default:
		return in
	}
}

func redactToolArgsForPersist(toolName string, args map[string]any) map[string]any {
	_ = toolName
	if args == nil {
		return map[string]any{}
	}
	out := make(map[string]any, len(args))
	for k, v := range args {
		out[k] = redactAnyForPersist(k, v, 0)
	}
	return out
}

func previewAnyForLog(v any, maxRunes int) string {
	if maxRunes <= 0 {
		maxRunes = 512
	}
	switch x := v.(type) {
	case string:
		return sanitizeLogText(x, maxRunes)
	case []byte:
		return sanitizeLogText(string(x), maxRunes)
	}
	b, err := json.Marshal(v)
	if err != nil {
		return sanitizeLogText(fmt.Sprintf("<marshal_error:%v>", err), maxRunes)
	}
	return sanitizeLogText(string(b), maxRunes)
}

func (r *run) approveTool(toolID string, approved bool) error {
	if r == nil {
		return errors.New("nil run")
	}
	toolID = strings.TrimSpace(toolID)
	if toolID == "" {
		return errors.New("missing tool_id")
	}

	r.mu.Lock()
	approval := r.toolApprovals[toolID]
	if approval == nil || approval.decision == nil {
		r.mu.Unlock()
		return errors.New("tool not pending approval")
	}
	if approval.resolved {
		r.mu.Unlock()
		return ErrRunChanged
	}
	select {
	case approval.decision <- approved:
		approval.resolved = true
		r.mu.Unlock()
		return nil
	default:
		r.mu.Unlock()
		return ErrRunChanged
	}
}

func (r *run) run(ctx context.Context, req RunRequest) (retErr error) {
	defer r.markDone()
	if r == nil {
		return errors.New("nil run")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	r.setFinalizationReason("")
	startedAt := time.Now()
	r.persistRunRecord(RunStateRunning, "", "", startedAt.UnixMilli(), 0)
	runStartPayload := map[string]any{
		"model":         strings.TrimSpace(req.Model),
		"history_count": len(req.History),
	}
	r.persistRunEvent("run.start", RealtimeStreamKindLifecycle, runStartPayload)
	defer func() {
		endReason := strings.TrimSpace(r.getEndReason())
		if endReason == "" {
			if retErr != nil {
				endReason = "error"
			} else {
				endReason = "complete"
			}
		}
		state := RunStateFailed
		errCode := strings.TrimSpace(r.getRunErrorCode())
		if errCode == "" {
			errCode = string(aitools.ErrorCodeUnknown)
		}
		errMsg := strings.TrimSpace(errorString(retErr))
		eventType := "run.error"
		finalizationReason := strings.TrimSpace(r.getFinalizationReason())
		finalizationClass := classifyFinalizationReason(finalizationReason)
		switch endReason {
		case "complete":
			switch finalizationClass {
			case finalizationClassSuccess:
				state = RunStateSuccess
				errCode = ""
				errMsg = ""
				eventType = "run.end"
			case finalizationClassWaitingUser:
				state = RunStateWaitingUser
				errCode = ""
				errMsg = ""
				eventType = "run.end"
			default:
				state = RunStateFailed
				if errMsg == "" {
					errMsg = "Run ended without a recognized finalization reason."
				}
				eventType = "run.error"
			}
		case "canceled":
			state = RunStateCanceled
			errCode = ""
			errMsg = ""
			eventType = "run.end"
		case "timed_out":
			state = RunStateTimedOut
			if errCode == string(aitools.ErrorCodeUnknown) {
				errCode = string(aitools.ErrorCodeTimeout)
			}
			if errMsg == "" {
				errMsg = "Timed out"
			}
		case "disconnected":
			state = RunStateFailed
			if errMsg == "" {
				errMsg = "Disconnected"
			}
		case "error":
			state = RunStateFailed
		}
		r.persistRunRecord(state, errCode, errMsg, startedAt.UnixMilli(), time.Now().UnixMilli())
		r.persistRunEvent(eventType, RealtimeStreamKindLifecycle, map[string]any{
			"state":               string(state),
			"error_code":          errCode,
			"error":               errMsg,
			"finalization_reason": finalizationReason,
			"finalization_class":  finalizationClass,
		})
		r.debug("ai.run.end",
			"end_reason", endReason,
			"finalization_reason", finalizationReason,
			"finalization_class", finalizationClass,
			"cancel_reason", strings.TrimSpace(r.getCancelReason()),
			"duration_ms", time.Since(startedAt).Milliseconds(),
			"state", string(state),
			"error", sanitizeLogText(errMsg, 256),
		)
	}()
	ctx, cancel := context.WithCancel(ctx)
	r.muCancel.Lock()
	r.cancelFn = cancel
	alreadyCanceled := r.cancelRequested
	r.muCancel.Unlock()
	if alreadyCanceled {
		cancel()
	}
	defer r.cancel()
	if r.stream != nil {
		defer r.stream.close()
	}

	execCtx := ctx
	var cancelMaxWall context.CancelFunc
	if r.maxWallTime > 0 {
		execCtx, cancelMaxWall = context.WithTimeout(execCtx, r.maxWallTime)
		defer cancelMaxWall()
	}
	if r.idleTimeout > 0 && r.activityCh != nil {
		r.touchActivity()
		go r.runIdleWatchdog(execCtx)
	}

	r.ensureAssistantMessageStarted()
	r.emitLifecyclePhase("planning", nil)

	modelID := strings.TrimSpace(req.Model)
	r.currentModelID = modelID
	providerID, _, ok := strings.Cut(modelID, "/")
	providerID = strings.TrimSpace(providerID)
	workingDirAbs, rootErr := r.workingDirAbs()
	if rootErr != nil {
		return r.failRun("AI working directory not configured", rootErr)
	}
	taskObjective := strings.TrimSpace(req.Objective)
	if taskObjective == "" {
		taskObjective = strings.TrimSpace(req.Input.Text)
	}
	r.debug("ai.run.start",
		"model", modelID,
		"max_steps", req.Options.MaxSteps,
		"history_count", len(req.History),
		"attachment_count", len(req.Input.Attachments),
		"input_chars", utf8.RuneCountInString(strings.TrimSpace(req.Input.Text)),
		"objective_chars", utf8.RuneCountInString(strings.TrimSpace(taskObjective)),
		"working_dir_abs", sanitizeLogText(workingDirAbs, 200),
	)
	if isDesktopModelSourceModelID(modelID) {
		if r.desktopModelSource == nil || !r.desktopModelSource.isConnected() {
			return r.failRunWithCode(runErrorCodeProviderUnreachable, "", ErrNotConfigured)
		}
		providerCfg := config.AIProvider{
			ID:   DesktopModelSourceProviderType,
			Name: "Desktop",
			Type: DesktopModelSourceProviderType,
		}
		return r.runNative(execCtx, req, providerCfg, "", strings.TrimSpace(taskObjective), r.desktopModelSource.Provider(modelID))
	}
	if !ok || providerID == "" {
		return r.failRunWithCode(runErrorCodeProviderModelUnavailable, "", fmt.Errorf("invalid model id %q", modelID))
	}
	if r.cfg == nil {
		return r.failRunWithCode(runErrorCodeProviderMissingKey, "", errors.New("ai not configured"))
	}
	var providerCfg *config.AIProvider
	for i := range r.cfg.Providers {
		p := &r.cfg.Providers[i]
		if strings.TrimSpace(p.ID) != providerID {
			continue
		}
		providerCfg = p
		break
	}
	if providerCfg == nil {
		return r.failRunWithCode(runErrorCodeProviderModelUnavailable, "", fmt.Errorf("unknown provider %q", providerID))
	}

	providerDisplay := providerID
	if n := strings.TrimSpace(providerCfg.Name); n != "" {
		providerDisplay = n + " (" + providerID + ")"
	}

	if r.resolveProviderKey == nil {
		return r.failRunWithCode(runErrorCodeProviderMissingKey, "", errors.New("missing provider key resolver"))
	}
	apiKey, ok, err := r.resolveProviderKey(providerID)
	if err != nil {
		return r.failRunWithCode(runErrorCodeProviderMissingKey, "", err)
	}
	if !ok || strings.TrimSpace(apiKey) == "" {
		return r.failRunWithCode(
			runErrorCodeProviderMissingKey,
			fmt.Sprintf("AI provider %q is missing API key. Open Settings to configure it.", providerDisplay),
			fmt.Errorf("missing api key for provider %q", providerID),
		)
	}

	if !r.shouldUseNativeRuntime(providerCfg) {
		return r.failRunWithCode(runErrorCodeProviderModelUnavailable, "", fmt.Errorf("unsupported provider type %q", strings.TrimSpace(providerCfg.Type)))
	}
	return r.runNative(execCtx, req, *providerCfg, strings.TrimSpace(apiKey), strings.TrimSpace(taskObjective))
}

func (r *run) appendTextDelta(delta string) error {
	if r == nil || delta == "" {
		return nil
	}
	if r.needNewTextBlock {
		r.finishActivitySegment()
		idx := r.nextBlockIndex
		r.nextBlockIndex++
		r.currentTextBlockIndex = idx
		r.needNewTextBlock = false
		r.persistSetMarkdownBlock(idx)
		r.sendStreamEvent(streamEventBlockStart{Type: "block-start", MessageID: r.messageID, BlockIndex: idx, BlockType: "markdown"})
	}
	r.needNewThinkingBlock = true
	delta = r.normalizeMarkdownDelta(r.currentTextBlockIndex, delta)
	if delta == "" {
		return nil
	}
	r.persistAppendMarkdownDelta(r.currentTextBlockIndex, delta)
	r.sendStreamEvent(streamEventBlockDelta{Type: "block-delta", MessageID: r.messageID, BlockIndex: r.currentTextBlockIndex, Delta: delta})
	return nil
}

func (r *run) appendThinkingDelta(delta string) error {
	if r == nil || delta == "" {
		return nil
	}
	if r.needNewThinkingBlock || r.currentThinkingBlockIndex < 0 {
		r.finishActivitySegment()
		idx := r.nextBlockIndex
		r.nextBlockIndex++
		r.currentThinkingBlockIndex = idx
		r.needNewThinkingBlock = false
		r.needNewTextBlock = true
		r.currentTextBlockIndex = -1
		r.persistSetThinkingBlock(idx)
		r.sendStreamEvent(streamEventBlockStart{Type: "block-start", MessageID: r.messageID, BlockIndex: idx, BlockType: "thinking"})
	}
	delta = r.normalizeThinkingDelta(r.currentThinkingBlockIndex, delta)
	if delta == "" {
		return nil
	}
	r.persistAppendThinkingDelta(r.currentThinkingBlockIndex, delta)
	r.sendStreamEvent(streamEventBlockDelta{Type: "block-delta", MessageID: r.messageID, BlockIndex: r.currentThinkingBlockIndex, Delta: delta})
	return nil
}

func (r *run) normalizeMarkdownDelta(idx int, delta string) string {
	if r == nil || idx < 0 || delta == "" {
		return delta
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	if idx >= len(r.assistantBlocks) {
		return delta
	}
	b, ok := r.assistantBlocks[idx].(*persistedMarkdownBlock)
	if !ok || b == nil || b.Content == "" {
		return delta
	}
	return trimMarkdownDeltaOverlap(b.Content, delta)
}

func (r *run) normalizeThinkingDelta(idx int, delta string) string {
	if r == nil || idx < 0 || delta == "" {
		return delta
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	if idx >= len(r.assistantBlocks) {
		return delta
	}
	b, ok := r.assistantBlocks[idx].(*persistedThinkingBlock)
	if !ok || b == nil || b.Content == "" {
		return delta
	}
	return trimMarkdownDeltaOverlap(b.Content, delta)
}

func trimMarkdownDeltaOverlap(existing string, delta string) string {
	if existing == "" || delta == "" {
		return delta
	}
	existingRunes := []rune(existing)
	deltaRunes := []rune(delta)
	if len(existingRunes) == 0 || len(deltaRunes) == 0 {
		return delta
	}

	maxOverlap := len(deltaRunes)
	if len(existingRunes) < maxOverlap {
		maxOverlap = len(existingRunes)
	}
	if maxOverlap > 400 {
		maxOverlap = 400
	}
	for overlap := maxOverlap; overlap >= 24; overlap-- {
		if string(existingRunes[len(existingRunes)-overlap:]) == string(deltaRunes[:overlap]) {
			if overlap == len(deltaRunes) {
				return ""
			}
			return string(deltaRunes[overlap:])
		}
	}
	// Keep tiny chunks untouched unless they are exact suffix duplicates.
	if len(deltaRunes) <= 24 && strings.HasSuffix(existing, delta) {
		return ""
	}
	return delta
}

func (r *run) hasNonEmptyAssistantText() bool {
	if r == nil {
		return false
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	for _, blk := range r.assistantBlocks {
		if assistantVisibleTextFromBlock(blk) != "" {
			return true
		}
	}
	return false
}

func normalizeCanonicalMarkdownText(text string) string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	return strings.TrimSpace(text)
}

func (r *run) setCanonicalMarkdownCandidate(text string) {
	if r == nil {
		return
	}
	text = normalizeCanonicalMarkdownText(text)
	if text == "" {
		return
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	if strings.TrimSpace(r.assistantAnswer.CanonicalMarkdown) == text {
		return
	}
	r.assistantAnswer.CanonicalMarkdown = text
}

func (r *run) canonicalMarkdownTextSnapshot(fallback string) string {
	if r == nil {
		return ""
	}
	r.muAssistant.Lock()
	canonical := strings.TrimSpace(r.assistantAnswer.CanonicalMarkdown)
	r.muAssistant.Unlock()
	if canonical == "" {
		return normalizeCanonicalMarkdownText(fallback)
	}
	return canonical
}

func (r *run) markdownBlockIndicesLocked() []int {
	if r == nil {
		return nil
	}
	idxs := make([]int, 0, len(r.assistantBlocks))
	for i, blk := range r.assistantBlocks {
		if _, ok := blk.(*persistedMarkdownBlock); ok {
			idxs = append(idxs, i)
		}
	}
	return idxs
}

func (r *run) trailingMarkdownBlockIndexLocked() int {
	if r == nil {
		return -1
	}
	for i := len(r.assistantBlocks) - 1; i >= 0; i-- {
		blk := r.assistantBlocks[i]
		if blk == nil {
			continue
		}
		if _, ok := blk.(*persistedMarkdownBlock); ok {
			return i
		}
		return -1
	}
	return -1
}

func (r *run) reconcileCanonicalMarkdownMessage(fallback string) bool {
	if r == nil {
		return false
	}
	canonical := r.canonicalMarkdownTextSnapshot(fallback)
	if canonical == "" {
		return false
	}

	r.muAssistant.Lock()
	updates := make([]assistantMarkdownUpdate, 0, 4)

	target := r.trailingMarkdownBlockIndexLocked()
	targetUpdate := assistantMarkdownUpdate{}
	hasTargetUpdate := false
	if target < 0 {
		target = len(r.assistantBlocks)
		r.persistEnsureIndex(target)
		r.assistantBlocks[target] = &persistedMarkdownBlock{Type: "markdown", Content: canonical}
		if r.nextBlockIndex <= target {
			r.nextBlockIndex = target + 1
		}
		targetUpdate = assistantMarkdownUpdate{
			index: target,
			start: true,
			block: persistedMarkdownBlock{Type: "markdown", Content: canonical},
		}
		hasTargetUpdate = true
	} else {
		block, ok := r.assistantBlocks[target].(*persistedMarkdownBlock)
		if !ok || block == nil {
			r.muAssistant.Unlock()
			return false
		}
		if strings.TrimSpace(block.Content) != canonical {
			block.Content = canonical
			targetUpdate = assistantMarkdownUpdate{
				index: target,
				block: persistedMarkdownBlock{Type: "markdown", Content: canonical},
			}
			hasTargetUpdate = true
		}
	}
	for _, idx := range r.markdownBlockIndicesLocked() {
		if idx == target {
			continue
		}
		block, ok := r.assistantBlocks[idx].(*persistedMarkdownBlock)
		if !ok || block == nil || strings.TrimSpace(block.Content) == "" {
			continue
		}
		block.Content = ""
		updates = append(updates, assistantMarkdownUpdate{
			index: idx,
			block: persistedMarkdownBlock{Type: "markdown", Content: ""},
		})
	}
	if hasTargetUpdate {
		updates = append(updates, targetUpdate)
	}
	r.muAssistant.Unlock()

	if len(updates) == 0 {
		return false
	}
	for _, update := range updates {
		if update.start {
			r.sendStreamEvent(streamEventBlockStart{
				Type:       "block-start",
				MessageID:  r.messageID,
				BlockIndex: update.index,
				BlockType:  "markdown",
			})
		}
		r.sendStreamEvent(streamEventBlockSet{
			Type:       "block-set",
			MessageID:  r.messageID,
			BlockIndex: update.index,
			Block:      update.block,
		})
	}
	return true
}

func (r *run) reconcileCanonicalWaitingUserMessage() bool {
	if r == nil {
		return false
	}

	type markdownUpdate struct {
		index int
		block persistedMarkdownBlock
	}

	r.muAssistant.Lock()
	if r.waitingPrompt == nil {
		r.muAssistant.Unlock()
		return false
	}

	updates := make([]markdownUpdate, 0, 4)
	for _, idx := range r.markdownBlockIndicesLocked() {
		block, ok := r.assistantBlocks[idx].(*persistedMarkdownBlock)
		if !ok || block == nil || strings.TrimSpace(block.Content) == "" {
			continue
		}
		block.Content = ""
		updates = append(updates, markdownUpdate{
			index: idx,
			block: persistedMarkdownBlock{Type: "markdown", Content: ""},
		})
	}
	r.muAssistant.Unlock()

	if len(updates) == 0 {
		return false
	}
	for _, update := range updates {
		r.sendStreamEvent(streamEventBlockSet{
			Type:       "block-set",
			MessageID:  r.messageID,
			BlockIndex: update.index,
			Block:      update.block,
		})
	}
	return true
}

func (r *run) sessionMetaForTool() (*session.Meta, error) {
	if r == nil {
		return nil, errors.New("nil run")
	}
	if r.sessionMeta == nil {
		return nil, errors.New("missing run session metadata")
	}
	metaCopy := *r.sessionMeta
	return &metaCopy, nil
}

func (r *run) ensureAssistantErrorMessage(errMsg string) {
	if r == nil {
		return
	}
	if r.hasNonEmptyAssistantText() {
		return
	}
	msg := strings.TrimSpace(errMsg)
	if msg == "" {
		msg = "AI run failed."
	}
	_ = r.appendTextDelta("Run failed: " + msg)
}

func (r *run) failRun(errMsg string, cause error) error {
	return r.failRunWithCode("", errMsg, cause)
}

func (r *run) failRunWithCode(code string, errMsg string, cause error) error {
	if r == nil {
		if cause != nil {
			return cause
		}
		msg := strings.TrimSpace(errMsg)
		if msg == "" {
			msg = "AI error"
		}
		return errors.New(msg)
	}

	code = strings.TrimSpace(code)
	if code == "" {
		code = classifyRunFailureCode(cause, "")
	}
	if code != "" {
		r.setRunErrorCode(code)
	}
	msg := strings.TrimSpace(errMsg)
	if msg == "" && cause != nil {
		msg = strings.TrimSpace(cause.Error())
	}
	msg = userFacingRunError(code, msg)
	if msg == "" {
		msg = "AI error"
	}

	r.ensureAssistantErrorMessage(msg)
	if strings.TrimSpace(r.getFinalizationReason()) == "" {
		r.setFinalizationReason("error")
	}
	r.sendStreamEvent(streamEventError{Type: "error", MessageID: r.messageID, Error: msg})
	r.setEndReason("error")
	r.emitLifecyclePhase("ended", map[string]any{"reason": "error"})
	r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})

	if cause != nil {
		return cause
	}
	return errors.New(msg)
}

func (r *run) finalizeIfContextCanceled(ctx context.Context) bool {
	if r == nil || ctx == nil {
		return false
	}
	ctxErr := ctx.Err()
	if ctxErr == nil {
		return false
	}
	reason := "disconnected"
	switch r.getCancelReason() {
	case "canceled":
		reason = "canceled"
		r.setFinalizationReason("canceled")
		r.setEndReason("canceled")
	case "timed_out":
		reason = "timed_out"
		r.setFinalizationReason("timed_out")
		r.setEndReason("timed_out")
	default:
		if errors.Is(ctxErr, context.DeadlineExceeded) {
			reason = "timed_out"
			r.setFinalizationReason("timed_out")
			r.setEndReason("timed_out")
		} else {
			r.setFinalizationReason("disconnected")
			r.setEndReason("disconnected")
		}
	}
	r.debug("ai.run.context_canceled_before_send", "reason", reason)
	r.emitLifecyclePhase("ended", map[string]any{"reason": reason})
	r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
	return true
}

func requiresApproval(toolName string, args map[string]any) bool {
	return aitools.RequiresApprovalForInvocation(toolName, args)
}

func isMutatingInvocation(toolName string, args map[string]any) bool {
	return aitools.IsMutatingForInvocation(toolName, args)
}

func isDangerousInvocation(toolName string, args map[string]any) bool {
	return aitools.IsDangerousInvocation(toolName, args)
}

func marshalPersistJSON(v any, maxRunes int) string {
	b, err := json.Marshal(v)
	if err != nil || len(b) == 0 {
		return "{}"
	}
	out := strings.TrimSpace(string(b))
	if out == "" {
		return "{}"
	}
	if maxRunes > 0 {
		out = truncateRunes(out, maxRunes)
	}
	return out
}

type toolCallOutcome struct {
	Success        bool
	ToolName       string
	Args           map[string]any
	Result         any
	ToolError      *aitools.ToolError
	RecoveryAction string
}

const (
	toolCallStatusPending = "pending"
	toolCallStatusRunning = "running"
	toolCallStatusSuccess = "success"
	toolCallStatusError   = "error"
)

func (r *run) persistToolCallSnapshot(toolID string, toolName string, status string, args map[string]any, result any, toolErr *aitools.ToolError, recoveryAction string, startedAt time.Time, endedAt time.Time) {
	if r == nil {
		return
	}
	argsPersistLimit := 4000
	resultPersistLimit := 4000
	argsRedacted := any(redactAnyForLog("args", args, 0))
	if strings.TrimSpace(toolName) == "terminal.exec" {
		argsRedacted = redactAnyForPersist("args", args, 0)
		// Terminal output is fetched lazily from persistence; keep complete payload.
		argsPersistLimit = 0
		resultPersistLimit = 0
	}
	argsPersist := marshalPersistJSON(argsRedacted, argsPersistLimit)
	resultPersist := ""
	if result != nil {
		resultRedacted := any(redactAnyForLog("result", result, 0))
		if strings.TrimSpace(toolName) == "terminal.exec" {
			resultRedacted = redactAnyForPersist("result", result, 0)
		}
		resultPersist = marshalPersistJSON(resultRedacted, resultPersistLimit)
	}
	errCode := ""
	errMsg := ""
	retryable := false
	if toolErr != nil {
		toolErr.Normalize()
		errCode = string(toolErr.Code)
		errMsg = toolErr.Message
		retryable = toolErr.Retryable
	}
	rec := threadstore.ToolCallRecord{
		RunID:           strings.TrimSpace(r.id),
		ToolID:          strings.TrimSpace(toolID),
		ToolName:        strings.TrimSpace(toolName),
		Status:          strings.TrimSpace(status),
		ArgsJSON:        argsPersist,
		ResultJSON:      resultPersist,
		ErrorCode:       errCode,
		ErrorMessage:    errMsg,
		Retryable:       retryable,
		RecoveryAction:  strings.TrimSpace(recoveryAction),
		StartedAtUnixMs: startedAt.UnixMilli(),
		EndedAtUnixMs:   endedAt.UnixMilli(),
		LatencyMS:       endedAt.Sub(startedAt).Milliseconds(),
	}
	r.persistToolCall(rec)
}

func toolStartActivityPresentation(toolName string, args map[string]any, timeout terminalExecTimeoutDecision) *observation.ActivityPresentation {
	toolName = strings.TrimSpace(toolName)
	switch toolName {
	case "terminal.exec":
		command := strings.TrimSpace(anyToString(args["command"]))
		label := command
		if label == "" {
			label = "Activity"
		}
		payload := map[string]any{
			"status": toolCallStatusRunning,
		}
		if command != "" {
			payload["command"] = command
		}
		if timeout.EffectiveMS > 0 {
			payload["timeout_ms"] = timeout.EffectiveMS
		}
		if timeout.RequestedMS > 0 {
			payload["requested_timeout_ms"] = timeout.RequestedMS
		}
		if source := strings.TrimSpace(timeout.Source); source != "" {
			payload["timeout_source"] = source
		}
		return &observation.ActivityPresentation{
			Label:    activityPresentationLabel(label),
			Renderer: observation.ActivityRendererTerminal,
			Payload:  payload,
		}
	default:
		payload := map[string]any{
			"status": toolCallStatusRunning,
		}
		switch toolName {
		case "file.read", "file.edit", "file.write":
			path := strings.TrimSpace(anyToString(args["file_path"]))
			displayName := displayNameForFilePath(path)
			label := displayName
			if label == "" {
				label = "file"
			}
			payload["display_name"] = displayName
			operation := "edit"
			if toolName == "file.read" {
				operation = "read"
			} else if toolName == "file.write" {
				operation = "write"
			}
			return &observation.ActivityPresentation{
				Label:    activityPresentationLabel(label),
				Renderer: observation.ActivityRendererFile,
				Payload:  mapWithOperation(payload, operation),
			}
		case "web.search":
			label := firstNonEmptyString(anyToString(args["query"]), "Search web")
			return &observation.ActivityPresentation{
				Label:    activityPresentationLabel(label),
				Renderer: observation.ActivityRendererWebSearch,
				Payload:  payload,
			}
		case "okf.search":
			label := firstNonEmptyString(anyToString(args["query"]), okfKnowledgeActivityLabel)
			return &observation.ActivityPresentation{
				Label:    activityPresentationLabel(label),
				Renderer: observation.ActivityRendererStructured,
				Payload:  payload,
			}
		case "write_todos":
			return &observation.ActivityPresentation{
				Label:    "Update todos",
				Renderer: observation.ActivityRendererTodos,
				Payload:  payload,
			}
		case "use_skill":
			label := firstNonEmptyString(anyToString(args["name"]), "Use skill")
			return &observation.ActivityPresentation{
				Label:    activityPresentationLabel(label),
				Renderer: observation.ActivityRendererStructured,
				Payload:  payload,
			}
		case "subagents":
			label := firstNonEmptyString(anyToString(args["action"]), "Subagent task")
			return &observation.ActivityPresentation{
				Label:    activityPresentationLabel(label),
				Renderer: observation.ActivityRendererStructured,
				Payload:  payload,
			}
		case "ask_user":
			return &observation.ActivityPresentation{
				Label:    "Ask user",
				Renderer: observation.ActivityRendererQuestion,
				Payload:  payload,
			}
		case "task_complete":
			return &observation.ActivityPresentation{
				Label:    "Complete task",
				Renderer: observation.ActivityRendererCompletion,
				Payload:  payload,
			}
		case "exit_plan_mode":
			return &observation.ActivityPresentation{
				Label:    "Exit plan mode",
				Renderer: observation.ActivityRendererStructured,
				Payload:  payload,
			}
		}
		return &observation.ActivityPresentation{
			Label:    "Activity",
			Renderer: observation.ActivityRendererStructured,
			Payload:  payload,
		}
	}
}

func toolResultStatusForError(toolErr *aitools.ToolError) string {
	if toolErr == nil {
		return toolResultStatusError
	}
	toolErr.Normalize()
	switch toolErr.Code {
	case aitools.ErrorCodeTimeout:
		return toolResultStatusTimeout
	case aitools.ErrorCodeCanceled:
		return toolResultStatusAborted
	default:
		return toolResultStatusError
	}
}

func (r *run) recordToolResultActivity(toolID string, toolName string, status string, result any, toolErr *aitools.ToolError, observedAt time.Time) {
	if r == nil {
		return
	}
	if observedAt.IsZero() {
		observedAt = time.Now()
	}
	toolResult := ToolResult{
		ToolID:   strings.TrimSpace(toolID),
		ToolName: strings.TrimSpace(toolName),
		Status:   strings.TrimSpace(status),
		Data:     result,
		Error:    toolErr,
	}
	if _, err := validateToolResultStatus(toolResult.Status); err != nil {
		r.persistRunEvent("activity.tool_result.invalid", RealtimeStreamKindTool, map[string]any{
			"tool_id":   toolResult.ToolID,
			"tool_name": toolResult.ToolName,
			"error":     sanitizeLogText(err.Error(), 240),
		})
		return
	}
	if toolErr != nil {
		toolErr.Normalize()
		toolResult.Summary = string(toolErr.Code)
		toolResult.Details = toolErr.Message
	}
	activity, err := floretActivityForToolResult(r, toolResult)
	if err != nil {
		r.persistRunEvent("activity.tool_result.invalid", RealtimeStreamKindTool, map[string]any{
			"tool_id":   toolResult.ToolID,
			"tool_name": toolResult.ToolName,
			"error":     sanitizeLogText(err.Error(), 240),
		})
		return
	}
	r.recordObservationActivityEvent(observation.Event{
		Type:       observation.EventTypeToolResult,
		ToolID:     toolResult.ToolID,
		ToolName:   toolResult.ToolName,
		ToolKind:   "local",
		Error:      strings.TrimSpace(toolResult.Details),
		Activity:   activity,
		ObservedAt: observedAt,
	})
}

func (r *run) persistSyntheticToolSuccess(toolID string, toolName string, args map[string]any, result any) string {
	if r == nil {
		return strings.TrimSpace(toolID)
	}
	toolName = strings.TrimSpace(toolName)
	if toolName == "" {
		return strings.TrimSpace(toolID)
	}
	toolID = strings.TrimSpace(toolID)
	if toolID == "" {
		if id, err := newToolID(); err == nil {
			toolID = id
		} else {
			toolID = "tool_" + strings.ReplaceAll(strings.ToLower(toolName), ".", "_")
		}
	}
	argsCopy := cloneAnyMap(args)
	startedAt := time.Now()
	r.recordRuntimeToolCall()
	r.persistRunEvent("tool.call", RealtimeStreamKindTool, map[string]any{
		"tool_id":   toolID,
		"tool_name": toolName,
		"args":      redactAnyForLog("args", argsCopy, 0),
	})
	r.persistToolCallSnapshot(toolID, toolName, toolCallStatusSuccess, argsCopy, result, nil, "", startedAt, startedAt)
	r.persistRunEvent("tool.result", RealtimeStreamKindTool, map[string]any{
		"tool_id":   toolID,
		"tool_name": toolName,
		"status":    "success",
	})
	successPayload := map[string]any{
		"tool_id":   toolID,
		"tool_name": toolName,
		"status":    "success",
		"result":    redactAnyForLog("result", result, 0),
	}
	r.persistExecutionSpan(threadstore.ExecutionSpanRecord{
		SpanID:          executionSpanID(r.id, toolName, toolID),
		EndpointID:      strings.TrimSpace(r.endpointID),
		ThreadID:        strings.TrimSpace(r.threadID),
		RunID:           strings.TrimSpace(r.id),
		Kind:            "tool",
		Name:            toolName,
		Status:          "success",
		PayloadJSON:     marshalPersistJSON(successPayload, 6000),
		StartedAtUnixMs: startedAt.UnixMilli(),
		EndedAtUnixMs:   startedAt.UnixMilli(),
		UpdatedAtUnixMs: startedAt.UnixMilli(),
	})
	return toolID
}

func cloneAnyMap(in map[string]any) map[string]any {
	if in == nil {
		return map[string]any{}
	}
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func (r *run) handleToolCall(ctx context.Context, toolID string, toolName string, args map[string]any) (*toolCallOutcome, error) {
	toolID = strings.TrimSpace(toolID)
	if toolID == "" {
		var err error
		toolID, err = newToolID()
		if err != nil {
			return nil, err
		}
	}
	toolName = strings.TrimSpace(toolName)
	if toolName == "" {
		return nil, errors.New("missing tool_name")
	}
	if args == nil {
		args = map[string]any{}
	}
	r.recordRuntimeToolCall()

	argsForPersist := args
	if toolName == "terminal.exec" {
		argsForPersist = redactToolArgsForPersist(toolName, args)
	}

	outcome := &toolCallOutcome{
		Success:        false,
		ToolName:       toolName,
		Args:           cloneAnyMap(args),
		ToolError:      nil,
		RecoveryAction: "",
	}
	needsApproval := requiresApproval(toolName, args)
	mutating := isMutatingInvocation(toolName, args)
	dangerous := isDangerousInvocation(toolName, args)

	requireUserApproval := r.cfg.EffectiveRequireUserApproval()
	blockDangerousCommands := r.cfg.EffectiveBlockDangerousCommands()
	isPlanMode := strings.TrimSpace(strings.ToLower(r.runMode)) == config.AIModePlan
	denyDangerous := blockDangerousCommands && dangerous
	denyPlanMutating := isPlanMode && mutating
	commandProfile := aitools.InvocationCommandProfile(toolName, args)
	commandRisk := strings.TrimSpace(string(commandProfile.Risk))
	normalizedCommand := strings.TrimSpace(commandProfile.NormalizedCommand)
	commandEffects := append([]string(nil), commandProfile.Effects...)
	classificationReason := strings.TrimSpace(commandProfile.Reason)
	var terminalTimeoutDecision terminalExecTimeoutDecision
	var terminalExecResultMeta map[string]any
	if toolName == "terminal.exec" {
		terminalTimeoutDecision = resolveTerminalExecTimeoutDecision(r.cfg, readInt64Field(args, "timeout_ms", "timeoutMs"))
		terminalExecResultMeta = terminalExecTimeoutDecisionResult(terminalTimeoutDecision)
	}
	readonlyRisk := string(aitools.TerminalCommandRiskReadonly)
	denyReadonlyExec := r.forceReadonlyExec && toolName == "terminal.exec" && commandRisk != "" && commandRisk != readonlyRisk
	requireApprovalForInvocation := requireUserApproval && needsApproval && !denyReadonlyExec
	denyNoUserInteractionApproval := r.noUserInteraction && requireApprovalForInvocation
	policyDecision := "allow"
	policyReason := "none"
	if denyNoUserInteractionApproval {
		policyDecision = "deny"
		policyReason = "no_user_interaction_policy"
	} else if denyReadonlyExec {
		policyDecision = "deny"
		policyReason = "subagent_readonly_guard_blocked"
	} else if denyDangerous {
		policyDecision = "deny"
		policyReason = "dangerous_command_blocked"
	} else if denyPlanMutating {
		policyDecision = "deny"
		policyReason = "plan_mode_readonly_blocked"
	} else if requireApprovalForInvocation {
		policyDecision = "ask"
		policyReason = "user_approval_required"
	}

	toolStartedAt := time.Now()
	toolSpanID := executionSpanID(r.id, toolName, toolID)
	r.persistRunEvent("tool.call", RealtimeStreamKindTool, map[string]any{
		"tool_id":   toolID,
		"tool_name": toolName,
		"args":      redactAnyForLog("args", args, 0),
	})
	if toolName == "terminal.exec" {
		r.persistRunEvent("tool.policy", RealtimeStreamKindLifecycle, map[string]any{
			"tool_id":                         toolID,
			"tool_name":                       toolName,
			"normalized_command":              normalizedCommand,
			"command_risk":                    commandRisk,
			"command_effects":                 commandEffects,
			"classification_reason":           classificationReason,
			"policy_decision":                 policyDecision,
			"policy_reason":                   policyReason,
			"policy_force_readonly_exec":      r.forceReadonlyExec,
			"policy_require_user_approval":    requireUserApproval,
			"policy_no_user_interaction":      r.noUserInteraction,
			"policy_plan_mode_readonly":       isPlanMode,
			"policy_block_dangerous_commands": blockDangerousCommands,
			"timeout_requested_ms":            terminalTimeoutDecision.RequestedMS,
			"timeout_effective_ms":            terminalTimeoutDecision.EffectiveMS,
			"timeout_default_ms":              terminalTimeoutDecision.DefaultMS,
			"timeout_max_ms":                  terminalTimeoutDecision.MaxMS,
			"timeout_source":                  terminalTimeoutDecision.Source,
		})
	}
	toolCallPayload := map[string]any{
		"tool_id":   toolID,
		"tool_name": toolName,
		"args":      redactAnyForLog("args", args, 0),
	}
	toolCallPayloadJSON := marshalPersistJSON(toolCallPayload, 6000)
	r.persistExecutionSpan(threadstore.ExecutionSpanRecord{
		SpanID:          toolSpanID,
		EndpointID:      strings.TrimSpace(r.endpointID),
		ThreadID:        strings.TrimSpace(r.threadID),
		RunID:           strings.TrimSpace(r.id),
		Kind:            "tool",
		Name:            toolName,
		Status:          "started",
		PayloadJSON:     toolCallPayloadJSON,
		StartedAtUnixMs: toolStartedAt.UnixMilli(),
		UpdatedAtUnixMs: toolStartedAt.UnixMilli(),
	})

	r.debug("ai.run.tool.call",
		"tool_id", toolID,
		"tool_name", toolName,
		"requires_approval", needsApproval,
		"mutating", mutating,
		"dangerous", dangerous,
		"policy_require_user_approval", requireUserApproval,
		"policy_no_user_interaction", r.noUserInteraction,
		"policy_plan_mode_readonly", isPlanMode,
		"policy_block_dangerous_commands", blockDangerousCommands,
		"command_risk", commandRisk,
		"command_effects", commandEffects,
		"classification_reason", classificationReason,
		"normalized_command", normalizedCommand,
		"policy_decision", policyDecision,
		"policy_reason", policyReason,
		"args_preview", previewAnyForLog(redactToolArgsForLog(toolName, args), 512),
	)

	persistResult := any(nil)
	if toolName == "terminal.exec" {
		persistResult = terminalExecResultMeta
	}
	r.persistToolCallSnapshot(toolID, toolName, toolCallStatusPending, argsForPersist, persistResult, nil, "", toolStartedAt, time.Now())

	setToolError := func(toolErr *aitools.ToolError, recoveryAction string, partialResult any) {
		if toolErr == nil {
			toolErr = &aitools.ToolError{Code: aitools.ErrorCodeUnknown, Message: "Tool failed"}
		}
		toolErr.Normalize()
		outcome.Success = false
		outcome.Result = partialResult
		outcome.ToolError = toolErr
		outcome.RecoveryAction = strings.TrimSpace(recoveryAction)
		r.debug("ai.run.tool.result",
			"tool_id", toolID,
			"tool_name", toolName,
			"status", "error",
			"error_code", string(toolErr.Code),
			"error", sanitizeLogText(toolErr.Message, 256),
		)
		if r.log != nil {
			r.log.Warn("ai tool call failed",
				"run_id", r.id,
				"thread_id", r.threadID,
				"channel_id", r.channelID,
				"endpoint_id", r.endpointID,
				"tool_id", toolID,
				"tool_name", toolName,
				"error_code", string(toolErr.Code),
				"error", toolErr.Message,
			)
		}
		errorResult := partialResult
		if toolName == "terminal.exec" && errorResult == nil {
			errorResult = terminalExecResultMeta
		}
		errorAt := time.Now()
		r.persistToolCallSnapshot(toolID, toolName, toolCallStatusError, argsForPersist, errorResult, toolErr, recoveryAction, toolStartedAt, errorAt)
		r.persistRunEvent("tool.error", RealtimeStreamKindTool, map[string]any{
			"tool_id":   toolID,
			"tool_name": toolName,
			"error":     toolErr,
		})
		r.recordToolResultActivity(toolID, toolName, toolResultStatusForError(toolErr), errorResult, toolErr, errorAt)
		errPayload := map[string]any{
			"tool_id":         toolID,
			"tool_name":       toolName,
			"status":          "failed",
			"error":           toolErr,
			"recovery_action": strings.TrimSpace(recoveryAction),
		}
		if partialResult != nil {
			errPayload["result"] = redactAnyForLog("result", partialResult, 0)
		}
		r.persistExecutionSpan(threadstore.ExecutionSpanRecord{
			SpanID:          toolSpanID,
			EndpointID:      strings.TrimSpace(r.endpointID),
			ThreadID:        strings.TrimSpace(r.threadID),
			RunID:           strings.TrimSpace(r.id),
			Kind:            "tool",
			Name:            toolName,
			Status:          "failed",
			PayloadJSON:     marshalPersistJSON(errPayload, 6000),
			StartedAtUnixMs: toolStartedAt.UnixMilli(),
			EndedAtUnixMs:   time.Now().UnixMilli(),
			UpdatedAtUnixMs: time.Now().UnixMilli(),
		})
	}

	// Detached runs are hard-canceled (e.g. replaced by a new user turn). Prevent them from
	// mutating the workspace even if some tool calls were already queued.
	if r.isDetached() && mutating {
		setToolError(&aitools.ToolError{Code: aitools.ErrorCodeCanceled, Message: "Run was canceled", Retryable: false}, "", nil)
		return outcome, nil
	}

	if denyReadonlyExec {
		toolErr := &aitools.ToolError{
			Code:      aitools.ErrorCodePermissionDenied,
			Message:   "terminal.exec command is blocked by subagent readonly policy",
			Retryable: false,
			SuggestedFixes: []string{
				"Use readonly commands (for example rg, ls, cat, grep, git status, git diff).",
				"Switch to a worker subagent role when write operations are required.",
			},
		}
		setToolError(toolErr, "", nil)
		return outcome, nil
	}

	if denyDangerous {
		toolErr := &aitools.ToolError{
			Code:      aitools.ErrorCodePermissionDenied,
			Message:   "Command blocked by dangerous-command policy",
			Retryable: false,
			SuggestedFixes: []string{
				"Use a readonly command for investigation.",
				"Use apply_patch with the canonical Begin/End Patch format for file edits instead of destructive shell commands.",
				"Disable block_dangerous_commands in Settings > AI > Execution policy only if you accept the risk.",
			},
		}
		setToolError(toolErr, "", nil)
		return outcome, nil
	}

	if denyNoUserInteractionApproval {
		toolErr := &aitools.ToolError{
			Code:      aitools.ErrorCodePermissionDenied,
			Message:   "Tool invocation requires user approval, but user interaction is disabled in this run",
			Retryable: false,
			SuggestedFixes: []string{
				"Use a tool invocation that does not require user approval.",
				"Complete with task_complete and report blockers instead of requesting approval.",
			},
		}
		setToolError(toolErr, "", nil)
		return outcome, nil
	}

	if denyPlanMutating {
		toolErr := &aitools.ToolError{
			Code:      aitools.ErrorCodePermissionDenied,
			Message:   "Mutating tool call blocked by plan-mode readonly policy",
			Retryable: false,
			SuggestedFixes: []string{
				"Switch AI mode to act to enable mutating tools.",
				"If execution is required, call exit_plan_mode to request switching to act mode.",
			},
		}
		setToolError(toolErr, "", nil)
		return outcome, nil
	}

	meta, err := r.sessionMetaForTool()
	if err != nil {
		toolErr := aitools.ClassifyError(aitools.Invocation{ToolName: toolName, Args: args, WorkingDir: r.workingDir, AgentHomeDir: r.agentHomeDir}, err)
		setToolError(toolErr, "", nil)
		return outcome, nil
	}

	if requireApprovalForInvocation {
		ch := make(chan bool, 1)
		requestedAt := time.Now().UnixMilli()
		expiresAt := int64(0)
		if r.toolApprovalTO > 0 {
			expiresAt = requestedAt + r.toolApprovalTO.Milliseconds()
		}
		r.mu.Lock()
		r.toolApprovals[toolID] = &toolApprovalRequest{
			decision:      ch,
			toolName:      toolName,
			requestedAtMs: requestedAt,
			expiresAtMs:   expiresAt,
		}
		r.waitingApproval = true
		r.mu.Unlock()
		r.recordObservationActivityEvent(observation.Event{
			Type:       observation.EventTypeToolApprovalRequested,
			ToolID:     toolID,
			ToolName:   toolName,
			ObservedAt: time.Now(),
			Metadata: map[string]any{
				"approval_id": toolID,
			},
		})
		r.persistRunEvent("tool.approval.requested", RealtimeStreamKindLifecycle, map[string]any{"tool_id": toolID, "tool_name": toolName})
		r.debug("ai.run.tool.approval.requested", "tool_id", toolID, "tool_name", toolName)

		approved := false
		timedOut := false
		waitErr := ""
		to := r.toolApprovalTO
		if to <= 0 {
			to = 10 * time.Minute
		}
		timer := time.NewTimer(to)
		defer timer.Stop()
		select {
		case approved = <-ch:
		case <-ctx.Done():
			waitErr = "canceled"
		case <-timer.C:
			timedOut = true
		}

		r.mu.Lock()
		delete(r.toolApprovals, toolID)
		r.waitingApproval = false
		r.mu.Unlock()

		if waitErr != "" {
			toolErr := &aitools.ToolError{Code: aitools.ErrorCodeCanceled, Message: "Canceled", Retryable: false}
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				toolErr = &aitools.ToolError{Code: aitools.ErrorCodeTimeout, Message: "Timed out", Retryable: true}
			}
			r.recordObservationActivityEvent(observation.Event{
				Type:       observation.EventTypeToolApprovalCanceled,
				ToolID:     toolID,
				ToolName:   toolName,
				Error:      strings.TrimSpace(toolErr.Message),
				ObservedAt: time.Now(),
				Metadata: map[string]any{
					"approval_id": toolID,
				},
			})
			setToolError(toolErr, "", nil)
			return outcome, nil
		}
		if timedOut {
			toolErr := &aitools.ToolError{Code: aitools.ErrorCodeTimeout, Message: "Approval timed out", Retryable: true}
			r.recordObservationActivityEvent(observation.Event{
				Type:       observation.EventTypeToolApprovalTimedOut,
				ToolID:     toolID,
				ToolName:   toolName,
				Error:      strings.TrimSpace(toolErr.Message),
				ObservedAt: time.Now(),
				Metadata: map[string]any{
					"approval_id": toolID,
				},
			})
			setToolError(toolErr, "", nil)
			return outcome, nil
		}
		if !approved {
			toolErr := &aitools.ToolError{Code: aitools.ErrorCodePermissionDenied, Message: "Rejected by user", Retryable: false}
			r.recordObservationActivityEvent(observation.Event{
				Type:       observation.EventTypeToolApprovalRejected,
				ToolID:     toolID,
				ToolName:   toolName,
				Error:      strings.TrimSpace(toolErr.Message),
				ObservedAt: time.Now(),
				Metadata: map[string]any{
					"approval_id": toolID,
				},
			})
			setToolError(toolErr, "", nil)
			return outcome, nil
		}

		r.recordObservationActivityEvent(observation.Event{
			Type:       observation.EventTypeToolApprovalApproved,
			ToolID:     toolID,
			ToolName:   toolName,
			ObservedAt: time.Now(),
			Metadata: map[string]any{
				"approval_id": toolID,
			},
		})
		r.persistRunEvent("tool.approval.approved", RealtimeStreamKindLifecycle, map[string]any{"tool_id": toolID, "tool_name": toolName})
		r.debug("ai.run.tool.approval.approved", "tool_id", toolID, "tool_name", toolName)
	}

	r.debug("ai.run.tool.exec.start", "tool_id", toolID, "tool_name", toolName)
	endBusy := r.beginBusy()
	defer endBusy()
	persistResult = nil
	if toolName == "terminal.exec" {
		persistResult = terminalExecResultMeta
	}
	r.persistToolCallSnapshot(toolID, toolName, toolCallStatusRunning, argsForPersist, persistResult, nil, "", toolStartedAt, time.Now())
	toolExecutionStartedAt := time.Now()
	argsHashBytes := sha256.Sum256([]byte(marshalPersistJSON(argsForPersist, 0)))
	r.recordObservationActivityEvent(observation.Event{
		Type:       observation.EventTypeToolCall,
		ToolID:     toolID,
		ToolName:   toolName,
		ToolKind:   "local",
		ArgsHash:   hex.EncodeToString(argsHashBytes[:]),
		Activity:   toolStartActivityPresentation(toolName, argsForPersist, terminalTimeoutDecision),
		ObservedAt: toolExecutionStartedAt,
		Metadata: map[string]any{
			"effects": commandEffects,
		},
	})

	result, toolErrRaw := r.execTool(ctx, meta, toolID, toolName, args)
	if toolErrRaw != nil {
		if errors.Is(toolErrRaw, context.Canceled) {
			setToolError(&aitools.ToolError{Code: aitools.ErrorCodeCanceled, Message: "Canceled", Retryable: false}, "", nil)
			return outcome, nil
		}
		if errors.Is(toolErrRaw, context.DeadlineExceeded) {
			setToolError(&aitools.ToolError{Code: aitools.ErrorCodeTimeout, Message: "Tool execution timed out", Retryable: true}, "", nil)
			return outcome, nil
		}
		toolErr := aitools.ClassifyError(aitools.Invocation{ToolName: toolName, Args: args, WorkingDir: r.workingDir, AgentHomeDir: r.agentHomeDir}, toolErrRaw)
		recoveryAction := ""
		if aitools.ShouldRetryWithNormalizedArgs(toolErr) {
			recoveryAction = "retry_with_normalized_args"
		}
		setToolError(toolErr, recoveryAction, nil)
		return outcome, nil
	}

	if toolName == "terminal.exec" {
		if toolErr := terminalExecTimeoutToolError(result); toolErr != nil {
			setToolError(toolErr, "", result)
			return outcome, nil
		}
	}

	if toolName == "web.search" {
		if parsed, ok := parseWebSearchResult(result); ok {
			r.recordWebSearchSources(parsed)
		}
	}
	resultAt := time.Now()
	r.persistToolCallSnapshot(toolID, toolName, toolCallStatusSuccess, argsForPersist, result, nil, "", toolStartedAt, resultAt)
	r.persistRunEvent("tool.result", RealtimeStreamKindTool, map[string]any{
		"tool_id":   toolID,
		"tool_name": toolName,
		"status":    "success",
	})
	r.recordToolResultActivity(toolID, toolName, toolResultStatusSuccess, result, nil, resultAt)
	successPayload := map[string]any{
		"tool_id":   toolID,
		"tool_name": toolName,
		"status":    "success",
		"result":    redactAnyForLog("result", result, 0),
	}
	r.persistExecutionSpan(threadstore.ExecutionSpanRecord{
		SpanID:          toolSpanID,
		EndpointID:      strings.TrimSpace(r.endpointID),
		ThreadID:        strings.TrimSpace(r.threadID),
		RunID:           strings.TrimSpace(r.id),
		Kind:            "tool",
		Name:            toolName,
		Status:          "success",
		PayloadJSON:     marshalPersistJSON(successPayload, 6000),
		StartedAtUnixMs: toolStartedAt.UnixMilli(),
		EndedAtUnixMs:   time.Now().UnixMilli(),
		UpdatedAtUnixMs: time.Now().UnixMilli(),
	})
	r.debug("ai.run.tool.result",
		"tool_id", toolID,
		"tool_name", toolName,
		"status", "success",
		"result_preview", previewAnyForLog(redactAnyForLog("", result, 0), 512),
	)

	outcome.Success = true
	outcome.Result = result
	outcome.ToolError = nil
	outcome.RecoveryAction = ""
	return outcome, nil
}

func (r *run) persistEnsureIndex(idx int) {
	if r == nil || idx < 0 {
		return
	}
	for len(r.assistantBlocks) <= idx {
		r.assistantBlocks = append(r.assistantBlocks, nil)
	}
}

func (r *run) ensureAssistantMessageStarted() bool {
	if r == nil || strings.TrimSpace(r.messageID) == "" {
		return false
	}

	started := false
	r.muAssistant.Lock()
	if len(r.assistantBlocks) == 0 {
		r.assistantCreatedAtUnixMs = time.Now().UnixMilli()
		r.assistantBlocks = []any{&persistedMarkdownBlock{Type: "markdown", Content: ""}}
		started = true
	}
	r.muAssistant.Unlock()

	if !started {
		return false
	}

	r.nextBlockIndex = 1
	r.currentTextBlockIndex = 0
	r.needNewTextBlock = false
	r.currentThinkingBlockIndex = -1
	r.needNewThinkingBlock = false
	r.sendStreamEvent(streamEventMessageStart{Type: "message-start", MessageID: r.messageID})
	r.sendStreamEvent(streamEventBlockStart{Type: "block-start", MessageID: r.messageID, BlockIndex: 0, BlockType: "markdown"})
	return true
}

func (r *run) persistSetMarkdownBlock(idx int) {
	if r == nil || idx < 0 {
		return
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	r.persistEnsureIndex(idx)
	r.assistantBlocks[idx] = &persistedMarkdownBlock{Type: "markdown", Content: ""}
}

func (r *run) persistSetThinkingBlock(idx int) {
	if r == nil || idx < 0 {
		return
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	r.persistEnsureIndex(idx)
	r.assistantBlocks[idx] = &persistedThinkingBlock{Type: "thinking"}
}

func (r *run) persistAppendMarkdownDelta(idx int, delta string) {
	if r == nil || idx < 0 || delta == "" {
		return
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	if idx >= len(r.assistantBlocks) {
		return
	}
	if b, ok := r.assistantBlocks[idx].(*persistedMarkdownBlock); ok && b != nil {
		b.Content += delta
	}
}

func (r *run) persistAppendThinkingDelta(idx int, delta string) {
	if r == nil || idx < 0 || delta == "" {
		return
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	if idx >= len(r.assistantBlocks) {
		return
	}
	if b, ok := r.assistantBlocks[idx].(*persistedThinkingBlock); ok && b != nil {
		b.Content += delta
	}
}

func normalizeSnapshotMessageStatus(status string) string {
	switch strings.TrimSpace(strings.ToLower(status)) {
	case "sending":
		return "sending"
	case "streaming":
		return "streaming"
	case "error":
		return "error"
	case "complete":
		return "complete"
	default:
		return ""
	}
}

func (r *run) snapshotAssistantMessageJSONWithStatus(status string) (string, string, int64, error) {
	if r == nil {
		return "", "", 0, errors.New("nil run")
	}
	if strings.TrimSpace(r.messageID) == "" {
		return "", "", 0, errors.New("missing message_id")
	}

	r.muAssistant.Lock()
	if len(r.assistantBlocks) == 0 {
		r.muAssistant.Unlock()
		return "", "", 0, errors.New("assistant blocks unavailable")
	}
	blocks := make([]any, 0, len(r.assistantBlocks))
	for _, blk := range r.assistantBlocks {
		if blk == nil {
			continue
		}
		switch v := blk.(type) {
		case *persistedMarkdownBlock:
			if v == nil || strings.TrimSpace(v.Content) == "" {
				continue
			}
			cp := *v
			blocks = append(blocks, &cp)
		case *persistedThinkingBlock:
			if v == nil {
				continue
			}
			cp := *v
			blocks = append(blocks, &cp)
		default:
			blocks = append(blocks, v)
		}
	}
	assistantAt := r.assistantCreatedAtUnixMs
	r.muAssistant.Unlock()

	msg := persistedMessage{
		ID:        r.messageID,
		Role:      "assistant",
		Blocks:    blocks,
		Status:    normalizeSnapshotMessageStatus(status),
		Timestamp: assistantAt,
	}
	if msg.Status == "" {
		return "", "", 0, fmt.Errorf("unsupported assistant snapshot status %q", strings.TrimSpace(status))
	}
	b, err := json.Marshal(msg)
	if err != nil {
		return "", "", 0, err
	}

	canonical := r.canonicalMarkdownTextSnapshot("")
	var sb strings.Builder
	if canonical == "" {
		for _, blk := range blocks {
			text := assistantVisibleTextFromBlock(blk)
			if text == "" {
				continue
			}
			if sb.Len() > 0 {
				sb.WriteString("\n\n")
			}
			sb.WriteString(text)
		}
	}

	assistantText := canonical
	if assistantText == "" {
		assistantText = strings.TrimSpace(sb.String())
	}
	if assistantText == "" {
		assistantText = r.waitingPromptSummarySnapshot()
	}
	if assistantText == "" {
		assistantText = r.canonicalMarkdownTextSnapshot("")
	}
	return string(b), assistantText, assistantAt, nil
}

func (r *run) snapshotAssistantMessageJSON() (string, string, int64, error) {
	return r.snapshotAssistantMessageJSONWithStatus("complete")
}

func assistantVisibleTextFromBlock(block any) string {
	switch v := block.(type) {
	case *persistedMarkdownBlock:
		if v == nil {
			return ""
		}
		return strings.TrimSpace(v.Content)
	default:
		return ""
	}
}

func (r *run) waitingPromptSummarySnapshot() string {
	prompt := r.snapshotWaitingPrompt()
	if prompt == nil {
		return ""
	}
	return formatRequestUserInputAssistantSummary(*prompt)
}

func toAnySlice(value any) []any {
	switch v := value.(type) {
	case []any:
		return v
	case []map[string]any:
		out := make([]any, 0, len(v))
		for _, item := range v {
			out = append(out, item)
		}
		return out
	default:
		return nil
	}
}

func extractStringListFromAny(value any) []string {
	items := toAnySlice(value)
	if len(items) == 0 {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		text, ok := item.(string)
		if !ok {
			continue
		}
		text = strings.TrimSpace(text)
		if text == "" {
			continue
		}
		out = append(out, text)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func parseAskUserQuestionsAny(value any) []RequestUserInputQuestion {
	switch v := value.(type) {
	case []RequestUserInputQuestion:
		return normalizeRequestUserInputQuestions(append([]RequestUserInputQuestion(nil), v...))
	}
	items := toAnySlice(value)
	if len(items) == 0 {
		return nil
	}
	questions := make([]RequestUserInputQuestion, 0, len(items))
	for _, item := range items {
		record, ok := item.(map[string]any)
		if !ok || record == nil {
			continue
		}
		question, ok := requestUserInputQuestionFromRecord(record)
		if !ok {
			continue
		}
		questions = append(questions, question)
	}
	return normalizeRequestUserInputQuestions(questions)
}

func parseWebSearchResult(result any) (websearch.SearchResult, bool) {
	if result == nil {
		return websearch.SearchResult{}, false
	}
	switch v := result.(type) {
	case websearch.SearchResult:
		return v, true
	case *websearch.SearchResult:
		if v == nil {
			return websearch.SearchResult{}, false
		}
		return *v, true
	default:
		// Best-effort: tool outputs are persisted as JSON-compatible values.
		b, err := json.Marshal(v)
		if err != nil || len(b) == 0 {
			return websearch.SearchResult{}, false
		}
		var out websearch.SearchResult
		if err := json.Unmarshal(b, &out); err != nil {
			return websearch.SearchResult{}, false
		}
		if strings.TrimSpace(out.Provider) == "" && strings.TrimSpace(out.Query) == "" && len(out.Results) == 0 && len(out.Sources) == 0 {
			return websearch.SearchResult{}, false
		}
		return out, true
	}
}

func normalizeWebURL(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", false
	}
	// Guard against accidental non-URL "sources" like command output.
	if strings.ContainsAny(raw, " \t\r\n") {
		return "", false
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", false
	}
	scheme := strings.ToLower(strings.TrimSpace(u.Scheme))
	if scheme != "http" && scheme != "https" {
		return "", false
	}
	if strings.TrimSpace(u.Host) == "" {
		return "", false
	}
	return u.String(), true
}

func (r *run) addWebSource(title string, rawURL string) {
	if r == nil {
		return
	}
	url, ok := normalizeWebURL(rawURL)
	if !ok {
		return
	}
	title = strings.TrimSpace(title)
	title = strings.ReplaceAll(title, "\n", " ")
	title = strings.ReplaceAll(title, "\r", " ")
	title = strings.TrimSpace(title)
	if title == "" {
		title = url
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if r.collectedWebSources == nil {
		r.collectedWebSources = make(map[string]SourceRef)
	}
	if existing, ok := r.collectedWebSources[url]; ok {
		if existing.Title == "" || existing.Title == existing.URL {
			if title != url {
				existing.Title = title
				r.collectedWebSources[url] = existing
			}
		}
		return
	}
	r.collectedWebSources[url] = SourceRef{Title: title, URL: url}
	r.collectedWebSourceOrder = append(r.collectedWebSourceOrder, url)
}

func (r *run) recordWebSearchSources(res websearch.SearchResult) {
	if r == nil {
		return
	}
	// Prefer explicit sources, fall back to results.
	items := res.Sources
	if len(items) == 0 {
		items = res.Results
	}
	for _, item := range items {
		r.addWebSource(item.Title, item.URL)
	}
}

func (r *run) recordSourcesActivity(_ string) {
	if r == nil {
		return
	}

	var sources []SourceRef
	r.mu.Lock()
	if r.sourcesActivityAlreadyRecorded {
		r.mu.Unlock()
		return
	}
	if len(r.collectedWebSourceOrder) == 0 || len(r.collectedWebSources) == 0 {
		r.mu.Unlock()
		return
	}
	sources = make([]SourceRef, 0, len(r.collectedWebSourceOrder))
	for _, url := range r.collectedWebSourceOrder {
		if src, ok := r.collectedWebSources[url]; ok {
			sources = append(sources, src)
		}
	}
	if len(sources) == 0 {
		r.mu.Unlock()
		return
	}
	r.sourcesActivityAlreadyRecorded = true
	r.mu.Unlock()

	toolID, err := newToolID()
	if err != nil {
		toolID = "activity_sources"
	}
	r.recordObservationActivityEvent(observation.Event{
		Type:       observation.EventTypeHostedToolResult,
		ToolID:     toolID,
		ToolName:   "sources",
		ToolKind:   "hosted",
		ObservedAt: time.Now(),
		Metadata: map[string]any{
			"result_count": len(sources),
		},
	})
}

func (r *run) execTool(ctx context.Context, meta *session.Meta, toolID string, toolName string, args map[string]any) (any, error) {
	if r.shouldRouteTargetTool(toolName) {
		return r.execTargetTool(ctx, toolID, toolName, args)
	}
	switch toolName {
	case "file.read":
		if meta == nil || !meta.CanRead {
			return nil, errors.New("read permission denied")
		}
		var p FileReadArgs
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		return r.toolFileRead(ctx, p)

	case "file.edit":
		if meta == nil || !meta.CanWrite {
			return nil, errors.New("write permission denied")
		}
		var p FileEditArgs
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		return r.toolFileEdit(ctx, p)

	case "file.write":
		if meta == nil || !meta.CanWrite {
			return nil, errors.New("write permission denied")
		}
		var p FileWriteArgs
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		return r.toolFileWrite(ctx, p)

	case "apply_patch":
		if meta == nil || !meta.CanWrite {
			return nil, errors.New("write permission denied")
		}
		var p struct {
			Patch string `json:"patch"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		return r.toolApplyPatch(ctx, p.Patch)

	case "terminal.exec":
		if meta == nil || !meta.CanExecute {
			return nil, errors.New("execute permission denied")
		}
		var p struct {
			Command     string `json:"command"`
			Stdin       string `json:"stdin"`
			Cwd         string `json:"cwd"`
			Workdir     string `json:"workdir"`
			TimeoutMS   int64  `json:"timeout_ms"`
			Description string `json:"description"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		cwd, err := r.normalizeTerminalExecCwd(p.Cwd, p.Workdir)
		if err != nil {
			return nil, err
		}
		return r.toolTerminalExec(ctx, p.Command, p.Stdin, cwd, p.TimeoutMS)

	case "web.search":
		if meta == nil || !meta.CanExecute {
			return nil, errors.New("execute permission denied")
		}
		var p struct {
			Query     string `json:"query"`
			Provider  string `json:"provider"`
			Count     int    `json:"count"`
			TimeoutMS int64  `json:"timeout_ms"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		query := strings.TrimSpace(p.Query)
		if query == "" {
			return nil, errors.New("missing query")
		}
		provider := strings.TrimSpace(strings.ToLower(p.Provider))
		if provider == "" {
			provider = websearch.ProviderBrave
		}
		timeoutMS := p.TimeoutMS
		if timeoutMS <= 0 {
			timeoutMS = 15_000
		}
		if timeoutMS > 60_000 {
			timeoutMS = 60_000
		}

		key := ""
		ok := false
		if r.resolveWebSearchKey != nil {
			var err error
			key, ok, err = r.resolveWebSearchKey(provider)
			if err != nil {
				return nil, err
			}
		}
		if !ok || strings.TrimSpace(key) == "" {
			// Env var overrides for quick local setup.
			if provider == websearch.ProviderBrave {
				key = strings.TrimSpace(os.Getenv("REDEVEN_BRAVE_API_KEY"))
				if key == "" {
					key = strings.TrimSpace(os.Getenv("BRAVE_API_KEY"))
				}
				ok = strings.TrimSpace(key) != ""
			}
		}
		if !ok || strings.TrimSpace(key) == "" {
			return nil, fmt.Errorf("missing web search api key for provider %q", provider)
		}

		ctx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMS)*time.Millisecond)
		defer cancel()

		return websearch.Search(ctx, provider, key, websearch.SearchRequest{Query: query, Count: p.Count})

	case "okf.search":
		if meta == nil || !meta.CanRead {
			return nil, errors.New("read permission denied")
		}
		var p struct {
			Query      string   `json:"query"`
			MaxResults int      `json:"max_results"`
			Tags       []string `json:"tags"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		query := strings.TrimSpace(p.Query)
		if query == "" {
			return nil, errors.New("missing query")
		}
		return okf.Search(okf.SearchRequest{
			Query:      query,
			MaxResults: p.MaxResults,
			Tags:       p.Tags,
		})

	case "write_todos":
		var p struct {
			Todos           []TodoItem `json:"todos"`
			ExpectedVersion *int64     `json:"expected_version"`
			Explanation     string     `json:"explanation"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		return r.toolWriteTodos(ctx, toolID, p.Todos, p.ExpectedVersion, p.Explanation)

	case "exit_plan_mode":
		var p ExitPlanModeArgs
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		return r.toolExitPlanMode(toolID, p)

	case "use_skill":
		if meta == nil || !meta.CanExecute {
			return nil, errors.New("execute permission denied")
		}
		var p struct {
			Name   string `json:"name"`
			Reason string `json:"reason"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		name := strings.TrimSpace(p.Name)
		if name == "" {
			return nil, errors.New("missing name")
		}
		reason := strings.TrimSpace(p.Reason)
		activation, alreadyActive, err := r.activateSkill(name)
		if err != nil {
			return nil, err
		}
		out := map[string]any{
			"name":           activation.Name,
			"activation_id":  activation.ActivationID,
			"already_active": alreadyActive,
			"content":        activation.Content,
			"content_ref":    activation.ContentRef,
			"root_dir":       activation.RootDir,
			"mode_hints":     activation.ModeHints,
		}
		if reason != "" {
			out["reason"] = reason
		}
		if len(activation.Dependencies) > 0 {
			deps := make([]map[string]any, 0, len(activation.Dependencies))
			for _, dep := range activation.Dependencies {
				deps = append(deps, map[string]any{
					"name":      dep.Name,
					"transport": dep.Transport,
					"command":   dep.Command,
					"url":       dep.URL,
				})
			}
			out["dependencies"] = deps
			out["dependency_degraded"] = true
		}
		return out, nil

	case "subagents":
		if meta == nil || !meta.CanExecute {
			return nil, errors.New("execute permission denied")
		}
		return r.manageSubagents(ctx, cloneAnyMap(args))

	default:
		return nil, fmt.Errorf("unknown tool: %s", toolName)
	}
}

func (r *run) shouldRouteTargetTool(toolName string) bool {
	return toolRequiresTarget(toolName) && r.toolTargetPolicy.requiresExplicitTarget()
}

func (r *run) execTargetTool(ctx context.Context, toolID string, toolName string, args map[string]any) (any, error) {
	policy := normalizeToolTargetPolicy(r.toolTargetPolicy)
	targetID := targetIDFromToolArgs(args)
	if strings.TrimSpace(targetID) == "" {
		targetID = strings.TrimSpace(policy.DefaultTargetID)
	}
	if strings.TrimSpace(targetID) == "" {
		return nil, &targetToolPolicyError{
			code:   "missing_target_id",
			tool:   toolName,
			target: "",
		}
	}
	if !targetAllowedByPolicy(policy, targetID) {
		return nil, &targetToolPolicyError{
			code:   "target_not_allowed",
			tool:   toolName,
			target: targetID,
		}
	}
	if r.targetToolExecutor == nil {
		return nil, &targetToolPolicyError{
			code:   "target_executor_unavailable",
			tool:   toolName,
			target: targetID,
		}
	}
	forwardedArgs := StripTargetToolArgs(args)
	rawArgs, err := json.Marshal(forwardedArgs)
	if err != nil {
		return nil, errors.New("invalid args")
	}
	result, err := r.targetToolExecutor.ExecuteTargetTool(ctx, TargetToolCall{
		ToolCallID:           strings.TrimSpace(toolID),
		TargetID:             targetID,
		ToolName:             strings.TrimSpace(toolName),
		Arguments:            rawArgs,
		RequiredCapabilities: requiredTargetCapabilities(toolName),
	})
	if err != nil {
		return nil, err
	}
	return result.Result, nil
}

type targetToolPolicyError struct {
	code   string
	tool   string
	target string
}

func (e *targetToolPolicyError) Error() string {
	switch strings.TrimSpace(e.code) {
	case "missing_target_id":
		return "target_id is required for target-scoped Flower tools"
	case "target_executor_unavailable":
		return "target tool executor is unavailable"
	case "target_not_allowed":
		return "target_id is not allowed for this Flower thread"
	default:
		return "target tool policy denied the tool call"
	}
}

func (e *targetToolPolicyError) InvalidArgumentsCode() string {
	return e.code
}

func (e *targetToolPolicyError) InvalidArgumentsMeta() map[string]any {
	out := map[string]any{
		"tool_name": strings.TrimSpace(e.tool),
	}
	if strings.TrimSpace(e.target) != "" {
		out["target_id"] = strings.TrimSpace(e.target)
	}
	return out
}

var (
	errEmptyWorkingDir      = errors.New("empty working_dir")
	errInvalidWorkingDir    = errors.New("invalid working_dir")
	errInvalidToolPath      = errors.New("invalid path")
	errToolPathMustAbsolute = errors.New("path must be absolute")
)

func (r *run) workingDirAbs() (string, error) {
	scope, err := r.runPathScope()
	if err != nil {
		return "", err
	}
	return scope.WorkingDirAbs, nil
}

type runPathScope struct {
	Registry      *filesystemscope.Registry
	WorkingDirAbs string
}

func (s runPathScope) resolveInput(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	if path == "~" || strings.HasPrefix(path, "~/") || filepath.IsAbs(path) {
		return path
	}
	if strings.TrimSpace(s.WorkingDirAbs) == "" {
		return path
	}
	return filepath.Join(s.WorkingDirAbs, path)
}

func (s runPathScope) ResolveExistingPath(path string) (string, error) {
	if s.Registry == nil {
		return "", errors.New("nil filesystem scope")
	}
	resolved, err := s.Registry.Resolve(s.resolveInput(path), filesystemscope.ResolveOptions{RequireExisting: true})
	if err != nil {
		return "", err
	}
	return resolved.RealAbs, nil
}

func (s runPathScope) ResolveTargetPath(path string) (string, error) {
	if s.Registry == nil {
		return "", errors.New("nil filesystem scope")
	}
	resolved, err := s.Registry.ResolveTarget(s.resolveInput(path), filesystemscope.ResolveOptions{})
	if err != nil {
		return "", err
	}
	return resolved.RealAbs, nil
}

func (r *run) runPathScope() (runPathScope, error) {
	workingDir := strings.TrimSpace(r.workingDir)
	if workingDir == "" {
		workingDir = strings.TrimSpace(r.agentHomeDir)
	}
	if workingDir == "" {
		return runPathScope{}, errEmptyWorkingDir
	}
	registry := r.scope
	if registry == nil {
		var err error
		registry, err = filesystemscope.NewDefaultRegistry(r.agentHomeDir)
		if err != nil {
			return runPathScope{}, errInvalidWorkingDir
		}
	}
	resolved, err := registry.Resolve(workingDir, filesystemscope.ResolveOptions{RequireExisting: true, RequireDir: true})
	if err != nil {
		return runPathScope{}, errInvalidWorkingDir
	}
	return runPathScope{Registry: registry, WorkingDirAbs: resolved.RealAbs}, nil
}

func (r *run) resolveToolPath(raw string, workingDirAbs string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errInvalidToolPath
	}
	scope, err := r.runPathScope()
	if err != nil {
		return "", errInvalidWorkingDir
	}
	if strings.TrimSpace(workingDirAbs) != "" {
		scope.WorkingDirAbs = strings.TrimSpace(workingDirAbs)
	}
	resolved, err := scope.ResolveTargetPath(raw)
	if err != nil {
		return "", errInvalidToolPath
	}
	return resolved, nil
}

func mapToolCwdError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, errToolPathMustAbsolute):
		return errors.New("cwd must be absolute")
	default:
		return errors.New("invalid cwd")
	}
}

func (r *run) toolApplyPatch(ctx context.Context, patchText string) (any, error) {
	patchText = strings.TrimSpace(patchText)
	if patchText == "" {
		return nil, errors.New("missing patch")
	}

	workingDirAbs, err := r.workingDirAbs()
	if err != nil {
		return nil, mapToolCwdError(err)
	}

	if err := ctx.Err(); err != nil {
		return nil, err
	}
	parsed, err := applyUnifiedDiff(workingDirAbs, patchText)
	if err != nil {
		return nil, err
	}

	filesChanged, hunks, additions, deletions, files := summarizePatchFiles(parsed.files)
	return ApplyPatchResult{
		FilesChanged:     filesChanged,
		Hunks:            hunks,
		Additions:        additions,
		Deletions:        deletions,
		InputFormat:      string(parsed.inputFormat),
		NormalizedFormat: string(parsed.normalizedFormat),
		Files:            files,
		Mutations:        parsed.mutations,
	}, nil
}

func (r *run) normalizeTerminalExecCwd(cwd string, workdir string) (string, error) {
	cwd = strings.TrimSpace(cwd)
	workdir = strings.TrimSpace(workdir)
	if cwd == "" {
		return workdir, nil
	}
	if workdir == "" {
		return cwd, nil
	}
	workingDirAbs, err := r.workingDirAbs()
	if err != nil {
		return "", mapToolCwdError(err)
	}
	resolvedCwd, err := r.resolveToolPath(cwd, workingDirAbs)
	if err != nil {
		return "", errors.New("invalid cwd")
	}
	resolvedWorkdir, err := r.resolveToolPath(workdir, workingDirAbs)
	if err != nil {
		return "", errors.New("invalid cwd")
	}
	if filepath.Clean(resolvedCwd) != filepath.Clean(resolvedWorkdir) {
		return "", errors.New("invalid cwd")
	}
	return resolvedCwd, nil
}

func summarizeUnifiedDiff(patchText string) (filesChanged int, hunks int, additions int, deletions int) {
	parsed, err := parsePatchText(patchText)
	if err != nil {
		return 0, 0, 0, 0
	}
	filesChanged, hunks, additions, deletions, _ = summarizePatchFiles(parsed.files)
	return filesChanged, hunks, additions, deletions
}

// --- terminal.exec ---

const (
	terminalExecFallbackDefaultTimeoutMS = 120_000
	terminalExecWaitAfterKillTimeout     = 2 * time.Second
)

const (
	terminalExecTimeoutSourceDefault   = "default"
	terminalExecTimeoutSourceRequested = "requested"
	terminalExecTimeoutSourceCapped    = "capped"
)

type terminalExecTimeoutDecision struct {
	RequestedMS int64
	EffectiveMS int64
	DefaultMS   int64
	MaxMS       int64
	Source      string
}

type terminalExecInvocation struct {
	Shell         string
	Command       string
	Stdin         string
	WorkingDirAbs string
	Env           []string
}

type terminalExecOutcome struct {
	Stdout     string
	Stderr     string
	ExitCode   int
	DurationMS int64
	Truncated  bool
	TimedOut   bool
}

func resolveTerminalExecTimeoutDecision(cfg *config.AIConfig, requestedMS int64) terminalExecTimeoutDecision {
	defaultMS := cfg.EffectiveTerminalExecDefaultTimeoutMS()
	maxMS := cfg.EffectiveTerminalExecMaxTimeoutMS()
	if maxMS <= 0 {
		maxMS = terminalExecFallbackDefaultTimeoutMS
	}
	if defaultMS <= 0 {
		defaultMS = terminalExecFallbackDefaultTimeoutMS
	}
	if defaultMS > maxMS {
		defaultMS = maxMS
	}

	decision := terminalExecTimeoutDecision{
		RequestedMS: requestedMS,
		EffectiveMS: defaultMS,
		DefaultMS:   defaultMS,
		MaxMS:       maxMS,
		Source:      terminalExecTimeoutSourceDefault,
	}
	if requestedMS <= 0 {
		return decision
	}
	if requestedMS > maxMS {
		decision.EffectiveMS = maxMS
		decision.Source = terminalExecTimeoutSourceCapped
		return decision
	}
	decision.EffectiveMS = requestedMS
	decision.Source = terminalExecTimeoutSourceRequested
	return decision
}

func terminalExecTimeoutDecisionResult(decision terminalExecTimeoutDecision) map[string]any {
	out := map[string]any{
		"timeout_ms":     decision.EffectiveMS,
		"timeout_source": strings.TrimSpace(decision.Source),
	}
	if decision.RequestedMS > 0 {
		out["requested_timeout_ms"] = decision.RequestedMS
	}
	return out
}

func (r *run) toolTerminalExec(ctx context.Context, command string, stdin string, cwd string, timeoutMS int64) (any, error) {
	command = strings.TrimSpace(command)
	if command == "" {
		return nil, errors.New("missing command")
	}
	if len(stdin) > 200_000 {
		return nil, errors.New("stdin too large")
	}
	timeoutDecision := resolveTerminalExecTimeoutDecision(r.cfg, timeoutMS)
	timeoutMS = timeoutDecision.EffectiveMS

	workingDirAbs, err := r.workingDirAbs()
	if err != nil {
		return nil, mapToolCwdError(err)
	}
	cwd = strings.TrimSpace(cwd)
	if cwd == "" {
		cwd = workingDirAbs
	}
	cwdAbs, err := r.resolveToolPath(cwd, workingDirAbs)
	if err != nil {
		return nil, mapToolCwdError(err)
	}

	execCtx := ctx
	var cancel context.CancelFunc
	execCtx, cancel = context.WithTimeout(execCtx, time.Duration(timeoutMS)*time.Millisecond)
	defer cancel()

	started := time.Now()

	shell := strings.TrimSpace(r.shell)
	if shell == "" {
		shell = "/bin/bash"
	}
	runner := r.terminalExecRunner
	if runner == nil {
		runner = defaultTerminalExecRunner
	}
	outcome, runErr := runner(execCtx, terminalExecInvocation{
		Shell:         shell,
		Command:       command,
		Stdin:         stdin,
		WorkingDirAbs: cwdAbs,
		Env:           prependRedevenBinToEnv(os.Environ()),
	})
	if runErr != nil {
		return nil, runErr
	}
	if outcome.DurationMS <= 0 {
		outcome.DurationMS = time.Since(started).Milliseconds()
	}

	result := map[string]any{
		"stdout":      outcome.Stdout,
		"stderr":      outcome.Stderr,
		"exit_code":   outcome.ExitCode,
		"duration_ms": outcome.DurationMS,
		"truncated":   outcome.Truncated,
		"timed_out":   outcome.TimedOut,
	}
	for k, v := range terminalExecTimeoutDecisionResult(timeoutDecision) {
		result[k] = v
	}
	return result, nil
}

func defaultTerminalExecRunner(ctx context.Context, inv terminalExecInvocation) (terminalExecOutcome, error) {
	cmd := exec.Command(inv.Shell, "-lc", inv.Command)
	cmd.Dir = inv.WorkingDirAbs
	cmd.Env = append([]string(nil), inv.Env...)
	configureTerminalExecProcessGroup(cmd)
	if inv.Stdin != "" {
		cmd.Stdin = strings.NewReader(inv.Stdin)
	}

	started := time.Now()
	lim := newCombinedLimitedBuffers(200_000)
	cmd.Stdout = lim.Stdout()
	cmd.Stderr = lim.Stderr()

	if err := cmd.Start(); err != nil {
		return terminalExecOutcome{}, err
	}
	done := make(chan error, 1)
	go func() {
		done <- cmd.Wait()
	}()

	runErr := error(nil)
	select {
	case runErr = <-done:
	case <-ctx.Done():
		_ = terminateTerminalExecProcessTree(cmd)
		select {
		case runErr = <-done:
		case <-time.After(terminalExecWaitAfterKillTimeout):
			return terminalExecOutcome{}, ctx.Err()
		}
	}

	outcome := terminalExecOutcome{
		Stdout:     lim.StdoutString(),
		Stderr:     lim.StderrString(),
		DurationMS: time.Since(started).Milliseconds(),
		Truncated:  lim.Truncated(),
		TimedOut:   errors.Is(ctx.Err(), context.DeadlineExceeded),
	}
	if runErr == nil {
		return outcome, nil
	}
	if outcome.TimedOut {
		outcome.ExitCode = 124
		return outcome, nil
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		return terminalExecOutcome{}, context.Canceled
	}
	if ee := (*exec.ExitError)(nil); errors.As(runErr, &ee) {
		outcome.ExitCode = ee.ExitCode()
		return outcome, nil
	}
	return terminalExecOutcome{}, runErr
}

func terminalExecTimeoutToolError(result any) *aitools.ToolError {
	resultMap, _ := result.(map[string]any)
	if resultMap == nil || !readBoolField(resultMap, "timed_out", "timedOut") {
		return nil
	}
	timeoutMS := readInt64Field(resultMap, "timeout_ms", "timeoutMs")
	if timeoutMS <= 0 {
		timeoutMS = terminalExecFallbackDefaultTimeoutMS
	}
	timeoutSource := strings.TrimSpace(readStringField(resultMap, "timeout_source", "timeoutSource"))
	requestedTimeoutMS := readInt64Field(resultMap, "requested_timeout_ms", "requestedTimeoutMs")
	exitCode := readIntField(resultMap, "exit_code", "exitCode")
	toolErr := &aitools.ToolError{
		Code:      aitools.ErrorCodeTimeout,
		Message:   fmt.Sprintf("Tool execution timed out after %d ms", timeoutMS),
		Retryable: true,
		SuggestedFixes: []string{
			"Retry with a smaller scope.",
			"Increase timeout_ms when the command is legitimately long-running.",
			"Do not repeat the same timed-out command unchanged; switch strategy if progress stalls.",
		},
		Meta: map[string]any{
			"timed_out":  true,
			"timeout_ms": timeoutMS,
		},
	}
	if timeoutSource != "" {
		toolErr.Meta["timeout_source"] = timeoutSource
	}
	if requestedTimeoutMS > 0 {
		toolErr.Meta["requested_timeout_ms"] = requestedTimeoutMS
	}
	if exitCode != 0 {
		toolErr.Meta["exit_code"] = exitCode
	}
	toolErr.Normalize()
	return toolErr
}

func prependRedevenBinToEnv(baseEnv []string) []string {
	envMap := make(map[string]string, len(baseEnv))
	order := make([]string, 0, len(baseEnv))
	for _, kv := range baseEnv {
		idx := strings.Index(kv, "=")
		if idx <= 0 {
			continue
		}
		key := kv[:idx]
		val := kv[idx+1:]
		if _, ok := envMap[key]; !ok {
			order = append(order, key)
		}
		envMap[key] = val
	}

	home := strings.TrimSpace(envMap["HOME"])
	if home == "" {
		if h, err := os.UserHomeDir(); err == nil {
			home = strings.TrimSpace(h)
		}
	}
	if home != "" {
		redevenBin := filepath.Join(home, ".redeven", "bin")
		pathVal := strings.TrimSpace(envMap["PATH"])
		parts := strings.Split(pathVal, string(os.PathListSeparator))
		hasRedevenBin := false
		for _, part := range parts {
			if filepath.Clean(strings.TrimSpace(part)) == filepath.Clean(redevenBin) {
				hasRedevenBin = true
				break
			}
		}
		if !hasRedevenBin {
			if pathVal == "" {
				envMap["PATH"] = redevenBin
			} else {
				envMap["PATH"] = redevenBin + string(os.PathListSeparator) + pathVal
			}
			if _, ok := envMap["PATH"]; ok {
				found := false
				for _, key := range order {
					if key == "PATH" {
						found = true
						break
					}
				}
				if !found {
					order = append(order, "PATH")
				}
			}
		}
	}

	out := make([]string, 0, len(order))
	for _, key := range order {
		out = append(out, key+"="+envMap[key])
	}
	if _, ok := envMap["PATH"]; ok {
		pathSeen := false
		for _, key := range order {
			if key == "PATH" {
				pathSeen = true
				break
			}
		}
		if !pathSeen {
			out = append(out, "PATH="+envMap["PATH"])
		}
	}
	return out
}
