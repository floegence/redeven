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

	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
)

var (
	ErrNotConfigured = errors.New("ai not configured")
	ErrRunActive     = errors.New("run already active")
)

type Options struct {
	Logger   *slog.Logger
	StateDir string

	FSRoot string
	Shell  string

	Config *config.AIConfig

	ResolveSessionMeta func(channelID string) (*session.Meta, bool)
}

type Service struct {
	log *slog.Logger

	stateDir string
	fsRoot   string
	shell    string

	cfg *config.AIConfig

	resolveSessionMeta func(channelID string) (*session.Meta, bool)

	mu              sync.Mutex
	activeRunByChan map[string]string // channel_id -> run_id
	runs            map[string]*run

	uploadsDir string
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

	return &Service{
		log:                logger,
		stateDir:           strings.TrimSpace(opts.StateDir),
		fsRoot:             strings.TrimSpace(opts.FSRoot),
		shell:              strings.TrimSpace(opts.Shell),
		cfg:                opts.Config,
		resolveSessionMeta: opts.ResolveSessionMeta,
		activeRunByChan:    make(map[string]string),
		runs:               make(map[string]*run),
		uploadsDir:         uploadsDir,
	}, nil
}

func (s *Service) Enabled() bool {
	return s != nil && s.cfg != nil
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

func (s *Service) ListModels() (*ModelsResponse, error) {
	if s == nil || s.cfg == nil {
		return nil, ErrNotConfigured
	}
	cfg := s.cfg

	out := &ModelsResponse{
		DefaultModel: strings.TrimSpace(cfg.DefaultModel),
	}
	if out.DefaultModel == "" {
		return nil, errors.New("invalid ai config: missing default_model")
	}

	if len(cfg.Models) == 0 {
		out.Models = []Model{{ID: out.DefaultModel, Label: out.DefaultModel}}
		return out, nil
	}

	out.Models = make([]Model, 0, len(cfg.Models))
	for _, m := range cfg.Models {
		id := strings.TrimSpace(m.ID)
		if id == "" {
			continue
		}
		label := strings.TrimSpace(m.Label)
		if label == "" {
			label = id
		}
		out.Models = append(out.Models, Model{ID: id, Label: label})
	}
	if len(out.Models) == 0 {
		out.Models = []Model{{ID: out.DefaultModel, Label: out.DefaultModel}}
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

func (s *Service) StartRun(ctx context.Context, channelID string, runID string, req RunRequest, w http.ResponseWriter) error {
	if s == nil {
		return errors.New("nil service")
	}
	if strings.TrimSpace(channelID) == "" {
		return errors.New("missing channel_id")
	}
	if strings.TrimSpace(runID) == "" {
		return errors.New("missing run_id")
	}
	if s.cfg == nil {
		return ErrNotConfigured
	}

	// Ensure at most one active run per channel.
	s.mu.Lock()
	if existing := s.activeRunByChan[channelID]; existing != "" {
		s.mu.Unlock()
		return ErrRunActive
	}
	messageID, err := newMessageID()
	if err != nil {
		s.mu.Unlock()
		return err
	}
	r := newRun(runOptions{
		Log:                s.log,
		StateDir:           s.stateDir,
		FSRoot:             s.fsRoot,
		Shell:              s.shell,
		AIConfig:           s.cfg,
		ResolveSessionMeta: s.resolveSessionMeta,
		RunID:              runID,
		ChannelID:          channelID,
		MessageID:          messageID,
		UploadsDir:         s.uploadsDir,
		Writer:             w,
	})
	s.activeRunByChan[channelID] = runID
	s.runs[runID] = r
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		delete(s.runs, runID)
		delete(s.activeRunByChan, channelID)
		s.mu.Unlock()
	}()

	return r.run(ctx, req)
}

func (s *Service) CancelRun(channelID string, runID string) error {
	if s == nil {
		return errors.New("nil service")
	}
	channelID = strings.TrimSpace(channelID)
	runID = strings.TrimSpace(runID)
	if channelID == "" || runID == "" {
		return errors.New("invalid request")
	}

	s.mu.Lock()
	r := s.runs[runID]
	s.mu.Unlock()
	if r == nil || r.channelID != channelID {
		return errors.New("run not found")
	}
	r.cancel()
	return nil
}

func (s *Service) ApproveTool(channelID string, runID string, toolID string, approved bool) error {
	if s == nil {
		return errors.New("nil service")
	}
	channelID = strings.TrimSpace(channelID)
	runID = strings.TrimSpace(runID)
	toolID = strings.TrimSpace(toolID)
	if channelID == "" || runID == "" || toolID == "" {
		return errors.New("invalid request")
	}

	s.mu.Lock()
	r := s.runs[runID]
	s.mu.Unlock()
	if r == nil || r.channelID != channelID {
		return errors.New("run not found")
	}
	if err := r.approveTool(toolID, approved); err != nil {
		return fmt.Errorf("approve tool: %w", err)
	}
	return nil
}
