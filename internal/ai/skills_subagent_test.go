package ai

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
)

func TestSkillManager_DiscoverAndActivate(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	skillName := "unit-skill"
	skillDir := filepath.Join(workspace, ".redeven", "skills", skillName)
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("mkdir skill dir: %v", err)
	}
	content := `---
name: unit-skill
description: skill for tests
priority: 3
policy:
  allow_implicit_invocation: false
---

# Unit Skill

Follow this skill.`
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte(content), 0o600); err != nil {
		t.Fatalf("write skill file: %v", err)
	}

	mgr := newSkillManager(workspace, workspace)
	mgr.userHome = workspace
	mgr.Discover()
	list := mgr.List("")
	if len(list) == 0 {
		t.Fatalf("expected discovered skills")
	}
	found := false
	for _, item := range list {
		if item.Name == skillName {
			found = true
			if item.AllowImplicitInvocation {
				t.Fatalf("expected allow_implicit_invocation=false")
			}
		}
	}
	if !found {
		t.Fatalf("skill %q not discovered", skillName)
	}

	activation, alreadyActive, err := mgr.Activate(skillName, "", false)
	if err != nil {
		t.Fatalf("Activate: %v", err)
	}
	if alreadyActive {
		t.Fatalf("first activation should not be already active")
	}
	if !strings.Contains(activation.Content, "Follow this skill") {
		t.Fatalf("unexpected activation content: %q", activation.Content)
	}

	_, alreadyActive, err = mgr.Activate(skillName, "", false)
	if err != nil {
		t.Fatalf("Activate second: %v", err)
	}
	if !alreadyActive {
		t.Fatalf("second activation should be already active")
	}
}

func TestSkillManager_ModeAwareFallbackAndToggles(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	primaryDir := filepath.Join(workspace, ".redeven", "skills", "mode-skill")
	fallbackDir := filepath.Join(workspace, ".agents", "skills", "mode-skill")
	if err := os.MkdirAll(primaryDir, 0o755); err != nil {
		t.Fatalf("mkdir primary dir: %v", err)
	}
	if err := os.MkdirAll(fallbackDir, 0o755); err != nil {
		t.Fatalf("mkdir fallback dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(primaryDir, "SKILL.md"), []byte(`---
name: mode-skill
description: act variant
mode_hint:
  - act
---

# act skill`), 0o600); err != nil {
		t.Fatalf("write primary skill: %v", err)
	}
	if err := os.WriteFile(filepath.Join(fallbackDir, "SKILL.md"), []byte(`---
name: mode-skill
description: plan variant
mode_hint:
  - plan
---

# plan skill`), 0o600); err != nil {
		t.Fatalf("write fallback skill: %v", err)
	}

	mgr := newSkillManager(workspace, workspace)
	mgr.userHome = workspace
	catalog := mgr.Reload()
	if len(catalog.Skills) < 2 {
		t.Fatalf("expected at least two catalog skills")
	}

	actList := mgr.List("act")
	if len(actList) != 1 || strings.TrimSpace(actList[0].Description) != "act variant" {
		t.Fatalf("unexpected act skills: %#v", actList)
	}
	planList := mgr.List("plan")
	if len(planList) != 1 || strings.TrimSpace(planList[0].Description) != "plan variant" {
		t.Fatalf("unexpected plan skills: %#v", planList)
	}

	_, err := mgr.PatchToggles([]SkillTogglePatch{{Path: filepath.Join(primaryDir, "SKILL.md"), Enabled: false}})
	if err != nil {
		t.Fatalf("PatchToggles disable primary: %v", err)
	}
	actList = mgr.List("act")
	if len(actList) != 0 {
		t.Fatalf("act list should be empty after disabling primary, got %#v", actList)
	}
	planList = mgr.List("plan")
	if len(planList) != 1 || strings.TrimSpace(planList[0].Description) != "plan variant" {
		t.Fatalf("unexpected plan skills after toggle: %#v", planList)
	}
}

func TestSkillManager_CreateDeleteAndStatePersistence(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	stateDir := t.TempDir()
	mgr := newSkillManager(workspace, stateDir)
	mgr.userHome = workspace
	if _, err := mgr.Create("user", "created-skill", "skill created in test", ""); err != nil {
		t.Fatalf("Create: %v", err)
	}
	skillPath := filepath.Join(workspace, ".redeven", "skills", "created-skill", "SKILL.md")
	if _, err := os.Stat(skillPath); err != nil {
		t.Fatalf("created skill missing: %v", err)
	}

	if _, err := mgr.PatchToggles([]SkillTogglePatch{{Path: skillPath, Enabled: false}}); err != nil {
		t.Fatalf("PatchToggles disable created skill: %v", err)
	}

	mgr2 := newSkillManager(workspace, stateDir)
	mgr2.userHome = workspace
	catalog := mgr2.Reload()
	foundDisabled := false
	for _, item := range catalog.Skills {
		if strings.TrimSpace(item.Path) == skillPath && !item.Enabled {
			foundDisabled = true
		}
	}
	if !foundDisabled {
		t.Fatalf("expected persisted disabled state for %s", skillPath)
	}

	if _, err := mgr2.Delete("user", "created-skill"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := os.Stat(filepath.Join(workspace, ".redeven", "skills", "created-skill")); !os.IsNotExist(err) {
		t.Fatalf("created skill directory should be deleted")
	}
}

func TestBuildLayeredSystemPrompt_ContainsSkills(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	skillName := "prompt-skill"
	skillDir := filepath.Join(workspace, ".redeven", "skills", skillName)
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("mkdir skill dir: %v", err)
	}
	content := `---
name: prompt-skill
description: used in prompt test
---

# Prompt Skill

This content should appear in overlay.`
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte(content), 0o600); err != nil {
		t.Fatalf("write skill file: %v", err)
	}

	r := newRun(runOptions{Log: slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})), FSRoot: workspace})
	r.skillManager = newSkillManager(workspace, workspace)
	r.skillManager.userHome = workspace
	r.skillManager.Discover()
	if _, _, err := r.activateSkill(skillName); err != nil {
		t.Fatalf("activate skill: %v", err)
	}
	prompt := r.buildLayeredSystemPrompt("objective", "build", TaskComplexityStandard, 0, 8, true, nil, newRuntimeState("objective"), "")
	if !strings.Contains(prompt, "Available skills: prompt-skill") {
		t.Fatalf("prompt missing skills catalog: %q", prompt)
	}
	if !strings.Contains(prompt, "This content should appear in overlay") {
		t.Fatalf("prompt missing active skill overlay: %q", prompt)
	}
}

type subagentOpenAISimpleMock struct{}

func (m *subagentOpenAISimpleMock) handle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if strings.TrimSpace(r.Header.Get("Authorization")) != "Bearer sk-test" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if !strings.HasSuffix(strings.TrimSpace(r.URL.Path), "/responses") {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	f, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	writeOpenAISSEJSON(w, f, map[string]any{"type": "response.output_text.delta", "delta": "Subagent completed."})
	writeOpenAISSEJSON(w, f, map[string]any{
		"type": "response.completed",
		"response": map[string]any{
			"id":     "resp_subagent_1",
			"model":  "gpt-5-mini",
			"status": "completed",
			"output": []any{
				map[string]any{
					"type":      "function_call",
					"id":        "fc_subagent_complete_1",
					"call_id":   "call_subagent_complete_1",
					"name":      "task_complete",
					"arguments": `{"result":"{\"summary\":\"Subagent completed.\"}","evidence_refs":["https://example.com/source"]}`,
				},
			},
			"usage": map[string]any{
				"input_tokens":  1,
				"output_tokens": 1,
				"output_tokens_details": map[string]any{
					"reasoning_tokens": 0,
				},
			},
		},
	})
	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	f.Flush()
}

func TestSubagentManager_DelegateAndWait(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	mock := &subagentOpenAISimpleMock{}
	srv := httptest.NewServer(http.HandlerFunc(mock.handle))
	t.Cleanup(srv.Close)

	cfg := &config.AIConfig{
		Providers: []config.AIProvider{{
			ID:      "openai",
			Type:    "openai",
			BaseURL: strings.TrimSuffix(srv.URL, "/") + "/v1",
			Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
		}},
	}
	meta := &session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_test",
		UserPublicID:      "u_test",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	r := newRun(runOptions{
		Log:         slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		FSRoot:      workspace,
		Shell:       "bash",
		AIConfig:    cfg,
		SessionMeta: meta,
		ResolveProviderKey: func(providerID string) (string, bool, error) {
			if strings.TrimSpace(providerID) == "openai" {
				return "sk-test", true, nil
			}
			return "", false, nil
		},
		RunID:        "run_parent",
		ChannelID:    meta.ChannelID,
		EndpointID:   meta.EndpointID,
		ThreadID:     "th_parent",
		UserPublicID: meta.UserPublicID,
		MessageID:    "m_parent",
	})
	r.currentModelID = "openai/gpt-5-mini"

	created, err := r.manageSubagents(context.Background(), map[string]any{
		"action":             "create",
		"title":              "Workspace status summary",
		"objective":          "Summarize current workspace status.",
		"agent_type":         "explore",
		"trigger_reason":     "Need an isolated exploration result before deciding the next parent step.",
		"deliverables":       []any{"summary", "key risks"},
		"definition_of_done": []any{"Include a concise summary and at least one evidence reference."},
		"output_schema": map[string]any{
			"type":     "object",
			"required": []any{"summary"},
			"properties": map[string]any{
				"summary": map[string]any{"type": "string", "minLength": 10},
			},
		},
		"mode": "plan",
		"budget": map[string]any{
			"timeout_sec": 60,
		},
	})
	if err != nil {
		t.Fatalf("manageSubagents(create): %v", err)
	}
	id := strings.TrimSpace(anyToString(created["subagent_id"]))
	if id == "" {
		t.Fatalf("missing subagent_id in result: %#v", created)
	}
	if strings.TrimSpace(anyToString(created["spec_id"])) == "" {
		t.Fatalf("missing spec_id in create result: %#v", created)
	}
	if strings.TrimSpace(anyToString(created["title"])) == "" {
		t.Fatalf("missing title in create result: %#v", created)
	}
	if !strings.Contains(strings.TrimSpace(anyToString(created["delegation_prompt_markdown"])), "# Mission") {
		t.Fatalf("missing canonical delegation prompt in create result: %#v", created)
	}
	if !strings.Contains(strings.TrimSpace(anyToString(created["delegation_prompt_markdown"])), "Timeout: 900 seconds") {
		t.Fatalf("expected fixed 900-second timeout in delegation prompt: %#v", created)
	}

	waited, err := r.manageSubagents(context.Background(), map[string]any{
		"action":     "wait",
		"ids":        []string{id},
		"timeout_ms": 20_000,
	})
	if err != nil {
		t.Fatalf("manageSubagents(wait): %v", err)
	}
	if waited["timed_out"] == true {
		t.Fatalf("wait timed out: %#v", waited)
	}
	statuses, _ := waited["snapshots"].(map[string]any)
	entryRaw, ok := statuses[id]
	if !ok {
		t.Fatalf("missing subagent status for id=%s: %#v", id, statuses)
	}
	entry, ok := entryRaw.(map[string]any)
	if !ok {
		t.Fatalf("invalid status payload type: %T", entryRaw)
	}
	status := strings.TrimSpace(anyToString(entry["status"]))
	if status != subagentStatusCompleted {
		t.Fatalf("unexpected subagent status=%q payload=%#v", status, entry)
	}
	if !strings.Contains(strings.TrimSpace(anyToString(entry["result"])), "Subagent completed") {
		t.Fatalf("unexpected subagent result: %#v", entry)
	}
	stats, _ := entry["stats"].(map[string]any)
	if parseIntRaw(stats["steps"], 0) < 1 {
		t.Fatalf("unexpected subagent steps stats: %#v", stats)
	}
	if parseIntRaw(stats["tokens"], 0) <= 0 {
		t.Fatalf("unexpected subagent token stats: %#v", stats)
	}
	if strings.TrimSpace(anyToString(entry["spec_id"])) == "" {
		t.Fatalf("missing spec_id in wait snapshot: %#v", entry)
	}
	if strings.TrimSpace(anyToString(entry["title"])) == "" {
		t.Fatalf("missing title in wait snapshot: %#v", entry)
	}

	managedList, err := r.manageSubagents(context.Background(), map[string]any{
		"action": "list",
	})
	if err != nil {
		t.Fatalf("manageSubagents(list): %v", err)
	}
	if strings.TrimSpace(anyToString(managedList["status"])) != "ok" {
		t.Fatalf("unexpected list payload: %#v", managedList)
	}

	inspected, err := r.manageSubagents(context.Background(), map[string]any{
		"action": "inspect",
		"target": id,
	})
	if err != nil {
		t.Fatalf("manageSubagents(inspect): %v", err)
	}
	if strings.TrimSpace(anyToString(inspected["status"])) != "ok" {
		t.Fatalf("unexpected inspect payload: %#v", inspected)
	}
	item, _ := inspected["item"].(map[string]any)
	if strings.TrimSpace(anyToString(item["subagent_id"])) != id {
		t.Fatalf("unexpected inspect item payload: %#v", inspected)
	}

	terminated, err := r.manageSubagents(context.Background(), map[string]any{
		"action": "terminate",
		"target": id,
	})
	if err != nil {
		t.Fatalf("manageSubagents(terminate): %v", err)
	}
	finalStatus := strings.TrimSpace(anyToString(terminated["status"]))
	if finalStatus != "already_terminal" {
		t.Fatalf("unexpected terminate status=%q payload=%#v", finalStatus, terminated)
	}
}

type subagentWebSearchResolverMock struct {
	mu   sync.Mutex
	step int
}

func (m *subagentWebSearchResolverMock) handle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if strings.TrimSpace(r.Header.Get("Authorization")) != "Bearer sk-test" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if !strings.HasSuffix(strings.TrimSpace(r.URL.Path), "/responses") {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	m.mu.Lock()
	m.step++
	step := m.step
	m.mu.Unlock()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	f, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	switch step {
	case 1:
		writeOpenAISSEJSON(w, f, map[string]any{"type": "response.output_text.delta", "delta": "Searching..."})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id":     "resp_subagent_search_1",
				"model":  "gpt-5-mini",
				"status": "completed",
				"output": []any{
					map[string]any{
						"type":      "function_call",
						"id":        "fc_subagent_search_1",
						"call_id":   "call_subagent_search_1",
						"name":      "web_search",
						"arguments": `{"query":"hello","provider":"dummy","count":1}`,
					},
				},
				"usage": map[string]any{
					"input_tokens":  1,
					"output_tokens": 1,
				},
			},
		})
	default:
		writeOpenAISSEJSON(w, f, map[string]any{"type": "response.output_text.delta", "delta": "Done."})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id":     "resp_subagent_search_2",
				"model":  "gpt-5-mini",
				"status": "completed",
				"output": []any{
					map[string]any{
						"type":      "function_call",
						"id":        "fc_subagent_complete_2",
						"call_id":   "call_subagent_complete_2",
						"name":      "task_complete",
						"arguments": `{"result":"{\"summary\":\"Subagent completed.\"}","evidence_refs":["https://example.com/source"]}`,
					},
				},
				"usage": map[string]any{
					"input_tokens":  1,
					"output_tokens": 1,
				},
			},
		})
	}

	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	f.Flush()
}

func TestSubagentManager_InheritsWebSearchResolver(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	mock := &subagentWebSearchResolverMock{}
	srv := httptest.NewServer(http.HandlerFunc(mock.handle))
	t.Cleanup(srv.Close)

	cfg := &config.AIConfig{
		Providers: []config.AIProvider{{
			ID:      "openai",
			Type:    "openai",
			BaseURL: strings.TrimSuffix(srv.URL, "/") + "/v1",
			Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
		}},
	}

	meta := &session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_test_subagent_websearch",
		UserPublicID:      "u_test",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}

	var resolverCalled atomic.Bool
	r := newRun(runOptions{
		Log:         slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		FSRoot:      workspace,
		Shell:       "bash",
		AIConfig:    cfg,
		SessionMeta: meta,
		ResolveProviderKey: func(providerID string) (string, bool, error) {
			if strings.TrimSpace(providerID) == "openai" {
				return "sk-test", true, nil
			}
			return "", false, nil
		},
		ResolveWebSearchKey: func(providerID string) (string, bool, error) {
			if strings.TrimSpace(strings.ToLower(providerID)) != "dummy" {
				return "", false, nil
			}
			resolverCalled.Store(true)
			return "dummy-key", true, nil
		},
		RunID:        "run_parent_websearch",
		ChannelID:    meta.ChannelID,
		EndpointID:   meta.EndpointID,
		ThreadID:     "th_parent_websearch",
		UserPublicID: meta.UserPublicID,
		MessageID:    "m_parent_websearch",
	})
	r.currentModelID = "openai/gpt-5-mini"

	created, err := r.manageSubagents(context.Background(), map[string]any{
		"action":             "create",
		"title":              "Web source summary",
		"objective":          "Search the web and summarize the results.",
		"agent_type":         "explore",
		"trigger_reason":     "Need independent source lookup before drafting the final response.",
		"deliverables":       []any{"summary", "sources"},
		"definition_of_done": []any{"Summary must cite source URLs through evidence_refs."},
		"output_schema": map[string]any{
			"type":     "object",
			"required": []any{"summary"},
			"properties": map[string]any{
				"summary": map[string]any{"type": "string", "minLength": 10},
			},
		},
		"mode": "plan",
		"budget": map[string]any{
			"timeout_sec": 60,
		},
	})
	if err != nil {
		t.Fatalf("manageSubagents(create): %v", err)
	}
	id := strings.TrimSpace(anyToString(created["subagent_id"]))
	if id == "" {
		t.Fatalf("missing subagent_id in result: %#v", created)
	}
	if !strings.Contains(strings.TrimSpace(anyToString(created["delegation_prompt_markdown"])), "Timeout: 900 seconds") {
		t.Fatalf("expected fixed 900-second timeout in delegation prompt: %#v", created)
	}

	waited, err := r.manageSubagents(context.Background(), map[string]any{
		"action":     "wait",
		"ids":        []string{id},
		"timeout_ms": 20_000,
	})
	if err != nil {
		t.Fatalf("manageSubagents(wait): %v", err)
	}
	if waited["timed_out"] == true {
		t.Fatalf("wait timed out: %#v", waited)
	}
	statuses, _ := waited["snapshots"].(map[string]any)
	entryRaw, ok := statuses[id]
	if !ok {
		t.Fatalf("missing subagent status for id=%s: %#v", id, statuses)
	}
	entry, ok := entryRaw.(map[string]any)
	if !ok {
		t.Fatalf("invalid status payload type: %T", entryRaw)
	}
	stats, _ := entry["stats"].(map[string]any)
	if parseIntRaw(stats["tool_calls"], 0) < 1 {
		t.Fatalf("unexpected subagent tool call stats: %#v", stats)
	}
	if parseIntRaw(stats["tokens"], 0) <= 0 {
		t.Fatalf("unexpected subagent token stats: %#v", stats)
	}

	if !resolverCalled.Load() {
		t.Fatalf("expected ResolveWebSearchKey to be called in subagent run")
	}
}

func TestSubagentManager_ManageActions(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{
		Log:    slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		FSRoot: t.TempDir(),
		RunID:  "run_manage_actions",
	})
	mgr := newSubagentManager(r)
	r.subagentManager = mgr

	runningTask := &subagentTask{
		id:            "tool_running",
		taskID:        "task_running",
		agentType:     subagentAgentTypeWorker,
		triggerReason: "Validate management actions",
		ctx:           context.Background(),
		doneCh:        make(chan struct{}),
		input:         make(chan string, 2),
		status:        subagentStatusRunning,
		result:        defaultSubagentResult(),
	}
	runningTask.startedAt = time.Now().Add(-5 * time.Second).UnixMilli()
	runningTask.updatedAt = time.Now().Add(-3 * time.Second).UnixMilli()
	runningTask.recalculateDerivedStatsLocked()
	runningTask.cancel = func() {
		runningTask.setStatus(subagentStatusCanceled)
		select {
		case <-runningTask.doneCh:
		default:
			close(runningTask.doneCh)
		}
	}
	mgr.addTask(runningTask)

	completedTask := &subagentTask{
		id:            "tool_completed",
		taskID:        "task_completed",
		agentType:     subagentAgentTypeExplore,
		triggerReason: "Already done",
		ctx:           context.Background(),
		cancel:        func() {},
		doneCh:        make(chan struct{}),
		input:         make(chan string, 1),
		status:        subagentStatusCompleted,
		result:        defaultSubagentResult(),
	}
	completedTask.result.Summary = "done"
	completedTask.startedAt = time.Now().Add(-10 * time.Second).UnixMilli()
	completedTask.endedAt = time.Now().Add(-8 * time.Second).UnixMilli()
	completedTask.updatedAt = time.Now().Add(-8 * time.Second).UnixMilli()
	completedTask.recalculateDerivedStatsLocked()
	close(completedTask.doneCh)
	mgr.addTask(completedTask)

	listOut, err := r.manageSubagents(context.Background(), map[string]any{
		"action":       "list",
		"running_only": false,
		"limit":        10,
	})
	if err != nil {
		t.Fatalf("manageSubagents(list): %v", err)
	}
	if strings.TrimSpace(anyToString(listOut["status"])) != "ok" {
		t.Fatalf("unexpected list payload: %#v", listOut)
	}
	if parseIntRaw(listOut["total"], 0) != 2 {
		t.Fatalf("unexpected list total payload: %#v", listOut)
	}

	inspectOut, err := r.manageSubagents(context.Background(), map[string]any{
		"action": "inspect",
		"target": "task_running",
	})
	if err != nil {
		t.Fatalf("manageSubagents(inspect): %v", err)
	}
	if strings.TrimSpace(anyToString(inspectOut["status"])) != "ok" {
		t.Fatalf("unexpected inspect payload: %#v", inspectOut)
	}
	item, _ := inspectOut["item"].(map[string]any)
	if strings.TrimSpace(anyToString(item["subagent_id"])) != runningTask.id {
		t.Fatalf("inspect item mismatch: %#v", inspectOut)
	}

	steerOut, err := r.manageSubagents(context.Background(), map[string]any{
		"action":    "steer",
		"target":    runningTask.id,
		"message":   "continue with deeper validation",
		"interrupt": false,
	})
	if err != nil {
		t.Fatalf("manageSubagents(steer): %v", err)
	}
	if strings.TrimSpace(anyToString(steerOut["status"])) != "ok" {
		t.Fatalf("unexpected steer payload: %#v", steerOut)
	}
	select {
	case got := <-runningTask.input:
		if strings.TrimSpace(got) != "continue with deeper validation" {
			t.Fatalf("unexpected steer message: %q", got)
		}
	default:
		t.Fatalf("expected steer message to be delivered")
	}

	rateLimitedOut, err := r.manageSubagents(context.Background(), map[string]any{
		"action":  "steer",
		"target":  runningTask.id,
		"message": "second steer too soon",
	})
	if err != nil {
		t.Fatalf("manageSubagents(steer rate limit): %v", err)
	}
	if strings.TrimSpace(anyToString(rateLimitedOut["status"])) != "rate_limited" {
		t.Fatalf("unexpected rate-limited payload: %#v", rateLimitedOut)
	}

	terminateOut, err := r.manageSubagents(context.Background(), map[string]any{
		"action": "terminate",
		"target": runningTask.taskID,
	})
	if err != nil {
		t.Fatalf("manageSubagents(terminate): %v", err)
	}
	if strings.TrimSpace(anyToString(terminateOut["status"])) != "ok" {
		t.Fatalf("unexpected terminate payload: %#v", terminateOut)
	}

	terminateAgainOut, err := r.manageSubagents(context.Background(), map[string]any{
		"action": "terminate",
		"target": runningTask.id,
	})
	if err != nil {
		t.Fatalf("manageSubagents(terminate again): %v", err)
	}
	if strings.TrimSpace(anyToString(terminateAgainOut["status"])) != "already_terminal" {
		t.Fatalf("unexpected terminate-again payload: %#v", terminateAgainOut)
	}

	terminateAllOut, err := r.manageSubagents(context.Background(), map[string]any{
		"action": "terminate_all",
		"scope":  "current_run",
	})
	if err != nil {
		t.Fatalf("manageSubagents(terminate_all): %v", err)
	}
	if strings.TrimSpace(anyToString(terminateAllOut["status"])) != "ok" {
		t.Fatalf("unexpected terminate_all payload: %#v", terminateAllOut)
	}
	if parseIntRaw(terminateAllOut["killed_count"], 0) != 0 {
		t.Fatalf("unexpected terminate_all killed_count payload: %#v", terminateAllOut)
	}
}

func TestSubagentManager_CreateRejectsLegacyTaskID(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{Log: slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})), FSRoot: t.TempDir()})
	mgr := newSubagentManager(r)
	r.subagentManager = mgr

	_, err := mgr.create(context.Background(), map[string]any{
		"task_id":            "task_existing",
		"objective":          "continue with new detail",
		"agent_type":         "explore",
		"trigger_reason":     "legacy resume input should be rejected",
		"deliverables":       []any{"summary"},
		"definition_of_done": []any{"Provide a summary."},
		"output_schema": map[string]any{
			"type":     "object",
			"required": []any{"summary"},
			"properties": map[string]any{
				"summary": map[string]any{"type": "string"},
			},
		},
	})
	if err == nil {
		t.Fatalf("expected create to reject task_id")
	}
	if !strings.Contains(err.Error(), "task_id is not supported") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSubagentManager_CreateRequiresPromptContract(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{Log: slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})), FSRoot: t.TempDir()})
	mgr := newSubagentManager(r)
	r.subagentManager = mgr

	_, err := mgr.create(context.Background(), map[string]any{
		"objective":      "summarize workspace",
		"agent_type":     "explore",
		"trigger_reason": "need delegated summary",
	})
	if err == nil {
		t.Fatalf("expected missing contract fields to fail")
	}
	if !strings.Contains(err.Error(), "missing deliverables") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestUseSkillTool_ExecTool(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	skillName := "handler-skill"
	skillDir := filepath.Join(workspace, ".redeven", "skills", skillName)
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("mkdir skill dir: %v", err)
	}
	content := fmt.Sprintf(`---
name: %s
description: handler test skill
---

# Handler Skill

Use this handler skill.`, skillName)
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte(content), 0o600); err != nil {
		t.Fatalf("write skill file: %v", err)
	}

	r := newRun(runOptions{Log: slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})), FSRoot: workspace})
	r.skillManager = newSkillManager(workspace, workspace)
	r.skillManager.userHome = workspace
	r.skillManager.Discover()
	meta := &session.Meta{CanRead: true, CanWrite: true, CanExecute: true}
	out, err := r.execTool(context.Background(), meta, "tool_1", "use_skill", map[string]any{"name": skillName})
	if err != nil {
		t.Fatalf("execTool error: %v", err)
	}
	data, ok := out.(map[string]any)
	if !ok {
		t.Fatalf("unexpected data type: %T", out)
	}
	if strings.TrimSpace(anyToString(data["name"])) != skillName {
		t.Fatalf("unexpected skill data: %#v", data)
	}
	if !strings.Contains(strings.TrimSpace(anyToString(data["content"])), "Handler Skill") {
		t.Fatalf("unexpected skill content: %#v", data)
	}
}
