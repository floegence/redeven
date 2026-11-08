package ai

import (
	"context"
	"errors"
	"strings"

	"github.com/floegence/floret/v7/identity"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/tessiven"
)

const tessivenSkillName = "redeven-tessiven"

func (s *Service) tessivenThreadCanvas(ctx context.Context, threadID string) (string, error) {
	if s.tessiven == nil {
		return "", nil
	}
	seen := map[string]bool{}
	for threadID != "" {
		if seen[threadID] {
			return "", errors.New("cyclic thread ownership")
		}
		seen[threadID] = true
		canvasID, err := s.tessiven.FlowerThreadCanvas(ctxOrBackground(ctx), threadID)
		if err != nil || canvasID != "" {
			return canvasID, err
		}
		settings, err := s.threadsDB.GetThreadSettingsByCanonicalThreadID(ctxOrBackground(ctx), threadID)
		if err != nil {
			return "", err
		}
		if settings == nil {
			return "", nil
		}
		threadID = settings.ParentThreadID
	}
	return "", nil
}

// Product ownership is admitted before settings publication, never inferred from
// message content, tool calls, titles, or the currently visible host surface.
func (s *Service) admitTessivenThread(ctx context.Context, threadID, canvasID string) error {
	existing, err := s.tessivenThreadCanvas(ctx, threadID)
	if err != nil {
		return err
	}
	if existing != "" && existing != canvasID {
		return threadstore.ErrCanonicalThreadSettingsConflict
	}
	if canvasID == "" || existing != "" {
		return nil
	}
	if s.tessiven == nil {
		return tessiven.ErrNotFound
	}
	if existing == "" {
		settings, err := s.threadsDB.GetThreadSettingsByCanonicalThreadID(ctx, threadID)
		if err != nil {
			return err
		}
		if settings != nil {
			return threadstore.ErrCanonicalThreadSettingsConflict
		}
	}
	return s.tessiven.BindFlowerThread(ctx, canvasID, threadID)
}

func (s *Service) ListTessivenThreads(ctx context.Context, meta *session.Meta, canvasID string) ([]ThreadView, error) {
	if err := requireRead(meta); err != nil {
		return nil, err
	}
	if s.tessiven == nil {
		return nil, tessiven.ErrNotFound
	}
	if _, err := s.tessiven.Canvas(ctx, canvasID); err != nil {
		return nil, err
	}
	ids, err := s.tessiven.FlowerThreadIDs(ctx, canvasID)
	if err != nil {
		return nil, err
	}
	out := []ThreadView{}
	for _, id := range ids {
		settings, err := s.threadsDB.GetThreadSettings(ctx, meta.EndpointID, id)
		if err != nil {
			return nil, err
		}
		if settings == nil || settings.NamespacePublicID != strings.TrimSpace(meta.NamespacePublicID) {
			continue
		}
		summary, err := threadSummaryFromRuntime(ctx, s.threadRuntime, identity.ThreadID(id))
		if err != nil {
			return nil, err
		}
		view, err := s.threadViewFromSummary(ctx, settings, summary)
		if err != nil {
			return nil, err
		}
		out = append(out, view)
	}
	return out, nil
}

func (s *Service) SelectTessivenThread(ctx context.Context, meta *session.Meta, canvasID, threadID string) error {
	if err := requireRWX(meta); err != nil {
		return err
	}
	settings, err := s.threadSettingsForRead(ctx, meta, threadID)
	if err != nil {
		return err
	}
	if settings == nil {
		return errReadPermissionDenied
	}
	owner, err := s.tessivenThreadCanvas(ctx, threadID)
	if err != nil {
		return err
	}
	if owner == "" || owner != canvasID {
		return tessiven.ErrConflict
	}
	return s.tessiven.BindFlowerThread(ctx, canvasID, threadID)
}

func (r *run) hasTessivenThread() bool { return r != nil && r.host.tessivenCanvasID != "" }

func (s *Service) validateTessivenCreate(ctx context.Context, req CreateThreadRequest) error {
	if req.TessivenCanvasID == "" {
		return nil
	}
	if s.tessiven == nil {
		return tessiven.ErrNotFound
	}
	if req.pluginDraftID != "" {
		return errors.New("a conversation cannot belong to two product surfaces")
	}
	canvas, err := s.tessiven.Canvas(ctx, req.TessivenCanvasID)
	if err != nil {
		return err
	}
	if canvas.Archived {
		return tessiven.ErrConflict
	}
	return nil
}
