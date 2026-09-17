package ai

import (
	"context"
	"errors"
	"sort"
	"strings"

	"github.com/floegence/redeven/internal/session"
)

// Discovery describes local resources. Only the Runtime registers their
// opaque identities; a model cannot construct a window or tab binding.
func (r *ComputerUseRuntime) ListComputerTargets(ctx context.Context) ([]TargetDescriptor, error) {
	r.connectMu.Lock()
	defer r.connectMu.Unlock()
	r.mu.RLock()
	native, _ := r.executors["desktop-main"].(*NativeDesktopTargetExecutor)
	closed := r.closed
	r.mu.RUnlock()
	if closed {
		return nil, errors.New("computer runtime is closed")
	}
	if native != nil {
		windows, err := native.ListTargets(ctx)
		if err != nil {
			// A native setup failure must remain visible without hiding independent
			// browser connections. Never reuse stale window identities.
			r.mu.Lock()
			for id, executor := range r.executors {
				if executor == native && strings.HasPrefix(id, "macos-window-") {
					delete(r.executors, id)
					r.registry.remove(id)
				}
			}
			r.mu.Unlock()
			result := r.registry.Snapshot()
			state := "setup_required"
			var startup *TargetStartupError
			if errors.As(err, &startup) && startup.Code == "TARGET_PERMISSION_REQUIRED" {
				state = "permission_required"
			}
			return append(result, TargetDescriptor{ID: "desktop-main", Kind: "desktop.screen", DisplayName: "macOS Desktop", Locality: "local", State: state, Ready: false}), nil
		}
		live := make(map[string]bool, len(windows))
		r.mu.Lock()
		for _, target := range windows {
			if err := r.registry.Register(target); err != nil {
				r.mu.Unlock()
				return nil, err
			}
			r.executors[target.ID] = native
			live[target.ID] = true
		}
		for id, executor := range r.executors {
			if executor == native && strings.HasPrefix(id, "macos-window-") && !live[id] {
				delete(r.executors, id)
				r.registry.remove(id)
			}
		}
		r.mu.Unlock()
	}
	result := r.registry.Snapshot()
	sort.Slice(result, func(i, j int) bool { return result[i].DisplayName < result[j].DisplayName })
	return result, nil
}

func (s *Service) ListComputerTargets(ctx context.Context, meta *session.Meta) ([]TargetDescriptor, error) {
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	host, ok := s.targetToolExecutor.(*ComputerUseRuntime)
	if !ok {
		return nil, errors.New("computer runtime is unavailable")
	}
	return host.ListComputerTargets(ctx)
}

func (s *Service) SelectComputerTarget(ctx context.Context, meta *session.Meta, threadID, targetID string) error {
	if err := requireRWX(meta); err != nil {
		return err
	}
	if err := s.requireEndpointThreadAuthority(ctx, meta.EndpointID, threadID); err != nil {
		return err
	}
	host, ok := s.targetToolExecutor.(*ComputerUseRuntime)
	if !ok {
		return errors.New("computer runtime is unavailable")
	}
	target, err := host.ResolveTarget(ctx, targetID)
	if err != nil || target.ID != targetID {
		return errors.New("select an available computer target")
	}
	if !targetAllowedByPolicy(s.ToolTargetPolicy(), target.ID) {
		return computerTargetFailure(TargetToolCall{ThreadID: threadID, TargetID: target.ID}, "TARGET_NOT_ALLOWED")
	}
	_, err = host.selectComputerTarget(ctx, TargetToolCall{ThreadID: threadID, ToolName: "computer.select_target"}, target)
	return err
}

func (s *Service) ComputerTarget(ctx context.Context, meta *session.Meta, threadID string) (string, error) {
	if meta == nil || !meta.CanRead {
		return "", errors.New("computer access denied")
	}
	if err := s.requireEndpointThreadAuthority(ctx, meta.EndpointID, threadID); err != nil {
		return "", err
	}
	return s.snapshotThreadStore().GetComputerTarget(ctx, threadID)
}

func (s *Service) ComputerCandidates(ctx context.Context, meta *session.Meta, threadID string) (ComputerTargetInventory, error) {
	if err := requireRWX(meta); err != nil {
		return ComputerTargetInventory{}, err
	}
	if err := s.requireEndpointThreadAuthority(ctx, meta.EndpointID, threadID); err != nil {
		return ComputerTargetInventory{}, err
	}
	host, ok := s.targetToolExecutor.(*ComputerUseRuntime)
	if !ok {
		return ComputerTargetInventory{}, errors.New("computer runtime is unavailable")
	}
	return host.ComputerTargets(ctx, TargetToolCall{ThreadID: threadID, ToolName: "computer.targets"}, s.ToolTargetPolicy())
}

func (s *Service) SelectComputerCandidate(ctx context.Context, meta *session.Meta, threadID, ref string) (TargetDescriptor, error) {
	if err := requireRWX(meta); err != nil {
		return TargetDescriptor{}, err
	}
	if err := s.requireEndpointThreadAuthority(ctx, meta.EndpointID, threadID); err != nil {
		return TargetDescriptor{}, err
	}
	host, ok := s.targetToolExecutor.(*ComputerUseRuntime)
	if !ok {
		return TargetDescriptor{}, errors.New("computer runtime is unavailable")
	}
	return host.SelectComputerCandidate(ctx, TargetToolCall{ThreadID: threadID, ToolName: "computer.select_target"}, ref, s.ToolTargetPolicy())
}
