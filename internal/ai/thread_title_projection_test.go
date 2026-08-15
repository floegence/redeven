package ai

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v4/config"
	"github.com/floegence/floret/v4/identity"
	flprovider "github.com/floegence/floret/v4/provider"
	flruntime "github.com/floegence/floret/v4/runtime"
	flstorage "github.com/floegence/floret/v4/storage"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

type automaticTitleTransitionGateway struct {
	failTitle    bool
	titleStarted chan struct{}
	releaseTitle chan struct{}
	startOnce    sync.Once
}

func (*automaticTitleTransitionGateway) Identity() flprovider.Identity {
	return flprovider.Identity{Provider: "test", Model: "automatic-title", StateCompatibilityKey: "test:automatic-title:v1"}
}

func (*automaticTitleTransitionGateway) Capabilities() flprovider.Capabilities {
	return flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported}
}

func (gateway *automaticTitleTransitionGateway) Stream(ctx context.Context, request flprovider.Request) (<-chan flprovider.Event, error) {
	events := make(chan flprovider.Event, 2)
	if request.LogicalRequestID != "thread_title" {
		events <- flprovider.Event{Type: flprovider.EventDelta, Text: "Assistant response"}
		events <- flprovider.Event{Type: flprovider.EventDone, Reason: "stop"}
		close(events)
		return events, nil
	}
	gateway.startOnce.Do(func() { close(gateway.titleStarted) })
	go func() {
		defer close(events)
		select {
		case <-ctx.Done():
			return
		case <-gateway.releaseTitle:
		}
		if gateway.failTitle {
			events <- flprovider.Event{Type: flprovider.EventError, Err: errors.New("title unavailable")}
			return
		}
		events <- flprovider.Event{Type: flprovider.EventDelta, Text: "Provider title"}
		events <- flprovider.Event{Type: flprovider.EventDone, Reason: "stop"}
	}()
	return events, nil
}

func TestCreateThreadReturnsReadyCanonicalTitle(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := &session.Meta{
		EndpointID: "env_create_title", UserPublicID: "user_create_title", NamespacePublicID: "namespace_create_title",
		CanRead: true, CanWrite: true, CanExecute: true,
	}

	thread, err := svc.CreateThread(context.Background(), meta, "Created title", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if thread.Title != "Created title" || thread.TitleStatus != string(flruntime.ThreadTitleStatusReady) {
		t.Fatalf("created title projection = (%q, %q), want (%q, %q)", thread.Title, thread.TitleStatus, "Created title", flruntime.ThreadTitleStatusReady)
	}
}

func TestForkThreadReturnsReadyCanonicalTitle(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := &session.Meta{
		EndpointID: "env_fork_title", UserPublicID: "user_fork_title", NamespacePublicID: "namespace_fork_title",
		CanRead: true, CanWrite: true, CanExecute: true,
	}
	source, err := svc.CreateThread(context.Background(), meta, "Source title", "", "", "")
	if err != nil {
		t.Fatal(err)
	}

	forked, err := svc.ForkThread(context.Background(), meta, source.ThreadID, "Forked title")
	if err != nil {
		t.Fatal(err)
	}
	if forked.Title != "Forked title" || forked.TitleStatus != string(flruntime.ThreadTitleStatusReady) {
		t.Fatalf("forked title projection = (%q, %q), want (%q, %q)", forked.Title, forked.TitleStatus, "Forked title", flruntime.ThreadTitleStatusReady)
	}
}

func TestAutomaticTitleTransitionsPreserveCanonicalStatus(t *testing.T) {
	for _, test := range []struct {
		name        string
		failTitle   bool
		finalTitle  string
		finalStatus flruntime.ThreadTitleStatus
	}{
		{name: "ready", finalTitle: "Provider title", finalStatus: flruntime.ThreadTitleStatusReady},
		{name: "failed", failTitle: true, finalTitle: "First user request", finalStatus: flruntime.ThreadTitleStatusFailed},
	} {
		t.Run(test.name, func(t *testing.T) {
			gateway := &automaticTitleTransitionGateway{
				failTitle: test.failTitle, titleStarted: make(chan struct{}), releaseTitle: make(chan struct{}),
			}
			agent, err := flruntime.NewAgent(flconfig.AgentConfig{
				Profile:      flconfig.AgentProfile{ID: "assistant", Name: "Assistant"},
				SystemPrompt: "Test.", Context: flconfig.ContextPolicy{ContextWindowTokens: flconfig.DefaultContextWindowTokens},
			}, gateway, flruntime.WithAgentThreadTitleMode(flruntime.ThreadTitleModeProvider))
			if err != nil {
				t.Fatal(err)
			}
			host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: flstorage.Memory()})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = host.Shutdown(context.Background()) })
			runtime, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) {
				return agent, nil
			}))
			if err != nil {
				t.Fatal(err)
			}
			created, err := runtime.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: flruntime.RequestKey("create-title-" + test.name)})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := runtime.Send(t.Context(), flruntime.SendInput{
				ThreadID: created.ThreadID, Input: flruntime.UserInput{Text: "First user request"}, RequestKey: flruntime.RequestKey("send-title-" + test.name),
			}); err != nil {
				t.Fatal(err)
			}
			select {
			case <-gateway.titleStarted:
			case <-time.After(3 * time.Second):
				t.Fatal("automatic title request did not start")
			}

			assertTitleProjection(t, runtime, created.ThreadID, "First user request", flruntime.ThreadTitleStatusPending)
			close(gateway.releaseTitle)
			waitForTitleProjection(t, runtime, created.ThreadID, test.finalTitle, test.finalStatus)
		})
	}
}

func assertTitleProjection(t *testing.T, runtime flruntime.ThreadService, threadID identity.ThreadID, wantTitle string, wantStatus flruntime.ThreadTitleStatus) {
	t.Helper()
	summary, err := threadSummaryFromRuntime(t.Context(), runtime, threadID)
	if err != nil {
		t.Fatal(err)
	}
	current, err := runtime.View(t.Context(), threadID)
	if err != nil {
		t.Fatal(err)
	}
	view := threadViewFromRuntimeCurrent(threadstore.ThreadSettings{ThreadID: threadID.String()}, current, summary)
	if view.Title != wantTitle || view.TitleStatus != string(wantStatus) {
		t.Fatalf("title projection = (%q, %q), want (%q, %q)", view.Title, view.TitleStatus, wantTitle, wantStatus)
	}
}

func waitForTitleProjection(t *testing.T, runtime flruntime.ThreadService, threadID identity.ThreadID, wantTitle string, wantStatus flruntime.ThreadTitleStatus) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		summary, err := threadSummaryFromRuntime(t.Context(), runtime, threadID)
		if err != nil {
			t.Fatal(err)
		}
		if summary.Title == wantTitle && summary.TitleStatus == wantStatus {
			assertTitleProjection(t, runtime, threadID, wantTitle, wantStatus)
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	summary, _ := threadSummaryFromRuntime(t.Context(), runtime, threadID)
	t.Fatalf("automatic title did not settle: summary=%#v", summary)
}
