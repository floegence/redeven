package appserver

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestServerPinnedConversationPosition(t *testing.T) {
	dir := t.TempDir()
	service, err := ai.NewService(ai.Options{
		StateDir: dir, AgentHomeDir: dir, Shell: "bash",
		Config:                &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Type: "openai", BaseURL: "https://api.openai.com/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}},
		ResolveProviderAPIKey: func(string) (string, bool, error) { return "sk-test", true, nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	meta := session.Meta{ChannelID: "ch_ai_readiness", EndpointID: "env_pin", NamespacePublicID: "ns_test", UserPublicID: "user", CanRead: true, CanWrite: true, CanExecute: true}
	server, origin := newAIReadinessTestServer(t, newStaticAIServiceProvider(service), meta)
	var ids []string
	for _, name := range []string{"first", "second", "third"} {
		thread, err := service.CreateThread(t.Context(), &meta, name, "", "", "")
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, thread.ThreadID)
		pin := serveAIReadinessTestRequest(server, origin, http.MethodPatch, "/_redeven_proxy/api/ai/threads/"+thread.ThreadID, []byte(`{"pinned":true}`))
		if pin.Code != 200 {
			t.Fatalf("pin %d %s", pin.Code, pin.Body.String())
		}
		var payload struct {
			Data struct {
				Thread struct {
					PinRank  int64 `json:"pin_rank"`
					Revision int64 `json:"settings_revision"`
				} `json:"thread"`
			} `json:"data"`
		}
		if err := json.Unmarshal(pin.Body.Bytes(), &payload); err != nil || payload.Data.Thread.PinRank == 0 || payload.Data.Thread.Revision == 0 {
			t.Fatalf("missing authoritative pin metadata: %s", pin.Body.String())
		}
	}
	path := "/_redeven_proxy/api/ai/threads/" + ids[0] + "/pin-position"
	var observers []*ai.FlowerLiveStreamSubscription
	for range 2 {
		observer, err := service.SubscribeFlowerLiveStream(t.Context(), &meta, ai.FlowerLiveStreamRequest{})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(observer.Close)
		observers = append(observers, observer)
	}
	body := []byte(`{"anchor_thread_id":"` + ids[2] + `","placement":"before"}`)
	response := serveAIReadinessTestRequest(server, origin, http.MethodPatch, path, body)
	if response.Code != 200 {
		t.Fatalf("move=%d %s", response.Code, response.Body.String())
	}
	list, err := service.ListThreads(t.Context(), &meta, 200, "")
	if err != nil {
		t.Fatal(err)
	}
	var actual []string
	for _, thread := range list.Threads {
		actual = append(actual, thread.ThreadID)
	}
	if !reflect.DeepEqual(actual, []string{ids[0], ids[2], ids[1]}) {
		t.Fatalf("moved order=%v", actual)
	}
	for _, observer := range observers {
		ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
		seen := make(map[string]int64)
		for len(seen) < len(ids) {
			frame, err := observer.Next(ctx)
			if err != nil {
				cancel()
				t.Fatal(err)
			}
			var envelope struct {
				Summaries []ai.ThreadView `json:"summaries"`
			}
			if err := json.Unmarshal(frame.Data, &envelope); err != nil {
				cancel()
				t.Fatal(err)
			}
			for _, summary := range envelope.Summaries {
				for _, expected := range list.Threads {
					if summary.ThreadID == expected.ThreadID && summary.SettingsRevision >= expected.SettingsRevision && summary.PinRank == expected.PinRank {
						seen[summary.ThreadID] = summary.PinRank
					}
				}
			}
		}
		cancel()
	}
	for _, invalid := range []string{`{}`, `{"anchor_thread_id":"x","placement":"sideways"}`, string(body) + `{}`, `{"anchor_thread_id":"x","placement":"after","endpoint_id":"foreign"}`} {
		response = serveAIReadinessTestRequest(server, origin, http.MethodPatch, path, []byte(invalid))
		if response.Code != 400 {
			t.Fatalf("invalid body status=%d: %s", response.Code, response.Body.String())
		}
	}
	if _, err := service.SetThreadPinned(t.Context(), &meta, ids[2], false); err != nil {
		t.Fatal(err)
	}
	response = serveAIReadinessTestRequest(server, origin, http.MethodPatch, path, body)
	if response.Code != 409 {
		t.Fatalf("stale anchor=%d %s", response.Code, response.Body.String())
	}
	readonly := meta
	readonly.CanWrite = false
	readServer, readOrigin := newAIReadinessTestServer(t, newStaticAIServiceProvider(service), readonly)
	response = serveAIReadinessTestRequest(readServer, readOrigin, http.MethodPatch, path, body)
	if response.Code != 403 {
		t.Fatalf("readonly mutation=%d", response.Code)
	}
	foreign := meta
	foreign.EndpointID = "other"
	foreignServer, foreignOrigin := newAIReadinessTestServer(t, newStaticAIServiceProvider(service), foreign)
	response = serveAIReadinessTestRequest(foreignServer, foreignOrigin, http.MethodPatch, path, body)
	if response.Code != 404 {
		t.Fatalf("foreign mutation=%d %s", response.Code, response.Body.String())
	}
}
