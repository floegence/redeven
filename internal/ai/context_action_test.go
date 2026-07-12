package ai

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
)

func TestContextActionWireFixturesNormalizeAndMarshalCanonically(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("testdata/context_action_wire_v2.json")
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	var fixtures []struct {
		Name   string                `json:"name"`
		Action ContextActionEnvelope `json:"action"`
	}
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatalf("json.Unmarshal fixtures: %v", err)
	}
	for _, fixture := range fixtures {
		fixture := fixture
		t.Run(fixture.Name, func(t *testing.T) {
			action, err := normalizeAskFlowerContextActionEnvelope(&fixture.Action)
			if err != nil {
				t.Fatalf("normalizeAskFlowerContextActionEnvelope: %v", err)
			}
			encoded, err := json.Marshal(action)
			if err != nil {
				t.Fatalf("json.Marshal: %v", err)
			}
			var record struct {
				Context []map[string]any `json:"context"`
			}
			if err := json.Unmarshal(encoded, &record); err != nil {
				t.Fatalf("json.Unmarshal canonical: %v", err)
			}
			if len(record.Context) != 1 {
				t.Fatalf("context=%#v", record.Context)
			}
			item := record.Context[0]
			switch item["kind"] {
			case contextActionKindFilePath:
				if _, ok := item["is_directory"]; !ok {
					t.Fatalf("canonical file item omitted is_directory: %s", encoded)
				}
			case contextActionKindTerminal:
				for _, key := range []string{"working_dir", "selection", "selection_chars"} {
					if _, ok := item[key]; !ok {
						t.Fatalf("canonical terminal item omitted %s: %s", key, encoded)
					}
				}
			case contextActionKindProcess:
				for _, key := range []string{"cpu_percent", "memory_bytes", "platform", "captured_at_ms"} {
					if _, ok := item[key]; !ok {
						t.Fatalf("canonical process item omitted %s: %s", key, encoded)
					}
				}
			}
		})
	}
}

func TestNormalizeAskFlowerContextActionRejectsContextFreePayloads(t *testing.T) {
	t.Parallel()

	base := ContextActionEnvelope{
		SchemaVersion: ContextActionSchemaVersion,
		ActionID:      contextActionAskFlowerID,
		Provider:      contextActionFlowerProvider,
		Target:        ContextActionTarget{TargetID: "current", Locality: "auto"},
		Source:        ContextActionSource{Surface: contextActionSurfaceGit},
		Presentation:  ContextActionPresentation{Label: "Ask Flower", Priority: 100},
	}
	for name, contextItems := range map[string][]ContextActionContextItem{
		"empty context": nil,
		"blank kind":    {{Kind: " "}},
		"empty text":    {{Kind: contextActionKindText, Title: "Git changes"}},
	} {
		t.Run(name, func(t *testing.T) {
			action := base
			action.Context = contextItems
			if got, err := normalizeAskFlowerContextActionEnvelope(&action); !errors.Is(err, ErrInvalidContextAction) || got != nil {
				t.Fatalf("normalizeAskFlowerContextActionEnvelope()=(%#v, %v)", got, err)
			}
		})
	}
}

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
				"runtime_hint": "auto",
				"session_source": "provider_environment",
				"grant": "secret"
			},
			"context": [{"kind": "file_path", "path": "/workspace/app", "is_directory": true}],
			"presentation": {"label": "Ask Flower", "priority": 100},
			"suggested_working_dir_abs": "/workspace/app"
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
	if !strings.Contains(messageJSON, `"suggested_working_dir_abs":"/workspace/app"`) {
		t.Fatalf("message JSON missing suggested working dir: %s", messageJSON)
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
	upload, err := svc.SaveUpload(ctx, meta.EndpointID, strings.NewReader("attachment body"), "notes.txt", "text/plain", 0)
	if err != nil {
		t.Fatalf("SaveUpload: %v", err)
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
			RuntimeHint:       "auto",
			SessionSource:     "provider_environment",
		},
		Context: []ContextActionContextItem{
			{Kind: "file_path", Path: "/workspace/app/index.ts", IsDirectory: false},
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
			Attachments: []RunAttachmentIn{{
				Name:     "notes.txt",
				MimeType: "text/plain",
				URL:      upload.URL,
			}},
		},
	})
	if err != nil {
		t.Fatalf("enqueueQueuedTurn: %v", err)
	}
	if !strings.Contains(queued.ContextActionJSON, "assistant.ask.flower") {
		t.Fatalf("queued ContextActionJSON = %q, want serialized context action", queued.ContextActionJSON)
	}
	view, err := svc.GetThread(ctx, meta, thread.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if view == nil || len(view.QueuedTurns) != 1 || view.QueuedTurns[0].ContextAction == nil {
		t.Fatalf("GetThread queued turns=%#v, want linked context", view)
	}
	viewJSON, err := json.Marshal(view.QueuedTurns[0].ContextAction)
	if err != nil {
		t.Fatalf("json.Marshal queued context action: %v", err)
	}
	if !strings.Contains(string(viewJSON), `"is_directory":false`) {
		t.Fatalf("queued context action is not canonical: %s", viewJSON)
	}
	threadViewJSON, err := json.Marshal(view)
	if err != nil {
		t.Fatalf("json.Marshal thread view: %v", err)
	}
	if strings.Contains(string(threadViewJSON), upload.URL) || strings.Contains(string(threadViewJSON), `"attachments"`) {
		t.Fatalf("queued thread detail exposed attachment transport: %s", threadViewJSON)
	}

	popped, err := svc.threadsDB.PopNextQueuedTurn(ctx, meta.EndpointID, thread.ThreadID)
	if err != nil {
		t.Fatalf("PopNextQueuedTurn: %v", err)
	}
	if popped == nil {
		t.Fatalf("PopNextQueuedTurn returned nil")
	}
	startReq, err := queuedTurnRecordToRunStartRequest(*popped, permissionTypeString(FlowerPermissionApprovalRequired))
	if err != nil {
		t.Fatalf("queuedTurnRecordToRunStartRequest: %v", err)
	}
	if startReq.Input.ContextAction == nil {
		t.Fatalf("restored RunStartRequest missing context action")
	}
	if got := startReq.Input.ContextAction.ExecutionContext.SourceEnvPublicID; got != "env_a" {
		t.Fatalf("restored source_env_public_id = %q, want env_a", got)
	}
	projection, err := floretSupplementalContextForInput(startReq.Input)
	if err != nil {
		t.Fatalf("floretSupplementalContextForInput: %v", err)
	}
	if len(projection.Items) != 2 {
		t.Fatalf("supplemental context items=%#v, want queued file path plus attachment metadata", projection.Items)
	}
	if got := projection.Items[0].Metadata["path"]; got != "/workspace/app/index.ts" {
		t.Fatalf("supplemental context path=%q, want queued file path", got)
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
			RuntimeHint:       "auto",
			SessionSource:     "provider_environment",
		},
		Context: []ContextActionContextItem{
			{Kind: "terminal_selection", WorkingDir: "/workspace/app", Selection: "npm test", SelectionChars: 8},
		},
		Presentation: ContextActionPresentation{Label: "Ask Flower", Priority: 100},
	}

	raw, err := marshalQueuedTurnContextAction(action)
	if err != nil {
		t.Fatalf("marshalQueuedTurnContextAction: %v", err)
	}
	if raw == "" {
		t.Fatalf("marshalQueuedTurnContextAction returned empty JSON")
	}
	got, err := unmarshalQueuedTurnContextAction(raw)
	if err != nil {
		t.Fatalf("unmarshalQueuedTurnContextAction: %v", err)
	}
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

func TestQueuedTurnContextActionRejectsInvalidStoredJSON(t *testing.T) {
	t.Parallel()

	_, err := unmarshalQueuedTurnContextAction(`{
		"schema_version": 2,
		"action_id": "assistant.ask.unlisted",
		"provider": "flower",
		"target": {"target_id": "current", "locality": "auto"},
		"source": {"surface": "terminal"},
		"context": [{"kind": "terminal_selection", "working_dir": "/workspace/app", "selection": "npm test", "selection_chars": 8}],
		"presentation": {"label": "Ask Flower", "priority": 100}
	}`)
	if !errors.Is(err, ErrInvalidContextAction) {
		t.Fatalf("unmarshalQueuedTurnContextAction err=%v, want %v", err, ErrInvalidContextAction)
	}
}

func TestQueuedTurnContextActionRejectsLegacyFileSelectionBody(t *testing.T) {
	t.Parallel()

	_, err := unmarshalQueuedTurnContextAction(`{
		"schema_version": 2,
		"action_id": "assistant.ask.flower",
		"provider": "flower",
		"target": {"target_id": "current", "locality": "auto"},
		"source": {"surface": "file_preview"},
		"context": [{"kind": "file_selection", "path": "/workspace/app.go", "selection": "package main", "selection_chars": 12}],
		"presentation": {"label": "Ask Flower", "priority": 100}
	}`)
	if !errors.Is(err, ErrInvalidContextAction) {
		t.Fatalf("unmarshalQueuedTurnContextAction err=%v, want %v", err, ErrInvalidContextAction)
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

func TestNormalizeAskFlowerContextActionRejectsNonStandardActions(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		action ContextActionEnvelope
	}{
		{
			name: "nonstandard action id",
			action: ContextActionEnvelope{
				SchemaVersion: ContextActionSchemaVersion,
				ActionID:      "assistant.ask.unlisted",
				Provider:      "flower",
				Target:        ContextActionTarget{TargetID: "local:local", Locality: "auto"},
				Source:        ContextActionSource{Surface: "desktop_welcome_environment_card"},
				Context:       []ContextActionContextItem{{Kind: "text_snapshot", Title: "Local", Content: "Environment: Local"}},
				Presentation:  ContextActionPresentation{Label: "Ask Flower", Priority: 100},
			},
		},
		{
			name: "nonstandard provider",
			action: ContextActionEnvelope{
				SchemaVersion: ContextActionSchemaVersion,
				ActionID:      "assistant.ask.flower",
				Provider:      "codex",
				Target:        ContextActionTarget{TargetID: "local:local", Locality: "auto"},
				Source:        ContextActionSource{Surface: "desktop_welcome_environment_card"},
				Context:       []ContextActionContextItem{{Kind: "text_snapshot", Title: "Local", Content: "Environment: Local"}},
				Presentation:  ContextActionPresentation{Label: "Ask Flower", Priority: 100},
			},
		},
		{
			name: "nonstandard session source",
			action: ContextActionEnvelope{
				SchemaVersion: ContextActionSchemaVersion,
				ActionID:      "assistant.ask.flower",
				Provider:      "flower",
				Target:        ContextActionTarget{TargetID: "local:local", Locality: "auto"},
				Source:        ContextActionSource{Surface: "desktop_welcome_environment_card"},
				ExecutionContext: &ContextActionExecutionHint{
					SessionSource: "unknown_source",
				},
				Context:      []ContextActionContextItem{{Kind: "text_snapshot", Title: "Local", Content: "Environment: Local"}},
				Presentation: ContextActionPresentation{Label: "Ask Flower", Priority: 100},
			},
		},
		{
			name: "nonstandard runtime hint",
			action: ContextActionEnvelope{
				SchemaVersion: ContextActionSchemaVersion,
				ActionID:      "assistant.ask.flower",
				Provider:      "flower",
				Target:        ContextActionTarget{TargetID: "local:local", Locality: "auto"},
				Source:        ContextActionSource{Surface: "desktop_welcome_environment_card"},
				ExecutionContext: &ContextActionExecutionHint{
					RuntimeHint: "legacy",
				},
				Context:      []ContextActionContextItem{{Kind: "text_snapshot", Title: "Local", Content: "Environment: Local"}},
				Presentation: ContextActionPresentation{Label: "Ask Flower", Priority: 100},
			},
		},
		{
			name: "nonstandard target locality",
			action: ContextActionEnvelope{
				SchemaVersion: ContextActionSchemaVersion,
				ActionID:      "assistant.ask.flower",
				Provider:      "flower",
				Target:        ContextActionTarget{TargetID: "local:local", Locality: "legacy"},
				Source:        ContextActionSource{Surface: "desktop_welcome_environment_card"},
				Context:       []ContextActionContextItem{{Kind: "text_snapshot", Title: "Local", Content: "Environment: Local"}},
				Presentation:  ContextActionPresentation{Label: "Ask Flower", Priority: 100},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			if action, err := normalizeAskFlowerContextActionEnvelope(&tt.action); err == nil || action != nil {
				t.Fatalf("normalizeAskFlowerContextActionEnvelope()=(%#v, %v), want invalid nil", action, err)
			}
			if got := contextActionRunEventPayload(&tt.action); got != nil {
				t.Fatalf("contextActionRunEventPayload()=%#v, want nil", got)
			}
		})
	}
}

func TestNormalizeAskFlowerContextActionEnforcesSourceKindPrivacyMatrix(t *testing.T) {
	t.Parallel()

	base := func(surface string, item ContextActionContextItem) ContextActionEnvelope {
		return ContextActionEnvelope{
			SchemaVersion: ContextActionSchemaVersion,
			ActionID:      "assistant.ask.flower",
			Provider:      "flower",
			Target:        ContextActionTarget{TargetID: "current", Locality: "auto"},
			Source:        ContextActionSource{Surface: surface},
			Context:       []ContextActionContextItem{item},
			Presentation:  ContextActionPresentation{Label: "Ask Flower", Priority: 100},
		}
	}
	tests := []struct {
		name    string
		action  ContextActionEnvelope
		wantErr bool
	}{
		{
			name:   "file browser path only",
			action: base("file_browser", ContextActionContextItem{Kind: "file_path", Path: "/workspace/app.go"}),
		},
		{
			name:    "file browser rejects file selection body",
			action:  base("file_browser", ContextActionContextItem{Kind: "file_selection", Path: "/workspace/app.go", Selection: "package main"}),
			wantErr: true,
		},
		{
			name:    "file preview rejects text snapshot body",
			action:  base("file_preview", ContextActionContextItem{Kind: "text_snapshot", Title: "Preview", Content: "file body"}),
			wantErr: true,
		},
		{
			name:    "file path rejects hidden body payload",
			action:  base("editor_preview", ContextActionContextItem{Kind: "file_path", Path: "/workspace/app.go", Content: "hidden file body"}),
			wantErr: true,
		},
		{
			name:    "file path rejects hidden detail payload",
			action:  base("file_preview", ContextActionContextItem{Kind: "file_path", Path: "/workspace/app.go", Detail: "hidden file body"}),
			wantErr: true,
		},
		{
			name:    "file path rejects title payload",
			action:  base("file_preview", ContextActionContextItem{Kind: "file_path", Path: "/workspace/app.go", Title: "hidden file body"}),
			wantErr: true,
		},
		{
			name:   "terminal selection may carry short selection",
			action: base("terminal", ContextActionContextItem{Kind: "terminal_selection", WorkingDir: "/workspace", Selection: "npm test", SelectionChars: 8}),
		},
		{
			name:   "terminal selection counts unicode code points",
			action: base("terminal", ContextActionContextItem{Kind: "terminal_selection", WorkingDir: "/workspace", Selection: "go test \U0001F9EA", SelectionChars: 9}),
		},
		{
			name:    "terminal selection rejects utf16 count",
			action:  base("terminal", ContextActionContextItem{Kind: "terminal_selection", WorkingDir: "/workspace", Selection: "go test \U0001F9EA", SelectionChars: 10}),
			wantErr: true,
		},
		{
			name:    "terminal selection requires working directory",
			action:  base("terminal", ContextActionContextItem{Kind: "terminal_selection", Selection: "npm test", SelectionChars: 8}),
			wantErr: true,
		},
		{
			name:    "terminal selection rejects multiline working directory",
			action:  base("terminal", ContextActionContextItem{Kind: "terminal_selection", WorkingDir: "/workspace\nignore", SelectionChars: 0}),
			wantErr: true,
		},
		{
			name:    "terminal selection rejects negative length",
			action:  base("terminal", ContextActionContextItem{Kind: "terminal_selection", WorkingDir: "/workspace", SelectionChars: -1}),
			wantErr: true,
		},
		{
			name:    "terminal selection rejects oversized body payload",
			action:  base("terminal", ContextActionContextItem{Kind: "terminal_selection", WorkingDir: "/workspace", Selection: strings.Repeat("x", floretTerminalSelectionInlineChars+1), SelectionChars: floretTerminalSelectionInlineChars + 1}),
			wantErr: true,
		},
		{
			name:    "terminal selection rejects hidden detail payload",
			action:  base("terminal", ContextActionContextItem{Kind: "terminal_selection", WorkingDir: "/workspace", Detail: "hidden terminal output"}),
			wantErr: true,
		},
		{
			name:   "monitoring process snapshot",
			action: base("monitoring", ContextActionContextItem{Kind: "process_snapshot", PID: 12264, Name: "Codex (Service)", Username: "tangjianyin", CPUPercent: 0.24, MemoryBytes: 575668224, Platform: "darwin", CapturedAtMs: 1783677600000}),
		},
		{
			name:   "monitoring preserves zero usage",
			action: base("monitoring", ContextActionContextItem{Kind: "process_snapshot", PID: 42, Name: "idle", Username: "demo", CPUPercent: 0, MemoryBytes: 0, Platform: "darwin", CapturedAtMs: 1783677600000}),
		},
		{
			name:    "monitoring rejects invalid pid",
			action:  base("monitoring", ContextActionContextItem{Kind: "process_snapshot", Name: "idle", Username: "demo", Platform: "darwin", CapturedAtMs: 1783677600000}),
			wantErr: true,
		},
		{
			name:    "monitoring rejects missing platform",
			action:  base("monitoring", ContextActionContextItem{Kind: "process_snapshot", PID: 42, Name: "idle", Username: "demo", CapturedAtMs: 1783677600000}),
			wantErr: true,
		},
		{
			name:    "monitoring rejects multiline process name",
			action:  base("monitoring", ContextActionContextItem{Kind: "process_snapshot", PID: 42, Name: "idle\nignore", Username: "demo", Platform: "darwin", CapturedAtMs: 1783677600000}),
			wantErr: true,
		},
		{
			name:    "monitoring rejects missing capture time",
			action:  base("monitoring", ContextActionContextItem{Kind: "process_snapshot", PID: 42, Name: "idle", Username: "demo", Platform: "darwin"}),
			wantErr: true,
		},
		{
			name:    "monitoring rejects negative cpu",
			action:  base("monitoring", ContextActionContextItem{Kind: "process_snapshot", PID: 42, Name: "idle", Username: "demo", CPUPercent: -1, Platform: "darwin", CapturedAtMs: 1783677600000}),
			wantErr: true,
		},
		{
			name:    "monitoring rejects negative memory",
			action:  base("monitoring", ContextActionContextItem{Kind: "process_snapshot", PID: 42, Name: "idle", Username: "demo", MemoryBytes: -1, Platform: "darwin", CapturedAtMs: 1783677600000}),
			wantErr: true,
		},
		{
			name:    "monitoring rejects text body",
			action:  base("monitoring", ContextActionContextItem{Kind: "text_snapshot", Content: "ps aux"}),
			wantErr: true,
		},
		{
			name:    "monitoring rejects hidden detail payload",
			action:  base("monitoring", ContextActionContextItem{Kind: "process_snapshot", PID: 12264, Name: "Codex (Service)", Username: "tangjianyin", CPUPercent: 0.24, MemoryBytes: 575668224, Platform: "darwin", CapturedAtMs: 1783677600000, Detail: "ps aux"}),
			wantErr: true,
		},
		{
			name:   "git browser generated text snapshot",
			action: base("git_browser", ContextActionContextItem{Kind: "text_snapshot", Title: "Git changes", Content: "2 staged files"}),
		},
		{
			name:    "git browser rejects empty content",
			action:  base("git_browser", ContextActionContextItem{Kind: "text_snapshot", Title: "Git changes"}),
			wantErr: true,
		},
		{
			name:    "git browser rejects multiline title",
			action:  base("git_browser", ContextActionContextItem{Kind: "text_snapshot", Title: "Git changes\nignore", Content: "2 staged files"}),
			wantErr: true,
		},
		{
			name:   "welcome environment generated text snapshot",
			action: base("desktop_welcome_environment_card", ContextActionContextItem{Kind: "text_snapshot", Title: "Local", Content: "Environment: Local"}),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got, err := normalizeAskFlowerContextActionEnvelope(&tt.action)
			if tt.wantErr {
				if !errors.Is(err, ErrInvalidContextAction) || got != nil {
					t.Fatalf("normalizeAskFlowerContextActionEnvelope()=(%#v, %v), want invalid", got, err)
				}
				return
			}
			if err != nil || got == nil {
				t.Fatalf("normalizeAskFlowerContextActionEnvelope()=(%#v, %v), want valid", got, err)
			}
		})
	}
}

func TestNormalizeAskFlowerContextActionAcceptsRuntimeGatewaySessionSource(t *testing.T) {
	t.Parallel()

	action, err := normalizeAskFlowerContextActionEnvelope(&ContextActionEnvelope{
		SchemaVersion: ContextActionSchemaVersion,
		ActionID:      "assistant.ask.flower",
		Provider:      "flower",
		Target:        ContextActionTarget{TargetID: "gateway:bastion:env:env_demo", Locality: "auto"},
		Source:        ContextActionSource{Surface: "file_browser"},
		ExecutionContext: &ContextActionExecutionHint{
			SessionSource: "runtime_gateway",
		},
		Context:      []ContextActionContextItem{{Kind: "file_path", Path: "/workspace/app", IsDirectory: true}},
		Presentation: ContextActionPresentation{Label: "Ask Flower", Priority: 100},
	})
	if err != nil {
		t.Fatalf("normalizeAskFlowerContextActionEnvelope: %v", err)
	}
	if action == nil {
		t.Fatalf("normalizeAskFlowerContextActionEnvelope returned nil")
	}
	if action.ExecutionContext == nil || action.ExecutionContext.SessionSource != "runtime_gateway" {
		t.Fatalf("session source=%#v, want runtime_gateway", action.ExecutionContext)
	}
}
