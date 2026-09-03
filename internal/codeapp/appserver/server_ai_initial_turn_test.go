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

	clientRequestID := "create_initial_http_223456789012345678901234"
	payload := `{
  "model":"openai/gpt-5-mini",
  "input":{"text":"create through the Flower HTTP boundary","attachments":[]},
  "options":{"permission_type":"approval_required"},
  "create":{"client_request_id":"` + clientRequestID + `","title":"","model_id":"openai/gpt-5-mini","permission_type":"approval_required"}
}`
	post := func(body, stagingScopeID, stagingCapability string) (int, ai.SendUserTurnResponse, string) {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/ai/turns", bytes.NewBufferString(body))
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
	firstStatus, first, firstBody := post(payload, "", "")
	if firstStatus != http.StatusAccepted || first.Kind != "start" || first.ClientRequestID != clientRequestID || first.ThreadID == "" || first.TurnID == "" {
		t.Fatalf("first status=%d receipt=%#v body=%s", firstStatus, first, firstBody)
	}
	secondStatus, second, secondBody := post(payload, "", "")
	if secondStatus != http.StatusAccepted || second.ClientRequestID != first.ClientRequestID || second.ThreadID != first.ThreadID || second.Kind != first.Kind || second.TurnID != first.TurnID || second.Current.ViewVersion < first.Current.ViewVersion {
		t.Fatalf("second status=%d receipt=%#v body=%s, want %#v", secondStatus, second, secondBody, first)
	}
	conflictingInitialPayload := strings.Replace(payload, "{", `{"client_request_id":"client_redundant",`, 1)
	conflictingInitialStatus, _, conflictingInitialBody := post(conflictingInitialPayload, "", "")
	if conflictingInitialStatus != http.StatusBadRequest {
		t.Fatalf("redundant initial identity status=%d body=%s", conflictingInitialStatus, conflictingInitialBody)
	}
	postExisting := func(body string) (int, ai.SendUserTurnResponse, string) {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/ai/threads/"+first.ThreadID+"/turns", bytes.NewBufferString(body))
		req.Header.Set("Origin", origin)
		recorder := httptest.NewRecorder()
		server.serveHTTP(recorder, req)
		var response struct {
			OK   bool                    `json:"ok"`
			Data ai.SendUserTurnResponse `json:"data"`
		}
		if recorder.Code == http.StatusAccepted {
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatalf("decode existing-thread receipt: %v", err)
			}
			if !response.OK {
				t.Fatalf("response=%s", recorder.Body.String())
			}
		}
		return recorder.Code, response.Data, recorder.Body.String()
	}
	existingRequestID := "client_existing_http_223456789012345678901234"
	existingPayload := `{"client_request_id":"` + existingRequestID + `","input":{"text":"existing request identity","attachments":[]},"options":{}}`
	existingStatus, existingReceipt, existingBody := postExisting(existingPayload)
	if existingStatus != http.StatusAccepted || existingReceipt.ClientRequestID != existingRequestID || existingReceipt.ThreadID != first.ThreadID {
		t.Fatalf("existing status=%d receipt=%#v body=%s", existingStatus, existingReceipt, existingBody)
	}
	missingIdentityStatus, _, missingIdentityBody := postExisting(`{"input":{"text":"missing request identity must not persist","attachments":[]},"options":{}}`)
	if missingIdentityStatus != http.StatusBadRequest || !strings.Contains(missingIdentityBody, "invalid client_request_id") {
		t.Fatalf("missing identity status=%d body=%s", missingIdentityStatus, missingIdentityBody)
	}
	redundantThreadStatus, _, redundantThreadBody := postExisting(`{"client_request_id":"client_redundant_thread","thread_id":"` + first.ThreadID + `","input":{"text":"redundant thread identity must not persist","attachments":[]},"options":{}}`)
	if redundantThreadStatus != http.StatusBadRequest || !strings.Contains(redundantThreadBody, "thread_id must be omitted") {
		t.Fatalf("redundant thread identity status=%d body=%s", redundantThreadStatus, redundantThreadBody)
	}
	missingIdentityRead := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/threads/"+first.ThreadID+"/messages", nil)
	missingIdentityRead.Header.Set("Origin", origin)
	missingIdentityResponse := httptest.NewRecorder()
	server.serveHTTP(missingIdentityResponse, missingIdentityRead)
	if missingIdentityResponse.Code != http.StatusOK || strings.Contains(missingIdentityResponse.Body.String(), "missing request identity must not persist") {
		t.Fatalf("missing identity mutated messages status=%d body=%s", missingIdentityResponse.Code, missingIdentityResponse.Body.String())
	}

	welcomeClientRequestID := "create_welcome_ssh_http_223456789012345678901234"
	welcomePayload := `{
  "model":"openai/gpt-5-mini",
  "input":{
    "text":"is this host reachable",
    "attachments":[],
    "context_action":{
      "schema_version":2,
      "action_id":"assistant.ask.flower",
      "provider":"flower",
      "target":{"target_id":"ssh:orange","locality":"auto"},
      "source":{"surface":"desktop_welcome_environment_card","surface_id":"saved:ssh:orange"},
      "execution_context":{"current_target_id":"ssh:orange","source_env_public_id":"env_orange","runtime_hint":"auto","session_source":"ssh_environment"},
      "context":[{"kind":"text_snapshot","title":"orange","detail":"SSH host · Unchecked","content":"Environment: orange\nKind: ssh_environment"}],
      "presentation":{"label":"Ask Flower","priority":100}
    }
  },
  "options":{"permission_type":"approval_required"},
  "create":{"client_request_id":"` + welcomeClientRequestID + `","title":"","model_id":"openai/gpt-5-mini","permission_type":"approval_required"}
}`
	welcomeStatus, welcomeReceipt, welcomeBody := post(welcomePayload, "", "")
	if welcomeStatus != http.StatusAccepted || welcomeReceipt.ClientRequestID != welcomeClientRequestID || welcomeReceipt.ThreadID == "" || welcomeReceipt.TurnID == "" {
		t.Fatalf("welcome SSH status=%d receipt=%#v body=%s", welcomeStatus, welcomeReceipt, welcomeBody)
	}

	readRequest := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/threads/"+first.ThreadID+"/messages", nil)
	readRequest.Header.Set("Origin", origin)
	readResponse := httptest.NewRecorder()
	server.serveHTTP(readResponse, readRequest)
	if readResponse.Code != http.StatusOK || !strings.Contains(readResponse.Body.String(), "create through the Flower HTTP boundary") {
		for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); {
			time.Sleep(20 * time.Millisecond)
			readResponse = httptest.NewRecorder()
			server.serveHTTP(readResponse, readRequest)
			if readResponse.Code == http.StatusOK && strings.Contains(readResponse.Body.String(), "create through the Flower HTTP boundary") {
				break
			}
		}
	}
	if readResponse.Code != http.StatusOK || !strings.Contains(readResponse.Body.String(), "create through the Flower HTTP boundary") {
		t.Fatalf("canonical read status=%d body=%s", readResponse.Code, readResponse.Body.String())
	}

	welcomeReadRequest := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/threads/"+welcomeReceipt.ThreadID+"/messages", nil)
	welcomeReadRequest.Header.Set("Origin", origin)
	welcomeReadResponse := httptest.NewRecorder()
	server.serveHTTP(welcomeReadResponse, welcomeReadRequest)
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline) &&
		(welcomeReadResponse.Code != http.StatusOK ||
			!strings.Contains(welcomeReadResponse.Body.String(), "is this host reachable") ||
			!strings.Contains(welcomeReadResponse.Body.String(), "orange")); {
		time.Sleep(20 * time.Millisecond)
		welcomeReadResponse = httptest.NewRecorder()
		server.serveHTTP(welcomeReadResponse, welcomeReadRequest)
	}
	if welcomeReadResponse.Code != http.StatusOK ||
		!strings.Contains(welcomeReadResponse.Body.String(), "is this host reachable") ||
		!strings.Contains(welcomeReadResponse.Body.String(), "orange") {
		t.Fatalf("welcome canonical read status=%d body=%s", welcomeReadResponse.Code, welcomeReadResponse.Body.String())
	}

	unknownPayload := `{"client_request_id":"client_unknown_thread","model":"openai/gpt-5-mini","input":{"text":"must not create","attachments":[]},"options":{}}`
	unknownRequest := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/ai/threads/th_223456789012345678901235/turns", bytes.NewBufferString(unknownPayload))
	unknownRequest.Header.Set("Origin", origin)
	unknownResponse := httptest.NewRecorder()
	server.serveHTTP(unknownResponse, unknownRequest)
	if unknownResponse.Code != http.StatusNotFound {
		t.Fatalf("unknown thread status=%d body=%s", unknownResponse.Code, unknownResponse.Body.String())
	}

	legacyFields := []string{
		`"expected_run_id":"run_legacy"`,
		`"queue_after_waiting_user":true`,
		`"input":{"turn_id":"turn_legacy","text":"legacy","attachments":[]}`,
	}
	for _, legacyField := range legacyFields {
		input := `"input":{"text":"legacy","attachments":[]}`
		if strings.HasPrefix(legacyField, `"input"`) {
			input = legacyField
			legacyField = ""
		}
		legacyPayload := `{"client_request_id":"client_legacy_shape",` + input + `,"options":{}`
		if legacyField != "" {
			legacyPayload += `,` + legacyField
		}
		legacyPayload += `}`
		legacyRequest := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/ai/threads/"+first.ThreadID+"/turns", bytes.NewBufferString(legacyPayload))
		legacyRequest.Header.Set("Origin", origin)
		legacyResponse := httptest.NewRecorder()
		server.serveHTTP(legacyResponse, legacyRequest)
		if legacyResponse.Code != http.StatusBadRequest || !strings.Contains(legacyResponse.Body.String(), "invalid json") {
			t.Fatalf("legacy send field payload=%s status=%d body=%s, want strict unknown-field rejection", legacyPayload, legacyResponse.Code, legacyResponse.Body.String())
		}
	}

	attachmentClientRequestID := "create_initial_http_attachment_223456789012345678901236"
	owner, err := ai.NewUploadOwner(meta.EndpointID, meta.UserPublicID, meta.ChannelID)
	if err != nil {
		t.Fatal(err)
	}
	scope, err := aiService.CreateUploadStagingScope(t.Context(), owner, attachmentClientRequestID)
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
  "staging_scope_id":"` + scope.StagingScopeID + `",
  "model":"openai/gpt-5-mini",
  "input":{"text":"read this attachment","attachments":[{"attachment_id":"` + upload.AttachmentID + `"}]},
  "options":{"permission_type":"approval_required"},
  "create":{"client_request_id":"` + attachmentClientRequestID + `","model_id":"openai/gpt-5-mini","permission_type":"approval_required"}
}`
	partialStatus, _, partialBody := post(attachmentPayload, scope.StagingScopeID, "")
	if partialStatus != http.StatusBadRequest {
		t.Fatalf("partial staging headers status=%d body=%s", partialStatus, partialBody)
	}
	attachmentStatus, attachmentReceipt, attachmentBody := post(attachmentPayload, scope.StagingScopeID, scope.Capability)
	if attachmentStatus != http.StatusAccepted || attachmentReceipt.ClientRequestID != attachmentClientRequestID || attachmentReceipt.ThreadID == "" || attachmentReceipt.TurnID == "" {
		t.Fatalf("attachment status=%d receipt=%#v body=%s", attachmentStatus, attachmentReceipt, attachmentBody)
	}
	attachmentReadRequest := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/threads/"+attachmentReceipt.ThreadID+"/messages", nil)
	attachmentReadRequest.Header.Set("Origin", origin)
	attachmentReadResponse := httptest.NewRecorder()
	server.serveHTTP(attachmentReadResponse, attachmentReadRequest)
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline) &&
		(attachmentReadResponse.Code != http.StatusOK || !strings.Contains(attachmentReadResponse.Body.String(), upload.AttachmentID)); {
		time.Sleep(20 * time.Millisecond)
		attachmentReadResponse = httptest.NewRecorder()
		server.serveHTTP(attachmentReadResponse, attachmentReadRequest)
	}
	if attachmentReadResponse.Code != http.StatusOK || !strings.Contains(attachmentReadResponse.Body.String(), upload.AttachmentID) {
		t.Fatalf("attachment read status=%d body=%s", attachmentReadResponse.Code, attachmentReadResponse.Body.String())
	}
}
