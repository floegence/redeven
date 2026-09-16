package ai

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
)

func TestFlowerApprovalBatchUsesExactAtomicSet(t *testing.T) {
	for _, approved := range []bool{false, true} {
		t.Run(fmt.Sprint(approved), func(t *testing.T) {
			var calls atomic.Int32
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				flusher := w.(http.Flusher)
				if tools, _ := body["tools"].([]any); len(tools) == 0 {
					writeAskUserIntegrationTextResponse(w, flusher, "title", "Batch decisions")
					return
				}
				if calls.Add(1) != 1 {
					writeAskUserIntegrationTextResponse(w, flusher, "done", "Completed")
					return
				}
				for i := range 3 {
					item := map[string]any{"type": "function_call", "id": fmt.Sprintf("fc_%d", i), "call_id": fmt.Sprintf("call_%d", i), "name": "terminal.exec", "arguments": `{"command":"printf batch","yield_ms":10000}`}
					writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.added", "output_index": i, "item": item})
					writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.done", "output_index": i, "item": item})
				}
				writeAskUserIntegrationCompletedResponse(w, flusher, "waiting")
			}))
			defer provider.Close()
			svc := openRealtimeTestService(t, t.TempDir(), provider.URL)
			defer svc.Close()
			meta := testSendTurnMeta()
			created, err := svc.CreateThread(t.Context(), meta, "", "openai/gpt-5-mini", "", "")
			if err != nil {
				t.Fatal(err)
			}
			_, err = svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: created.ThreadID, ClientRequestID: "batch-start", Model: "openai/gpt-5-mini", Input: RunInput{Text: "Run three commands."}, Options: RunOptions{PermissionType: config.AIPermissionApprovalRequired}})
			if err != nil {
				t.Fatal(err)
			}
			var view flruntime.ThreadView
			deadline := time.Now().Add(5 * time.Second)
			for time.Now().Before(deadline) {
				view, err = svc.threadRuntime.View(t.Context(), identity.ThreadID(created.ThreadID))
				if err != nil {
					t.Fatal(err)
				}
				if len(view.Interactions) == 3 {
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
			if len(view.Interactions) != 3 {
				t.Fatalf("expected three approvals: %#v", view)
			}
			ids := []string{view.Interactions[0].ID, view.Interactions[1].ID}
			submit := func(ids []string, single string, decision bool) error {
				data, _ := json.Marshal(map[string]any{"thread_id": created.ThreadID, "interaction_ids": ids, "interaction_id": single, "approved": decision})
				var req SubmitFlowerApprovalRequest
				if err := json.Unmarshal(data, &req); err != nil {
					return err
				}
				_, err := svc.SubmitFlowerApproval(meta, req)
				return err
			}
			// Invalid membership must not consume an otherwise valid first interaction.
			for _, invalid := range [][]string{{ids[0], "missing"}, {ids[0], ids[0]}, {ids[0], ""}, {}} {
				if err := submit(invalid, "", approved); err == nil {
					t.Fatalf("accepted invalid batch %v", invalid)
				}
			}
			if err := submit(ids, ids[0], approved); err == nil {
				t.Fatal("accepted ambiguous single and batch")
			}
			view, _ = svc.threadRuntime.View(t.Context(), identity.ThreadID(created.ThreadID))
			for _, interaction := range view.Interactions {
				if interaction.Resolved {
					t.Fatal("invalid batch partially resolved")
				}
			}
			if err := submit(ids, "", approved); err != nil {
				t.Fatal(err)
			}
			if err := submit(ids, "", approved); err != nil {
				t.Fatalf("same batch replay: %v", err)
			}
			// A conflicting answered member makes the whole batch fail, including a new member.
			if err := submit([]string{ids[0], view.Interactions[2].ID}, "", !approved); err == nil {
				t.Fatal("accepted conflicting batch")
			}
			view, _ = svc.threadRuntime.View(t.Context(), identity.ThreadID(created.ThreadID))
			if !view.Interactions[0].Resolved || !view.Interactions[1].Resolved || view.Interactions[2].Resolved {
				t.Fatalf("batch expanded or partially committed: %#v", view.Interactions)
			}
		})
	}
}
