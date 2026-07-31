package ai

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/floegence/floret/v3/identity"
	flruntime "github.com/floegence/floret/v3/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

func TestSendInitialUserTurnCreatesCanonicalThreadBeforeAdmission(t *testing.T) {
	svc := newSendTurnTestService(t)
	enableInitialTurnTestProvider(t, svc)
	meta := testSendTurnMeta()
	clientRequestID := "create_initial_canonical"

	receipt, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{
		Create: &CreateThreadRequest{
			ClientRequestID: clientRequestID,
			ModelID:         "openai/gpt-5-mini",
			PermissionType:  "approval_required",
		},
		Model: "openai/gpt-5-mini",
		Input: RunInput{Text: "create the first canonical turn"},
	})
	if err != nil {
		t.Fatalf("SendUserTurn(create): %v", err)
	}
	if receipt.Kind != "start" || receipt.ClientRequestID != clientRequestID || receipt.ThreadID == "" || receipt.TurnID == "" || receipt.RunID == "" {
		t.Fatalf("receipt=%#v", receipt)
	}

	settings, err := svc.threadsDB.GetThreadSettings(t.Context(), meta.EndpointID, receipt.ThreadID)
	if err != nil || settings == nil {
		t.Fatalf("thread settings=%#v err=%v", settings, err)
	}
	host, err := svc.openFloretThreadReadHost(t.Context(), receipt.ThreadID)
	if err != nil {
		t.Fatalf("open canonical thread: %v", err)
	}
	turn, err := host.ReadThreadTurn(t.Context(), identity.TurnID(receipt.TurnID))
	if err != nil {
		t.Fatalf("ReadThreadTurn: %v", err)
	}
	if string(turn.RunID) != receipt.RunID || turn.UserInput != "create the first canonical turn" {
		t.Fatalf("canonical turn=%#v receipt=%#v", turn, receipt)
	}
}

func TestSendInitialUserTurnSerialRetryReturnsCanonicalReceipt(t *testing.T) {
	svc := newSendTurnTestService(t)
	enableInitialTurnTestProvider(t, svc)
	meta := testSendTurnMeta()
	req := initialTurnRequestForTest("create_initial_retry", "retry the same first turn")

	first, err := svc.SendUserTurn(t.Context(), meta, req)
	if err != nil {
		t.Fatalf("first SendUserTurn: %v", err)
	}
	second, err := svc.SendUserTurn(t.Context(), meta, req)
	if err != nil {
		t.Fatalf("retry SendUserTurn: %v", err)
	}
	if second != first {
		t.Fatalf("retry receipt=%#v, want %#v", second, first)
	}
	turns, err := listAllFloretThreadTurns(t.Context(), mustOpenInitialTurnReadHost(t, svc, first.ThreadID), first.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if len(turns) != 1 || string(turns[0].TurnID) != first.TurnID || string(turns[0].RunID) != first.RunID {
		t.Fatalf("canonical turns=%#v receipt=%#v", turns, first)
	}
	queueID := stableInitialQueueID(meta.EndpointID, meta.UserPublicID, req.Create.ClientRequestID)
	if _, err := svc.threadsDB.GetQueuedTurn(t.Context(), meta.EndpointID, first.ThreadID, queueID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("admitted command error=%v, want removed", err)
	}

	changed := req
	changed.Input.Text = "changed first turn"
	if _, err := svc.SendUserTurn(t.Context(), meta, changed); !errors.Is(err, ErrTurnIdempotencyConflict) {
		t.Fatalf("changed retry error=%v, want %v", err, ErrTurnIdempotencyConflict)
	}
}

func TestSendInitialUserTurnConcurrentRetryReusesFrozenIdentity(t *testing.T) {
	svc := newSendTurnTestService(t)
	enableInitialTurnTestProvider(t, svc)
	meta := testSendTurnMeta()
	req := initialTurnRequestForTest("create_initial_concurrent", "concurrent first turn")

	start := make(chan struct{})
	responses := make([]SendUserTurnResponse, 2)
	errs := make([]error, 2)
	var wg sync.WaitGroup
	for index := range responses {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			<-start
			responses[index], errs[index] = svc.SendUserTurn(t.Context(), meta, req)
		}(index)
	}
	close(start)
	wg.Wait()
	for index, err := range errs {
		if err != nil {
			t.Fatalf("request %d: %v", index, err)
		}
	}
	if responses[0] != responses[1] || responses[0].ThreadID == "" || responses[0].RunID == "" || responses[0].TurnID == "" {
		t.Fatalf("responses=%#v", responses)
	}
	turns, err := listAllFloretThreadTurns(t.Context(), mustOpenInitialTurnReadHost(t, svc, responses[0].ThreadID), responses[0].ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if len(turns) != 1 || string(turns[0].RunID) != responses[0].RunID {
		t.Fatalf("canonical turns=%#v responses=%#v", turns, responses)
	}
}

func TestSendInitialUserTurnTransfersStagingAttachmentToCanonicalTurn(t *testing.T) {
	svc := newSendTurnTestService(t)
	enableInitialTurnTestProvider(t, svc)
	meta := testSendTurnMeta()
	req := initialTurnRequestForTest("create_initial_attachment", "read the attached note")
	owner, err := NewUploadOwner(meta.EndpointID, meta.UserPublicID, meta.ChannelID)
	if err != nil {
		t.Fatal(err)
	}
	scope, err := svc.CreateUploadStagingScope(t.Context(), owner, req.Create.ClientRequestID)
	if err != nil {
		t.Fatal(err)
	}
	content := []byte("the exact initial attachment\n")
	contentDigest := sha256.Sum256(content)
	name := "initial-note.txt"
	nameDigest := sha256.Sum256([]byte(name))
	upload, err := svc.SaveUpload(t.Context(), SaveUploadRequest{
		Owner: owner, StagingScopeID: scope.StagingScopeID, StagingCapability: scope.Capability,
		Reader: bytes.NewReader(content), DisplayName: name, DeclaredMediaType: "text/plain", Source: threadstore.UploadSourceFile,
		UploadRequestID: "upload_initial_attachment", ExpectedContentSHA256: hex.EncodeToString(contentDigest[:]), ExpectedSizeBytes: int64(len(content)),
		DisplayNameSHA256: hex.EncodeToString(nameDigest[:]), MaxBytes: 1 << 20,
	})
	if err != nil {
		t.Fatal(err)
	}
	req.StagingScopeID = scope.StagingScopeID
	req.StagingCapability = scope.Capability
	req.Input.Attachments = []RunAttachmentIn{{AttachmentID: upload.AttachmentID}}

	first, err := svc.SendUserTurn(t.Context(), meta, req)
	if err != nil {
		t.Fatal(err)
	}
	retried, err := svc.SendUserTurn(t.Context(), meta, req)
	if err != nil || retried != first {
		t.Fatalf("retry=%#v err=%v, want %#v", retried, err, first)
	}
	turn, err := mustOpenInitialTurnReadHost(t, svc, first.ThreadID).ReadThreadTurn(t.Context(), identity.TurnID(first.TurnID))
	if err != nil {
		t.Fatal(err)
	}
	if len(turn.UserAttachments) != 1 {
		t.Fatalf("canonical attachments=%#v", turn.UserAttachments)
	}
	canonicalUploadID, err := uploadIDFromFloretResourceRef(turn.UserAttachments[0].ResourceRef)
	if err != nil || canonicalUploadID != upload.AttachmentID {
		t.Fatalf("canonical attachment=%#v upload=%#v err=%v", turn.UserAttachments[0], upload, err)
	}
	owned, err := svc.threadsDB.GetThreadOwnedUpload(t.Context(), meta.EndpointID, first.ThreadID, upload.AttachmentID)
	if err != nil || owned == nil || owned.ContentSHA256 != hex.EncodeToString(contentDigest[:]) {
		t.Fatalf("thread-owned upload=%#v err=%v", owned, err)
	}
}

func TestExistingProductThreadWithoutCanonicalRootStillFailsClosed(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	threadID := "th_123456789012345678901237"
	if err := svc.threadsDB.CreateThreadSettings(t.Context(), threadstore.ThreadSettings{
		ThreadID: threadID, EndpointID: meta.EndpointID, NamespacePublicID: meta.NamespacePublicID,
		ModelID: "openai/gpt-5-mini", PermissionType: "approval_required", WorkingDir: svc.agentHomeDir,
		CreatedByUserPublicID: meta.UserPublicID, CreatedByUserEmail: meta.UserEmail,
		UpdatedByUserPublicID: meta.UserPublicID, UpdatedByUserEmail: meta.UserEmail,
		SettingsCreatedAtUnixMs: time.Now().UnixMilli(), SettingsUpdatedAtUnixMs: time.Now().UnixMilli(),
	}); err != nil {
		t.Fatal(err)
	}
	_, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{
		ThreadID: threadID, Model: "openai/gpt-5-mini", Input: RunInput{TurnID: "turn_missing_root", Text: "must not recreate"},
	})
	if !errors.Is(err, flruntime.ErrThreadNotFound) {
		t.Fatalf("SendUserTurn error=%v, want %v", err, flruntime.ErrThreadNotFound)
	}
}

func TestSendInitialUserTurnResumesPreparedCreateBeforeCanonicalRoot(t *testing.T) {
	svc := newSendTurnTestService(t)
	enableInitialTurnTestProvider(t, svc)
	meta := testSendTurnMeta()
	req := initialTurnRequestForTest("create_initial_prepared", "resume prepared create")
	operation, frozen := prepareInitialTurnStateForTest(t, svc, meta, req)
	if operation.Status != threadstore.ThreadCreateOperationPending || frozen.AdmissionState != threadstore.PendingTurnAdmissionReady {
		t.Fatalf("operation=%#v frozen=%#v", operation, frozen)
	}
	if operation.CanonicalThreadID != "" || frozen.ThreadID != "" || frozen.TurnID != "" || frozen.RunID != "" {
		t.Fatalf("prepared operation allocated canonical identity: operation=%#v frozen=%#v", operation, frozen)
	}

	receipt, err := svc.SendUserTurn(t.Context(), meta, req)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.ThreadID == "" || receipt.RunID == "" || receipt.TurnID == "" {
		t.Fatalf("receipt=%#v", receipt)
	}
}

func TestSendInitialUserTurnResumesCommittedCreateBeforeAdmission(t *testing.T) {
	svc := newSendTurnTestService(t)
	enableInitialTurnTestProvider(t, svc)
	meta := testSendTurnMeta()
	req := initialTurnRequestForTest("create_initial_committed", "resume committed create")
	operation, frozen := prepareInitialTurnStateForTest(t, svc, meta, req)
	if _, err := svc.resumeThreadCreateOperation(t.Context(), operation); err != nil {
		t.Fatal(err)
	}
	stored, err := svc.threadsDB.GetThreadCreateOperation(t.Context(), operation.OperationID)
	if err != nil || stored.Status != threadstore.ThreadCreateOperationCommitted {
		t.Fatalf("committed operation=%#v err=%v", stored, err)
	}

	receipt, err := svc.SendUserTurn(t.Context(), meta, req)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.ThreadID == "" || receipt.RunID == "" || receipt.TurnID == "" {
		t.Fatalf("receipt=%#v frozen=%#v", receipt, frozen)
	}
}

func TestSendInitialUserTurnPersistsInFlightAdmissionWithoutCanonicalIdentity(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	req := initialTurnRequestForTest("create_initial_in_flight", "recover in-flight create")
	operation, frozen := prepareInitialTurnStateForTest(t, svc, meta, req)
	settings, err := svc.resumeThreadCreateOperation(t.Context(), operation)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.threadsDB.BeginPendingTurnAdmission(t.Context(), meta.EndpointID, settings.ThreadID, frozen.QueueID, frozen.QueueID); err != nil {
		t.Fatal(err)
	}
	receipt, err := svc.threadsDB.GetPendingTurnAdmissionReceipt(t.Context(), frozen.QueueID)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.Stage != threadstore.PendingTurnAdmissionStageInFlight || receipt.ThreadID != settings.ThreadID || receipt.TurnID != "" || receipt.RunID != "" {
		t.Fatalf("receipt=%#v", receipt)
	}
}

func TestSendInitialUserTurnResumesAfterRestartFromAtomicPrepare(t *testing.T) {
	stateDir := t.TempDir()
	agentHomeDir := t.TempDir()
	meta := testSendTurnMeta()
	req := initialTurnRequestForTest("create_initial_restart", "resume after restart")
	first := newSendTurnTestServiceAt(t, stateDir, agentHomeDir)
	_, frozen := prepareInitialTurnStateForTest(t, first, meta, req)
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	restarted := newSendTurnTestServiceAt(t, stateDir, agentHomeDir)
	enableInitialTurnTestProvider(t, restarted)
	receipt, err := restarted.SendUserTurn(t.Context(), meta, req)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.ThreadID == "" || receipt.RunID == "" || receipt.TurnID == "" {
		t.Fatalf("receipt=%#v frozen=%#v", receipt, frozen)
	}
	turns, err := listAllFloretThreadTurns(t.Context(), mustOpenInitialTurnReadHost(t, restarted, receipt.ThreadID), receipt.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if len(turns) != 1 {
		t.Fatalf("canonical turns=%#v", turns)
	}
}

func TestSendInitialUserTurnRejectsChangedFrozenIntent(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	req := initialTurnRequestForTest("create_initial_conflict", "frozen first turn")
	_, _ = prepareInitialTurnStateForTest(t, svc, meta, req)

	tests := []struct {
		name   string
		mutate func(*SendUserTurnRequest)
		want   error
	}{
		{name: "text", mutate: func(changed *SendUserTurnRequest) { changed.Input.Text = "different" }, want: ErrTurnIdempotencyConflict},
		{name: "options", mutate: func(changed *SendUserTurnRequest) { changed.Options.NoUserInteraction = true }, want: ErrTurnIdempotencyConflict},
		{name: "permission", mutate: func(changed *SendUserTurnRequest) { changed.Create.PermissionType = "full_access" }, want: ErrInitialTurnStateConflict},
		{name: "title", mutate: func(changed *SendUserTurnRequest) { changed.Create.Title = "Different" }, want: ErrInitialTurnStateConflict},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			changed := req
			create := *req.Create
			changed.Create = &create
			testCase.mutate(&changed)
			_, err := svc.SendUserTurn(t.Context(), meta, changed)
			if !errors.Is(err, testCase.want) {
				t.Fatalf("error=%v, want %v", err, testCase.want)
			}
		})
	}
}

func TestInitialTurnFailureLogIsStructuredAndSanitized(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	req := initialTurnRequestForTest("create_initial_log", "original frozen text")
	_, _ = prepareInitialTurnStateForTest(t, svc, meta, req)

	var output bytes.Buffer
	svc.log = slog.New(slog.NewTextHandler(&output, nil))
	changed := req
	changed.Input.Text = "sensitive message body must not be logged"
	changed.StagingCapability = "ustgc_sensitive_capability"
	if _, err := svc.SendUserTurn(t.Context(), meta, changed); !errors.Is(err, ErrTurnIdempotencyConflict) {
		t.Fatalf("error=%v, want %v", err, ErrTurnIdempotencyConflict)
	}
	logged := output.String()
	for _, want := range []string{
		"phase=" + initialTurnPhaseLookupFrozenState,
		"client_request_id=" + req.Create.ClientRequestID,
		"turn_id=\"\"",
		"error_class=idempotency_conflict",
	} {
		if !strings.Contains(logged, want) {
			t.Fatalf("log=%q, want %q", logged, want)
		}
	}
	for _, forbidden := range []string{changed.Input.Text, changed.StagingCapability, "original frozen text"} {
		if strings.Contains(logged, forbidden) {
			t.Fatalf("log leaked %q: %s", forbidden, logged)
		}
	}
}

func initialTurnRequestForTest(clientRequestID, text string) SendUserTurnRequest {
	return SendUserTurnRequest{
		Create: &CreateThreadRequest{
			ClientRequestID: clientRequestID,
			ModelID:         "openai/gpt-5-mini",
			PermissionType:  "approval_required",
		},
		Model: "openai/gpt-5-mini",
		Input: RunInput{Text: text},
	}
}

func prepareInitialTurnStateForTest(t *testing.T, svc *Service, meta *session.Meta, req SendUserTurnRequest) (threadstore.ThreadCreateOperation, threadstore.QueuedTurn) {
	t.Helper()
	create := *req.Create
	settings, err := svc.buildThreadCreateSettings(t.Context(), meta, create)
	if err != nil {
		t.Fatal(err)
	}
	req.Model = settings.ModelID
	req.Options.PermissionType = settings.PermissionType
	capability, modelDefault, _, err := svc.threadReasoningDefaults(t.Context(), req.Model)
	if err != nil {
		t.Fatal(err)
	}
	threadDefault, err := parseStoredReasoningSelection(settings.ReasoningSelectionJSON)
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := resolveEffectiveReasoning(capability, req.Options.ReasoningSelection, threadDefault, modelDefault)
	if err != nil {
		t.Fatal(err)
	}
	req.Options.ReasoningSelection = resolved.Effective
	prepared, normalized, err := svc.prepareUserTurnForTarget(t.Context(), meta, settings.EndpointID, create.ClientRequestID, req.Model, req.Input, req.StagingScopeID, req.StagingCapability, false)
	if err != nil {
		t.Fatal(err)
	}
	req.Input = normalized
	record, err := buildInitialQueuedTurn(meta, req, settings, prepared, stableInitialQueueID(settings.EndpointID, meta.UserPublicID, create.ClientRequestID))
	if err != nil {
		t.Fatal(err)
	}
	operation, frozen, err := svc.threadsDB.PrepareThreadCreateWithInitialTurn(t.Context(), threadstore.PrepareThreadCreateRequest{
		ClientRequestID: create.ClientRequestID, Settings: settings, ExplicitTitle: create.Title, CreatedAtMS: prepared.CreatedAtUnixMs,
	}, record, prepared.UploadIDs, prepared.CreatedAtUnixMs, prepared.AttachmentAdmission, prepared.StagingScope)
	if err != nil {
		t.Fatal(err)
	}
	return operation, frozen
}

func mustOpenInitialTurnReadHost(t *testing.T, svc *Service, threadID string) floretThreadReadHost {
	t.Helper()
	host, err := svc.openFloretThreadReadHost(t.Context(), threadID)
	if err != nil {
		t.Fatal(err)
	}
	return host
}

func enableInitialTurnTestProvider(t *testing.T, svc *Service) {
	t.Helper()
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "provider response is irrelevant after canonical admission", http.StatusInternalServerError)
	}))
	t.Cleanup(provider.Close)
	svc.mu.Lock()
	svc.cfg.Providers[0].BaseURL = provider.URL + "/v1"
	svc.resolveProviderKey = func(string) (string, bool, error) { return "sk-initial-turn-test", true, nil }
	svc.mu.Unlock()
}
