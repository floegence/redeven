package ai

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
)

func TestThreadGoalCreatesEmptyThreadWithoutExecutionAndReplays(t *testing.T) {
	svc := newRealtimeTestService(t, 0)
	meta := testSendTurnMeta()
	text := "  " + strings.Repeat("Deliver the verified result. ", 1000) + "\n"
	req := ThreadGoalRequest{StorageGeneration: svc.storageGeneration, ClientRequestID: "goal-create", Operation: "set", Text: text, NewThread: &CreateThreadRequest{ModelID: "openai/gpt-5-mini"}}
	result, current, err := svc.ManageThreadGoal(t.Context(), meta, req)
	if err != nil {
		t.Fatal(err)
	}
	if result.Goal.Text != text || result.Goal.Version != 1 || current.TurnID != "" || current.RunID != "" || len(current.Queue) != 0 || current.Activity != flruntime.ThreadActivityIdle {
		t.Fatalf("mutation=%+v current=%+v", result, current)
	}
	if len(current.Items) != 1 || current.Items[0].Kind != flruntime.ThreadItemGoal {
		t.Fatalf("items=%+v", current.Items)
	}
	replay, again, err := svc.ManageThreadGoal(t.Context(), meta, req)
	if err != nil || !replay.Replayed || again.ThreadID != current.ThreadID || len(again.Items) != 1 {
		t.Fatalf("replay=%+v current=%+v err=%v", replay, again, err)
	}
	if _, err := MarshalFlowerCurrentView(current); err != nil {
		t.Fatal(err)
	}
	history, err := svc.typedTimelineMessages(t.Context(), meta, current.ThreadID.String())
	if err != nil || len(history) != 1 {
		t.Fatalf("history=%+v err=%v", history, err)
	}
	var message struct {
		Goal   *flruntime.ThreadGoalChange
		Role   string
		TurnID string `json:"turn_id"`
	}
	if err := json.Unmarshal(history[0].MessageJSON, &message); err != nil {
		t.Fatal(err)
	}
	if message.Goal == nil || message.Goal.Goal.Text != text || message.Role != "system" || message.TurnID != "" {
		t.Fatalf("message=%+v", message)
	}
}

func TestThreadGoalConflictDeleteAndAuthority(t *testing.T) {
	svc := newRealtimeTestService(t, time.Second)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "goal", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	request := ThreadGoalRequest{StorageGeneration: svc.storageGeneration, ClientRequestID: "goal-set", ThreadID: thread.ThreadID, Operation: "set", Text: "Verify the change"}
	set, _, err := svc.ManageThreadGoal(t.Context(), meta, request)
	if err != nil || set.Goal.Version != 1 {
		t.Fatalf("set=%+v err=%v", set, err)
	}
	request.ClientRequestID = "goal-stale"
	request.Text = "Unsaved edit"
	conflict, _, err := svc.ManageThreadGoal(t.Context(), meta, request)
	if err != nil || !conflict.Conflict || conflict.Goal.Text != "Verify the change" {
		t.Fatalf("conflict=%+v err=%v", conflict, err)
	}
	request.ClientRequestID, request.ExpectedVersion, request.Operation = "goal-delete", 1, "delete"
	deleted, current, err := svc.ManageThreadGoal(t.Context(), meta, request)
	if err != nil || deleted.Goal.Status != "absent" || deleted.Goal.Version != 2 || current.Goal.Status != "absent" {
		t.Fatalf("delete=%+v err=%v", deleted, err)
	}
	request.ClientRequestID, request.ExpectedVersion, request.Operation = "goal-denied", 2, "set"
	readonly := *meta
	readonly.CanExecute = false
	if _, _, err := svc.ManageThreadGoal(t.Context(), &readonly, request); err == nil {
		t.Fatal("read-only access mutated goal")
	}
	other := *meta
	other.EndpointID = "other-endpoint"
	if _, _, err := svc.ManageThreadGoal(t.Context(), &other, request); err == nil {
		t.Fatal("another endpoint mutated goal")
	}
	request.StorageGeneration = "obsolete"
	if _, _, err := svc.ManageThreadGoal(t.Context(), meta, request); !errors.Is(err, ErrFlowerStorageRestored) {
		t.Fatalf("generation error=%v", err)
	}
	view, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
	if err != nil || view.Goal.Version != 2 || view.TurnID != "" {
		t.Fatalf("view=%+v err=%v", view, err)
	}
}

func TestDefaultFlowerToolsExcludeTodo(t *testing.T) {
	for _, tool := range builtInToolDefinitions() {
		if tool.Name == "write_todos" {
			t.Fatal("default tool registry re-enabled Todo")
		}
	}
}

func TestFlowerGoalReflectionUsesExistingContextAndExcludesDefaultTodo(t *testing.T) {
	var mu sync.Mutex
	var requests []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			http.Error(w, "invalid", 400)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		tools, _ := request["tools"].([]any)
		if len(tools) == 0 {
			writeAskUserIntegrationTextResponse(w, flusher, "title", "Verify the result")
			return
		}
		mu.Lock()
		index := len(requests)
		requests = append(requests, request)
		mu.Unlock()
		if index == 1 {
			args := `{"operation":"review","expected_version":1,"outcome":"completed","evidence":"The requested result is present in the preceding response."}`
			item := map[string]any{"type": "function_call", "id": "goal-review", "call_id": "goal-review", "name": "goal", "arguments": args}
			for _, event := range []string{"response.output_item.added", "response.output_item.done"} {
				writeOpenAISSEJSON(w, flusher, map[string]any{"type": event, "output_index": 0, "item": item})
			}
			writeAskUserIntegrationCompletedResponse(w, flusher, "review")
			return
		}
		writeAskUserIntegrationTextResponse(w, flusher, "result", "The verified result is ready.")
	}))
	defer server.Close()
	svc := openRealtimeTestService(t, t.TempDir(), server.URL)
	defer svc.Close()
	meta := testSendTurnMeta()
	_, view, err := svc.ManageThreadGoal(t.Context(), meta, ThreadGoalRequest{StorageGeneration: svc.storageGeneration, ClientRequestID: "provider-goal", Operation: "set", Text: "Deliver the verified result", NewThread: &CreateThreadRequest{ModelID: "openai/gpt-5-mini"}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ClientRequestID: "provider-send", ThreadID: view.ThreadID.String(), Input: RunInput{Text: "Provide the result"}})
	if err != nil {
		t.Fatal(err)
	}
	terminal := waitForAskUserIntegrationThread(t, svc, meta, view.ThreadID.String(), func(v *ThreadView) bool { return v.RunStatus == "success" || v.RunStatus == "failed" }, 15*time.Second)
	if terminal.RunStatus != "success" {
		t.Fatalf("turn failed: %s", terminal.RunError)
	}
	current, err := svc.threadRuntime.View(t.Context(), view.ThreadID)
	if err != nil || current.Goal == nil || current.Goal.Status != "completed" {
		t.Fatalf("goal=%+v err=%v", current.Goal, err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(requests) != 3 {
		t.Fatalf("requests=%d", len(requests))
	}
	for i, request := range requests {
		foundGoal := false
		for _, raw := range request["tools"].([]any) {
			tool := raw.(map[string]any)
			if tool["name"] == "write_todos" {
				t.Fatal("Todo re-enabled in actual provider request")
			}
			foundGoal = foundGoal || tool["name"] == "goal"
		}
		if !foundGoal {
			t.Fatalf("request %d missing Goal", i)
		}
		prompt, _ := request["instructions"].(string)
		if strings.Contains(prompt, "write_todos") || strings.Contains(prompt, "Todo Discipline") {
			t.Fatal("Todo instructions remain")
		}
		if i > 0 && request["instructions"] != requests[0]["instructions"] {
			t.Fatal("reflection rewrote base prompt")
		}
	}
	history, err := svc.typedTimelineMessages(t.Context(), meta, view.ThreadID.String())
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range history {
		if strings.Contains(string(item.MessageJSON), "Check the current Goal") {
			t.Fatal("internal reflection leaked as user input")
		}
	}
}

func TestGoalDraftAttachmentsBindAndSendAfterEmptyThreadCreation(t *testing.T) {
	svc := newRealtimeTestService(t, time.Millisecond)
	meta := testSendTurnMeta()
	owner, err := NewUploadOwner(meta.EndpointID, meta.UserPublicID, meta.ChannelID)
	if err != nil {
		t.Fatal(err)
	}
	scope, err := svc.CreateUploadStagingScope(t.Context(), owner, "draft-goal-attachment")
	if err != nil {
		t.Fatal(err)
	}
	content, name := "Goal draft evidence\n", "evidence.txt"
	upload, err := svc.SaveUpload(t.Context(), SaveUploadRequest{Owner: owner, StagingScopeID: scope.StagingScopeID, StagingCapability: scope.Capability, Reader: strings.NewReader(content), DisplayName: name, UploadRequestID: "goal-file", ExpectedContentSHA256: fmt.Sprintf("%x", sha256.Sum256([]byte(content))), ExpectedSizeBytes: int64(len(content)), DisplayNameSHA256: fmt.Sprintf("%x", sha256.Sum256([]byte(name)))})
	if err != nil {
		t.Fatal(err)
	}
	req := ThreadGoalRequest{StorageGeneration: svc.storageGeneration, ClientRequestID: strings.Repeat("a", 128), Operation: "set", Text: "Inspect the attachment", NewThread: &CreateThreadRequest{ModelID: "openai/gpt-5-mini"}}
	_, current, err := svc.ManageThreadGoal(t.Context(), meta, req)
	if err != nil {
		t.Fatal(err)
	}
	send := SendUserTurnRequest{ClientRequestID: "send-bound-goal", ThreadID: current.ThreadID.String(), StagingScopeID: scope.StagingScopeID, StagingCapability: scope.Capability, Input: RunInput{Text: "Inspect the evidence", Attachments: []RunAttachmentIn{{AttachmentID: upload.AttachmentID}}}}
	if _, err := svc.SendUserTurn(t.Context(), meta, send); err == nil {
		t.Fatal("unbound draft attachment admitted")
	}
	for i := 0; i < 2; i++ {
		bound, err := svc.BindDraftUploadStaging(t.Context(), meta, scope.StagingScopeID, scope.Capability, scope.TargetID, current.ThreadID.String())
		if err != nil || bound.TargetID != current.ThreadID.String() {
			t.Fatalf("bound=%+v err=%v", bound, err)
		}
	}
	response, err := svc.SendUserTurn(t.Context(), meta, send)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.OpenCanonicalLiveAttachmentForTurn(t.Context(), owner, response.ThreadID, response.TurnID, upload.AttachmentID); err != nil {
		t.Fatal(err)
	}
}

// This wrapper loses only the response, preserving the canonical runtime as the
// authority so exact replay can prove that the mutation was not duplicated.
type goalLostResponseRuntime struct {
	flruntime.ThreadService
	flruntime.ThreadGoalController
	loseMutation bool
	loseView     bool
}

func (r goalLostResponseRuntime) SetGoal(ctx context.Context, in flruntime.SetGoalInput) (flruntime.GoalMutationResult, error) {
	result, err := r.ThreadGoalController.SetGoal(ctx, in)
	if err == nil && r.loseMutation {
		return flruntime.GoalMutationResult{}, errors.New("canonical refresh response lost")
	}
	return result, err
}
func (r goalLostResponseRuntime) View(ctx context.Context, id identity.ThreadID) (flruntime.ThreadView, error) {
	if r.loseView {
		return flruntime.ThreadView{}, errors.New("current view unavailable after mutation")
	}
	return r.ThreadService.View(ctx, id)
}
func TestThreadGoalLostResponseRetainsExactReplay(t *testing.T) {
	for _, stage := range []string{"mutation", "view"} {
		t.Run(stage, func(t *testing.T) {
			svc := newRealtimeTestService(t, 0)
			meta := testSendTurnMeta()
			thread, err := svc.CreateThread(t.Context(), meta, "", "openai/gpt-5-mini", "", "")
			if err != nil {
				t.Fatal(err)
			}
			canonical := svc.threadRuntime
			svc.threadRuntime = goalLostResponseRuntime{ThreadService: canonical, ThreadGoalController: canonical.(flruntime.ThreadGoalController), loseMutation: stage == "mutation", loseView: stage == "view"}
			request := ThreadGoalRequest{StorageGeneration: svc.storageGeneration, ClientRequestID: "lost-goal-response", ThreadID: thread.ThreadID, Operation: "set", Text: "Verify the result"}
			if _, _, err := svc.ManageThreadGoal(t.Context(), meta, request); !errors.Is(err, ErrThreadGoalOutcomeUnknown) {
				t.Fatalf("unconfirmed effect=%v", err)
			}
			svc.threadRuntime = canonical
			replay, view, err := svc.ManageThreadGoal(t.Context(), meta, request)
			if err != nil || !replay.Replayed || view.Goal.Version != 1 || len(view.Items) != 1 {
				t.Fatalf("replay=%+v current=%+v err=%v", replay, view, err)
			}
		})
	}
}

func TestFlowerStopDuringGoalReflectionRetainsUnfinishedGoal(t *testing.T) {
	reflection := make(chan struct{}, 1)
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		if tools, _ := request["tools"].([]any); len(tools) == 0 {
			writeAskUserIntegrationTextResponse(w, flusher, "title", "Verify result")
			return
		}
		if calls.Add(1) == 1 {
			writeAskUserIntegrationTextResponse(w, flusher, "result", "Result awaiting verification.")
			return
		}
		flusher.Flush()
		reflection <- struct{}{}
		select {
		case <-r.Context().Done():
		case <-time.After(10 * time.Second):
		}
	}))
	defer server.Close()
	svc := openRealtimeTestService(t, t.TempDir(), server.URL)
	defer svc.Close()
	meta := testSendTurnMeta()
	_, view, err := svc.ManageThreadGoal(t.Context(), meta, ThreadGoalRequest{StorageGeneration: svc.storageGeneration, ClientRequestID: "stop-goal", Operation: "set", Text: "Deliver a verified result", NewThread: &CreateThreadRequest{ModelID: "openai/gpt-5-mini"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ClientRequestID: "stop-send", ThreadID: view.ThreadID.String(), Input: RunInput{Text: "Finish"}}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-reflection:
	case <-time.After(10 * time.Second):
		t.Fatal("reflection did not start")
	}
	if _, err := svc.StopThread(t.Context(), meta, view.ThreadID.String()); err != nil {
		t.Fatal(err)
	}
	stopped := waitForAskUserIntegrationThread(t, svc, meta, view.ThreadID.String(), func(v *ThreadView) bool {
		return v.ActiveRunID == "" && v.RunStatus != "running" && v.RunStatus != "waiting_user"
	})
	current, err := svc.threadRuntime.View(t.Context(), view.ThreadID)
	if err != nil || current.Goal.Status != "active" || current.Goal.Reviewing || calls.Load() != 2 {
		t.Fatalf("goal=%+v status=%s calls=%d err=%v", current.Goal, stopped.RunStatus, calls.Load(), err)
	}
}
