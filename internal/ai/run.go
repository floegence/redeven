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
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

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

	UploadsDir string

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

	uploadsDir string

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

	r := &run{
		log:                opts.Log,
		stateDir:           strings.TrimSpace(opts.StateDir),
		fsRoot:             strings.TrimSpace(opts.FSRoot),
		shell:              strings.TrimSpace(opts.Shell),
		cfg:                opts.AIConfig,
		sessionMeta:        runMeta,
		resolveProviderKey: opts.ResolveProviderKey,
		id:                 strings.TrimSpace(opts.RunID),
		channelID:          strings.TrimSpace(opts.ChannelID),
		endpointID:         strings.TrimSpace(opts.EndpointID),
		threadID:           strings.TrimSpace(opts.ThreadID),
		userPublicID:       strings.TrimSpace(opts.UserPublicID),
		messageID:          strings.TrimSpace(opts.MessageID),
		uploadsDir:         strings.TrimSpace(opts.UploadsDir),
		onStreamEvent:      opts.OnStreamEvent,
		w:                  opts.Writer,
		toolApprovals:      make(map[string]chan bool),
		toolBlockIndex:     make(map[string]int),
		sidecarScriptPath:  strings.TrimSpace(opts.SidecarScriptPath),
		maxWallTime:        opts.MaxWallTime,
		idleTimeout:        opts.IdleTimeout,
		toolApprovalTO:     opts.ToolApprovalTimeout,
		doneCh:             make(chan struct{}),
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

func (r *run) run(ctx context.Context, req RunRequest) error {
	if r == nil {
		return errors.New("nil run")
	}
	if ctx == nil {
		ctx = context.Background()
	}
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
	if !ok || providerID == "" {
		r.sendStreamEvent(streamEventError{Type: "error", MessageID: r.messageID, Error: "Invalid model id"})
		return fmt.Errorf("invalid model id %q", modelID)
	}
	if r.cfg == nil {
		r.sendStreamEvent(streamEventError{Type: "error", MessageID: r.messageID, Error: "AI not configured"})
		return errors.New("ai not configured")
	}
	knownProvider := false
	for _, p := range r.cfg.Providers {
		if strings.TrimSpace(p.ID) == providerID {
			knownProvider = true
			break
		}
	}
	if !knownProvider {
		r.sendStreamEvent(streamEventError{Type: "error", MessageID: r.messageID, Error: "Unknown AI provider"})
		return fmt.Errorf("unknown provider %q", providerID)
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
		r.sendStreamEvent(streamEventError{Type: "error", MessageID: r.messageID, Error: "AI provider key resolver not configured"})
		return errors.New("missing provider key resolver")
	}
	apiKey, ok, err := r.resolveProviderKey(providerID)
	if err != nil {
		r.sendStreamEvent(streamEventError{Type: "error", MessageID: r.messageID, Error: "Failed to load AI provider key"})
		return err
	}
	if !ok || strings.TrimSpace(apiKey) == "" {
		r.sendStreamEvent(streamEventError{
			Type:      "error",
			MessageID: r.messageID,
			Error:     fmt.Sprintf("AI provider %q is missing API key. Open Settings to configure it.", providerDisplay),
		})
		return fmt.Errorf("missing api key for provider %q", providerID)
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
		r.sendStreamEvent(streamEventError{Type: "error", MessageID: r.messageID, Error: "AI sidecar unavailable"})
		return err
	}
	r.mu.Lock()
	r.sidecar = sc
	r.mu.Unlock()
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

	_ = sc.send("initialize", map[string]any{
		"v":         1,
		"run_id":    r.id,
		"providers": providers,
	})

	// Resolve attachments (best-effort).
	sidecarAttachments := make([]map[string]any, 0, len(req.Input.Attachments))
	for _, a := range req.Input.Attachments {
		att, err := r.loadAttachmentForSidecar(a)
		if err != nil || att == nil {
			continue
		}
		sidecarAttachments = append(sidecarAttachments, att)
	}

	if err := sc.send("run.start", map[string]any{
		"run_id":  r.id,
		"model":   req.Model,
		"history": req.History,
		"input": map[string]any{
			"text":        req.Input.Text,
			"attachments": sidecarAttachments,
		},
		"options": req.Options,
	}); err != nil {
		r.sendStreamEvent(streamEventError{Type: "error", MessageID: r.messageID, Error: "Failed to start AI run"})
		return err
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

	for {
		select {
		case <-ctx.Done():
			reason := r.getCancelReason()
			switch reason {
			case "canceled":
				r.finalizeNotice("canceled")
				r.setEndReason("canceled")
				r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
				return nil
			case "timed_out":
				r.finalizeNotice("timed_out")
				r.setEndReason("timed_out")
				r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
				return nil
			default:
				// Parent context canceled (browser disconnect).
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
				r.finalizeNotice("disconnected")
				r.setEndReason("disconnected")
				r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
				return nil
			}
			r.sendStreamEvent(streamEventError{Type: "error", MessageID: r.messageID, Error: "AI sidecar error"})
			r.setEndReason("error")
			return err
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
			_ = r.appendTextDelta(p.Delta)

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
			if err := r.handleToolCall(ctx, sc, p.ToolID, p.ToolName, p.Args); err != nil {
				// tool errors are reported to the model; do not crash the whole run.
				continue
			}

		case "run.end":
			r.ensureNonEmptyAssistant()
			r.setEndReason("complete")
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
			r.sendStreamEvent(streamEventError{Type: "error", MessageID: r.messageID, Error: msgErr})
			r.setEndReason("error")
			return errors.New(msgErr)
		}
	}
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
		return
	}
	if r.hasAssistantToolError() {
		_ = r.appendTextDelta("Tool call failed.")
		return
	}
	// Product decision: empty successful completion becomes a stable, visible assistant message.
	_ = r.appendTextDelta("No response.")
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
	switch strings.TrimSpace(toolName) {
	case "fs.write_file", "terminal.exec":
		return true
	default:
		return false
	}
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

	// Insert a tool-call block.
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

	setToolError := func(errMsg string) {
		msg := strings.TrimSpace(errMsg)
		if msg == "" {
			msg = "Tool failed"
		}
		if r.log != nil {
			r.log.Warn("ai tool call failed",
				"run_id", r.id,
				"thread_id", r.threadID,
				"channel_id", r.channelID,
				"endpoint_id", r.endpointID,
				"tool_id", toolID,
				"tool_name", toolName,
				"error", msg,
			)
		}
		block.Status = ToolCallStatusError
		block.Error = msg
		r.sendStreamEvent(streamEventBlockSet{Type: "block-set", MessageID: r.messageID, BlockIndex: idx, Block: block})
		r.persistSetToolBlock(idx, block)
	}

	// Tool execution permissions are frozen at run start to avoid runtime session lookup drift.
	meta, err := r.sessionMetaForTool()
	if err != nil {
		setToolError(err.Error())
		return r.sendToolResult(sc, toolID, false, nil, err.Error())
	}

	// Approval gating for high-risk tools.
	if block.RequiresApproval {
		ch := make(chan bool, 1)
		r.mu.Lock()
		r.toolApprovals[toolID] = ch
		r.waitingApproval = true
		r.mu.Unlock()

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
			return r.sendToolResult(sc, toolID, false, nil, waitErr)
		}
		if timedOut {
			block.ApprovalState = "rejected"
			block.Status = ToolCallStatusError
			block.Error = "Approval timed out"
			r.sendStreamEvent(streamEventBlockSet{Type: "block-set", MessageID: r.messageID, BlockIndex: idx, Block: block})
			r.persistSetToolBlock(idx, block)
			return r.sendToolResult(sc, toolID, false, nil, "approval timed out")
		}
		if !approved {
			block.ApprovalState = "rejected"
			block.Status = ToolCallStatusError
			block.Error = "Rejected by user"
			r.sendStreamEvent(streamEventBlockSet{Type: "block-set", MessageID: r.messageID, BlockIndex: idx, Block: block})
			r.persistSetToolBlock(idx, block)
			return r.sendToolResult(sc, toolID, false, nil, "rejected by user")
		}

		block.ApprovalState = "approved"
	}

	// Execute.
	block.Status = ToolCallStatusRunning
	r.sendStreamEvent(streamEventBlockSet{Type: "block-set", MessageID: r.messageID, BlockIndex: idx, Block: block})
	r.persistSetToolBlock(idx, block)

	result, toolErr := r.execTool(ctx, meta, toolName, args)
	if toolErr != nil {
		setToolError(toolErr.Error())
		return r.sendToolResult(sc, toolID, false, nil, toolErr.Error())
	}

	block.Status = ToolCallStatusSuccess
	block.Result = result
	r.sendStreamEvent(streamEventBlockSet{Type: "block-set", MessageID: r.messageID, BlockIndex: idx, Block: block})
	r.persistSetToolBlock(idx, block)

	return r.sendToolResult(sc, toolID, true, result, "")
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

func (r *run) sendToolResult(sc *sidecarProcess, toolID string, ok bool, result any, errMsg string) error {
	if sc == nil {
		return errors.New("sidecar not ready")
	}
	params := map[string]any{
		"run_id":  r.id,
		"tool_id": toolID,
		"ok":      ok,
	}
	if ok {
		params["result"] = result
	} else {
		params["error"] = strings.TrimSpace(errMsg)
	}
	return sc.send("tool.result", params)
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

func (r *run) resolveVirtual(p string) (virtual string, real string, err error) {
	root := strings.TrimSpace(r.fsRoot)
	if root == "" {
		return "", "", errors.New("empty fs_root")
	}

	p = strings.TrimSpace(p)
	if p == "" {
		p = "/"
	}
	p = strings.ReplaceAll(p, "\\", "/")
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	vp := path.Clean(p)
	if vp == "." {
		vp = "/"
	}
	if !strings.HasPrefix(vp, "/") {
		vp = "/" + vp
	}

	rel := strings.TrimPrefix(vp, "/")
	relOS := filepath.FromSlash(rel)
	if relOS != "" && filepath.IsAbs(relOS) {
		return "", "", errors.New("invalid absolute path")
	}

	abs := filepath.Clean(filepath.Join(root, relOS))
	ok, err := isWithinRoot(abs, root)
	if err != nil || !ok {
		return "", "", errors.New("path escapes root")
	}
	return vp, abs, nil
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
	vp, abs, err := r.resolveVirtual(p)
	if err != nil {
		return nil, errors.New("invalid path")
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
		full := path.Join(vp, name)
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
	vp, abs, err := r.resolveVirtual(p)
	if err != nil {
		return nil, errors.New("invalid path")
	}
	info, err := os.Stat(abs)
	if err != nil || info == nil {
		return nil, errors.New("not found")
	}
	mod := info.ModTime().UnixMilli()
	out := map[string]any{
		"path":                vp,
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

	_, abs, err := r.resolveVirtual(p)
	if err != nil {
		return nil, errors.New("invalid path")
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
	_, abs, err := r.resolveVirtual(p)
	if err != nil {
		return nil, errors.New("invalid path")
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

	_, cwdAbs, err := r.resolveVirtual(cwd)
	if err != nil {
		return nil, errors.New("invalid cwd")
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
