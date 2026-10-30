package ai

import (
	"context"
	"errors"
	"strings"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/session"
)

func (s *Service) resolveToolMedia(ctx context.Context, ref string) ([]byte, error) {
	if computerFrameResourcePattern.MatchString(ref) {
		return s.ResolveTargetToolAttachment(ctx, ref)
	}
	if imageSnapshotResourcePattern.MatchString(ref) {
		return s.toolMedia.read(ctx, ref)
	}
	return nil, errors.New("invalid tool media reference")
}

// authorizeToolMediaThread reads only product ownership and canonical media
// membership. It avoids detail mapping, summaries and context decoration.
func (s *Service) authorizeToolMediaThread(ctx context.Context, meta *session.Meta, threadID string) (flruntime.ThreadView, error) {
	settings, err := s.threadSettingsForRead(ctx, meta, strings.TrimSpace(threadID))
	if err != nil {
		return flruntime.ThreadView{}, err
	}
	if settings == nil {
		return flruntime.ThreadView{}, errors.New("tool media thread is unavailable")
	}
	runtime, err := s.typedFloretRuntime()
	if err != nil {
		return flruntime.ThreadView{}, err
	}
	return runtime.View(ctx, identity.ThreadID(threadID))
}

func (s *Service) ResolveToolImageForThread(ctx context.Context, meta *session.Meta, threadID, ref string) ([]byte, string, error) {
	if !imageSnapshotResourcePattern.MatchString(ref) && !canonicalMediaLocatorPattern.MatchString(ref) {
		return nil, "", errors.New("invalid tool image reference")
	}
	locator, resource := "", ref
	if canonicalMediaLocatorPattern.MatchString(ref) {
		locator, resource = ref, ""
	}
	snapshot, err := s.readCanonicalThreadImage(ctx, meta, strings.TrimSpace(threadID), locator, resource)
	if err != nil {
		return nil, "", err
	}
	return snapshot.Body, snapshot.Attachment.MIMEType, nil
}
