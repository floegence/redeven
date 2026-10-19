package ai

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

// Exact published writers produced these synthetic databases. Only copies are
// opened; product setup writes its own settings and never decodes Floret state.
func TestFlowerReleasedCompactionWritersUpgradeAndContinue(t *testing.T) {
	roots, err := filepath.Glob(filepath.Join("testdata", "compaction-v*"))
	if err != nil || len(roots) < 2 {
		t.Fatalf("released compaction fixtures missing: %v", err)
	}
	for _, root := range roots {
		t.Run(filepath.Base(root), func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join(root, "manifest.json"))
			if err != nil {
				t.Fatal(err)
			}
			var manifest struct{ Files map[string]string }
			if err := json.Unmarshal(raw, &manifest); err != nil {
				t.Fatal(err)
			}
			for name, expected := range manifest.Files {
				data, err := os.ReadFile(filepath.Join(root, name))
				if err != nil {
					t.Fatal(err)
				}
				sum := sha256.Sum256(data)
				if hex.EncodeToString(sum[:]) != expected {
					t.Fatalf("released writer fixture changed: %s", name)
				}
			}
			state := t.TempDir()
			if err := os.MkdirAll(filepath.Join(state, "ai"), 0700); err != nil {
				t.Fatal(err)
			}
			if err := copyTargetThreadFile(filepath.Join(root, "history.sqlite"), filepath.Join(state, "ai", "floret_threads.sqlite")); err != nil {
				t.Fatal(err)
			}
			opts := fixtureMaintenanceOptions(t, state)
			calls := fixtureModelServer(t, &opts)
			meta := fixtureProductMeta()
			settings, err := threadstore.Open(filepath.Join(state, "ai", "threads.sqlite"))
			if err != nil {
				t.Fatal(err)
			}
			for _, id := range []string{"thread", "fork", "nested"} {
				if err := settings.CreateThreadSettings(t.Context(), threadstore.ThreadSettings{ThreadID: id, EndpointID: meta.EndpointID, NamespacePublicID: meta.NamespacePublicID, ModelID: "deepseek/deepseek-v4-flash", PermissionType: "full_access", WorkingDir: opts.AgentHomeDir}); err != nil {
					t.Fatal(err)
				}
			}
			if err := settings.Close(); err != nil {
				t.Fatal(err)
			}
			for restart := range 2 {
				previousCalls := calls.Load()
				svc, err := NewServiceContext(t.Context(), opts)
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = svc.Close() })
				if err := svc.Activate(t.Context()); err != nil {
					t.Fatal(err)
				}
				if calls.Load() != previousCalls {
					t.Fatal("startup replayed historical work")
				}
				for _, id := range []string{"thread", "fork", "nested"} {
					before, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(id))
					if err != nil || len(before.Items) == 0 {
						t.Fatalf("history unavailable: %s %v", id, err)
					}
					detail, err := svc.GetFlowerThreadDetail(t.Context(), meta, id)
					if err != nil || len(detail.Thread.ContextCompactions) != 2 {
						t.Fatalf("historical compaction display unavailable: %s %v", id, err)
					}
					accepted, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{StorageGeneration: svc.StorageGeneration(), ClientRequestID: fmt.Sprintf("history-%d-%s", restart, id), ThreadID: id, Input: RunInput{Text: "Explicitly continue this historical conversation after restart."}})
					if err != nil {
						t.Fatal(err)
					}
					waitForAskUserIntegrationThread(t, svc, meta, id, func(view *ThreadView) bool { return view.RunStatus == "success" })
					after, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(id))
					if err != nil || string(after.TurnID) != accepted.TurnID || after.Failure != nil || after.LastOutcome == nil || *after.LastOutcome != flruntime.TurnOutcomeCompleted || len(after.Items) <= len(before.Items) || !reflect.DeepEqual(before.Items, after.Items[:len(before.Items)]) {
						t.Fatalf("historical continuation changed facts or failed: %s %v", id, err)
					}
				}
				if calls.Load() <= previousCalls {
					t.Fatal("explicit continuation did not reach provider")
				}
				if err := svc.Close(); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}
