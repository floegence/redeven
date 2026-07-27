package gitruntime

import (
	"context"
	"errors"
	"sync"
)

// Session owns one explicit reference for every worktree resolved by a direct
// session. Close releases all references; repeated resolves are deduplicated.
type Session struct {
	runtime *Runtime
	mu      sync.Mutex
	closed  bool
	refs    map[string]*Admission
}

func (r *Runtime) NewSession() *Session {
	return &Session{runtime: r, refs: make(map[string]*Admission)}
}

func (s *Session) RetainRepository(ctx context.Context, id RepositoryIdentity) error {
	if s == nil || s.runtime == nil {
		return ErrResourceLimit
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return errors.New("git runtime session is closed")
	}
	if s.refs[id.WorktreeKey] != nil {
		return nil
	}
	ref, err := s.runtime.RetainRepository(ctx, id)
	if err != nil {
		return err
	}
	s.refs[id.WorktreeKey] = ref
	return nil
}

func (s *Session) Close() {
	if s == nil {
		return
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	refs := s.refs
	s.refs = nil
	s.mu.Unlock()
	for _, ref := range refs {
		ref.Release()
	}
}
