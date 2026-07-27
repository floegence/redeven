package gitruntime

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestRPCStreamAdmissionRejectsFifthAndReleases(t *testing.T) {
	if MaxRPCStreamReservations != 128<<20 {
		t.Fatalf("stream reservation aggregate = %d, want 128 MiB", MaxRPCStreamReservations)
	}
	if MaxRequestReservations != 128<<20 || MaxResponseReservations != 96<<20 || MaxCaptureReservations != 16<<20 {
		t.Fatalf("reservation contracts = request %d response %d capture %d", MaxRequestReservations, MaxResponseReservations, MaxCaptureReservations)
	}
	runtime := New()
	leases := make([]*Admission, 0, MaxRPCStreams)
	for i := 0; i < MaxRPCStreams; i++ {
		lease, err := runtime.TryAcquireRPCStream()
		if err != nil {
			t.Fatalf("acquire stream %d: %v", i, err)
		}
		leases = append(leases, lease)
	}
	if _, err := runtime.TryAcquireRPCStream(); !errors.Is(err, ErrResourceLimit) {
		t.Fatalf("fifth stream error = %v, want resource limit", err)
	}
	leases[0].Release()
	replacement, err := runtime.TryAcquireRPCStream()
	if err != nil {
		t.Fatalf("reacquire released stream: %v", err)
	}
	replacement.Release()
	for _, lease := range leases[1:] {
		lease.Release()
	}
}

func TestAdmissionWaitHonorsCancellation(t *testing.T) {
	runtime := New()
	leases := make([]*Admission, 0, MaxWorkspaceCaptures)
	for i := 0; i < MaxWorkspaceCaptures; i++ {
		lease, err := runtime.AcquireCapture(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		leases = append(leases, lease)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := runtime.AcquireCapture(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("AcquireCapture error = %v, want canceled", err)
	}
	for _, lease := range leases {
		lease.Release()
	}
}

func TestPublishedSnapshotAggregateReservation(t *testing.T) {
	runtime := New()
	const snapshotBytes = 8 << 20
	leases := make([]*Admission, 0, MaxPublishedSnapshotBytes/snapshotBytes)
	for i := int64(0); i < MaxPublishedSnapshotBytes/snapshotBytes; i++ {
		lease, err := runtime.ReservePublishedSnapshot(snapshotBytes)
		if err != nil {
			t.Fatalf("reserve snapshot %d: %v", i, err)
		}
		leases = append(leases, lease)
	}
	if _, err := runtime.ReservePublishedSnapshot(1); !errors.Is(err, ErrResourceLimit) {
		t.Fatalf("aggregate overflow error = %v", err)
	}
	leases[0].Release()
	lease, err := runtime.ReservePublishedSnapshot(1)
	if err != nil {
		t.Fatalf("reserve after eviction: %v", err)
	}
	lease.Release()
	for _, held := range leases[1:] {
		held.Release()
	}
}

func TestSessionRetainsRepositoryOnceAndReleasesOnClose(t *testing.T) {
	runtime := New()
	id := testIdentity(t)
	session := runtime.NewSession()
	if err := session.RetainRepository(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	if err := session.RetainRepository(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	runtime.mu.Lock()
	refs := runtime.registry[id.WorktreeKey].refs
	runtime.mu.Unlock()
	if refs != 1 {
		t.Fatalf("deduplicated session refs = %d, want 1", refs)
	}
	session.Close()
	runtime.mu.Lock()
	refs = runtime.registry[id.WorktreeKey].refs
	runtime.mu.Unlock()
	if refs != 0 {
		t.Fatalf("refs after close = %d, want 0", refs)
	}
	if err := session.RetainRepository(context.Background(), id); err == nil {
		t.Fatal("closed session accepted a repository")
	}
}

func TestRepositoryMutationAdvancesEpochAtBothBoundaries(t *testing.T) {
	runtime := New()
	id := testIdentity(t)
	read, err := runtime.AcquireRead(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	initial := read.Epoch()
	read.Release()
	mutation, err := runtime.AcquireMutation(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	if mutation.Epoch() != initial+1 {
		t.Fatalf("mutation epoch = %d, want %d", mutation.Epoch(), initial+1)
	}
	mutation.Release()
	read, err = runtime.AcquireRead(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	defer read.Release()
	if read.Epoch() != initial+2 {
		t.Fatalf("final epoch = %d, want %d", read.Epoch(), initial+2)
	}
}

func TestRepositoryWriterDoesNotStarveBehindNewReaders(t *testing.T) {
	runtime := New()
	id := testIdentity(t)
	firstRead, err := runtime.AcquireRead(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	order := make(chan string, 2)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		lease, acquireErr := runtime.AcquireMutation(context.Background(), id)
		if acquireErr != nil {
			return
		}
		order <- "writer"
		lease.Release()
	}()
	time.Sleep(20 * time.Millisecond)
	go func() {
		defer wg.Done()
		lease, acquireErr := runtime.AcquireRead(context.Background(), id)
		if acquireErr != nil {
			return
		}
		order <- "reader"
		lease.Release()
	}()
	firstRead.Release()
	wg.Wait()
	close(order)
	got := make([]string, 0, 2)
	for item := range order {
		got = append(got, item)
	}
	if len(got) != 2 || got[0] != "writer" || got[1] != "reader" {
		t.Fatalf("acquisition order = %v, want writer then reader", got)
	}
}

func TestTopologyEffectRebuildsIncompleteInactiveRegistry(t *testing.T) {
	runtime := New()
	root := t.TempDir()
	common := filepath.Join(root, ".git")
	if err := os.Mkdir(common, 0o755); err != nil {
		t.Fatal(err)
	}
	leases := make([]Lease, 0, maxWorktreesPerRepo)
	for i := 0; i < maxWorktreesPerRepo; i++ {
		worktreeRoot := filepath.Join(root, "worktrees", fmt.Sprintf("%03d", i))
		gitDir := filepath.Join(common, "worktrees", fmt.Sprintf("%03d", i))
		if err := os.MkdirAll(worktreeRoot, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(gitDir, 0o755); err != nil {
			t.Fatal(err)
		}
		id := identityForPaths(t, worktreeRoot, common, gitDir)
		lease, err := runtime.AcquireRead(context.Background(), id)
		if err != nil {
			t.Fatalf("admit worktree %d: %v", i, err)
		}
		leases = append(leases, lease)
	}
	overflowRoot := filepath.Join(root, "worktrees", "overflow")
	overflowGitDir := filepath.Join(common, "worktrees", "overflow")
	if err := os.MkdirAll(overflowRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(overflowGitDir, 0o755); err != nil {
		t.Fatal(err)
	}
	overflow := identityForPaths(t, overflowRoot, common, overflowGitDir)
	if _, err := runtime.AcquireRead(context.Background(), overflow); !errors.Is(err, ErrResourceLimit) {
		t.Fatalf("overflow admission error = %v", err)
	}
	for _, lease := range leases {
		lease.Release()
	}
	called := false
	if err := runtime.CoordinateFilesystemMutation(context.Background(), FilesystemEffect{
		Paths: []string{root}, ChangesTopology: true,
	}, func() error {
		called = true
		return nil
	}); err != nil {
		t.Fatalf("bounded registry rebuild: %v", err)
	}
	if !called {
		t.Fatal("topology effect did not run after registry rebuild")
	}
}

func TestResolveRepositoryIdentitySeparatesLinkedWorktree(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git unavailable")
	}
	repo := initGitRepository(t)
	worktree := filepath.Join(t.TempDir(), "linked")
	runGitTest(t, repo, "branch", "linked-test")
	runGitTest(t, repo, "worktree", "add", worktree, "linked-test")
	runtime := New()
	mainID, ok, err := runtime.ResolveRepositoryIdentity(context.Background(), repo)
	if err != nil || !ok {
		t.Fatalf("resolve main = (%v, %v)", ok, err)
	}
	linkedID, ok, err := runtime.ResolveRepositoryIdentity(context.Background(), worktree)
	if err != nil || !ok {
		t.Fatalf("resolve linked = (%v, %v)", ok, err)
	}
	if mainID.CommonRepoKey != linkedID.CommonRepoKey {
		t.Fatal("linked worktree did not share common repository identity")
	}
	if mainID.WorktreeKey == linkedID.WorktreeKey {
		t.Fatal("linked worktree reused main worktree identity")
	}
}

func TestFilesystemMutationOverlappingLinkedWorktreeMetadataWaitsForReadLease(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git unavailable")
	}
	repo := initGitRepository(t)
	worktree := filepath.Join(t.TempDir(), "linked")
	runGitTest(t, repo, "branch", "linked-metadata-test")
	runGitTest(t, repo, "worktree", "add", worktree, "linked-metadata-test")

	runtime := New()
	linkedID, ok, err := runtime.ResolveRepositoryIdentity(context.Background(), worktree)
	if err != nil || !ok {
		t.Fatalf("resolve linked = (%v, %v)", ok, err)
	}

	for name, effectPath := range map[string]string{
		"common-dir": filepath.Join(linkedID.CommonDir, "config"),
		"git-dir":    filepath.Join(linkedID.GitDir, "index"),
	} {
		t.Run(name, func(t *testing.T) {
			readLease, acquireErr := runtime.AcquireRead(context.Background(), linkedID)
			if acquireErr != nil {
				t.Fatal(acquireErr)
			}
			started := make(chan struct{})
			finished := make(chan error, 1)
			go func() {
				close(started)
				finished <- runtime.CoordinateFilesystemMutation(context.Background(), FilesystemEffect{
					Paths: []string{effectPath},
				}, func() error { return nil })
			}()
			<-started
			select {
			case err := <-finished:
				readLease.Release()
				t.Fatalf("metadata mutation escaped read lease: %v", err)
			case <-time.After(50 * time.Millisecond):
			}
			readLease.Release()
			select {
			case err := <-finished:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(time.Second):
				t.Fatal("metadata mutation did not resume after read lease release")
			}
		})
	}
}

func testIdentity(t *testing.T) RepositoryIdentity {
	t.Helper()
	root := t.TempDir()
	common := filepath.Join(root, ".git")
	if err := os.Mkdir(common, 0o755); err != nil {
		t.Fatal(err)
	}
	return identityForPaths(t, root, common, common)
}

func identityForPaths(t *testing.T, root string, common string, gitDir string) RepositoryIdentity {
	t.Helper()
	root, rootID, err := canonicalPathIdentity(root)
	if err != nil {
		t.Fatal(err)
	}
	common, commonID, err := canonicalPathIdentity(common)
	if err != nil {
		t.Fatal(err)
	}
	gitDir, gitDirID, err := canonicalPathIdentity(gitDir)
	if err != nil {
		t.Fatal(err)
	}
	return RepositoryIdentity{
		CommonRepoKey: identityDigest(common, commonID),
		WorktreeKey:   identityDigest(root, rootID, gitDir, gitDirID),
		WorktreeRoot:  root,
		CommonDir:     common,
		GitDir:        gitDir,
	}
}

func initGitRepository(t *testing.T) string {
	t.Helper()
	repo := t.TempDir()
	runGitTest(t, repo, "init")
	runGitTest(t, repo, "config", "user.name", "Tester")
	runGitTest(t, repo, "config", "user.email", "tester@example.com")
	if err := os.WriteFile(filepath.Join(repo, "README.md"), []byte("hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGitTest(t, repo, "add", "README.md")
	runGitTest(t, repo, "commit", "-m", "initial")
	return repo
}

func runGitTest(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=Tester", "GIT_AUTHOR_EMAIL=tester@example.com",
		"GIT_COMMITTER_NAME=Tester", "GIT_COMMITTER_EMAIL=tester@example.com",
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git command failed: %v\n%s", err, out)
	}
}

func TestRunnerBoundsOutputAndCleanup(t *testing.T) {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		t.Skip("POSIX process-group contract")
	}
	bin := t.TempDir()
	script := filepath.Join(bin, "git")
	contents := "#!/bin/sh\nhead -c 1100000 /dev/zero\n"
	if err := os.WriteFile(script, []byte(contents), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	runtime := New()
	started := time.Now()
	result, err := runtime.RunRead(context.Background(), t.TempDir(), nil, "status")
	var commandErr *CommandError
	if !errors.As(err, &commandErr) || !commandErr.BudgetExceeded || !result.UnknownOutcome {
		t.Fatalf("RunRead result=%+v error=%v, want bounded unknown outcome", result, err)
	}
	if time.Since(started) > processCleanupDeadline+2*time.Second {
		t.Fatalf("output cleanup exceeded deadline: %s", time.Since(started))
	}
}

func TestStreamCaptureDoesNotBufferWholeInventory(t *testing.T) {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		t.Skip("POSIX process-group contract")
	}
	bin := t.TempDir()
	script := filepath.Join(bin, "git")
	if err := os.WriteFile(script, []byte("#!/bin/sh\nhead -c 2097152 /dev/zero\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	runtime := New()
	var read int64
	result, err := runtime.StreamCapture(context.Background(), t.TempDir(), nil, func(stdout io.Reader) error {
		var copyErr error
		read, copyErr = io.Copy(io.Discard, stdout)
		return copyErr
	}, "status")
	if err != nil {
		t.Fatalf("StreamCapture error = %v, result = %+v", err, result)
	}
	if read != 2<<20 {
		t.Fatalf("streamed bytes = %d, want 2 MiB", read)
	}
}

func TestStreamReadRejectsConsumerThatReturnsBeforeEOF(t *testing.T) {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		t.Skip("POSIX process-group contract")
	}
	bin := t.TempDir()
	script := filepath.Join(bin, "git")
	if err := os.WriteFile(script, []byte("#!/bin/sh\nwhile :; do head -c 65536 /dev/zero; done\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	started := time.Now()
	result, err := New().StreamRead(context.Background(), t.TempDir(), nil, func(io.Reader) error { return nil }, "status")
	var commandErr *CommandError
	if !errors.As(err, &commandErr) || !commandErr.BudgetExceeded || !result.UnknownOutcome {
		t.Fatalf("StreamRead result=%+v error=%v", result, err)
	}
	if time.Since(started) > processCleanupDeadline+2*time.Second {
		t.Fatalf("early consumer cleanup exceeded deadline: %s", time.Since(started))
	}
}

func TestRunnerCancellationAfterPipesReachEOFStillCleansUp(t *testing.T) {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		t.Skip("POSIX process-group contract")
	}
	bin := t.TempDir()
	script := filepath.Join(bin, "git")
	contents := "#!/bin/sh\nexec 1>&- 2>&-\nwhile :; do sleep 1; done\n"
	if err := os.WriteFile(script, []byte(contents), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	started := time.Now()
	result, err := New().RunRead(ctx, t.TempDir(), nil, "status")
	var commandErr *CommandError
	if !errors.As(err, &commandErr) || !commandErr.UnknownOutcome || !result.UnknownOutcome {
		t.Fatalf("RunRead result=%+v error=%v, want bounded unknown outcome", result, err)
	}
	if time.Since(started) > processCleanupDeadline+time.Second {
		t.Fatalf("closed-pipe cleanup exceeded deadline: %s", time.Since(started))
	}
}

func TestTopologyMutationBlocksRepositoryResolve(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git unavailable")
	}
	repo := initGitRepository(t)
	runtime := New()
	if _, ok, err := runtime.ResolveRepositoryIdentity(context.Background(), repo); err != nil || !ok {
		t.Fatalf("initial resolve = (%v, %v)", ok, err)
	}
	entered := make(chan struct{})
	release := make(chan struct{})
	mutationDone := make(chan error, 1)
	go func() {
		mutationDone <- runtime.CoordinateTopologyMutation(context.Background(), FilesystemEffect{
			Paths: []string{repo}, ChangesTopology: true,
		}, func(context.Context) error {
			close(entered)
			<-release
			return nil
		})
	}()
	<-entered
	resolveDone := make(chan error, 1)
	go func() {
		_, _, err := runtime.ResolveRepositoryIdentity(context.Background(), repo)
		resolveDone <- err
	}()
	select {
	case err := <-resolveDone:
		t.Fatalf("resolve escaped topology-exclusive mutation: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	close(release)
	if err := <-mutationDone; err != nil {
		t.Fatal(err)
	}
	if err := <-resolveDone; err != nil {
		t.Fatal(err)
	}
}

func TestCommandEnvironmentMergesOverridesAndFiltersSecrets(t *testing.T) {
	t.Setenv("REDEVEN_LOCAL_UI_PASSWORD", "secret")
	t.Setenv("GIT_EDITOR", "from-parent")
	environment := commandEnvironment([]string{"GIT_EDITOR=:", "REDEVEN_BOOTSTRAP_TICKET=secret"})
	joined := strings.Join(environment, "\n")
	for _, forbidden := range []string{"REDEVEN_LOCAL_UI_PASSWORD=", "REDEVEN_BOOTSTRAP_TICKET="} {
		if strings.Contains(joined, forbidden) {
			t.Fatalf("command environment retained %s", forbidden)
		}
	}
	if !strings.Contains(joined, "GIT_EDITOR=:") || strings.Contains(joined, "GIT_EDITOR=from-parent") {
		t.Fatalf("command environment did not apply override: %s", joined)
	}
	if !strings.Contains(joined, "GIT_TERMINAL_PROMPT=0") || !strings.Contains(joined, "GCM_INTERACTIVE=never") {
		t.Fatal("command environment omitted non-interactive guards")
	}
}
