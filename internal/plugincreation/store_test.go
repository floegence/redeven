package plugincreation

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestConcurrentDraftRenameAndDeleteRequireCurrentRevision(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "drafts.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	owner := Owner{"alice", "env"}
	for index := range 30 {
		draft, err := s.Create(t.Context(), owner, fmt.Sprint(index))
		if err != nil {
			t.Fatal(err)
		}
		draft, err = s.Activate(t.Context(), owner, draft.ID, "workspace-"+draft.ID)
		if err != nil {
			t.Fatal(err)
		}
		start := make(chan struct{})
		results := make(chan error, 2)
		go func() {
			<-start
			_, err := s.Rename(t.Context(), owner, draft.ID, draft.Revision, "Renamed")
			results <- err
		}()
		go func() {
			<-start
			_, err := s.BeginDelete(t.Context(), owner, draft.ID, draft.Revision)
			results <- err
		}()
		close(start)
		first, second := <-results, <-results
		if (first == nil) == (second == nil) {
			t.Fatalf("exactly one stale-revision competitor must succeed: %v, %v", first, second)
		}
		if first != nil && !errors.Is(first, ErrConflict) || second != nil && !errors.Is(second, ErrConflict) {
			t.Fatalf("unexpected conflict result: %v, %v", first, second)
		}
	}
}

func TestDraftLifetimeOwnershipAndRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "drafts.sqlite")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	owner := Owner{"alice", "env"}
	other := Owner{"bob", "env"}
	d, err := s.Create(t.Context(), owner, "request-1")
	if err != nil {
		t.Fatal(err)
	}
	retry, err := s.Create(t.Context(), owner, "request-1")
	if err != nil || d.ID != retry.ID {
		t.Fatal(retry, err)
	}
	if _, err = s.Get(t.Context(), other, d.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	d, err = s.Activate(t.Context(), owner, d.ID, "workspace-1")
	if err != nil {
		t.Fatal(err)
	}
	d, err = s.FreezeLaunch(t.Context(), owner, d.ID, "launch-1", `{}`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.FreezeLaunch(t.Context(), owner, d.ID, "launch-2", `{}`); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	d, err = s.BindThread(t.Context(), owner, d.ID, "launch-1", "thread-1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.BindThread(t.Context(), owner, d.ID, "launch-1", "unrelated-thread"); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	loaded, err := s.ForThread(t.Context(), owner, "thread-1")
	if err != nil || loaded != d {
		t.Fatal(loaded, err)
	}
	if _, err = s.Rename(t.Context(), owner, d.ID, 1, "stale"); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	d, err = s.Rename(t.Context(), owner, d.ID, d.Revision, "Timer")
	if err != nil {
		t.Fatal(err)
	}
	d, err = s.BeginDelete(t.Context(), owner, d.ID, d.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.FreezeLaunch(t.Context(), owner, d.ID, "launch-1", `{}`); !errors.Is(err, ErrDeleting) {
		t.Fatal(err)
	}
	for _, stage := range []string{"thread", "workspace"} {
		d, err = s.AdvanceDelete(t.Context(), owner, d.ID, stage)
		if err != nil {
			t.Fatal(err)
		}
	}
	retry, err = s.Create(t.Context(), owner, "request-1")
	if err != nil || retry.Lifecycle != "deleted" {
		t.Fatal(retry, err)
	}
	list, err := s.List(t.Context(), owner)
	if err != nil || len(list) != 0 {
		t.Fatal(list, err)
	}
}
func TestConcurrentDraftRequestsHaveOneIdentity(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "drafts.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	owner := Owner{"alice", "env"}
	var wg sync.WaitGroup
	ids := make(chan string, 12)
	for range 12 {
		wg.Go(func() {
			d, e := s.Create(t.Context(), owner, "same")
			if e != nil {
				t.Error(e)
				return
			}
			ids <- d.ID
		})
	}
	wg.Wait()
	close(ids)
	var first string
	for id := range ids {
		if first != "" && first != id {
			t.Fatal("duplicate draft")
		}
		first = id
	}
}
func TestUnknownDraftSchemaRemainsUnchanged(t *testing.T) {
	path := filepath.Join(t.TempDir(), "drafts.sqlite")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`CREATE TABLE unexpected (id TEXT)`); err != nil {
		t.Fatal(err)
	}
	s.Close()
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if opened, err := Open(path); err == nil {
		opened.Close()
		t.Fatal("accepted drift")
	}
	after, err := os.ReadFile(path)
	if err != nil || string(before) != string(after) {
		t.Fatal("rejected schema changed", err)
	}
}

func TestDeleteFreezesUnboundLaunchAndRetainsExactRecovery(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "drafts.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	o := Owner{"alice", "env"}
	d, err := s.Create(t.Context(), o, "create")
	if err != nil {
		t.Fatal(err)
	}
	d, err = s.Activate(t.Context(), o, d.ID, "workspace")
	if err != nil {
		t.Fatal(err)
	}
	prior := d.Revision
	d, err = s.FreezeLaunch(t.Context(), o, d.ID, "launch", `{"client_request_id":"launch"}`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.BeginDelete(t.Context(), o, d.ID, prior); !errors.Is(err, ErrConflict) {
		t.Fatal("stale deletion admitted", err)
	}
	d, err = s.BeginDelete(t.Context(), o, d.ID, d.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.FreezeLaunch(t.Context(), o, d.ID, "second", `{}`); !errors.Is(err, ErrDeleting) {
		t.Fatal(err)
	}
	d, err = s.BindThread(t.Context(), o, d.ID, "launch", "canonical-thread")
	if err != nil {
		t.Fatal(err)
	}
	if d.Lifecycle != "deleting" || d.LaunchSnapshot != `{"client_request_id":"launch"}` {
		t.Fatal(d)
	}
}

func TestInstallReferenceKeepsInstanceAcrossFailedUpdate(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "drafts.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := t.Context()
	owner := Owner{"alice", "env"}
	d, err := s.Create(ctx, owner, "draft")
	if err != nil {
		t.Fatal(err)
	}
	d, err = s.Activate(ctx, owner, d.ID, "workspace")
	if err != nil {
		t.Fatal(err)
	}
	revision := d.Revision
	d, err = s.BindInstall(ctx, owner, d.ID, revision, "first", "artifact", "review")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.BindInstall(ctx, owner, d.ID, revision, "other-tab", "artifact", "review"); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale tab replaced operation: %v", err)
	}
	d, err = s.RecordInstalled(ctx, owner, d.ID, "first", "installed-instance")
	if err != nil {
		t.Fatal(err)
	}
	d, err = s.BindInstall(ctx, owner, d.ID, d.Revision, "update", "artifact2", "review2")
	if err != nil {
		t.Fatal(err)
	}
	if d.InstalledPluginID != "installed-instance" {
		t.Fatal("lost original installation")
	}
	if _, err = s.RecordInstalled(ctx, owner, d.ID, "first", "wrong"); !errors.Is(err, ErrConflict) {
		t.Fatal("late result replaced association")
	}
}
