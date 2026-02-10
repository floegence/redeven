package ai

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven-agent/internal/ai/threadstore"
	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
)

var (
	ErrNotConfigured = errors.New("ai not configured")
	ErrRunActive     = errors.New("run already active")
	ErrThreadBusy    = errors.New("thread already active")
	ErrConfigLocked  = errors.New("cannot update ai settings while a run is active")
)

type Options struct {
	Logger   *slog.Logger
	StateDir string

	FSRoot string
	Shell  string

	Config *config.AIConfig

	// PersistOpTimeout is the per-operation timeout for threadstore persistence
	// (SQLite reads/writes). It must NOT be tied to a run's overall lifetime, since
	// runs can take much longer than persistence should ever be allowed to block.
	//
	// When zero, it defaults to 10 seconds.
	PersistOpTimeout time.Duration

	// SidecarScriptPath overrides the embedded sidecar bundle path.
	//
	// When empty, the embedded bundle is materialized under <stateDir>/ai/sidecar/sidecar.mjs.
	// This is intended for tests only.
	SidecarScriptPath string

	// RunMaxWallTime is the hard cap for a single run's lifetime.
	//
	// When zero, it defaults to 15 minutes.
	RunMaxWallTime time.Duration
	// RunIdleTimeout cancels a run if no sidecar event is received for the duration.
	//
	// When zero, it defaults to 2 minutes.
	RunIdleTimeout time.Duration
	// ToolApprovalTimeout is the max time a run waits for user approval for high-risk tools.
	//
	// When zero, it defaults to 10 minutes.
	ToolApprovalTimeout time.Duration
	// StreamWriteTimeout is the best-effort per-frame write deadline for the NDJSON stream.
	//
	// When zero, it defaults to 5 seconds.
	StreamWriteTimeout time.Duration

	// ResolveProviderAPIKey returns the API key for the given provider id.
	//
	// It should read from a local secrets store, not from config.json.
	ResolveProviderAPIKey func(providerID string) (string, bool, error)
}

type Service struct {
	log *slog.Logger

	stateDir string
	fsRoot   string
	shell    string

	cfg *config.AIConfig

	persistOpTO time.Duration

	sidecarScriptPath string
	runMaxWallTime    time.Duration
	runIdleTimeout    time.Duration
	approvalTimeout   time.Duration
	streamWriteTO     time.Duration

	resolveProviderKey func(providerID string) (string, bool, error)

	mu              sync.Mutex
	activeRunByChan map[string]string // channel_id -> run_id
	activeRunByTh   map[string]string // <endpoint_id>:<thread_id> -> run_id
	runs            map[string]*run

	realtimeWriters       map[*rpc.Server]*aiSinkWriter
	realtimeByEndpoint    map[string]map[*rpc.Server]struct{}
	realtimeEndpointBySRV map[*rpc.Server]string

	uploadsDir string
	threadsDB  *threadstore.Store
}

const (
	defaultPersistOpTimeout = 10 * time.Second
	defaultRunMaxWallTime   = 15 * time.Minute
	defaultRunIdleTimeout   = 2 * time.Minute
	defaultToolApprovalTO   = 10 * time.Minute
	defaultStreamWriteTO    = 5 * time.Second
)

func runThreadKey(endpointID string, threadID string) string {
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return ""
	}
	// endpoint_id is an env public id; ":" is safe as a delimiter.
	return endpointID + ":" + threadID
}

func NewService(opts Options) (*Service, error) {
	if strings.TrimSpace(opts.StateDir) == "" {
		return nil, errors.New("missing StateDir")
	}
	if strings.TrimSpace(opts.FSRoot) == "" {
		return nil, errors.New("missing FSRoot")
	}

	logger := opts.Logger
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}

	uploadsDir := filepath.Join(strings.TrimSpace(opts.StateDir), "ai", "uploads")
	if err := os.MkdirAll(uploadsDir, 0o700); err != nil {
		return nil, err
	}

	threadsPath := filepath.Join(strings.TrimSpace(opts.StateDir), "ai", "threads.sqlite")
	ts, err := threadstore.Open(threadsPath)
	if err != nil {
		return nil, err
	}

	resolveProviderKey := opts.ResolveProviderAPIKey
	if resolveProviderKey == nil {
		resolveProviderKey = func(string) (string, bool, error) { return "", false, nil }
	}

	maxWall := opts.RunMaxWallTime
	if maxWall <= 0 {
		maxWall = defaultRunMaxWallTime
	}
	idleTO := opts.RunIdleTimeout
	if idleTO <= 0 {
		idleTO = defaultRunIdleTimeout
	}
	approvalTO := opts.ToolApprovalTimeout
	if approvalTO <= 0 {
		approvalTO = defaultToolApprovalTO
	}
	streamWTO := opts.StreamWriteTimeout
	if streamWTO <= 0 {
		streamWTO = defaultStreamWriteTO
	}

	persistTO := opts.PersistOpTimeout
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}

	return &Service{
		log:                   logger,
		stateDir:              strings.TrimSpace(opts.StateDir),
		fsRoot:                strings.TrimSpace(opts.FSRoot),
		shell:                 strings.TrimSpace(opts.Shell),
		cfg:                   opts.Config,
		persistOpTO:           persistTO,
		sidecarScriptPath:     strings.TrimSpace(opts.SidecarScriptPath),
		runMaxWallTime:        maxWall,
		runIdleTimeout:        idleTO,
		approvalTimeout:       approvalTO,
		streamWriteTO:         streamWTO,
		resolveProviderKey:    resolveProviderKey,
		activeRunByChan:       make(map[string]string),
		activeRunByTh:         make(map[string]string),
		runs:                  make(map[string]*run),
		realtimeWriters:       make(map[*rpc.Server]*aiSinkWriter),
		realtimeByEndpoint:    make(map[string]map[*rpc.Server]struct{}),
		realtimeEndpointBySRV: make(map[*rpc.Server]string),
		uploadsDir:            uploadsDir,
		threadsDB:             ts,
	}, nil
}

func (s *Service) Close() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	ts := s.threadsDB
	s.threadsDB = nil
	writers := make([]*aiSinkWriter, 0, len(s.realtimeWriters))
	for srv, w := range s.realtimeWriters {
		if w == nil {
			continue
		}
		writers = append(writers, w)
		delete(s.realtimeWriters, srv)
	}
	s.realtimeByEndpoint = make(map[string]map[*rpc.Server]struct{})
	s.realtimeEndpointBySRV = make(map[*rpc.Server]string)
	s.mu.Unlock()

	for _, w := range writers {
		w.Close()
	}
	if ts != nil {
		return ts.Close()
	}
	return nil
}

func (s *Service) Enabled() bool {
	if s == nil {
		return false
	}
	s.mu.Lock()
	enabled := s.cfg != nil
	s.mu.Unlock()
	return enabled
}

// UpdateConfig updates the in-memory AI config after persisting it via the provided callback.
//
// It blocks new runs from starting while the update is in progress. If any run is active,
// the update is rejected with ErrConfigLocked.
func (s *Service) UpdateConfig(next *config.AIConfig, persist func() error) error {
	if s == nil {
		return errors.New("nil service")
	}
	if persist == nil {
		return errors.New("missing persist function")
	}
	if next != nil {
		if err := next.Validate(); err != nil {
			return err
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.activeRunByChan) > 0 {
		return ErrConfigLocked
	}

	if err := persist(); err != nil {
		return err
	}

	s.cfg = next
	return nil
}

func (s *Service) HasActiveRun(channelID string) bool {
	if s == nil {
		return false
	}
	channelID = strings.TrimSpace(channelID)
	if channelID == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return strings.TrimSpace(s.activeRunByChan[channelID]) != ""
}

func (s *Service) HasActiveThread(threadID string) bool {
	if s == nil {
		return false
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// Deprecated: callers should use HasActiveThreadForEndpoint for correctness.
	for k := range s.activeRunByTh {
		if strings.HasSuffix(k, ":"+threadID) {
			return true
		}
	}
	return false
}

func (s *Service) HasActiveThreadForEndpoint(endpointID string, threadID string) bool {
	if s == nil {
		return false
	}
	k := runThreadKey(endpointID, threadID)
	if k == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return strings.TrimSpace(s.activeRunByTh[k]) != ""
}

func (s *Service) ListModels() (*ModelsResponse, error) {
	if s == nil {
		return nil, ErrNotConfigured
	}
	s.mu.Lock()
	cfg := s.cfg
	s.mu.Unlock()
	if cfg == nil {
		return nil, ErrNotConfigured
	}

	providerNameByID := make(map[string]string, len(cfg.Providers))
	for _, p := range cfg.Providers {
		id := strings.TrimSpace(p.ID)
		if id == "" {
			continue
		}
		name := strings.TrimSpace(p.Name)
		if name == "" {
			name = id
		}
		providerNameByID[id] = name
	}

	defaultProviderID := ""
	defaultModelName := ""
	defaultModelDisplayName := ""
	for _, p := range cfg.Providers {
		pid := strings.TrimSpace(p.ID)
		pn := strings.TrimSpace(providerNameByID[pid])
		if pn == "" {
			pn = pid
		}
		for _, m := range p.Models {
			if !m.IsDefault {
				continue
			}
			mn := strings.TrimSpace(m.ModelName)
			if pid == "" || mn == "" {
				continue
			}
			defaultProviderID = pid
			defaultModelName = mn
			display := strings.TrimSpace(m.Label)
			if display == "" {
				display = mn
			}
			defaultModelDisplayName = pn + " / " + display
		}
	}
	defaultModelID := strings.TrimSpace(defaultProviderID) + "/" + strings.TrimSpace(defaultModelName)

	out := &ModelsResponse{
		DefaultModel: defaultModelID,
	}
	if out.DefaultModel == "" {
		return nil, errors.New("invalid ai config: missing default model")
	}

	defaultLabel := strings.TrimSpace(defaultModelDisplayName)
	if defaultLabel == "" {
		defaultLabel = out.DefaultModel
	}

	seen := make(map[string]struct{})
	appendModel := func(id string, label string) {
		id = strings.TrimSpace(id)
		if id == "" {
			return
		}
		if _, ok := seen[id]; ok {
			return
		}
		seen[id] = struct{}{}
		label = strings.TrimSpace(label)
		if label == "" {
			label = id
		}
		out.Models = append(out.Models, Model{ID: id, Label: label})
	}

	appendModel(out.DefaultModel, defaultLabel)

	for _, p := range cfg.Providers {
		providerID := strings.TrimSpace(p.ID)
		if providerID == "" {
			continue
		}
		pn := strings.TrimSpace(providerNameByID[providerID])
		if pn == "" {
			pn = providerID
		}

		for _, m := range p.Models {
			modelName := strings.TrimSpace(m.ModelName)
			if modelName == "" {
				continue
			}
			id := providerID + "/" + modelName
			display := strings.TrimSpace(m.Label)
			if display == "" {
				display = modelName
			}
			label := pn + " / " + display
			appendModel(id, label)
		}
	}

	return out, nil
}

// NewRunID generates a cryptographically random run id.
func NewRunID() (string, error) {
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "run_" + base64.RawURLEncoding.EncodeToString(b), nil
}

func newMessageID() (string, error) {
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "m_ai_" + base64.RawURLEncoding.EncodeToString(b), nil
}

func newToolID() (string, error) {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "tool_" + base64.RawURLEncoding.EncodeToString(b), nil
}

type preparedRun struct {
	meta                 *session.Meta
	req                  RunStartRequest
	runID                string
	channelID            string
	endpointID           string
	threadID             string
	thKey                string
	threadModelID        string
	cfg                  *config.AIConfig
	uploadsDir           string
	persistTO            time.Duration
	db                   *threadstore.Store
	messageID            string
	r                    *run
	updateThreadRunState func(status string, runErr string)
}

func (s *Service) StartRun(ctx context.Context, meta *session.Meta, runID string, req RunStartRequest, w http.ResponseWriter) error {
	if ctx == nil {
		ctx = context.Background()
	}
	prepared, err := s.prepareRun(meta, runID, req, w)
	if err != nil {
		return err
	}
	return s.executePreparedRun(ctx, prepared)
}

func (s *Service) StartRunDetached(meta *session.Meta, runID string, req RunStartRequest) error {
	prepared, err := s.prepareRun(meta, runID, req, nil)
	if err != nil {
		return err
	}
	go func() {
		if err := s.executePreparedRun(context.Background(), prepared); err != nil {
			if s.log != nil {
				s.log.Warn("ai detached run failed", "run_id", runID, "thread_id", strings.TrimSpace(req.ThreadID), "error", err)
			}
		}
	}()
	return nil
}

func (s *Service) prepareRun(meta *session.Meta, runID string, req RunStartRequest, w http.ResponseWriter) (*preparedRun, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if meta == nil {
		return nil, errors.New("missing session metadata")
	}
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return nil, errors.New("missing run_id")
	}
	threadID := strings.TrimSpace(req.ThreadID)
	if threadID == "" {
		return nil, errors.New("missing thread_id")
	}
	channelID := strings.TrimSpace(meta.ChannelID)
	if channelID == "" {
		return nil, errors.New("missing channel_id")
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" {
		return nil, errors.New("missing endpoint_id")
	}

	metaCopy := *meta
	metaRef := &metaCopy

	persistTO := s.persistOpTO
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}

	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}

	pctx, cancelPersist := context.WithTimeout(context.Background(), persistTO)
	th, err := db.GetThread(pctx, endpointID, threadID)
	cancelPersist()
	if err != nil {
		return nil, err
	}
	if th == nil {
		return nil, errors.New("thread not found")
	}

	s.mu.Lock()
	if s.cfg == nil {
		s.mu.Unlock()
		return nil, ErrNotConfigured
	}
	if existing := strings.TrimSpace(s.activeRunByChan[channelID]); existing != "" {
		s.mu.Unlock()
		return nil, ErrRunActive
	}
	thKey := runThreadKey(endpointID, threadID)
	if thKey == "" {
		s.mu.Unlock()
		return nil, errors.New("invalid request")
	}
	if existing := strings.TrimSpace(s.activeRunByTh[thKey]); existing != "" {
		s.mu.Unlock()
		return nil, ErrThreadBusy
	}
	cfg := s.cfg
	uploadsDir := s.uploadsDir
	db = s.threadsDB
	messageID, err := newMessageID()
	if err != nil {
		s.mu.Unlock()
		return nil, err
	}
	r := newRun(runOptions{
		Log:                 s.log,
		StateDir:            s.stateDir,
		FSRoot:              s.fsRoot,
		Shell:               s.shell,
		AIConfig:            cfg,
		SessionMeta:         metaRef,
		ResolveProviderKey:  s.resolveProviderKey,
		RunID:               runID,
		ChannelID:           channelID,
		EndpointID:          endpointID,
		ThreadID:            threadID,
		SidecarScriptPath:   s.sidecarScriptPath,
		MaxWallTime:         s.runMaxWallTime,
		IdleTimeout:         s.runIdleTimeout,
		ToolApprovalTimeout: s.approvalTimeout,
		StreamWriteTimeout:  s.streamWriteTO,
		UserPublicID:        strings.TrimSpace(metaRef.UserPublicID),
		MessageID:           messageID,
		UploadsDir:          uploadsDir,
		OnStreamEvent: func(ev any) {
			s.broadcastStreamEvent(endpointID, threadID, runID, ev)
		},
		Writer: w,
	})
	s.activeRunByChan[channelID] = runID
	s.activeRunByTh[thKey] = runID
	s.runs[runID] = r
	s.mu.Unlock()

	updateThreadRunState := func(status string, runErr string) {
		if db == nil {
			return
		}
		status = strings.TrimSpace(status)
		if status == "" {
			status = "failed"
		}
		uctx, cancel := context.WithTimeout(context.Background(), persistTO)
		defer cancel()
		_ = db.UpdateThreadRunState(uctx, endpointID, threadID, status, runErr, metaRef.UserPublicID, metaRef.UserEmail)
	}

	updateThreadRunState("running", "")
	s.broadcastThreadState(endpointID, threadID, runID, "running", "")

	return &preparedRun{
		meta:                 metaRef,
		req:                  req,
		runID:                runID,
		channelID:            channelID,
		endpointID:           endpointID,
		threadID:             threadID,
		thKey:                thKey,
		threadModelID:        strings.TrimSpace(th.ModelID),
		cfg:                  cfg,
		uploadsDir:           uploadsDir,
		persistTO:            persistTO,
		db:                   db,
		messageID:            messageID,
		r:                    r,
		updateThreadRunState: updateThreadRunState,
	}, nil
}

func (s *Service) executePreparedRun(ctx context.Context, prepared *preparedRun) (retErr error) {
	if s == nil {
		return errors.New("nil service")
	}
	if prepared == nil || prepared.r == nil || prepared.meta == nil {
		return errors.New("invalid prepared run")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	r := prepared.r
	runID := strings.TrimSpace(prepared.runID)
	channelID := strings.TrimSpace(prepared.channelID)
	endpointID := strings.TrimSpace(prepared.endpointID)
	threadID := strings.TrimSpace(prepared.threadID)
	thKey := strings.TrimSpace(prepared.thKey)
	db := prepared.db
	persistTO := prepared.persistTO
	cfg := prepared.cfg
	meta := prepared.meta
	messageID := strings.TrimSpace(prepared.messageID)
	req := prepared.req

	// Always close the run stream to avoid goroutine leaks on early returns.
	// Also wait for the writer goroutine to finish so we never write to the ResponseWriter after handler return.
	defer func() {
		if r.stream != nil {
			r.stream.close()
			r.stream.wait()
		}
	}()

	streamEarlyError := func(err error) error {
		if err == nil {
			return nil
		}
		msg := strings.TrimSpace(err.Error())
		if msg == "" {
			msg = "AI failed."
		}
		r.sendStreamEvent(streamEventMessageStart{Type: "message-start", MessageID: messageID})
		r.sendStreamEvent(streamEventBlockStart{Type: "block-start", MessageID: messageID, BlockIndex: 0, BlockType: "markdown"})
		r.sendStreamEvent(streamEventBlockDelta{Type: "block-delta", MessageID: messageID, BlockIndex: 0, Delta: msg})
		r.sendStreamEvent(streamEventError{Type: "error", MessageID: messageID, Error: msg})
		r.setEndReason("error")
		return err
	}

	defer func() {
		s.mu.Lock()
		delete(s.runs, runID)
		delete(s.activeRunByChan, channelID)
		delete(s.activeRunByTh, thKey)
		s.mu.Unlock()
		if r.doneCh != nil {
			close(r.doneCh)
		}

		runStatus, runStatusErr := deriveThreadRunState(r.getEndReason(), retErr)
		if prepared.updateThreadRunState != nil {
			prepared.updateThreadRunState(runStatus, runStatusErr)
		}
		s.broadcastThreadState(endpointID, threadID, runID, runStatus, runStatusErr)
	}()

	pctx, cancelPersist := context.WithTimeout(context.Background(), persistTO)
	historyLite, err := db.ListHistoryLite(pctx, endpointID, threadID, 120)
	cancelPersist()
	if err != nil {
		return streamEarlyError(err)
	}
	history := make([]RunHistoryMsg, 0, len(historyLite))
	for _, m := range historyLite {
		role := strings.TrimSpace(m.Role)
		if role != "user" && role != "assistant" {
			continue
		}
		if strings.TrimSpace(m.Status) != "complete" {
			continue
		}
		text := strings.TrimSpace(m.TextContent)
		if text == "" {
			continue
		}
		history = append(history, RunHistoryMsg{Role: role, Text: text})
	}
	history = capHistoryByChars(history, 60_000)

	userMsgID, err := newUserMessageID()
	if err != nil {
		return streamEarlyError(err)
	}
	now := time.Now().UnixMilli()
	userJSON, userText, err := buildUserMessageJSON(userMsgID, req.Input, prepared.uploadsDir, now)
	if err != nil {
		return streamEarlyError(err)
	}
	pctx, cancelPersist = context.WithTimeout(context.Background(), persistTO)
	_, err = db.AppendMessage(pctx, endpointID, threadID, threadstore.Message{
		ThreadID:           threadID,
		EndpointID:         endpointID,
		MessageID:          userMsgID,
		Role:               "user",
		AuthorUserPublicID: strings.TrimSpace(meta.UserPublicID),
		AuthorUserEmail:    strings.TrimSpace(meta.UserEmail),
		Status:             "complete",
		CreatedAtUnixMs:    now,
		UpdatedAtUnixMs:    now,
		TextContent:        userText,
		MessageJSON:        userJSON,
	}, meta.UserPublicID, meta.UserEmail)
	cancelPersist()
	if err != nil {
		return streamEarlyError(err)
	}

	select {
	case <-ctx.Done():
		switch strings.TrimSpace(r.getCancelReason()) {
		case "canceled":
			r.finalizeNotice("canceled")
			r.setEndReason("canceled")
			r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: messageID})
			return nil
		case "timed_out":
			r.finalizeNotice("timed_out")
			r.setEndReason("timed_out")
			r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: messageID})
			return nil
		default:
			return ctx.Err()
		}
	default:
	}

	model := strings.TrimSpace(req.Model)
	if model == "" {
		model = strings.TrimSpace(prepared.threadModelID)
	}
	if model == "" {
		if id, ok := cfg.DefaultModelID(); ok {
			model = id
		}
	}
	if model == "" {
		return streamEarlyError(errors.New("missing model"))
	}
	if _, _, ok := strings.Cut(model, "/"); !ok {
		return streamEarlyError(errors.New("invalid model"))
	}
	if !cfg.IsAllowedModelID(model) {
		return streamEarlyError(fmt.Errorf("model not allowed: %s", model))
	}

	{
		pctx, cancel := context.WithTimeout(context.Background(), persistTO)
		_ = db.UpdateThreadModelID(pctx, endpointID, threadID, model)
		cancel()
	}

	runReq := RunRequest{
		Model:   model,
		History: history,
		Input:   req.Input,
		Options: req.Options,
	}
	runErr := r.run(ctx, runReq)
	if runErr != nil {
		handledCancel := false
		reason := strings.TrimSpace(r.getCancelReason())
		if errors.Is(runErr, context.Canceled) {
			switch reason {
			case "canceled":
				r.finalizeNotice("canceled")
				r.setEndReason("canceled")
				r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: messageID})
				handledCancel = true
			case "timed_out":
				r.finalizeNotice("timed_out")
				r.setEndReason("timed_out")
				r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: messageID})
				handledCancel = true
			}
		}
		if !handledCancel {
			return runErr
		}
	}

	assistantJSON, assistantText, assistantAt, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		return err
	}
	if strings.TrimSpace(assistantJSON) == "" {
		return errors.New("missing assistant message")
	}
	pctx, cancelPersist = context.WithTimeout(context.Background(), persistTO)
	_, err = db.AppendMessage(pctx, endpointID, threadID, threadstore.Message{
		ThreadID:        threadID,
		EndpointID:      endpointID,
		MessageID:       messageID,
		Role:            "assistant",
		Status:          "complete",
		CreatedAtUnixMs: assistantAt,
		UpdatedAtUnixMs: assistantAt,
		TextContent:     assistantText,
		MessageJSON:     assistantJSON,
	}, meta.UserPublicID, meta.UserEmail)
	cancelPersist()
	return err
}

func deriveThreadRunState(endReason string, runErr error) (string, string) {
	endReason = strings.TrimSpace(endReason)
	switch endReason {
	case "complete":
		if runErr == nil {
			return "success", ""
		}
		msg := strings.TrimSpace(runErr.Error())
		if msg == "" {
			msg = "AI failed."
		}
		return "failed", msg
	case "canceled":
		return "canceled", ""
	case "timed_out":
		return "failed", "Timed out."
	case "disconnected":
		return "failed", "Disconnected."
	case "error":
		if runErr != nil {
			msg := strings.TrimSpace(runErr.Error())
			if msg != "" {
				return "failed", msg
			}
		}
		return "failed", "AI failed."
	default:
		if runErr != nil {
			if errors.Is(runErr, context.Canceled) || errors.Is(runErr, context.DeadlineExceeded) {
				return "failed", "Disconnected."
			}
			msg := strings.TrimSpace(runErr.Error())
			if msg != "" {
				return "failed", msg
			}
		}
		return "failed", "AI run ended unexpectedly."
	}
}

func capHistoryByChars(in []RunHistoryMsg, maxChars int) []RunHistoryMsg {
	if maxChars <= 0 || len(in) == 0 {
		return in
	}

	// Keep the most recent messages under the cap (UI/UX first).
	total := 0
	for i := len(in) - 1; i >= 0; i-- {
		text := strings.TrimSpace(in[i].Text)
		n := len(text)
		if n == 0 {
			continue
		}
		if total+n > maxChars {
			return in[i+1:]
		}
		total += n
	}
	return in
}

func (s *Service) CancelRun(meta *session.Meta, runID string) error {
	if s == nil {
		return errors.New("nil service")
	}
	if meta == nil {
		return errors.New("missing session metadata")
	}
	runID = strings.TrimSpace(runID)
	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" || runID == "" {
		return errors.New("invalid request")
	}

	s.mu.Lock()
	r := s.runs[runID]
	s.mu.Unlock()
	// Cancel is best-effort and idempotent. Do not leak run existence cross-session.
	if r == nil || strings.TrimSpace(r.endpointID) != endpointID {
		return nil
	}
	r.requestCancel("canceled")
	return nil
}

func (s *Service) ApproveTool(meta *session.Meta, runID string, toolID string, approved bool) error {
	if s == nil {
		return errors.New("nil service")
	}
	if meta == nil {
		return errors.New("missing session metadata")
	}
	runID = strings.TrimSpace(runID)
	toolID = strings.TrimSpace(toolID)
	endpointID := strings.TrimSpace(meta.EndpointID)
	userID := strings.TrimSpace(meta.UserPublicID)
	if endpointID == "" || userID == "" || runID == "" || toolID == "" {
		return errors.New("invalid request")
	}

	s.mu.Lock()
	r := s.runs[runID]
	s.mu.Unlock()
	if r == nil || strings.TrimSpace(r.endpointID) != endpointID {
		return errors.New("run not found")
	}
	// Approvals are restricted to the run starter to avoid cross-user privilege confusion.
	if strings.TrimSpace(r.userPublicID) != userID {
		return errors.New("run not found")
	}
	if err := r.approveTool(toolID, approved); err != nil {
		return fmt.Errorf("approve tool: %w", err)
	}
	return nil
}
