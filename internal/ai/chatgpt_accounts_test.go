package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/chatgpt"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/settings"
)

func TestAccountSignOutImmediatelyCancelsCanonicalExecution(t *testing.T) {
	entered := make(chan struct{}, 1)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			return
		}
		if definitions, _ := body["tools"].([]any); len(definitions) == 0 {
			writeAskUserIntegrationTextResponse(w, w.(http.Flusher), "title", "Account task")
			return
		}
		entered <- struct{}{}
		<-r.Context().Done()
	}))
	defer provider.Close()
	state := t.TempDir()
	store := settings.NewSecretsStore(filepath.Join(state, "secrets.json"))
	account := settings.ChatGPTAccount{Issuer: chatgpt.Issuer, Subject: "subject", ClientID: "issued", AccessToken: "current", Scopes: []string{"resource.invoke", "chatgpt.tokens.use.direct"}, ExpiresAt: time.Now().Add(time.Hour)}
	if err := store.UpdateChatGPTAccount(t.Context(), account.ID(), func(a *settings.ChatGPTAccount) error { *a = account; return nil }); err != nil {
		t.Fatal(err)
	}
	client := chatgpt.New(store)
	svc, err := NewService(Options{StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", ChatGPT: client, Config: &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Type: "openai", BaseURL: provider.URL + "/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}}, ResolveProviderAPIKey: func(string) (string, bool, error) { return "fixture", true, nil }})
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Account task", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ClientRequestID: "start", ThreadID: thread.ThreadID, Input: RunInput{Text: "Keep this canonical conversation."}}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("provider did not start")
	}
	current, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.bindAccountTask(thread.ThreadID, current.TurnID, config.AIProvider{AuthMethod: config.AIAuthChatGPT, AccountID: account.ID()}); err != nil {
		t.Fatal(err)
	}
	// A prior turn's delayed idle observation must not dispose this turn's watch.
	svc.reconcileAccountWatches(current.ThreadID.String(), "earlier", flruntime.ThreadActivityIdle)
	if svc.AccountTaskCount(account.ID()) != 1 {
		t.Fatal("stale observation removed active watch")
	}
	if _, err := client.SignOutAccount(t.Context(), account.ID()); err != nil {
		t.Fatal(err)
	}
	cancelled := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "canceled" || view.RunStatus == "cancelled" })
	if cancelled.ThreadID != thread.ThreadID {
		t.Fatal("logout erased conversation")
	}
}

type accountCancelRuntime struct {
	flruntime.ThreadService
	view          flruntime.ThreadView
	cancellations chan flruntime.CancelInput
}

func (r *accountCancelRuntime) View(context.Context, identity.ThreadID) (flruntime.ThreadView, error) {
	return r.view, nil
}
func (r *accountCancelRuntime) Cancel(_ context.Context, input flruntime.CancelInput) (flruntime.ThreadView, error) {
	r.cancellations <- input
	return r.view, nil
}

func TestDesktopAccountFactsCancelWaitingTurnAndDescendants(t *testing.T) {
	svc := newSendTurnTestService(t)
	runtime := &accountCancelRuntime{ThreadService: svc.threadRuntime, view: flruntime.ThreadView{ThreadID: "parent", TurnID: "bound-turn", Activity: flruntime.ThreadActivityActive, Attention: flruntime.AttentionSummary{InputCount: 1}}, cancellations: make(chan flruntime.CancelInput, 1)}
	svc.threadRuntime = runtime
	source := &desktopModelSourceClient{lastSnapshot: &DesktopModelSourceModelSnapshot{Models: []DesktopModelSourceModel{{ID: "model", AccountID: "account"}}, Accounts: map[string]DesktopAccountFact{"account": {State: "ready", Revision: 1}}}}
	svc.desktopModelSource = source
	svc.bindDesktopAccountTask("parent", "bound-turn", "model")
	source.mu.Lock()
	source.lastSnapshot.Accounts["account"] = DesktopAccountFact{State: "signed_out", Revision: 2}
	source.mu.Unlock()
	select {
	case input := <-runtime.cancellations:
		if input.Mode != flruntime.CancelModeImmediate || !input.IncludeDescendants || input.ThreadID != "parent" {
			t.Fatalf("incomplete cancellation: %+v", input)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Desktop logout did not stop waiting turn")
	}
}
