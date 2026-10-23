package ai

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

type startupFailureRuntime struct {
	flruntime.ThreadService
	listErr error
	viewErr error
}

func (runtime startupFailureRuntime) List(context.Context, flruntime.ThreadScope) ([]flruntime.ThreadSummary, error) {
	return nil, runtime.listErr
}

func (runtime startupFailureRuntime) Summary(context.Context, identity.ThreadID) (flruntime.ThreadSummary, error) {
	return flruntime.ThreadSummary{Activity: flruntime.ThreadActivityIdle, QueueCount: 1}, nil
}

func (runtime startupFailureRuntime) View(context.Context, identity.ThreadID) (flruntime.ThreadView, error) {
	return flruntime.ThreadView{}, runtime.viewErr
}

func TestStartupPreparationRetainsFailuresIndependentlyOfLogging(t *testing.T) {
	for _, stage := range []string{"ownership", "pending_input"} {
		for _, withLogger := range []bool{false, true} {
			for _, failure := range []error{errors.New("injected recovery failure"), context.Canceled} {
				t.Run(stage+"/"+failure.Error()+"/logger="+map[bool]string{false: "false", true: "true"}[withLogger], func(t *testing.T) {
					db, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
					if err != nil {
						t.Fatal(err)
					}
					defer db.Close()
					runtime := startupFailureRuntime{}
					if stage == "ownership" {
						runtime.listErr = failure
					} else {
						runtime.viewErr = failure
					}
					if stage == "pending_input" {
						if err := db.CreateThreadSettings(t.Context(), threadstore.ThreadSettings{ThreadID: "queued", EndpointID: "endpoint", NamespacePublicID: "namespace", PermissionType: "readonly"}); err != nil {
							t.Fatal(err)
						}
					}
					service := &Service{lifecycleCtx: t.Context(), threadsDB: db, threadRuntime: runtime}
					service.floretThreadMediaInventory = func(context.Context, identity.ThreadID) (flruntime.MediaInventory, error) {
						return flruntime.MediaInventory{}, nil
					}
					if withLogger {
						service.log = slog.New(slog.NewTextHandler(io.Discard, nil))
					}
					ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
					defer cancel()
					if err := service.waitForStartupPreparation(ctx); !errors.Is(err, failure) {
						t.Fatalf("startup error = %v, want %v", err, failure)
					}
					service.serviceWorkers.Wait()
					if service.startupPreparationReady || service.startupPreparationRun {
						t.Fatal("failed preparation reported ready or remained running")
					}
				})
			}
		}
	}
}

// A corrupt first page must not starve later pages or allow cleanup readiness.
func TestStartupPreparationIsolatesThreadFailuresAcrossPages(t *testing.T) {
	db, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for index := 0; index < 205; index++ {
		if err := db.CreateThreadSettings(t.Context(), threadstore.ThreadSettings{ThreadID: fmt.Sprintf("thread-%03d", index), EndpointID: "endpoint", NamespacePublicID: "namespace", PermissionType: "readonly"}); err != nil {
			t.Fatal(err)
		}
	}
	failure := errors.New("corrupt first thread")
	visited := map[identity.ThreadID]bool{}
	service := &Service{threadsDB: db, threadRuntime: startupFailureRuntime{}}
	service.floretThreadMediaInventory = func(ctx context.Context, id identity.ThreadID) (flruntime.MediaInventory, error) {
		visited[id] = true
		if id == "thread-000" {
			return flruntime.MediaInventory{}, failure
		}
		return flruntime.MediaInventory{}, flruntime.ErrThreadDeleted
	}
	if err := service.prepareStartupThreads(t.Context()); !errors.Is(err, failure) {
		t.Fatalf("preparation = %v", err)
	}
	if len(visited) != 205 {
		t.Fatalf("visited %d threads, want 205", len(visited))
	}
}

func TestStartupPreparationRetriesAfterTransientFailure(t *testing.T) {
	db, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := db.CreateThreadSettings(t.Context(), threadstore.ThreadSettings{ThreadID: "recovering", EndpointID: "endpoint", NamespacePublicID: "namespace", PermissionType: "readonly"}); err != nil {
		t.Fatal(err)
	}
	failure := errors.New("temporary inventory failure")
	var calls atomic.Int32
	service := &Service{lifecycleCtx: t.Context(), threadsDB: db, threadRuntime: startupFailureRuntime{}}
	service.floretThreadMediaInventory = func(context.Context, identity.ThreadID) (flruntime.MediaInventory, error) {
		if calls.Add(1) == 1 {
			return flruntime.MediaInventory{}, failure
		}
		return flruntime.MediaInventory{}, flruntime.ErrThreadDeleted
	}
	if err := service.waitForStartupPreparation(t.Context()); !errors.Is(err, failure) {
		t.Fatalf("first preparation = %v", err)
	}
	if err := service.waitForStartupPreparation(t.Context()); err != nil {
		t.Fatalf("retried preparation = %v", err)
	}
	service.serviceWorkers.Wait()
	if calls.Load() != 2 || !service.startupPreparationReady {
		t.Fatalf("calls=%d ready=%v", calls.Load(), service.startupPreparationReady)
	}
}
