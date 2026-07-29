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

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

func TestSendInitialUserTurnCreatesCanonicalThreadBeforeAdmission(t *testing.T) {
	svc := newSendTurnTestService(t)
	enableInitialTurnTestProvider(t, svc)
	meta := testSendTurnMeta()
	threadID := "th_123456789012345678901234"
	turnID := "turn_initial_create"

	receipt, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{
		ThreadID: threadID,
		Create: &CreateThreadRequest{
			ModelID:        "openai/gpt-5-mini",
			PermissionType: "approval_required",
		},
		Model: "openai/gpt-5-mini",
		Input: RunInput{
			TurnID: turnID,
			Text:   "create the first canonical turn",
		},
	})
	if err != nil {
		t.Fatalf("SendUserTurn(create): %v", err)
	}
	if receipt.Kind != "start" || receipt.TurnID != turnID || receipt.RunID == "" {
		t.Fatalf("receipt=%#v", receipt)
	}

	settings, err := svc.threadsDB.GetThreadSettings(t.Context(), meta.EndpointID, threadID)
	if err != nil || settings == nil {
		t.Fatalf("thread settings=%#v err=%v", settings, err)
	}
	host, err := svc.openFloretThreadReadHost(t.Context(), threadID)
	if err != nil {
		t.Fatalf("open canonical thread: %v", err)
	}
	turn, err := host.ReadThreadTurn(t.Context(), flruntime.ReadThreadTurnRequest{
		ThreadID: flruntime.ThreadID(threadID),
		TurnID:   flruntime.TurnID(turnID),
	})
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
	req := initialTurnRequestForTest("th_123456789012345678901235", "turn_initial_retry", "retry the same first turn")

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
	turns, err := listAllFloretThreadTurns(t.Context(), mustOpenInitialTurnReadHost(t, svc, req.ThreadID), req.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if len(turns) != 1 || string(turns[0].TurnID) != req.Input.TurnID || string(turns[0].RunID) != first.RunID {
		t.Fatalf("canonical turns=%#v receipt=%#v", turns, first)
	}
	if _, err := svc.threadsDB.GetFollowupByLaneAndTurnID(t.Context(), meta.EndpointID, req.ThreadID, threadstore.FollowupLaneQueued, req.Input.TurnID); !errors.Is(err, sql.ErrNoRows) {
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
	req := initialTurnRequestForTest("th_123456789012345678901236", "turn_initial_concurrent", "concurrent first turn")

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
	if responses[0] != responses[1] || responses[0].RunID == "" || responses[0].TurnID != req.Input.TurnID {
		t.Fatalf("responses=%#v", responses)
	}
	turns, err := listAllFloretThreadTurns(t.Context(), mustOpenInitialTurnReadHost(t, svc, req.ThreadID), req.ThreadID)
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
	req := initialTurnRequestForTest("th_123456789012345678901243", "turn_initial_attachment", "read the attached note")
	owner, err := NewUploadOwner(meta.EndpointID, meta.UserPublicID, meta.ChannelID)
	if err != nil {
		t.Fatal(err)
	}
	scope, err := svc.CreateUploadStagingScope(t.Context(), owner, req.ThreadID)
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
	turn, err := mustOpenInitialTurnReadHost(t, svc, req.ThreadID).ReadThreadTurn(t.Context(), flruntime.ReadThreadTurnRequest{
		ThreadID: flruntime.ThreadID(req.ThreadID), TurnID: flruntime.TurnID(req.Input.TurnID),
	})
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
	owned, err := svc.threadsDB.GetThreadOwnedUpload(t.Context(), meta.EndpointID, req.ThreadID, upload.AttachmentID)
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
	req := initialTurnRequestForTest("th_123456789012345678901238", "turn_initial_prepared", "resume prepared create")
	operation, frozen := prepareInitialTurnStateForTest(t, svc, meta, req)
	if operation.Status != threadstore.ThreadCreateOperationPending || frozen.AdmissionState != threadstore.PendingTurnAdmissionReady {
		t.Fatalf("operation=%#v frozen=%#v", operation, frozen)
	}
	if _, err := svc.openFloretThreadReadHost(t.Context(), req.ThreadID); !errors.Is(err, flruntime.ErrThreadNotFound) {
		t.Fatalf("canonical root error=%v, want %v", err, flruntime.ErrThreadNotFound)
	}

	receipt, err := svc.SendUserTurn(t.Context(), meta, req)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.RunID != frozen.RunID || receipt.TurnID != frozen.TurnID {
		t.Fatalf("receipt=%#v frozen=%#v", receipt, frozen)
	}
}

func TestSendInitialUserTurnResumesCommittedCreateBeforeAdmission(t *testing.T) {
	svc := newSendTurnTestService(t)
	enableInitialTurnTestProvider(t, svc)
	meta := testSendTurnMeta()
	req := initialTurnRequestForTest("th_123456789012345678901239", "turn_initial_committed", "resume committed create")
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
	if receipt.RunID != frozen.RunID || receipt.TurnID != frozen.TurnID {
		t.Fatalf("receipt=%#v frozen=%#v", receipt, frozen)
	}
}

func TestSendInitialUserTurnReturnsFrozenIdentityForInFlightAdmission(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	req := initialTurnRequestForTest("th_123456789012345678901240", "turn_initial_in_flight", "recover in-flight create")
	operation, frozen := prepareInitialTurnStateForTest(t, svc, meta, req)
	settings, err := svc.resumeThreadCreateOperation(t.Context(), operation)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.threadsDB.BeginPendingTurnAdmission(t.Context(), meta.EndpointID, req.ThreadID, frozen.QueueID, frozen.TurnID, frozen.RunID); err != nil {
		t.Fatal(err)
	}

	receipt, err := svc.SendUserTurn(t.Context(), meta, req)
	if err != nil {
		t.Fatal(err)
	}
	want := initialTurnReceipt(frozen, settings.PermissionType)
	if receipt != want {
		t.Fatalf("receipt=%#v, want %#v", receipt, want)
	}
}

func TestSendInitialUserTurnResumesAfterRestartFromAtomicPrepare(t *testing.T) {
	stateDir := t.TempDir()
	agentHomeDir := t.TempDir()
	meta := testSendTurnMeta()
	req := initialTurnRequestForTest("th_123456789012345678901241", "turn_initial_restart", "resume after restart")
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
	if receipt.RunID != frozen.RunID || receipt.TurnID != frozen.TurnID {
		t.Fatalf("receipt=%#v frozen=%#v", receipt, frozen)
	}
	turns, err := listAllFloretThreadTurns(t.Context(), mustOpenInitialTurnReadHost(t, restarted, req.ThreadID), req.ThreadID)
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
	req := initialTurnRequestForTest("th_123456789012345678901242", "turn_initial_conflict", "frozen first turn")
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
	req := initialTurnRequestForTest("th_123456789012345678901244", "turn_initial_log", "original frozen text")
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
		"thread_id=" + req.ThreadID,
		"turn_id=" + req.Input.TurnID,
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

func initialTurnRequestForTest(threadID, turnID, text string) SendUserTurnRequest {
	return SendUserTurnRequest{
		ThreadID: threadID,
		Create: &CreateThreadRequest{
			ModelID:        "openai/gpt-5-mini",
			PermissionType: "approval_required",
		},
		Model: "openai/gpt-5-mini",
		Input: RunInput{TurnID: turnID, Text: text},
	}
}

func prepareInitialTurnStateForTest(t *testing.T, svc *Service, meta *session.Meta, req SendUserTurnRequest) (threadstore.ThreadCreateOperation, threadstore.QueuedTurn) {
	t.Helper()
	create := *req.Create
	create.ThreadID = req.ThreadID
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
	prepared, normalized, err := svc.prepareUserTurn(t.Context(), meta, settings.EndpointID, settings.ThreadID, req.Model, req.Input, req.StagingScopeID, req.StagingCapability)
	if err != nil {
		t.Fatal(err)
	}
	req.Input = normalized
	record, err := buildInitialQueuedTurn(meta, req, settings, prepared)
	if err != nil {
		t.Fatal(err)
	}
	operation, frozen, err := svc.threadsDB.PrepareThreadCreateWithInitialTurn(t.Context(), threadstore.PrepareThreadCreateRequest{
		Settings: settings, ExplicitTitle: create.Title, CreatedAtMS: prepared.CreatedAtUnixMs,
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
