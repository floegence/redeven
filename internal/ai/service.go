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

	ResolveSessionMeta func(channelID string) (*session.Meta, bool)

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

	sidecarScriptPath string
	runMaxWallTime    time.Duration
	runIdleTimeout    time.Duration
	approvalTimeout   time.Duration
	streamWriteTO     time.Duration

	resolveSessionMeta func(channelID string) (*session.Meta, bool)
	resolveProviderKey func(providerID string) (string, bool, error)

	mu              sync.Mutex
	activeRunByChan map[string]string // channel_id -> run_id
	activeRunByTh   map[string]string // <endpoint_id>:<thread_id> -> run_id
	runs            map[string]*run

	uploadsDir string
	threadsDB  *threadstore.Store
}

const (
	defaultRunMaxWallTime = 15 * time.Minute
	defaultRunIdleTimeout = 2 * time.Minute
	defaultToolApprovalTO = 10 * time.Minute
	defaultStreamWriteTO  = 5 * time.Second
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

	return &Service{
		log:                logger,
		stateDir:           strings.TrimSpace(opts.StateDir),
		fsRoot:             strings.TrimSpace(opts.FSRoot),
		shell:              strings.TrimSpace(opts.Shell),
		cfg:                opts.Config,
		sidecarScriptPath:  strings.TrimSpace(opts.SidecarScriptPath),
		runMaxWallTime:     maxWall,
		runIdleTimeout:     idleTO,
		approvalTimeout:    approvalTO,
		streamWriteTO:      streamWTO,
		resolveSessionMeta: opts.ResolveSessionMeta,
		resolveProviderKey: resolveProviderKey,
		activeRunByChan:    make(map[string]string),
		activeRunByTh:      make(map[string]string),
		runs:               make(map[string]*run),
		uploadsDir:         uploadsDir,
		threadsDB:          ts,
	}, nil
}

func (s *Service) Close() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	ts := s.threadsDB
	s.threadsDB = nil
	s.mu.Unlock()
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

	defaultProviderID := strings.TrimSpace(cfg.DefaultModel.ProviderID)
	defaultModelName := strings.TrimSpace(cfg.DefaultModel.ModelName)
	defaultModelID := strings.TrimSpace(defaultProviderID) + "/" + strings.TrimSpace(defaultModelName)

	out := &ModelsResponse{
		DefaultModel: defaultModelID,
	}
	if out.DefaultModel == "" {
		return nil, errors.New("invalid ai config: missing default_model")
	}

	if len(cfg.Models) == 0 {
		label := out.DefaultModel
		if pn := strings.TrimSpace(providerNameByID[defaultProviderID]); pn != "" {
			label = pn + " / " + defaultModelName
		}
		out.Models = []Model{{ID: out.DefaultModel, Label: label}}
		return out, nil
	}

	out.Models = make([]Model, 0, len(cfg.Models))
	for _, m := range cfg.Models {
		providerID := strings.TrimSpace(m.ProviderID)
		modelName := strings.TrimSpace(m.ModelName)
		if providerID == "" || modelName == "" {
			continue
		}
		id := providerID + "/" + modelName
		label := strings.TrimSpace(m.Label)
		if label == "" {
			if pn := strings.TrimSpace(providerNameByID[providerID]); pn != "" {
				label = pn + " / " + modelName
			} else {
				label = id
			}
		}
		out.Models = append(out.Models, Model{ID: id, Label: label})
	}
	if len(out.Models) == 0 {
		label := out.DefaultModel
		if pn := strings.TrimSpace(providerNameByID[defaultProviderID]); pn != "" {
			label = pn + " / " + defaultModelName
		}
		out.Models = []Model{{ID: out.DefaultModel, Label: label}}
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

func (s *Service) StartRun(ctx context.Context, meta *session.Meta, runID string, req RunStartRequest, w http.ResponseWriter) error {
	if s == nil {
		return errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if meta == nil {
		return errors.New("missing session metadata")
	}
	if strings.TrimSpace(runID) == "" {
		return errors.New("missing run_id")
	}
	channelID := strings.TrimSpace(meta.ChannelID)
	if channelID == "" {
		return errors.New("missing channel_id")
	}
	threadID := strings.TrimSpace(req.ThreadID)
	if threadID == "" {
		return errors.New("missing thread_id")
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" {
		return errors.New("missing endpoint_id")
	}

	// Persisting a thread and its messages should not depend on the request lifetime:
	// - the browser may disconnect early (e.g. Stop/refresh)
	// - we still want to keep the user message and thread metadata stable
	persistCtx, cancelPersist := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelPersist()

	// Ensure the thread exists before starting the run.
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}
	th, err := db.GetThread(persistCtx, endpointID, threadID)
	if err != nil {
		return err
	}
	if th == nil {
		return errors.New("thread not found")
	}

	// Ensure at most one active run per channel.
	s.mu.Lock()
	if s.cfg == nil {
		s.mu.Unlock()
		return ErrNotConfigured
	}
	if existing := s.activeRunByChan[channelID]; existing != "" {
		s.mu.Unlock()
		return ErrRunActive
	}
	thKey := runThreadKey(endpointID, threadID)
	if thKey == "" {
		s.mu.Unlock()
		return errors.New("invalid request")
	}
	if existing := s.activeRunByTh[thKey]; existing != "" {
		s.mu.Unlock()
		return ErrThreadBusy
	}
	cfg := s.cfg
	uploadsDir := s.uploadsDir
	db = s.threadsDB
	messageID, err := newMessageID()
	if err != nil {
		s.mu.Unlock()
		return err
	}
	r := newRun(runOptions{
		Log:                 s.log,
		StateDir:            s.stateDir,
		FSRoot:              s.fsRoot,
		Shell:               s.shell,
		AIConfig:            cfg,
		ResolveSessionMeta:  s.resolveSessionMeta,
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
		UserPublicID:        strings.TrimSpace(meta.UserPublicID),
		MessageID:           messageID,
		UploadsDir:          s.uploadsDir,
		Writer:              w,
	})
	s.activeRunByChan[channelID] = runID
	s.activeRunByTh[thKey] = runID
	s.runs[runID] = r
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		delete(s.runs, runID)
		delete(s.activeRunByChan, channelID)
		delete(s.activeRunByTh, thKey)
		s.mu.Unlock()
		if r != nil && r.doneCh != nil {
			close(r.doneCh)
		}
	}()

	// Build history snapshot from persisted messages (exclude the current input).
	historyLite, err := db.ListHistoryLite(persistCtx, endpointID, threadID, 120)
	if err != nil {
		return err
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

	// Persist the user message to the thread store before starting the run.
	userMsgID, err := newUserMessageID()
	if err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	userJSON, userText, err := buildUserMessageJSON(userMsgID, req.Input, uploadsDir, now)
	if err != nil {
		return err
	}
	_, err = db.AppendMessage(persistCtx, endpointID, threadID, threadstore.Message{
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
	if err != nil {
		return err
	}

	// If the client disconnected after we persisted the user message, abort before starting the sidecar run.
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	model := strings.TrimSpace(req.Model)
	if model == "" {
		model = strings.TrimSpace(cfg.DefaultModel.ProviderID) + "/" + strings.TrimSpace(cfg.DefaultModel.ModelName)
	}
	if model == "" {
		return errors.New("missing model")
	}

	runReq := RunRequest{
		Model:   model,
		History: history,
		Input:   req.Input,
		Options: req.Options,
	}
	if err := r.run(ctx, runReq); err != nil {
		return err
	}

	// Persist assistant message on successful completion only.
	assistantJSON, assistantText, assistantAt, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		return err
	}
	if strings.TrimSpace(assistantJSON) == "" {
		return errors.New("missing assistant message")
	}
	_, err = db.AppendMessage(persistCtx, endpointID, threadID, threadstore.Message{
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
	return err
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
