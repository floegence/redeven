package ai

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var errToolMediaExecutionActive = errors.New("tool media execution is active")
var errToolMediaMaintenanceBusy = errors.New("tool media maintenance yielded to a writer")

func (s *Service) sweepToolMedia(ctx context.Context, executionDeferred bool) (int, error) {
	if s == nil || s.floretMediaInventory == nil {
		return 0, nil
	}
	return s.toolMedia.sweepUnreferenced(ctx, func(ctx context.Context) ([]string, error) {
		inventory, err := s.floretMediaInventory(ctx)
		if err != nil {
			return nil, err
		}
		if !executionDeferred && !inventory.Idle {
			return nil, errToolMediaExecutionActive
		}
		refs := make([]string, 0, len(inventory.References))
		for _, reference := range inventory.References {
			if isToolMediaRef(reference.Attachment.ResourceRef) {
				refs = append(refs, reference.Attachment.ResourceRef)
			}
		}
		return refs, nil
	})
}

func (s *Service) maintainToolMedia(ctx context.Context, reason string, executionDeferred bool) {
	if s == nil || s.floretMediaInventory == nil {
		return
	}
	ctx, cancel := context.WithTimeout(ctxOrBackground(ctx), 30*time.Second)
	defer cancel()
	removed, err := s.sweepToolMedia(ctx, executionDeferred)
	if err != nil && !errors.Is(err, errToolMediaExecutionActive) && !errors.Is(err, errToolMediaMaintenanceBusy) && !errors.Is(err, context.Canceled) && s.log != nil {
		s.log.Warn("ai: tool media retention failed", "reason", reason, "error", err)
	} else if removed > 0 && s.log != nil {
		s.log.Info("ai: tool media retention reclaimed snapshots", "reason", reason, "count", removed)
	}
}

// sweepUnreferenced serializes new snapshots with one complete canonical
// retention snapshot. The caller must establish that execution is inactive;
// current-view or active-path inventories are never sufficient for deletion.
func (store toolMediaStore) sweepUnreferenced(ctx context.Context, retained func(context.Context) ([]string, error)) (int, error) {
	if store.writes == nil || retained == nil {
		return 0, errors.New("tool media retention authority is unavailable")
	}
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	scan, release, acquired := store.writes.collect(ctx)
	if !acquired {
		return 0, errToolMediaMaintenanceBusy
	}
	defer release()
	ctx = scan
	references, err := retained(ctx)
	if err != nil {
		return 0, err
	}
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	keep := make(map[string]struct{}, len(references))
	for _, ref := range references {
		if err := ctx.Err(); err != nil {
			return 0, err
		}
		if !isToolMediaRef(ref) {
			continue
		}
		path, err := store.path(ref)
		if err != nil {
			return 0, err
		}
		keep[path] = struct{}{}
	}
	removed := 0
	err = filepath.WalkDir(store.directory, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			if errors.Is(walkErr, os.ErrNotExist) && path == store.directory {
				return nil
			}
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		relative, err := filepath.Rel(store.directory, path)
		if err != nil {
			return err
		}
		parts := strings.Split(filepath.ToSlash(relative), "/")
		if len(parts) != 2 {
			return nil
		}
		candidate := false
		if parts[0] == "images" {
			dot := strings.LastIndexByte(parts[1], '.')
			if dot > 0 {
				candidate = imageSnapshotResourcePattern.MatchString("image://" + parts[1][:dot] + "/" + parts[1][dot+1:])
			}
		}
		if !candidate && strings.HasSuffix(parts[1], ".png") {
			candidate = computerFrameResourcePattern.MatchString("computer://" + parts[0] + "/" + strings.TrimSuffix(parts[1], ".png"))
		}
		if !candidate {
			return nil
		}
		if _, owned := keep[path]; owned {
			return nil
		}
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		removed++
		return nil
	})
	return removed, err
}
