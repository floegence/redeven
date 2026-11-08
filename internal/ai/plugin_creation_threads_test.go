package ai

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"slices"
	"testing"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/plugincreation"
)

// Product-owned thread rows may outlive or predate a running author backend.
// Membership comes from durable ownership, never title, cwd or availability.
func TestPluginDraftThreadInventoryPaginationAndLiveSummaries(t *testing.T) {
	svc := newSendTurnTestServiceWithActivation(t, true)
	meta := testSendTurnMeta()
	store, err := plugincreation.Open(filepath.Join(t.TempDir(), "drafts.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	svc.pluginCreation = plugincreation.New(store)
	owner, _ := plugincreation.OwnerFromSession(meta)
	ordinary := []string{}
	for index := range 3 {
		thread, err := svc.CreateThread(t.Context(), meta, "Plugin creation workspace", "", "", "")
		if err != nil {
			t.Fatal(err)
		}
		ordinary = append(ordinary, thread.ThreadID)
		if _, err := svc.threadsDB.SetThreadPinned(t.Context(), meta.EndpointID, thread.ThreadID, true); err != nil {
			t.Fatal(err)
		}
		// More than a complete storage page of hidden projects between public rows.
		for hidden := range 205 {
			id := fmt.Sprintf("managed-%d-%d", index, hidden)
			draft, err := store.Create(t.Context(), owner, id)
			if err != nil {
				t.Fatal(err)
			}
			draft, err = store.Activate(t.Context(), owner, draft.ID, id)
			if err != nil {
				t.Fatal(err)
			}
			draft, err = store.FreezeLaunch(t.Context(), owner, draft.ID, id, `{}`)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = store.BindThread(t.Context(), owner, draft.ID, id, id); err != nil {
				t.Fatal(err)
			}
			settings, err := svc.threadsDB.GetThreadSettings(t.Context(), meta.EndpointID, thread.ThreadID)
			if err != nil {
				t.Fatal(err)
			}
			settings.ThreadID = id
			settings.PinnedAtUnixMs = 0
			settings.PinRank = 0
			if err := svc.threadsDB.CreateThreadSettings(t.Context(), *settings); err != nil {
				t.Fatal(err)
			}
			if _, err := svc.threadsDB.SetThreadPinned(t.Context(), meta.EndpointID, id, true); err != nil {
				t.Fatal(err)
			}
		}
	}
	cursor := ""
	for index, expected := range ordinary {
		result, err := svc.ListThreads(t.Context(), meta, 1, cursor)
		if err != nil || len(result.Threads) != 1 || result.Threads[0].ThreadID != expected {
			t.Fatalf("page %d: %+v %v", index, result, err)
		}
		if (result.NextCursor == "") != (index == len(ordinary)-1) {
			t.Fatal("incorrect visible pagination")
		}
		cursor = result.NextCursor
	}
	sub, err := svc.SubscribeFlowerLiveStream(t.Context(), meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer sub.Close()
	if !slices.Equal(sub.subscriber.baselineThreadIDs, ordinary) {
		t.Fatal("managed project entered frozen live membership")
	}
	for {
		envelope := flowerBackpressureEnvelope(t, sub)
		for _, summary := range envelope.Summaries {
			if !slices.Contains(ordinary, summary.ThreadID) {
				t.Fatal("managed project entered live baseline")
			}
		}
		if envelope.BaselineComplete != nil && *envelope.BaselineComplete {
			break
		}
	}
	if err := svc.publishCanonicalThreadSummary(t.Context(), meta.EndpointID, "managed-2-204"); err != nil {
		t.Fatal(err)
	}
	if err := svc.publishCanonicalThreadSummary(t.Context(), meta.EndpointID, ordinary[0]); err != nil {
		t.Fatal(err)
	}
	for {
		envelope := flowerBackpressureEnvelope(t, sub)
		if envelope.Kind == FlowerLiveStreamSummaryBatch {
			if len(envelope.Summaries) != 1 || envelope.Summaries[0].ThreadID != ordinary[0] {
				t.Fatal("managed live summary leaked")
			}
			break
		}
	}
	// Canonical content delivery stays independent of sidebar membership.
	managed := identity.ThreadID("managed-2-204")
	svc.broadcastFlowerRuntimeUpdate(meta.EndpointID, "", flruntime.ThreadUpdate{ThreadID: managed, BaseVersion: 1, ViewVersion: 2, Facts: flruntime.ThreadRuntimeFacts{Activity: flruntime.ThreadActivityIdle}})
	envelope := flowerBackpressureEnvelope(t, sub)
	if envelope.Kind != FlowerLiveStreamThreadBatch || envelope.ThreadID != managed.String() {
		t.Fatalf("dedicated live facts lost: %+v", envelope)
	}
	// A store failure cannot silently expose private project inventory.
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ListThreads(t.Context(), meta, 25, ""); err == nil {
		t.Fatal("unavailable ownership store exposed conversations")
	}
}

func TestPluginDraftOwnershipIsBoundBeforeSettingsPublication(t *testing.T) {
	svc := newWorkingDirTestService(t, t.TempDir())
	store, err := plugincreation.Open(filepath.Join(t.TempDir(), "drafts.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	product := plugincreation.New(store)
	product.SetBackend(pluginScopeBackend{root})
	svc.pluginCreation = product
	meta := workingDirTestMeta()
	owner, _ := plugincreation.OwnerFromSession(meta)
	draft, err := product.Create(t.Context(), meta, "first-create")
	if err != nil {
		t.Fatal(err)
	}
	source, err := product.SourceScope(t.Context(), meta, draft.ID)
	if err != nil {
		t.Fatal(err)
	}
	req := CreateThreadRequest{ClientRequestID: "first-launch", WorkingDir: source.Directory, managedSource: &source, pluginDraftID: draft.ID}
	raw, _ := json.Marshal(req)
	if _, err := store.FreezeLaunch(t.Context(), owner, draft.ID, req.ClientRequestID, string(raw)); err != nil {
		t.Fatal(err)
	}
	// Force adoption failure after canonical create and project binding. Retry
	// must use the same canonical request, not publish an unrelated conversation.
	canonical, err := svc.threadRuntime.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: flruntime.RequestKey(req.ClientRequestID)})
	if err != nil {
		t.Fatal(err)
	}
	settings, err := svc.buildThreadCreateSettings(t.Context(), meta, req)
	if err != nil {
		t.Fatal(err)
	}
	settings.ThreadID = canonical.ThreadID.String()
	settings.ModelID = "other/model"
	if err := svc.threadsDB.CreateThreadSettings(t.Context(), settings); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateThreadWithOptions(t.Context(), meta, req); err != threadstore.ErrCanonicalThreadSettingsConflict {
		t.Fatalf("adoption failure: %v", err)
	}
	bound, err := store.Get(t.Context(), owner, draft.ID)
	if err != nil || bound.ThreadID != canonical.ThreadID.String() {
		t.Fatalf("ownership not bound before adoption: %+v %v", bound, err)
	}
}
