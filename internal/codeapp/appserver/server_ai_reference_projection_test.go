package appserver

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	flconfig "github.com/floegence/floret/config"
	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/session"
)

func TestServer_AIThreadLiveBootstrapProjectsCanonicalReferencesWithoutHostSecrets(t *testing.T) {
	t.Parallel()

	const sentinelPath = "/private/workspace/secret/main.ts"
	const sentinelLocator = "redeven-context:v1:sentinel-host-locator"
	logs := &bytes.Buffer{}
	logger := slog.New(slog.NewJSONHandler(logs, nil))
	stateDir := t.TempDir()
	meta := session.Meta{
		EndpointID:   "env_reference_projection",
		UserPublicID: "user_reference_projection",
		UserEmail:    "reference-projection@example.com",
		CanRead:      true,
		CanWrite:     true,
		CanExecute:   true,
	}
	aiSvc, err := ai.NewService(ai.Options{
		Logger:       logger,
		StateDir:     stateDir,
		AgentHomeDir: t.TempDir(),
		Shell:        "/bin/sh",
	})
	if err != nil {
		t.Fatalf("ai.NewService: %v", err)
	}
	t.Cleanup(func() { _ = aiSvc.Close() })
	thread, err := aiSvc.CreateThread(context.Background(), &meta, "Reference projection", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	seedFloretReferenceThreadTurn(t, stateDir, thread.ThreadID, sentinelPath, sentinelLocator)

	channelID := "ch_reference_projection"
	srv, err := New(Options{
		Backend:              &stubBackend{},
		DistFS:               fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}, "inject.js": {Data: []byte("console.log('inject');")}},
		ListenAddr:           "127.0.0.1:0",
		Logger:               logger,
		AI:                   aiSvc,
		ConfigPath:           writeTestConfig(t),
		ThreadReadStateStore: openTestThreadReadStateStore(t),
		ResolveSessionMeta:   resolveMetaForTest(channelID, meta),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	rr := performServerRequest(srv, http.MethodGet, "/_redeven_proxy/api/ai/threads/"+url.PathEscape(thread.ThreadID)+"/live/bootstrap", envOriginWithChannel(channelID), "")
	if rr.Code != http.StatusOK {
		t.Fatalf("live bootstrap status=%d body=%s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	for _, forbidden := range []string{sentinelPath, sentinelLocator, "resource_ref", "context_action"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("AppServer response leaked %q: %s", forbidden, body)
		}
	}
	if strings.Contains(logs.String(), sentinelPath) || strings.Contains(logs.String(), sentinelLocator) {
		t.Fatalf("reference projection leaked host-only data to logs: %s", logs.String())
	}

	var response struct {
		OK   bool `json:"ok"`
		Data struct {
			TimelineMessages []struct {
				Role       string           `json:"role"`
				References []map[string]any `json:"references"`
			} `json:"timeline_messages"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("unmarshal live bootstrap: %v", err)
	}
	if !response.OK || len(response.Data.TimelineMessages) != 2 {
		t.Fatalf("bootstrap response=%#v, want canonical user and assistant messages", response)
	}
	references := response.Data.TimelineMessages[0].References
	if response.Data.TimelineMessages[0].Role != "user" || len(references) != 2 {
		t.Fatalf("user timeline message=%#v, want two canonical references", response.Data.TimelineMessages[0])
	}
	if references[0]["kind"] != "file" || references[0]["label"] != "main.ts" {
		t.Fatalf("file reference=%#v", references[0])
	}
	if _, found := references[0]["text"]; found {
		t.Fatalf("file reference exposed text=%#v", references[0])
	}
	if references[1]["kind"] != "text" || references[1]["text"] != "visible excerpt" || references[1]["truncated"] != true {
		t.Fatalf("text reference=%#v", references[1])
	}
}

func seedFloretReferenceThreadTurn(t *testing.T, stateDir string, threadID string, path string, resourceRef string) {
	t.Helper()

	store, err := flruntime.OpenSQLiteStore(filepath.Join(stateDir, "ai", "floret_threads.sqlite"))
	if err != nil {
		t.Fatalf("OpenSQLiteStore: %v", err)
	}
	defer func() { _ = store.Close() }()
	turnFactory, err := configureAppserverFloretTestTurnBinder(t, store).Bind(flruntime.ThreadID(threadID))
	if err != nil {
		t.Fatalf("bind turn execution host: %v", err)
	}
	host, err := turnFactory.NewHost(context.Background(), flruntime.TurnExecutionHostOptions{Config: flconfig.Config{
		Provider: flconfig.ProviderFake, Model: "fake-model", FakeResponse: "canonical response", SystemPrompt: "test",
	}})
	if err != nil {
		t.Fatalf("flruntime.NewHost: %v", err)
	}
	if _, err := host.RunTurn(context.Background(), flruntime.RunTurnRequest{
		ThreadID: flruntime.ThreadID(threadID), TurnID: "turn_reference_projection", RunID: "run_reference_projection",
		Input: flruntime.TurnInput{References: []flruntime.MessageReference{
			{ReferenceID: "context:0", Kind: flruntime.MessageReferenceFile, Label: "main.ts", Text: path, ResourceRef: resourceRef},
			{ReferenceID: "context:1", Kind: flruntime.MessageReferenceText, Label: "Quote", Text: "visible excerpt", Truncated: true},
		}},
		SupplementalContext: []flruntime.TurnSupplementalContextItem{
			{Kind: "file_path", Title: "Linked file path", Metadata: map[string]string{"path": path}, Sensitive: true},
			{Kind: "text", Title: "Quote", Text: "visible excerpt", Truncated: true},
		},
	}); err != nil {
		t.Fatalf("RunTurn: %v", err)
	}
}
