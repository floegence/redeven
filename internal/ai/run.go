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

	SidecarScriptPath   string
	MaxWallTime         time.Duration
	IdleTimeout         time.Duration
	ToolApprovalTimeout time.Duration
	StreamWriteTimeout  time.Duration

	UploadsDir       string
	ThreadsDB        *threadstore.Store
	PersistOpTimeout time.Duration

	OnStreamEvent func(any)
	Writer        http.ResponseWriter
}

type run struct {
	log *slog.Logger

	stateDir string
	fsRoot   string
	shell    string
	cfg      *config.AIConfig

	sessionMeta        *session.Meta
	resolveProviderKey func(providerID string) (string, bool, error)

	id           string
	channelID    string
	endpointID   string
	threadID     string
	userPublicID string
	messageID    string

	sidecarScriptPath string
	maxWallTime       time.Duration
	idleTimeout       time.Duration
	toolApprovalTO    time.Duration
	doneCh            chan struct{}

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
	sidecar         *sidecarProcess
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

	recoveryEnabled                 bool
	recoveryMaxSteps                int
	recoveryAllowPathRewrite        bool
	recoveryAllowProbeTools         bool
	recoveryFailOnRepeatedSignature bool
	requiresTools                   bool
	totalToolCalls                  int
	recoveryState                   turnRecoveryState
	taskLoopCfg                     taskLoopConfig
	taskLoopProfile                 string
	taskLoopState                   taskLoopState
	finalizationReason              string
}

type sidecarProvider struct {
	ID        string `json:"id"`
	Type      string `json:"type"`
	BaseURL   string `json:"base_url,omitempty"`
	APIKeyEnv string `json:"api_key_env"`
}

const defaultPromptProfileID = "natural_evidence_v2"

func newRun(opts runOptions) *run {
	var runMeta *session.Meta
	if opts.SessionMeta != nil {
		metaCopy := *opts.SessionMeta
		runMeta = &metaCopy
	}

	recoveryEnabled := true
	recoveryMaxSteps := 3
	recoveryAllowPathRewrite := true
	recoveryAllowProbeTools := true
	recoveryFailOnRepeatedSignature := true
	if opts.AIConfig != nil {
		recoveryEnabled = opts.AIConfig.EffectiveToolRecoveryEnabled()
		recoveryMaxSteps = opts.AIConfig.EffectiveToolRecoveryMaxSteps()
		recoveryAllowPathRewrite = opts.AIConfig.EffectiveToolRecoveryAllowPathRewrite()
		recoveryAllowProbeTools = opts.AIConfig.EffectiveToolRecoveryAllowProbeTools()
		recoveryFailOnRepeatedSignature = opts.AIConfig.EffectiveToolRecoveryFailOnRepeatedSignature()
	}

	r := &run{
		log:                             opts.Log,
		stateDir:                        strings.TrimSpace(opts.StateDir),
		fsRoot:                          strings.TrimSpace(opts.FSRoot),
		shell:                           strings.TrimSpace(opts.Shell),
		cfg:                             opts.AIConfig,
		sessionMeta:                     runMeta,
		resolveProviderKey:              opts.ResolveProviderKey,
		id:                              strings.TrimSpace(opts.RunID),
		channelID:                       strings.TrimSpace(opts.ChannelID),
		endpointID:                      strings.TrimSpace(opts.EndpointID),
		threadID:                        strings.TrimSpace(opts.ThreadID),
		userPublicID:                    strings.TrimSpace(opts.UserPublicID),
		messageID:                       strings.TrimSpace(opts.MessageID),
		uploadsDir:                      strings.TrimSpace(opts.UploadsDir),
		threadsDB:                       opts.ThreadsDB,
		persistOpTimeout:                opts.PersistOpTimeout,
		onStreamEvent:                   opts.OnStreamEvent,
		w:                               opts.Writer,
		toolApprovals:                   make(map[string]chan bool),
		toolBlockIndex:                  make(map[string]int),
		sidecarScriptPath:               strings.TrimSpace(opts.SidecarScriptPath),
		maxWallTime:                     opts.MaxWallTime,
		idleTimeout:                     opts.IdleTimeout,
		toolApprovalTO:                  opts.ToolApprovalTimeout,
		doneCh:                          make(chan struct{}),
		recoveryEnabled:                 recoveryEnabled,
		recoveryMaxSteps:                recoveryMaxSteps,
		recoveryAllowPathRewrite:        recoveryAllowPathRewrite,
		recoveryAllowProbeTools:         recoveryAllowProbeTools,
		recoveryFailOnRepeatedSignature: recoveryFailOnRepeatedSignature,
		recoveryState: turnRecoveryState{
			FailureSignatures: map[string]int{},
		},
		taskLoopCfg:         defaultTaskLoopConfig(),
		taskLoopProfile:     defaultTaskLoopProfileID,
		taskLoopState:       newTaskLoopState(""),
		lifecycleMinEmitGap: 600 * time.Millisecond,
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
	if reason != "" {
		r.muCancel.Lock()
		if r.cancelReason == "" {
			r.cancelReason = reason
		}
		r.muCancel.Unlock()
	}
	r.cancel()
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

	r.mu.Lock()
	sc := r.sidecar
	r.mu.Unlock()
	if sc != nil {
		// Best-effort: never block cancel on a stuck sidecar stdin pipe.
		go func() {
			_ = sc.send("run.cancel", map[string]any{"run_id": r.id})
		}()
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

func shouldCommitAttemptAssistantText(summary turnAttemptSummary) bool {
	text := strings.TrimSpace(summary.AssistantText)
	if text == "" {
		return false
	}
	hasTools := summary.ToolCalls > 0 || summary.OutcomeToolCalls > 0 || summary.OutcomeLastStepToolCalls > 0
	if hasTools && summary.OutcomeHasText && !summary.OutcomeNeedsFollowUpHint {
		return true
	}
	if hasTools {
		if !hasSubstantiveAssistantAnswer(text) || looksInterimAssistantText(text) {
			return false
		}
	}
	if hasUnfulfilledActionCommitment(text) && !hasSubstantiveAssistantAnswer(text) {
		return false
	}
	return true
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
	if r == nil {
		return errors.New("nil run")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if strings.TrimSpace(req.Options.PromptProfile) == "" {
		req.Options.PromptProfile = defaultPromptProfileID
	}
	if profileID, _ := resolveTaskLoopConfigProfile(req.Options.LoopProfile); strings.TrimSpace(req.Options.LoopProfile) == "" {
		req.Options.LoopProfile = profileID
	}
	r.setFinalizationReason("")
	startedAt := time.Now()
	r.persistRunRecord(RunStateRunning, "", "", startedAt.UnixMilli(), 0)
	runStartPayload := map[string]any{
		"model":         strings.TrimSpace(req.Model),
		"history_count": len(req.History),
	}
	if req.ContextPackage != nil {
		runStartPayload["context_open_goal"] = strings.TrimSpace(req.ContextPackage.OpenGoal)
		runStartPayload["context_anchor_count"] = len(req.ContextPackage.Anchors)
		runStartPayload["context_summary_chars"] = utf8.RuneCountInString(strings.TrimSpace(req.ContextPackage.HistorySummary))
	}
	runStartPayload["prompt_profile"] = strings.TrimSpace(req.Options.PromptProfile)
	runStartPayload["loop_profile"] = strings.TrimSpace(req.Options.LoopProfile)
	runStartPayload["eval_tag"] = strings.TrimSpace(req.Options.EvalTag)
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
	// Note: timeouts are enforced via an out-of-band goroutine (after sidecar starts) so the run
	// still cancels even when blocked in sc.recv().

	// Resolve provider key for this run, then inject it into the sidecar env.
	modelID := strings.TrimSpace(req.Model)
	providerID, _, ok := strings.Cut(modelID, "/")
	providerID = strings.TrimSpace(providerID)
	if r.cfg == nil {
		return r.failRun("AI not configured", errors.New("ai not configured"))
	}
	workingDirAbs, rootErr := r.workingDirAbs()
	if rootErr != nil {
		return r.failRun("AI working directory not configured", rootErr)
	}
	toolRequiredIntents := r.cfg.EffectiveToolRequiredIntents()
	r.requiresTools = shouldRequireToolExecution(req.Input.Text, toolRequiredIntents)
	r.taskLoopProfile, r.taskLoopCfg = resolveTaskLoopConfigProfile(req.Options.LoopProfile)
	req.Options.LoopProfile = r.taskLoopProfile
	if strings.TrimSpace(req.Options.PromptProfile) == "" {
		req.Options.PromptProfile = defaultPromptProfileID
	}
	taskObjective := strings.TrimSpace(req.Input.Text)
	if req.ContextPackage != nil {
		if v := strings.TrimSpace(req.ContextPackage.TaskObjective); v != "" {
			taskObjective = v
		}
		if v := strings.TrimSpace(req.ContextPackage.OpenGoal); v != "" {
			taskObjective = v
		}
		req.ContextPackage.TaskObjective = taskObjective
		if len(req.ContextPackage.TaskSteps) == 0 {
			req.ContextPackage.TaskSteps = buildTaskStepSketch(taskObjective)
		}
	}
	r.taskLoopState = newTaskLoopState(taskObjective)
	r.debug("ai.run.start",
		"model", modelID,
		"max_steps", req.Options.MaxSteps,
		"prompt_profile", strings.TrimSpace(req.Options.PromptProfile),
		"loop_profile", strings.TrimSpace(r.taskLoopProfile),
		"eval_tag", strings.TrimSpace(req.Options.EvalTag),
		"history_count", len(req.History),
		"attachment_count", len(req.Input.Attachments),
		"input_chars", utf8.RuneCountInString(strings.TrimSpace(req.Input.Text)),
		"working_dir_abs", sanitizeLogText(workingDirAbs, 200),
		"recovery_enabled", r.recoveryEnabled,
		"recovery_max_steps", r.recoveryMaxSteps,
		"recovery_allow_path_rewrite", r.recoveryAllowPathRewrite,
		"recovery_allow_probe_tools", r.recoveryAllowProbeTools,
		"recovery_fail_on_repeated_signature", r.recoveryFailOnRepeatedSignature,
		"requires_tools", r.requiresTools,
	)
	if !ok || providerID == "" {
		return r.failRun("Invalid model id", fmt.Errorf("invalid model id %q", modelID))
	}
	knownProvider := false
	for _, p := range r.cfg.Providers {
		if strings.TrimSpace(p.ID) == providerID {
			knownProvider = true
			break
		}
	}
	if !knownProvider {
		return r.failRun("Unknown AI provider", fmt.Errorf("unknown provider %q", providerID))
	}

	providerDisplay := providerID
	for _, p := range r.cfg.Providers {
		if strings.TrimSpace(p.ID) != providerID {
			continue
		}
		if n := strings.TrimSpace(p.Name); n != "" {
			providerDisplay = n + " (" + providerID + ")"
		}
		break
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

	// Filter out any inherited var with the same name to keep behavior deterministic.
	// The effective key must always come from the local secrets store.
	env := make([]string, 0, len(os.Environ())+1)
	prefix := config.AIProviderAPIKeyEnvFixed + "="
	for _, kv := range os.Environ() {
		if strings.HasPrefix(kv, prefix) {
			continue
		}
		env = append(env, kv)
	}
	env = append(env, prefix+strings.TrimSpace(apiKey))

	sc, err := startSidecar(ctx, r.log, r.stateDir, env, r.sidecarScriptPath)
	if err != nil {
		if r.finalizeIfContextCanceled(ctx) {
			return nil
		}
		return r.failRun("AI sidecar unavailable", err)
	}
	r.mu.Lock()
	r.sidecar = sc
	r.mu.Unlock()
	r.debug("ai.run.sidecar.started", "script_path", sanitizeLogText(r.sidecarScriptPath, 256))
	defer sc.close()
	go func() {
		<-ctx.Done()
		// Ensure recv() unblocks even when sidecar never emits a terminal event.
		sc.close()
	}()

	// Initialize + start.
	providers := make([]sidecarProvider, 0, len(r.cfg.Providers))
	for _, p := range r.cfg.Providers {
		out := sidecarProvider{
			ID:        strings.TrimSpace(p.ID),
			Type:      strings.TrimSpace(p.Type),
			BaseURL:   strings.TrimSpace(p.BaseURL),
			APIKeyEnv: config.AIProviderAPIKeyEnvFixed,
		}
		if out.ID == "" || out.Type == "" {
			continue
		}
		providers = append(providers, out)
	}

	if err := sc.send("initialize", map[string]any{
		"v":         1,
		"run_id":    r.id,
		"providers": providers,
	}); err != nil {
		if r.finalizeIfContextCanceled(ctx) {
			return nil
		}
		return r.failRun("Failed to initialize AI sidecar", err)
	}
	r.debug("ai.run.sidecar.initialized", "provider_count", len(providers))

	// Resolve attachments (best-effort).
	sidecarAttachments := make([]map[string]any, 0, len(req.Input.Attachments))
	for _, a := range req.Input.Attachments {
		att, err := r.loadAttachmentForSidecar(a)
		if err != nil || att == nil {
			continue
		}
		sidecarAttachments = append(sidecarAttachments, att)
	}

	lastRecoveryReason := ""
	lastRecoveryAction := ""
	lastRecoveryErrorCode := ""
	lastRecoveryErrorMessage := ""

	attemptToolMemories := []RunToolMemory{}
	if req.ContextPackage != nil {
		attemptToolMemories = append(attemptToolMemories, req.ContextPackage.ToolMemories...)
	}

	sendRunStart := func(attemptIdx int, history []RunHistoryMsg, input RunInput, includeAttachments bool) error {
		attachments := []map[string]any{}
		if includeAttachments {
			attachments = sidecarAttachments
		}
		budgetLeft := r.recoveryMaxSteps - r.recoveryState.RecoverySteps
		if budgetLeft < 0 {
			budgetLeft = 0
		}
		if req.ContextPackage == nil {
			req.ContextPackage = &RunContextPackage{}
		}
		req.ContextPackage.WorkingDirAbs = workingDirAbs
		req.ContextPackage.ToolMemories = tailRunToolMemories(attemptToolMemories, historyToolMemoryKeep)
		req.ContextPackage.TaskProgressDigest = truncateProgressDigest(r.taskLoopState.LastDigest, 320)
		if strings.TrimSpace(req.ContextPackage.TaskObjective) == "" {
			req.ContextPackage.TaskObjective = strings.TrimSpace(r.taskLoopState.Objective)
		}
		if err := sc.send("run.start", map[string]any{
			"run_id":          r.id,
			"model":           req.Model,
			"mode":            r.cfg.EffectiveMode(),
			"history":         history,
			"context_package": req.ContextPackage,
			"working_dir_abs": workingDirAbs,
			"input": map[string]any{
				"text":        input.Text,
				"attachments": attachments,
			},
			"options": req.Options,
			"recovery": map[string]any{
				"enabled":            r.recoveryEnabled,
				"max_steps":          r.recoveryMaxSteps,
				"requires_tools":     r.requiresTools,
				"attempt_index":      attemptIdx,
				"steps_used":         r.recoveryState.RecoverySteps,
				"budget_left":        budgetLeft,
				"reason":             lastRecoveryReason,
				"action":             lastRecoveryAction,
				"last_error_code":    lastRecoveryErrorCode,
				"last_error_message": lastRecoveryErrorMessage,
			},
		}); err != nil {
			if r.finalizeIfContextCanceled(ctx) {
				return nil
			}
			return r.failRun("Failed to start AI run", err)
		}
		r.debug("ai.run.sidecar.run_start_sent",
			"attempt_index", attemptIdx,
			"attachment_count", len(attachments),
			"history_count", len(history),
			"input_chars", utf8.RuneCountInString(strings.TrimSpace(input.Text)),
			"recovery_steps_used", r.recoveryState.RecoverySteps,
			"recovery_budget_left", budgetLeft,
		)
		return nil
	}

	activityCh := make(chan struct{}, 1)
	signalActivity := func() {
		select {
		case activityCh <- struct{}{}:
		default:
		}
	}
	signalActivity()

	if r.maxWallTime > 0 || r.idleTimeout > 0 {
		go func() {
			var wallTimer *time.Timer
			var idleTimer *time.Timer
			var wallC <-chan time.Time
			var idleC <-chan time.Time
			if r.maxWallTime > 0 {
				wallTimer = time.NewTimer(r.maxWallTime)
				wallC = wallTimer.C
			}
			if r.idleTimeout > 0 {
				idleTimer = time.NewTimer(r.idleTimeout)
				idleC = idleTimer.C
			}
			defer func() {
				if wallTimer != nil {
					wallTimer.Stop()
				}
				if idleTimer != nil {
					idleTimer.Stop()
				}
			}()

			for {
				select {
				case <-ctx.Done():
					return
				case <-activityCh:
					if idleTimer == nil {
						continue
					}
					if !idleTimer.Stop() {
						select {
						case <-idleTimer.C:
						default:
						}
					}
					idleTimer.Reset(r.idleTimeout)
				case <-wallC:
					r.requestCancel("timed_out")
					return
				case <-idleC:
					// While waiting for a tool approval, idle timeout is confusing. Approval timeout is enforced separately.
					r.mu.Lock()
					waiting := r.waitingApproval
					r.mu.Unlock()
					if waiting {
						if idleTimer != nil {
							idleTimer.Reset(r.idleTimeout)
						}
						continue
					}
					r.requestCancel("timed_out")
					return
				}
			}
		}()
	}

	baseHistory := append([]RunHistoryMsg(nil), req.History...)
	attemptHistory := append([]RunHistoryMsg(nil), baseHistory...)
	attemptInput := req.Input
	r.totalToolCalls = 0
	r.recoveryState.RecoverySteps = 0
	r.recoveryState.FailureSignatures = map[string]int{}
	r.recoveryState.CompletionSteps = 0
	r.recoveryState.NoProgressStreak = 0
	r.recoveryState.LastAssistantDigest = ""
	r.recoveryState.AnyToolCallSeen = false
	r.taskLoopState = newTaskLoopState(taskObjective)
	r.persistRunEvent("turn.recovery.config", RealtimeStreamKindLifecycle, map[string]any{
		"enabled":                            r.recoveryEnabled,
		"max_steps":                          r.recoveryMaxSteps,
		"allow_path_rewrite":                 r.recoveryAllowPathRewrite,
		"allow_probe_tools":                  r.recoveryAllowProbeTools,
		"fail_on_repeated_failure_signature": r.recoveryFailOnRepeatedSignature,
		"requires_tools":                     r.requiresTools,
		"tool_required_hints":                toolRequiredIntents,
		"task_max_turns":                     r.taskLoopCfg.MaxTurns,
		"task_max_no_progress":               r.taskLoopCfg.MaxNoProgressTurns,
		"task_max_repeated_signature":        r.taskLoopCfg.MaxRepeatedSignatures,
		"task_objective":                     sanitizeLogText(taskObjective, 240),
	})

	maxAttemptLoops := r.taskLoopCfg.MaxTurns
	if maxAttemptLoops < r.recoveryMaxSteps+4 {
		maxAttemptLoops = r.recoveryMaxSteps + 4
	}
	if maxAttemptLoops < 6 {
		maxAttemptLoops = 6
	}
	if maxAttemptLoops > 32 {
		maxAttemptLoops = 32
	}

	for attemptIdx := 0; ; attemptIdx++ {
		if attemptIdx >= maxAttemptLoops {
			r.persistRunEvent("turn.loop.exhausted", RealtimeStreamKindLifecycle, map[string]any{
				"max_attempts": maxAttemptLoops,
				"steps_used":   r.recoveryState.RecoverySteps,
			})
			_ = r.appendTextDelta(r.loopExhaustionFallbackText(taskObjective, maxAttemptLoops))
			r.setFinalizationReason("task_turn_limit_reached")
			r.setEndReason("complete")
			r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
			return nil
		}
		if deadline, ok := ctx.Deadline(); ok {
			remaining := time.Until(deadline)
			if remaining <= 6*time.Second {
				r.persistRunEvent("turn.deadline.guard", RealtimeStreamKindLifecycle, map[string]any{
					"attempt_index":       attemptIdx,
					"remaining_ms":        remaining.Milliseconds(),
					"max_attempts":        maxAttemptLoops,
					"recovery_steps_used": r.recoveryState.RecoverySteps,
				})
				_ = r.appendTextDelta(r.loopExhaustionFallbackText(taskObjective, maxAttemptLoops))
				r.setFinalizationReason("deadline_guard")
				r.setEndReason("complete")
				r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
				return nil
			}
		}
		if attemptIdx > 0 {
			r.needNewTextBlock = true
			budgetLeft := r.recoveryMaxSteps - r.recoveryState.RecoverySteps
			if budgetLeft < 0 {
				budgetLeft = 0
			}
			r.persistRunEvent("turn.recovery.continuation", RealtimeStreamKindLifecycle, map[string]any{
				"attempt_index":        attemptIdx,
				"steps_used":           r.recoveryState.RecoverySteps,
				"recovery_budget_left": budgetLeft,
			})
		}
		if err := sendRunStart(attemptIdx, attemptHistory, attemptInput, attemptIdx == 0); err != nil {
			return err
		}
		budgetLeft := r.recoveryMaxSteps - r.recoveryState.RecoverySteps
		if budgetLeft < 0 {
			budgetLeft = 0
		}
		r.persistRunEvent("turn.attempt.started", RealtimeStreamKindLifecycle, map[string]any{
			"attempt_index":           attemptIdx,
			"history_count":           len(attemptHistory),
			"input_chars":             utf8.RuneCountInString(strings.TrimSpace(attemptInput.Text)),
			"requires_tools":          r.requiresTools,
			"recovery_enabled":        r.recoveryEnabled,
			"recovery_steps_used":     r.recoveryState.RecoverySteps,
			"recovery_budget_left":    budgetLeft,
			"total_tool_calls_so_far": r.totalToolCalls,
		})
		continueAttempt := false
		attemptSummary := turnAttemptSummary{AttemptIndex: attemptIdx}
		var attemptText strings.Builder

	attemptLoop:
		for {
			select {
			case <-ctx.Done():
				if r.finalizeIfContextCanceled(ctx) {
					return nil
				}
				return ctx.Err()
			default:
			}

			msg, err := sc.recv()
			if err != nil {
				// If the context was canceled, treat the EOF as a normal terminal path (canceled/timed out/disconnected).
				select {
				case <-ctx.Done():
					continue
				default:
				}
				if errors.Is(err, io.EOF) {
					hasToolContext := r.totalToolCalls > 0 || r.hasAssistantToolError()
					attemptRawText := attemptText.String()
					hasAssistantText := r.hasNonEmptyAssistantText() || strings.TrimSpace(attemptRawText) != ""
					if hasToolContext || (hasAssistantText && !r.requiresTools) {
						r.debug("ai.run.sidecar.eof.partial_output", "tool_calls", r.totalToolCalls, "has_tool_error", r.hasAssistantToolError(), "has_text", hasAssistantText)
						attemptSummary.AssistantText = strings.TrimSpace(attemptRawText)
						if shouldCommitAttemptAssistantText(attemptSummary) {
							_ = r.appendTextDelta(attemptSummary.AssistantText)
						}
						r.ensureNonEmptyAssistant()
						if strings.TrimSpace(r.getFinalizationReason()) == "" {
							r.setFinalizationReason("sidecar_eof")
						}
						r.setEndReason("complete")
						r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
						return nil
					}
					r.debug("ai.run.sidecar.eof")
					r.finalizeNotice("disconnected")
					r.setFinalizationReason("disconnected")
					r.setEndReason("disconnected")
					r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
					return nil
				}
				errMsg := "AI sidecar error"
				r.debug("ai.run.sidecar.recv_error", "error", sanitizeLogText(err.Error(), 256))
				r.setFinalizationReason("sidecar_error")
				return r.failRun(errMsg, err)
			}
			if msg == nil {
				continue
			}
			// If a cancel was requested, ignore any late frames from sidecar (it may emit run.error on abort).
			select {
			case <-ctx.Done():
				continue
			default:
			}
			if msg.Error != nil && msg.Method == "" {
				// initialize response etc; ignore for now.
				continue
			}

			signalActivity()

			switch strings.TrimSpace(msg.Method) {
			case "run.delta":
				var p struct {
					RunID string `json:"run_id"`
					Delta string `json:"delta"`
				}
				_ = json.Unmarshal(msg.Params, &p)
				if strings.TrimSpace(p.RunID) != r.id || p.Delta == "" {
					continue
				}
				r.debug("ai.run.delta.received", "delta_len", utf8.RuneCountInString(p.Delta))
				attemptText.WriteString(p.Delta)

			case "tool.call":
				var p struct {
					RunID    string         `json:"run_id"`
					ToolID   string         `json:"tool_id"`
					ToolName string         `json:"tool_name"`
					Args     map[string]any `json:"args"`
				}
				_ = json.Unmarshal(msg.Params, &p)
				if strings.TrimSpace(p.RunID) != r.id {
					continue
				}
				attemptSummary.ToolCalls++
				normalizedToolName := strings.TrimSpace(strings.ToLower(p.ToolName))
				if normalizedToolName != "" {
					attemptSummary.ToolCallNames = append(attemptSummary.ToolCallNames, normalizedToolName)
				}
				if sig := buildToolCallSignature(p.ToolName, p.Args); sig != "" {
					attemptSummary.ToolCallSignatures = append(attemptSummary.ToolCallSignatures, sig)
				}
				r.totalToolCalls++
				outcome, err := r.handleToolCall(ctx, sc, p.ToolID, p.ToolName, p.Args)
				if err != nil {
					// tool errors are reported to the model; do not crash the whole run.
					continue
				}
				if outcome == nil {
					continue
				}
				if memory, ok := buildRunToolMemoryFromOutcome(r.id, outcome); ok {
					attemptToolMemories = appendRunToolMemory(attemptToolMemories, memory)
				}
				if outcome.Success {
					attemptSummary.ToolSuccesses++
					if successName := strings.TrimSpace(strings.ToLower(outcome.ToolName)); successName != "" {
						attemptSummary.ToolSuccessNames = append(attemptSummary.ToolSuccessNames, successName)
					}
					continue
				}
				attemptSummary.ToolFailures = append(attemptSummary.ToolFailures, turnToolFailure{
					ToolName:       outcome.ToolName,
					Error:          outcome.ToolError,
					RecoveryAction: outcome.RecoveryAction,
					Args:           outcome.Args,
				})

			case "run.phase":
				var p struct {
					RunID string         `json:"run_id"`
					Phase string         `json:"phase"`
					Diag  map[string]any `json:"diag"`
				}
				_ = json.Unmarshal(msg.Params, &p)
				if strings.TrimSpace(p.RunID) != r.id {
					continue
				}
				phase := normalizeLifecyclePhase(p.Phase)
				if phase == "" {
					continue
				}
				payload := map[string]any{"phase": phase}
				if p.Diag != nil {
					payload["diag"] = p.Diag
				}
				r.persistRunEvent("turn.phase."+phase, RealtimeStreamKindLifecycle, payload)
				r.emitLifecyclePhase(phase, p.Diag)

			case "run.outcome":
				var p struct {
					RunID                 string `json:"run_id"`
					HasText               bool   `json:"has_text"`
					TextChars             int    `json:"text_chars"`
					ToolCalls             int    `json:"tool_calls"`
					FinishReason          string `json:"finish_reason"`
					StepCount             int    `json:"step_count"`
					LastStepFinishReason  string `json:"last_step_finish_reason"`
					LastStepTextChars     int    `json:"last_step_text_chars"`
					LastStepToolCalls     int    `json:"last_step_tool_calls"`
					HasTextAfterToolCalls *bool  `json:"has_text_after_tool_calls"`
					NeedsFollowUpHint     *bool  `json:"needs_follow_up_hint"`
				}
				_ = json.Unmarshal(msg.Params, &p)
				if strings.TrimSpace(p.RunID) != r.id {
					continue
				}
				attemptSummary.OutcomeHasText = p.HasText
				attemptSummary.OutcomeTextChars = p.TextChars
				attemptSummary.OutcomeToolCalls = p.ToolCalls
				attemptSummary.OutcomeFinishReason = strings.TrimSpace(strings.ToLower(p.FinishReason))
				attemptSummary.OutcomeStepCount = p.StepCount
				attemptSummary.OutcomeLastStepFinishReason = strings.TrimSpace(strings.ToLower(p.LastStepFinishReason))
				attemptSummary.OutcomeLastStepTextChars = p.LastStepTextChars
				attemptSummary.OutcomeLastStepToolCalls = p.LastStepToolCalls
				attemptSummary.OutcomeHasTextAfterToolsKnown = p.HasTextAfterToolCalls != nil
				if p.HasTextAfterToolCalls != nil {
					attemptSummary.OutcomeHasTextAfterToolCalls = *p.HasTextAfterToolCalls
				}
				if p.NeedsFollowUpHint != nil {
					attemptSummary.OutcomeNeedsFollowUpHint = *p.NeedsFollowUpHint
				}
				r.persistRunEvent("turn.outcome", RealtimeStreamKindLifecycle, map[string]any{
					"has_text":                  p.HasText,
					"text_chars":                p.TextChars,
					"tool_calls":                p.ToolCalls,
					"finish_reason":             attemptSummary.OutcomeFinishReason,
					"step_count":                p.StepCount,
					"last_step_finish_reason":   attemptSummary.OutcomeLastStepFinishReason,
					"last_step_text_chars":      p.LastStepTextChars,
					"last_step_tool_calls":      p.LastStepToolCalls,
					"has_text_after_tool_calls": p.HasTextAfterToolCalls,
					"needs_follow_up_hint":      p.NeedsFollowUpHint,
				})

			case "tool.error.classified":
				var p struct {
					RunID             string `json:"run_id"`
					ToolName          string `json:"tool_name"`
					Code              string `json:"code"`
					Retryable         bool   `json:"retryable"`
					HasNormalizedArgs bool   `json:"has_normalized_args"`
				}
				_ = json.Unmarshal(msg.Params, &p)
				if strings.TrimSpace(p.RunID) != r.id {
					continue
				}
				r.persistRunEvent("tool.error.classified", RealtimeStreamKindTool, map[string]any{
					"tool_name":           strings.TrimSpace(p.ToolName),
					"code":                strings.TrimSpace(strings.ToUpper(p.Code)),
					"retryable":           p.Retryable,
					"has_normalized_args": p.HasNormalizedArgs,
				})

			case "tool.recovery.hint":
				var p struct {
					RunID    string `json:"run_id"`
					ToolName string `json:"tool_name"`
					Action   string `json:"action"`
					Code     string `json:"code"`
				}
				_ = json.Unmarshal(msg.Params, &p)
				if strings.TrimSpace(p.RunID) != r.id {
					continue
				}
				r.persistRunEvent("tool.recovery.hint", RealtimeStreamKindTool, map[string]any{
					"tool_name": strings.TrimSpace(p.ToolName),
					"action":    strings.TrimSpace(strings.ToLower(p.Action)),
					"code":      strings.TrimSpace(strings.ToUpper(p.Code)),
				})

			case "run.end":
				attemptRawText := attemptText.String()
				attemptSummary.AssistantText = strings.TrimSpace(attemptRawText)
				committedAttemptText := false
				commitAttemptText := func(force bool) {
					if committedAttemptText {
						return
					}
					text := strings.TrimSpace(attemptSummary.AssistantText)
					if text == "" {
						return
					}
					if !force && !shouldCommitAttemptAssistantText(attemptSummary) {
						return
					}
					if r.hasNonEmptyAssistantText() {
						_ = r.appendTextDelta("\n\n" + text)
					} else {
						_ = r.appendTextDelta(text)
					}
					committedAttemptText = true
				}
				if r.finalizeIfContextCanceled(ctx) {
					return nil
				}
				decision := decideTurnRecovery(turnRecoveryConfig{
					Enabled:                        r.recoveryEnabled,
					MaxSteps:                       r.recoveryMaxSteps,
					AllowPathRewrite:               r.recoveryAllowPathRewrite,
					AllowProbeTools:                r.recoveryAllowProbeTools,
					FailOnRepeatedFailureSignature: r.recoveryFailOnRepeatedSignature,
					RequiresTools:                  r.requiresTools,
				}, attemptSummary, &r.recoveryState, req.Input.Text)
				lastRecoveryReason = strings.TrimSpace(decision.Reason)
				lastRecoveryAction = strings.TrimSpace(string(decision.Action))
				lastRecoveryErrorCode = strings.TrimSpace(decision.LastErrorCode)
				lastRecoveryErrorMessage = ""
				if lf := latestToolFailure(attemptSummary); lf != nil && lf.Error != nil {
					lf.Error.Normalize()
					lastRecoveryErrorMessage = strings.TrimSpace(lf.Error.Message)
				}

				if decision.Continue {
					budgetLeft := r.recoveryMaxSteps - r.recoveryState.RecoverySteps
					if budgetLeft < 0 {
						budgetLeft = 0
					}
					r.persistRunEvent("turn.recovery.triggered", RealtimeStreamKindLifecycle, map[string]any{
						"reason":                decision.Reason,
						"action":                string(decision.Action),
						"attempt_index":         attemptIdx,
						"steps_used":            r.recoveryState.RecoverySteps,
						"recovery_budget_left":  budgetLeft,
						"attempt_tool_calls":    attemptSummary.ToolCalls,
						"attempt_tool_success":  attemptSummary.ToolSuccesses,
						"attempt_tool_failures": len(attemptSummary.ToolFailures),
						"last_error_code":       decision.LastErrorCode,
					})
					r.debug("ai.run.recovery.triggered",
						"reason", decision.Reason,
						"action", string(decision.Action),
						"attempt_index", attemptIdx,
						"steps_used", r.recoveryState.RecoverySteps,
						"budget_left", budgetLeft,
					)
					attemptHistory = appendHistoryForRetry(attemptHistory, req.Input.Text, attemptSummary.AssistantText)
					attemptInput = RunInput{Text: decision.NextPrompt}
					continueAttempt = true
					break attemptLoop
				}

				if decision.FailRun {
					r.persistRunEvent("turn.recovery.failed", RealtimeStreamKindLifecycle, map[string]any{
						"reason":                decision.Reason,
						"action":                string(decision.Action),
						"attempt_index":         attemptIdx,
						"steps_used":            r.recoveryState.RecoverySteps,
						"attempt_tool_calls":    attemptSummary.ToolCalls,
						"attempt_tool_success":  attemptSummary.ToolSuccesses,
						"attempt_tool_failures": len(attemptSummary.ToolFailures),
						"last_error_code":       decision.LastErrorCode,
					})
					r.debug("ai.run.recovery.failed",
						"reason", decision.Reason,
						"action", string(decision.Action),
						"attempt_index", attemptIdx,
						"steps_used", r.recoveryState.RecoverySteps,
					)
					commitAttemptText(false)
					failureMsg := strings.TrimSpace(decision.FailureMessage)
					if failureMsg != "" {
						prefix := ""
						if r.hasNonEmptyAssistantText() {
							prefix = "\n\n"
						}
						_ = r.appendTextDelta(prefix + failureMsg)
					}
					r.ensureNonEmptyAssistant()
					r.setFinalizationReason(decision.Reason)
					r.setEndReason("complete")
					r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
					return nil
				}

				completionDecision := decideTurnCompletion(turnCompletionConfig{
					Enabled:  true,
					MaxSteps: 2,
				}, attemptSummary, &r.recoveryState, req.Input.Text)

				if completionDecision.Continue {
					lastRecoveryReason = strings.TrimSpace(completionDecision.Reason)
					lastRecoveryAction = strings.TrimSpace(string(completionDecision.Action))
					lastRecoveryErrorCode = ""
					lastRecoveryErrorMessage = ""
					budgetLeft := r.recoveryMaxSteps - r.recoveryState.RecoverySteps
					if budgetLeft < 0 {
						budgetLeft = 0
					}
					r.persistRunEvent("turn.completion.continue", RealtimeStreamKindLifecycle, map[string]any{
						"reason":                completionDecision.Reason,
						"action":                string(completionDecision.Action),
						"attempt_index":         attemptIdx,
						"completion_steps_used": r.recoveryState.CompletionSteps,
						"recovery_budget_left":  budgetLeft,
						"attempt_tool_calls":    attemptSummary.ToolCalls,
						"attempt_tool_success":  attemptSummary.ToolSuccesses,
						"attempt_tool_failures": len(attemptSummary.ToolFailures),
					})
					attemptHistory = appendHistoryForRetry(attemptHistory, req.Input.Text, attemptSummary.AssistantText)
					attemptInput = RunInput{Text: completionDecision.NextPrompt}
					continueAttempt = true
					break attemptLoop
				}

				completionFailed := false
				completionFailureReason := ""
				completionFailureMessage := ""
				if completionDecision.FailRun {
					lastRecoveryReason = strings.TrimSpace(completionDecision.Reason)
					lastRecoveryAction = strings.TrimSpace(string(completionDecision.Action))
					lastRecoveryErrorCode = ""
					lastRecoveryErrorMessage = ""
					r.persistRunEvent("turn.completion.failed", RealtimeStreamKindLifecycle, map[string]any{
						"reason":                completionDecision.Reason,
						"action":                string(completionDecision.Action),
						"attempt_index":         attemptIdx,
						"completion_steps_used": r.recoveryState.CompletionSteps,
						"attempt_tool_calls":    attemptSummary.ToolCalls,
						"attempt_tool_success":  attemptSummary.ToolSuccesses,
						"attempt_tool_failures": len(attemptSummary.ToolFailures),
					})
					completionFailed = true
					completionFailureReason = strings.TrimSpace(completionDecision.Reason)
					completionFailureMessage = strings.TrimSpace(completionDecision.FailureMessage)
				}

				taskDecision := decideTaskLoop(r.taskLoopCfg, &r.taskLoopState, attemptSummary, req.Input.Text)
				if taskDecision.Continue {
					lastRecoveryReason = strings.TrimSpace(taskDecision.Reason)
					lastRecoveryAction = strings.TrimSpace(string(taskDecision.Action))
					lastRecoveryErrorCode = ""
					lastRecoveryErrorMessage = ""
					r.persistRunEvent("task.loop.continue", RealtimeStreamKindLifecycle, map[string]any{
						"reason":                taskDecision.Reason,
						"attempt_index":         attemptIdx,
						"task_turns_used":       r.taskLoopState.TurnsUsed,
						"task_no_progress_turn": r.taskLoopState.NoProgressTurn,
						"attempt_tool_calls":    attemptSummary.ToolCalls,
						"attempt_tool_success":  attemptSummary.ToolSuccesses,
						"attempt_tool_failures": len(attemptSummary.ToolFailures),
					})
					attemptHistory = appendHistoryForRetry(attemptHistory, req.Input.Text, attemptSummary.AssistantText)
					attemptInput = RunInput{Text: taskDecision.NextPrompt}
					continueAttempt = true
					break attemptLoop
				}

				if taskDecision.FailRun {
					lastRecoveryReason = strings.TrimSpace(taskDecision.Reason)
					lastRecoveryAction = strings.TrimSpace(string(taskDecision.Action))
					lastRecoveryErrorCode = ""
					lastRecoveryErrorMessage = ""
					r.persistRunEvent("task.loop.failed", RealtimeStreamKindLifecycle, map[string]any{
						"reason":                taskDecision.Reason,
						"attempt_index":         attemptIdx,
						"task_turns_used":       r.taskLoopState.TurnsUsed,
						"task_no_progress_turn": r.taskLoopState.NoProgressTurn,
						"attempt_tool_calls":    attemptSummary.ToolCalls,
						"attempt_tool_success":  attemptSummary.ToolSuccesses,
						"attempt_tool_failures": len(attemptSummary.ToolFailures),
					})
					commitAttemptText(false)
					failureMsg := strings.TrimSpace(taskDecision.FailureMessage)
					if failureMsg != "" {
						prefix := ""
						if r.hasNonEmptyAssistantText() {
							prefix = "\n\n"
						}
						_ = r.appendTextDelta(prefix + failureMsg)
					}
					r.ensureNonEmptyAssistant()
					r.setFinalizationReason(taskDecision.Reason)
					r.setEndReason("complete")
					r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
					return nil
				}

				if completionFailed {
					commitAttemptText(false)
					if completionFailureMessage != "" {
						prefix := ""
						if r.hasNonEmptyAssistantText() {
							prefix = "\n\n"
						}
						_ = r.appendTextDelta(prefix + completionFailureMessage)
					}
					r.ensureNonEmptyAssistant()
					r.setFinalizationReason(completionFailureReason)
					r.setEndReason("complete")
					r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
					return nil
				}

				if r.recoveryState.RecoverySteps > 0 {
					r.persistRunEvent("turn.recovery.recovered", RealtimeStreamKindLifecycle, map[string]any{
						"attempt_index":         attemptIdx,
						"steps_used":            r.recoveryState.RecoverySteps,
						"total_tool_calls":      r.totalToolCalls,
						"attempt_tool_calls":    attemptSummary.ToolCalls,
						"attempt_tool_success":  attemptSummary.ToolSuccesses,
						"attempt_tool_failures": len(attemptSummary.ToolFailures),
					})
				}
				r.persistRunEvent("turn.completion.done", RealtimeStreamKindLifecycle, map[string]any{
					"attempt_index":         attemptIdx,
					"attempt_tool_calls":    attemptSummary.ToolCalls,
					"attempt_tool_success":  attemptSummary.ToolSuccesses,
					"attempt_tool_failures": len(attemptSummary.ToolFailures),
				})
				commitAttemptText(false)
				r.ensureNonEmptyAssistant()
				r.emitLifecyclePhase("ended", map[string]any{"attempt_index": attemptIdx, "reason": "complete_answered"})
				r.setFinalizationReason("complete_answered")
				r.setEndReason("complete")
				r.debug("ai.run.complete")
				r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
				return nil

			case "run.error":
				var p struct {
					RunID string `json:"run_id"`
					Error string `json:"error"`
				}
				_ = json.Unmarshal(msg.Params, &p)
				if strings.TrimSpace(p.RunID) != r.id {
					continue
				}
				msgErr := strings.TrimSpace(p.Error)
				if msgErr == "" {
					msgErr = "AI error"
				}
				attemptSummary.AssistantText = strings.TrimSpace(attemptText.String())
				if text := strings.TrimSpace(attemptSummary.AssistantText); text != "" {
					if shouldCommitAttemptAssistantText(attemptSummary) || attemptSummary.ToolCalls == 0 {
						if r.hasNonEmptyAssistantText() {
							_ = r.appendTextDelta("\n\n" + text)
						} else {
							_ = r.appendTextDelta(text)
						}
					}
				}
				r.debug("ai.run.error", "error", sanitizeLogText(msgErr, 256))
				r.setFinalizationReason("sidecar_error")
				return r.failRun(msgErr, nil)
			}
		}

		if continueAttempt {
			continue
		}
	}
}

func appendHistoryForRetry(history []RunHistoryMsg, userText string, assistantText string) []RunHistoryMsg {
	out := append([]RunHistoryMsg(nil), history...)
	if txt := strings.TrimSpace(userText); txt != "" {
		out = append(out, RunHistoryMsg{Role: "user", Text: txt})
	}
	if txt := strings.TrimSpace(assistantText); txt != "" {
		if hasSubstantiveAssistantAnswer(txt) || !looksInterimAssistantText(txt) {
			out = append(out, RunHistoryMsg{Role: "assistant", Text: txt})
		}
	}
	return out
}

func appendRunToolMemory(memories []RunToolMemory, item RunToolMemory) []RunToolMemory {
	if strings.TrimSpace(item.ToolName) == "" {
		return memories
	}
	out := append(memories, item)
	if len(out) > 48 {
		out = append([]RunToolMemory(nil), out[len(out)-48:]...)
	}
	return out
}

func tailRunToolMemories(memories []RunToolMemory, keep int) []RunToolMemory {
	if keep <= 0 {
		keep = historyToolMemoryKeep
	}
	normalized := normalizeRunToolMemories(memories)
	if len(normalized) <= keep {
		return normalized
	}
	start := len(normalized) - keep
	return append([]RunToolMemory(nil), normalized[start:]...)
}

func buildRunToolMemoryFromOutcome(runID string, outcome *toolCallOutcome) (RunToolMemory, bool) {
	if outcome == nil || strings.TrimSpace(outcome.ToolName) == "" {
		return RunToolMemory{}, false
	}
	status := "error"
	if outcome.Success {
		status = "success"
	}
	item := RunToolMemory{
		RunID:         strings.TrimSpace(runID),
		ToolName:      strings.TrimSpace(outcome.ToolName),
		Status:        status,
		ArgsPreview:   previewAnyForLog(redactToolArgsForLog(outcome.ToolName, outcome.Args), historyToolMemoryPreview),
		ResultPreview: "",
		ErrorCode:     "",
		ErrorMessage:  "",
	}
	if outcome.Success {
		item.ResultPreview = previewAnyForLog(redactAnyForLog("", outcome.Result, 0), historyToolMemoryPreview)
		return item, true
	}
	if outcome.ToolError != nil {
		outcome.ToolError.Normalize()
		item.ErrorCode = strings.TrimSpace(strings.ToUpper(string(outcome.ToolError.Code)))
		item.ErrorMessage = strings.TrimSpace(outcome.ToolError.Message)
	}
	return item, true
}

func buildToolCallSignature(toolName string, args map[string]any) string {
	name := strings.TrimSpace(strings.ToLower(toolName))
	if name == "" {
		return ""
	}
	parts := []string{name}
	if pathHint := strings.TrimSpace(anyToString(args["path"])); pathHint != "" {
		parts = append(parts, "path="+normalizeFailureText(pathHint))
	}
	if cwdHint := strings.TrimSpace(anyToString(args["cwd"])); cwdHint != "" {
		parts = append(parts, "cwd="+normalizeFailureText(cwdHint))
	}
	if cmdHint := strings.TrimSpace(anyToString(args["command"])); cmdHint != "" {
		parts = append(parts, "cmd="+normalizeFailureText(cmdHint))
	}
	return strings.Join(parts, "|")
}

func (r *run) appendTextDelta(delta string) error {
	if r.needNewTextBlock {
		idx := r.nextBlockIndex
		r.sendStreamEvent(streamEventBlockStart{Type: "block-start", MessageID: r.messageID, BlockIndex: idx, BlockType: "markdown"})
		r.persistSetMarkdownBlock(idx)
		r.currentTextBlockIndex = idx
		r.nextBlockIndex++
		r.needNewTextBlock = false
	}
	r.persistAppendMarkdownDelta(r.currentTextBlockIndex, delta)
	r.sendStreamEvent(streamEventBlockDelta{
		Type:       "block-delta",
		MessageID:  r.messageID,
		BlockIndex: r.currentTextBlockIndex,
		Delta:      delta,
	})
	return nil
}

func (r *run) hasNonEmptyAssistantText() bool {
	if r == nil {
		return false
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	for _, blk := range r.assistantBlocks {
		bm, ok := blk.(*persistedMarkdownBlock)
		if !ok || bm == nil {
			continue
		}
		if strings.TrimSpace(bm.Content) != "" {
			return true
		}
	}
	return false
}

func (r *run) hasAssistantToolError() bool {
	_, ok := r.lastFailedToolBlock()
	return ok
}

func (r *run) lastFailedToolBlock() (ToolCallBlock, bool) {
	if r == nil {
		return ToolCallBlock{}, false
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	for i := len(r.assistantBlocks) - 1; i >= 0; i-- {
		blk := r.assistantBlocks[i]
		switch b := blk.(type) {
		case ToolCallBlock:
			if b.Status == ToolCallStatusError {
				return b, true
			}
		case *ToolCallBlock:
			if b != nil && b.Status == ToolCallStatusError {
				return *b, true
			}
		}
	}
	return ToolCallBlock{}, false
}

func (r *run) toolErrorFallbackText() string {
	block, ok := r.lastFailedToolBlock()
	if !ok {
		return ""
	}
	toolName := strings.TrimSpace(block.ToolName)
	errCode := "UNKNOWN"
	errMessage := strings.TrimSpace(block.Error)
	if block.ErrorDetails != nil {
		block.ErrorDetails.Normalize()
		errCode = string(block.ErrorDetails.Code)
		if msg := strings.TrimSpace(block.ErrorDetails.Message); msg != "" {
			errMessage = msg
		}
	}
	if errMessage == "" {
		errMessage = "Tool execution failed"
	}
	if toolName == "" {
		return fmt.Sprintf("Tool workflow failed: [%s] %s", errCode, errMessage)
	}
	return fmt.Sprintf("Tool workflow failed at %s: [%s] %s", toolName, errCode, errMessage)
}

func (r *run) lastSuccessfulToolBlock() (ToolCallBlock, bool) {
	if r == nil {
		return ToolCallBlock{}, false
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	for i := len(r.assistantBlocks) - 1; i >= 0; i-- {
		blk := r.assistantBlocks[i]
		switch b := blk.(type) {
		case ToolCallBlock:
			if b.Status == ToolCallStatusSuccess {
				return b, true
			}
		case *ToolCallBlock:
			if b != nil && b.Status == ToolCallStatusSuccess {
				return *b, true
			}
		}
	}
	return ToolCallBlock{}, false
}

func truncateRunes(s string, maxRunes int) string {
	if maxRunes <= 0 {
		return ""
	}
	rs := []rune(s)
	if len(rs) <= maxRunes {
		return s
	}
	return string(rs[:maxRunes]) + "\n... (truncated)"
}

func anyToString(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case []byte:
		return string(x)
	default:
		return ""
	}
}

func anyToInt(v any) int {
	switch x := v.(type) {
	case int:
		return x
	case int8:
		return int(x)
	case int16:
		return int(x)
	case int32:
		return int(x)
	case int64:
		return int(x)
	case uint:
		return int(x)
	case uint8:
		return int(x)
	case uint16:
		return int(x)
	case uint32:
		return int(x)
	case uint64:
		return int(x)
	case float32:
		return int(x)
	case float64:
		return int(x)
	default:
		return 0
	}
}

func (r *run) fallbackTextFromSuccessfulTool() string {
	block, ok := r.lastSuccessfulToolBlock()
	if !ok {
		return ""
	}

	toolName := strings.TrimSpace(block.ToolName)
	resultMap, _ := block.Result.(map[string]any)

	switch toolName {
	case "terminal.exec":
		stdout := strings.TrimSpace(anyToString(resultMap["stdout"]))
		stderr := strings.TrimSpace(anyToString(resultMap["stderr"]))
		exitCode := anyToInt(resultMap["exit_code"])
		if stdout != "" {
			return "Command output:\n\n```\n" + truncateRunes(stdout, 4000) + "\n```"
		}
		if stderr != "" {
			return fmt.Sprintf("Command finished with exit code %d and stderr:\n\n```\n%s\n```", exitCode, truncateRunes(stderr, 2000))
		}
		return fmt.Sprintf("Command finished with exit code %d.", exitCode)

	case "fs.read_file":
		content := strings.TrimSpace(anyToString(resultMap["content_utf8"]))
		if content == "" {
			return "File read completed."
		}
		return "File content:\n\n```\n" + truncateRunes(content, 4000) + "\n```"

	case "fs.list_dir":
		return ""

	case "fs.stat":
		return ""

	case "fs.write_file":
		bytesWritten := anyToInt(resultMap["bytes_written"])
		if bytesWritten > 0 {
			return fmt.Sprintf("File written successfully (%d bytes).", bytesWritten)
		}
		return "File written successfully."
	}

	if block.Result == nil {
		return "Tool call completed successfully."
	}
	b, err := json.Marshal(block.Result)
	if err != nil || len(b) == 0 {
		return "Tool call completed successfully."
	}
	return "Tool result:\n\n```json\n" + truncateRunes(string(b), 4000) + "\n```"
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

func (r *run) loopExhaustionFallbackText(objective string, maxAttempts int) string {
	lines := []string{
		"I paused automatic execution to avoid a repeated tool loop.",
	}
	if maxAttempts > 0 {
		lines = append(lines, fmt.Sprintf("Attempts used: %d.", maxAttempts))
	}
	if goal := strings.TrimSpace(objective); goal != "" {
		lines = append(lines, "Open goal: "+truncateRunes(goal, 220))
	}
	if toolSummary := strings.TrimSpace(r.fallbackTextFromSuccessfulTool()); toolSummary != "" {
		lines = append(lines, "Latest verified evidence:\n\n"+toolSummary)
	} else if toolErr := strings.TrimSpace(r.toolErrorFallbackText()); toolErr != "" {
		lines = append(lines, "Latest tool issue: "+toolErr)
	}
	lines = append(lines, "Send a concrete next step (for example, one file path) and I will continue from current progress.")
	return strings.Join(lines, "\n\n")
}

func (r *run) ensureNonEmptyAssistant() {
	if r == nil {
		return
	}
	if r.hasNonEmptyAssistantText() {
		r.debug("ai.run.ensure_non_empty_assistant", "reason", "assistant_text_exists")
		return
	}
	if toolFallback := strings.TrimSpace(r.fallbackTextFromSuccessfulTool()); toolFallback != "" {
		r.debug("ai.run.ensure_non_empty_assistant", "reason", "tool_fallback", "preview", sanitizeLogText(toolFallback, 160))
		_ = r.appendTextDelta(toolFallback)
		return
	}
	if toolErrFallback := strings.TrimSpace(r.toolErrorFallbackText()); toolErrFallback != "" {
		r.debug("ai.run.ensure_non_empty_assistant", "reason", "tool_error", "preview", sanitizeLogText(toolErrFallback, 200))
		_ = r.appendTextDelta(toolErrFallback)
		return
	}
	// Product decision: empty successful completion becomes a stable, visible assistant message.
	r.debug("ai.run.ensure_non_empty_assistant", "reason", "no_response")
	_ = r.appendTextDelta("Assistant finished without a visible response.")
}

func (r *run) ensureAssistantErrorMessage(errMsg string) {
	if r == nil {
		return
	}
	if r.hasNonEmptyAssistantText() {
		return
	}
	if toolErrFallback := strings.TrimSpace(r.toolErrorFallbackText()); toolErrFallback != "" {
		_ = r.appendTextDelta(toolErrFallback)
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
		r.finalizeNotice("canceled")
		r.setFinalizationReason("canceled")
		r.setEndReason("canceled")
	case "timed_out":
		reason = "timed_out"
		r.finalizeNotice("timed_out")
		r.setFinalizationReason("timed_out")
		r.setEndReason("timed_out")
	default:
		if errors.Is(ctxErr, context.DeadlineExceeded) {
			reason = "timed_out"
			r.finalizeNotice("timed_out")
			r.setFinalizationReason("timed_out")
			r.setEndReason("timed_out")
		} else {
			r.finalizeNotice("disconnected")
			r.setFinalizationReason("disconnected")
			r.setEndReason("disconnected")
		}
	}
	r.debug("ai.run.context_canceled_before_send", "reason", reason)
	r.emitLifecyclePhase("ended", map[string]any{"reason": reason})
	r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
	return true
}

func (r *run) finalizeNotice(kind string) {
	if r == nil {
		return
	}
	kind = strings.TrimSpace(kind)
	notice := ""
	switch kind {
	case "canceled":
		notice = "Canceled."
	case "disconnected":
		notice = "Disconnected."
	case "timed_out":
		notice = "Timed out."
	default:
		return
	}
	prefix := ""
	if r.hasNonEmptyAssistantText() {
		prefix = "\n\n"
	}
	_ = r.appendTextDelta(prefix + notice)
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

func (r *run) handleToolCall(ctx context.Context, sc *sidecarProcess, toolID string, toolName string, args map[string]any) (*toolCallOutcome, error) {
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
	r.persistRunEvent("tool.call", RealtimeStreamKindTool, map[string]any{
		"tool_id":   toolID,
		"tool_name": toolName,
		"args":      redactAnyForLog("args", args, 0),
	})

	r.debug("ai.run.tool.call",
		"tool_id", toolID,
		"tool_name", toolName,
		"requires_approval", requiresApproval(toolName),
		"args_preview", previewAnyForLog(redactToolArgsForLog(toolName, args), 512),
	)

	idx := r.nextBlockIndex
	r.nextBlockIndex++
	r.needNewTextBlock = true

	r.mu.Lock()
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
	}

	if r.cfg != nil && r.cfg.EffectiveMode() == config.AIModePlan && aitools.IsMutating(toolName) {
		toolErr := &aitools.ToolError{
			Code:      aitools.ErrorCodePermissionDenied,
			Message:   "Tool is disabled in plan mode",
			Retryable: false,
			SuggestedFixes: []string{
				"Switch AI mode to build to enable mutating tools.",
			},
		}
		setToolError(toolErr, "")
		env := aitools.ToolResultEnvelope{RunID: r.id, ToolID: toolID, Status: aitools.ResultStatusError, Error: toolErr}
		return outcome, r.sendToolResult(sc, env)
	}

	meta, err := r.sessionMetaForTool()
	if err != nil {
		toolErr := aitools.ClassifyError(aitools.Invocation{ToolName: toolName, Args: args, WorkingDir: r.fsRoot}, err)
		setToolError(toolErr, "")
		env := aitools.ToolResultEnvelope{RunID: r.id, ToolID: toolID, Status: aitools.ResultStatusError, Error: toolErr}
		return outcome, r.sendToolResult(sc, env)
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
			toolErr := &aitools.ToolError{Code: aitools.ErrorCodePermissionDenied, Message: waitErr, Retryable: false}
			setToolError(toolErr, "")
			env := aitools.ToolResultEnvelope{RunID: r.id, ToolID: toolID, Status: aitools.ResultStatusError, Error: toolErr}
			return outcome, r.sendToolResult(sc, env)
		}
		if timedOut {
			toolErr := &aitools.ToolError{Code: aitools.ErrorCodeTimeout, Message: "Approval timed out", Retryable: true}
			block.ApprovalState = "rejected"
			setToolError(toolErr, "")
			env := aitools.ToolResultEnvelope{RunID: r.id, ToolID: toolID, Status: aitools.ResultStatusError, Error: toolErr}
			return outcome, r.sendToolResult(sc, env)
		}
		if !approved {
			toolErr := &aitools.ToolError{Code: aitools.ErrorCodePermissionDenied, Message: "Rejected by user", Retryable: false}
			block.ApprovalState = "rejected"
			setToolError(toolErr, "")
			env := aitools.ToolResultEnvelope{RunID: r.id, ToolID: toolID, Status: aitools.ResultStatusError, Error: toolErr}
			return outcome, r.sendToolResult(sc, env)
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
		toolErr := aitools.ClassifyError(aitools.Invocation{ToolName: toolName, Args: args, WorkingDir: r.fsRoot}, toolErrRaw)
		recoveryAction := ""
		if aitools.ShouldRetryWithNormalizedArgs(toolErr) {
			recoveryAction = string(recoveryActionRetryNormalizedArgs)
		}
		setToolError(toolErr, recoveryAction)
		env := aitools.ToolResultEnvelope{RunID: r.id, ToolID: toolID, Status: aitools.ResultStatusError, Error: toolErr}
		return outcome, r.sendToolResult(sc, env)
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
	env := aitools.ToolResultEnvelope{RunID: r.id, ToolID: toolID, Status: aitools.ResultStatusSuccess, Result: result}
	return outcome, r.sendToolResult(sc, env)
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

func (r *run) sendToolResult(sc *sidecarProcess, envelope aitools.ToolResultEnvelope) error {
	if sc == nil {
		return errors.New("sidecar not ready")
	}
	envelope.Normalize()
	if envelope.RunID == "" {
		envelope.RunID = strings.TrimSpace(r.id)
	}
	preview := ""
	if envelope.Status == aitools.ResultStatusSuccess {
		preview = previewAnyForLog(redactAnyForLog("", envelope.Result, 0), 512)
	} else if envelope.Error != nil {
		preview = sanitizeLogText(envelope.Error.Message, 256)
	}
	r.debug("ai.run.tool.result.forwarded", "tool_id", envelope.ToolID, "status", string(envelope.Status), "preview", preview)
	if err := sc.send("tool.result", envelope); err != nil {
		r.debug("ai.run.tool.result.forward_failed", "tool_id", envelope.ToolID, "error", sanitizeLogText(err.Error(), 256))
		return err
	}
	return nil
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

func resolveAbsoluteToolPath(raw string) (string, error) {
	candidate := strings.TrimSpace(raw)
	if candidate == "" {
		return "", errInvalidToolPath
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
	abs, err := resolveAbsoluteToolPath(p)
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
	abs, err := resolveAbsoluteToolPath(p)
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

	abs, err := resolveAbsoluteToolPath(p)
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
	abs, err := resolveAbsoluteToolPath(p)
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

	cwd = strings.TrimSpace(cwd)
	if cwd == "" {
		resolved, err := r.workingDirAbs()
		if err != nil {
			return nil, mapToolCwdError(err)
		}
		cwd = resolved
	}
	cwdAbs, err := resolveAbsoluteToolPath(cwd)
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
