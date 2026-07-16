package codeserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestDesktopSetupOperationJSONContainsStrictUploadContract(t *testing.T) {
	mgr := newTestRuntimeManager(t)
	manifest, _ := writeFakeWorkspaceEngineArchive(t, "4.128.0", mgr.stateRoot)

	operation, err := mgr.CreateSetupOperation(context.Background(), "browser-editor:desktop-json", BrowserEditorInstallMethodDesktopTransfer, &manifest)
	if err != nil {
		t.Fatalf("CreateSetupOperation() error = %v", err)
	}
	if operation.ChunkSizeBytes <= 0 || operation.ExpectedBytes <= 0 || operation.NextChunkIndex != 0 {
		t.Fatalf("operation upload contract = %+v, want positive sizes and initial cursor 0", operation)
	}
	payload, err := json.Marshal(operation)
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	for _, field := range [][]byte{
		[]byte(`"chunk_size_bytes":`),
		[]byte(`"expected_bytes":`),
		[]byte(`"received_bytes":0`),
		[]byte(`"next_chunk_index":0`),
	} {
		if !bytes.Contains(payload, field) {
			t.Fatalf("operation JSON %s missing %s", payload, field)
		}
	}
}

func TestSetupOperationIDsCannotBeReused(t *testing.T) {
	mgr := newTestRuntimeManager(t)
	manifest, _ := writeFakeWorkspaceEngineArchive(t, "4.128.0", mgr.stateRoot)

	first, err := mgr.CreateSetupOperation(context.Background(), "browser-editor:first", BrowserEditorInstallMethodDesktopTransfer, &manifest)
	if err != nil {
		t.Fatalf("CreateSetupOperation(first) error = %v", err)
	}
	if _, err := mgr.CancelSetupOperation(context.Background(), first.OperationID); err != nil {
		t.Fatalf("CancelSetupOperation(first) error = %v", err)
	}
	second, err := mgr.CreateSetupOperation(context.Background(), "browser-editor:second", BrowserEditorInstallMethodDesktopTransfer, &manifest)
	if err != nil {
		t.Fatalf("CreateSetupOperation(second) error = %v", err)
	}
	if _, err := mgr.CancelSetupOperation(context.Background(), second.OperationID); err != nil {
		t.Fatalf("CancelSetupOperation(second) error = %v", err)
	}
	if _, err := mgr.CreateSetupOperation(context.Background(), first.OperationID, BrowserEditorInstallMethodDesktopTransfer, &manifest); err == nil || !strings.Contains(err.Error(), "already been used") {
		t.Fatalf("CreateSetupOperation(reused) error = %v, want reuse rejection", err)
	}
}

func TestSetupOperationRejectsConcurrentCreateWithoutConsumingID(t *testing.T) {
	mgr := newTestRuntimeManager(t)
	manifest, _ := writeFakeWorkspaceEngineArchive(t, "4.128.0", mgr.stateRoot)

	first, err := mgr.CreateSetupOperation(context.Background(), "browser-editor:running", BrowserEditorInstallMethodDesktopTransfer, &manifest)
	if err != nil {
		t.Fatalf("CreateSetupOperation(first) error = %v", err)
	}
	if _, err := mgr.CreateSetupOperation(context.Background(), "browser-editor:waiting", BrowserEditorInstallMethodDesktopTransfer, &manifest); err == nil {
		t.Fatal("CreateSetupOperation(concurrent) error = nil, want typed conflict")
	} else {
		var conflict *BrowserEditorSetupOperationConflictError
		if !errors.As(err, &conflict) || !errors.Is(err, ErrBrowserEditorSetupOperationConflict) {
			t.Fatalf("CreateSetupOperation(concurrent) error = %v, want BrowserEditorSetupOperationConflictError", err)
		}
	}
	if _, err := mgr.CancelSetupOperation(context.Background(), first.OperationID); err != nil {
		t.Fatalf("CancelSetupOperation(first) error = %v", err)
	}
	if _, err := mgr.CreateSetupOperation(context.Background(), "browser-editor:waiting", BrowserEditorInstallMethodDesktopTransfer, &manifest); err != nil {
		t.Fatalf("CreateSetupOperation(retry rejected ID) error = %v", err)
	}
}

func TestSetupOperationCancelIsIdempotentOnlyForMatchingCancelledOperation(t *testing.T) {
	mgr := newTestRuntimeManager(t)
	manifest, _ := writeFakeWorkspaceEngineArchive(t, "4.128.0", mgr.stateRoot)

	operation, err := mgr.CreateSetupOperation(context.Background(), "browser-editor:cancel", BrowserEditorInstallMethodDesktopTransfer, &manifest)
	if err != nil {
		t.Fatalf("CreateSetupOperation() error = %v", err)
	}
	if _, err := mgr.CancelSetupOperation(context.Background(), operation.OperationID); err != nil {
		t.Fatalf("CancelSetupOperation(first) error = %v", err)
	}
	status, err := mgr.CancelSetupOperation(context.Background(), operation.OperationID)
	if err != nil {
		t.Fatalf("CancelSetupOperation(second) error = %v", err)
	}
	if status.Operation.State != RuntimeOperationStateCancelled || status.Operation.OperationID != operation.OperationID {
		t.Fatalf("operation=%+v, want matching cancelled operation", status.Operation)
	}
	if _, err := mgr.CancelSetupOperation(context.Background(), "browser-editor:stale"); err == nil {
		t.Fatal("CancelSetupOperation(stale) error = nil")
	}
}

func TestSetupOperationProtocolErrorsAreScopedToMatchingOperation(t *testing.T) {
	mgr := newTestRuntimeManager(t)
	manifest, _ := writeFakeWorkspaceEngineArchive(t, "4.128.0", mgr.stateRoot)
	manifest.Archive.SizeBytes = 2
	operation, err := mgr.CreateSetupOperation(context.Background(), "browser-editor:active", BrowserEditorInstallMethodDesktopTransfer, &manifest)
	if err != nil {
		t.Fatalf("CreateSetupOperation() error = %v", err)
	}
	if _, err := mgr.AppendSetupOperationChunk(context.Background(), "browser-editor:stale", 0, strings.NewReader("x")); err == nil {
		t.Fatal("AppendSetupOperationChunk(stale) error = nil")
	}
	status := mgr.Status(context.Background())
	if status.Operation.State != RuntimeOperationStateRunning || status.Operation.OperationID != operation.OperationID {
		t.Fatalf("operation=%+v, stale request must not terminate active operation", status.Operation)
	}
	if _, err := mgr.AppendSetupOperationChunk(context.Background(), operation.OperationID, 1, strings.NewReader("x")); err == nil {
		t.Fatal("AppendSetupOperationChunk(wrong index) error = nil")
	}
	status = mgr.Status(context.Background())
	if status.Operation.State != RuntimeOperationStateFailed || status.Operation.LastErrorCode != "transfer_protocol_failed" {
		t.Fatalf("operation=%+v, matching protocol error must terminate operation", status.Operation)
	}
}
