package ai

import (
	"context"
	"fmt"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	flstorage "github.com/floegence/floret/v7/storage"
	fltools "github.com/floegence/floret/v7/tools"
)

type mediaRecoveryGateway struct {
	mu       sync.Mutex
	reviewed []string
	rejected int
}

func (*mediaRecoveryGateway) Identity() flprovider.Identity {
	return flprovider.Identity{Provider: "test", Model: "vision", StateCompatibilityKey: "media-recovery:v1"}
}
func (*mediaRecoveryGateway) Capabilities() flprovider.Capabilities {
	return flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported}
}
func (g *mediaRecoveryGateway) Stream(_ context.Context, req flprovider.Request) (<-chan flprovider.Event, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	var refs []string
	for _, m := range req.Messages {
		for _, a := range m.Attachments {
			refs = append(refs, a.ResourceRef)
		}
	}
	summary := len(req.Tools) == 0
	limit := 2
	if summary {
		limit = 1
	}
	if len(refs) > limit {
		g.rejected++
		cause := &flprovider.MediaLimitError{Kind: "count", Actual: int64(len(refs)), Limit: int64(limit)}
		failure := providerTransportFailure(cause, "deepseek")
		advice := flprovider.RetryAdviceForError(failure)
		rpc := &DesktopModelSourceRPCError{Code: "TURN_STREAM_FAILED", Message: failure.Error(), RetryAdvice: &advice, Capacity: &FlowerCompactionCapacity{Kind: "image_count", Stage: "prepare", Source: "provider", ActualImages: int64(len(refs)), LimitImages: int64(limit)}}
		if err := validateDesktopModelSourceRPCError(rpc, true); err != nil {
			return nil, err
		}
		return nil, providerTransportFailure(rpc, DesktopModelSourceProviderType)
	}
	if summary {
		g.reviewed = append(g.reviewed, refs...)
	}
	out := make(chan flprovider.Event, 2)
	out <- flprovider.Event{Type: flprovider.EventDelta, Text: "Reviewed all supplied images. Keep their original locators and continue."}
	out <- flprovider.Event{Type: flprovider.EventDone, Reason: "stop"}
	close(out)
	return out, nil
}

func TestPublishedMediaCapacityRecoveryPreservesHistoryAcrossRestart(t *testing.T) {
	gateway := &mediaRecoveryGateway{}
	tool := fltools.Define[map[string]any](fltools.Definition{Name: "inspect", ReadOnly: true, InputSchema: fltools.StrictObject(nil, nil), Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}}, nil, nil, func(context.Context, fltools.Invocation[map[string]any]) (fltools.Result, error) {
		t.Error("recovery replayed a tool")
		return fltools.Result{Text: "unexpected"}, nil
	})
	agent, err := flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "media", Name: "Media"}, SystemPrompt: "Review images.", Context: flconfig.ContextPolicy{ContextWindowTokens: 128000}}, gateway, flruntime.WithAgentTools(tool))
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "history.sqlite")
	open := func() (*flruntime.Host, flruntime.ThreadService) {
		host, e := flruntime.Open(t.Context(), flruntime.Options{Storage: flstorage.SQLite(path)})
		if e != nil {
			t.Fatal(e)
		}
		t.Cleanup(func() { _ = host.Shutdown(context.Background()) })
		threads, e := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) { return agent, nil }))
		if e != nil {
			t.Fatal(e)
		}
		return host, threads
	}
	host, threads := open()
	created, err := threads.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create"})
	if err != nil {
		t.Fatal(err)
	}
	for i := range 3 {
		input := flruntime.UserInput{Text: "Review this frame.", Attachments: []flruntime.MessageAttachment{{ResourceRef: fmt.Sprintf("image:frame-%d", i), Name: "frame.png", MIMEType: "image/png", SizeBytes: 1024}}}
		admitted, e := threads.Send(t.Context(), flruntime.SendInput{ThreadID: created.ThreadID, RequestKey: flruntime.RequestKey(fmt.Sprintf("send-%d", i)), Input: input})
		if e != nil {
			t.Fatal(e)
		}
		deadline := time.Now().Add(10 * time.Second)
		for {
			view, e := threads.View(t.Context(), created.ThreadID)
			if e != nil {
				t.Fatal(e)
			}
			if view.Activity == flruntime.ThreadActivityIdle && view.TurnID == admitted.TurnID && view.LastOutcome != nil {
				if *view.LastOutcome != flruntime.TurnOutcomeCompleted {
					t.Fatalf("recovery failed: %+v", view.Failure)
				}
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("recovery timed out")
			}
			time.Sleep(time.Millisecond)
		}
	}
	gateway.mu.Lock()
	reviewed := append([]string(nil), gateway.reviewed...)
	rejected := gateway.rejected
	gateway.mu.Unlock()
	if !reflect.DeepEqual(reviewed, []string{"image:frame-0", "image:frame-1"}) || rejected < 2 {
		t.Fatalf("ordered summary=%v capacity rejections=%d", reviewed, rejected)
	}
	before, err := threads.View(t.Context(), created.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	contextView, err := threads.(flruntime.ThreadContextReader).Context(t.Context(), created.ThreadID)
	if err != nil || len(contextView.Compactions) != 1 {
		t.Fatalf("context=%+v err=%v", contextView, err)
	}
	projected := flowerCompactionDecision(contextView.Compactions[0].Decision)
	if projected == nil || projected.Capacity == nil || projected.Capacity.Kind != "image_count" || projected.Capacity.ActualImages != 3 {
		t.Fatalf("lost capacity projection: %+v %v", projected, err)
	}
	inventory, err := host.MediaInventory(t.Context())
	if err != nil || len(inventory.References) != 3 {
		t.Fatalf("canonical images lost: %+v %v", inventory, err)
	}
	if err := host.Shutdown(t.Context()); err != nil {
		t.Fatal(err)
	}
	host, threads = open()
	after, err := threads.View(t.Context(), created.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if len(before.Items) != len(after.Items) {
		t.Fatal("restart changed canonical history")
	}
	for i, item := range before.Items {
		if after.Items[i].ID != item.ID {
			t.Fatal("restart changed canonical identity")
		}
	}
	inventory, err = host.MediaInventory(t.Context())
	if err != nil || len(inventory.References) != 3 {
		t.Fatalf("restart lost originals: %+v %v", inventory, err)
	}
}
