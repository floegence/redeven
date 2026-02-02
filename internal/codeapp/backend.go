package codeapp

import (
	"context"
	"crypto/rand"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/floegence/redeven-agent/internal/codeapp/gateway"
	"github.com/floegence/redeven-agent/internal/codeapp/registry"
)

func (s *Service) ListSpaces(ctx context.Context) ([]gateway.SpaceStatus, error) {
	if s == nil || s.reg == nil {
		return nil, errors.New("codeapp not ready")
	}
	spaces, err := s.reg.ListSpaces(ctx)
	if err != nil {
		return nil, err
	}

	out := make([]gateway.SpaceStatus, 0, len(spaces))
	for _, sp := range spaces {
		var running bool
		var pid int
		var port int
		if ins, ok := s.runner.Get(sp.CodeSpaceID); ok && ins != nil {
			running = true
			pid = ins.PID
			port = ins.Port
		}
		out = append(out, gateway.SpaceStatus{
			CodeSpaceID:        sp.CodeSpaceID,
			WorkspacePath:      sp.WorkspacePath,
			Name:               sp.Name,
			Description:        sp.Description,
			CodePort:           port,
			CreatedAtUnixMs:    sp.CreatedAtUnixMs,
			UpdatedAtUnixMs:    sp.UpdatedAtUnixMs,
			LastOpenedAtUnixMs: sp.LastOpenedAtUnixMs,
			Running:            running,
			PID:                pid,
		})
	}
	return out, nil
}

func (s *Service) CreateSpace(ctx context.Context, req gateway.CreateSpaceRequest) (*gateway.SpaceStatus, error) {
	if s == nil || s.reg == nil {
		return nil, errors.New("codeapp not ready")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	id := strings.TrimSpace(req.CodeSpaceID)
	if id == "" {
		id = randomCodeSpaceID()
	}
	if !IsValidCodeSpaceID(id) {
		return nil, errors.New("invalid code_space_id")
	}

	workspacePath := strings.TrimSpace(req.WorkspacePath)
	if workspacePath == "" {
		home, _ := os.UserHomeDir()
		workspacePath = strings.TrimSpace(home)
	}
	if workspacePath == "" {
		return nil, errors.New("missing workspace_path")
	}
	abs, err := filepath.Abs(workspacePath)
	if err != nil {
		return nil, err
	}
	if err := validateWorkspacePath(abs); err != nil {
		return nil, err
	}

	name, description, err := normalizeMeta(req.Name, req.Description)
	if err != nil {
		return nil, err
	}

	now := time.Now().UnixMilli()
	if err := s.reg.CreateSpace(ctx, registry.Space{
		CodeSpaceID:        id,
		WorkspacePath:      abs,
		Name:               name,
		Description:        description,
		CreatedAtUnixMs:    now,
		UpdatedAtUnixMs:    now,
		LastOpenedAtUnixMs: 0,
	}); err != nil {
		return nil, err
	}

	// Create the space root directory eagerly (better UX for debugging/inspection).
	spaceRoot := filepath.Join(s.stateDir, "apps", "code", "spaces", id)
	_ = os.MkdirAll(spaceRoot, 0o700)

	return &gateway.SpaceStatus{
		CodeSpaceID:        id,
		WorkspacePath:      abs,
		Name:               name,
		Description:        description,
		CodePort:           0,
		CreatedAtUnixMs:    now,
		UpdatedAtUnixMs:    now,
		LastOpenedAtUnixMs: 0,
		Running:            false,
		PID:                0,
	}, nil
}

func (s *Service) DeleteSpace(ctx context.Context, codeSpaceID string) error {
	if s == nil || s.reg == nil {
		return errors.New("codeapp not ready")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	id := strings.TrimSpace(codeSpaceID)
	if !IsValidCodeSpaceID(id) {
		return errors.New("invalid code_space_id")
	}

	_ = s.runner.Stop(id)
	if err := s.reg.DeleteSpace(ctx, id); err != nil {
		return err
	}

	spacesRoot := filepath.Join(s.stateDir, "apps", "code", "spaces")
	spaceDir := filepath.Join(spacesRoot, id)

	// Hard safety: ensure we only delete within <state_dir>/apps/code/spaces/.
	cleanRoot := filepath.Clean(spacesRoot)
	cleanDir := filepath.Clean(spaceDir)
	prefix := cleanRoot + string(os.PathSeparator)
	if !strings.HasPrefix(cleanDir, prefix) {
		return errors.New("refusing to delete outside spaces root")
	}
	return os.RemoveAll(cleanDir)
}

func (s *Service) StartSpace(ctx context.Context, codeSpaceID string) (*gateway.SpaceStatus, error) {
	if s == nil || s.reg == nil {
		return nil, errors.New("codeapp not ready")
	}
	id := strings.TrimSpace(codeSpaceID)
	if !IsValidCodeSpaceID(id) {
		return nil, errors.New("invalid code_space_id")
	}

	port, err := s.ResolveCodeServerPort(ctx, id)
	if err != nil {
		return nil, err
	}

	sp, err := s.reg.GetSpace(ctx, id)
	if err != nil {
		return nil, err
	}
	if sp == nil {
		return nil, errors.New("codespace not found")
	}
	ins, _ := s.runner.Get(id)

	// Touch only when explicitly started (user intent).
	_ = s.reg.TouchLastOpened(ctx, id)
	if updated, err := s.reg.GetSpace(ctx, id); err == nil && updated != nil {
		sp = updated
	}

	return &gateway.SpaceStatus{
		CodeSpaceID:        sp.CodeSpaceID,
		WorkspacePath:      sp.WorkspacePath,
		Name:               sp.Name,
		Description:        sp.Description,
		CodePort:           port,
		CreatedAtUnixMs:    sp.CreatedAtUnixMs,
		UpdatedAtUnixMs:    sp.UpdatedAtUnixMs,
		LastOpenedAtUnixMs: sp.LastOpenedAtUnixMs,
		Running:            ins != nil,
		PID: func() int {
			if ins != nil {
				return ins.PID
			}
			return 0
		}(),
	}, nil
}

func (s *Service) StopSpace(ctx context.Context, codeSpaceID string) error {
	if s == nil {
		return errors.New("codeapp not ready")
	}
	id := strings.TrimSpace(codeSpaceID)
	if !IsValidCodeSpaceID(id) {
		return errors.New("invalid code_space_id")
	}
	return s.runner.Stop(id)
}

func (s *Service) ResolveCodeServerPort(ctx context.Context, codeSpaceID string) (int, error) {
	if s == nil || s.reg == nil {
		return 0, errors.New("codeapp not ready")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	id := strings.TrimSpace(codeSpaceID)
	if !IsValidCodeSpaceID(id) {
		return 0, errors.New("invalid code_space_id")
	}

	sp, err := s.reg.GetSpace(ctx, id)
	if err != nil {
		return 0, err
	}
	if sp == nil {
		return 0, errors.New("codespace not found")
	}

	ins, err := s.runner.EnsureRunning(id, sp.WorkspacePath, 0)
	if err != nil {
		return 0, err
	}
	return ins.Port, nil
}

func (s *Service) UpdateSpace(ctx context.Context, codeSpaceID string, req gateway.UpdateSpaceRequest) (*gateway.SpaceStatus, error) {
	if s == nil || s.reg == nil {
		return nil, errors.New("codeapp not ready")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	id := strings.TrimSpace(codeSpaceID)
	if !IsValidCodeSpaceID(id) {
		return nil, errors.New("invalid code_space_id")
	}

	sp, err := s.reg.GetSpace(ctx, id)
	if err != nil {
		return nil, err
	}
	if sp == nil {
		return nil, errors.New("codespace not found")
	}

	name := sp.Name
	desc := sp.Description
	if req.Name != nil {
		name = strings.TrimSpace(*req.Name)
	}
	if req.Description != nil {
		desc = strings.TrimSpace(*req.Description)
	}

	name, desc, err = normalizeMeta(name, desc)
	if err != nil {
		return nil, err
	}

	if err := s.reg.UpdateMeta(ctx, id, name, desc); err != nil {
		return nil, err
	}

	// Re-fetch to include updated timestamps.
	sp, err = s.reg.GetSpace(ctx, id)
	if err != nil {
		return nil, err
	}
	if sp == nil {
		return nil, errors.New("codespace not found")
	}

	var running bool
	var pid int
	var port int
	if ins, ok := s.runner.Get(id); ok && ins != nil {
		running = true
		pid = ins.PID
		port = ins.Port
	}

	return &gateway.SpaceStatus{
		CodeSpaceID:        sp.CodeSpaceID,
		WorkspacePath:      sp.WorkspacePath,
		Name:               sp.Name,
		Description:        sp.Description,
		CodePort:           port,
		CreatedAtUnixMs:    sp.CreatedAtUnixMs,
		UpdatedAtUnixMs:    sp.UpdatedAtUnixMs,
		LastOpenedAtUnixMs: sp.LastOpenedAtUnixMs,
		Running:            running,
		PID:                pid,
	}, nil
}

func validateWorkspacePath(p string) error {
	fi, err := os.Stat(p)
	if err != nil {
		return err
	}
	if !fi.IsDir() {
		return errors.New("workspace_path is not a directory")
	}
	_, err = os.ReadDir(p)
	if err != nil {
		return err
	}
	return nil
}

func randomCodeSpaceID() string {
	// 12 chars base32-ish (lowercase alnum).
	//
	// Note: code_space_id must be a DNS-safe label, and the external sandbox host is:
	//   cs-<code_space_id>.<region>.<base>
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	out := make([]byte, 0, 12)
	for i := 0; i < 12; i++ {
		out = append(out, alphabet[int(b[i])%len(alphabet)])
	}
	return string(out)
}

func normalizeMeta(name string, description string) (string, string, error) {
	name = strings.TrimSpace(name)
	description = strings.TrimSpace(description)

	const maxName = 64
	const maxDesc = 256

	if utf8.RuneCountInString(name) > maxName {
		return "", "", errors.New("name is too long")
	}
	if utf8.RuneCountInString(description) > maxDesc {
		return "", "", errors.New("description is too long")
	}
	return name, description, nil
}
