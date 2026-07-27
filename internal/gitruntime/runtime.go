package gitruntime

import (
	"context"
	"errors"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	maxCoordinators          = 256
	maxWorktrees             = 1024
	maxWorktreesPerRepo      = 128
	maxRegistryPathBytes     = 4 << 20
	maxRegistryHeapBytes     = 8 << 20
	maxRepoRegistryPathBytes = 512 << 10
	inactiveRetention        = 5 * time.Minute
)

// RepositoryIdentity separates shared-ref coordination from worktree-local
// index and snapshot identity.
type RepositoryIdentity struct {
	CommonRepoKey string
	WorktreeKey   string
	WorktreeRoot  string
	CommonDir     string
	GitDir        string
}

func (id RepositoryIdentity) validate() error {
	if strings.TrimSpace(id.CommonRepoKey) == "" || strings.TrimSpace(id.WorktreeKey) == "" {
		return errors.New("missing repository identity key")
	}
	for _, path := range []string{id.WorktreeRoot, id.CommonDir, id.GitDir} {
		if path == "" || !filepath.IsAbs(path) || filepath.Clean(path) != path {
			return errors.New("repository identity path is not canonical")
		}
	}
	return nil
}

type repoCoordinator struct {
	gate     fairRWGate
	epoch    atomic.Uint64
	refs     int
	inactive time.Time
}

type registryEntry struct {
	identity RepositoryIdentity
	refs     int
	inactive time.Time
}

// Lease covers the topology and common-repository gates in their required
// acquisition order.
type Lease interface {
	Epoch() uint64
	Context(context.Context) context.Context
	Release()
}

type runtimeLease struct {
	epoch       uint64
	release     func()
	before      func()
	beforeOnce  sync.Once
	releaseOnce sync.Once
}

func (l *runtimeLease) Epoch() uint64 { return l.epoch }

type topologyLeaseContextKey struct{}

func (l *runtimeLease) Context(ctx context.Context) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, topologyLeaseContextKey{}, struct{}{})
}

func topologyLeaseHeld(ctx context.Context) bool {
	return ctx != nil && ctx.Value(topologyLeaseContextKey{}) != nil
}

func (l *runtimeLease) Release() {
	if l == nil {
		return
	}
	l.releaseOnce.Do(func() {
		if l.before != nil {
			l.beforeOnce.Do(l.before)
		}
		if l.release != nil {
			l.release()
		}
	})
}

// Coordinator is the narrow contract used by repository services.
type Coordinator interface {
	AcquireRead(context.Context, RepositoryIdentity) (Lease, error)
	AcquireMutation(context.Context, RepositoryIdentity) (Lease, error)
	Invalidate(RepositoryIdentity)
}

// FilesystemMutationCoordinator is the only Git runtime contract exposed to
// the filesystem service.
type FilesystemMutationCoordinator interface {
	CoordinateFilesystemMutation(context.Context, FilesystemEffect, func() error) error
}

type Runtime struct {
	readProcesses      *limiter
	captures           *limiter
	mutationProcesses  *limiter
	destructiveScans   *limiter
	requestDecodes     *limiter
	responseBuilds     *limiter
	rpcStreams         *limiter
	publishedSnapshots *byteLimiter

	topology           fairRWGate
	mu                 sync.Mutex
	coordinators       map[string]*repoCoordinator
	registry           map[string]*registryEntry
	registryPathBytes  int
	registryHeapBytes  int
	registryIncomplete bool
	registryGeneration uint64
}

func New() *Runtime {
	return &Runtime{
		readProcesses:      newLimiter(MaxReadProcesses),
		captures:           newLimiter(MaxWorkspaceCaptures),
		mutationProcesses:  newLimiter(MaxMutationProcesses),
		destructiveScans:   newLimiter(MaxDestructiveScans),
		requestDecodes:     newLimiter(MaxRequestDecodes),
		responseBuilds:     newLimiter(MaxResponseBuilds),
		rpcStreams:         newLimiter(MaxRPCStreams),
		publishedSnapshots: newByteLimiter(MaxPublishedSnapshotBytes),
		coordinators:       make(map[string]*repoCoordinator),
		registry:           make(map[string]*registryEntry),
	}
}

// ReservePublishedSnapshot accounts retained snapshot capacity across every
// direct-session cache. Cache eviction must release the returned admission.
func (r *Runtime) ReservePublishedSnapshot(bytes int64) (*Admission, error) {
	if r == nil || r.publishedSnapshots == nil {
		return nil, ErrResourceLimit
	}
	release, ok := r.publishedSnapshots.tryAcquire(bytes)
	if !ok {
		return nil, ErrResourceLimit
	}
	return &Admission{release: release}, nil
}

// RetainRepository pins the registry entry and its common-repository epoch
// owner without holding a read/write gate. Published snapshots and in-flight
// singleflight generations must keep this admission until their references are
// released.
func (r *Runtime) RetainRepository(ctx context.Context, id RepositoryIdentity) (*Admission, error) {
	if r == nil {
		return nil, ErrResourceLimit
	}
	if err := id.validate(); err != nil {
		return nil, err
	}
	releaseTopology := func() {}
	if !topologyLeaseHeld(ctx) {
		var err error
		releaseTopology, err = r.topology.acquire(ctx, false)
		if err != nil {
			return nil, err
		}
	}
	defer releaseTopology()
	if !repositoryIdentityCurrent(id) {
		r.markRegistryIncomplete()
		return nil, ErrResourceLimit
	}
	if _, err := r.retainIdentity(id); err != nil {
		return nil, err
	}
	return &Admission{release: func() { r.releaseIdentity(id) }}, nil
}

func (r *Runtime) AcquireRequestDecode(ctx context.Context) (*Admission, error) {
	return r.acquire(ctx, r.requestDecodes)
}

func (r *Runtime) AcquireResponseBuild(ctx context.Context) (*Admission, error) {
	return r.acquire(ctx, r.responseBuilds)
}

func (r *Runtime) AcquireRPCStream(ctx context.Context) (*Admission, error) {
	return r.acquire(ctx, r.rpcStreams)
}

func (r *Runtime) TryAcquireRPCStream() (*Admission, error) {
	if r == nil {
		return nil, ErrResourceLimit
	}
	release, ok := r.rpcStreams.tryAcquire()
	if !ok {
		return nil, ErrResourceLimit
	}
	return &Admission{release: release}, nil
}

func (r *Runtime) AcquireCapture(ctx context.Context) (*Admission, error) {
	return r.acquire(ctx, r.captures)
}

func (r *Runtime) AcquireDestructiveScan(ctx context.Context) (*Admission, error) {
	return r.acquire(ctx, r.destructiveScans)
}

func (r *Runtime) acquire(ctx context.Context, limiter *limiter) (*Admission, error) {
	if r == nil || limiter == nil {
		return nil, ErrResourceLimit
	}
	release, err := limiter.acquire(ctx)
	if err != nil {
		return nil, err
	}
	return &Admission{release: release}, nil
}

func (r *Runtime) AcquireRead(ctx context.Context, id RepositoryIdentity) (Lease, error) {
	return r.acquireRepository(ctx, id, false)
}

func (r *Runtime) AcquireMutation(ctx context.Context, id RepositoryIdentity) (Lease, error) {
	return r.acquireRepository(ctx, id, true)
}

func (r *Runtime) acquireRepository(ctx context.Context, id RepositoryIdentity, mutation bool) (Lease, error) {
	if r == nil {
		return nil, ErrResourceLimit
	}
	if err := id.validate(); err != nil {
		return nil, err
	}
	releaseTopology, err := r.topology.acquire(ctx, false)
	if err != nil {
		return nil, err
	}
	if !repositoryIdentityCurrent(id) {
		releaseTopology()
		r.markRegistryIncomplete()
		return nil, ErrResourceLimit
	}
	coord, err := r.retainIdentity(id)
	if err != nil {
		releaseTopology()
		return nil, err
	}
	releaseRepo, err := coord.gate.acquire(ctx, mutation)
	if err != nil {
		r.releaseIdentity(id)
		releaseTopology()
		return nil, err
	}
	if mutation {
		coord.epoch.Add(1)
	}
	epoch := coord.epoch.Load()
	return &runtimeLease{
		epoch: epoch,
		before: func() {
			if mutation {
				coord.epoch.Add(1)
			}
		},
		release: func() {
			releaseRepo()
			r.releaseIdentity(id)
			releaseTopology()
		},
	}, nil
}

func (r *Runtime) markRegistryIncomplete() {
	r.mu.Lock()
	r.registryIncomplete = true
	r.registryGeneration++
	r.mu.Unlock()
}

func (r *Runtime) Invalidate(id RepositoryIdentity) {
	if r == nil || strings.TrimSpace(id.CommonRepoKey) == "" {
		return
	}
	r.mu.Lock()
	if coord := r.coordinators[id.CommonRepoKey]; coord != nil {
		coord.epoch.Add(1)
	}
	r.mu.Unlock()
}

func (r *Runtime) retainIdentity(id RepositoryIdentity) (*repoCoordinator, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.pruneInactiveLocked(time.Now())
	entry := r.registry[id.WorktreeKey]
	insertedEntry := false
	if entry == nil {
		pathBytes := identityPathBytes(id)
		heapBytes := identityHeapBytes(id)
		for len(r.registry) >= maxWorktrees || r.registryPathBytes+pathBytes > maxRegistryPathBytes ||
			r.registryHeapBytes+heapBytes > maxRegistryHeapBytes ||
			r.repoEntryCountLocked(id.CommonRepoKey) >= maxWorktreesPerRepo ||
			r.repoPathBytesLocked(id.CommonRepoKey)+pathBytes > maxRepoRegistryPathBytes {
			if !r.evictInactiveWorktreeLocked(id.CommonRepoKey) && !r.evictInactiveWorktreeLocked("") {
				break
			}
		}
		if len(r.registry) >= maxWorktrees || r.registryPathBytes+pathBytes > maxRegistryPathBytes ||
			r.registryHeapBytes+heapBytes > maxRegistryHeapBytes ||
			r.repoEntryCountLocked(id.CommonRepoKey) >= maxWorktreesPerRepo ||
			r.repoPathBytesLocked(id.CommonRepoKey)+pathBytes > maxRepoRegistryPathBytes {
			r.registryIncomplete = true
			r.registryGeneration++
			return nil, ErrResourceLimit
		}
		entry = &registryEntry{identity: id}
		r.registry[id.WorktreeKey] = entry
		r.registryPathBytes += pathBytes
		r.registryHeapBytes += heapBytes
		insertedEntry = true
	} else if entry.identity != id {
		r.registryIncomplete = true
		r.registryGeneration++
		return nil, ErrResourceLimit
	}
	coord := r.coordinators[id.CommonRepoKey]
	if coord == nil {
		for len(r.coordinators) >= maxCoordinators && r.evictInactiveCoordinatorLocked() {
		}
		if len(r.coordinators) >= maxCoordinators {
			if insertedEntry {
				r.registryPathBytes -= identityPathBytes(id)
				r.registryHeapBytes -= identityHeapBytes(id)
				delete(r.registry, id.WorktreeKey)
			}
			r.registryIncomplete = true
			r.registryGeneration++
			return nil, ErrResourceLimit
		}
		coord = &repoCoordinator{}
		r.coordinators[id.CommonRepoKey] = coord
	}
	entry.refs++
	entry.inactive = time.Time{}
	coord.refs++
	coord.inactive = time.Time{}
	return coord, nil
}

func (r *Runtime) evictInactiveWorktreeLocked(commonKey string) bool {
	var oldestKey string
	var oldest time.Time
	for key, entry := range r.registry {
		if entry.refs != 0 || entry.inactive.IsZero() || (commonKey != "" && entry.identity.CommonRepoKey != commonKey) {
			continue
		}
		if oldestKey == "" || entry.inactive.Before(oldest) {
			oldestKey = key
			oldest = entry.inactive
		}
	}
	if oldestKey == "" {
		return false
	}
	r.registryPathBytes -= identityPathBytes(r.registry[oldestKey].identity)
	r.registryHeapBytes -= identityHeapBytes(r.registry[oldestKey].identity)
	delete(r.registry, oldestKey)
	return true
}

func (r *Runtime) evictInactiveCoordinatorLocked() bool {
	var oldestKey string
	var oldest time.Time
	for key, coord := range r.coordinators {
		if coord.refs != 0 || coord.inactive.IsZero() {
			continue
		}
		if oldestKey == "" || coord.inactive.Before(oldest) {
			oldestKey = key
			oldest = coord.inactive
		}
	}
	if oldestKey == "" {
		return false
	}
	delete(r.coordinators, oldestKey)
	return true
}

func (r *Runtime) releaseIdentity(id RepositoryIdentity) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	if entry := r.registry[id.WorktreeKey]; entry != nil && entry.refs > 0 {
		entry.refs--
		if entry.refs == 0 {
			entry.inactive = now
		}
	}
	if coord := r.coordinators[id.CommonRepoKey]; coord != nil && coord.refs > 0 {
		coord.refs--
		if coord.refs == 0 {
			coord.inactive = now
		}
	}
}

func identityPathBytes(id RepositoryIdentity) int {
	return len(id.WorktreeRoot) + len(id.CommonDir) + len(id.GitDir)
}

func identityHeapBytes(id RepositoryIdentity) int {
	// Account retained string data, map keys, entry/identity structs, and map
	// bucket overhead conservatively before the entry becomes reachable.
	return identityPathBytes(id) + len(id.CommonRepoKey) + len(id.WorktreeKey)*2 + 512
}

func (r *Runtime) repoEntryCountLocked(commonKey string) int {
	count := 0
	for _, entry := range r.registry {
		if entry.identity.CommonRepoKey == commonKey {
			count++
		}
	}
	return count
}

func (r *Runtime) repoPathBytesLocked(commonKey string) int {
	total := 0
	for _, entry := range r.registry {
		if entry.identity.CommonRepoKey == commonKey {
			total += identityPathBytes(entry.identity)
		}
	}
	return total
}

func (r *Runtime) pruneInactiveLocked(now time.Time) {
	for key, entry := range r.registry {
		if entry.refs == 0 && !entry.inactive.IsZero() && now.Sub(entry.inactive) >= inactiveRetention {
			r.registryPathBytes -= identityPathBytes(entry.identity)
			r.registryHeapBytes -= identityHeapBytes(entry.identity)
			delete(r.registry, key)
		}
	}
	for key, coord := range r.coordinators {
		if coord.refs == 0 && !coord.inactive.IsZero() && now.Sub(coord.inactive) >= inactiveRetention {
			delete(r.coordinators, key)
		}
	}
}

// FilesystemEffect describes the paths whose topology or content will change.
type FilesystemEffect struct {
	Paths           []string
	ChangesTopology bool
}

// CoordinateFilesystemMutation serializes a Files-owned effect with every
// registered worktree or Git metadata root that overlaps an effect path.
func (r *Runtime) CoordinateFilesystemMutation(ctx context.Context, effect FilesystemEffect, fn func() error) error {
	if fn == nil {
		return ErrResourceLimit
	}
	return r.CoordinateTopologyMutation(ctx, effect, func(context.Context) error { return fn() })
}

// CoordinateTopologyMutation owns the topology-exclusive/shared gate and every
// overlapping common-repository mutation gate through the supplied effect.
// The callback context may safely resolve repository identities without
// recursively acquiring the topology gate.
func (r *Runtime) CoordinateTopologyMutation(ctx context.Context, effect FilesystemEffect, fn func(context.Context) error) error {
	if r == nil || fn == nil {
		return ErrResourceLimit
	}
	releaseTopology, err := r.topology.acquire(ctx, effect.ChangesTopology)
	if err != nil {
		return err
	}
	defer releaseTopology()
	if effect.ChangesTopology {
		if err := r.rebuildRegistry(); err != nil {
			return err
		}
	}

	ids, err := r.resolveEffectIdentities(ctx, effect)
	if err != nil {
		return err
	}
	coords := make([]struct {
		id      RepositoryIdentity
		coord   *repoCoordinator
		release func()
	}, 0, len(ids))
	for _, id := range ids {
		coord, retainErr := r.retainIdentity(id)
		if retainErr != nil {
			err = retainErr
			break
		}
		release, acquireErr := coord.gate.acquire(ctx, true)
		if acquireErr != nil {
			r.releaseIdentity(id)
			err = acquireErr
			break
		}
		coord.epoch.Add(1)
		coords = append(coords, struct {
			id      RepositoryIdentity
			coord   *repoCoordinator
			release func()
		}{id: id, coord: coord, release: release})
	}
	defer func() {
		for i := len(coords) - 1; i >= 0; i-- {
			coords[i].coord.epoch.Add(1)
			coords[i].release()
			r.releaseIdentity(coords[i].id)
		}
	}()
	if err != nil {
		return err
	}
	revalidated, err := r.resolveEffectIdentities(ctx, effect)
	if err != nil || !sameCommonRepositories(ids, revalidated) {
		return ErrResourceLimit
	}
	return fn(context.WithValue(ctx, topologyLeaseContextKey{}, struct{}{}))
}

func (r *Runtime) resolveEffectIdentities(ctx context.Context, effect FilesystemEffect) ([]RepositoryIdentity, error) {
	ids, err := r.identitiesOverlapping(effect.Paths, effect.ChangesTopology)
	if err != nil {
		return nil, err
	}
	known := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		known[id.CommonRepoKey] = struct{}{}
	}
	for _, path := range effect.Paths {
		id, ok, resolveErr := r.resolveRepositoryIdentityLocked(ctx, path)
		if errors.Is(resolveErr, ErrContainmentUnavailable) {
			continue
		}
		if resolveErr != nil {
			return nil, resolveErr
		}
		if ok {
			if _, exists := known[id.CommonRepoKey]; !exists {
				ids = append(ids, id)
				known[id.CommonRepoKey] = struct{}{}
			}
		}
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i].CommonRepoKey < ids[j].CommonRepoKey })
	return ids, nil
}

func sameCommonRepositories(a, b []RepositoryIdentity) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i].CommonRepoKey != b[i].CommonRepoKey {
			return false
		}
	}
	return true
}

func (r *Runtime) rebuildRegistry() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.registryIncomplete {
		return nil
	}
	for key, entry := range r.registry {
		root, rootID, rootErr := canonicalPathIdentity(entry.identity.WorktreeRoot)
		common, commonID, commonErr := canonicalPathIdentity(entry.identity.CommonDir)
		gitDir, gitID, gitErr := canonicalPathIdentity(entry.identity.GitDir)
		valid := rootErr == nil && commonErr == nil && gitErr == nil &&
			root == entry.identity.WorktreeRoot && common == entry.identity.CommonDir && gitDir == entry.identity.GitDir &&
			identityDigest(common, commonID) == entry.identity.CommonRepoKey &&
			identityDigest(root, rootID, gitDir, gitID) == entry.identity.WorktreeKey
		if valid {
			continue
		}
		if entry.refs != 0 {
			return ErrResourceLimit
		}
		r.registryPathBytes -= identityPathBytes(entry.identity)
		r.registryHeapBytes -= identityHeapBytes(entry.identity)
		delete(r.registry, key)
	}
	if len(r.registry) > maxWorktrees || r.registryPathBytes > maxRegistryPathBytes || r.registryHeapBytes > maxRegistryHeapBytes {
		return ErrResourceLimit
	}
	perRepoCount := make(map[string]int)
	perRepoBytes := make(map[string]int)
	for _, entry := range r.registry {
		key := entry.identity.CommonRepoKey
		perRepoCount[key]++
		perRepoBytes[key] += identityPathBytes(entry.identity)
		if perRepoCount[key] > maxWorktreesPerRepo || perRepoBytes[key] > maxRepoRegistryPathBytes {
			return ErrResourceLimit
		}
	}
	r.registryIncomplete = false
	r.registryGeneration++
	return nil
}

func (r *Runtime) identitiesOverlapping(paths []string, topologyEffect bool) ([]RepositoryIdentity, error) {
	cleaned := make([]string, 0, len(paths))
	for _, path := range paths {
		if path == "" || !filepath.IsAbs(path) {
			return nil, errors.New("filesystem effect path is not absolute")
		}
		cleaned = append(cleaned, filepath.Clean(path))
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if topologyEffect && r.registryIncomplete {
		return nil, ErrResourceLimit
	}
	byCommon := make(map[string]RepositoryIdentity)
	for _, entry := range r.registry {
		for _, path := range cleaned {
			if pathsOverlap(path, entry.identity.WorktreeRoot) ||
				pathsOverlap(path, entry.identity.CommonDir) ||
				pathsOverlap(path, entry.identity.GitDir) {
				byCommon[entry.identity.CommonRepoKey] = entry.identity
				break
			}
		}
	}
	keys := make([]string, 0, len(byCommon))
	for key := range byCommon {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := make([]RepositoryIdentity, 0, len(keys))
	for _, key := range keys {
		out = append(out, byCommon[key])
	}
	return out, nil
}

func pathsOverlap(a, b string) bool {
	relAB, errAB := filepath.Rel(a, b)
	relBA, errBA := filepath.Rel(b, a)
	return (errAB == nil && relAB != ".." && !strings.HasPrefix(relAB, ".."+string(filepath.Separator))) ||
		(errBA == nil && relBA != ".." && !strings.HasPrefix(relBA, ".."+string(filepath.Separator)))
}
