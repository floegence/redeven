package ai

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestBuildUserMessageJSONPersistsContextActionWithoutPermissionHints(t *testing.T) {
	raw := []byte(`{
		"text": "Review this folder",
		"context_action": {
			"schema_version": 2,
			"action_id": "assistant.ask.flower",
			"provider": "flower",
			"target": {"target_id": "current", "locality": "auto", "can_write": true},
			"source": {"surface": "file_browser"},
			"execution_context": {
				"current_target_id": "env_a",
				"source_env_public_id": "env_a",
				"host_hint": "auto",
				"session_source": "provider_environment",
				"grant": "secret"
			},
			"context": [{"kind": "file_path", "path": "/workspace/app", "is_directory": true}],
			"presentation": {"label": "Ask Flower", "priority": 100}
		}
	}`)
	var input RunInput
	if err := json.Unmarshal(raw, &input); err != nil {
		t.Fatalf("json.Unmarshal RunInput: %v", err)
	}

	messageJSON, text, err := buildUserMessageJSON("msg_1", input, nil, 123)
	if err != nil {
		t.Fatalf("buildUserMessageJSON: %v", err)
	}
	if text != "Review this folder" {
		t.Fatalf("text = %q", text)
	}
	if !strings.Contains(messageJSON, `"contextAction"`) {
		t.Fatalf("message JSON missing contextAction: %s", messageJSON)
	}
	if strings.Contains(messageJSON, "can_write") || strings.Contains(messageJSON, "grant") {
		t.Fatalf("message JSON retained browser permission material: %s", messageJSON)
	}
	if !strings.Contains(messageJSON, `"source_env_public_id":"env_a"`) {
		t.Fatalf("message JSON missing execution routing hint: %s", messageJSON)
	}
}

func TestQueuedTurnContextActionPersistsThroughStoreRoundTrip(t *testing.T) {
	t.Parallel()

	svc := newTestService(t, nil)
	meta := testUploadMeta()
	ctx := context.Background()

	thread, err := svc.CreateThread(ctx, meta, "queued context action", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	action := &ContextActionEnvelope{
		SchemaVersion: ContextActionSchemaVersion,
		ActionID:      "assistant.ask.flower",
		Provider:      "flower",
		Target:        ContextActionTarget{TargetID: "current", Locality: "auto"},
		Source:        ContextActionSource{Surface: "file_browser"},
		ExecutionContext: &ContextActionExecutionHint{
			CurrentTargetID:   "env_a",
			SourceEnvPublicID: "env_a",
			HostHint:          "auto",
			SessionSource:     "provider_environment",
		},
		Context: []ContextActionContextItem{
			{Kind: "file_path", Path: "/workspace/app", IsDirectory: true},
		},
		Presentation:        ContextActionPresentation{Label: "Ask Flower", Priority: 100},
		SuggestedWorkingDir: "/workspace/app",
	}

	queued, _, err := svc.enqueueQueuedTurn(ctx, meta, SendUserTurnRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5.5",
		Input: RunInput{
			MessageID:     "msg_context_action",
			Text:          "queued with context",
			ContextAction: action,
		},
	})
	if err != nil {
		t.Fatalf("enqueueQueuedTurn: %v", err)
	}
	if !strings.Contains(queued.ContextActionJSON, "assistant.ask.flower") {
		t.Fatalf("queued ContextActionJSON = %q, want serialized context action", queued.ContextActionJSON)
	}

	popped, err := svc.threadsDB.PopNextQueuedTurn(ctx, meta.EndpointID, thread.ThreadID)
	if err != nil {
		t.Fatalf("PopNextQueuedTurn: %v", err)
	}
	if popped == nil {
		t.Fatalf("PopNextQueuedTurn returned nil")
	}
	startReq := queuedTurnRecordToRunStartRequest(*popped, "act")
	if startReq.Input.ContextAction == nil {
		t.Fatalf("restored RunStartRequest missing context action")
	}
	if got := startReq.Input.ContextAction.ExecutionContext.SourceEnvPublicID; got != "env_a" {
		t.Fatalf("restored source_env_public_id = %q, want env_a", got)
	}
}

func TestQueuedTurnContextActionRoundTrip(t *testing.T) {
	action := &ContextActionEnvelope{
		SchemaVersion: ContextActionSchemaVersion,
		ActionID:      "assistant.ask.flower",
		Provider:      "flower",
		Target:        ContextActionTarget{TargetID: "current", Locality: "auto"},
		Source:        ContextActionSource{Surface: "terminal"},
		ExecutionContext: &ContextActionExecutionHint{
			CurrentTargetID:   "env_a",
			SourceEnvPublicID: "env_a",
			HostHint:          "auto",
			SessionSource:     "provider_environment",
		},
		Context: []ContextActionContextItem{
			{Kind: "terminal_selection", WorkingDir: "/workspace/app", Selection: "npm test", SelectionChars: 8},
		},
		Presentation: ContextActionPresentation{Label: "Ask Flower", Priority: 100},
	}

	raw := marshalQueuedTurnContextAction(action)
	if raw == "" {
		t.Fatalf("marshalQueuedTurnContextAction returned empty JSON")
	}
	got := unmarshalQueuedTurnContextAction(raw)
	if got == nil {
		t.Fatalf("unmarshalQueuedTurnContextAction returned nil")
	}
	if got.ActionID != "assistant.ask.flower" || got.Source.Surface != "terminal" {
		t.Fatalf("unexpected action identity: %#v", got)
	}
	if got.ExecutionContext == nil || got.ExecutionContext.SourceEnvPublicID != "env_a" {
		t.Fatalf("unexpected execution context: %#v", got.ExecutionContext)
	}
}

func TestContextActionNormalizationPreservesUserTextPayload(t *testing.T) {
	action := normalizeContextActionEnvelope(&ContextActionEnvelope{
		SchemaVersion: ContextActionSchemaVersion,
		ActionID:      " assistant.ask.flower ",
		Provider:      " flower ",
		Target:        ContextActionTarget{TargetID: " current ", Locality: " auto "},
		Source:        ContextActionSource{Surface: " terminal "},
		Context: []ContextActionContextItem{
			{Kind: " terminal_selection ", WorkingDir: " /workspace/app ", Selection: "\n  npm test  \n", SelectionChars: 14},
			{Kind: " text_snapshot ", Title: " note ", Content: "  keep leading and trailing text\n"},
		},
		Presentation: ContextActionPresentation{Label: " Ask Flower ", Priority: 100},
	})
	if action == nil {
		t.Fatalf("normalizeContextActionEnvelope returned nil")
	}
	if got := action.Context[0].Selection; got != "\n  npm test  \n" {
		t.Fatalf("selection changed during normalization: %q", got)
	}
	if got := action.Context[1].Content; got != "  keep leading and trailing text\n" {
		t.Fatalf("content changed during normalization: %q", got)
	}
	if got := action.Context[0].WorkingDir; got != "/workspace/app" {
		t.Fatalf("working_dir = %q, want trimmed path", got)
	}
}
