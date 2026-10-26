package ai

import (
	"context"
	"errors"
	flruntime "github.com/floegence/floret/v7/runtime"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestForkWorkingFilesAreIndependentAndReplayDoesNotOverwrite(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	source, err := svc.CreateThread(t.Context(), meta, "Source", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	parent, err := prepareTaskFiles(svc.stateDir, source.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(parent.Scratch, "data.csv"), []byte("4,8,15"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(parent.Staging, "draft.txt"), []byte("draft"), 0600); err != nil {
		t.Fatal(err)
	}
	req := ForkThreadRequest{ClientRequestID: "working-files-fork", Title: "Fork"}
	fork, err := svc.ForkThreadWithOptions(t.Context(), meta, source.ThreadID, req)
	if err != nil {
		t.Fatal(err)
	}
	child, err := taskFiles(svc.stateDir, fork.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	data := filepath.Join(child.Scratch, "data.csv")
	if got, err := os.ReadFile(data); err != nil || string(got) != "4,8,15" {
		t.Fatalf("fork lost working data: %q %v", got, err)
	}
	if got, err := os.ReadFile(filepath.Join(child.Staging, "draft.txt")); err != nil || string(got) != "draft" {
		t.Fatalf("fork lost staging: %q %v", got, err)
	}
	if err = os.WriteFile(data, []byte("child edit"), 0600); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(filepath.Join(parent.Scratch, "data.csv")); string(got) != "4,8,15" {
		t.Fatal("child changed source")
	}
	replay, err := svc.ForkThreadWithOptions(t.Context(), meta, source.ThreadID, req)
	if err != nil || replay.ThreadID != fork.ThreadID {
		t.Fatalf("replay: %+v %v", replay, err)
	}
	if got, _ := os.ReadFile(data); string(got) != "child edit" {
		t.Fatal("replay overwrote child")
	}
	nested, err := svc.ForkThreadWithOptions(t.Context(), meta, fork.ThreadID, ForkThreadRequest{ClientRequestID: "nested-working-files"})
	if err != nil {
		t.Fatal(err)
	}
	grandchild, _ := taskFiles(svc.stateDir, nested.ThreadID)
	if got, _ := os.ReadFile(filepath.Join(grandchild.Scratch, "data.csv")); string(got) != "child edit" {
		t.Fatal("nested fork lost current files")
	}
	if err = svc.CleanTaskFiles(t.Context(), meta, source.ThreadID); err != nil {
		t.Fatal(err)
	}
	if err = svc.DeleteThread(t.Context(), meta, source.ThreadID, false); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(data); string(got) != "child edit" {
		t.Fatal("parent cleanup damaged fork")
	}
	if err = svc.CleanTaskFiles(t.Context(), meta, fork.ThreadID); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.ForkThreadWithOptions(t.Context(), meta, fork.ThreadID, ForkThreadRequest{ClientRequestID: "nested-working-files"}); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(filepath.Join(grandchild.Scratch, "data.csv")); string(got) != "child edit" {
		t.Fatal("retry after cleanup damaged fork")
	}
}

func TestForkWorkingFilesFailureIsUnpublishedAndRetryable(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	source, err := svc.CreateThread(t.Context(), meta, "Source", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	space, err := prepareTaskFiles(svc.stateDir, source.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "private.txt")
	if err = os.WriteFile(outside, []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(space.Scratch, "escape")
	if err = os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	req := ForkThreadRequest{ClientRequestID: "failed-copy"}
	if _, err = svc.ForkThreadWithOptions(t.Context(), meta, source.ThreadID, req); err == nil {
		t.Fatal("copied external link")
	}
	// A failed preparation must not authorize execution on the canonical identity.
	roots, e := svc.threadRuntime.List(t.Context(), flruntime.ThreadScope{})
	if e != nil {
		t.Fatal(e)
	}
	for _, root := range roots {
		if root.ID.String() != source.ThreadID {
			if e = svc.requireEndpointThreadAuthority(t.Context(), meta.EndpointID, root.ID.String()); e == nil {
				t.Fatal("unprepared fork admitted execution")
			}
		}
	}
	list, err := svc.ListThreads(t.Context(), meta, 100, "")
	if err != nil || len(list.Threads) != 1 {
		t.Fatalf("partial fork visible: %+v %v", list, err)
	}
	entries, err := os.ReadDir(filepath.Dir(space.Root))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".fork-") {
			t.Fatal("partial stage leaked")
		}
	}
	if err = os.Remove(link); err != nil {
		t.Fatal(err)
	}
	fork, err := svc.ForkThreadWithOptions(t.Context(), meta, source.ThreadID, req)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	replay, err := svc.ForkThreadWithOptions(t.Context(), meta, source.ThreadID, req)
	if err != nil || replay.ThreadID != fork.ThreadID {
		t.Fatalf("replay inspected changed source: %+v %v", replay, err)
	}
}

func TestForkWorkingFilesAdmissionWaitIsCancelableAndPerThread(t *testing.T) {
	var manager taskFileManager
	release, err := manager.acquire(t.Context(), "parent")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Millisecond)
	defer cancel()
	if _, err = manager.freeze(ctx, "parent"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("freeze did not honor cancellation: %v", err)
	}
	release()
	thaw, err := manager.freeze(t.Context(), "parent")
	if err != nil {
		t.Fatal(err)
	}
	defer thaw()
	unrelated, err := manager.acquire(t.Context(), "other")
	if err != nil {
		t.Fatal(err)
	}
	unrelated()
	ctx2, cancel2 := context.WithTimeout(t.Context(), 20*time.Millisecond)
	defer cancel2()
	if _, err = manager.acquire(ctx2, "parent"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("admission ignored freeze: %v", err)
	}
	thaw()
	resumed, err := manager.acquire(t.Context(), "parent")
	if err != nil {
		t.Fatal(err)
	}
	resumed()
}

func TestForkWorkingFilesContextAndAtomicPublication(t *testing.T) {
	state := t.TempDir()
	source, err := prepareTaskFiles(state, "source")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(source.Scratch, "helper.sh"), []byte("echo data"), 0700); err != nil {
		t.Fatal(err)
	}
	base, stage, discard, err := stageForkTaskFiles(t.Context(), state, "source", "req", "historical-answer")
	if err != nil {
		t.Fatal(err)
	}
	defer discard()
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if err = publishForkTaskFiles(ctx, base, stage, "source", "target", "historical-answer"); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	target, _ := taskFiles(state, "target")
	if _, err = os.Stat(target.Root); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("canceled copy published")
	}
	if err = publishForkTaskFiles(t.Context(), base, stage, "source", "target", "historical-answer"); err != nil {
		t.Fatal(err)
	}
	if err = publishForkTaskFiles(t.Context(), base, stage, "source", "target", "historical-answer"); err != nil {
		t.Fatal(err)
	}
	if err = publishForkTaskFiles(t.Context(), base, stage, "source", "target", "wrong-answer"); err == nil {
		t.Fatal("wrong identity accepted")
	}
	info, err := os.Stat(filepath.Join(target.Scratch, "helper.sh"))
	if err != nil || info.Mode().Perm()&0100 == 0 {
		t.Fatal("lost executable helper", err)
	}
	text, err := taskForkContext(target)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"source", "not a historical filesystem snapshot", "earlier ancestors", "Project files", "internally"} {
		if !strings.Contains(text, want) {
			t.Fatalf("missing fork context %q: %s", want, text)
		}
	}
}

func TestForkWorkingFilesConcurrentRequestsPublishOneCopy(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	source, err := svc.CreateThread(t.Context(), meta, "Source", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	space, err := prepareTaskFiles(svc.stateDir, source.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(space.Scratch, "data"), []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	ids := make(chan string, 4)
	errs := make(chan error, 4)
	for range 4 {
		wg.Go(func() {
			fork, e := svc.ForkThreadWithOptions(t.Context(), meta, source.ThreadID, ForkThreadRequest{ClientRequestID: "concurrent-copy"})
			if e != nil {
				errs <- e
			} else {
				ids <- fork.ThreadID
			}
		})
	}
	wg.Wait()
	close(errs)
	close(ids)
	for e := range errs {
		t.Fatal(e)
	}
	first := ""
	for id := range ids {
		if first != "" && first != id {
			t.Fatal("duplicate fork")
		}
		first = id
	}
	if first == "" {
		t.Fatal("no fork")
	}
	files, err := svc.GetTaskFiles(t.Context(), meta, first, "")
	if err != nil || files.WorkingFiles != 1 {
		t.Fatalf("unexpected files (including hidden provenance): %+v %v", files, err)
	}
}

func TestForkWorkingFilesDetectSourceMutation(t *testing.T) {
	state := t.TempDir()
	source, err := prepareTaskFiles(state, "source")
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(source.Scratch, "data")
	if err = os.WriteFile(file, []byte("before"), 0600); err != nil {
		t.Fatal(err)
	}
	src, err := os.OpenRoot(source.Root)
	if err != nil {
		t.Fatal(err)
	}
	defer src.Close()
	dst, err := os.OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer dst.Close()
	observed := map[string]os.FileInfo{}
	if err = copyTaskTree(t.Context(), src, dst, "scratch", observed); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(file, []byte("changed source bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	now, err := src.Lstat(filepath.Join("scratch", "data"))
	if err != nil {
		t.Fatal(err)
	}
	if sameTaskFile(observed[filepath.Join("scratch", "data")], now) {
		t.Fatal("source mutation accepted")
	}
}

func TestForkWorkingFilesRecoversPublishedCopyWithoutSource(t *testing.T) {
	state := t.TempDir()
	source, err := prepareTaskFiles(state, "source")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(source.Scratch, "data"), []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = inheritForkTaskFiles(t.Context(), state, "source", "target", "req", ""); err != nil {
		t.Fatal(err)
	}
	if err = os.RemoveAll(source.Root); err != nil {
		t.Fatal(err)
	}
	if err = inheritForkTaskFiles(t.Context(), state, "source", "target", "req", ""); err != nil {
		t.Fatal(err)
	}
	target, _ := taskFiles(state, "target")
	bytes, err := os.ReadFile(filepath.Join(target.Scratch, "data"))
	if err != nil || string(bytes) != "original" {
		t.Fatal("lost published copy", err)
	}
}

func TestForkWorkingFilesPreparationPreventsCleanup(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	source, err := svc.CreateThread(t.Context(), meta, "Source", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	release, err := svc.taskFiles.freeze(t.Context(), source.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if err = svc.CleanTaskFiles(t.Context(), meta, source.ThreadID); !errors.Is(err, ErrThreadBusy) {
		t.Fatalf("cleanup during fork: %v", err)
	}
	if err = svc.DeleteThread(t.Context(), meta, source.ThreadID, false); !errors.Is(err, ErrThreadBusy) {
		t.Fatalf("delete during fork: %v", err)
	}
}
