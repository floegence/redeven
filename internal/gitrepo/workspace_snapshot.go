package gitrepo

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/floegence/redeven/internal/gitruntime"
)

const (
	workspaceSnapshotTTL              = 30 * time.Second
	workspaceSnapshotMaxEntries       = 16
	workspaceSnapshotMaxPerWorktree   = 4
	workspaceSnapshotMaxRetainedBytes = 32 << 20
	workspaceSnapshotMaxBytes         = 8 << 20
)

var (
	errWorkspaceSnapshotStale      = errors.New("workspace snapshot is stale")
	errWorkspaceInventoryLimit     = errors.New("workspace inventory limit exceeded")
	errWorkspacePathEncoding       = errors.New("workspace path is not valid UTF-8")
	errWorkspacePaginationRequired = errors.New("workspace pagination is required")
	errWorkspaceResponseBudget     = errors.New("workspace response exceeds resource budget")
)

type immutableWorkspaceSnapshot struct {
	identity      string
	revision      string
	status        workspaceStatusSnapshot
	retainedBytes int64
	epoch         atomic.Uint64
	expiresAt     time.Time
	lastAccess    time.Time
	pins          int
	budget        *gitruntime.Admission
	repositoryRef *gitruntime.Admission
}

type workspaceSnapshotStore struct {
	mu            sync.Mutex
	entries       map[string]*immutableWorkspaceSnapshot
	byWorktree    map[string][]string
	retainedBytes int64
	now           func() time.Time
	closed        bool
	stop          chan struct{}
	done          chan struct{}
	closeOnce     sync.Once
}

type workspaceCaptureCall struct {
	done     chan struct{}
	revision string
	err      error
}

func newWorkspaceSnapshotStore() *workspaceSnapshotStore {
	store := &workspaceSnapshotStore{
		entries:    make(map[string]*immutableWorkspaceSnapshot),
		byWorktree: make(map[string][]string),
		now:        time.Now,
		stop:       make(chan struct{}),
		done:       make(chan struct{}),
	}
	go store.sweepExpired()
	return store
}

func (s *workspaceSnapshotStore) sweepExpired() {
	ticker := time.NewTicker(workspaceSnapshotTTL / 2)
	defer ticker.Stop()
	defer close(s.done)
	for {
		select {
		case <-ticker.C:
			s.mu.Lock()
			s.evictExpiredLocked(s.now())
			s.mu.Unlock()
		case <-s.stop:
			return
		}
	}
}

func (s *workspaceSnapshotStore) publish(snapshot *immutableWorkspaceSnapshot) error {
	if s == nil || snapshot == nil {
		releaseWorkspaceSnapshotResources(snapshot)
		return errWorkspaceInventoryLimit
	}
	if snapshot.retainedBytes <= 0 || snapshot.retainedBytes > workspaceSnapshotMaxBytes {
		releaseWorkspaceSnapshotResources(snapshot)
		return errWorkspaceInventoryLimit
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		releaseWorkspaceSnapshotResources(snapshot)
		return errWorkspaceInventoryLimit
	}
	now := s.now()
	s.evictExpiredLocked(now)
	key := workspaceSnapshotKey(snapshot.identity, snapshot.revision)
	if existing := s.entries[key]; existing != nil {
		existing.expiresAt = now.Add(workspaceSnapshotTTL)
		existing.lastAccess = now
		existing.epoch.Store(snapshot.epoch.Load())
		releaseWorkspaceSnapshotResources(snapshot)
		return nil
	}
	for s.needsEvictionLocked(snapshot.identity, snapshot.retainedBytes) {
		if !s.evictOneLocked(snapshot.identity) && !s.evictOneLocked("") {
			releaseWorkspaceSnapshotResources(snapshot)
			return errWorkspaceInventoryLimit
		}
	}
	snapshot.expiresAt = now.Add(workspaceSnapshotTTL)
	snapshot.lastAccess = now
	s.entries[key] = snapshot
	s.byWorktree[snapshot.identity] = append(s.byWorktree[snapshot.identity], key)
	s.retainedBytes += snapshot.retainedBytes
	return nil
}

func (s *workspaceSnapshotStore) close() {
	if s == nil {
		return
	}
	s.closeOnce.Do(func() {
		s.mu.Lock()
		s.closed = true
		s.mu.Unlock()
		close(s.stop)
		<-s.done
	})
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, entry := range s.entries {
		if entry.pins == 0 {
			s.removeLocked(key, entry)
		}
	}
}

func (s *workspaceSnapshotStore) pin(identity string, revision string) (*immutableWorkspaceSnapshot, func(), error) {
	if s == nil || revision == "" {
		return nil, nil, errWorkspaceSnapshotStale
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil, nil, errWorkspaceSnapshotStale
	}
	now := s.now()
	s.evictExpiredLocked(now)
	entry := s.entries[workspaceSnapshotKey(identity, revision)]
	if entry == nil || entry.identity != identity {
		s.mu.Unlock()
		return nil, nil, errWorkspaceSnapshotStale
	}
	entry.pins++
	entry.lastAccess = now
	entry.expiresAt = now.Add(workspaceSnapshotTTL)
	s.mu.Unlock()
	var once sync.Once
	return entry, func() {
		once.Do(func() {
			s.mu.Lock()
			if entry.pins > 0 {
				entry.pins--
			}
			if entry.pins == 0 && s.closed && s.entries[workspaceSnapshotKey(identity, revision)] == entry {
				s.removeLocked(workspaceSnapshotKey(identity, revision), entry)
			}
			s.mu.Unlock()
		})
	}, nil
}

func (s *workspaceSnapshotStore) invalidate(identity string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, key := range append([]string(nil), s.byWorktree[identity]...) {
		if entry := s.entries[key]; entry != nil && entry.pins == 0 {
			s.removeLocked(key, entry)
		}
	}
}

func (s *workspaceSnapshotStore) needsEvictionLocked(identity string, additional int64) bool {
	return len(s.entries) >= workspaceSnapshotMaxEntries ||
		len(s.byWorktree[identity]) >= workspaceSnapshotMaxPerWorktree ||
		s.retainedBytes+additional > workspaceSnapshotMaxRetainedBytes
}

func (s *workspaceSnapshotStore) evictExpiredLocked(now time.Time) {
	for key, entry := range s.entries {
		if entry.pins == 0 && !now.Before(entry.expiresAt) {
			s.removeLocked(key, entry)
		}
	}
}

func (s *workspaceSnapshotStore) evictOneLocked(identity string) bool {
	var candidateKey string
	var candidate *immutableWorkspaceSnapshot
	for key, entry := range s.entries {
		if entry.pins != 0 || (identity != "" && entry.identity != identity) {
			continue
		}
		if candidate == nil || entry.lastAccess.Before(candidate.lastAccess) {
			candidateKey, candidate = key, entry
		}
	}
	if candidate == nil {
		return false
	}
	s.removeLocked(candidateKey, candidate)
	return true
}

func (s *workspaceSnapshotStore) removeLocked(key string, entry *immutableWorkspaceSnapshot) {
	delete(s.entries, key)
	s.retainedBytes -= entry.retainedBytes
	keys := s.byWorktree[entry.identity]
	for i := range keys {
		if keys[i] == key {
			keys = append(keys[:i], keys[i+1:]...)
			break
		}
	}
	if len(keys) == 0 {
		delete(s.byWorktree, entry.identity)
	} else {
		s.byWorktree[entry.identity] = keys
	}
	releaseWorkspaceSnapshotResources(entry)
}

func releaseWorkspaceSnapshotResources(snapshot *immutableWorkspaceSnapshot) {
	if snapshot == nil {
		return
	}
	if snapshot.budget != nil {
		snapshot.budget.Release()
		snapshot.budget = nil
	}
	if snapshot.repositoryRef != nil {
		snapshot.repositoryRef.Release()
		snapshot.repositoryRef = nil
	}
}

func workspaceSnapshotKey(identity string, revision string) string {
	return identity + "\x00" + revision
}

func (s *Service) captureWorkspaceSnapshot(ctx context.Context, repoRoot string) (*immutableWorkspaceSnapshot, func(), error) {
	identity, ok, err := s.runtime.ResolveRepositoryIdentity(ctx, repoRoot)
	if err != nil {
		return nil, nil, err
	}
	if !ok {
		return nil, nil, errors.New("not a git repository")
	}
	epoch, leaseAlreadyHeld := repoReadEpochFromContext(ctx, identity)
	releaseLease := func() {}
	if !leaseAlreadyHeld {
		lease, acquireErr := s.runtime.AcquireRead(ctx, identity)
		if acquireErr != nil {
			return nil, nil, acquireErr
		}
		epoch = lease.Epoch()
		releaseLease = lease.Release
	}
	flightKey := fmt.Sprintf("%s\x00%d", identity.WorktreeKey, epoch)
	s.captureMu.Lock()
	if existing := s.captures[flightKey]; existing != nil {
		s.captureMu.Unlock()
		select {
		case <-ctx.Done():
			releaseLease()
			return nil, nil, ctx.Err()
		case <-existing.done:
			releaseLease()
			if existing.err != nil {
				return nil, nil, existing.err
			}
			return s.workspaceStore.pin(identity.WorktreeKey, existing.revision)
		}
	}
	call := &workspaceCaptureCall{done: make(chan struct{})}
	s.captures[flightKey] = call
	s.captureMu.Unlock()

	finish := func(revision string, captureErr error) {
		s.captureMu.Lock()
		call.revision = revision
		call.err = captureErr
		delete(s.captures, flightKey)
		close(call.done)
		s.captureMu.Unlock()
	}
	admission, err := s.runtime.AcquireCapture(ctx)
	if err != nil {
		releaseLease()
		finish("", err)
		return nil, nil, err
	}
	defer admission.Release()
	status, err := s.readWorkspaceStatus(ctx, repoRoot)
	if err != nil {
		releaseLease()
		finish("", err)
		return nil, nil, err
	}
	retained := estimateWorkspaceSnapshotBytes(status)
	if retained > workspaceSnapshotMaxBytes {
		releaseLease()
		finish("", errWorkspaceInventoryLimit)
		return nil, nil, errWorkspaceInventoryLimit
	}
	revision := workspaceSnapshotRevision(status)
	budget, err := s.runtime.ReservePublishedSnapshot(retained)
	if err != nil {
		releaseLease()
		finish("", err)
		return nil, nil, err
	}
	repositoryRef, err := s.runtime.RetainRepository(ctx, identity)
	if err != nil {
		budget.Release()
		releaseLease()
		finish("", err)
		return nil, nil, err
	}
	entry := &immutableWorkspaceSnapshot{
		identity:      identity.WorktreeKey,
		revision:      revision,
		status:        status,
		retainedBytes: retained,
		budget:        budget,
		repositoryRef: repositoryRef,
	}
	entry.epoch.Store(epoch)
	if err := s.workspaceStore.publish(entry); err != nil {
		releaseLease()
		finish("", err)
		return nil, nil, err
	}
	releaseLease()
	finish(revision, nil)
	return s.workspaceStore.pin(identity.WorktreeKey, revision)
}

func (s *Service) workspaceSnapshot(ctx context.Context, repoRoot string, expectedRevision string) (*immutableWorkspaceSnapshot, func(), error) {
	if expectedRevision == "" {
		return s.captureWorkspaceSnapshot(ctx, repoRoot)
	}
	identity, ok, err := s.runtime.ResolveRepositoryIdentity(ctx, repoRoot)
	if err != nil {
		return nil, nil, err
	}
	if !ok {
		return nil, nil, errors.New("not a git repository")
	}
	epoch, leaseAlreadyHeld := repoReadEpochFromContext(ctx, identity)
	releaseLease := func() {}
	if !leaseAlreadyHeld {
		lease, acquireErr := s.runtime.AcquireRead(ctx, identity)
		if acquireErr != nil {
			return nil, nil, acquireErr
		}
		epoch = lease.Epoch()
		releaseLease = lease.Release
	}
	entry, releasePin, err := s.workspaceStore.pin(identity.WorktreeKey, expectedRevision)
	if err != nil {
		releaseLease()
		return nil, nil, err
	}
	if entry.epoch.Load() != epoch {
		releasePin()
		releaseLease()
		s.workspaceStore.invalidate(identity.WorktreeKey)
		return nil, nil, errWorkspaceSnapshotStale
	}
	var once sync.Once
	return entry, func() {
		once.Do(func() {
			releasePin()
			releaseLease()
		})
	}, nil
}

func estimateWorkspaceSnapshotBytes(status workspaceStatusSnapshot) int64 {
	const itemOverhead = int64(256)
	total := int64(256 + len(status.HeadRef) + len(status.UpstreamRef))
	for _, items := range [][]gitWorkspaceChange{status.Staged, status.Unstaged, status.Untracked, status.Conflicted} {
		total += int64(cap(items)) * itemOverhead
		for _, item := range items {
			total += int64(len(item.Section) + len(item.EntryKind) + len(item.ParentPath) + len(item.DirectoryPath) + len(item.ChangeType) + len(item.Path) + len(item.OldPath) + len(item.NewPath) + len(item.DisplayPath))
			total += int64(cap(item.MutationPaths)) * 16
			for _, value := range item.MutationPaths {
				total += int64(len(value))
			}
		}
	}
	return total
}

func workspaceSnapshotRevision(status workspaceStatusSnapshot) string {
	h := sha256.New()
	writeRevisionField := func(value string) {
		var size [8]byte
		binary.BigEndian.PutUint64(size[:], uint64(len(value)))
		_, _ = h.Write(size[:])
		_, _ = h.Write([]byte(value))
	}
	writeRevisionField("workspace_inventory_v1")
	writeRevisionField(status.HeadRef)
	writeRevisionField(status.UpstreamRef)
	writeRevisionField(fmt.Sprint(status.Detached, ":", status.AheadCount, ":", status.BehindCount))
	sections := []struct {
		name  string
		items []gitWorkspaceChange
	}{{"staged", status.Staged}, {"unstaged", status.Unstaged}, {"untracked", status.Untracked}, {"conflicted", status.Conflicted}}
	for _, section := range sections {
		items := append([]gitWorkspaceChange(nil), section.items...)
		sortWorkspaceChanges(items)
		writeRevisionField(section.name)
		for _, item := range items {
			writeRevisionField(item.EntryKind)
			writeRevisionField(item.ChangeType)
			writeRevisionField(item.Path)
			writeRevisionField(item.OldPath)
			writeRevisionField(item.NewPath)
			writeRevisionField(item.DisplayPath)
		}
	}
	return hex.EncodeToString(h.Sum(nil))
}
