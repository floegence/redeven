package ai

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/tessiven"
)

func TestTessivenThreadOwnershipIsolatesInventoryAndRuntime(t *testing.T) {
	svc := newSendTurnTestServiceWithActivation(t, true)
	meta := testSendTurnMeta()
	path := filepath.Join(t.TempDir(), "canvases.sqlite")
	library, err := tessiven.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = library.Close() }()
	svc.tessiven = library
	canvas, err := library.Create(t.Context(), "canvas", "Business")
	if err != nil {
		t.Fatal(err)
	}
	ordinary, err := svc.CreateThreadWithOptions(t.Context(), meta, CreateThreadRequest{ClientRequestID: "ordinary", Title: "Tessiven in the title grants nothing"})
	if err != nil {
		t.Fatal(err)
	}
	request := CreateThreadRequest{ClientRequestID: "dedicated", Title: "Canvas conversation", TessivenCanvasID: canvas.Canvas.ID}
	dedicated, err := svc.CreateThreadWithOptions(t.Context(), meta, request)
	if err != nil {
		t.Fatal(err)
	}
	if dedicated.TessivenCanvasID != canvas.Canvas.ID {
		t.Fatal("ownership missing from detail")
	}
	replay, err := svc.CreateThreadWithOptions(t.Context(), meta, request)
	if err != nil || replay.ThreadID != dedicated.ThreadID {
		t.Fatalf("create replay: %+v %v", replay, err)
	}
	request.TessivenCanvasID = ""
	if _, err := svc.CreateThreadWithOptions(t.Context(), meta, request); !errors.Is(err, threadstore.ErrCanonicalThreadSettingsConflict) {
		t.Fatalf("ownership downgrade: %v", err)
	}
	request.ClientRequestID, request.TessivenCanvasID = "ordinary", canvas.Canvas.ID
	if _, err := svc.CreateThreadWithOptions(t.Context(), meta, request); !errors.Is(err, threadstore.ErrCanonicalThreadSettingsConflict) {
		t.Fatalf("ordinary root adopted: %v", err)
	}
	foreignCanvas, err := library.Create(t.Context(), "other-canvas", "Other")
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.SelectTessivenThread(t.Context(), meta, foreignCanvas.Canvas.ID, dedicated.ThreadID); !errors.Is(err, tessiven.ErrConflict) {
		t.Fatalf("cross-canvas selection: %v", err)
	}
	if err := svc.SelectTessivenThread(t.Context(), meta, canvas.Canvas.ID, ordinary.ThreadID); !errors.Is(err, tessiven.ErrConflict) {
		t.Fatalf("ordinary root selected: %v", err)
	}
	forked, err := svc.ForkThreadWithOptions(t.Context(), meta, dedicated.ThreadID, ForkThreadRequest{ClientRequestID: "fork"})
	if err != nil {
		t.Fatal(err)
	}
	replacement, err := svc.CreateThreadWithOptions(t.Context(), meta, CreateThreadRequest{ClientRequestID: "replacement", TessivenCanvasID: canvas.Canvas.ID})
	if err != nil {
		t.Fatal(err)
	}
	active, err := library.Canvas(t.Context(), canvas.Canvas.ID)
	if err != nil || active.FlowerThreadID != replacement.ThreadID {
		t.Fatalf("active=%+v %v", active, err)
	}
	// Replaying prior creation never steals activation from the later conversation.
	request.ClientRequestID, request.TessivenCanvasID = "dedicated", canvas.Canvas.ID
	if _, err := svc.CreateThreadWithOptions(t.Context(), meta, request); err != nil {
		t.Fatal(err)
	}
	active, _ = library.Canvas(t.Context(), canvas.Canvas.ID)
	if active.FlowerThreadID != replacement.ThreadID {
		t.Fatal("replay changed active conversation")
	}
	if err := svc.SelectTessivenThread(t.Context(), meta, canvas.Canvas.ID, dedicated.ThreadID); err != nil {
		t.Fatal(err)
	}
	history, err := svc.ListTessivenThreads(t.Context(), meta, canvas.Canvas.ID)
	if err != nil || len(history) != 3 || forked.TessivenCanvasID != canvas.Canvas.ID {
		t.Fatalf("canvas history: %+v %v", history, err)
	}
	foreign := *meta
	foreign.EndpointID = "other"
	if err := svc.SelectTessivenThread(t.Context(), &foreign, canvas.Canvas.ID, dedicated.ThreadID); err == nil {
		t.Fatal("foreign session selected conversation")
	}
	history, err = svc.ListTessivenThreads(t.Context(), &foreign, canvas.Canvas.ID)
	if err != nil || len(history) != 0 {
		t.Fatalf("foreign history: %+v %v", history, err)
	}
	childSettings, err := svc.threadsDB.GetThreadSettings(t.Context(), meta.EndpointID, dedicated.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	childSettings.ThreadID, childSettings.ParentThreadID = "canvas-child", dedicated.ThreadID
	if err := svc.threadsDB.CreateThreadSettings(t.Context(), *childSettings); err != nil {
		t.Fatal(err)
	}
	childOwner, err := svc.tessivenThreadCanvas(t.Context(), childSettings.ThreadID)
	if err != nil || childOwner != canvas.Canvas.ID {
		t.Fatalf("child owner=%q %v", childOwner, err)
	}
	// A full storage page of dedicated roots cannot consume ordinary pagination.
	seed, _ := svc.threadsDB.GetThreadSettings(t.Context(), meta.EndpointID, dedicated.ThreadID)
	for i := range 205 {
		settings := *seed
		settings.ThreadID = fmt.Sprintf("hidden-%d", i)
		hiddenCanvas, err := library.Create(t.Context(), settings.ThreadID, "Hidden canvas")
		if err != nil {
			t.Fatal(err)
		}
		if err := library.BindFlowerThread(t.Context(), hiddenCanvas.Canvas.ID, settings.ThreadID); err != nil {
			t.Fatal(err)
		}
		if err := svc.threadsDB.CreateThreadSettings(t.Context(), settings); err != nil {
			t.Fatal(err)
		}
		if _, err := svc.threadsDB.SetThreadPinned(t.Context(), meta.EndpointID, settings.ThreadID, true); err != nil {
			t.Fatal(err)
		}
	}
	page, err := svc.ListThreads(t.Context(), meta, 1, "")
	if err != nil || len(page.Threads) != 1 || page.Threads[0].ThreadID != ordinary.ThreadID || page.NextCursor != "" {
		t.Fatalf("ordinary list: %+v %v", page, err)
	}
	baseline, err := svc.listFlowerLiveBaseline(t.Context(), meta)
	if err != nil || len(baseline) != 1 || baseline[0].ThreadID != ordinary.ThreadID {
		t.Fatalf("live baseline: %+v %v", baseline, err)
	}
	subscription, err := svc.SubscribeFlowerLiveStream(t.Context(), meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	for {
		envelope := flowerBackpressureEnvelope(t, subscription)
		for _, summary := range envelope.Summaries {
			if summary.ThreadID != ordinary.ThreadID {
				t.Fatal("canvas conversation entered live inventory")
			}
		}
		if envelope.BaselineComplete != nil && *envelope.BaselineComplete {
			break
		}
	}
	for _, id := range []string{dedicated.ThreadID, ordinary.ThreadID} {
		if err := svc.publishCanonicalThreadSummary(t.Context(), meta.EndpointID, id); err != nil {
			t.Fatal(err)
		}
	}
	for {
		envelope := flowerBackpressureEnvelope(t, subscription)
		if envelope.Kind == FlowerLiveStreamSummaryBatch {
			if len(envelope.Summaries) != 1 || envelope.Summaries[0].ThreadID != ordinary.ThreadID {
				t.Fatal("canvas conversation entered live summary updates")
			}
			break
		}
	}
	scope, err := svc.threadQueryScope(t.Context(), meta)
	if err != nil || len(scope.ThreadIDs) != 1 || scope.ThreadIDs[0].String() != ordinary.ThreadID {
		t.Fatalf("model query scope: %+v %v", scope, err)
	}
	scoped, err := svc.threadQueryScope(t.Context(), meta, canvas.Canvas.ID)
	if err != nil || len(scoped.ThreadIDs) != 4 {
		t.Fatalf("dedicated query scope: %d %v", len(scoped.ThreadIDs), err)
	}
	if err := svc.authorizeThreadReferences(t.Context(), meta, threadReferenceAction(flowerThreadReferenceRuntimeID(meta.EndpointID), dedicated.ThreadID)); err == nil {
		t.Fatal("Tessiven reference escaped its surface")
	}
	for _, tc := range []struct {
		id   string
		want bool
	}{{ordinary.ThreadID, false}, {dedicated.ThreadID, true}, {childSettings.ThreadID, true}} {
		host, err := svc.bindRunHostCapabilities(meta.EndpointID, tc.id)
		if err != nil {
			t.Fatal(err)
		}
		r := newRun(runOptions{AgentHomeDir: svc.agentHomeDir, WorkingDir: svc.agentHomeDir, SessionMeta: meta, HostCapabilities: host})
		r.ensureSkillManager().userHome = t.TempDir()
		registry := NewInMemoryToolRegistry()
		if err := registerBuiltInTools(registry, r); err != nil {
			t.Fatal(err)
		}
		count := 0
		for _, tool := range registry.Snapshot() {
			if strings.HasPrefix(tool.Name, "tessiven.") {
				count++
			}
		}
		if (count == len(builtInTessivenToolDefinitions())) != tc.want || !tc.want && count != 0 {
			t.Fatalf("scoped tools: %d want=%v", count, tc.want)
		}
		snapshot, err := r.collectModelContextSnapshot(t.Context(), FlowerPermissionFullAccess, time.Now)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, section := range snapshot.Sections {
			found = found || strings.Contains(section.Text, tessivenSkillName)
		}
		if found != tc.want {
			t.Fatalf("scoped skills=%v want=%v", found, tc.want)
		}
		activationCtx := contextWithToolAuthorizationSnapshot(t.Context(), PermissionSnapshot{SnapshotID: "scope", PermissionType: FlowerPermissionFullAccess})
		_, _, err = r.activateSkill(activationCtx, tessivenSkillName)
		if (err == nil) != tc.want {
			t.Fatalf("skill activation: %v want=%v", err, tc.want)
		}
		_, err = r.execTessivenTool(t.Context(), meta, "tessiven.schema", map[string]any{})
		if (err == nil) != tc.want {
			t.Fatalf("tool dispatch: %v want=%v", err, tc.want)
		}
	}
	if err := library.Close(); err != nil {
		t.Fatal(err)
	}
	library, err = tessiven.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	svc.tessiven = library
	owner, err := library.FlowerThreadCanvas(t.Context(), dedicated.ThreadID)
	if err != nil || owner != canvas.Canvas.ID {
		t.Fatalf("restart lost ownership: %q %v", owner, err)
	}
	if err := library.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ListThreads(t.Context(), meta, 10, ""); err == nil {
		t.Fatal("ownership failure exposed inventory")
	}
}

func TestTessivenGoalAdmissionRetainsCanvasWithoutDispatch(t *testing.T) {
	svc := newSendTurnTestServiceWithActivation(t, true)
	library, err := tessiven.Open(filepath.Join(t.TempDir(), "canvases.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer library.Close()
	svc.tessiven = library
	canvas, err := library.Create(t.Context(), "goal-canvas", "Goal canvas")
	if err != nil {
		t.Fatal(err)
	}
	meta := testSendTurnMeta()
	req := ThreadGoalRequest{StorageGeneration: svc.storageGeneration, ClientRequestID: "canvas-goal", Operation: "set", Text: "Review this canvas", NewThread: &CreateThreadRequest{TessivenCanvasID: canvas.Canvas.ID}}
	_, current, err := svc.ManageThreadGoal(t.Context(), meta, req)
	if err != nil || current.TurnID != "" {
		t.Fatalf("goal create: %+v %v", current, err)
	}
	replay, again, err := svc.ManageThreadGoal(t.Context(), meta, req)
	if err != nil || !replay.Replayed || again.ThreadID != current.ThreadID {
		t.Fatalf("goal replay: %+v %v", replay, err)
	}
	owner, err := svc.tessivenThreadCanvas(t.Context(), current.ThreadID.String())
	if err != nil || owner != canvas.Canvas.ID {
		t.Fatalf("goal owner=%q %v", owner, err)
	}
	req.ClientRequestID = "replacement-goal"
	_, next, err := svc.ManageThreadGoal(t.Context(), meta, req)
	if err != nil || next.ThreadID == current.ThreadID || next.TurnID != "" {
		t.Fatalf("new Goal conversation: %+v %v", next, err)
	}
	active, err := library.Canvas(t.Context(), canvas.Canvas.ID)
	if err != nil || active.FlowerThreadID != next.ThreadID.String() {
		t.Fatalf("active Goal=%+v %v", active, err)
	}
	page, err := svc.ListThreads(t.Context(), meta, 10, "")
	if err != nil || len(page.Threads) != 0 {
		t.Fatalf("goal leaked into ordinary list: %+v %v", page, err)
	}
}
