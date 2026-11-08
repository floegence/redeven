package plugincreation

import (
	"context"
	"errors"
	"math"
	"strings"
	"sync"

	"github.com/floegence/redeven/internal/session"
)

// AuthorBackend is implemented by the product's ReDevPlugin adapter. The
// product stores opaque references, never a second copy of platform state.
type AuthorBackend interface {
	CreateWorkspace(context.Context, *session.Meta, string) (string, error)
	SourceScope(context.Context, *session.Meta, string) (SourceScope, error)
	RemoveWorkspace(context.Context, *session.Meta, string) error
	AuthorOperation(context.Context, *session.Meta, string, string, map[string]any) (any, error)
}
type Service struct {
	Store      *Store
	mu         sync.Mutex
	backend    AuthorBackend
	operations map[string]*draftOperationLock
}

func New(store *Store) *Service {
	return &Service{Store: store, operations: make(map[string]*draftOperationLock)}
}
func (s *Service) SetBackend(b AuthorBackend) { s.mu.Lock(); defer s.mu.Unlock(); s.backend = b }
func (s *Service) Backend() (AuthorBackend, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.backend == nil {
		return nil, errors.New("plugin authoring platform is unavailable")
	}
	return s.backend, nil
}

// LockDraft serializes admission, author mutations and deletion for one product
// draft. Durable state remains authoritative after process interruption.
type draftOperationLock struct {
	token chan struct{}
	refs  int
}

func (s *Service) LockDraft(ctx context.Context, meta *session.Meta, id string) (func(), error) {
	o, err := OwnerFromSession(meta)
	if err != nil {
		return nil, err
	}
	if _, err = s.Store.Get(ctx, o, id); err != nil {
		return nil, err
	}
	s.mu.Lock()
	lock := s.operations[id]
	if lock == nil {
		lock = &draftOperationLock{token: make(chan struct{}, 1)}
		lock.token <- struct{}{}
		s.operations[id] = lock
	}
	lock.refs++
	s.mu.Unlock()
	releaseRef := func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		lock.refs--
		if lock.refs == 0 {
			delete(s.operations, id)
		}
	}
	select {
	case <-ctx.Done():
		releaseRef()
		return nil, ctx.Err()
	case <-lock.token:
		var once sync.Once
		return func() { once.Do(func() { lock.token <- struct{}{}; releaseRef() }) }, nil
	}
}
func (s *Service) Create(ctx context.Context, meta *session.Meta, request string) (Draft, error) {
	if meta == nil || !meta.CanWrite || !meta.CanExecute {
		return Draft{}, ErrNotFound
	}
	o, err := OwnerFromSession(meta)
	if err != nil {
		return Draft{}, err
	}
	b, err := s.Backend()
	if err != nil {
		return Draft{}, err
	}
	d, err := s.Store.Create(ctx, o, request)
	if err != nil {
		return d, err
	}
	unlock, err := s.LockDraft(ctx, meta, d.ID)
	if err != nil {
		return d, err
	}
	defer unlock()
	d, err = s.Store.Get(ctx, o, d.ID)
	if err != nil || d.Lifecycle != "preparing" {
		return d, err
	}
	workspace, err := b.CreateWorkspace(ctx, meta, d.ID)
	if err != nil {
		return d, err
	}
	return s.Store.Activate(ctx, o, d.ID, workspace)
}

// SourceScope binds a host-selected private root and its one editable source.
// The platform validates the source identity; the host never derives paths from IDs.
type SourceScope struct {
	PrivateRoot string
	Directory   string
}

func (s *Service) SourceScope(ctx context.Context, meta *session.Meta, id string) (SourceScope, error) {
	o, err := OwnerFromSession(meta)
	if err != nil {
		return SourceScope{}, err
	}
	d, err := s.Store.Get(ctx, o, id)
	if err != nil {
		return SourceScope{}, err
	}
	// Deletion recovery may reopen a frozen canonical create before removing it.
	if d.Lifecycle != "active" && d.Lifecycle != "deleting" {
		return SourceScope{}, ErrDeleting
	}
	b, err := s.Backend()
	if err != nil {
		return SourceScope{}, err
	}
	return b.SourceScope(ctx, meta, d.WorkspaceID)
}

func (s *Service) ThreadSourceScope(ctx context.Context, meta *session.Meta, thread string) (SourceScope, bool, error) {
	d, owner, err := s.Store.ForAnyThread(ctx, thread)
	if errors.Is(err, ErrNotFound) {
		return SourceScope{}, false, nil
	}
	if err != nil {
		return SourceScope{}, false, err
	}
	expected, err := OwnerFromSession(meta)
	if err != nil || owner != expected {
		return SourceScope{}, false, ErrNotFound
	}
	if d.Lifecycle != "active" {
		return SourceScope{}, false, ErrDeleting
	}
	source, err := s.SourceScope(ctx, meta, d.ID)
	return source, true, err
}

// AuthorOperation resolves the workspace only from the exact dedicated thread.
// Model text, paths and draft IDs cannot select somebody else's project.
func (s *Service) AuthorOperation(ctx context.Context, meta *session.Meta, thread, operation string, args map[string]any) (any, error) {
	if meta == nil || !meta.CanRead || operation != "status" && (!meta.CanWrite || !meta.CanExecute) {
		return nil, ErrNotFound
	}
	o, err := OwnerFromSession(meta)
	if err != nil {
		return nil, err
	}
	d, err := s.Store.ForThread(ctx, o, thread)
	if err != nil {
		return nil, err
	}
	unlock, err := s.LockDraft(ctx, meta, d.ID)
	if err != nil {
		return nil, err
	}
	defer unlock()
	d, err = s.Store.Get(ctx, o, d.ID)
	if err != nil {
		return nil, err
	}
	if d.Lifecycle != "active" {
		return nil, ErrDeleting
	}
	if operation == "rename" {
		title, ok := args["title"].(string)
		revision, valid := args["revision"].(float64)
		if len(args) != 2 || !ok || strings.TrimSpace(title) == "" || !valid || revision < 1 || revision > 9007199254740991 || math.Trunc(revision) != revision {
			return nil, ErrInvalid
		}
		return s.Store.Rename(ctx, o, d.ID, int64(revision), title)
	}
	if operation == "initialize" {
		name, ok := args["display_name"].(string)
		if !ok || strings.TrimSpace(name) == "" || len([]rune(strings.TrimSpace(name))) > 120 {
			return nil, ErrInvalid
		}
	}
	b, err := s.Backend()
	if err != nil {
		return nil, err
	}
	// The platform serializes workspace mutations. Do not hold the product
	// admission lock across a command: deletion must be able to cancel the
	// canonical run before asking the platform to remove its workspace.
	unlock()
	result, err := b.AuthorOperation(ctx, meta, d.WorkspaceID, operation, args)
	if err != nil {
		return result, err
	}
	if operation == "initialize" && d.Title == "" {
		if name, ok := args["display_name"].(string); ok {
			_, err = s.Store.Rename(ctx, o, d.ID, d.Revision, name)
			// A simultaneous user rename wins; initialization already succeeded.
			if errors.Is(err, ErrConflict) {
				err = nil
			}
		}
	}
	return result, err
}
func (s *Service) ResumeDelete(ctx context.Context, meta *session.Meta, id string, deleteThread func(context.Context, string) error) (Draft, error) {
	if meta == nil || !meta.CanWrite || !meta.CanExecute {
		return Draft{}, ErrNotFound
	}
	o, err := OwnerFromSession(meta)
	if err != nil {
		return Draft{}, err
	}
	d, err := s.Store.Get(ctx, o, id)
	if err != nil {
		return d, err
	}
	if d.Lifecycle == "deleted" {
		return d, nil
	}
	if d.Lifecycle != "deleting" {
		return d, ErrConflict
	}
	if d.CleanupStage == "thread" {
		// An interrupted first admission with no durable binding must be reconciled
		// by its original request before destructive cleanup can start.
		if d.LaunchRequestID != "" && d.ThreadID == "" {
			return d, ErrConflict
		}
		if d.ThreadID != "" {
			if err = deleteThread(ctx, d.ThreadID); err != nil {
				return d, err
			}
		}
		d, err = s.Store.AdvanceDelete(ctx, o, id, "thread")
		if err != nil {
			return d, err
		}
	}
	if d.CleanupStage == "workspace" {
		b, e := s.Backend()
		if e != nil {
			return d, e
		}
		if d.WorkspaceID != "" {
			if err = b.RemoveWorkspace(ctx, meta, d.WorkspaceID); err != nil {
				return d, err
			}
		}
		return s.Store.AdvanceDelete(ctx, o, id, "workspace")
	}
	return d, nil
}

func (s *Service) ResumePreparation(ctx context.Context, meta *session.Meta, id string) (Draft, error) {
	if meta == nil || !meta.CanWrite || !meta.CanExecute {
		return Draft{}, ErrNotFound
	}
	owner, err := OwnerFromSession(meta)
	if err != nil {
		return Draft{}, err
	}
	unlock, err := s.LockDraft(ctx, meta, id)
	if err != nil {
		return Draft{}, err
	}
	defer unlock()
	draft, err := s.Store.Get(ctx, owner, id)
	if err != nil || draft.Lifecycle != "preparing" {
		return draft, err
	}
	b, err := s.Backend()
	if err != nil {
		return draft, err
	}
	workspace, err := b.CreateWorkspace(ctx, meta, draft.ID)
	if err != nil {
		return draft, err
	}
	return s.Store.Activate(ctx, owner, id, workspace)
}

// PresentDraft resolves unnamed legacy projects from verified platform artifacts.
// It never changes the durable draft or replaces a user-assigned project title.
func (s *Service) PresentDraft(ctx context.Context, meta *session.Meta, d Draft) Draft {
	if d.Title != "" || d.Lifecycle != "active" || d.WorkspaceID == "" {
		return d
	}
	backend, err := s.Backend()
	if err != nil {
		return d
	}
	if names, ok := backend.(interface {
		ProjectTitle(context.Context, *session.Meta, string) (string, error)
	}); ok {
		if title, err := names.ProjectTitle(ctx, meta, d.WorkspaceID); err == nil {
			d.Title = title
		}
	}
	return d
}
