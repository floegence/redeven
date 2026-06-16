package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

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

func TestPublicActiveRunMessageSnapshotSanitizesActivityTimeline(t *testing.T) {
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

	publicSnapshot := r.publicActiveRunMessageSnapshot()
	if len(publicSnapshot.MessageJSON) == 0 {
		t.Fatalf("missing public active snapshot")
	}
	body := string(publicSnapshot.MessageJSON)
	for _, forbidden := range []string{"preview_path", "directory_path", "root_dir", `\"path\"`, `"cwd"`, `"stdin"`} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("public active snapshot contains %q: %s", forbidden, body)
		}
	}
	for _, required := range []string{`"can_preview":true`, `"can_browse_directory":true`} {
		if !strings.Contains(body, required) {
			t.Fatalf("public active snapshot missing %q: %s", required, body)
		}
	}

	rawSnapshot := r.activeRunMessageSnapshot()
	if !strings.Contains(string(rawSnapshot.MessageJSON), "preview_path") {
		t.Fatalf("raw active snapshot should retain private file action data for privileged resolver: %s", string(rawSnapshot.MessageJSON))
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
