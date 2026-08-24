package ai

import (
	"encoding/json"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/v5/identity"
	"github.com/floegence/floret/v5/observation"
	flruntime "github.com/floegence/floret/v5/runtime"
	fltools "github.com/floegence/floret/v5/tools"
)

func TestTypedThreadItemsPreserveOrderedPresentation(t *testing.T) {
	t.Parallel()
	const (
		threadID = "thread_ordered_presentation"
		turnID   = "turn_ordered_presentation"
	)
	createdAt := time.UnixMilli(1_700_000_000_000)
	activity := func(id string, status observation.ActivityStatus) *observation.ActivityItem {
		return &observation.ActivityItem{
			ItemID: id, ToolID: id, ToolName: "terminal.exec", Kind: observation.ActivityKindTool,
			Status: status, Severity: observation.ActivitySeverityNormal,
		}
	}
	items := []flruntime.ThreadItem{
		{ID: "user:turn:1", TurnID: identity.TurnID(turnID), Ordinal: 1, Kind: flruntime.ThreadItemUser, Text: "run both", CreatedAt: createdAt},
		{ID: "thinking:turn:1", TurnID: identity.TurnID(turnID), Ordinal: 2, Kind: flruntime.ThreadItemThinking, Text: "first reasoning", CreatedAt: createdAt, Live: true},
		{ID: "tool:turn:call-1", TurnID: identity.TurnID(turnID), Ordinal: 3, Kind: flruntime.ThreadItemTool, Activity: activity("call-1", observation.ActivityStatusWaiting), CreatedAt: createdAt},
		{ID: "thinking:turn:2", TurnID: identity.TurnID(turnID), Ordinal: 4, Kind: flruntime.ThreadItemThinking, Text: "second reasoning", CreatedAt: createdAt},
		{ID: "tool:turn:call-2", TurnID: identity.TurnID(turnID), Ordinal: 5, Kind: flruntime.ThreadItemTool, Activity: activity("call-2", observation.ActivityStatusSuccess), CreatedAt: createdAt},
		{ID: "assistant:turn:1", TurnID: identity.TurnID(turnID), Ordinal: 6, Kind: flruntime.ThreadItemAssistant, Text: "done", CreatedAt: createdAt, Live: true},
	}
	projected := publicFloretThreadView(flruntime.ThreadView{Items: items})
	for index := range items {
		if projected.Items[index].Live != items[index].Live {
			t.Fatalf("public current item %s live=%v, want %v", items[index].ID, projected.Items[index].Live, items[index].Live)
		}
	}

	var gotIDs []string
	for _, item := range items {
		raw, ok, err := typedThreadItemMessage(threadID, item)
		if err != nil {
			t.Fatalf("map %s: %v", item.ID, err)
		}
		if !ok {
			t.Fatalf("map %s: item was omitted", item.ID)
		}
		var message map[string]any
		if err := json.Unmarshal(raw, &message); err != nil {
			t.Fatalf("decode %s: %v", item.ID, err)
		}
		gotIDs = append(gotIDs, message["id"].(string))
		if message["role"] != map[flruntime.ThreadItemKind]string{
			flruntime.ThreadItemUser: "user",
		}[item.Kind] && message["role"] != "assistant" {
			t.Fatalf("item %s role=%v", item.ID, message["role"])
		}
		blocks := message["blocks"].([]any)
		first := blocks[0].(map[string]any)
		switch item.Kind {
		case flruntime.ThreadItemThinking:
			if first["type"] != "thinking" || first["content"] != item.Text {
				t.Fatalf("thinking %s block=%#v", item.ID, first)
			}
		case flruntime.ThreadItemTool:
			if first["type"] != activityTimelineBlockType {
				t.Fatalf("tool %s block=%#v", item.ID, first)
			}
			activityItems := first["items"].([]any)
			if activityItems[0].(map[string]any)["tool_id"] != item.Activity.ToolID {
				t.Fatalf("tool %s activity=%#v", item.ID, activityItems[0])
			}
		}
		wantLive := item.Live
		if message["live"] != wantLive {
			t.Fatalf("item %s live=%v, want %v", item.ID, message["live"], wantLive)
		}
	}
	wantIDs := []string{"user:turn:1", "thinking:turn:1", "tool:turn:call-1", "thinking:turn:2", "tool:turn:call-2", "assistant:turn:1"}
	if !slices.Equal(gotIDs, wantIDs) {
		t.Fatalf("ordered IDs=%v, want %v", gotIDs, wantIDs)
	}

	completed := append([]flruntime.ThreadItem(nil), items...)
	completed[1].Live = false
	completed[2].Activity = activity("call-1", observation.ActivityStatusSuccess)
	completed[5].Live = false
	for index, item := range completed {
		raw, ok, err := typedThreadItemMessage(threadID, item)
		if err != nil || !ok {
			t.Fatalf("reload map %s: ok=%v err=%v", item.ID, ok, err)
		}
		var message struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(raw, &message); err != nil {
			t.Fatal(err)
		}
		if message.ID != wantIDs[index] {
			t.Fatalf("reload ID[%d]=%q, want %q", index, message.ID, wantIDs[index])
		}
	}
}

func TestTypedThreadItemMapsOnlyResolvedVisibleInputInteractions(t *testing.T) {
	t.Parallel()
	resolved := flruntime.ThreadInteractionInput
	item := flruntime.ThreadItem{
		ID: "interaction:answer", TurnID: identity.TurnID("turn_answer"), Ordinal: 1,
		Kind: flruntime.ThreadItemInteraction,
		Interaction: &flruntime.ThreadInteraction{
			ID: "answer", TurnID: identity.TurnID("turn_answer"), Kind: resolved, Resolved: true,
			Resolution: &flruntime.InteractionResolution{Accepted: true, Input: map[string]string{"b": "second", "a": "first"}},
		},
	}
	raw, ok, err := typedThreadItemMessage("thread_answer", item)
	if err != nil || !ok {
		t.Fatalf("resolved input: ok=%v err=%v", ok, err)
	}
	var message map[string]any
	if err := json.Unmarshal(raw, &message); err != nil {
		t.Fatal(err)
	}
	if message["id"] != item.ID || message["role"] != "user" || message["content"] != "first\nsecond" {
		t.Fatalf("resolved input message=%#v", message)
	}

	item.Interaction.Resolved = false
	if _, ok, err := typedThreadItemMessage("thread_answer", item); err != nil || ok {
		t.Fatalf("unresolved input: ok=%v err=%v", ok, err)
	}
	item.Interaction.Resolved = true
	item.Interaction.Resolution.Redacted = true
	if _, ok, err := typedThreadItemMessage("thread_answer", item); err != nil || ok {
		t.Fatalf("redacted input: ok=%v err=%v", ok, err)
	}
}

func TestTypedTimelineDoesNotConsumeDeprecatedGlobalDrafts(t *testing.T) {
	t.Parallel()
	for _, sourceFile := range []string{"floret_timeline_messages.go", "subagents_floret.go"} {
		source, err := os.ReadFile(sourceFile)
		if err != nil {
			t.Fatal(err)
		}
		for _, forbidden := range []string{".AssistantDraft", ".ThinkingDraft"} {
			if strings.Contains(string(source), forbidden) {
				t.Fatalf("%s still consumes deprecated global draft %s", sourceFile, forbidden)
			}
		}
	}
}

func TestPublicFloretActivityProjectionRemovesPrivatePathsEverywhere(t *testing.T) {
	t.Parallel()
	pathPayload := fltools.FileActivityPayload{Path: "/workspace/private.md", Operation: "write", Status: "success", Summary: "updated"}
	activity := &observation.ActivityItem{
		ItemID: "activity:file-write", ToolID: "file-write", ToolName: "file.write",
		Kind: observation.ActivityKindTool, Status: observation.ActivityStatusSuccess,
		Presentation: &fltools.ActivityPresentation{
			Label: "private.md", Renderer: fltools.ActivityRendererFile, Payload: pathPayload,
			TargetRefs: []fltools.ActivityTargetRef{{Kind: "file", Label: "private.md", Path: "/workspace/private.md", URI: "file:///workspace/private.md", Line: 3}},
		},
		Metadata: map[string]string{"display_name": "private.md", "path": "/workspace/private.md", "pending_token": "secret"},
	}
	view := publicFloretThreadView(flruntime.ThreadView{Items: []flruntime.ThreadItem{{
		ID: "tool:write", TurnID: "turn:write", Ordinal: 1, Kind: flruntime.ThreadItemTool, Activity: activity,
	}}})
	if view.Items[0].Activity == nil || view.Items[0].Activity.Presentation == nil {
		t.Fatal("public activity was dropped")
	}
	raw, err := json.Marshal(view.Items[0].Activity)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"\"path\"", "\"file_path\"", "\"pending_token\"", "private.md"} {
		if strings.Contains(string(raw), forbidden) && forbidden != "private.md" {
			t.Fatalf("public activity contains forbidden field %s: %s", forbidden, raw)
		}
	}
	if _, ok := view.Items[0].Activity.Presentation.Payload.(fltools.FileActivityPayload); !ok {
		t.Fatalf("payload type=%T, want file payload", view.Items[0].Activity.Presentation.Payload)
	}
	payload := view.Items[0].Activity.Presentation.Payload.(fltools.FileActivityPayload)
	if payload.Path != "" || payload.Operation != "write" || payload.Status != "success" {
		t.Fatalf("public file payload=%+v", payload)
	}
	if len(view.Items[0].Activity.Presentation.TargetRefs) != 1 || view.Items[0].Activity.Presentation.TargetRefs[0].Path != "" {
		t.Fatalf("public target refs=%+v", view.Items[0].Activity.Presentation.TargetRefs)
	}
	if view.Items[0].Activity.Metadata["display_name"] != "private.md" || len(view.Items[0].Activity.Metadata) != 1 {
		t.Fatalf("public metadata=%+v", view.Items[0].Activity.Metadata)
	}
	rawMessage, ok, err := typedThreadItemMessage("thread:write", view.Items[0])
	if err != nil || !ok {
		t.Fatalf("typed timeline projection: ok=%v err=%v", ok, err)
	}
	if strings.Contains(string(rawMessage), `"path"`) {
		t.Fatalf("typed timeline contains private path: %s", rawMessage)
	}
}

func TestPublicFloretThreadViewHidesQueuedSupplementalContext(t *testing.T) {
	t.Parallel()
	view := publicFloretThreadView(flruntime.ThreadView{
		Queue: []flruntime.QueuedInput{{
			ID:         "queue:context",
			RequestKey: "context-request",
			Input:      flruntime.UserInput{Text: "review"},
			SupplementalContext: []flruntime.TurnSupplementalContextItem{{
				Kind: "file_path", Title: "User-selected file", Text: "private context", Metadata: map[string]string{"label": "secret.md"}, Sensitive: true,
			}},
		}},
	})
	if len(view.Queue) != 1 {
		t.Fatalf("queue=%#v, want one queued input", view.Queue)
	}
	if len(view.Queue[0].SupplementalContext) != 0 {
		t.Fatalf("public queue leaked supplemental context: %#v", view.Queue[0].SupplementalContext)
	}
	if view.Queue[0].Input.Text != "review" {
		t.Fatalf("public queue input=%#v, want user text preserved", view.Queue[0].Input)
	}
}

func TestFlowerCurrentProjectionScopesAttachmentURLs(t *testing.T) {
	t.Parallel()
	uploadID := "upl_" + strings.Repeat("a", 24)
	resourceRef := "redeven-upload:v1:" + uploadID + ":sha256:" + strings.Repeat("a", 64)
	current := flruntime.ThreadView{
		ThreadID:    identity.ThreadID("thread_preview"),
		ViewVersion: 7,
		Items: []flruntime.ThreadItem{{
			ID: "user:item", TurnID: identity.TurnID("turn_preview"), Kind: flruntime.ThreadItemUser,
			Attachments: []flruntime.MessageAttachment{{ResourceRef: resourceRef, Name: "photo.png", MIMEType: "image/png", SizeBytes: 12}},
		}},
		Queue: []flruntime.QueuedInput{{
			ID: "queue_preview", RequestKey: "request_preview",
			Input: flruntime.UserInput{Attachments: []flruntime.MessageAttachment{{ResourceRef: resourceRef, Name: "photo.png", MIMEType: "image/png", SizeBytes: 12}}},
		}},
	}
	encoded, err := json.Marshal(SendUserTurnResponse{ThreadID: current.ThreadID.String(), Current: current})
	if err != nil {
		t.Fatalf("marshal current: %v", err)
	}
	raw := string(encoded)
	if strings.Contains(raw, "resource_ref") || strings.Contains(raw, resourceRef) {
		t.Fatalf("current leaked opaque resource reference: %s", raw)
	}
	var response struct {
		Current struct {
			Items []struct {
				Attachments []struct {
					URL string `json:"url"`
				} `json:"attachments"`
			} `json:"items"`
			Queue []struct {
				Input struct {
					Attachments []struct {
						URL string `json:"url"`
					} `json:"attachments"`
				} `json:"input"`
			} `json:"queue"`
		} `json:"current"`
	}
	if err := json.Unmarshal(encoded, &response); err != nil {
		t.Fatal(err)
	}
	itemAttachment := response.Current.Items[0].Attachments[0]
	if !strings.Contains(itemAttachment.URL, "thread_id=thread_preview") || !strings.Contains(itemAttachment.URL, "turn_id=turn_preview") {
		t.Fatalf("canonical attachment projection=%+v", itemAttachment)
	}
	queueAttachment := response.Current.Queue[0].Input.Attachments[0]
	if !strings.Contains(queueAttachment.URL, "thread_id=thread_preview") || !strings.Contains(queueAttachment.URL, "queue_id=queue_preview") {
		t.Fatalf("queued attachment projection=%+v", queueAttachment)
	}
}

func TestCanonicalAttachmentWithoutSafeResourceFallsBackToFileBlock(t *testing.T) {
	t.Parallel()
	message, err := canonicalUserTimelineMessageForThread(
		"thread_preview", "turn_preview", "entry_preview", "inspect", []flruntime.MessageAttachment{{
			ResourceRef: "legacy-private-locator", Name: "photo.png", MIMEType: "image/png", SizeBytes: 12,
		}}, nil, time.UnixMilli(1_700_000_000_000).UnixMilli(),
	)
	if err != nil {
		t.Fatalf("canonical message: %v", err)
	}
	var projected struct {
		Blocks []struct {
			Type string `json:"type"`
			Name string `json:"name"`
			URL  string `json:"url"`
		} `json:"blocks"`
	}
	if err := json.Unmarshal(message, &projected); err != nil {
		t.Fatal(err)
	}
	if len(projected.Blocks) < 1 || projected.Blocks[0].Type != "file" || projected.Blocks[0].Name != "photo.png" || projected.Blocks[0].URL != "" {
		t.Fatalf("unsafe attachment projection=%#v", projected.Blocks)
	}
}

func TestQueuedAttachmentWithoutSafeResourceKeepsStableDisplayIdentity(t *testing.T) {
	t.Parallel()
	view := queuedInputView("thread_preview", flruntime.QueuedInput{
		ID: "queue_preview",
		Input: flruntime.UserInput{Attachments: []flruntime.MessageAttachment{{
			ResourceRef: "legacy-private-locator", Name: "notes.txt", MIMEType: "text/plain", SizeBytes: 12,
		}}},
	})
	if len(view.Attachments) != 1 {
		t.Fatalf("queued attachments=%#v", view.Attachments)
	}
	if view.Attachments[0].AttachmentID != "queued:queue_preview:0" || view.Attachments[0].URL != "" {
		t.Fatalf("queued unsafe attachment=%#v", view.Attachments[0])
	}
}
