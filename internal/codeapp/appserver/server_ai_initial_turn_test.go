package appserver

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestServerAIInitialTurnCreateIsIdempotentAndCanonicallyReadable(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "provider response is irrelevant after canonical admission", http.StatusInternalServerError)
	}))
	t.Cleanup(provider.Close)
	cfg := &config.AIConfig{
		CurrentModelID: "openai/gpt-5-mini",
		Providers: []config.AIProvider{{
			ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: provider.URL + "/v1",
			Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
		}},
	}
	stateDir := t.TempDir()
	aiService, err := ai.NewService(ai.Options{
		Logger: logger, StateDir: stateDir, AgentHomeDir: stateDir, Shell: "bash", Config: cfg,
		PersistOpTimeout: 2 * time.Second, RunMaxWallTime: 2 * time.Second, RunIdleTimeout: time.Second,
		ResolveProviderAPIKey: func(string) (string, bool, error) { return "sk-initial-http-test", true, nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = aiService.Close() })

	channelID := "ch_initial_turn_http"
	origin := envOriginWithChannel(channelID)
	meta := session.Meta{
		ChannelID: channelID, EndpointID: "env_initial_turn_http", NamespacePublicID: "ns_initial_turn_http",
		UserPublicID: "user_initial_turn_http", UserEmail: "initial-turn@example.com",
		CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true,
	}
	server, err := New(Options{
		Logger: logger, Backend: &stubBackend{},
		DistFS:     fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}, "inject.js": {Data: []byte("// inject")}},
		ListenAddr: "127.0.0.1:0", ConfigPath: writeTestConfigWithAI(t),
		ResolveSessionMeta: resolveMetaForTest(channelID, meta), AIServiceProvider: newStaticAIServiceProvider(aiService),
	})
	if err != nil {
		t.Fatal(err)
	}

	threadID := "th_223456789012345678901234"
	payload := `{
  "thread_id":"` + threadID + `",
  "model":"openai/gpt-5-mini",
  "input":{"turn_id":"turn_initial_http","text":"create through the Flower HTTP boundary","attachments":[]},
  "options":{"permission_type":"approval_required"},
  "create":{"title":"","model_id":"openai/gpt-5-mini","permission_type":"approval_required"}
}`
	post := func(targetThreadID, body, stagingScopeID, stagingCapability string) (int, ai.SendUserTurnResponse, string) {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/ai/threads/"+targetThreadID+"/turns", bytes.NewBufferString(body))
		req.Header.Set("Origin", origin)
		if stagingScopeID != "" {
			req.Header.Set(uploadStagingScopeIDHeader, stagingScopeID)
		}
		if stagingCapability != "" {
			req.Header.Set(uploadStagingCapabilityHeader, stagingCapability)
		}
		recorder := httptest.NewRecorder()
		server.serveHTTP(recorder, req)
		var response struct {
			OK   bool                    `json:"ok"`
			Data ai.SendUserTurnResponse `json:"data"`
		}
		if recorder.Code == http.StatusAccepted {
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatalf("decode receipt: %v", err)
			}
			if !response.OK {
				t.Fatalf("response=%s", recorder.Body.String())
			}
		}
		return recorder.Code, response.Data, recorder.Body.String()
	}
	firstStatus, first, firstBody := post(threadID, payload, "", "")
	if firstStatus != http.StatusAccepted || first.Kind != "start" || first.TurnID != "turn_initial_http" || first.RunID == "" {
		t.Fatalf("first status=%d receipt=%#v body=%s", firstStatus, first, firstBody)
	}
	secondStatus, second, secondBody := post(threadID, payload, "", "")
	if secondStatus != http.StatusAccepted || second != first {
		t.Fatalf("second status=%d receipt=%#v body=%s, want %#v", secondStatus, second, secondBody, first)
	}

	readRequest := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/threads/"+threadID+"/messages", nil)
	readRequest.Header.Set("Origin", origin)
	readResponse := httptest.NewRecorder()
	server.serveHTTP(readResponse, readRequest)
	if readResponse.Code != http.StatusOK || !strings.Contains(readResponse.Body.String(), "create through the Flower HTTP boundary") || !strings.Contains(readResponse.Body.String(), "turn_initial_http") {
		t.Fatalf("canonical read status=%d body=%s", readResponse.Code, readResponse.Body.String())
	}

	unknownPayload := `{"thread_id":"th_223456789012345678901235","model":"openai/gpt-5-mini","input":{"turn_id":"turn_unknown_http","text":"must not create","attachments":[]},"options":{}}`
	unknownRequest := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/ai/threads/th_223456789012345678901235/turns", bytes.NewBufferString(unknownPayload))
	unknownRequest.Header.Set("Origin", origin)
	unknownResponse := httptest.NewRecorder()
	server.serveHTTP(unknownResponse, unknownRequest)
	if unknownResponse.Code != http.StatusNotFound {
		t.Fatalf("unknown thread status=%d body=%s", unknownResponse.Code, unknownResponse.Body.String())
	}

	attachmentThreadID := "th_223456789012345678901236"
	owner, err := ai.NewUploadOwner(meta.EndpointID, meta.UserPublicID, meta.ChannelID)
	if err != nil {
		t.Fatal(err)
	}
	scope, err := aiService.CreateUploadStagingScope(t.Context(), owner, attachmentThreadID)
	if err != nil {
		t.Fatal(err)
	}
	attachmentBytes := []byte("attachment sent through the HTTP boundary\n")
	attachmentDigest := sha256.Sum256(attachmentBytes)
	attachmentName := "http-initial.txt"
	attachmentNameDigest := sha256.Sum256([]byte(attachmentName))
	upload, err := aiService.SaveUpload(t.Context(), ai.SaveUploadRequest{
		Owner: owner, StagingScopeID: scope.StagingScopeID, StagingCapability: scope.Capability,
		Reader: bytes.NewReader(attachmentBytes), DisplayName: attachmentName, DeclaredMediaType: "text/plain",
		UploadRequestID: "upload_initial_http", ExpectedContentSHA256: hex.EncodeToString(attachmentDigest[:]), ExpectedSizeBytes: int64(len(attachmentBytes)),
		DisplayNameSHA256: hex.EncodeToString(attachmentNameDigest[:]), MaxBytes: 1 << 20,
	})
	if err != nil {
		t.Fatal(err)
	}
	attachmentPayload := `{
  "thread_id":"` + attachmentThreadID + `",
  "staging_scope_id":"` + scope.StagingScopeID + `",
  "model":"openai/gpt-5-mini",
  "input":{"turn_id":"turn_initial_http_attachment","text":"read this attachment","attachments":[{"attachment_id":"` + upload.AttachmentID + `"}]},
  "options":{"permission_type":"approval_required"},
  "create":{"model_id":"openai/gpt-5-mini","permission_type":"approval_required"}
}`
	partialStatus, _, partialBody := post(attachmentThreadID, attachmentPayload, scope.StagingScopeID, "")
	if partialStatus != http.StatusBadRequest {
		t.Fatalf("partial staging headers status=%d body=%s", partialStatus, partialBody)
	}
	attachmentStatus, attachmentReceipt, attachmentBody := post(attachmentThreadID, attachmentPayload, scope.StagingScopeID, scope.Capability)
	if attachmentStatus != http.StatusAccepted || attachmentReceipt.TurnID != "turn_initial_http_attachment" || attachmentReceipt.RunID == "" {
		t.Fatalf("attachment status=%d receipt=%#v body=%s", attachmentStatus, attachmentReceipt, attachmentBody)
	}
	attachmentReadRequest := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/threads/"+attachmentThreadID+"/messages", nil)
	attachmentReadRequest.Header.Set("Origin", origin)
	attachmentReadResponse := httptest.NewRecorder()
	server.serveHTTP(attachmentReadResponse, attachmentReadRequest)
	if attachmentReadResponse.Code != http.StatusOK || !strings.Contains(attachmentReadResponse.Body.String(), upload.AttachmentID) {
		t.Fatalf("attachment read status=%d body=%s", attachmentReadResponse.Code, attachmentReadResponse.Body.String())
	}
}
