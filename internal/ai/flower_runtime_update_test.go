package ai

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/floegence/floret/v7/identity"
	"github.com/floegence/redeven/internal/config"
	"strings"
	"sync"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
)

func TestFlowerUpdateUsesSnapshotPublicItemProjection(t *testing.T) {
	item := flruntime.ThreadItem{ID: "user", TurnID: "turn", RunID: "run", Kind: flruntime.ThreadItemUser, Attachments: []flruntime.MessageAttachment{{ResourceRef: "private-resource", Name: "file"}}, References: []flruntime.MessageReference{{Kind: flruntime.MessageReferenceFile, Text: "private-file-body", ResourceRef: "private-authority"}}}
	current := flruntime.ThreadView{ThreadID: "thread", ViewVersion: 2, Items: []flruntime.ThreadItem{item}}
	snapshot, err := flowerCurrentJSONAt(current, time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	update, err := flowerUpdateJSONAt(flruntime.ThreadUpdate{ThreadID: current.ThreadID, BaseVersion: 1, ViewVersion: 2, Items: []flruntime.ThreadItemChange{{Kind: flruntime.ThreadItemAdded, ItemID: item.ID, Item: &item}}}, time.Time{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	var full struct {
		Items []json.RawMessage `json:"items"`
	}
	var delta struct {
		Items []struct {
			Item json.RawMessage `json:"item"`
		} `json:"items"`
	}
	if err := json.Unmarshal(snapshot, &full); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(update, &delta); err != nil {
		t.Fatal(err)
	}
	if len(delta.Items) != 1 || string(full.Items[0]) != string(delta.Items[0].Item) {
		t.Fatalf("snapshot and update item projections differ: %s / %s", snapshot, update)
	}
	for _, private := range []string{"private-resource", "private-file-body", "private-authority"} {
		if strings.Contains(string(update), private) {
			t.Fatalf("update leaks %s", private)
		}
	}
}

func TestFlowerAppendProjectionHasNoHistoricalDependency(t *testing.T) {
	update := flruntime.ThreadUpdate{ThreadID: "thread", BaseVersion: 1, ViewVersion: 2, Items: []flruntime.ThreadItemChange{{Kind: flruntime.ThreadItemAppended, ItemID: "answer", Append: &flruntime.ThreadTextAppend{OffsetBytes: 6, Text: "新增"}}}}
	data, err := flowerUpdateJSONAt(update, time.Time{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"offset_bytes":6`) || !strings.Contains(string(data), "新增") || strings.Contains(string(data), `"current"`) {
		t.Fatalf("append must contain only its explicit mutation: %s", data)
	}
}

func TestFlowerUpdateEvidenceUsesCurrentSameThreadFacts(t *testing.T) {
	view, interaction := computerEvidenceFixture()
	view.ViewVersion = 4
	update := flruntime.ThreadUpdate{ThreadID: view.ThreadID, BaseVersion: 1, ViewVersion: 2,
		Interactions: &flruntime.ThreadComponent[[]flruntime.ThreadInteraction]{Value: []flruntime.ThreadInteraction{interaction}}}
	for _, variant := range []string{"newer", "superseded", "wrong-thread", "older"} {
		t.Run(variant, func(t *testing.T) {
			evidence := view
			switch variant {
			case "wrong-thread":
				evidence.ThreadID = "other-thread"
			case "older":
				evidence.ViewVersion = 1
			case "superseded":
				next := evidence.Items[0]
				next.ID = "later-observation"
				evidence.Items = append(append([]flruntime.ThreadItem(nil), evidence.Items...), next)
			}
			raw, err := flowerUpdateJSONAt(update, time.Time{}, &evidence)
			if variant == "wrong-thread" || variant == "older" {
				if err == nil {
					t.Fatal("invalid evidence admitted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			hasAssistance := strings.Contains(string(raw), `"computer_assistance"`)
			if hasAssistance != (variant == "newer") {
				t.Fatalf("assistance=%v: %s", hasAssistance, raw)
			}
		})
	}
}

type flowerRecoveryRuntime struct {
	flruntime.ThreadService
	mu            sync.Mutex
	subscriptions []*flruntime.ThreadUpdateSubscription
	views         int
}

func (r *flowerRecoveryRuntime) SubscribeUpdates(ctx context.Context) (*flruntime.ThreadUpdateSubscription, error) {
	sub, err := r.ThreadService.(flruntime.ThreadUpdateSource).SubscribeUpdates(ctx)
	if err == nil {
		r.mu.Lock()
		r.subscriptions = append(r.subscriptions, sub)
		r.mu.Unlock()
	}
	return sub, err
}
func (r *flowerRecoveryRuntime) Summary(ctx context.Context, id identity.ThreadID) (flruntime.ThreadSummary, error) {
	return r.ThreadService.(flruntime.ThreadSummaryReader).Summary(ctx, id)
}
func (r *flowerRecoveryRuntime) View(ctx context.Context, id identity.ThreadID) (flruntime.ThreadView, error) {
	r.mu.Lock()
	r.views++
	r.mu.Unlock()
	return r.ThreadService.View(ctx, id)
}
func TestFlowerRuntimePumpRebindsAndReconcilesMissedCleanupWithoutViews(t *testing.T) {
	service, err := NewServiceContext(t.Context(), Options{StateDir: t.TempDir(), AgentHomeDir: t.TempDir(), Shell: "/bin/sh", DeferExecution: true, Config: &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Type: "openai", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	source := &flowerRecoveryRuntime{ThreadService: service.threadRuntime}
	service.threadRuntime = source
	thread, err := service.CreateThread(t.Context(), testSendTurnMeta(), "Recovery", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if err = service.Activate(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = service.startFlowerRuntimeViewPump(); err == nil {
		t.Fatal("duplicate runtime pump admitted")
	}
	sub, err := service.SubscribeFlowerLiveStream(t.Context(), testSendTurnMeta(), FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer sub.Close()
	nextFlowerLiveStreamFrame(t, sub)
	assertFlowerViewerReadBaseline(t, sub, thread.ThreadID)
	stopped := make(chan struct{})
	released := make(chan struct{})
	service.accountMu.Lock()
	if service.accountTasks == nil {
		service.accountTasks = map[string]accountTaskWatch{}
	}
	service.accountTasks[thread.ThreadID] = accountTaskWatch{turnID: "retired-turn", stop: sync.OnceFunc(func() { close(stopped) })}
	service.accountMu.Unlock()
	service.workloadMu.Lock()
	service.workloadLeases["missed-terminal"] = &aiWorkloadLease{threadID: thread.ThreadID, accepted: true, release: sync.OnceFunc(func() { close(released) })}
	service.workloadMu.Unlock()
	source.mu.Lock()
	source.views = 0
	first := source.subscriptions[0]
	source.mu.Unlock()
	first.Close()
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("rebound pump retained account watch")
	}
	select {
	case <-released:
	case <-time.After(time.Second):
		t.Fatal("rebound pump retained workload lease")
	}
	deadline := time.Now().Add(time.Second)
	for {
		service.mu.Lock()
		unavailable := service.flowerRuntimeUpdatesUnavailable
		service.mu.Unlock()
		source.mu.Lock()
		count, views := len(source.subscriptions), source.views
		source.mu.Unlock()
		if count >= 2 && !unavailable {
			if views != 0 {
				t.Fatalf("cleanup recovery requested %d full views", views)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("service subscription did not recover")
		}
		time.Sleep(time.Millisecond)
	}
	if frame, err := sub.Next(t.Context()); frame != nil || !errors.Is(err, ErrFlowerLiveSync) {
		t.Fatalf("old stream remains usable: frame=%v error=%v", frame, err)
	}
	reconnected, err := service.SubscribeFlowerLiveStream(t.Context(), testSendTurnMeta(), FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer reconnected.Close()
	nextFlowerLiveStreamFrame(t, reconnected)
}

func TestFlowerRuntimeWithoutObserversDoesNotRequestPresentationEvidence(t *testing.T) {
	service := newSendTurnTestService(t)
	source := &flowerRecoveryRuntime{ThreadService: service.threadRuntime}
	service.threadRuntime = source
	service.broadcastFlowerRuntimeUpdate("endpoint", "", flruntime.ThreadUpdate{ThreadID: "thread", BaseVersion: 1, ViewVersion: 2,
		Interactions: &flruntime.ThreadComponent[[]flruntime.ThreadInteraction]{Value: []flruntime.ThreadInteraction{{Kind: flruntime.ThreadInteractionInput}}}})
	source.mu.Lock()
	defer source.mu.Unlock()
	if source.views != 0 {
		t.Fatal("unobserved update requested full evidence")
	}
}
