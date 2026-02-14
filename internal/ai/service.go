package ai

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/floegence/flowersec/flowersec-go/rpc"
	contextadapter "github.com/floegence/redeven-agent/internal/ai/context/adapter"
	contextcompactor "github.com/floegence/redeven-agent/internal/ai/context/compactor"
	contextextractor "github.com/floegence/redeven-agent/internal/ai/context/extractor"
	contextmodel "github.com/floegence/redeven-agent/internal/ai/context/model"
	contextpacker "github.com/floegence/redeven-agent/internal/ai/context/packer"
	contextretriever "github.com/floegence/redeven-agent/internal/ai/context/retriever"
	contextstore "github.com/floegence/redeven-agent/internal/ai/context/store"
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

	// RunMaxWallTime is the hard cap for a single run's lifetime.
	//
	// When zero, it defaults to 15 minutes.
	RunMaxWallTime time.Duration
	// RunIdleTimeout cancels a run if no runtime stream activity is observed for the duration.
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

	// ResolveWebSearchProviderAPIKey returns the API key for the given web search provider id.
	//
	// It should read from a local secrets store, not from config.json.
	ResolveWebSearchProviderAPIKey func(providerID string) (string, bool, error)
}

type Service struct {
	log *slog.Logger

	stateDir string
	fsRoot   string
	shell    string

	cfg *config.AIConfig

	persistOpTO time.Duration

	runMaxWallTime  time.Duration
	runIdleTimeout  time.Duration
	approvalTimeout time.Duration
	streamWriteTO   time.Duration

	resolveProviderKey  func(providerID string) (string, bool, error)
	resolveWebSearchKey func(providerID string) (string, bool, error)

	mu              sync.Mutex
	activeRunByChan map[string]string // channel_id -> run_id
	activeRunByTh   map[string]string // <endpoint_id>:<thread_id> -> run_id
	runs            map[string]*run

	realtimeWriters       map[*rpc.Server]*aiSinkWriter
	realtimeByEndpoint    map[string]map[*rpc.Server]struct{}
	realtimeEndpointBySRV map[*rpc.Server]string

	uploadsDir string
	threadsDB  *threadstore.Store

	contextRepo        *contextstore.Repository
	contextRetriever   *contextretriever.Retriever
	contextPacker      *contextpacker.Builder
	memoryExtractor    *contextextractor.MemoryExtractor
	snapshotCompactor  *contextcompactor.SnapshotCompactor
	capabilityResolver *contextadapter.Resolver
}

type resolvedRunModel struct {
	ID         string
	ProviderID string
	ModelName  string
	Provider   config.AIProvider
	Capability contextmodel.ModelCapability
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
	resolveWebSearchKey := opts.ResolveWebSearchProviderAPIKey
	if resolveWebSearchKey == nil {
		resolveWebSearchKey = func(string) (string, bool, error) { return "", false, nil }
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

	contextRepo := contextstore.NewRepository(ts)
	snapshotCompactor := contextcompactor.New(contextRepo)
	contextRetriever := contextretriever.New(contextRepo)
	contextPacker := contextpacker.New(contextRepo, contextRetriever, snapshotCompactor)
	memoryExtractor := contextextractor.New(contextRepo)
	capabilityResolver := contextadapter.NewResolver(contextRepo)

	return &Service{
		log:                   logger,
		stateDir:              strings.TrimSpace(opts.StateDir),
		fsRoot:                strings.TrimSpace(opts.FSRoot),
		shell:                 strings.TrimSpace(opts.Shell),
		cfg:                   opts.Config,
		persistOpTO:           persistTO,
		runMaxWallTime:        maxWall,
		runIdleTimeout:        idleTO,
		approvalTimeout:       approvalTO,
		streamWriteTO:         streamWTO,
		resolveProviderKey:    resolveProviderKey,
		resolveWebSearchKey:   resolveWebSearchKey,
		activeRunByChan:       make(map[string]string),
		activeRunByTh:         make(map[string]string),
		runs:                  make(map[string]*run),
		realtimeWriters:       make(map[*rpc.Server]*aiSinkWriter),
		realtimeByEndpoint:    make(map[string]map[*rpc.Server]struct{}),
		realtimeEndpointBySRV: make(map[*rpc.Server]string),
		uploadsDir:            uploadsDir,
		threadsDB:             ts,
		contextRepo:           contextRepo,
		contextRetriever:      contextRetriever,
		contextPacker:         contextPacker,
		memoryExtractor:       memoryExtractor,
		snapshotCompactor:     snapshotCompactor,
		capabilityResolver:    capabilityResolver,
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
			switch strings.ToLower(strings.TrimSpace(p.Type)) {
			case "openai":
				name = "OpenAI"
			case "anthropic":
				name = "Anthropic"
			case "openai_compatible":
				baseURL := strings.TrimSpace(p.BaseURL)
				if baseURL != "" {
					if u, err := url.Parse(baseURL); err == nil && u != nil {
						if host := strings.TrimSpace(u.Host); host != "" {
							name = host
						}
					}
				}
				if name == "" {
					name = "OpenAI compatible"
				}
			}
		}
		if name == "" {
			// Best-effort fallback: avoid surfacing an unreadable provider id when possible.
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
			defaultModelDisplayName = pn + " / " + mn
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
			label := pn + " / " + modelName
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
	if err := requireRWX(meta); err != nil {
		return nil, err
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
		ResolveWebSearchKey: s.resolveWebSearchKey,
		RunID:               runID,
		ChannelID:           channelID,
		EndpointID:          endpointID,
		ThreadID:            threadID,
		MaxWallTime:         s.runMaxWallTime,
		IdleTimeout:         s.runIdleTimeout,
		ToolApprovalTimeout: s.approvalTimeout,
		StreamWriteTimeout:  s.streamWriteTO,
		UserPublicID:        strings.TrimSpace(metaRef.UserPublicID),
		MessageID:           messageID,
		UploadsDir:          uploadsDir,
		ThreadsDB:           db,
		PersistOpTimeout:    persistTO,
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
		if strings.TrimSpace(s.activeRunByChan[channelID]) == runID {
			delete(s.activeRunByChan, channelID)
		}
		if strings.TrimSpace(s.activeRunByTh[thKey]) == runID {
			delete(s.activeRunByTh, thKey)
		}
		s.mu.Unlock()
		r.markDone()

		if r.isDetached() {
			return
		}
		runStatus, runStatusErr := deriveThreadRunState(r.getEndReason(), r.getFinalizationReason(), retErr)
		if prepared.updateThreadRunState != nil {
			prepared.updateThreadRunState(runStatus, runStatusErr)
		}
		s.broadcastThreadState(endpointID, threadID, runID, runStatus, runStatusErr)
	}()

	pctx, cancelPersist := context.WithTimeout(context.Background(), persistTO)
	rawUserInputText := strings.TrimSpace(req.Input.Text)
	existingOpenGoal := ""
	if s.contextRepo != nil && s.contextRepo.Ready() {
		goal, goalErr := s.contextRepo.GetOpenGoal(pctx, endpointID, threadID)
		if goalErr != nil && r.log != nil {
			r.log.Warn("load open goal failed", "thread_id", threadID, "error", goalErr)
		}
		existingOpenGoal = strings.TrimSpace(goal)
	}
	cancelPersist()

	req.Options.Mode = normalizeRunMode(req.Options.Mode, cfg.EffectiveMode())
	resolvedModel, err := s.resolveRunModel(ctx, cfg, req.Model, prepared.threadModelID, r)
	if err != nil {
		return streamEarlyError(err)
	}
	model := resolvedModel.ID
	modelCapability := resolvedModel.Capability

	intentDecision := classifyRunIntent(rawUserInputText, req.Input.Attachments, existingOpenGoal, func() (intentDecision, error) {
		decision, classifyErr := s.classifyRunIntentByModel(ctx, resolvedModel, rawUserInputText, existingOpenGoal)
		if classifyErr != nil && r.log != nil {
			r.log.Warn("model intent classification failed",
				"thread_id", threadID,
				"run_id", runID,
				"model", model,
				"error", classifyErr,
			)
		}
		return decision, classifyErr
	})
	req.Options.Intent = intentDecision.Intent
	complexityDecision := classifyTaskComplexity(rawUserInputText, req.Input.Attachments, existingOpenGoal)
	if req.Options.Intent != RunIntentTask {
		complexityDecision.Level = TaskComplexitySimple
		complexityDecision.Reasons = []string{"non_task_intent"}
	}
	req.Options.Complexity = normalizeTaskComplexity(complexityDecision.Level)
	r.persistRunEvent("intent.classified", RealtimeStreamKindLifecycle, map[string]any{
		"intent":         intentDecision.Intent,
		"reason":         intentDecision.Reason,
		"source":         intentDecision.Source,
		"objective_mode": intentDecision.ObjectiveMode,
		"intent_source":  intentDecision.Source,
		"intent_reason":  intentDecision.Reason,
		"mode":           req.Options.Mode,
	})
	r.persistRunEvent("complexity.classified", RealtimeStreamKindLifecycle, map[string]any{
		"intent":     req.Options.Intent,
		"complexity": req.Options.Complexity,
		"reasons":    append([]string(nil), complexityDecision.Reasons...),
	})
	if intentDecision.Intent == RunIntentSocial {
		r.persistRunEvent("intent.routed", RealtimeStreamKindLifecycle, map[string]any{
			"path": "social_responder",
		})
	} else {
		r.persistRunEvent("intent.routed", RealtimeStreamKindLifecycle, map[string]any{
			"path": "task_engine",
		})
	}

	// open_goal is only updated by task intent explicit user input.
	// social intent keeps existing open_goal unchanged.
	openGoal := strings.TrimSpace(existingOpenGoal)
	if req.Options.Intent == RunIntentTask && rawUserInputText != "" {
		if existingOpenGoal != "" && strings.TrimSpace(intentDecision.ObjectiveMode) == RunObjectiveModeContinue {
			openGoal = strings.TrimSpace(existingOpenGoal)
		} else {
			openGoal = rawUserInputText
		}
	}
	effectiveInput := req.Input

	userMsgID := strings.TrimSpace(req.Input.MessageID)
	if userMsgID != "" {
		// Best-effort validation: keep ids short and URL-safe so the browser can reuse them
		// as stable DOM keys and DB uniqueness keys.
		if len(userMsgID) > 128 {
			userMsgID = ""
		}
		for i := 0; i < len(userMsgID); i++ {
			ch := userMsgID[i]
			if (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_' || ch == '-' {
				continue
			}
			userMsgID = ""
			break
		}
	}
	if userMsgID == "" {
		var genErr error
		userMsgID, genErr = newUserMessageID()
		if genErr != nil {
			return streamEarlyError(genErr)
		}
	}
	now := time.Now().UnixMilli()
	userJSON, userText, err := buildUserMessageJSON(userMsgID, req.Input, prepared.uploadsDir, now)
	if err != nil {
		return streamEarlyError(err)
	}
	pctx, cancelPersist = context.WithTimeout(context.Background(), persistTO)
	userRowID, err := db.AppendMessage(pctx, endpointID, threadID, threadstore.Message{
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
	s.broadcastTranscriptMessage(endpointID, threadID, runID, userRowID, userJSON, now)

	select {
	case <-ctx.Done():
		switch strings.TrimSpace(r.getCancelReason()) {
		case "canceled":
			r.setEndReason("canceled")
			r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: messageID})
			return nil
		case "timed_out":
			r.setEndReason("timed_out")
			r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: messageID})
			return nil
		default:
			return ctx.Err()
		}
	default:
	}

	{
		pctx, cancel := context.WithTimeout(context.Background(), persistTO)
		_ = db.UpdateThreadModelID(pctx, endpointID, threadID, model)
		cancel()
	}

	attachments := make([]contextmodel.AttachmentManifest, 0, len(req.Input.Attachments))
	for _, att := range req.Input.Attachments {
		attachments = append(attachments, contextmodel.AttachmentManifest{
			Name:     strings.TrimSpace(att.Name),
			MimeType: strings.TrimSpace(att.MimeType),
			URL:      strings.TrimSpace(att.URL),
		})
	}
	promptPack := contextmodel.PromptPack{
		ThreadID:                  threadID,
		RunID:                     runID,
		Objective:                 strings.TrimSpace(openGoal),
		AttachmentsManifest:       attachments,
		ContextSectionsTokenUsage: map[string]int{},
	}
	if s.contextPacker != nil {
		pack, packErr := s.contextPacker.BuildPromptPack(ctx, contextpacker.BuildInput{
			EndpointID:     endpointID,
			ThreadID:       threadID,
			RunID:          runID,
			Objective:      strings.TrimSpace(openGoal),
			UserInput:      rawUserInputText,
			Attachments:    attachments,
			Capability:     modelCapability,
			MaxInputTokens: req.Options.MaxInputTokens,
		})
		if packErr != nil {
			if r.log != nil {
				r.log.Warn("build prompt pack failed", "thread_id", threadID, "run_id", runID, "error", packErr)
			}
		} else {
			promptPack = pack
		}
	}
	historyForRun := promptPackToHistory(promptPack, rawUserInputText)

	runReq := RunRequest{
		Model:           model,
		Objective:       strings.TrimSpace(openGoal),
		History:         historyForRun,
		Input:           effectiveInput,
		Options:         req.Options,
		ContextPack:     promptPack,
		ModelCapability: modelCapability,
	}
	runErr := r.run(ctx, runReq)
	finalErr := runErr
	if runErr != nil {
		handledCancel := false
		reason := strings.TrimSpace(r.getCancelReason())
		if errors.Is(runErr, context.Canceled) {
			switch reason {
			case "canceled":
				r.setEndReason("canceled")
				r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: messageID})
				handledCancel = true
			case "timed_out":
				r.setEndReason("timed_out")
				r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: messageID})
				handledCancel = true
			}
		}
		if handledCancel {
			finalErr = nil
		}
	}

	// Hard-canceled runs are detached from the thread lifecycle to unblock UI actions.
	// Do not persist assistant messages after detachment, or we may race with subsequent runs on the same thread.
	if r.isDetached() {
		return finalErr
	}

	assistantJSON, assistantText, assistantAt, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		if finalErr != nil {
			return errors.Join(finalErr, err)
		}
		return err
	}
	if strings.TrimSpace(assistantJSON) == "" {
		err = errors.New("missing assistant message")
		if finalErr != nil {
			return errors.Join(finalErr, err)
		}
		return err
	}
	pctx, cancelPersist = context.WithTimeout(context.Background(), persistTO)
	assistantRowID, err := db.AppendMessage(pctx, endpointID, threadID, threadstore.Message{
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
	if err != nil {
		if finalErr != nil {
			return errors.Join(finalErr, err)
		}
		return err
	}
	s.broadcastTranscriptMessage(endpointID, threadID, runID, assistantRowID, assistantJSON, assistantAt)
	if s.contextRepo != nil {
		turnID := "turn_" + strings.TrimSpace(runID)
		turnCtx, cancelTurn := context.WithTimeout(context.Background(), persistTO)
		_ = s.contextRepo.AppendTurn(turnCtx, endpointID, threadID, runID, turnID, userMsgID, messageID, assistantAt)
		cancelTurn()
	}

	finalReason := strings.TrimSpace(r.getFinalizationReason())
	if s.contextRepo != nil {
		stateCtx, cancelState := context.WithTimeout(context.Background(), persistTO)
		if shouldClearThreadState(finalReason) {
			_ = s.contextRepo.SetOpenGoal(stateCtx, endpointID, threadID, "")
		} else if req.Options.Intent == RunIntentTask && strings.TrimSpace(openGoal) != "" {
			_ = s.contextRepo.SetOpenGoal(stateCtx, endpointID, threadID, openGoal)
		}
		cancelState()
	}
	if s.memoryExtractor != nil {
		extractCtx, cancelExtract := context.WithTimeout(context.Background(), persistTO)
		_, _ = s.memoryExtractor.Extract(extractCtx, contextextractor.ExtractInput{
			EndpointID:         endpointID,
			ThreadID:           threadID,
			RunID:              runID,
			Objective:          strings.TrimSpace(openGoal),
			AssistantText:      strings.TrimSpace(assistantText),
			FinalizationReason: finalReason,
		})
		cancelExtract()
	}
	if s.snapshotCompactor != nil && s.contextRepo != nil {
		compactCtx, cancelCompact := context.WithTimeout(context.Background(), persistTO)
		if turns, turnsErr := s.contextRepo.ListRecentDialogueTurns(compactCtx, endpointID, threadID, 24); turnsErr == nil {
			_, _ = s.snapshotCompactor.CompactThread(compactCtx, endpointID, threadID, turns, "turn")
		}
		cancelCompact()
	}

	return finalErr
}

func (s *Service) resolveRunModel(ctx context.Context, cfg *config.AIConfig, requestedModel string, threadModelID string, r *run) (resolvedRunModel, error) {
	model := strings.TrimSpace(requestedModel)
	if model == "" {
		model = strings.TrimSpace(threadModelID)
	}
	if model == "" {
		if id, ok := cfg.DefaultModelID(); ok {
			model = id
		}
	}
	if model == "" {
		return resolvedRunModel{}, errors.New("missing model")
	}
	providerID, modelName, ok := strings.Cut(model, "/")
	if !ok {
		return resolvedRunModel{}, errors.New("invalid model")
	}
	providerID = strings.TrimSpace(providerID)
	modelName = strings.TrimSpace(modelName)
	if providerID == "" || modelName == "" {
		return resolvedRunModel{}, errors.New("invalid model")
	}
	if !cfg.IsAllowedModelID(model) {
		return resolvedRunModel{}, fmt.Errorf("model not allowed: %s", model)
	}

	providerCfg := config.AIProvider{ID: providerID, Type: providerID}
	for i := range cfg.Providers {
		if strings.TrimSpace(cfg.Providers[i].ID) != providerID {
			continue
		}
		providerCfg = cfg.Providers[i]
		break
	}

	modelCapability := defaultModelCapability(providerID, modelName)
	if s.capabilityResolver != nil {
		if capability, capErr := s.capabilityResolver.Resolve(ctx, providerCfg, model); capErr == nil {
			modelCapability = capability
		} else if r != nil && r.log != nil {
			r.log.Warn("resolve model capability failed", "model", model, "error", capErr)
		}
	}

	return resolvedRunModel{
		ID:         model,
		ProviderID: providerID,
		ModelName:  modelName,
		Provider:   providerCfg,
		Capability: modelCapability,
	}, nil
}

func (s *Service) classifyRunIntentByModel(ctx context.Context, resolved resolvedRunModel, userInput string, openGoal string) (intentDecision, error) {
	if s == nil {
		return intentDecision{}, errors.New("nil service")
	}
	providerType := strings.ToLower(strings.TrimSpace(resolved.Provider.Type))
	switch providerType {
	case "openai", "openai_compatible", "anthropic":
	default:
		return intentDecision{}, fmt.Errorf("unsupported provider type %q", strings.TrimSpace(resolved.Provider.Type))
	}
	if s.resolveProviderKey == nil {
		return intentDecision{}, errors.New("missing provider key resolver")
	}
	apiKey, ok, err := s.resolveProviderKey(resolved.ProviderID)
	if err != nil {
		return intentDecision{}, fmt.Errorf("resolve provider key failed: %w", err)
	}
	if !ok || strings.TrimSpace(apiKey) == "" {
		return intentDecision{}, fmt.Errorf("missing api key for provider %q", resolved.ProviderID)
	}
	adapter, err := newProviderAdapter(providerType, strings.TrimSpace(resolved.Provider.BaseURL), strings.TrimSpace(apiKey))
	if err != nil {
		return intentDecision{}, fmt.Errorf("init provider adapter failed: %w", err)
	}

	intentCtx := ctx
	cancel := func() {}
	if _, hasDeadline := ctx.Deadline(); !hasDeadline {
		intentCtx, cancel = context.WithTimeout(ctx, 12*time.Second)
	}
	defer cancel()

	result, err := adapter.StreamTurn(intentCtx, TurnRequest{
		Model:            strings.TrimSpace(resolved.ModelName),
		Messages:         buildIntentClassifierMessages(userInput, openGoal),
		Budgets:          TurnBudgets{MaxSteps: 1, MaxOutputToken: 120},
		ModeFlags:        ModeFlags{Mode: config.AIModePlan},
		ProviderControls: ProviderControls{ResponseFormat: "json_object"},
	}, nil)
	if err != nil {
		return intentDecision{}, err
	}
	return parseModelIntentDecision(result.Text)
}

func shouldClearThreadState(finalReason string) bool {
	switch strings.TrimSpace(finalReason) {
	case "task_complete":
		return true
	default:
		return false
	}
}

func promptPackToHistory(pack contextmodel.PromptPack, currentUserInput string) []RunHistoryMsg {
	history := make([]RunHistoryMsg, 0, len(pack.RecentDialogue)*2+1)
	for _, turn := range pack.RecentDialogue {
		if txt := strings.TrimSpace(turn.UserText); txt != "" {
			history = append(history, RunHistoryMsg{Role: "user", Text: txt})
		}
		if txt := strings.TrimSpace(turn.AssistantText); txt != "" {
			history = append(history, RunHistoryMsg{Role: "assistant", Text: txt})
		}
	}
	if txt := strings.TrimSpace(currentUserInput); txt != "" {
		history = append(history, RunHistoryMsg{Role: "user", Text: txt})
	}
	return history
}

func defaultModelCapability(providerID string, modelName string) contextmodel.ModelCapability {
	providerID = strings.TrimSpace(providerID)
	modelName = strings.TrimSpace(modelName)
	cap := contextmodel.ModelCapability{
		ProviderID:               providerID,
		ModelName:                modelName,
		SupportsTools:            true,
		SupportsParallelTools:    false,
		SupportsStrictJSONSchema: true,
		SupportsImageInput:       true,
		SupportsFileInput:        true,
		SupportsReasoningTokens:  true,
		MaxContextTokens:         128000,
		MaxOutputTokens:          4096,
		PreferredToolSchemaMode:  "json_schema",
	}
	if strings.Contains(strings.ToLower(modelName), "mini") {
		cap.MaxContextTokens = 64000
		cap.MaxOutputTokens = 4096
	}
	return contextmodel.NormalizeCapability(cap)
}

func deriveThreadRunState(endReason string, finalizationReason string, runErr error) (string, string) {
	endReason = strings.TrimSpace(endReason)
	switch endReason {
	case "complete":
		switch classifyFinalizationReason(finalizationReason) {
		case finalizationClassSuccess:
			return "success", ""
		case finalizationClassWaitingUser:
			return "waiting_user", ""
		}
		msg := ""
		if runErr != nil {
			if errors.Is(runErr, context.DeadlineExceeded) {
				return "timed_out", "Timed out."
			}
			msg = strings.TrimSpace(runErr.Error())
		}
		if msg == "" {
			msg = "Run ended without explicit completion."
		}
		return "failed", msg
	case "canceled":
		return "canceled", ""
	case "timed_out":
		return "timed_out", "Timed out."
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
			if errors.Is(runErr, context.DeadlineExceeded) {
				return "timed_out", "Timed out."
			}
			if errors.Is(runErr, context.Canceled) {
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

func (s *Service) CancelRun(meta *session.Meta, runID string) error {
	if s == nil {
		return errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return err
	}
	runID = strings.TrimSpace(runID)
	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" || runID == "" {
		return errors.New("invalid request")
	}

	var r *run
	threadID := ""

	s.mu.Lock()
	r = s.runs[runID]
	// Cancel is best-effort and idempotent. Do not leak run existence cross-session.
	if r != nil && strings.TrimSpace(r.endpointID) != endpointID {
		s.mu.Unlock()
		return nil
	}
	if r != nil {
		threadID = strings.TrimSpace(r.threadID)
		r.markDetached()
	}
	// Detach any stale active mappings so the thread can be managed even if the run is stuck.
	for ch, rid := range s.activeRunByChan {
		if strings.TrimSpace(rid) != runID {
			continue
		}
		delete(s.activeRunByChan, ch)
	}
	for k, rid := range s.activeRunByTh {
		if strings.TrimSpace(rid) != runID {
			continue
		}
		delete(s.activeRunByTh, k)
		if threadID == "" && strings.HasPrefix(k, endpointID+":") {
			threadID = strings.TrimSpace(strings.TrimPrefix(k, endpointID+":"))
		}
	}
	db := s.threadsDB
	persistTO := s.persistOpTO
	s.mu.Unlock()

	if r != nil {
		r.requestCancel("canceled")
	}

	if db != nil && threadID != "" {
		uctx, cancel := context.WithTimeout(context.Background(), persistTO)
		_ = db.UpdateThreadRunState(uctx, endpointID, threadID, "canceled", "", meta.UserPublicID, meta.UserEmail)
		cancel()
		s.broadcastThreadState(endpointID, threadID, runID, "canceled", "")
	}
	return nil
}

func (s *Service) ApproveTool(meta *session.Meta, runID string, toolID string, approved bool) error {
	if s == nil {
		return errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return err
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
	if r == nil || strings.TrimSpace(r.endpointID) != endpointID || r.isDetached() {
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
