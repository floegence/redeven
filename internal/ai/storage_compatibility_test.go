package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"sync/atomic"
	"testing"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/threadreadstate"
)

func fixtureProductMeta() *session.Meta {
	return &session.Meta{EndpointID: "fixture_endpoint", UserPublicID: "fixture_user", NamespacePublicID: "fixture_namespace", ChannelID: "fixture_channel", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true}
}

func fixtureModelServer(t *testing.T, opts *Options) *atomic.Int32 {
	t.Helper()
	calls := new(atomic.Int32)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			return
		}
		model, _ := request["model"].(string)
		w.Header().Set("Content-Type", "text/event-stream")
		writeDeepSeekIntegrationTextResponseForModel(w, w.(http.Flusher), "upgrade_continuation", model, "A new turn after upgrading historical data.")
	}))
	t.Cleanup(server.Close)
	opts.Config = &config.AIConfig{CurrentModelID: "deepseek/deepseek-v4-flash", Providers: []config.AIProvider{{ID: "deepseek", Type: "deepseek", BaseURL: server.URL + "/v1", Models: []config.AIProviderModel{{ModelName: "deepseek-v4-flash"}, {ModelName: "deepseek-v4-pro"}}}}}
	opts.ResolveProviderAPIKey = func(string) (string, bool, error) { return "synthetic-test-key", true, nil }
	return calls
}

// Each distributed writer adds an immutable directory. Every one automatically
// participates in real product upgrade, continuation and second-start checks.
func TestFlowerEveryHistoricalWriterUpgradesAndContinues(t *testing.T) {
	entries, err := os.ReadDir(filepath.Join("testdata", "upgrade"))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		t.Run(entry.Name(), func(t *testing.T) {
			state, fixture := loadFlowerUpgradeFixture(t, entry.Name())
			opts := fixtureMaintenanceOptions(t, state)
			calls := fixtureModelServer(t, &opts)
			svc, err := NewServiceContext(t.Context(), opts)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = svc.Close() }()
			meta := fixtureProductMeta()
			if calls.Load() != 0 {
				t.Fatal("preparation executed a model")
			}
			reads, err := svc.ThreadReadState().EnsureFlower(t.Context(), meta.EndpointID, meta.UserPublicID, map[string]threadreadstate.FlowerSnapshot{fixture.ThreadIDs[0]: {ActivityRevision: 1000}})
			if err != nil || reads[fixture.ThreadIDs[0]].LastSeenActivityRevision != 1 {
				t.Fatalf("read state changed: %+v %v", reads, err)
			}
			model, err := svc.threadsDB.GetThreadSettings(t.Context(), meta.EndpointID, fixture.ThreadIDs[0])
			if err != nil || model.ModelID != "deepseek/deepseek-v4-pro" {
				t.Fatalf("model setting=%+v %v", model, err)
			}
			if fixture.ChildThreadID != "" {
				parent := identity.ThreadID(fixture.ParentThreadID)
				children, err := svc.threadRuntime.List(t.Context(), flruntime.ThreadScope{ParentID: &parent})
				if err != nil || len(children) != 1 || children[0].ID.String() != fixture.ChildThreadID || children[0].ParentTurnID == "" {
					t.Fatalf("child identity changed: %+v %v", children, err)
				}
				for _, id := range []string{fixture.CancelledThreadID, fixture.CrashedThreadID} {
					view, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(id))
					if err != nil || view.Activity != flruntime.ThreadActivityIdle || view.LastOutcome == nil {
						t.Fatalf("old execution not terminal: %+v %v", view, err)
					}
				}
			}
			if err := svc.Activate(t.Context()); err != nil {
				t.Fatal(err)
			}
			for _, id := range append(append([]string{}, fixture.ThreadIDs...), fixture.AttachmentForkID) {
				before, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(id))
				if err != nil || len(before.Items) == 0 {
					t.Fatalf("history=%+v %v", before, err)
				}
				sendAndWaitForModelSwitch(t, svc, meta, id, "Continue after a version upgrade: "+id, "")
				after, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(id))
				if err != nil || len(after.Items) <= len(before.Items) || !reflect.DeepEqual(after.Items[:len(before.Items)], before.Items) {
					t.Fatalf("historical items changed after continuation: %s %v", id, err)
				}
			}
			if calls.Load() == 0 {
				t.Fatal("continuation did not call the model")
			}
			operation, err := readFlowerUpgrade(state)
			if err != nil || !operation.Complete {
				t.Fatalf("upgrade incomplete: %+v %v", operation, err)
			}
			if err := svc.Close(); err != nil {
				t.Fatal(err)
			}
			svc, err = NewServiceContext(t.Context(), opts)
			if err != nil {
				t.Fatal(err)
			}
			second, err := readFlowerUpgrade(state)
			if err != nil || !reflect.DeepEqual(operation, second) {
				t.Fatalf("second start repeated upgrade: %+v %v", second, err)
			}
		})
	}
}

func TestFlowerRestoreLifecycleFixtureCannotResumeOldWork(t *testing.T) {
	state, fixture := loadFlowerUpgradeFixture(t, "10ce4c152-lifecycle")
	opts := fixtureMaintenanceOptions(t, state)
	calls := fixtureModelServer(t, &opts)
	svc, err := NewServiceContext(t.Context(), opts)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	op, err := readFlowerUpgrade(state)
	if err != nil {
		t.Fatal(err)
	}
	if err := RestoreFlowerSnapshot(t.Context(), opts, op.OriginalSnapshot); err != nil {
		t.Fatal(err)
	}
	svc, err = NewServiceContext(t.Context(), opts)
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	if err := svc.Activate(t.Context()); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{fixture.ApprovalThreadID, fixture.WaitingThreadID, fixture.CancelledThreadID, fixture.CrashedThreadID, fixture.ChildThreadID} {
		view, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(id))
		if err != nil || view.Activity != flruntime.ThreadActivityIdle || len(view.Queue) != 0 {
			t.Fatalf("old work resumed: %+v %v", view, err)
		}
		for _, interaction := range view.Interactions {
			if !interaction.Resolved {
				t.Fatalf("old interaction accepted: %+v", interaction)
			}
		}
	}
	if calls.Load() != 0 {
		t.Fatal("restoring executed old model/tool work")
	}
	_, err = svc.SendUserTurn(t.Context(), fixtureProductMeta(), SendUserTurnRequest{StorageGeneration: svc.StorageGeneration(), ClientRequestID: "new-after-restore", ThreadID: fixture.WaitingThreadID, Input: RunInput{Text: "Explicitly start a new task after restore."}})
	if err != nil {
		t.Fatal(err)
	}
	waitForAskUserIntegrationThread(t, svc, fixtureProductMeta(), fixture.WaitingThreadID, func(view *ThreadView) bool { return view.RunStatus == "success" })
}
