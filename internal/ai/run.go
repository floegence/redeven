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

	"github.com/floegence/redeven-agent/internal/ai/threadstore"
	aitools "github.com/floegence/redeven-agent/internal/ai/tools"
	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
	"github.com/floegence/redeven-agent/internal/websearch"
)

type runOptions struct {
	Log      *slog.Logger
	StateDir string
	FSRoot   string
	Shell    string

	AIConfig *config.AIConfig

	SessionMeta         *session.Meta
	ResolveProviderKey  func(providerID string) (string, bool, error)
	ResolveWebSearchKey func(providerID string) (string, bool, error)

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

	sessionMeta         *session.Meta
	resolveProviderKey  func(providerID string) (string, bool, error)
	resolveWebSearchKey func(providerID string) (string, bool, error)

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

	muCancel        sync.Mutex
	cancelReason    string // "canceled"|"timed_out"|""
	endReason       string // "complete"|"canceled"|"timed_out"|"disconnected"|"error"
	cancelRequested bool
	cancelFn        context.CancelFunc
	detached        atomic.Bool // hard-canceled: stop emitting realtime events and skip thread state updates
	busyCount       atomic.Int32

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

	webSearchToolEnabled   bool
	openAIWebSearchEnabled bool

	collectedWebSources        map[string]SourceRef // url -> source
	collectedWebSourceOrder    []string
	sourcesBlockAlreadyEmitted bool

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
		log:                     opts.Log,
		stateDir:                strings.TrimSpace(opts.StateDir),
		fsRoot:                  strings.TrimSpace(opts.FSRoot),
		shell:                   strings.TrimSpace(opts.Shell),
		cfg:                     opts.AIConfig,
		sessionMeta:             runMeta,
		resolveProviderKey:      opts.ResolveProviderKey,
		resolveWebSearchKey:     opts.ResolveWebSearchKey,
		id:                      strings.TrimSpace(opts.RunID),
		channelID:               strings.TrimSpace(opts.ChannelID),
		endpointID:              strings.TrimSpace(opts.EndpointID),
		threadID:                strings.TrimSpace(opts.ThreadID),
		userPublicID:            strings.TrimSpace(opts.UserPublicID),
		messageID:               strings.TrimSpace(opts.MessageID),
		uploadsDir:              strings.TrimSpace(opts.UploadsDir),
		threadsDB:               opts.ThreadsDB,
		persistOpTimeout:        opts.PersistOpTimeout,
		onStreamEvent:           opts.OnStreamEvent,
		w:                       opts.Writer,
		toolApprovals:           make(map[string]chan bool),
		toolBlockIndex:          make(map[string]int),
		maxWallTime:             opts.MaxWallTime,
		idleTimeout:             opts.IdleTimeout,
		toolApprovalTO:          opts.ToolApprovalTimeout,
		doneCh:                  make(chan struct{}),
		lifecycleMinEmitGap:     600 * time.Millisecond,
		collectedWebSources:     make(map[string]SourceRef),
		collectedWebSourceOrder: make([]string, 0, 8),
		subagentDepth:           opts.SubagentDepth,
		allowSubagentDelegate: func() bool {
			if opts.AllowSubagentDelegate {
				return true
			}
			return opts.SubagentDepth <= 0
		}(),
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

	// Preserve UI-only tool-call state (e.g. collapsed) across block-set replacements.
	//
	// The client ChatProvider replaces blocks on "block-set". If a tool-call block update does
	// not include the collapsed field, the UI will reset it to default. Since collapsed is
	// persisted in assistantBlocks when set, merge it into outgoing frames as a best-effort.
	if bs, ok := ev.(streamEventBlockSet); ok {
		getCollapsed := func(idx int) (*bool, bool) {
			if idx < 0 {
				return nil, false
			}
			r.muAssistant.Lock()
			defer r.muAssistant.Unlock()
			if idx >= len(r.assistantBlocks) {
				return nil, false
			}
			switch prev := r.assistantBlocks[idx].(type) {
			case ToolCallBlock:
				if prev.Collapsed == nil {
					return nil, false
				}
				v := *prev.Collapsed
				return &v, true
			case *ToolCallBlock:
				if prev == nil || prev.Collapsed == nil {
					return nil, false
				}
				v := *prev.Collapsed
				return &v, true
			case map[string]any:
				if c, ok := prev["collapsed"].(bool); ok {
					v := c
					return &v, true
				}
				return nil, false
			default:
				return nil, false
			}
		}

		switch blk := bs.Block.(type) {
		case ToolCallBlock:
			if blk.Collapsed == nil {
				if c, ok := getCollapsed(bs.BlockIndex); ok {
					blk.Collapsed = c
					bs.Block = blk
					ev = bs
				}
			}
		case *ToolCallBlock:
			if blk != nil {
				cp := *blk
				if cp.Collapsed == nil {
					if c, ok := getCollapsed(bs.BlockIndex); ok {
						cp.Collapsed = c
					}
				}
				bs.Block = cp
				ev = bs
			}
		case map[string]any:
			typ, _ := blk["type"].(string)
			if strings.TrimSpace(typ) == "tool-call" {
				if _, has := blk["collapsed"]; !has {
					if c, ok := getCollapsed(bs.BlockIndex); ok {
						cp := make(map[string]any, len(blk)+1)
						for k, v := range blk {
							cp[k] = v
						}
						cp["collapsed"] = *c
						bs.Block = cp
						ev = bs
					}
				}
			}
		}
	}

	r.touchActivity()
	if !r.detached.Load() && r.onStreamEvent != nil {
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
		finalizationReason := strings.TrimSpace(r.getFinalizationReason())
		finalizationClass := classifyFinalizationReason(finalizationReason)
		completionContract := completionContractForIntent(strings.TrimSpace(req.Options.Intent))
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
				errCode = string(aitools.ErrorCodeUnknown)
				if errMsg == "" {
					errMsg = "Run ended without explicit completion."
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
			"state":               string(state),
			"error_code":          errCode,
			"error":               errMsg,
			"finalization_reason": finalizationReason,
			"finalization_class":  finalizationClass,
			"completion_contract": completionContract,
		})
		r.debug("ai.run.end",
			"end_reason", endReason,
			"finalization_reason", finalizationReason,
			"finalization_class", finalizationClass,
			"completion_contract", completionContract,
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
	return r.runNative(execCtx, req, *providerCfg, strings.TrimSpace(apiKey), strings.TrimSpace(taskObjective))
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
	delta = r.normalizeMarkdownDelta(r.currentTextBlockIndex, delta)
	if delta == "" {
		return nil
	}
	r.persistAppendMarkdownDelta(r.currentTextBlockIndex, delta)
	r.sendStreamEvent(streamEventBlockDelta{Type: "block-delta", MessageID: r.messageID, BlockIndex: r.currentTextBlockIndex, Delta: delta})
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

func (r *run) assistantMarkdownTextSnapshot() string {
	if r == nil {
		return ""
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	parts := make([]string, 0, len(r.assistantBlocks))
	for _, blk := range r.assistantBlocks {
		b, ok := blk.(*persistedMarkdownBlock)
		if !ok || b == nil {
			continue
		}
		txt := strings.TrimSpace(b.Content)
		if txt == "" {
			continue
		}
		parts = append(parts, txt)
	}
	return strings.TrimSpace(strings.Join(parts, "\n\n"))
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

func (r *run) persistToolCallSnapshot(toolID string, toolName string, status ToolCallStatus, args map[string]any, result any, toolErr *aitools.ToolError, recoveryAction string, startedAt time.Time, endedAt time.Time) {
	if r == nil {
		return
	}
	argsRedacted := any(redactAnyForLog("args", args, 0))
	if strings.TrimSpace(toolName) == "terminal.exec" {
		argsRedacted = redactAnyForPersist("args", args, 0)
	}
	argsPersist := marshalPersistJSON(argsRedacted, 4000)
	resultPersist := ""
	if result != nil {
		resultRedacted := any(redactAnyForLog("result", result, 0))
		if strings.TrimSpace(toolName) == "terminal.exec" {
			resultRedacted = redactAnyForPersist("result", result, 0)
		}
		resultPersist = marshalPersistJSON(resultRedacted, 4000)
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
	enforcePlanModeGuard := r.cfg.EffectiveEnforcePlanModeGuard()
	blockDangerousCommands := r.cfg.EffectiveBlockDangerousCommands()
	isPlanMode := strings.TrimSpace(strings.ToLower(r.runMode)) == config.AIModePlan
	denyDangerous := blockDangerousCommands && dangerous
	denyPlanMutating := enforcePlanModeGuard && isPlanMode && mutating
	requireApprovalForInvocation := requireUserApproval && needsApproval
	commandRisk, normalizedCommand := aitools.InvocationRiskInfo(toolName, args)
	commandRisk = strings.TrimSpace(commandRisk)
	normalizedCommand = strings.TrimSpace(normalizedCommand)
	policyDecision := "allow"
	policyReason := "none"
	if denyDangerous {
		policyDecision = "deny"
		policyReason = "dangerous_command_blocked"
	} else if denyPlanMutating {
		policyDecision = "deny"
		policyReason = "plan_mode_guard_blocked"
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
			"policy_decision":                 policyDecision,
			"policy_reason":                   policyReason,
			"policy_require_user_approval":    requireUserApproval,
			"policy_enforce_plan_mode_guard":  enforcePlanModeGuard,
			"policy_block_dangerous_commands": blockDangerousCommands,
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
		"policy_enforce_plan_mode_guard", enforcePlanModeGuard,
		"policy_block_dangerous_commands", blockDangerousCommands,
		"command_risk", commandRisk,
		"normalized_command", normalizedCommand,
		"policy_decision", policyDecision,
		"policy_reason", policyReason,
		"args_preview", previewAnyForLog(redactToolArgsForLog(toolName, args), 512),
	)

	r.mu.Lock()
	idx := r.nextBlockIndex
	r.nextBlockIndex++
	r.needNewTextBlock = true
	r.toolBlockIndex[toolID] = idx
	r.mu.Unlock()

	block := ToolCallBlock{
		Type:     "tool-call",
		ToolName: toolName,
		ToolID:   toolID,
		Args:     argsForPersist,
		Status:   ToolCallStatusPending,
	}

	if requireApprovalForInvocation {
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

	if denyDangerous {
		toolErr := &aitools.ToolError{
			Code:      aitools.ErrorCodePermissionDenied,
			Message:   "Command blocked by dangerous-command policy",
			Retryable: false,
			SuggestedFixes: []string{
				"Use a readonly command for investigation.",
				"Use apply_patch for file edits instead of destructive shell commands.",
				"Disable block_dangerous_commands in Settings > AI > Execution policy only if you accept the risk.",
			},
		}
		setToolError(toolErr, "")
		return outcome, nil
	}

	if denyPlanMutating {
		toolErr := &aitools.ToolError{
			Code:      aitools.ErrorCodePermissionDenied,
			Message:   "Mutating tool call blocked by plan-mode guard policy",
			Retryable: false,
			SuggestedFixes: []string{
				"Switch AI mode to act to enable mutating tools.",
				"Disable enforce_plan_mode_guard in Settings > AI > Execution policy if you need plan-mode execution.",
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
	endBusy := r.beginBusy()
	defer endBusy()
	block.Status = ToolCallStatusRunning
	r.sendStreamEvent(streamEventBlockSet{Type: "block-set", MessageID: r.messageID, BlockIndex: idx, Block: block})
	r.persistSetToolBlock(idx, block)
	r.persistToolCallSnapshot(toolID, toolName, block.Status, args, nil, nil, "", toolStartedAt, time.Now())

	result, toolErrRaw := r.execTool(ctx, meta, toolID, toolName, args)
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

	if toolName == "web.search" {
		if parsed, ok := parseWebSearchResult(result); ok {
			r.recordWebSearchSources(parsed)
			if md := formatWebSearchMarkdown(parsed); md != "" {
				block.Children = []any{map[string]any{"type": "markdown", "content": md}}
			}
		}
		expanded := false
		block.Collapsed = &expanded
	}
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
	if block.Collapsed == nil && idx >= 0 && idx < len(r.assistantBlocks) {
		switch prev := r.assistantBlocks[idx].(type) {
		case ToolCallBlock:
			if prev.Collapsed != nil {
				v := *prev.Collapsed
				block.Collapsed = &v
			}
		case *ToolCallBlock:
			if prev != nil && prev.Collapsed != nil {
				v := *prev.Collapsed
				block.Collapsed = &v
			}
		case map[string]any:
			if c, ok := prev["collapsed"].(bool); ok {
				v := c
				block.Collapsed = &v
			}
		}
	}
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
	var (
		sb              strings.Builder
		askUserQuestion string
	)
	for _, blk := range blocks {
		if askUserQuestion == "" {
			askUserQuestion = extractAskUserQuestionFromBlock(blk)
		}
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

	assistantText := strings.TrimSpace(sb.String())
	if assistantText == "" {
		assistantText = askUserQuestion
	}
	return string(b), assistantText, assistantAt, nil
}

func extractAskUserQuestionFromBlock(block any) string {
	switch v := block.(type) {
	case ToolCallBlock:
		if strings.TrimSpace(v.ToolName) != "ask_user" {
			return ""
		}
		if q := extractQuestionFromAny(v.Args); q != "" {
			return q
		}
		return extractQuestionFromAny(v.Result)
	case *ToolCallBlock:
		if v == nil || strings.TrimSpace(v.ToolName) != "ask_user" {
			return ""
		}
		if q := extractQuestionFromAny(v.Args); q != "" {
			return q
		}
		return extractQuestionFromAny(v.Result)
	case map[string]any:
		typ, _ := v["type"].(string)
		if strings.TrimSpace(typ) != "tool-call" {
			return ""
		}
		toolName, _ := v["toolName"].(string)
		if strings.TrimSpace(toolName) != "ask_user" {
			return ""
		}
		if q := extractQuestionFromAny(v["args"]); q != "" {
			return q
		}
		return extractQuestionFromAny(v["result"])
	default:
		return ""
	}
}

func extractQuestionFromAny(value any) string {
	switch v := value.(type) {
	case map[string]any:
		question, _ := v["question"].(string)
		return strings.TrimSpace(question)
	case map[string]string:
		return strings.TrimSpace(v["question"])
	default:
		return ""
	}
}

func (r *run) setToolCollapsed(toolID string, collapsed bool) bool {
	if r == nil {
		return false
	}
	toolID = strings.TrimSpace(toolID)
	if toolID == "" {
		return false
	}

	var (
		idx      = -1
		nextAny  any
		nextTool ToolCallBlock
	)

	r.muAssistant.Lock()
	for i, blk := range r.assistantBlocks {
		switch v := blk.(type) {
		case ToolCallBlock:
			if strings.TrimSpace(v.ToolID) != toolID {
				continue
			}
			idx = i
			b := collapsed
			v.Collapsed = &b
			r.assistantBlocks[i] = v
			nextTool = v
			nextAny = v
		case *ToolCallBlock:
			if v == nil || strings.TrimSpace(v.ToolID) != toolID {
				continue
			}
			idx = i
			cp := *v
			b := collapsed
			cp.Collapsed = &b
			r.assistantBlocks[i] = cp
			nextTool = cp
			nextAny = cp
		case map[string]any:
			typ, _ := v["type"].(string)
			if strings.TrimSpace(typ) != "tool-call" {
				continue
			}
			rawToolID, _ := v["toolId"].(string)
			if strings.TrimSpace(rawToolID) != toolID {
				continue
			}
			idx = i
			cp := make(map[string]any, len(v)+1)
			for k, val := range v {
				cp[k] = val
			}
			cp["collapsed"] = collapsed
			r.assistantBlocks[i] = cp
			nextAny = cp
		default:
			continue
		}
		if idx >= 0 {
			break
		}
	}
	r.muAssistant.Unlock()

	if idx < 0 {
		return false
	}
	if nextAny == nil {
		nextAny = nextTool
	}

	r.sendStreamEvent(streamEventBlockSet{Type: "block-set", MessageID: r.messageID, BlockIndex: idx, Block: nextAny})
	return true
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

func escapeMarkdownLinkText(s string) string {
	if s == "" {
		return ""
	}
	s = strings.ReplaceAll(s, "[", "\\[")
	s = strings.ReplaceAll(s, "]", "\\]")
	return s
}

func formatWebSearchMarkdown(res websearch.SearchResult) string {
	items := res.Results
	if len(items) == 0 {
		items = res.Sources
	}
	if len(items) == 0 {
		return ""
	}

	var sb strings.Builder
	sb.WriteString("Top results:\n")
	shown := 0
	for _, item := range items {
		rawURL := strings.TrimSpace(item.URL)
		if rawURL == "" {
			continue
		}
		title := strings.TrimSpace(item.Title)
		if title == "" {
			title = rawURL
		}
		title = escapeMarkdownLinkText(title)
		snippet := strings.TrimSpace(item.Snippet)
		snippet = strings.ReplaceAll(snippet, "\n", " ")
		snippet = strings.ReplaceAll(snippet, "\r", " ")
		snippet = strings.TrimSpace(snippet)

		shown++
		if snippet != "" {
			sb.WriteString(fmt.Sprintf("%d. [%s](%s) - %s\n", shown, title, rawURL, snippet))
		} else {
			sb.WriteString(fmt.Sprintf("%d. [%s](%s)\n", shown, title, rawURL))
		}
		if shown >= 8 {
			break
		}
	}
	return strings.TrimSpace(sb.String())
}

func formatSourcesMarkdown(sources []SourceRef) string {
	if len(sources) == 0 {
		return ""
	}
	var sb strings.Builder
	sb.WriteString("Sources:\n")
	shown := 0
	for _, src := range sources {
		url := strings.TrimSpace(src.URL)
		if url == "" {
			continue
		}
		title := strings.TrimSpace(src.Title)
		if title == "" {
			title = url
		}
		title = escapeMarkdownLinkText(title)
		shown++
		sb.WriteString(fmt.Sprintf("%d. [%s](%s)\n", shown, title, url))
		if shown >= 20 {
			break
		}
	}
	return strings.TrimSpace(sb.String())
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

func (r *run) emitSourcesToolBlock(source string) {
	if r == nil {
		return
	}
	source = strings.TrimSpace(source)

	var sources []SourceRef
	var idx int
	r.mu.Lock()
	if r.sourcesBlockAlreadyEmitted {
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
	r.sourcesBlockAlreadyEmitted = true
	idx = r.nextBlockIndex
	r.nextBlockIndex++
	r.needNewTextBlock = true
	r.mu.Unlock()

	toolID, err := newToolID()
	if err != nil {
		toolID = "tool_sources"
	}
	expanded := false
	block := ToolCallBlock{
		Type:      "tool-call",
		ToolName:  "sources",
		ToolID:    toolID,
		Args:      map[string]any{"source": source},
		Status:    ToolCallStatusSuccess,
		Result:    map[string]any{"sources": sources},
		Children:  nil,
		Collapsed: &expanded,
	}
	if md := formatSourcesMarkdown(sources); md != "" {
		block.Children = []any{map[string]any{"type": "markdown", "content": md}}
	}
	r.sendStreamEvent(streamEventBlockSet{Type: "block-set", MessageID: r.messageID, BlockIndex: idx, Block: block})
	r.persistSetToolBlock(idx, block)
}

func (r *run) execTool(ctx context.Context, meta *session.Meta, toolID string, toolName string, args map[string]any) (any, error) {
	switch toolName {
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
		cwd := strings.TrimSpace(p.Cwd)
		workdir := strings.TrimSpace(p.Workdir)
		if cwd == "" {
			cwd = workdir
		} else if workdir != "" && filepath.Clean(cwd) != filepath.Clean(workdir) {
			return nil, errors.New("invalid cwd")
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

	case "delegate_task":
		if meta == nil || !meta.CanExecute {
			return nil, errors.New("execute permission denied")
		}
		return r.delegateTask(ctx, cloneAnyMap(args))

	case "send_subagent_input":
		if meta == nil || !meta.CanExecute {
			return nil, errors.New("execute permission denied")
		}
		var p struct {
			ID        string `json:"id"`
			Message   string `json:"message"`
			Interrupt bool   `json:"interrupt"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		id := strings.TrimSpace(p.ID)
		message := strings.TrimSpace(p.Message)
		if id == "" || message == "" {
			return nil, errors.New("missing id or message")
		}
		return r.sendSubagentInput(id, message, p.Interrupt)

	case "wait_subagents":
		if meta == nil || !meta.CanExecute {
			return nil, errors.New("execute permission denied")
		}
		var p struct {
			IDs       []string `json:"ids"`
			TimeoutMS int64    `json:"timeout_ms"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		timeoutMS := p.TimeoutMS
		if timeoutMS <= 0 {
			timeoutMS = 30_000
		}
		if timeoutMS < 10_000 {
			timeoutMS = 10_000
		}
		if timeoutMS > 300_000 {
			timeoutMS = 300_000
		}
		waitCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMS)*time.Millisecond)
		defer cancel()
		out, timedOut := r.waitSubagents(waitCtx, p.IDs)
		return map[string]any{"status": out, "timed_out": timedOut}, nil

	case "close_subagent":
		if meta == nil || !meta.CanExecute {
			return nil, errors.New("execute permission denied")
		}
		var p struct {
			ID string `json:"id"`
		}
		b, _ := json.Marshal(args)
		if err := json.Unmarshal(b, &p); err != nil {
			return nil, errors.New("invalid args")
		}
		id := strings.TrimSpace(p.ID)
		if id == "" {
			return nil, errors.New("missing id")
		}
		return r.closeSubagent(id)

	default:
		return nil, fmt.Errorf("unknown tool: %s", toolName)
	}
}

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
	if err := applyUnifiedDiff(workingDirAbs, patchText); err != nil {
		return nil, err
	}

	filesChanged, hunks, additions, deletions := summarizeUnifiedDiff(patchText)
	return map[string]any{
		"files_changed": filesChanged,
		"hunks":         hunks,
		"additions":     additions,
		"deletions":     deletions,
	}, nil
}

func summarizeUnifiedDiff(patchText string) (filesChanged int, hunks int, additions int, deletions int) {
	seenFile := make(map[string]struct{})
	lines := strings.Split(patchText, "\n")
	for _, line := range lines {
		switch {
		case strings.HasPrefix(line, "diff --git "):
			parts := strings.Fields(line)
			if len(parts) >= 4 {
				file := strings.TrimSpace(parts[3])
				if file != "" {
					if _, ok := seenFile[file]; !ok {
						seenFile[file] = struct{}{}
						filesChanged++
					}
				}
			}
		case strings.HasPrefix(line, "@@"):
			hunks++
		case strings.HasPrefix(line, "+++"), strings.HasPrefix(line, "---"):
			continue
		case strings.HasPrefix(line, "+"):
			additions++
		case strings.HasPrefix(line, "-"):
			deletions++
		}
	}
	return filesChanged, hunks, additions, deletions
}

// --- terminal.exec ---

const (
	terminalExecDefaultTimeout = 10 * time.Minute
	terminalExecMaxTimeout     = 30 * time.Minute
)

func (r *run) toolTerminalExec(ctx context.Context, command string, stdin string, cwd string, timeoutMS int64) (any, error) {
	command = strings.TrimSpace(command)
	if command == "" {
		return nil, errors.New("missing command")
	}
	if len(stdin) > 200_000 {
		return nil, errors.New("stdin too large")
	}
	if timeoutMS <= 0 {
		timeoutMS = int64(terminalExecDefaultTimeout / time.Millisecond)
	}
	if timeoutMS > int64(terminalExecMaxTimeout/time.Millisecond) {
		timeoutMS = int64(terminalExecMaxTimeout / time.Millisecond)
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
	cmd.Env = prependRedevenBinToEnv(os.Environ())
	if stdin != "" {
		cmd.Stdin = strings.NewReader(stdin)
	}

	lim := newCombinedLimitedBuffers(200_000)
	cmd.Stdout = lim.Stdout()
	cmd.Stderr = lim.Stderr()

	runErr := cmd.Run()
	durationMS := time.Since(started).Milliseconds()
	timedOut := errors.Is(execCtx.Err(), context.DeadlineExceeded)

	exitCode := 0
	if runErr != nil {
		if timedOut {
			exitCode = 124
		} else if ee := (*exec.ExitError)(nil); errors.As(runErr, &ee) {
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
		"timed_out":   timedOut,
	}, nil
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
