package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/floegence/redeven-agent/internal/ai/threadstore"
	aitools "github.com/floegence/redeven-agent/internal/ai/tools"
	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
)

type runOptions struct {
	Log      *slog.Logger
	StateDir string
	FSRoot   string
	Shell    string

	AIConfig *config.AIConfig

	SessionMeta        *session.Meta
	ResolveProviderKey func(providerID string) (string, bool, error)

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
}

type run struct {
	log *slog.Logger

	stateDir string
	fsRoot   string
	shell    string
	cfg      *config.AIConfig
	runMode  string

	sessionMeta        *session.Meta
	resolveProviderKey func(providerID string) (string, bool, error)

	id           string
	channelID    string
	endpointID   string
	threadID     string
	userPublicID string
	messageID    string

	maxWallTime    time.Duration
	idleTimeout    time.Duration
	toolApprovalTO time.Duration
	doneCh         chan struct{}
	doneOnce       sync.Once

	muCancel        sync.Mutex
	cancelReason    string // "canceled"|"timed_out"|""
	endReason       string // "complete"|"canceled"|"timed_out"|"disconnected"|"error"
	cancelRequested bool
	cancelFn        context.CancelFunc

	uploadsDir       string
	threadsDB        *threadstore.Store
	persistOpTimeout time.Duration

	onStreamEvent func(any)
	w             http.ResponseWriter
	stream        *ndjsonStream

	mu              sync.Mutex
	toolApprovals   map[string]chan bool // tool_id -> decision channel
	toolBlockIndex  map[string]int       // tool_id -> blockIndex
	waitingApproval bool

	muLifecycle         sync.Mutex
	lastLifecyclePhase  string
	lastLifecycleAt     time.Time
	lifecycleMinEmitGap time.Duration

	nextBlockIndex        int
	currentTextBlockIndex int
	needNewTextBlock      bool

	muAssistant              sync.Mutex
	assistantCreatedAtUnixMs int64
	assistantBlocks          []any

	finalizationReason string
	currentModelID     string

	subagentDepth         int
	allowSubagentDelegate bool
	toolAllowlist         map[string]struct{}

	skillManager    *skillManager
	subagentManager *subagentManager
}

func newRun(opts runOptions) *run {
	var runMeta *session.Meta
	if opts.SessionMeta != nil {
		metaCopy := *opts.SessionMeta
		runMeta = &metaCopy
	}

	r := &run{
		log:                 opts.Log,
		stateDir:            strings.TrimSpace(opts.StateDir),
		fsRoot:              strings.TrimSpace(opts.FSRoot),
		shell:               strings.TrimSpace(opts.Shell),
		cfg:                 opts.AIConfig,
		sessionMeta:         runMeta,
		resolveProviderKey:  opts.ResolveProviderKey,
		id:                  strings.TrimSpace(opts.RunID),
		channelID:           strings.TrimSpace(opts.ChannelID),
		endpointID:          strings.TrimSpace(opts.EndpointID),
		threadID:            strings.TrimSpace(opts.ThreadID),
		userPublicID:        strings.TrimSpace(opts.UserPublicID),
		messageID:           strings.TrimSpace(opts.MessageID),
		uploadsDir:          strings.TrimSpace(opts.UploadsDir),
		threadsDB:           opts.ThreadsDB,
		persistOpTimeout:    opts.PersistOpTimeout,
		onStreamEvent:       opts.OnStreamEvent,
		w:                   opts.Writer,
		toolApprovals:       make(map[string]chan bool),
		toolBlockIndex:      make(map[string]int),
		maxWallTime:         opts.MaxWallTime,
		idleTimeout:         opts.IdleTimeout,
		toolApprovalTO:      opts.ToolApprovalTimeout,
		doneCh:              make(chan struct{}),
		lifecycleMinEmitGap: 600 * time.Millisecond,
		subagentDepth:       opts.SubagentDepth,
		allowSubagentDelegate: func() bool {
			if opts.AllowSubagentDelegate {
				return true
			}
			return opts.SubagentDepth <= 0
		}(),
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

func (r *run) sendStreamEvent(ev any) {
	if r == nil || ev == nil {
		return
	}
	if r.onStreamEvent != nil {
		r.onStreamEvent(ev)
	}
	if r.stream == nil {
		return
	}
	if err := r.stream.send(ev); err != nil {
		if r.log != nil {
			r.log.Debug("ai stream sink write failed", "run_id", r.id, "error", err)
		}
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
	ch := r.toolApprovals[toolID]
	r.mu.Unlock()
	if ch == nil {
		return errors.New("tool not pending approval")
	}

	select {
	case ch <- approved:
		return nil
	default:
		// already decided
		return nil
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
		errCode := string(aitools.ErrorCodeUnknown)
		errMsg := strings.TrimSpace(errorString(retErr))
		eventType := "run.error"
		switch endReason {
		case "complete":
			state = RunStateSuccess
			errCode = ""
			errMsg = ""
			eventType = "run.end"
		case "canceled":
			state = RunStateCanceled
			errCode = ""
			errMsg = ""
			eventType = "run.end"
		case "timed_out":
			state = RunStateTimedOut
			errCode = string(aitools.ErrorCodeTimeout)
			if errMsg == "" {
				errMsg = "Timed out"
			}
		case "disconnected":
			state = RunStateFailed
			errCode = string(aitools.ErrorCodeUnknown)
			if errMsg == "" {
				errMsg = "Disconnected"
			}
		case "error":
			state = RunStateFailed
			errCode = string(aitools.ErrorCodeUnknown)
		}
		r.persistRunRecord(state, errCode, errMsg, startedAt.UnixMilli(), time.Now().UnixMilli())
		finalizationReason := strings.TrimSpace(r.getFinalizationReason())
		r.persistRunEvent(eventType, RealtimeStreamKindLifecycle, map[string]any{
			"state":               string(state),
			"error_code":          errCode,
			"error":               errMsg,
			"finalization_reason": finalizationReason,
		})
		r.debug("ai.run.end",
			"end_reason", endReason,
			"finalization_reason", finalizationReason,
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

	// Initial assistant message + first markdown block.
	r.muAssistant.Lock()
	r.assistantCreatedAtUnixMs = time.Now().UnixMilli()
	r.assistantBlocks = []any{&persistedMarkdownBlock{Type: "markdown", Content: ""}}
	r.muAssistant.Unlock()
	r.nextBlockIndex = 1
	r.currentTextBlockIndex = 0
	r.needNewTextBlock = false

	r.sendStreamEvent(streamEventMessageStart{Type: "message-start", MessageID: r.messageID})
	r.sendStreamEvent(streamEventBlockStart{Type: "block-start", MessageID: r.messageID, BlockIndex: 0, BlockType: "markdown"})
	r.emitLifecyclePhase("planning", nil)

	modelID := strings.TrimSpace(req.Model)
	r.currentModelID = modelID
	providerID, _, ok := strings.Cut(modelID, "/")
	providerID = strings.TrimSpace(providerID)
	if r.cfg == nil {
		return r.failRun("AI not configured", errors.New("ai not configured"))
	}
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
	if !ok || providerID == "" {
		return r.failRun("Invalid model id", fmt.Errorf("invalid model id %q", modelID))
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
		return r.failRun("Unknown AI provider", fmt.Errorf("unknown provider %q", providerID))
	}

	providerDisplay := providerID
	if n := strings.TrimSpace(providerCfg.Name); n != "" {
		providerDisplay = n + " (" + providerID + ")"
	}

	if r.resolveProviderKey == nil {
		return r.failRun("AI provider key resolver not configured", errors.New("missing provider key resolver"))
	}
	apiKey, ok, err := r.resolveProviderKey(providerID)
	if err != nil {
		return r.failRun("Failed to load AI provider key", err)
	}
	if !ok || strings.TrimSpace(apiKey) == "" {
		return r.failRun(
			fmt.Sprintf("AI provider %q is missing API key. Open Settings to configure it.", providerDisplay),
			fmt.Errorf("missing api key for provider %q", providerID),
		)
	}

	if !r.shouldUseNativeRuntime(providerCfg) {
		return r.failRun("Unsupported AI provider type", fmt.Errorf("unsupported provider type %q", strings.TrimSpace(providerCfg.Type)))
	}
	return r.runNative(ctx, req, *providerCfg, strings.TrimSpace(apiKey), strings.TrimSpace(taskObjective))
}

func (r *run) appendTextDelta(delta string) error {
	if r == nil || delta == "" {
		return nil
	}
	if r.needNewTextBlock {
		idx := r.nextBlockIndex
		r.nextBlockIndex++
		r.currentTextBlockIndex = idx
		r.needNewTextBlock = false
		r.sendStreamEvent(streamEventBlockStart{Type: "block-start", MessageID: r.messageID, BlockIndex: idx, BlockType: "markdown"})
		r.persistSetMarkdownBlock(idx)
	}
	r.persistAppendMarkdownDelta(r.currentTextBlockIndex, delta)
	r.sendStreamEvent(streamEventBlockDelta{Type: "block-delta", MessageID: r.messageID, BlockIndex: r.currentTextBlockIndex, Delta: delta})
	return nil
}

func (r *run) hasNonEmptyAssistantText() bool {
	if r == nil {
		return false
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	for _, blk := range r.assistantBlocks {
		b, ok := blk.(*persistedMarkdownBlock)
		if !ok || b == nil {
			continue
		}
		if strings.TrimSpace(b.Content) != "" {
			return true
		}
	}
	return false
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

	msg := strings.TrimSpace(errMsg)
	if msg == "" && cause != nil {
		msg = strings.TrimSpace(cause.Error())
	}
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

func requiresApproval(toolName string) bool {
	return aitools.RequiresApproval(toolName)
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

func (r *run) persistToolCallSnapshot(toolID string, toolName string, status ToolCallStatus, args map[string]any, result any, toolErr *aitools.ToolError, recoveryAction string, startedAt time.Time, endedAt time.Time) {
	if r == nil {
		return
	}
	argsPersist := marshalPersistJSON(redactAnyForLog("args", args, 0), 4000)
	resultPersist := ""
	if result != nil {
		resultPersist = marshalPersistJSON(redactAnyForLog("result", result, 0), 4000)
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
		Status:          strings.TrimSpace(string(status)),
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

	outcome := &toolCallOutcome{
		Success:        false,
		ToolName:       toolName,
		Args:           cloneAnyMap(args),
		ToolError:      nil,
		RecoveryAction: "",
	}

	toolStartedAt := time.Now()
	toolSpanID := executionSpanID(r.id, toolName, toolID)
	r.persistRunEvent("tool.call", RealtimeStreamKindTool, map[string]any{
		"tool_id":   toolID,
		"tool_name": toolName,
		"args":      redactAnyForLog("args", args, 0),
	})
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
		"requires_approval", requiresApproval(toolName),
		"args_preview", previewAnyForLog(redactToolArgsForLog(toolName, args), 512),
	)

	r.mu.Lock()
	idx := r.nextBlockIndex
	r.nextBlockIndex++
	r.needNewTextBlock = true
	r.toolBlockIndex[toolID] = idx
	r.mu.Unlock()

	r.sendStreamEvent(streamEventBlockStart{Type: "block-start", MessageID: r.messageID, BlockIndex: idx, BlockType: "tool-call"})

	block := ToolCallBlock{
		Type:     "tool-call",
		ToolName: toolName,
		ToolID:   toolID,
		Args:     args,
		Status:   ToolCallStatusPending,
	}

	if requiresApproval(toolName) {
		block.RequiresApproval = true
		block.ApprovalState = "required"
	}

	r.sendStreamEvent(streamEventBlockSet{Type: "block-set", MessageID: r.messageID, BlockIndex: idx, Block: block})
	r.persistSetToolBlock(idx, block)
	r.persistToolCallSnapshot(toolID, toolName, block.Status, args, nil, nil, "", toolStartedAt, time.Now())

	setToolError := func(toolErr *aitools.ToolError, recoveryAction string) {
		if toolErr == nil {
			toolErr = &aitools.ToolError{Code: aitools.ErrorCodeUnknown, Message: "Tool failed"}
		}
		toolErr.Normalize()
		outcome.Success = false
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
		block.Status = ToolCallStatusError
		block.Error = toolErr.Message
		block.ErrorDetails = toolErr
		r.sendStreamEvent(streamEventBlockSet{Type: "block-set", MessageID: r.messageID, BlockIndex: idx, Block: block})
		r.persistSetToolBlock(idx, block)
		r.persistToolCallSnapshot(toolID, toolName, block.Status, args, nil, toolErr, recoveryAction, toolStartedAt, time.Now())
		r.persistRunEvent("tool.error", RealtimeStreamKindTool, map[string]any{
			"tool_id":   toolID,
			"tool_name": toolName,
			"error":     toolErr,
		})
		errPayload := map[string]any{
			"tool_id":         toolID,
			"tool_name":       toolName,
			"status":          "failed",
			"error":           toolErr,
			"recovery_action": strings.TrimSpace(recoveryAction),
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

	if strings.TrimSpace(r.runMode) == config.AIModePlan && aitools.IsMutating(toolName) {
		toolErr := &aitools.ToolError{
			Code:      aitools.ErrorCodePermissionDenied,
			Message:   "Tool is disabled in plan mode",
			Retryable: false,
			SuggestedFixes: []string{
				"Switch AI mode to act to enable mutating tools.",
			},
		}
		setToolError(toolErr, "")
		return outcome, nil
	}

	meta, err := r.sessionMetaForTool()
	if err != nil {
		toolErr := aitools.ClassifyError(aitools.Invocation{ToolName: toolName, Args: args, WorkingDir: r.fsRoot}, err)
		setToolError(toolErr, "")
		return outcome, nil
	}

	if block.RequiresApproval {
		ch := make(chan bool, 1)
		r.mu.Lock()
		r.toolApprovals[toolID] = ch
		r.waitingApproval = true
		r.mu.Unlock()
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
			block.ApprovalState = "rejected"
			toolErr := &aitools.ToolError{Code: aitools.ErrorCodeCanceled, Message: "Canceled", Retryable: false}
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				toolErr = &aitools.ToolError{Code: aitools.ErrorCodeTimeout, Message: "Timed out", Retryable: true}
			}
			setToolError(toolErr, "")
			return outcome, nil
		}
		if timedOut {
			toolErr := &aitools.ToolError{Code: aitools.ErrorCodeTimeout, Message: "Approval timed out", Retryable: true}
			block.ApprovalState = "rejected"
			setToolError(toolErr, "")
			return outcome, nil
		}
		if !approved {
			toolErr := &aitools.ToolError{Code: aitools.ErrorCodePermissionDenied, Message: "Rejected by user", Retryable: false}
			block.ApprovalState = "rejected"
			setToolError(toolErr, "")
			return outcome, nil
		}

		block.ApprovalState = "approved"
		r.persistRunEvent("tool.approval.approved", RealtimeStreamKindLifecycle, map[string]any{"tool_id": toolID, "tool_name": toolName})
		r.debug("ai.run.tool.approval.approved", "tool_id", toolID, "tool_name", toolName)
	}

	r.debug("ai.run.tool.exec.start", "tool_id", toolID, "tool_name", toolName)
	block.Status = ToolCallStatusRunning
	r.sendStreamEvent(streamEventBlockSet{Type: "block-set", MessageID: r.messageID, BlockIndex: idx, Block: block})
	r.persistSetToolBlock(idx, block)
	r.persistToolCallSnapshot(toolID, toolName, block.Status, args, nil, nil, "", toolStartedAt, time.Now())

	result, toolErrRaw := r.execTool(ctx, meta, toolName, args)
	if toolErrRaw != nil {
		if errors.Is(toolErrRaw, context.Canceled) {
			setToolError(&aitools.ToolError{Code: aitools.ErrorCodeCanceled, Message: "Canceled", Retryable: false}, "")
			return outcome, nil
		}
		if errors.Is(toolErrRaw, context.DeadlineExceeded) {
			setToolError(&aitools.ToolError{Code: aitools.ErrorCodeTimeout, Message: "Tool execution timed out", Retryable: true}, "")
			return outcome, nil
		}
		toolErr := aitools.ClassifyError(aitools.Invocation{ToolName: toolName, Args: args, WorkingDir: r.fsRoot}, toolErrRaw)
		recoveryAction := ""
		if aitools.ShouldRetryWithNormalizedArgs(toolErr) {
			recoveryAction = "retry_with_normalized_args"
		}
		setToolError(toolErr, recoveryAction)
		return outcome, nil
	}

	block.Status = ToolCallStatusSuccess
	block.Result = result
	block.Error = ""
	block.ErrorDetails = nil
	r.sendStreamEvent(streamEventBlockSet{Type: "block-set", MessageID: r.messageID, BlockIndex: idx, Block: block})
	r.persistSetToolBlock(idx, block)
	r.persistToolCallSnapshot(toolID, toolName, block.Status, args, result, nil, "", toolStartedAt, time.Now())
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

func (r *run) persistSetMarkdownBlock(idx int) {
	if r == nil || idx < 0 {
		return
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	r.persistEnsureIndex(idx)
	r.assistantBlocks[idx] = &persistedMarkdownBlock{Type: "markdown", Content: ""}
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

func (r *run) persistSetToolBlock(idx int, block ToolCallBlock) {
	if r == nil || idx < 0 {
		return
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	r.persistEnsureIndex(idx)
	r.assistantBlocks[idx] = block
}

func (r *run) snapshotAssistantMessageJSON() (string, string, int64, error) {
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
		switch v := blk.(type) {
		case *persistedMarkdownBlock:
			if v == nil {
				blocks = append(blocks, (*persistedMarkdownBlock)(nil))
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
		Status:    "complete",
		Timestamp: assistantAt,
	}
	b, err := json.Marshal(msg)
	if err != nil {
		return "", "", 0, err
	}

	// Text for history: concatenate markdown blocks.
	var sb strings.Builder
	for _, blk := range blocks {
		bm, ok := blk.(*persistedMarkdownBlock)
		if !ok || bm == nil {
			continue
		}
		if strings.TrimSpace(bm.Content) == "" {
			continue
		}
		if sb.Len() > 0 {
			sb.WriteString("\n")
		}
		sb.WriteString(bm.Content)
	}

	return string(b), strings.TrimSpace(sb.String()), assistantAt, nil
}

func (r *run) execTool(ctx context.Context, meta *session.Meta, toolName string, args map[string]any) (any, error) {
	switch toolName {
	case "fs.list_dir":
		if meta == nil || !meta.CanRead {
			return nil, errors.New("read permission denied")
		}
		var p struct {
			Path string `json:"path"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		return r.toolFSListDir(p.Path)

	case "fs.stat":
		if meta == nil || !meta.CanRead {
			return nil, errors.New("read permission denied")
		}
		var p struct {
			Path string `json:"path"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		return r.toolFSStat(p.Path)

	case "fs.read_file":
		if meta == nil || !meta.CanRead {
			return nil, errors.New("read permission denied")
		}
		var p struct {
			Path     string `json:"path"`
			Offset   int64  `json:"offset"`
			MaxBytes int64  `json:"max_bytes"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		return r.toolFSReadFile(p.Path, p.Offset, p.MaxBytes)

	case "fs.write_file":
		if meta == nil || !meta.CanWrite {
			return nil, errors.New("write permission denied")
		}
		var p struct {
			Path          string `json:"path"`
			ContentUTF8   string `json:"content_utf8"`
			Create        bool   `json:"create"`
			IfMatchSHA256 string `json:"if_match_sha256"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		return r.toolFSWriteFile(p.Path, p.ContentUTF8, p.Create, p.IfMatchSHA256)

	case "terminal.exec":
		if meta == nil || !meta.CanExecute {
			return nil, errors.New("execute permission denied")
		}
		var p struct {
			Command   string `json:"command"`
			Cwd       string `json:"cwd"`
			TimeoutMS int64  `json:"timeout_ms"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		return r.toolTerminalExec(ctx, p.Command, p.Cwd, p.TimeoutMS)

	default:
		return nil, fmt.Errorf("unknown tool: %s", toolName)
	}
}

// --- FS tools ---

var (
	errEmptyWorkingDir      = errors.New("empty working_dir")
	errInvalidWorkingDir    = errors.New("invalid working_dir")
	errInvalidToolPath      = errors.New("invalid path")
	errToolPathMustAbsolute = errors.New("path must be absolute")
)

func (r *run) workingDirAbs() (string, error) {
	workingDir := strings.TrimSpace(r.fsRoot)
	if workingDir == "" {
		return "", errEmptyWorkingDir
	}
	workingDir = filepath.Clean(workingDir)
	if !filepath.IsAbs(workingDir) {
		abs, err := filepath.Abs(workingDir)
		if err != nil {
			return "", errInvalidWorkingDir
		}
		workingDir = filepath.Clean(abs)
	}
	return workingDir, nil
}

func resolveToolPath(raw string, workingDirAbs string) (string, error) {
	candidate := strings.TrimSpace(raw)
	if candidate == "" {
		return "", errInvalidToolPath
	}
	if candidate == "~" || strings.HasPrefix(candidate, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", errInvalidToolPath
		}
		home = strings.TrimSpace(home)
		if home == "" {
			return "", errInvalidToolPath
		}
		if candidate == "~" {
			candidate = home
		} else {
			candidate = filepath.Join(home, strings.TrimPrefix(candidate, "~/"))
		}
	}
	if !filepath.IsAbs(candidate) {
		base := strings.TrimSpace(workingDirAbs)
		if base == "" {
			return "", errToolPathMustAbsolute
		}
		base = filepath.Clean(base)
		if !filepath.IsAbs(base) {
			return "", errInvalidWorkingDir
		}
		candidate = filepath.Join(base, candidate)
	}
	candidate = filepath.Clean(candidate)
	if !filepath.IsAbs(candidate) {
		return "", errToolPathMustAbsolute
	}
	return candidate, nil
}

func mapToolPathError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, errToolPathMustAbsolute):
		return errors.New("path must be absolute")
	default:
		return errors.New("invalid path")
	}
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

func (r *run) toolFSListDir(p string) (any, error) {
	workingDirAbs, err := r.workingDirAbs()
	if err != nil {
		return nil, mapToolPathError(err)
	}
	abs, err := resolveToolPath(p, workingDirAbs)
	if err != nil {
		return nil, mapToolPathError(err)
	}
	ents, err := os.ReadDir(abs)
	if err != nil {
		return nil, errors.New("not found")
	}
	out := make([]map[string]any, 0, len(ents))
	for _, e := range ents {
		if e == nil {
			continue
		}
		info, err := e.Info()
		if err != nil || info == nil {
			continue
		}
		name := e.Name()
		fullPath := filepath.Clean(filepath.Join(abs, name))
		mod := info.ModTime().UnixMilli()
		out = append(out, map[string]any{
			"path":                fullPath,
			"name":                name,
			"is_dir":              info.IsDir(),
			"size":                info.Size(),
			"modified_at_unix_ms": mod,
		})
	}
	return map[string]any{"entries": out}, nil
}

func (r *run) toolFSStat(p string) (any, error) {
	workingDirAbs, err := r.workingDirAbs()
	if err != nil {
		return nil, mapToolPathError(err)
	}
	abs, err := resolveToolPath(p, workingDirAbs)
	if err != nil {
		return nil, mapToolPathError(err)
	}
	info, err := os.Stat(abs)
	if err != nil || info == nil {
		return nil, errors.New("not found")
	}
	mod := info.ModTime().UnixMilli()
	out := map[string]any{
		"path":                abs,
		"is_dir":              info.IsDir(),
		"size":                info.Size(),
		"modified_at_unix_ms": mod,
		"sha256":              "",
	}
	if !info.IsDir() {
		sum, err := sha256File(abs)
		if err != nil {
			return nil, err
		}
		out["sha256"] = sum
	}
	return out, nil
}

func (r *run) toolFSReadFile(p string, offset int64, maxBytes int64) (any, error) {
	if maxBytes <= 0 {
		maxBytes = 200_000
	}
	if maxBytes > 200_000 {
		maxBytes = 200_000
	}
	if offset < 0 {
		return nil, errors.New("offset must be >= 0")
	}

	workingDirAbs, err := r.workingDirAbs()
	if err != nil {
		return nil, mapToolPathError(err)
	}
	abs, err := resolveToolPath(p, workingDirAbs)
	if err != nil {
		return nil, mapToolPathError(err)
	}

	f, err := os.Open(abs)
	if err != nil {
		return nil, errors.New("not found")
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil || info == nil {
		return nil, errors.New("not found")
	}
	size := info.Size()
	if offset > size {
		offset = size
	}
	if _, err := f.Seek(offset, 0); err != nil {
		return nil, errors.New("invalid offset")
	}

	buf := make([]byte, maxBytes+1)
	n, _ := io.ReadFull(f, buf)
	read := buf[:n]
	truncated := false
	if int64(len(read)) > maxBytes {
		truncated = true
		read = read[:maxBytes]
	}
	if !utf8.Valid(read) {
		return nil, errors.New("binary file (not utf-8)")
	}
	return map[string]any{
		"content_utf8": string(read),
		"file_size":    size,
		"truncated":    truncated,
	}, nil
}

func (r *run) toolFSWriteFile(p string, content string, create bool, ifMatch string) (any, error) {
	workingDirAbs, err := r.workingDirAbs()
	if err != nil {
		return nil, mapToolPathError(err)
	}
	abs, err := resolveToolPath(p, workingDirAbs)
	if err != nil {
		return nil, mapToolPathError(err)
	}

	if create {
		if _, err := os.Stat(abs); err == nil {
			return nil, errors.New("file already exists")
		}
	} else {
		info, err := os.Stat(abs)
		if err != nil {
			return nil, errors.New("not found")
		}
		if info.IsDir() {
			return nil, errors.New("path is a directory")
		}

		expected := strings.TrimSpace(ifMatch)
		if expected == "" {
			return nil, errors.New("missing if_match_sha256")
		}
		cur, err := sha256File(abs)
		if err != nil {
			return nil, err
		}
		if !strings.EqualFold(cur, expected) {
			return nil, errors.New("if_match_sha256 mismatch")
		}
	}

	data := []byte(content)
	if err := os.WriteFile(abs, data, 0o644); err != nil {
		return nil, errors.New("write failed")
	}
	sum := sha256.Sum256(data)
	return map[string]any{
		"bytes_written": len(data),
		"sha256":        hex.EncodeToString(sum[:]),
	}, nil
}

func sha256File(p string) (string, error) {
	f, err := os.Open(p)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// --- terminal.exec ---

func (r *run) toolTerminalExec(ctx context.Context, command string, cwd string, timeoutMS int64) (any, error) {
	command = strings.TrimSpace(command)
	if command == "" {
		return nil, errors.New("missing command")
	}
	if timeoutMS <= 0 {
		timeoutMS = 60_000
	}
	if timeoutMS > 60_000 {
		timeoutMS = 60_000
	}

	workingDirAbs, err := r.workingDirAbs()
	if err != nil {
		return nil, mapToolCwdError(err)
	}
	cwd = strings.TrimSpace(cwd)
	if cwd == "" {
		cwd = workingDirAbs
	}
	cwdAbs, err := resolveToolPath(cwd, workingDirAbs)
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
	cmd := exec.CommandContext(execCtx, shell, "-lc", command)
	cmd.Dir = cwdAbs

	lim := newCombinedLimitedBuffers(200_000)
	cmd.Stdout = lim.Stdout()
	cmd.Stderr = lim.Stderr()

	runErr := cmd.Run()
	durationMS := time.Since(started).Milliseconds()

	exitCode := 0
	if runErr != nil {
		if ee := (*exec.ExitError)(nil); errors.As(runErr, &ee) {
			exitCode = ee.ExitCode()
		} else {
			return nil, runErr
		}
	}

	return map[string]any{
		"stdout":      lim.StdoutString(),
		"stderr":      lim.StderrString(),
		"exit_code":   exitCode,
		"duration_ms": durationMS,
		"truncated":   lim.Truncated(),
	}, nil
}
