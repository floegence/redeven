package portforward

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/portforward/registry"
)

func TestService_MissingForwardReturnsSharedNotFound(t *testing.T) {
	t.Parallel()

	reg, err := registry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatalf("registry.Open: %v", err)
	}
	t.Cleanup(func() { _ = reg.Close() })

	svc, err := New(reg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ctx := context.Background()
	name := "missing"
	if _, err := svc.UpdateForward(ctx, "missing", UpdateForwardRequest{Name: &name}); !errors.Is(err, ErrForwardNotFound) {
		t.Fatalf("UpdateForward error = %v, want ErrForwardNotFound", err)
	}
	if _, err := svc.TouchLastOpened(ctx, "missing"); !errors.Is(err, ErrForwardNotFound) {
		t.Fatalf("TouchLastOpened error = %v, want ErrForwardNotFound", err)
	}
	if err := svc.DeleteForward(ctx, "missing"); !errors.Is(err, ErrForwardNotFound) {
		t.Fatalf("DeleteForward error = %v, want ErrForwardNotFound", err)
	}
}

func newTestService(t *testing.T) *Service {
	t.Helper()
	reg, err := registry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatalf("registry.Open: %v", err)
	}
	t.Cleanup(func() { _ = reg.Close() })
	svc, err := New(reg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return svc
}

func TestService_OpenForwardSessionNormalizesPortAndDeepLinkWithoutPersisting(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)

	opened, err := svc.OpenForwardSession(context.Background(), OpenForwardSessionRequest{Target: "3000/dashboard?q=active#jobs"})
	if err != nil {
		t.Fatalf("OpenForwardSession: %v", err)
	}
	if opened.Forward.TargetURL != "http://localhost:3000" {
		t.Fatalf("TargetURL = %q", opened.Forward.TargetURL)
	}
	if opened.AppPath != "/dashboard?q=active#jobs" {
		t.Fatalf("AppPath = %q", opened.AppPath)
	}
	if !opened.Ephemeral {
		t.Fatal("session must be ephemeral")
	}
	forwards, err := svc.ListForwards(context.Background())
	if err != nil {
		t.Fatalf("ListForwards: %v", err)
	}
	if len(forwards) != 0 {
		t.Fatalf("temporary session persisted %d forwards", len(forwards))
	}
	if resolved, err := svc.GetForward(context.Background(), opened.Forward.ForwardID); err != nil || resolved == nil {
		t.Fatalf("GetForward ephemeral = %#v, %v", resolved, err)
	}
}

func TestService_OpenForwardSessionReusesSavedOriginAndPreservesNavigation(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)
	created, err := svc.CreateForward(context.Background(), CreateForwardRequest{Target: "localhost:4173", Name: "Preview"})
	if err != nil {
		t.Fatalf("CreateForward: %v", err)
	}

	opened, err := svc.OpenForwardSession(context.Background(), OpenForwardSessionRequest{Target: "http://localhost:4173/docs/start"})
	if err != nil {
		t.Fatalf("OpenForwardSession: %v", err)
	}
	if opened.Ephemeral || opened.Forward.ForwardID != created.ForwardID {
		t.Fatalf("opened = %#v, want saved forward %q", opened, created.ForwardID)
	}
	if opened.AppPath != "/docs/start" {
		t.Fatalf("AppPath = %q", opened.AppPath)
	}
}

func TestService_SaveForwardSessionKeepsIDAndPersistsMetadata(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)
	opened, err := svc.OpenForwardSession(context.Background(), OpenForwardSessionRequest{Target: ":8080"})
	if err != nil {
		t.Fatalf("OpenForwardSession: %v", err)
	}

	saved, err := svc.SaveForwardSession(context.Background(), opened.Forward.ForwardID, SaveForwardSessionRequest{Name: "Admin", Description: "Local admin UI"})
	if err != nil {
		t.Fatalf("SaveForwardSession: %v", err)
	}
	if saved.ForwardID != opened.Forward.ForwardID || saved.Name != "Admin" || saved.Description != "Local admin UI" {
		t.Fatalf("saved = %#v", saved)
	}
	forwards, err := svc.ListForwards(context.Background())
	if err != nil {
		t.Fatalf("ListForwards: %v", err)
	}
	if len(forwards) != 1 || forwards[0].ForwardID != opened.Forward.ForwardID {
		t.Fatalf("forwards = %#v", forwards)
	}
}

func TestService_EphemeralForwardExpiresClosed(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)
	now := time.Unix(1000, 0)
	svc.now = func() time.Time { return now }
	opened, err := svc.OpenForwardSession(context.Background(), OpenForwardSessionRequest{Target: "localhost:9000"})
	if err != nil {
		t.Fatalf("OpenForwardSession: %v", err)
	}
	now = now.Add(ephemeralForwardTTL + time.Second)
	resolved, err := svc.GetForward(context.Background(), opened.Forward.ForwardID)
	if err != nil {
		t.Fatalf("GetForward: %v", err)
	}
	if resolved != nil {
		t.Fatalf("expired forward = %#v", resolved)
	}
}

func TestService_OpenForwardSessionSkipsPersistentAndEphemeralIDCollisions(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)
	created, err := svc.CreateForward(context.Background(), CreateForwardRequest{Target: "localhost:4173", Name: "Saved"})
	if err != nil {
		t.Fatalf("CreateForward: %v", err)
	}

	ids := []string{created.ForwardID, "temporary-id", "unique-id"}
	svc.newForwardID = func() string {
		id := ids[0]
		ids = ids[1:]
		return id
	}
	first, err := svc.OpenForwardSession(context.Background(), OpenForwardSessionRequest{Target: "localhost:5000"})
	if err != nil {
		t.Fatalf("OpenForwardSession first: %v", err)
	}
	if first.Forward.ForwardID != "temporary-id" {
		t.Fatalf("first ForwardID = %q", first.Forward.ForwardID)
	}
	second, err := svc.OpenForwardSession(context.Background(), OpenForwardSessionRequest{Target: "localhost:6000"})
	if err != nil {
		t.Fatalf("OpenForwardSession second: %v", err)
	}
	if second.Forward.ForwardID != "unique-id" {
		t.Fatalf("second ForwardID = %q", second.Forward.ForwardID)
	}
}

func TestService_SaveForwardSessionKeepsConcurrentReadsResolvable(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)
	opened, err := svc.OpenForwardSession(context.Background(), OpenForwardSessionRequest{Target: "localhost:7000"})
	if err != nil {
		t.Fatalf("OpenForwardSession: %v", err)
	}

	const readers = 24
	start := make(chan struct{})
	errCh := make(chan error, readers+1)
	var wg sync.WaitGroup
	for range readers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			resolved, err := svc.GetForward(context.Background(), opened.Forward.ForwardID)
			if err != nil {
				errCh <- err
				return
			}
			if resolved == nil {
				errCh <- errors.New("concurrent read lost forward authority")
			}
		}()
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		<-start
		_, err := svc.SaveForwardSession(context.Background(), opened.Forward.ForwardID, SaveForwardSessionRequest{Name: "Concurrent"})
		if err != nil {
			errCh <- err
		}
	}()
	close(start)
	wg.Wait()
	close(errCh)
	for err := range errCh {
		t.Fatal(err)
	}
}
