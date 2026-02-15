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
					"arguments": `{"result":"Subagent completed."}`,
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
			Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini", IsDefault: true}},
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

	created, err := r.delegateTask(context.Background(), map[string]any{
		"objective": "Summarize current workspace status.",
		"mode":      "plan",
		"budget": map[string]any{
			"timeout_sec": 60,
		},
	})
	if err != nil {
		t.Fatalf("delegateTask: %v", err)
	}
	id := strings.TrimSpace(anyToString(created["subagent_id"]))
	if id == "" {
		t.Fatalf("missing subagent_id in result: %#v", created)
	}

	waitCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	statuses, timedOut := r.waitSubagents(waitCtx, []string{id})
	if timedOut {
		t.Fatalf("wait timed out: %#v", statuses)
	}
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

	closed, err := r.closeSubagent(id)
	if err != nil {
		t.Fatalf("closeSubagent: %v", err)
	}
	if strings.TrimSpace(anyToString(closed["id"])) != id {
		t.Fatalf("unexpected close payload: %#v", closed)
	}
	finalStatus := strings.TrimSpace(anyToString(closed["status"]))
	if finalStatus != subagentStatusCompleted {
		t.Fatalf("unexpected close status=%q payload=%#v", finalStatus, closed)
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
						"arguments": `{"result":"Subagent completed."}`,
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
			Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini", IsDefault: true}},
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

	created, err := r.delegateTask(context.Background(), map[string]any{
		"objective": "Search the web and summarize the results.",
		"mode":      "plan",
		"budget": map[string]any{
			"timeout_sec": 60,
		},
	})
	if err != nil {
		t.Fatalf("delegateTask: %v", err)
	}
	id := strings.TrimSpace(anyToString(created["subagent_id"]))
	if id == "" {
		t.Fatalf("missing subagent_id in result: %#v", created)
	}

	waitCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	statuses, timedOut := r.waitSubagents(waitCtx, []string{id})
	if timedOut {
		t.Fatalf("wait timed out: %#v", statuses)
	}

	if !resolverCalled.Load() {
		t.Fatalf("expected ResolveWebSearchKey to be called in subagent run")
	}
}

func TestSubagentManager_TaskIDResumeContract(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{Log: slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})), FSRoot: t.TempDir()})
	mgr := newSubagentManager(r)
	r.subagentManager = mgr

	task := &subagentTask{
		id:     "tool_existing",
		taskID: "task_existing",
		input:  make(chan string, 1),
		doneCh: make(chan struct{}),
		ctx:    context.Background(),
		cancel: func() {},
		status: subagentStatusRunning,
	}
	mgr.addTask(task)

	resumed, err := mgr.delegate(context.Background(), map[string]any{
		"task_id":   "task_existing",
		"objective": "continue with new detail",
	})
	if err != nil {
		t.Fatalf("resume delegate failed: %v", err)
	}
	if !resumed["resumed"].(bool) {
		t.Fatalf("expected resumed=true payload=%#v", resumed)
	}
	if strings.TrimSpace(anyToString(resumed["subagent_id"])) != task.id {
		t.Fatalf("unexpected resumed subagent id: %#v", resumed)
	}
	select {
	case got := <-task.input:
		if strings.TrimSpace(got) != "continue with new detail" {
			t.Fatalf("unexpected resumed objective=%q", got)
		}
	default:
		t.Fatalf("expected resumed objective to be delivered")
	}

	notFound, err := mgr.delegate(context.Background(), map[string]any{
		"task_id":   "task_missing",
		"objective": "hello",
	})
	if err != nil {
		t.Fatalf("not_found delegate failed: %v", err)
	}
	if strings.TrimSpace(anyToString(notFound["status"])) != "not_found" {
		t.Fatalf("expected not_found status payload=%#v", notFound)
	}
	if notFound["resumed"].(bool) {
		t.Fatalf("expected resumed=false payload=%#v", notFound)
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
