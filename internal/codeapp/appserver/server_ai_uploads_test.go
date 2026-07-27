package appserver

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func newUploadRouteServerWithAIConfig(t *testing.T, aiConfig *config.AIConfig) (*Server, *ai.Service, string, string) {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	stateDir := t.TempDir()
	aiSvc, err := ai.NewService(ai.Options{
		Logger: logger, StateDir: stateDir, AgentHomeDir: stateDir,
		Config:                aiConfig,
		ResolveProviderAPIKey: func(string) (string, bool, error) { return "test", true, nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = aiSvc.Close() })
	ownerChannel := "ch_upload_owner"
	otherChannel := "ch_upload_other"
	metas := map[string]*session.Meta{
		ownerChannel: {ChannelID: ownerChannel, EndpointID: "env_upload", UserPublicID: "user_owner", CanRead: true, CanWrite: true, CanExecute: true},
		otherChannel: {ChannelID: otherChannel, EndpointID: "env_upload", UserPublicID: "user_other", CanRead: true, CanWrite: true, CanExecute: true},
	}
	srv, err := New(Options{
		Logger: logger, Backend: &stubBackend{}, ListenAddr: "127.0.0.1:0", AIServiceProvider: newStaticAIServiceProvider(aiSvc),
		DistFS:             fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}, "inject.js": {Data: []byte("ok")}},
		ConfigPath:         writeTestConfigWithAI(t),
		ResolveSessionMeta: func(channelID string) (*session.Meta, bool) { meta, ok := metas[channelID]; return meta, ok },
	})
	if err != nil {
		t.Fatal(err)
	}
	return srv, aiSvc, envOriginWithChannel(ownerChannel), envOriginWithChannel(otherChannel)
}

func newUploadRouteServer(t *testing.T) (*Server, string, string) {
	t.Helper()
	srv, _, ownerOrigin, otherOrigin := newUploadRouteServerWithAIConfig(t, &config.AIConfig{
		CurrentModelID: "openai/test",
		Providers: []config.AIProvider{{
			ID: "openai", Type: "openai", Models: []config.AIProviderModel{{ModelName: "test"}},
		}},
	})
	return srv, ownerOrigin, otherOrigin
}

type uploadRouteStagingScope struct {
	StagingScopeID string
	Capability     string
}

func createUploadRouteStagingScope(t *testing.T, srv *Server, origin, threadID string) uploadRouteStagingScope {
	t.Helper()
	response := performServerRequest(srv, http.MethodPost, "/_redeven_proxy/api/ai/upload-staging-scopes", origin, `{"thread_id":"`+threadID+`"}`)
	if response.Code != http.StatusCreated {
		t.Fatalf("create staging scope status=%d body=%s", response.Code, response.Body.String())
	}
	var body struct {
		Data struct {
			StagingScopeID string `json:"staging_scope_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	scope := uploadRouteStagingScope{StagingScopeID: body.Data.StagingScopeID, Capability: response.Header().Get(uploadStagingCapabilityHeader)}
	if scope.StagingScopeID == "" || scope.Capability == "" {
		t.Fatalf("invalid staging scope response body=%s headers=%v", response.Body.String(), response.Header())
	}
	if bytes.Contains(response.Body.Bytes(), []byte(scope.Capability)) {
		t.Fatal("staging capability leaked into response JSON")
	}
	return scope
}

func authorizeUploadRouteRequest(req *http.Request, scope uploadRouteStagingScope) {
	req.Header.Set(uploadStagingScopeIDHeader, scope.StagingScopeID)
	req.Header.Set(uploadStagingCapabilityHeader, scope.Capability)
}

func uploadMultipartRequest(t *testing.T, body []byte, requestID string, origin string, scope uploadRouteStagingScope) *http.Request {
	t.Helper()
	var payload bytes.Buffer
	writer := multipart.NewWriter(&payload)
	if err := writer.WriteField("source", "uploaded_file"); err != nil {
		t.Fatal(err)
	}
	part, err := writer.CreateFormFile("file", "notes.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(body); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/ai/uploads", bytes.NewReader(payload.Bytes()))
	req.Header.Set("Origin", origin)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Idempotency-Key", requestID)
	authorizeUploadRouteRequest(req, scope)
	digest := sha256.Sum256(body)
	nameDigest := sha256.Sum256([]byte("notes.txt"))
	req.Header.Set("Upload-Content-SHA256", fmt.Sprintf("%x", digest[:]))
	req.Header.Set("Upload-Content-Length", fmt.Sprintf("%d", len(body)))
	req.Header.Set("Upload-Display-Name-SHA256", fmt.Sprintf("%x", nameDigest[:]))
	return req
}

func TestAIUploadRoutesEnforceOwnerAndSupportHeadRangeDelete(t *testing.T) {
	t.Parallel()
	srv, ownerOrigin, otherOrigin := newUploadRouteServer(t)
	scope := createUploadRouteStagingScope(t, srv, ownerOrigin, "th_123456789012345678901234")
	body := []byte("abcdef")
	post := httptest.NewRecorder()
	srv.serveHTTP(post, uploadMultipartRequest(t, body, "route_request_1", ownerOrigin, scope))
	if post.Code != http.StatusOK {
		t.Fatalf("POST status=%d body=%s", post.Code, post.Body.String())
	}
	var response struct {
		OK   bool              `json:"ok"`
		Data ai.UploadResponse `json:"data"`
	}
	if err := json.Unmarshal(post.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if !response.OK || response.Data.AttachmentID == "" || response.Data.ContentSHA256 == "" {
		t.Fatalf("response=%#v", response)
	}
	path := "/_redeven_proxy/api/ai/uploads/" + response.Data.AttachmentID

	headReq := httptest.NewRequest(http.MethodHead, path, nil)
	headReq.Header.Set("Origin", ownerOrigin)
	authorizeUploadRouteRequest(headReq, scope)
	head := httptest.NewRecorder()
	srv.serveHTTP(head, headReq)
	if head.Code != http.StatusOK || head.Body.Len() != 0 || head.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("HEAD status=%d headers=%v body=%q", head.Code, head.Header(), head.Body.String())
	}

	rangeReq := httptest.NewRequest(http.MethodGet, path, nil)
	rangeReq.Header.Set("Origin", ownerOrigin)
	authorizeUploadRouteRequest(rangeReq, scope)
	rangeReq.Header.Set("Range", "bytes=1-3")
	rangeResp := httptest.NewRecorder()
	srv.serveHTTP(rangeResp, rangeReq)
	if rangeResp.Code != http.StatusPartialContent || rangeResp.Body.String() != "bcd" || rangeResp.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("Range status=%d headers=%v body=%q", rangeResp.Code, rangeResp.Header(), rangeResp.Body.String())
	}
	if disposition := rangeResp.Header().Get("Content-Disposition"); !bytes.Contains([]byte(disposition), []byte("attachment")) {
		t.Fatalf("download disposition=%q, want attachment", disposition)
	}

	previewReq := httptest.NewRequest(http.MethodGet, path+"?preview=1", nil)
	previewReq.Header.Set("Origin", ownerOrigin)
	authorizeUploadRouteRequest(previewReq, scope)
	previewResp := httptest.NewRecorder()
	srv.serveHTTP(previewResp, previewReq)
	if previewResp.Code != http.StatusOK || previewResp.Body.String() != string(body) {
		t.Fatalf("preview status=%d body=%q", previewResp.Code, previewResp.Body.String())
	}
	if disposition := previewResp.Header().Get("Content-Disposition"); !bytes.Contains([]byte(disposition), []byte("inline")) {
		t.Fatalf("preview disposition=%q, want inline", disposition)
	}
	if policy := previewResp.Header().Get("Content-Security-Policy"); !strings.Contains(policy, "sandbox") || !strings.Contains(policy, "default-src 'none'") {
		t.Fatalf("preview CSP=%q, want sandboxed closed policy", policy)
	}

	ambiguousReq := httptest.NewRequest(http.MethodGet, path+"?thread_id=thread_forged&turn_id=turn_forged", nil)
	ambiguousReq.Header.Set("Origin", ownerOrigin)
	ambiguousResp := httptest.NewRecorder()
	srv.serveHTTP(ambiguousResp, ambiguousReq)
	if ambiguousResp.Code != http.StatusNotFound || !bytes.Contains(ambiguousResp.Body.Bytes(), []byte(ai.UploadErrorNotFound)) {
		t.Fatalf("ambiguous audience status=%d body=%s", ambiguousResp.Code, ambiguousResp.Body.String())
	}

	otherReq := httptest.NewRequest(http.MethodGet, path, nil)
	otherReq.Header.Set("Origin", otherOrigin)
	authorizeUploadRouteRequest(otherReq, scope)
	otherResp := httptest.NewRecorder()
	srv.serveHTTP(otherResp, otherReq)
	if otherResp.Code != http.StatusNotFound || !bytes.Contains(otherResp.Body.Bytes(), []byte(ai.UploadErrorNotFound)) {
		t.Fatalf("other status=%d body=%s", otherResp.Code, otherResp.Body.String())
	}

	deleteReq := httptest.NewRequest(http.MethodDelete, path, nil)
	deleteReq.Header.Set("Origin", ownerOrigin)
	authorizeUploadRouteRequest(deleteReq, scope)
	deleteResp := httptest.NewRecorder()
	srv.serveHTTP(deleteResp, deleteReq)
	if deleteResp.Code != http.StatusOK {
		t.Fatalf("DELETE status=%d body=%s", deleteResp.Code, deleteResp.Body.String())
	}
	secondDeleteReq := httptest.NewRequest(http.MethodDelete, path, nil)
	secondDeleteReq.Header.Set("Origin", ownerOrigin)
	authorizeUploadRouteRequest(secondDeleteReq, scope)
	secondDeleteResp := httptest.NewRecorder()
	srv.serveHTTP(secondDeleteResp, secondDeleteReq)
	if secondDeleteResp.Code != http.StatusNotFound {
		t.Fatalf("second DELETE status=%d body=%s", secondDeleteResp.Code, secondDeleteResp.Body.String())
	}
	missingReq := httptest.NewRequest(http.MethodGet, path, nil)
	missingReq.Header.Set("Origin", ownerOrigin)
	authorizeUploadRouteRequest(missingReq, scope)
	missingResp := httptest.NewRecorder()
	srv.serveHTTP(missingResp, missingReq)
	if missingResp.Code != http.StatusNotFound {
		t.Fatalf("GET after delete status=%d body=%s", missingResp.Code, missingResp.Body.String())
	}
}

func TestAIUploadPreviewNeverReturnsActiveTextMediaInline(t *testing.T) {
	t.Parallel()
	srv, ownerOrigin, _ := newUploadRouteServer(t)
	scope := createUploadRouteStagingScope(t, srv, ownerOrigin, "th_223456789012345678901234")
	body := []byte(`<!doctype html><script>globalThis.compromised = true</script>`)
	post := httptest.NewRecorder()
	srv.serveHTTP(post, uploadMultipartRequest(t, body, "route_active_text", ownerOrigin, scope))
	if post.Code != http.StatusOK {
		t.Fatalf("POST status=%d body=%s", post.Code, post.Body.String())
	}
	var response struct {
		Data ai.UploadResponse `json:"data"`
	}
	if err := json.Unmarshal(post.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Data.DetectedMediaType != "text/plain; charset=utf-8" {
		t.Fatalf("detected media type=%q, want canonical plain text", response.Data.DetectedMediaType)
	}
	preview := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/uploads/"+response.Data.AttachmentID+"?preview=1", nil)
	req.Header.Set("Origin", ownerOrigin)
	authorizeUploadRouteRequest(req, scope)
	srv.serveHTTP(preview, req)
	if preview.Code != http.StatusOK || preview.Body.String() != string(body) {
		t.Fatalf("preview status=%d body=%q", preview.Code, preview.Body.String())
	}
	if contentType := preview.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "text/plain") {
		t.Fatalf("preview content type=%q, want text/plain", contentType)
	}
	if disposition := preview.Header().Get("Content-Disposition"); !strings.Contains(disposition, "inline") {
		t.Fatalf("preview disposition=%q, want inline safe text", disposition)
	}
	if _, ok := safeInlineAttachmentMediaType("text/html; charset=utf-8"); ok {
		t.Fatal("text/html unexpectedly admitted to inline preview allowlist")
	}
}

func TestAIComposerDraftRoutesAreRemoved(t *testing.T) {
	t.Parallel()
	srv, ownerOrigin, _ := newUploadRouteServer(t)
	const scopePath = "/_redeven_proxy/api/ai/composer-drafts/thread_lease_redaction"
	removed := performServerRequest(srv, http.MethodGet, scopePath, ownerOrigin, "")
	if removed.Code != http.StatusNotFound {
		t.Fatalf("removed composer route status=%d body=%s", removed.Code, removed.Body.String())
	}
}

func TestAIComposerDraftRoutesStayRemovedWithoutConfiguredModel(t *testing.T) {
	t.Parallel()
	srv, aiSvc, ownerOrigin, _ := newUploadRouteServerWithAIConfig(t, &config.AIConfig{})
	if aiSvc.Enabled() {
		t.Fatal("AI service unexpectedly has a configured model")
	}
	const scopePath = "/_redeven_proxy/api/ai/composer-drafts/unconfigured_model_draft"
	removed := performServerRequest(srv, http.MethodGet, scopePath, ownerOrigin, "")
	if removed.Code != http.StatusNotFound {
		t.Fatalf("removed composer route status=%d body=%s", removed.Code, removed.Body.String())
	}
}

func TestAIUploadRouteRejectsUnknownMultipartPartsWithTypedError(t *testing.T) {
	t.Parallel()
	srv, ownerOrigin, _ := newUploadRouteServer(t)
	var payload bytes.Buffer
	writer := multipart.NewWriter(&payload)
	_ = writer.WriteField("unexpected", "value")
	part, _ := writer.CreateFormFile("file", "notes.txt")
	_, _ = part.Write([]byte("body"))
	_ = writer.Close()
	req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/ai/uploads", bytes.NewReader(payload.Bytes()))
	req.Header.Set("Origin", ownerOrigin)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := httptest.NewRecorder()
	srv.serveHTTP(resp, req)
	if resp.Code != http.StatusBadRequest || !bytes.Contains(resp.Body.Bytes(), []byte(ai.UploadErrorInvalidRequest)) {
		t.Fatalf("status=%d body=%s", resp.Code, resp.Body.String())
	}
}

func TestAIUploadRouteEnforcesOverallMultipartHardCap(t *testing.T) {
	srv, ownerOrigin, _ := newUploadRouteServer(t)
	scope := createUploadRouteStagingScope(t, srv, ownerOrigin, "th_323456789012345678901234")
	body := bytes.Repeat([]byte{'x'}, (10<<20)+(64<<10))
	req := uploadMultipartRequest(t, body, "route_oversized", ownerOrigin, scope)
	resp := httptest.NewRecorder()
	srv.serveHTTP(resp, req)
	if resp.Code != http.StatusRequestEntityTooLarge || !bytes.Contains(resp.Body.Bytes(), []byte(ai.UploadErrorTooLarge)) {
		t.Fatalf("status=%d body=%s", resp.Code, resp.Body.String())
	}
}

func TestAIUserTurnDecoderAcceptsCurrentFlowerPayloadAndRejectsRemovedDraftShape(t *testing.T) {
	payload := `{
  "thread_id":"th_123456789012345678901234",
  "staging_scope_id":"ustg_scope",
  "model":"openai/test",
  "input":{"turn_id":"turn_123","text":"hello","attachments":[{"attachment_id":"upl_123"}]},
  "options":{"permission_type":"approval_required"},
  "create":{"title":"","model_id":"openai/test","permission_type":"approval_required"}
}`
	decoded, err := decodeAIUserTurnRequest(strings.NewReader(payload))
	if err != nil {
		t.Fatalf("current Flower payload decoded as invalid json: %v", err)
	}
	if decoded.Create == nil || decoded.Create.ModelID != "openai/test" || decoded.StagingScopeID != "ustg_scope" || decoded.Input.TurnID != "turn_123" {
		t.Fatalf("decoded payload=%#v", decoded)
	}
	legacy := `{"thread_id":"th_123456789012345678901234","draft_id":"draft_1","expected_draft_revision":1,"input":{"text":"hello","attachments":[]},"options":{}}`
	if _, err := decodeAIUserTurnRequest(strings.NewReader(legacy)); err == nil {
		t.Fatal("removed composer draft payload was accepted")
	}
	request := httptest.NewRequest(http.MethodPost, "/", nil)
	if scopeID, capability, err := optionalUploadStagingHeaders(request); err != nil || scopeID != "" || capability != "" {
		t.Fatalf("optional empty staging headers=(%q,%q,%v)", scopeID, capability, err)
	}
	request.Header.Set(uploadStagingScopeIDHeader, "scope_1")
	if _, _, err := optionalUploadStagingHeaders(request); err == nil {
		t.Fatal("partial staging authorization headers were accepted")
	}
	request.Header.Set(uploadStagingCapabilityHeader, "secret_1")
	if scopeID, capability, err := optionalUploadStagingHeaders(request); err != nil || scopeID != "scope_1" || capability != "secret_1" {
		t.Fatalf("exact staging headers=(%q,%q,%v)", scopeID, capability, err)
	}
	request.Header.Add(uploadStagingCapabilityHeader, "secret_2")
	if _, _, err := optionalUploadStagingHeaders(request); err == nil {
		t.Fatal("duplicate staging capability headers were accepted")
	}
}
