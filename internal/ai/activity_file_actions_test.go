package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/floegence/floret/observation"
	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

func rawActivityMessageWithPrivateFileActionSidecar(messageID string) string {
	messageID = strings.TrimSpace(messageID)
	if messageID == "" {
		messageID = "msg_1"
	}
	return fmt.Sprintf(`{
		"id":%q,
		"role":"assistant",
		"status":"complete",
		"timestamp":1700000000000,
		"blocks":[
			{"type":"activity-timeline","schema_version":1,"run_id":"run_1","thread_id":"thread_1","turn_id":%q,"trace_id":"trace_1","summary":{"status":"success","severity":"quiet","needs_attention":false,"total_items":1,"counts":{"success":1}},"items":[
				{"item_id":"tool_read","tool_id":"tool_read","tool_name":"file.read","kind":"tool","status":"success","severity":"quiet","needs_attention":false,"requires_approval":false,"label":"app.ts","renderer":"file","target_refs":[{"kind":"file","label":"app.ts","path":"/workspace/private/app.ts"}],"payload":{"operation":"read","display_name":"app.ts","file_action_id":"file_action_read","preview_path":"/workspace/private/app.ts","root_dir":"/Users/alice/.codex/skills/frontend-design","mutations":[{"file_action_id":"file_action_read","directory_path":"/workspace/private"}]}}
			],"file_actions":{"file_action_read":{"action_id":"file_action_read","display_name":"app.ts","preview_path":"/workspace/private/app.ts","directory_path":"/workspace/private"}}}
		]
	}`, messageID, messageID)
}

func TestListThreadMessagesSanitizesActivityFileActionSidecar(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := &session.Meta{
		EndpointID:   "env_activity_sanitize",
		UserPublicID: "user_activity_sanitize",
		UserEmail:    "user@example.com",
		CanRead:      true,
		CanWrite:     true,
		CanExecute:   true,
	}
	thread, err := svc.CreateThread(ctx, meta, "activity sanitize", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	raw := rawActivityMessageWithPrivateFileActionSidecar("msg_1")
	if _, err := svc.threadsDB.AppendMessage(ctx, meta.EndpointID, thread.ThreadID, threadstore.Message{
		MessageID:       "msg_1",
		Role:            "assistant",
		Status:          "complete",
		TextContent:     "done",
		MessageJSON:     raw,
		CreatedAtUnixMs: 1700000000000,
		UpdatedAtUnixMs: 1700000000000,
	}, meta.UserPublicID, meta.UserEmail); err != nil {
		t.Fatalf("AppendMessage: %v", err)
	}

	messages, err := svc.ListThreadMessages(ctx, meta, thread.ThreadID, 20, 0)
	if err != nil {
		t.Fatalf("ListThreadMessages: %v", err)
	}
	if len(messages.Messages) != 1 {
		t.Fatalf("messages len=%d, want 1", len(messages.Messages))
	}
	body := string(messages.Messages[0].(json.RawMessage))
	for _, forbidden := range []string{"preview_path", "directory_path", "root_dir", `\"path\"`} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("sanitized message contains %q: %s", forbidden, body)
		}
	}
	if !strings.Contains(body, `"can_preview":true`) || !strings.Contains(body, `"can_browse_directory":true`) {
		t.Fatalf("sanitized message missing file action capabilities: %s", body)
	}

	target, err := svc.ResolveFlowerFileActionOpenTarget(ctx, meta, FlowerFileActionOpenRequest{
		ThreadID:   thread.ThreadID,
		MessageID:  "msg_1",
		BlockIndex: 0,
		ItemID:     "tool_read",
		ActionID:   "file_action_read",
		Action:     "preview",
	})
	if err != nil {
		t.Fatalf("ResolveFlowerFileActionOpenTarget: %v", err)
	}
	if target.Path != "/workspace/private/app.ts" {
		t.Fatalf("target path=%q, want raw host path", target.Path)
	}
}

func TestSanitizeActivityTimelineMessageJSONFiltersPublicPayloadContract(t *testing.T) {
	raw := `{
		"id":"msg_1",
		"role":"assistant",
		"status":"complete",
		"timestamp":1700000000000,
		"blocks":[
			{"type":"activity-timeline","schema_version":1,"run_id":"run_1","thread_id":"thread_1","turn_id":"msg_1","trace_id":"trace_1","summary":{"status":"success","severity":"quiet","needs_attention":false,"total_items":2,"counts":{"success":2}},"items":[
				{"item_id":"tool_structured","tool_id":"tool_structured","tool_name":"use_skill","kind":"tool","status":"success","severity":"quiet","needs_attention":false,"requires_approval":false,"label":"use_skill","renderer":"structured","target_refs":[{"kind":"file","label":"app.ts","path":"/workspace/private/app.ts","uri":"https://example.test/app.ts","line":7}],"payload":{"operation":"use_skill","name":"frontend-design","root_dir":"/Users/alice/.codex/skills/frontend-design","data":{"filePath":"/workspace/private/app.ts","cwd":"/workspace/private","visible":"kept"},"result":{"workdir":"/workspace/private","items":[{"previewPath":"/workspace/private/app.ts","status":"kept"}]}}},
				{"item_id":"tool_patch","tool_id":"tool_patch","tool_name":"apply_patch","kind":"tool","status":"success","severity":"quiet","needs_attention":false,"requires_approval":false,"label":"apply_patch","renderer":"patch","payload":{"operation":"apply_patch","mutations":[{"display_name":"app.ts","file_action_id":"edit_app","change_type":"update","additions":1,"deletions":1,"unified_diff":"--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-old\n+new","content":"secret full file","directoryPath":"/workspace/private","stdin":"secret"}]}}
			],"file_actions":{"edit_app":{"action_id":"edit_app","display_name":"app.ts","preview_path":"/workspace/private/app.ts","directory_path":"/workspace/private"}}}
		]
	}`
	sanitized, err := SanitizeActivityTimelineMessageJSON(raw)
	if err != nil {
		t.Fatalf("SanitizeActivityTimelineMessageJSON: %v", err)
	}
	body := string(sanitized)
	for _, forbidden := range []string{
		`"path"`,
		`filePath`,
		`previewPath`,
		`directoryPath`,
		`"cwd"`,
		`"workdir"`,
		`"stdin"`,
		`secret full file`,
		`preview_path`,
		`directory_path`,
		`root_dir`,
	} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("sanitized message contains %q: %s", forbidden, body)
		}
	}
	for _, required := range []string{
		`"uri":"https://example.test/app.ts"`,
		`"line":7`,
		`"visible":"kept"`,
		`"unified_diff"`,
		`"can_preview":true`,
		`"can_browse_directory":true`,
	} {
		if !strings.Contains(body, required) {
			t.Fatalf("sanitized message missing %q: %s", required, body)
		}
	}
}

func TestSanitizeActivityTimelineMessageJSONKeepsSubagentActionSidecar(t *testing.T) {
	t.Parallel()

	raw := `{
		"id":"msg_1",
		"role":"assistant",
		"status":"complete",
		"timestamp":1700000000000,
		"blocks":[
			{"type":"activity-timeline","schema_version":1,"run_id":"run_1","thread_id":"thread_1","turn_id":"msg_1","trace_id":"trace_1","summary":{"status":"success","severity":"quiet","needs_attention":false,"total_items":1,"counts":{"success":1}},"items":[
				{"item_id":"subagent:review","tool_id":"subagents","tool_name":"subagents","kind":"control","status":"success","severity":"quiet","needs_attention":false,"requires_approval":false,"label":"Review API","renderer":"structured","payload":{"thread_id":"child_1","task_name":"Review API","task_description":"Review the public API boundary.","status":"completed"}}
			],"subagent_actions":{"subagent:review":{"operation":"subagents","action":"inspect","delegation_runtime":"floret","thread_id":"child_1","subagent_id":"child_1","task_name":"Review API","task_description":"Review the public API boundary.","agent_type":"reviewer","context_mode":"mission_only","status":"completed","last_message":"Done","private_path":"/Users/alice/work","can_send_input":false,"can_close":true,"updated_at_ms":1700000000100}}}
		]
	}`
	sanitized, err := SanitizeActivityTimelineMessageJSON(raw)
	if err != nil {
		t.Fatalf("SanitizeActivityTimelineMessageJSON: %v", err)
	}
	body := string(sanitized)
	for _, required := range []string{`"subagent_actions"`, `"action":"inspect"`, `"thread_id":"child_1"`, `"subagent_id":"child_1"`, `"task_description":"Review the public API boundary."`, `"updated_at_ms":1700000000100`} {
		if !strings.Contains(body, required) {
			t.Fatalf("sanitized message missing %q: %s", required, body)
		}
	}
	for _, forbidden := range []string{"private_path", "/Users/alice/work", `"can_send_input"`, `"can_close"`, `"last_message"`, `"waiting_prompt"`, `"context_mode"`} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("sanitized message contains %q: %s", forbidden, body)
		}
	}
}

func TestSanitizeActivityTimelineMessageJSONKeepsSubagentProjectionPayload(t *testing.T) {
	t.Parallel()

	raw := `{
		"id":"msg_subagents",
		"role":"assistant",
		"status":"complete",
		"timestamp":1700000000000,
		"blocks":[
			{"type":"activity-timeline","schema_version":1,"run_id":"run_subagents","thread_id":"thread_parent","turn_id":"msg_subagents","trace_id":"trace_subagents","summary":{"status":"success","severity":"quiet","needs_attention":false,"total_items":1,"counts":{"success":1}},"items":[
				{"item_id":"tool_subagents_spawn","tool_id":"tool_subagents_spawn","tool_name":"subagents","kind":"tool","status":"success","severity":"quiet","needs_attention":false,"requires_approval":false,"label":"Spawn reviewer","renderer":"structured","payload":{"action":"spawn","status":"ok","context_mode":"mission_only","subagent_id":"thread_child_review","thread_id":"thread_child_review","task_name":"Review API","task_description":"Review the public API boundary.","agent_type":"reviewer","last_message":"Reading the API boundary.","snapshot":{"subagent_id":"thread_child_review","thread_id":"thread_child_review","task_name":"Review API","task_description":"Review the public API boundary.","agent_type":"reviewer","status":"running","context_mode":"mission_only","last_message":"Reading the API boundary.","updated_at_ms":120,"path":"/root/review_api","private_path":"/Users/alice/work/redeven/snapshot","privatePath":"/Users/alice/work/redeven/camel"},"items":[{"subagent_id":"thread_child_review","thread_id":"thread_child_review","task_description":"Review the public API boundary.","agent_type":"reviewer","status":"completed","context_mode":"mission_only","private_path":"/Users/alice/work/redeven/item"}],"item":{"subagent_id":"legacy_item"},"subagent":{"subagent_id":"thread_child_review","thread_id":"thread_child_review","task_name":"Review API","task_description":"Review the public API boundary.","agent_type":"reviewer","status":"running","context_mode":"mission_only","last_message":"Reading the API boundary.","updated_at_ms":120},"final_handoff_report":{"summary":"Review complete.","reports":[{"subagent_id":"thread_child_review","handoff":"API boundary is consistent.","changed_files":["internal/ai/subagents_floret.go"],"verification":["go test ./internal/ai"],"open_risks":["none"],"suggested_parent_actions":["continue"]}],"truncated":false,"omitted_count":0},"progress_summary":{"summary":"Review is still running.","progress":[{"subagent_id":"thread_child_review","state":"reading tests","blockers":[],"next_expected_step":"finish review"}],"suggested_parent_actions":["wait again"]},"subagents":[{"subagent_id":"legacy_child","thread_id":"legacy_child"}],"snapshots":{"legacy":{"thread_id":"legacy_snapshot"}},"snapshots_by_id":{"legacy":{"thread_id":"legacy_snapshot_by_id"}},"private_path":"/Users/alice/work/redeven"}}
			]}
		]
	}`

	sanitized, err := SanitizeActivityTimelineMessageJSON(raw)
	if err != nil {
		t.Fatalf("SanitizeActivityTimelineMessageJSON: %v", err)
	}
	body := string(sanitized)
	for _, required := range []string{
		`"items"`,
		`"task_name":"Review API"`,
		`"task_description":"Review the public API boundary."`,
		`"agent_type":"reviewer"`,
		`"status":"completed"`,
	} {
		if !strings.Contains(body, required) {
			t.Fatalf("sanitized subagent payload missing %q: %s", required, body)
		}
	}
	for _, forbidden := range []string{
		`thread_child_review`,
		`"subagent_id"`,
		`"context_mode"`,
		`"final_handoff_report"`,
		`"progress_summary"`,
		`"handoff"`,
		`"changed_files"`,
		`"next_expected_step"`,
		`"last_message"`,
		`"waiting_prompt"`,
		`"can_send_input"`,
		`"can_interrupt"`,
		`"can_close"`,
		`"detail_ref"`,
		`"path"`,
		`private_path`,
		`privatePath`,
		`"snapshot"`,
		`"subagent":`,
		`"item":`,
		`"subagents":[`,
		`"snapshots"`,
		`snapshots_by_id`,
		`legacy_child`,
		`legacy_snapshot`,
		`/Users/alice/work/redeven`,
	} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("sanitized subagent payload contains %q: %s", forbidden, body)
		}
	}
}

func TestSanitizeActivityTimelineMessageJSONFiltersRunningActivitySidecar(t *testing.T) {
	t.Parallel()

	raw := rawActivityMessageWithPrivateFileActionSidecar("msg_active_live")
	var message struct {
		Blocks []json.RawMessage `json:"blocks"`
	}
	if err := json.Unmarshal([]byte(raw), &message); err != nil {
		t.Fatalf("Unmarshal raw message: %v", err)
	}
	var rawBlock ActivityTimelineBlock
	if err := json.Unmarshal(message.Blocks[0], &rawBlock); err != nil {
		t.Fatalf("Unmarshal activity block: %v", err)
	}
	r := &run{
		id:                       "run_active_live",
		threadID:                 "thread_active_live",
		messageID:                "msg_active_live",
		assistantCreatedAtUnixMs: 1700000000000,
		assistantBlocks:          []any{rawBlock},
	}

	publicMessage, err := SanitizeActivityTimelineMessageJSON(raw)
	if err != nil {
		t.Fatalf("SanitizeActivityTimelineMessageJSON: %v", err)
	}
	if len(publicMessage) == 0 {
		t.Fatalf("missing public message")
	}
	body := string(publicMessage)
	for _, forbidden := range []string{"preview_path", "directory_path", "root_dir", `\"path\"`, `"cwd"`, `"stdin"`} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("public activity payload contains %q: %s", forbidden, body)
		}
	}
	for _, required := range []string{`"can_preview":true`, `"can_browse_directory":true`} {
		if !strings.Contains(body, required) {
			t.Fatalf("public activity payload missing %q: %s", required, body)
		}
	}

	rawSnapshot, _, _, err := r.snapshotAssistantMessageJSONWithStatus("streaming")
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSONWithStatus: %v", err)
	}
	if !strings.Contains(rawSnapshot, "preview_path") {
		t.Fatalf("private resolver snapshot should retain private file action data: %s", rawSnapshot)
	}
}

func TestResolveFlowerFileActionOpenTargetRejectsIncompleteIdentity(t *testing.T) {
	svc := newTestService(t, nil)
	meta := &session.Meta{EndpointID: "env_invalid_action", CanRead: true, CanWrite: true, CanExecute: true}
	_, err := svc.ResolveFlowerFileActionOpenTarget(context.Background(), meta, FlowerFileActionOpenRequest{Action: "preview"})
	if !errors.Is(err, ErrFlowerFileActionInvalid) {
		t.Fatalf("err=%v, want ErrFlowerFileActionInvalid", err)
	}
}

func TestSanitizePublicStreamEventFiltersActivitySidecar(t *testing.T) {
	raw := rawActivityMessageWithPrivateFileActionSidecar("msg_stream")
	var message struct {
		Blocks []json.RawMessage `json:"blocks"`
	}
	if err := json.Unmarshal([]byte(raw), &message); err != nil {
		t.Fatalf("Unmarshal raw message: %v", err)
	}
	var rawBlock ActivityTimelineBlock
	if err := json.Unmarshal(message.Blocks[0], &rawBlock); err != nil {
		t.Fatalf("Unmarshal activity block: %v", err)
	}
	if rawBlock.FileActions["file_action_read"].PreviewPath == "" {
		t.Fatalf("raw block missing private preview path: %#v", rawBlock.FileActions)
	}

	publicEvent, ok := sanitizePublicStreamEvent(streamEventBlockSet{
		Type:       "block-set",
		MessageID:  "msg_stream",
		BlockIndex: 0,
		Block:      rawBlock,
	})
	if !ok {
		t.Fatal("sanitizePublicStreamEvent returned false")
	}
	body, err := json.Marshal(publicEvent)
	if err != nil {
		t.Fatalf("Marshal public event: %v", err)
	}
	for _, forbidden := range []string{"preview_path", "directory_path", "root_dir", `\"path\"`} {
		if strings.Contains(string(body), forbidden) {
			t.Fatalf("public stream event contains %q: %s", forbidden, body)
		}
	}
	for _, required := range []string{`"can_preview":true`, `"can_browse_directory":true`} {
		if !strings.Contains(string(body), required) {
			t.Fatalf("public stream event missing %q: %s", required, body)
		}
	}
}

func TestSanitizeActivityTimelineMessageJSONFiltersTerminalHostPaths(t *testing.T) {
	t.Parallel()

	raw := `{
		"id":"msg_terminal",
		"role":"assistant",
		"status":"complete",
		"timestamp":1700000000000,
		"blocks":[{
			"type":"activity-timeline",
			"schema_version":1,
			"run_id":"run_terminal",
			"thread_id":"thread_terminal",
			"turn_id":"msg_terminal",
			"summary":{"status":"success","severity":"quiet","needs_attention":false,"total_items":1,"counts":{"success":1}},
			"items":[{
				"item_id":"tool_terminal",
				"tool_id":"tool_terminal",
				"tool_name":"terminal.exec",
				"kind":"tool",
				"status":"success",
				"severity":"quiet",
				"needs_attention":false,
				"requires_approval":false,
				"label":"sleep 10",
				"renderer":"terminal",
				"chips":[
					{"kind":"state","label":"State","value":"running","tone":"running"},
					{"kind":"handle","label":"Handle","value":"tp_private","tone":"quiet"},
					{"kind":"process_id","label":"process","value":"tp_public","tone":"quiet"}
				],
				"metadata":{
					"pending_handle":"tp_private",
					"pending_process_id":"tp_private",
					"cwd":"/Users/alice/private",
					"visible":"kept"
				},
				"payload":{
					"command":"sleep 10",
					"process_id":"tp_public",
					"pending_handle":"tp_private",
					"cwd":"/Users/alice/private",
					"workdir":"/Users/alice/private",
					"stdin":"secret",
					"output":"",
					"status":"success",
					"result":{"cwd":"/Users/alice/private","pending_state":"running","visible":"kept"}
				}
			}]
		}]
	}`
	sanitized, err := SanitizeActivityTimelineMessageJSON(raw)
	if err != nil {
		t.Fatalf("SanitizeActivityTimelineMessageJSON: %v", err)
	}
	body := string(sanitized)
	for _, forbidden := range []string{`"cwd"`, `"workdir"`, `"stdin"`, `"pending_handle"`, `"pending_process_id"`, `"pending_state"`, `"kind":"state"`, `"kind":"handle"`, "tp_private", "/Users/alice/private", "secret"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("terminal public activity contains %q: %s", forbidden, body)
		}
	}
	for _, required := range []string{`"command":"sleep 10"`, `"process_id":"tp_public"`, `"output":""`, `"status":"success"`, `"visible":"kept"`, `"kind":"process_id"`} {
		if !strings.Contains(body, required) {
			t.Fatalf("terminal public activity missing %q: %s", required, body)
		}
	}
}

func TestActivityPayloadAllowedKeysExcludeForbiddenKeys(t *testing.T) {
	t.Parallel()

	renderers := []observation.ActivityRenderer{
		observation.ActivityRendererStructured,
		observation.ActivityRendererTerminal,
		observation.ActivityRendererFile,
		observation.ActivityRendererPatch,
		observation.ActivityRendererWebSearch,
		observation.ActivityRendererTodos,
		observation.ActivityRendererQuestion,
		observation.ActivityRendererCompletion,
	}
	for _, renderer := range renderers {
		renderer := renderer
		t.Run(string(renderer), func(t *testing.T) {
			t.Parallel()
			for key := range activityPayloadAllowedKeys(renderer) {
				if activityPayloadForbiddenKey(key) {
					t.Fatalf("renderer %q allows forbidden activity payload key %q", renderer, key)
				}
			}
		})
	}
}

func TestBroadcastTranscriptMessageSanitizesActivitySidecar(t *testing.T) {
	svc := newTestService(t, nil)
	notifier := newSinkTestNotifier(false)
	writer := newAISinkWriterWithNotifier(notifier)
	t.Cleanup(writer.Close)
	svc.mu.Lock()
	svc.realtimeWriters[nil] = writer
	svc.realtimeByThread[runThreadKey("env_realtime_sanitize", "thread_realtime_sanitize")] = map[*rpc.Server]struct{}{nil: {}}
	svc.mu.Unlock()

	svc.broadcastTranscriptMessage(
		"env_realtime_sanitize",
		"thread_realtime_sanitize",
		"run_realtime_sanitize",
		1,
		rawActivityMessageWithPrivateFileActionSidecar("msg_realtime"),
		1700000000000,
	)
	waitForSinkCondition(t, "sanitized transcript realtime event", func() bool {
		return len(notifier.snapshot()) == 1
	})
	notifications := notifier.snapshot()
	body := string(notifications[0].payload)
	for _, forbidden := range []string{"preview_path", "directory_path", "root_dir", `\"path\"`} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("transcript realtime event contains %q: %s", forbidden, body)
		}
	}
	for _, required := range []string{`"can_preview":true`, `"can_browse_directory":true`} {
		if !strings.Contains(body, required) {
			t.Fatalf("transcript realtime event missing %q: %s", required, body)
		}
	}
}
