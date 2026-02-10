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

	nextBlockIndex        int
	currentTextBlockIndex int
	needNewTextBlock      bool

	muAssistant              sync.Mutex
	assistantCreatedAtUnixMs int64
	assistantBlocks          []any

	guardEnabled         bool
	guardAutoContinueMax int
	requiresTools        bool
	guardRetries         int
	totalToolCalls       int
}

type sidecarProvider struct {
	ID        string `json:"id"`
	Type      string `json:"type"`
	BaseURL   string `json:"base_url,omitempty"`
	APIKeyEnv string `json:"api_key_env"`
}

func newRun(opts runOptions) *run {
	var runMeta *session.Meta
	if opts.SessionMeta != nil {
		metaCopy := *opts.SessionMeta
		runMeta = &metaCopy
	}

	guardEnabled := true
	guardAutoContinueMax := 1
	if opts.AIConfig != nil {
		guardEnabled = opts.AIConfig.EffectiveGuardEnabled()
		guardAutoContinueMax = opts.AIConfig.EffectiveGuardAutoContinueMax()
	}

	r := &run{
		log:                  opts.Log,
		stateDir:             strings.TrimSpace(opts.StateDir),
		fsRoot:               strings.TrimSpace(opts.FSRoot),
		shell:                strings.TrimSpace(opts.Shell),
		cfg:                  opts.AIConfig,
		sessionMeta:          runMeta,
		resolveProviderKey:   opts.ResolveProviderKey,
		id:                   strings.TrimSpace(opts.RunID),
		channelID:            strings.TrimSpace(opts.ChannelID),
		endpointID:           strings.TrimSpace(opts.EndpointID),
		threadID:             strings.TrimSpace(opts.ThreadID),
		userPublicID:         strings.TrimSpace(opts.UserPublicID),
		messageID:            strings.TrimSpace(opts.MessageID),
		uploadsDir:           strings.TrimSpace(opts.UploadsDir),
		threadsDB:            opts.ThreadsDB,
		persistOpTimeout:     opts.PersistOpTimeout,
		onStreamEvent:        opts.OnStreamEvent,
		w:                    opts.Writer,
		toolApprovals:        make(map[string]chan bool),
		toolBlockIndex:       make(map[string]int),
		sidecarScriptPath:    strings.TrimSpace(opts.SidecarScriptPath),
		maxWallTime:          opts.MaxWallTime,
		idleTimeout:          opts.IdleTimeout,
		toolApprovalTO:       opts.ToolApprovalTimeout,
		doneCh:               make(chan struct{}),
		guardEnabled:         guardEnabled,
		guardAutoContinueMax: guardAutoContinueMax,
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
	startedAt := time.Now()
	r.persistRunRecord(RunStateRunning, "", "", startedAt.UnixMilli(), 0)
	r.persistRunEvent("run.start", RealtimeStreamKindLifecycle, map[string]any{
		"model": strings.TrimSpace(req.Model),
	})
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
		r.persistRunEvent(eventType, RealtimeStreamKindLifecycle, map[string]any{
			"state":      string(state),
			"error_code": errCode,
			"error":      errMsg,
		})
		r.debug("ai.run.end",
			"end_reason", endReason,
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
	// Note: timeouts are enforced via an out-of-band goroutine (after sidecar starts) so the run
	// still cancels even when blocked in sc.recv().

	// Resolve provider key for this run, then inject it into the sidecar env.
	modelID := strings.TrimSpace(req.Model)
	providerID, _, ok := strings.Cut(modelID, "/")
	providerID = strings.TrimSpace(providerID)
	workspaceRootAbs, rootErr := r.workspaceRootAbs()
	if rootErr != nil {
		return r.failRun("AI workspace not configured", rootErr)
	}
	toolRequiredIntents := r.cfg.EffectiveToolRequiredIntents()
	r.requiresTools = shouldRequireToolExecution(req.Input.Text, toolRequiredIntents)
	r.debug("ai.run.start",
		"model", modelID,
		"max_steps", req.Options.MaxSteps,
		"history_count", len(req.History),
		"attachment_count", len(req.Input.Attachments),
		"input_chars", utf8.RuneCountInString(strings.TrimSpace(req.Input.Text)),
		"workspace_root_abs", sanitizeLogText(workspaceRootAbs, 200),
		"guard_enabled", r.guardEnabled,
		"guard_auto_continue_max", r.guardAutoContinueMax,
		"requires_tools", r.requiresTools,
	)
	if !ok || providerID == "" {
		return r.failRun("Invalid model id", fmt.Errorf("invalid model id %q", modelID))
	}
	if r.cfg == nil {
		return r.failRun("AI not configured", errors.New("ai not configured"))
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

	sendRunStart := func(attemptIdx int, history []RunHistoryMsg, input RunInput, includeAttachments bool) error {
		attachments := []map[string]any{}
		if includeAttachments {
			attachments = sidecarAttachments
		}
		if err := sc.send("run.start", map[string]any{
			"run_id":             r.id,
			"model":              req.Model,
			"mode":               r.cfg.EffectiveMode(),
			"history":            history,
			"workspace_root_abs": workspaceRootAbs,
			"input": map[string]any{
				"text":        input.Text,
				"attachments": attachments,
			},
			"options": req.Options,
			"guard": map[string]any{
				"enabled":           r.guardEnabled,
				"auto_continue_max": r.guardAutoContinueMax,
				"requires_tools":    r.requiresTools,
				"attempt_index":     attemptIdx,
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
	r.guardRetries = 0
	r.totalToolCalls = 0
	maxGuardRetry := 0
	if r.guardEnabled {
		maxGuardRetry = r.guardAutoContinueMax
	}
	r.persistRunEvent("turn.guard.config", RealtimeStreamKindLifecycle, map[string]any{
		"enabled":             r.guardEnabled,
		"max_auto_continue":   maxGuardRetry,
		"requires_tools":      r.requiresTools,
		"tool_required_hints": toolRequiredIntents,
	})

	for attemptIdx := 0; ; attemptIdx++ {
		if attemptIdx > 0 {
			r.needNewTextBlock = true
			r.persistRunEvent("turn.guard.continuation", RealtimeStreamKindLifecycle, map[string]any{
				"attempt_index": attemptIdx,
				"guard_retry":   r.guardRetries,
			})
		}
		if err := sendRunStart(attemptIdx, attemptHistory, attemptInput, attemptIdx == 0); err != nil {
			return err
		}
		r.persistRunEvent("turn.attempt.started", RealtimeStreamKindLifecycle, map[string]any{
			"attempt_index":           attemptIdx,
			"history_count":           len(attemptHistory),
			"input_chars":             utf8.RuneCountInString(strings.TrimSpace(attemptInput.Text)),
			"requires_tools":          r.requiresTools,
			"remaining_retries":       maxGuardRetry - r.guardRetries,
			"total_tool_calls_so_far": r.totalToolCalls,
		})
		continueAttempt := false
		attemptToolCalls := 0
		var attemptText strings.Builder

	attemptLoop:
		for {
			select {
			case <-ctx.Done():
				reason := r.getCancelReason()
				switch reason {
				case "canceled":
					r.debug("ai.run.context_done", "reason", "canceled")
					r.finalizeNotice("canceled")
					r.setEndReason("canceled")
					r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
					return nil
				case "timed_out":
					r.debug("ai.run.context_done", "reason", "timed_out")
					r.finalizeNotice("timed_out")
					r.setEndReason("timed_out")
					r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
					return nil
				default:
					// Parent context canceled (browser disconnect).
					r.debug("ai.run.context_done", "reason", "disconnected")
					r.finalizeNotice("disconnected")
					r.setEndReason("disconnected")
					r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
					return nil
				}
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
					r.debug("ai.run.sidecar.eof")
					r.finalizeNotice("disconnected")
					r.setEndReason("disconnected")
					r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
					return nil
				}
				errMsg := "AI sidecar error"
				r.debug("ai.run.sidecar.recv_error", "error", sanitizeLogText(err.Error(), 256))
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
				_ = r.appendTextDelta(p.Delta)
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
				attemptToolCalls++
				r.totalToolCalls++
				if err := r.handleToolCall(ctx, sc, p.ToolID, p.ToolName, p.Args); err != nil {
					// tool errors are reported to the model; do not crash the whole run.
					continue
				}

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
				phase := strings.TrimSpace(strings.ToLower(p.Phase))
				if phase == "" {
					continue
				}
				payload := map[string]any{"phase": phase}
				if p.Diag != nil {
					payload["diag"] = p.Diag
				}
				r.persistRunEvent("turn.phase."+phase, RealtimeStreamKindLifecycle, payload)

			case "turn.guard":
				var p struct {
					RunID   string         `json:"run_id"`
					Status  string         `json:"status"`
					Reason  string         `json:"reason"`
					Attempt int            `json:"attempt"`
					Diag    map[string]any `json:"diag"`
				}
				_ = json.Unmarshal(msg.Params, &p)
				if strings.TrimSpace(p.RunID) != r.id {
					continue
				}
				status := strings.TrimSpace(strings.ToLower(p.Status))
				if status == "" {
					status = "unknown"
				}
				payload := map[string]any{
					"status":  status,
					"reason":  strings.TrimSpace(p.Reason),
					"attempt": p.Attempt,
				}
				if p.Diag != nil {
					payload["diag"] = p.Diag
				}
				r.persistRunEvent("turn.guard."+status, RealtimeStreamKindLifecycle, payload)

			case "run.end":
				attemptAssistantText := strings.TrimSpace(attemptText.String())
				triggerGuard, guardReason := r.shouldTriggerCommitmentGuard(attemptToolCalls, attemptAssistantText)
				if triggerGuard {
					if r.guardRetries >= maxGuardRetry {
						errMsg := "Assistant finished without executing required tools."
						r.persistRunEvent("turn.guard.failed", RealtimeStreamKindLifecycle, map[string]any{
							"reason":             guardReason,
							"attempt_index":      attemptIdx,
							"guard_retries":      r.guardRetries,
							"max_guard_retries":  maxGuardRetry,
							"attempt_tool_calls": attemptToolCalls,
						})
						r.debug("ai.run.guard.failed",
							"reason", guardReason,
							"attempt_index", attemptIdx,
							"guard_retries", r.guardRetries,
							"max_guard_retries", maxGuardRetry,
						)
						return r.failRun(errMsg, nil)
					}
					r.guardRetries++
					remaining := maxGuardRetry - r.guardRetries
					retryPrompt := buildGuardRetryPrompt(req.Input.Text, attemptIdx, r.requiresTools)
					r.persistRunEvent("turn.guard.triggered", RealtimeStreamKindLifecycle, map[string]any{
						"reason":             guardReason,
						"attempt_index":      attemptIdx,
						"guard_retry":        r.guardRetries,
						"remaining_retries":  remaining,
						"attempt_tool_calls": attemptToolCalls,
						"total_tool_calls":   r.totalToolCalls,
					})
					r.debug("ai.run.guard.triggered",
						"reason", guardReason,
						"attempt_index", attemptIdx,
						"guard_retry", r.guardRetries,
						"remaining_retries", remaining,
					)
					attemptHistory = appendHistoryForRetry(attemptHistory, attemptInput.Text, attemptAssistantText)
					attemptInput = RunInput{Text: retryPrompt}
					continueAttempt = true
					break attemptLoop
				}
				if r.guardRetries > 0 {
					r.persistRunEvent("turn.guard.recovered", RealtimeStreamKindLifecycle, map[string]any{
						"attempt_index":      attemptIdx,
						"guard_retries":      r.guardRetries,
						"total_tool_calls":   r.totalToolCalls,
						"attempt_tool_calls": attemptToolCalls,
					})
				}
				r.ensureNonEmptyAssistant()
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
				r.debug("ai.run.error", "error", sanitizeLogText(msgErr, 256))
				return r.failRun(msgErr, nil)
			}
		}

		if continueAttempt {
			continue
		}
	}
}

func (r *run) shouldTriggerCommitmentGuard(attemptToolCalls int, attemptAssistantText string) (bool, string) {
	if r == nil || !r.guardEnabled {
		return false, ""
	}
	if attemptToolCalls > 0 || r.totalToolCalls > 0 {
		return false, ""
	}
	if r.requiresTools {
		return true, "tool_required_intent_without_tool_call"
	}
	if hasUnfulfilledActionCommitment(attemptAssistantText) {
		return true, "assistant_promised_action_without_tool_call"
	}
	return false, ""
}

func appendHistoryForRetry(history []RunHistoryMsg, userText string, assistantText string) []RunHistoryMsg {
	out := append([]RunHistoryMsg(nil), history...)
	if txt := strings.TrimSpace(userText); txt != "" {
		out = append(out, RunHistoryMsg{Role: "user", Text: txt})
	}
	if txt := strings.TrimSpace(assistantText); txt != "" {
		out = append(out, RunHistoryMsg{Role: "assistant", Text: txt})
	}
	return out
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
	if r == nil {
		return false
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	for _, blk := range r.assistantBlocks {
		switch b := blk.(type) {
		case ToolCallBlock:
			if b.Status == ToolCallStatusError {
				return true
			}
		case *ToolCallBlock:
			if b != nil && b.Status == ToolCallStatusError {
				return true
			}
		}
	}
	return false
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
		entries, _ := resultMap["entries"].([]any)
		return fmt.Sprintf("Directory listed successfully (%d entries).", len(entries))

	case "fs.stat":
		pathValue := strings.TrimSpace(anyToString(resultMap["path"]))
		isDir, _ := resultMap["is_dir"].(bool)
		if pathValue == "" {
			if isDir {
				return "Path metadata loaded (directory)."
			}
			return "Path metadata loaded."
		}
		if isDir {
			return fmt.Sprintf("Path metadata loaded for %s (directory).", pathValue)
		}
		return fmt.Sprintf("Path metadata loaded for %s.", pathValue)

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
	if r.hasAssistantToolError() {
		r.debug("ai.run.ensure_non_empty_assistant", "reason", "tool_error")
		_ = r.appendTextDelta("Tool call failed.")
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
	if r.hasAssistantToolError() {
		_ = r.appendTextDelta("Tool call failed.")
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
	r.sendStreamEvent(streamEventError{Type: "error", MessageID: r.messageID, Error: msg})
	r.setEndReason("error")
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
	if ctx.Err() == nil {
		return false
	}
	reason := "disconnected"
	switch r.getCancelReason() {
	case "canceled":
		reason = "canceled"
		r.finalizeNotice("canceled")
		r.setEndReason("canceled")
	case "timed_out":
		reason = "timed_out"
		r.finalizeNotice("timed_out")
		r.setEndReason("timed_out")
	default:
		r.finalizeNotice("disconnected")
		r.setEndReason("disconnected")
	}
	r.debug("ai.run.context_canceled_before_send", "reason", reason)
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

func (r *run) handleToolCall(ctx context.Context, sc *sidecarProcess, toolID string, toolName string, args map[string]any) error {
	toolID = strings.TrimSpace(toolID)
	if toolID == "" {
		var err error
		toolID, err = newToolID()
		if err != nil {
			return err
		}
	}
	toolName = strings.TrimSpace(toolName)
	if toolName == "" {
		return errors.New("missing tool_name")
	}
	if args == nil {
		args = map[string]any{}
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
		return r.sendToolResult(sc, env)
	}

	meta, err := r.sessionMetaForTool()
	if err != nil {
		toolErr := aitools.ClassifyError(aitools.Invocation{ToolName: toolName, Args: args, FSRoot: r.fsRoot}, err)
		setToolError(toolErr, "")
		env := aitools.ToolResultEnvelope{RunID: r.id, ToolID: toolID, Status: aitools.ResultStatusError, Error: toolErr}
		return r.sendToolResult(sc, env)
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
			return r.sendToolResult(sc, env)
		}
		if timedOut {
			toolErr := &aitools.ToolError{Code: aitools.ErrorCodeTimeout, Message: "Approval timed out", Retryable: true}
			block.ApprovalState = "rejected"
			setToolError(toolErr, "")
			env := aitools.ToolResultEnvelope{RunID: r.id, ToolID: toolID, Status: aitools.ResultStatusError, Error: toolErr}
			return r.sendToolResult(sc, env)
		}
		if !approved {
			toolErr := &aitools.ToolError{Code: aitools.ErrorCodePermissionDenied, Message: "Rejected by user", Retryable: false}
			block.ApprovalState = "rejected"
			setToolError(toolErr, "")
			env := aitools.ToolResultEnvelope{RunID: r.id, ToolID: toolID, Status: aitools.ResultStatusError, Error: toolErr}
			return r.sendToolResult(sc, env)
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
		toolErr := aitools.ClassifyError(aitools.Invocation{ToolName: toolName, Args: args, FSRoot: r.fsRoot}, toolErrRaw)
		recoveryAction := ""
		if aitools.ShouldRetryWithNormalizedArgs(toolErr) {
			recoveryAction = "retry_with_normalized_args"
		}
		setToolError(toolErr, recoveryAction)
		env := aitools.ToolResultEnvelope{RunID: r.id, ToolID: toolID, Status: aitools.ResultStatusError, Error: toolErr}
		return r.sendToolResult(sc, env)
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

	env := aitools.ToolResultEnvelope{RunID: r.id, ToolID: toolID, Status: aitools.ResultStatusSuccess, Result: result}
	return r.sendToolResult(sc, env)
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
	errEmptyFSRoot          = errors.New("empty fs_root")
	errInvalidFSRoot        = errors.New("invalid fs_root")
	errPathMustBeAbsolute   = errors.New("path must be absolute")
	errPathOutsideWorkspace = errors.New("path outside workspace root")
)

func (r *run) workspaceRootAbs() (string, error) {
	root := strings.TrimSpace(r.fsRoot)
	if root == "" {
		return "", errEmptyFSRoot
	}
	root = filepath.Clean(root)
	if !filepath.IsAbs(root) {
		abs, err := filepath.Abs(root)
		if err != nil {
			return "", errInvalidFSRoot
		}
		root = filepath.Clean(abs)
	}
	return root, nil
}

func (r *run) resolveAbsoluteWithinRoot(p string) (string, error) {
	rootAbs, err := r.workspaceRootAbs()
	if err != nil {
		return "", err
	}

	p = strings.TrimSpace(p)
	if p == "" {
		return "", errPathMustBeAbsolute
	}
	absPath := filepath.Clean(p)
	if !filepath.IsAbs(absPath) {
		return "", errPathMustBeAbsolute
	}

	ok, err := isWithinRoot(absPath, rootAbs)
	if err != nil {
		return "", errInvalidFSRoot
	}
	if !ok {
		return "", errPathOutsideWorkspace
	}
	return absPath, nil
}

func mapToolPathError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, errPathMustBeAbsolute):
		return errors.New("invalid path: must be absolute")
	case errors.Is(err, errPathOutsideWorkspace):
		return errors.New("path outside workspace root")
	default:
		return errors.New("invalid path")
	}
}

func mapToolCwdError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, errPathMustBeAbsolute):
		return errors.New("invalid cwd: must be absolute")
	case errors.Is(err, errPathOutsideWorkspace):
		return errors.New("cwd outside workspace root")
	default:
		return errors.New("invalid cwd")
	}
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

func (r *run) toolFSListDir(p string) (any, error) {
	abs, err := r.resolveAbsoluteWithinRoot(p)
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
		full := filepath.Clean(filepath.Join(abs, name))
		mod := info.ModTime().UnixMilli()
		out = append(out, map[string]any{
			"path":                full,
			"name":                name,
			"is_dir":              info.IsDir(),
			"size":                info.Size(),
			"modified_at_unix_ms": mod,
		})
	}
	return map[string]any{"entries": out}, nil
}

func (r *run) toolFSStat(p string) (any, error) {
	abs, err := r.resolveAbsoluteWithinRoot(p)
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

	abs, err := r.resolveAbsoluteWithinRoot(p)
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
	abs, err := r.resolveAbsoluteWithinRoot(p)
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
	var (
		cwdAbs string
		err    error
	)
	if cwd == "" {
		cwdAbs, err = r.workspaceRootAbs()
	} else {
		cwdAbs, err = r.resolveAbsoluteWithinRoot(cwd)
	}
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
