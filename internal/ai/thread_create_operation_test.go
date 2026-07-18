package ai

import (
	"context"
	"path/filepath"
	"testing"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

func TestServiceResumesThreadCreateFromEveryCanonicalBoundary(t *testing.T) {
	for _, testCase := range []struct {
		name         string
		ensureFloret bool
		setTitle     bool
	}{
		{name: "after_intent_persisted"},
		{name: "after_floret_ensure", ensureFloret: true},
		{name: "after_canonical_title", ensureFloret: true, setTitle: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			ctx := context.Background()
			db, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = db.Close() })
			floretStore := flruntime.NewMemoryStore()
			t.Cleanup(func() { _ = floretStore.Close() })
			service := &Service{threadsDB: db, floretStore: floretStore}
			settings := threadstore.ThreadSettings{
				ThreadID: "thread_" + testCase.name, EndpointID: "env_create", ModelID: "openai/gpt-5",
				PermissionType: "approval_required", CreatedAtUnixMs: 100, UpdatedAtUnixMs: 100,
			}
			operation, err := db.PrepareThreadCreateOperation(ctx, threadstore.PrepareThreadCreateRequest{
				Settings: settings, ExplicitTitle: "Canonical title", CreatedAtMS: 100,
			})
			if err != nil {
				t.Fatal(err)
			}
			host, err := flruntime.NewThreadMaintenanceHost(flruntime.ThreadMaintenanceHostOptions{Store: floretStore})
			if err != nil {
				t.Fatal(err)
			}
			if testCase.ensureFloret {
				if _, err := host.EnsureThread(ctx, flruntime.EnsureThreadRequest{ThreadID: flruntime.ThreadID(settings.ThreadID)}); err != nil {
					t.Fatal(err)
				}
				operation, err = db.ConfirmThreadCreateFloretEnsured(ctx, operation.OperationID)
				if err != nil {
					t.Fatal(err)
				}
			}
			if testCase.setTitle {
				if _, err := host.SetThreadTitle(ctx, flruntime.SetThreadTitleRequest{ThreadID: flruntime.ThreadID(settings.ThreadID), Title: "Canonical title"}); err != nil {
					t.Fatal(err)
				}
				operation, err = db.ConfirmThreadCreateTitleSet(ctx, operation.OperationID)
				if err != nil {
					t.Fatal(err)
				}
			}

			committed, err := service.resumeThreadCreateOperation(ctx, operation)
			if err != nil {
				t.Fatal(err)
			}
			if committed.ThreadID != settings.ThreadID {
				t.Fatalf("committed settings=%#v", committed)
			}
			overview, err := host.ReadThreadOverview(ctx, flruntime.ThreadID(settings.ThreadID))
			if err != nil {
				t.Fatal(err)
			}
			if overview.Thread.Title != "Canonical title" {
				t.Fatalf("canonical title=%q", overview.Thread.Title)
			}
			loaded, err := db.GetThread(ctx, settings.EndpointID, settings.ThreadID)
			if err != nil || loaded == nil {
				t.Fatalf("settings=%#v err=%v", loaded, err)
			}
		})
	}
}
