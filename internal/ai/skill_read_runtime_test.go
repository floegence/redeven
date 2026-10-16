package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
)

func writeSkillReadFixture(t *testing.T, root, description, body string) string {
	t.Helper()
	path := filepath.Join(root, ".redeven", "skills", "complete-context", "SKILL.md")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("---\nname: complete-context\ndescription: "+description+"\n---\n"+body+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func skillReadOutputs(t *testing.T, request map[string]any) []map[string]any {
	t.Helper()
	var outputs []map[string]any
	input, _ := request["input"].([]any)
	for _, raw := range input {
		item, _ := raw.(map[string]any)
		if item["type"] != "function_call_output" {
			continue
		}
		var output map[string]any
		if err := json.Unmarshal([]byte(anyToString(item["output"])), &output); err != nil {
			t.Errorf("decode tool result: %v", err)
		}
		data, ok := output["data"].(map[string]any)
		if !ok {
			t.Errorf("missing tool result data: %+v", output)
		}
		outputs = append(outputs, data)
	}
	return outputs
}

func writeSkillReadCall(w http.ResponseWriter, flusher http.Flusher, call int) {
	id := fmt.Sprintf("skill_read_%d", call)
	item := map[string]any{"type": "function_call", "id": "fc_" + id, "call_id": "call_" + id, "name": "use_skill", "arguments": `{"name":"complete-context"}`}
	writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.added", "output_index": 0, "item": item})
	writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item})
	writeAskUserIntegrationCompletedResponse(w, flusher, "resp_"+id)
}

// Decode only background-message envelopes, never tool results or user input.
func skillCatalogUpdates(t *testing.T, request map[string]any) []string {
	t.Helper()
	var updates []string
	input, _ := request["input"].([]any)
	for _, raw := range input {
		item, _ := raw.(map[string]any)
		if item["role"] != "user" {
			continue
		}
		content, _ := item["content"].([]any)
		for _, rawPart := range content {
			part, _ := rawPart.(map[string]any)
			text := anyToString(part["text"])
			if !strings.HasPrefix(text, "Model context update (") {
				continue
			}
			_, payload, ok := strings.Cut(text, "\n")
			if !ok {
				t.Errorf("missing background envelope: %s", text)
				continue
			}
			var update struct {
				Sections []flruntime.ModelContextSection `json:"sections"`
			}
			if err := json.Unmarshal([]byte(payload), &update); err != nil {
				t.Errorf("decode background message: %v", err)
			}
			for _, section := range update.Sections {
				if section.Key == "skills" {
					updates = append(updates, section.Text)
				}
			}
		}
	}
	return updates
}

func TestUseSkillReadsChangedBodyInProviderResults(t *testing.T) {
	root := t.TempDir()
	writeSkillReadFixture(t, root, "Stable skill catalog", "SKILL_BODY_A")
	var mu sync.Mutex
	var requests []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(200)
		flusher := w.(http.Flusher)
		if tools, _ := body["tools"].([]any); len(tools) == 0 {
			writeAskUserIntegrationTextResponse(w, flusher, "resp_title", "Skill reads")
			return
		}
		mu.Lock()
		defer mu.Unlock()
		requests = append(requests, body)
		switch len(requests) {
		case 1:
			writeSkillReadCall(w, flusher, 1)
		case 2:
			writeSkillReadFixture(t, root, "Stable skill catalog", "SKILL_BODY_B")
			writeSkillReadCall(w, flusher, 2)
		case 3:
			writeSkillReadCall(w, flusher, 3)
		case 4:
			writeAskUserIntegrationTextResponse(w, flusher, "resp_done", "Read both versions.")
		default:
			t.Errorf("unexpected provider request %d", len(requests))
			writeAskUserIntegrationTextResponse(w, flusher, "resp_unexpected", "Stop.")
		}
	}))
	t.Cleanup(server.Close)
	svc := openRealtimeTestService(t, root, server.URL)
	t.Cleanup(func() { _ = svc.Close() })
	svc.skillManager.userHome = root
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Skill reads", "openai/gpt-5-mini", string(FlowerPermissionFullAccess), root)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(FlowerPermissionFullAccess)); err != nil {
		t.Fatal(err)
	}
	terminal, err := runTypedTurnForTest(t, t.Context(), svc, meta, "skill-reads", RunStartRequest{
		ThreadID: thread.ThreadID, Model: "openai/gpt-5-mini", Input: RunInput{Text: "Read the skill twice."}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess},
	})
	if err != nil {
		t.Fatalf("turn failed: %+v %v", terminal.Failure, err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(requests) != 4 {
		t.Fatalf("provider requests=%d, want 4", len(requests))
	}
	first := skillReadOutputs(t, requests[1])
	final := skillReadOutputs(t, requests[3])
	if len(first) != 1 || len(final) != 3 {
		t.Fatalf("tool results: first=%+v final=%+v", first, final)
	}
	if first[0]["content"] != "SKILL_BODY_A" || final[0]["content"] != "SKILL_BODY_A" || final[1]["content"] != "SKILL_BODY_B" || final[2]["content"] != "SKILL_BODY_B" {
		t.Fatalf("explicit reads or historical results are stale: first=%+v final=%+v", first, final)
	}
	if first[0]["already_active"] != false || final[1]["already_active"] != true || first[0]["activation_id"] != final[1]["activation_id"] {
		t.Fatalf("activation identity changed: first=%+v final=%+v", first, final)
	}
	for i, request := range requests {
		raw, _ := json.Marshal(request["input"])
		if count := strings.Count(string(raw), "Stable skill catalog"); count != 1 {
			t.Errorf("request %d repeats unchanged catalog %d times", i, count)
		}
	}
	for i, request := range requests {
		raw, _ := json.Marshal(request)
		var resultBytes int
		input, _ := request["input"].([]any)
		for _, item := range input {
			entry, _ := item.(map[string]any)
			if entry["type"] == "function_call_output" {
				resultBytes += len(anyToString(entry["output"]))
			}
		}
		t.Logf("body read request %d: catalog updates=%d; tool result text=%d bytes; complete decoded JSON=%d bytes", i+1, len(skillCatalogUpdates(t, request)), resultBytes, len(raw))
	}
}

func TestSkillCatalogChangesInActualProviderRequests(t *testing.T) {
	root := t.TempDir()
	path := writeSkillReadFixture(t, root, "CATALOG_ORIGINAL", "BODY_ORIGINAL")
	for i := range 24 {
		name := fmt.Sprintf("fixture-%02d", i)
		dir := filepath.Join(root, ".redeven", "skills", name)
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
		raw := fmt.Sprintf("---\nname: %s\ndescription: Deterministic catalog fixture %02d for explicit skill reads.\n---\nFixture body.", name, i)
		if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte(raw), 0600); err != nil {
			t.Fatal(err)
		}
	}
	var mu sync.Mutex
	var requests []map[string]any
	var sizes []int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		raw, err := io.ReadAll(req.Body)
		var body map[string]any
		if err != nil || json.Unmarshal(raw, &body) != nil {
			http.Error(w, "invalid fixture request", 400)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		if tools, _ := body["tools"].([]any); len(tools) != 0 {
			mu.Lock()
			requests = append(requests, body)
			sizes = append(sizes, len(raw))
			mu.Unlock()
		}
		writeAskUserIntegrationTextResponse(w, flusher, "resp_catalog", "Catalog observed.")
	}))
	t.Cleanup(server.Close)
	svc := openRealtimeTestService(t, root, server.URL)
	t.Cleanup(func() { _ = svc.Close() })
	svc.skillManager.userHome = root
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Catalog changes", "openai/gpt-5-mini", string(FlowerPermissionFullAccess), root)
	if err != nil {
		t.Fatal(err)
	}
	settings := newSkillManager(root, root)
	settings.userHome = root
	steps := []string{"initial", "unchanged", "body", "description", "disabled", "restored", "restricted", "permission_filtered", "permission_restored", "deleted", "added", "renamed"}
	wantUpdates := []int{1, 1, 1, 2, 3, 4, 4, 5, 6, 7, 8, 9}
	for i, step := range steps {
		mode := FlowerPermissionFullAccess
		switch step {
		case "body":
			writeSkillReadFixture(t, root, "CATALOG_ORIGINAL", "BODY_REVISED")
		case "description":
			writeSkillReadFixture(t, root, "CATALOG_REVISED", "BODY_REVISED")
		case "disabled", "restored":
			if _, err := settings.PatchToggles([]SkillTogglePatch{{Path: path, Enabled: step == "restored"}}); err != nil {
				t.Fatal(err)
			}
		case "restricted":
			raw := "---\nname: complete-context\ndescription: CATALOG_REVISED\npermission_hint: [full_access]\n---\nBODY_REVISED"
			if err := os.WriteFile(path, []byte(raw), 0600); err != nil {
				t.Fatal(err)
			}
		case "permission_filtered":
			mode = FlowerPermissionApprovalRequired
		case "deleted":
			if err := os.RemoveAll(filepath.Dir(path)); err != nil {
				t.Fatal(err)
			}
		case "added":
			writeSkillReadFixture(t, root, "CATALOG_REVISED", "BODY_REVISED")
		case "renamed":
			if err := os.Rename(filepath.Dir(path), filepath.Join(filepath.Dir(filepath.Dir(path)), "renamed-skill")); err != nil {
				t.Fatal(err)
			}
			raw := "---\nname: renamed-skill\ndescription: CATALOG_REVISED\n---\nBODY_REVISED"
			if err := os.WriteFile(filepath.Join(filepath.Dir(filepath.Dir(path)), "renamed-skill", "SKILL.md"), []byte(raw), 0600); err != nil {
				t.Fatal(err)
			}
		}
		if err := svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(mode)); err != nil {
			t.Fatal(err)
		}
		if _, err := runTypedTurnForTest(t, t.Context(), svc, meta, "catalog-"+step, RunStartRequest{ThreadID: thread.ThreadID, Model: "openai/gpt-5-mini", Input: RunInput{Text: "Observe skills."}, Options: RunOptions{PermissionType: permissionTypeString(mode)}}); err != nil {
			t.Fatalf("%s: %v", step, err)
		}
		mu.Lock()
		request := requests[len(requests)-1]
		mu.Unlock()
		updates := skillCatalogUpdates(t, request)
		if len(updates) != wantUpdates[i] {
			t.Fatalf("%s: skill updates=%d want=%d", step, len(updates), wantUpdates[i])
		}
		current := updates[len(updates)-1]
		wantSkill := step != "disabled" && step != "permission_filtered" && step != "deleted"
		if strings.Contains(current, "CATALOG_") != wantSkill || strings.Contains(current, "BODY_") {
			t.Fatalf("%s: incorrect catalog: %s", step, current)
		}
		for n := range 24 {
			if !strings.Contains(current, fmt.Sprintf("- fixture-%02d:", n)) {
				t.Errorf("%s: initial/replacement catalog lost fixture %02d", step, n)
			}
		}
		if step == "description" && !strings.Contains(current, "CATALOG_REVISED") || step == "renamed" && (!strings.Contains(current, "- renamed-skill:") || strings.Contains(current, "- complete-context:")) {
			t.Fatalf("%s: changed metadata missing: %s", step, current)
		}
	}
	mu.Lock()
	defer mu.Unlock()
	updates := skillCatalogUpdates(t, requests[3])
	section, _ := json.Marshal(flruntime.ModelContextSection{Key: "skills", Title: "Available skills", Text: updates[1]})
	t.Logf("fixed catalog: %d entries; initial catalog=%d bytes; one-description replacement=%d bytes (section JSON=%d); skill updates after 12 requests=9; no body tool results; complete request bytes=%v", len(svc.skillManager.List("full_access")), len(updates[0]), len(updates[1]), len(section), sizes)
}

func TestUseSkillReadsBodyAgainAfterRealCompaction(t *testing.T) {
	root := t.TempDir()
	writeSkillReadFixture(t, root, "COMPACTION_SKILL_CATALOG", "BODY_BEFORE_COMPACTION")
	var mu sync.Mutex
	phase := "first"
	var firstRequests, afterRequests []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		if tools, _ := body["tools"].([]any); len(tools) == 0 {
			writeAskUserIntegrationTextResponse(w, flusher, "resp_summary", "The skill was read. Filler turns were acknowledged. Read the skill again when needed.")
			return
		}
		mu.Lock()
		defer mu.Unlock()
		switch phase {
		case "first":
			firstRequests = append(firstRequests, body)
			if len(firstRequests) == 1 {
				writeSkillReadCall(w, flusher, 1)
				return
			}
		case "after":
			afterRequests = append(afterRequests, body)
			if len(afterRequests) == 1 {
				writeSkillReadCall(w, flusher, 2)
				return
			}
		}
		writeAskUserIntegrationTextResponse(w, flusher, "resp_ack", "Acknowledged.")
	}))
	t.Cleanup(server.Close)
	svc := openRealtimeTestService(t, root, server.URL)
	t.Cleanup(func() { _ = svc.Close() })
	svc.skillManager.userHome = root
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Skill compaction", "openai/gpt-5-mini", string(FlowerPermissionFullAccess), root)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(FlowerPermissionFullAccess)); err != nil {
		t.Fatal(err)
	}
	send := func(key, text string) {
		t.Helper()
		if _, err := runTypedTurnForTest(t, t.Context(), svc, meta, key, RunStartRequest{ThreadID: thread.ThreadID, Model: "openai/gpt-5-mini", Input: RunInput{Text: text}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess}}); err != nil {
			t.Fatal(err)
		}
	}
	send("before-compaction", "Read the skill.")
	mu.Lock()
	phase = "filler"
	mu.Unlock()
	for i := range 6 {
		send(fmt.Sprintf("filler-%d", i), strings.Repeat("Historical filler for deterministic compaction. ", 1000))
	}
	id := identity.ThreadID(thread.ThreadID)
	before, err := svc.threadRuntime.View(t.Context(), id)
	if err != nil {
		t.Fatal(err)
	}
	historical, _ := json.Marshal(before.Items)
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	defer cancel()
	compactQualificationThread(t, ctx, svc, meta, thread.ThreadID, "compact-skills")
	contextView, err := svc.threadRuntime.(flruntime.ThreadContextReader).Context(t.Context(), id)
	if err != nil || len(contextView.Compactions) != 1 || contextView.Compactions[0].Status != "compacted" {
		t.Fatalf("real compaction did not occur: %+v %v", contextView.Compactions, err)
	}
	writeSkillReadFixture(t, root, "COMPACTION_SKILL_CATALOG", "BODY_AFTER_COMPACTION")
	mu.Lock()
	phase = "after"
	mu.Unlock()
	send("after-compaction", "Read the skill again.")
	mu.Lock()
	defer mu.Unlock()
	if len(firstRequests) != 2 || len(afterRequests) != 2 {
		t.Fatalf("requests before=%d after=%d", len(firstRequests), len(afterRequests))
	}
	compactedInput, _ := json.Marshal(afterRequests[0]["input"])
	if strings.Contains(string(compactedInput), "BODY_BEFORE_COMPACTION") || strings.Contains(string(compactedInput), "BODY_AFTER_COMPACTION") || !strings.Contains(string(compactedInput), "COMPACTION_SKILL_CATALOG") {
		t.Fatal("compacted request must restore the catalog without loading a skill body")
	}
	first := skillReadOutputs(t, firstRequests[1])
	after := skillReadOutputs(t, afterRequests[1])
	if len(first) != 1 || len(after) != 1 || after[0]["content"] != "BODY_AFTER_COMPACTION" || after[0]["already_active"] != true || after[0]["activation_id"] != first[0]["activation_id"] {
		t.Fatalf("read after compaction: first=%+v after=%+v", first, after)
	}
	current, err := svc.threadRuntime.View(t.Context(), id)
	if err != nil || len(current.Items) < len(before.Items) {
		t.Fatalf("history unavailable: %v", err)
	}
	unchanged, _ := json.Marshal(current.Items[:len(before.Items)])
	if string(historical) != string(unchanged) || !strings.Contains(string(unchanged), "BODY_BEFORE_COMPACTION") {
		t.Fatal("compaction or rereading rewrote historical skill results")
	}
}

func TestSkillRereadCannotRewritePreparedRequestOrTransportRetry(t *testing.T) {
	root := t.TempDir()
	writeSkillReadFixture(t, root, "Prepared skill catalog", "PREPARED_BODY_A")
	mgr := newSkillManager(root, root)
	mgr.userHome = root
	r := newRun(runOptions{AgentHomeDir: root, WorkingDir: root, SkillManager: mgr})
	ctx := contextWithToolAuthorizationSnapshot(t.Context(), PermissionSnapshot{SnapshotID: "prepared-skill", PermissionType: FlowerPermissionFullAccess})
	first, _, err := r.activateSkill(ctx, "complete-context")
	if err != nil {
		t.Fatal(err)
	}
	gateway := &recordingPreparedGateway{}
	adapter := newFloretProviderAdapter(gateway, "openai", "gpt-test", ProviderControls{}, TurnBudgets{}, "")
	request := flprovider.Request{RunID: "skill-run", PromptScopeID: "skill-scope", Messages: []flprovider.Message{
		{Role: flprovider.RoleAssistant, ToolCalls: []flprovider.ToolCall{{ID: "skill-read", Name: "use_skill", Args: `{"name":"complete-context"}`}}},
		{Role: flprovider.RoleTool, ToolResult: &flprovider.ToolResult{CallID: "skill-read", ToolName: "use_skill", Text: first.Content}},
	}}
	prepared, err := adapter.Prepare(t.Context(), request)
	if err != nil {
		t.Fatal(err)
	}
	defer prepared.Close()
	fingerprint := prepared.RenderedPayloadFingerprint()
	writeSkillReadFixture(t, root, "Prepared skill catalog", "PREPARED_BODY_B")
	next, active, err := r.activateSkill(ctx, "complete-context")
	if err != nil || !active || next.Content != "PREPARED_BODY_B" {
		t.Fatalf("reread=%+v active=%v err=%v", next, active, err)
	}
	stream, err := prepared.Stream(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	for range stream {
	}
	request.AttemptID, request.AttemptEpoch = "retry", 2
	retry, err := prepared.(*preparedFloretModelRequest).PrepareRetry(t.Context(), request)
	if err != nil {
		t.Fatal(err)
	}
	defer retry.Close()
	stream, err = retry.Stream(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	for range stream {
	}
	if retry.RenderedPayloadFingerprint() != fingerprint {
		t.Fatal("reread changed prepared request fingerprint")
	}
	gateway.mu.Lock()
	defer gateway.mu.Unlock()
	if len(gateway.requests) != 2 {
		t.Fatalf("prepared requests=%d", len(gateway.requests))
	}
	for _, sent := range gateway.requests {
		raw, _ := json.Marshal(sent.Messages)
		if !strings.Contains(string(raw), "PREPARED_BODY_A") || strings.Contains(string(raw), "PREPARED_BODY_B") {
			t.Fatalf("prepared skill result changed: %s", raw)
		}
	}
}

func TestUseSkillRejectsChangedAvailabilityInProviderResults(t *testing.T) {
	for _, change := range []string{"disabled", "deleted", "restricted", "read_failure", "parse_failure"} {
		t.Run(change, func(t *testing.T) {
			root := t.TempDir()
			path := writeSkillReadFixture(t, root, "Stable available skill", "HISTORICAL_ALLOWED_BODY")
			settings := newSkillManager(root, root)
			settings.userHome = root
			var mu sync.Mutex
			var requests []map[string]any
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				var body map[string]any
				if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
					http.Error(w, err.Error(), 400)
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				flusher := w.(http.Flusher)
				if tools, _ := body["tools"].([]any); len(tools) == 0 {
					writeAskUserIntegrationTextResponse(w, flusher, "resp_title", "Skill availability")
					return
				}
				mu.Lock()
				defer mu.Unlock()
				requests = append(requests, body)
				switch len(requests) {
				case 1:
					writeSkillReadCall(w, flusher, 1)
				case 2:
					// Mutate after request preparation but before its explicit tool call.
					var err error
					switch change {
					case "disabled":
						_, err = settings.PatchToggles([]SkillTogglePatch{{Path: path, Enabled: false}})
					case "deleted":
						err = os.Remove(path)
					case "restricted":
						err = os.WriteFile(path, []byte("---\nname: complete-context\ndescription: Stable available skill\npermission_hint: [readonly]\n---\nNEW_RESTRICTED_BODY"), 0600)
					case "read_failure":
						err = os.Remove(path)
						if err == nil {
							err = os.Mkdir(path, 0700)
						}
					case "parse_failure":
						err = os.WriteFile(path, []byte("invalid skill document"), 0600)
					}
					if err != nil {
						t.Error(err)
					}
					writeSkillReadCall(w, flusher, 2)
				default:
					writeAskUserIntegrationTextResponse(w, flusher, "resp_done", "The skill is unavailable.")
				}
			}))
			t.Cleanup(server.Close)
			svc := openRealtimeTestService(t, root, server.URL)
			t.Cleanup(func() { _ = svc.Close() })
			svc.skillManager.userHome = root
			meta := testSendTurnMeta()
			thread, err := svc.CreateThread(t.Context(), meta, "Skill availability", "openai/gpt-5-mini", string(FlowerPermissionFullAccess), root)
			if err != nil {
				t.Fatal(err)
			}
			if err := svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(FlowerPermissionFullAccess)); err != nil {
				t.Fatal(err)
			}
			terminal, runErr := runTypedTurnForTest(t, t.Context(), svc, meta, "availability-"+change, RunStartRequest{ThreadID: thread.ThreadID, Model: "openai/gpt-5-mini", Input: RunInput{Text: "Read the skill twice."}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess}})
			mu.Lock()
			defer mu.Unlock()
			if len(requests) < 2 {
				t.Fatalf("missing initial skill result: requests=%d err=%v", len(requests), runErr)
			}
			first := skillReadOutputs(t, requests[1])
			if len(first) != 1 || first[0]["content"] != "HISTORICAL_ALLOWED_BODY" {
				t.Fatalf("initial tool result=%+v", first)
			}
			if change == "read_failure" || change == "parse_failure" {
				if runErr == nil || terminal.Failure == nil || terminal.Failure.Code != runErrorCodeModelContextUnavailable || len(requests) != 2 {
					t.Fatalf("invalid source reached provider: requests=%d failure=%+v err=%v", len(requests), terminal.Failure, runErr)
				}
			} else {
				if runErr != nil || len(requests) != 3 {
					t.Fatalf("requests=%d err=%v", len(requests), runErr)
				}
				var results []string
				for _, raw := range requests[2]["input"].([]any) {
					item, _ := raw.(map[string]any)
					if item["type"] == "function_call_output" {
						results = append(results, anyToString(item["output"]))
					}
				}
				if len(results) != 2 || !strings.Contains(results[1], "unknown skill: complete-context") {
					t.Fatalf("unavailable skill did not return explicit failure: %+v", results)
				}
				raw, _ := json.Marshal(results[1])
				if strings.Contains(string(raw), "HISTORICAL_ALLOWED_BODY") || strings.Contains(string(raw), "NEW_RESTRICTED_BODY") {
					t.Fatalf("unavailable skill returned instructions: %s", raw)
				}
				updates := skillCatalogUpdates(t, requests[2])
				if len(updates) != 2 || strings.Contains(updates[1], "Stable available skill") {
					t.Fatalf("current catalog retained unavailable skill: %+v", updates)
				}
			}
			view, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
			if err != nil {
				t.Fatal(err)
			}
			raw, _ := json.Marshal(view.Items)
			if !strings.Contains(string(raw), "HISTORICAL_ALLOWED_BODY") || strings.Contains(string(raw), "NEW_RESTRICTED_BODY") || strings.Count(string(raw), `"status":"error"`) == 0 {
				t.Fatalf("canonical tool history did not retain success and failure: %s", raw)
			}
		})
	}
}
