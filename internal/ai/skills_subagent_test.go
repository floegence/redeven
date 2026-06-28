package ai

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
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

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
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

func TestSkillManager_EmbedsRedevenEnvironmentSystemSkill(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	stateDir := t.TempDir()
	mgr := newSkillManager(workspace, stateDir)
	mgr.userHome = workspace
	catalog := mgr.Reload()
	var entry *SkillCatalogEntry
	for i := range catalog.Skills {
		if catalog.Skills[i].Name == "redeven-environment" {
			entry = &catalog.Skills[i]
			break
		}
	}
	if entry == nil {
		t.Fatalf("redeven-environment system skill missing from catalog: %#v", catalog.Skills)
	}
	if entry.Scope != string(SkillSourceTypeSystem) || !entry.Enabled || !entry.Effective {
		t.Fatalf("unexpected system skill entry: %#v", entry)
	}

	activation, alreadyActive, err := mgr.Activate("redeven-environment", "approval_required", false)
	if err != nil {
		t.Fatalf("Activate(redeven-environment) error = %v", err)
	}
	if alreadyActive {
		t.Fatalf("first activation should not be already active")
	}
	if !strings.Contains(activation.Content, "redeven targets exec") || !strings.Contains(activation.Content, "terminal.exec") {
		t.Fatalf("unexpected system skill body: %q", activation.Content)
	}

	sources, err := mgr.ListSources()
	if err != nil {
		t.Fatalf("ListSources() error = %v", err)
	}
	foundSource := false
	for _, source := range sources.Items {
		if source.SkillPath == entry.Path {
			foundSource = true
			if source.SourceType != SkillSourceTypeSystem || source.SourceID != "system:redeven-environment" {
				t.Fatalf("unexpected system skill source: %#v", source)
			}
		}
	}
	if !foundSource {
		t.Fatalf("missing system skill source for %s: %#v", entry.Path, sources.Items)
	}
}

func TestSkillManager_PermissionAwareFallbackAndToggles(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	primaryDir := filepath.Join(workspace, ".redeven", "skills", "permission-skill")
	fallbackDir := filepath.Join(workspace, ".agents", "skills", "permission-skill")
	if err := os.MkdirAll(primaryDir, 0o755); err != nil {
		t.Fatalf("mkdir primary dir: %v", err)
	}
	if err := os.MkdirAll(fallbackDir, 0o755); err != nil {
		t.Fatalf("mkdir fallback dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(primaryDir, "SKILL.md"), []byte(`---
name: permission-skill
description: approval-required variant
permission_hint:
  - approval_required
---

# approval-required skill`), 0o600); err != nil {
		t.Fatalf("write primary skill: %v", err)
	}
	if err := os.WriteFile(filepath.Join(fallbackDir, "SKILL.md"), []byte(`---
name: permission-skill
description: readonly variant
permission_hint:
  - readonly
---

# readonly skill`), 0o600); err != nil {
		t.Fatalf("write fallback skill: %v", err)
	}

	mgr := newSkillManager(workspace, workspace)
	mgr.userHome = workspace
	catalog := mgr.Reload()
	if len(catalog.Skills) < 2 {
		t.Fatalf("expected at least two catalog skills")
	}

	approvalList := filterSkillMetaByName(mgr.List("approval_required"), "permission-skill")
	if len(approvalList) != 1 || strings.TrimSpace(approvalList[0].Description) != "approval-required variant" {
		t.Fatalf("unexpected approval_required skills: %#v", approvalList)
	}
	readonlyList := filterSkillMetaByName(mgr.List("readonly"), "permission-skill")
	if len(readonlyList) != 1 || strings.TrimSpace(readonlyList[0].Description) != "readonly variant" {
		t.Fatalf("unexpected readonly skills: %#v", readonlyList)
	}

	_, err := mgr.PatchToggles([]SkillTogglePatch{{Path: filepath.Join(primaryDir, "SKILL.md"), Enabled: false}})
	if err != nil {
		t.Fatalf("PatchToggles disable primary: %v", err)
	}
	approvalList = filterSkillMetaByName(mgr.List("approval_required"), "permission-skill")
	if len(approvalList) != 0 {
		t.Fatalf("approval_required list should be empty after disabling primary, got %#v", approvalList)
	}
	readonlyList = filterSkillMetaByName(mgr.List("readonly"), "permission-skill")
	if len(readonlyList) != 1 || strings.TrimSpace(readonlyList[0].Description) != "readonly variant" {
		t.Fatalf("unexpected readonly skills after toggle: %#v", readonlyList)
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

	r := newRun(runOptions{Log: slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})), AgentHomeDir: workspace})
	r.skillManager = newSkillManager(workspace, workspace)
	r.skillManager.userHome = workspace
	r.skillManager.Discover()
	if _, _, err := r.activateSkill(skillName); err != nil {
		t.Fatalf("activate skill: %v", err)
	}
	tools := []ToolDef{{Name: "use_skill", Visibility: ToolVisibilityStandard, Capabilities: []ToolCapabilityClass{ToolCapabilityOpenWorld}}}
	contract := resolveRunCapabilityContract(r, tools, testSignalDefs("task_complete"), false)
	prompt := r.buildLayeredSystemPrompt("objective", permissionTypeString(FlowerPermissionApprovalRequired), TaskComplexityStandard, 0, true, tools, newRuntimeState("objective"), "", contract)
	if !strings.Contains(prompt, "Available skills:") || !strings.Contains(prompt, "prompt-skill") {
		t.Fatalf("prompt missing skills catalog: %q", prompt)
	}
	if !strings.Contains(prompt, "This content should appear in overlay") {
		t.Fatalf("prompt missing active skill overlay: %q", prompt)
	}
}

func filterSkillMetaByName(items []SkillMeta, name string) []SkillMeta {
	out := make([]SkillMeta, 0, len(items))
	for _, item := range items {
		if item.Name == name {
			out = append(out, item)
		}
	}
	return out
}

type subagentOpenAISimpleMock struct {
	mu       sync.Mutex
	requests []map[string]any
}

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
	body, _ := io.ReadAll(r.Body)
	_ = r.Body.Close()
	if len(body) > 0 {
		var req map[string]any
		if err := json.Unmarshal(body, &req); err == nil {
			m.mu.Lock()
			m.requests = append(m.requests, req)
			m.mu.Unlock()
		}
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
					"type": "message",
					"id":   "msg_subagent_complete_1",
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

func (m *subagentOpenAISimpleMock) firstRequest() map[string]any {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.requests) == 0 {
		return nil
	}
	return cloneAnyMap(m.requests[0])
}

func prepareSubagentPermissionSnapshot(t *testing.T, r *run) {
	t.Helper()
	if r == nil {
		t.Fatal("nil run")
	}
	if r.threadsDB == nil {
		store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
		if err != nil {
			t.Fatalf("threadstore.Open: %v", err)
		}
		t.Cleanup(func() { _ = store.Close() })
		r.threadsDB = store
	}
	if resolved, err := r.resolveSubagentModelGateway(); err == nil {
		webSearchCapability := resolveProviderWebSearchCapability(resolved.provider, strings.TrimSpace(resolved.modelName))
		if enableFlowerWebSearchTool(resolved.provider, webSearchCapability) {
			webSearchCapability.RegisterTool = true
		}
		r.webSearchMode = webSearchCapability.Mode
		r.webSearchToolEnabled = webSearchCapability.RegisterTool
	}
	registry := NewInMemoryToolRegistry()
	if err := registerBuiltInTools(registry, r); err != nil {
		t.Fatalf("registerBuiltInTools: %v", err)
	}
	permissionFilter := newPermissionToolFilter(!r.noUserInteraction)
	permissionFilter = r.withToolAllowlistFilter(permissionFilter)
	activeTools := permissionFilter.FilterTools(r.permissionType, registry.Snapshot())
	activeSignals := permissionFilter.FilterTools(r.permissionType, builtInControlSignalDefinitions())
	snapshot := r.freezePermissionSnapshot(buildPermissionSnapshot(r.permissionType, activeTools, activeSignals))
	if err := validatePermissionSnapshotConsistency(snapshot); err != nil {
		t.Fatalf("invalid parent permission snapshot: %v", err)
	}
}

func TestFloretSubagents_DelegateAndWait(t *testing.T) {
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
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		StateDir:     workspace,
		AgentHomeDir: workspace,
		Shell:        "bash",
		AIConfig:     cfg,
		SessionMeta:  meta,
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
	r.currentReasoning = config.AIReasoningSelection{Level: config.AIReasoningLevelMedium}
	prepareSubagentPermissionSnapshot(t, r)

	created, err := r.manageSubagents(context.Background(), map[string]any{
		"action":     "spawn",
		"task_name":  "Workspace status summary",
		"message":    "Summarize current workspace status and cite concrete evidence.",
		"objective":  "Summarize current workspace status.",
		"agent_type": "explore",
	})
	if err != nil {
		t.Fatalf("manageSubagents(spawn): %v", err)
	}
	id := strings.TrimSpace(anyToString(created["subagent_id"]))
	if id == "" {
		t.Fatalf("missing subagent_id in result: %#v", created)
	}
	if strings.TrimSpace(anyToString(created["thread_id"])) != id {
		t.Fatalf("thread_id must match subagent_id: %#v", created)
	}
	if strings.TrimSpace(anyToString(created["title"])) == "" {
		t.Fatalf("missing title in spawn result: %#v", created)
	}
	assertNoRecursiveKey(t, created, "path")

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
	entry := subagentItemByID(waited, id)
	if entry == nil {
		t.Fatalf("missing bounded subagent item for id=%s: %#v", id, waited)
	}
	status := strings.TrimSpace(anyToString(entry["status"]))
	if status != subagentStatusCompleted {
		t.Fatalf("unexpected subagent status=%q payload=%#v", status, entry)
	}
	if _, ok := entry["result_digest"]; ok {
		t.Fatalf("wait status item must not carry result_digest: %#v", entry)
	}
	if _, ok := entry["last_message"]; ok {
		t.Fatalf("wait status item must not carry last_message: %#v", entry)
	}
	if _, ok := entry["waiting_prompt"]; ok {
		t.Fatalf("wait status item must not carry waiting_prompt: %#v", entry)
	}
	if waited["detail_omitted"] != true {
		t.Fatalf("wait must mark child detail omitted from model-facing result: %#v", waited)
	}
	report, ok := waited["final_handoff_report"].(map[string]any)
	if !ok {
		t.Fatalf("wait must return final_handoff_report: %#v", waited)
	}
	if !strings.Contains(fmt.Sprintf("%v", report["reports"]), "Subagent completed") {
		t.Fatalf("final_handoff_report missing child handoff: %#v", report)
	}
	if strings.TrimSpace(anyToString(entry["title"])) == "" {
		t.Fatalf("missing title in wait snapshot: %#v", entry)
	}
	assertNoSubagentModelDetailFields(t, waited)
	firstRequest := mock.firstRequest()
	if firstRequest == nil {
		t.Fatalf("missing subagent provider request")
	}
	reasoning, _ := firstRequest["reasoning"].(map[string]any)
	if reasoning == nil || strings.TrimSpace(anyToString(reasoning["effort"])) != "medium" {
		t.Fatalf("subagent request reasoning=%#v, want medium effort in provider request %#v", reasoning, firstRequest)
	}
	assertNoRecursiveKey(t, waited, "path")

	managedList, err := r.manageSubagents(context.Background(), map[string]any{
		"action": "list",
	})
	if err != nil {
		t.Fatalf("manageSubagents(list): %v", err)
	}
	if strings.TrimSpace(anyToString(managedList["status"])) != "ok" {
		t.Fatalf("unexpected list payload: %#v", managedList)
	}
	assertNoRecursiveKey(t, managedList, "path")

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
	if parseIntRaw(inspected["requested_count"], 0) != 1 {
		t.Fatalf("unexpected inspect requested_count payload: %#v", inspected)
	}
	if parseIntRaw(inspected["found_count"], 0) != 1 {
		t.Fatalf("unexpected inspect found_count payload: %#v", inspected)
	}
	items, _ := inspected["items"].([]map[string]any)
	if len(items) == 0 {
		rawItems, _ := inspected["items"].([]any)
		if len(rawItems) > 0 {
			if first, ok := rawItems[0].(map[string]any); ok {
				items = []map[string]any{first}
			}
		}
	}
	if len(items) != 1 || strings.TrimSpace(anyToString(items[0]["subagent_id"])) != id {
		t.Fatalf("unexpected inspect items payload: %#v", inspected)
	}
	assertNoRecursiveKey(t, inspected, "path")

	closed, err := r.manageSubagents(context.Background(), map[string]any{
		"action": "close",
		"target": id,
	})
	if err != nil {
		t.Fatalf("manageSubagents(close): %v", err)
	}
	if strings.TrimSpace(anyToString(closed["status"])) != "ok" || closed["closed"] != true {
		t.Fatalf("unexpected close payload: %#v", closed)
	}
}

func TestFloretSubagents_DoNotProjectChildThreadForFlowerNavigation(t *testing.T) {
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
		EndpointID:        "env_test_projection",
		NamespacePublicID: "ns_test_projection",
		ChannelID:         "ch_test_projection",
		UserPublicID:      "u_test_projection",
		UserEmail:         "u_test_projection@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	svc, err := NewService(Options{
		Logger:           slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		StateDir:         workspace,
		AgentHomeDir:     workspace,
		Shell:            "bash",
		Config:           cfg,
		PersistOpTimeout: 2 * time.Second,
		ResolveProviderAPIKey: func(providerID string) (string, bool, error) {
			if strings.TrimSpace(providerID) == "openai" {
				return "sk-test", true, nil
			}
			return "", false, nil
		},
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	parent, err := svc.CreateThread(context.Background(), meta, "Parent", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread parent: %v", err)
	}

	r := newRun(runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		StateDir:     workspace,
		AgentHomeDir: workspace,
		WorkingDir:   workspace,
		Shell:        "bash",
		AIConfig:     cfg,
		SessionMeta:  meta,
		ResolveProviderKey: func(providerID string) (string, bool, error) {
			if strings.TrimSpace(providerID) == "openai" {
				return "sk-test", true, nil
			}
			return "", false, nil
		},
		RunID:        "run_parent_projection",
		ChannelID:    meta.ChannelID,
		EndpointID:   meta.EndpointID,
		ThreadID:     parent.ThreadID,
		UserPublicID: meta.UserPublicID,
		MessageID:    "m_parent_projection",
		ThreadsDB:    svc.threadsDB,
	})
	r.currentModelID = "openai/gpt-5-mini"
	prepareSubagentPermissionSnapshot(t, r)

	created, err := r.manageSubagents(context.Background(), map[string]any{
		"action":     "spawn",
		"task_name":  "Review API contract",
		"message":    "Review the API contract and return a complete final handoff.",
		"agent_type": "reviewer",
	})
	if err != nil {
		t.Fatalf("manageSubagents(spawn): %v", err)
	}
	id := strings.TrimSpace(anyToString(created["thread_id"]))
	if id == "" {
		t.Fatalf("missing child thread_id in result: %#v", created)
	}
	if _, err := r.manageSubagents(context.Background(), map[string]any{
		"action":     "wait",
		"ids":        []string{id},
		"timeout_ms": 20_000,
	}); err != nil {
		t.Fatalf("manageSubagents(wait): %v", err)
	}
	runtime, ok := r.subagentRuntime.(*floretSubagentRuntime)
	if !ok || runtime == nil {
		t.Fatalf("subagent runtime=%T, want floret runtime", r.subagentRuntime)
	}
	svc.mu.Lock()
	svc.subagentRuntimes[runThreadKey(meta.EndpointID, parent.ThreadID)] = runtime
	svc.mu.Unlock()

	thread, err := svc.GetThread(context.Background(), meta, id)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("GetThread(child) err=%v, want nil or sql.ErrNoRows", err)
	}
	if thread != nil {
		t.Fatalf("GetThread(child) thread=%#v err=%v, want hidden projection", thread, err)
	}
	if bootstrap, err := svc.GetFlowerThreadLiveBootstrap(context.Background(), meta, id); (err != nil && !errors.Is(err, sql.ErrNoRows)) || bootstrap != nil {
		t.Fatalf("GetFlowerThreadLiveBootstrap(child) bootstrap=%#v err=%v, want hidden projection", bootstrap, err)
	}

	messages, _, _, err := svc.threadsDB.ListMessages(context.Background(), meta.EndpointID, id, 500, 0)
	if err != nil {
		t.Fatalf("ListMessages child: %v", err)
	}
	if len(messages) != 0 {
		t.Fatalf("child transcript projected into Redeven messages: %#v", messages)
	}
	threadRecord, err := svc.threadsDB.GetThread(context.Background(), meta.EndpointID, id)
	if err != nil {
		t.Fatalf("GetThread child store: %v", err)
	}
	if threadRecord != nil {
		t.Fatalf("child thread projected into Redeven threadstore: %#v", threadRecord)
	}
	childMeta, err := svc.threadsDB.GetFlowerThreadMetadata(context.Background(), meta.EndpointID, id)
	if err != nil {
		t.Fatalf("GetFlowerThreadMetadata child: %v", err)
	}
	if childMeta != nil {
		t.Fatalf("child projection metadata should not be created: %#v", childMeta)
	}
	detail, err := svc.GetFlowerSubagentDetail(context.Background(), meta, parent.ThreadID, id, 0, 50)
	if err != nil {
		t.Fatalf("GetFlowerSubagentDetail without child projection metadata: %v", err)
	}
	if detail == nil || detail.Summary.ThreadID != id || detail.Summary.ParentThreadID != parent.ThreadID {
		t.Fatalf("unexpected subagent detail: %#v", detail)
	}

	_, err = svc.SendUserTurn(context.Background(), meta, SendUserTurnRequest{
		ThreadID: id,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "try to write to child"},
		Options:  RunOptions{PermissionType: config.AIPermissionApprovalRequired},
	})
	if err == nil || !strings.Contains(strings.ToLower(err.Error()), "thread not found") {
		t.Fatalf("SendUserTurn(child) err=%v, want thread not found", err)
	}
}

func TestFloretSubagents_ActivityRefreshDoesNotMutateProductThread(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	db, err := threadstore.Open(filepath.Join(workspace, "threads.sqlite"))
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	const endpointID = "env_subagent_collision"
	const parentThreadID = "th_parent_collision"
	if err := db.CreateThread(context.Background(), threadstore.Thread{
		ThreadID:          parentThreadID,
		EndpointID:        endpointID,
		NamespacePublicID: "ns_test",
		ModelID:           "openai/gpt-5-mini",
		PermissionType:    config.AIPermissionApprovalRequired,
		Title:             "Parent",
	}); err != nil {
		t.Fatalf("CreateThread parent: %v", err)
	}
	if err := db.CreateThread(context.Background(), threadstore.Thread{
		ThreadID:          "th_existing_product",
		EndpointID:        endpointID,
		NamespacePublicID: "ns_test",
		ModelID:           "openai/gpt-5-mini",
		PermissionType:    config.AIPermissionApprovalRequired,
		Title:             "Existing product thread",
	}); err != nil {
		t.Fatalf("CreateThread existing: %v", err)
	}

	r := newRun(runOptions{
		Log:              slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		StateDir:         workspace,
		AgentHomeDir:     workspace,
		AIConfig:         &config.AIConfig{CurrentModelID: "openai/gpt-5-mini"},
		SessionMeta:      &session.Meta{EndpointID: endpointID, NamespacePublicID: "ns_test", UserPublicID: "u_test", CanRead: true, CanWrite: true, CanExecute: true},
		EndpointID:       endpointID,
		ThreadID:         parentThreadID,
		MessageID:        "m_parent_collision",
		ThreadsDB:        db,
		UserPublicID:     "u_test",
		PersistOpTimeout: time.Second,
	})
	r.currentModelID = "openai/gpt-5-mini"
	runtime := newFloretSubagentRuntime(r)

	runtime.refreshSubagentTimeline(context.Background(), subagentSnapshot{
		ThreadID:       "th_existing_product",
		TaskName:       "collision",
		ParentThreadID: parentThreadID,
		AgentType:      subagentAgentTypeReviewer,
		Status:         subagentStatusRunning,
		CreatedAtMS:    time.Now().UnixMilli(),
		UpdatedAtMS:    time.Now().UnixMilli(),
	})

	existing, err := db.GetThread(context.Background(), endpointID, "th_existing_product")
	if err != nil {
		t.Fatalf("GetThread existing: %v", err)
	}
	if existing == nil || existing.Title != "Existing product thread" {
		t.Fatalf("existing product thread was overwritten: %#v", existing)
	}
	meta, err := db.GetFlowerThreadMetadata(context.Background(), endpointID, "th_existing_product")
	if err != nil {
		t.Fatalf("GetFlowerThreadMetadata: %v", err)
	}
	if meta != nil {
		t.Fatalf("collision must not create subagent metadata: %#v", meta)
	}
}

type subagentWebSearchResolverMock struct {
	mu                    sync.Mutex
	step                  int
	firstRequestToolNames []string
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
	body, _ := io.ReadAll(r.Body)
	var reqBody map[string]any
	requestToolNames := []string{}
	if err := json.Unmarshal(body, &reqBody); err == nil {
		if rawTools, ok := reqBody["tools"].([]any); ok {
			names := make([]string, 0, len(rawTools))
			for _, rawTool := range rawTools {
				tool, ok := rawTool.(map[string]any)
				if !ok {
					continue
				}
				if name, ok := tool["name"].(string); ok {
					names = append(names, name)
					continue
				}
				if fn, ok := tool["function"].(map[string]any); ok {
					if name, ok := fn["name"].(string); ok {
						names = append(names, name)
					}
				}
			}
			requestToolNames = names
		}
	}

	m.mu.Lock()
	m.step++
	step := m.step
	if step == 1 {
		m.firstRequestToolNames = append([]string(nil), requestToolNames...)
	}
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
			"type":         "response.output_item.added",
			"output_index": 0,
			"item": map[string]any{
				"type":      "function_call",
				"id":        "fc_subagent_search_1",
				"call_id":   "call_subagent_search_1",
				"name":      "web_search_tool",
				"arguments": `{"query":"hello","provider":"dummy","count":1}`,
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type":         "response.output_item.done",
			"output_index": 0,
			"item": map[string]any{
				"type":      "function_call",
				"id":        "fc_subagent_search_1",
				"call_id":   "call_subagent_search_1",
				"name":      "web_search_tool",
				"arguments": `{"query":"hello","provider":"dummy","count":1}`,
			},
		})
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
						"name":      "web_search_tool",
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
						"type": "message",
						"id":   "msg_subagent_complete_2",
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

func TestFloretSubagents_InheritsWebSearchResolver(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	mock := &subagentWebSearchResolverMock{}
	srv := httptest.NewServer(http.HandlerFunc(mock.handle))
	t.Cleanup(srv.Close)

	cfg := &config.AIConfig{
		Providers: []config.AIProvider{{
			ID:      "compat",
			Type:    "openai_compatible",
			BaseURL: strings.TrimSuffix(srv.URL, "/") + "/v1",
			WebSearch: &config.AIProviderWebSearch{
				Mode: config.AIProviderWebSearchModeBrave,
			},
			Models: []config.AIProviderModel{{ModelName: "gpt-5-mini", ContextWindow: 128000}},
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
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		StateDir:     workspace,
		AgentHomeDir: workspace,
		Shell:        "bash",
		AIConfig:     cfg,
		SessionMeta:  meta,
		ResolveProviderKey: func(providerID string) (string, bool, error) {
			if strings.TrimSpace(providerID) == "compat" {
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
	r.currentModelID = "compat/gpt-5-mini"
	prepareSubagentPermissionSnapshot(t, r)

	created, err := r.manageSubagents(context.Background(), map[string]any{
		"action":     "spawn",
		"task_name":  "Web source summary",
		"message":    "Search the web and summarize the results with source URLs.",
		"objective":  "Search the web and summarize the results.",
		"agent_type": "explore",
	})
	if err != nil {
		t.Fatalf("manageSubagents(spawn): %v", err)
	}
	id := strings.TrimSpace(anyToString(created["subagent_id"]))
	if id == "" {
		t.Fatalf("missing subagent_id in result: %#v", created)
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
	mock.mu.Lock()
	firstRequestToolNames := append([]string(nil), mock.firstRequestToolNames...)
	mock.mu.Unlock()
	if !containsString(firstRequestToolNames, "web_search_tool") {
		t.Fatalf("first subagent request tools=%v, want web_search_tool", firstRequestToolNames)
	}
	entry := subagentItemByID(waited, id)
	if entry == nil {
		t.Fatalf("missing bounded subagent item for id=%s: %#v", id, waited)
	}
	if strings.TrimSpace(anyToString(entry["status"])) != subagentStatusCompleted {
		t.Fatalf("unexpected subagent status payload: %#v", entry)
	}
	assertNoSubagentModelDetailFields(t, waited)

	if !resolverCalled.Load() {
		t.Fatalf("expected ResolveWebSearchKey to be called in subagent run")
	}
}

type fakeManageSubagentRuntime struct {
	items []subagentSnapshot
}

func (f *fakeManageSubagentRuntime) manage(ctx context.Context, _ string, args map[string]any) (map[string]any, error) {
	action := strings.ToLower(strings.TrimSpace(anyToString(args["action"])))
	switch action {
	case subagentActionList:
		items := make([]map[string]any, 0, len(f.items))
		for _, snapshot := range f.items {
			if parseBoolArg(args, "running_only", false) && isSubagentTerminalStatus(snapshot.Status) {
				continue
			}
			items = append(items, subagentListPayload(snapshot))
		}
		out := subagentBoundedResult(action, items)
		out["total"] = len(f.items)
		return out, nil
	case subagentActionInspect:
		targets := collectInspectTargets(args)
		items := make([]map[string]any, 0, len(targets))
		missing := make([]string, 0)
		for _, target := range targets {
			found := false
			for _, snapshot := range f.items {
				if target == snapshot.ThreadID {
					items = append(items, subagentSnapshotPayload(snapshot))
					found = true
					break
				}
			}
			if !found {
				missing = append(missing, target)
			}
		}
		status := "ok"
		if len(items) == 0 {
			status = "not_found"
		} else if len(missing) > 0 {
			status = "partial"
		}
		out := subagentBoundedResult(action, items)
		out["status"] = status
		out["requested_count"] = len(targets)
		out["found_count"] = len(items)
		out["missing_count"] = len(missing)
		out["missing_ids"] = missing
		return out, nil
	case subagentActionSendInput:
		return map[string]any{"status": "ok", "action": action, "target": strings.TrimSpace(anyToString(args["target"])), "accepted": true}, nil
	case subagentActionClose:
		return map[string]any{"status": "ok", "action": action, "target": strings.TrimSpace(anyToString(args["target"])), "closed": true}, nil
	case subagentActionCloseAll:
		items := make([]map[string]any, 0, len(f.items))
		affected := make([]string, 0, len(f.items))
		closed := 0
		for index := range f.items {
			snapshot := f.items[index]
			affected = append(affected, snapshot.ThreadID)
			if snapshot.CanClose {
				snapshot.Status = subagentStatusCanceled
				snapshot.Closed = true
				snapshot.CanClose = false
				f.items[index] = snapshot
				closed++
			}
			items = append(items, subagentSnapshotPayload(f.items[index]))
		}
		out := subagentBoundedResult(action, items)
		out["closed_count"] = closed
		out["stopped_count"] = closed
		out["affected_ids"] = affected
		return out, nil
	default:
		return nil, fmt.Errorf("unexpected fake action %q", action)
	}
}

func (f *fakeManageSubagentRuntime) release() {}

func (f *fakeManageSubagentRuntime) snapshots(context.Context) ([]subagentSnapshot, error) {
	return append([]subagentSnapshot(nil), f.items...), nil
}

func assertNoRecursiveKey(t *testing.T, value any, forbidden string) {
	t.Helper()
	if recursiveKeyPath(value, forbidden, "$") != "" {
		t.Fatalf("payload contains forbidden key %q at %s: %#v", forbidden, recursiveKeyPath(value, forbidden, "$"), value)
	}
}

func assertNoSubagentModelDetailFields(t *testing.T, value any) {
	t.Helper()
	for _, forbidden := range []string{
		"tool_call",
		"tool_calls",
		"tool_result",
		"tool_results",
		"stdout",
		"stderr",
		"command",
		"args",
		"args_json",
		"history",
		"transcript",
		"timeline",
		"messages",
		"entries",
		"raw",
		"result_struct",
		"subagents",
		"snapshots",
		"snapshots_by_id",
		"snapshot_count",
		"task_id",
		"parent_turn_id",
		"latest_turn_id",
	} {
		assertNoRecursiveKey(t, value, forbidden)
	}
}

func subagentItemByID(payload map[string]any, id string) map[string]any {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil
	}
	itemsRaw := payload["items"]
	switch typed := itemsRaw.(type) {
	case []map[string]any:
		for _, item := range typed {
			if strings.TrimSpace(anyToString(item["thread_id"])) == id || strings.TrimSpace(anyToString(item["subagent_id"])) == id {
				return item
			}
		}
	case []any:
		for _, raw := range typed {
			item, _ := raw.(map[string]any)
			if strings.TrimSpace(anyToString(item["thread_id"])) == id || strings.TrimSpace(anyToString(item["subagent_id"])) == id {
				return item
			}
		}
	}
	return nil
}

func TestSubagentsTool_WaitTimeoutDefaultsAndCaps(t *testing.T) {
	t.Parallel()

	requested, effective, source := subagentTimeoutDecision(nil)
	if requested != 300_000 || effective != 300_000 || source != "default" {
		t.Fatalf("default timeout requested=%d effective=%d source=%q, want 300000/300000/default", requested, effective, source)
	}
	requested, effective, source = subagentTimeoutDecision(map[string]any{"timeout_ms": 60_000})
	if requested != 60_000 || effective != 60_000 || source != "request" {
		t.Fatalf("request timeout requested=%d effective=%d source=%q, want 60000/60000/request", requested, effective, source)
	}
	requested, effective, source = subagentTimeoutDecision(map[string]any{"timeout_ms": 9_999_999})
	if requested != 9_999_999 || effective != 1_200_000 || source != "max" {
		t.Fatalf("capped timeout requested=%d effective=%d source=%q, want 9999999/1200000/max", requested, effective, source)
	}
	if subagentRunTimeout != 20*time.Minute {
		t.Fatalf("subagent run timeout=%s, want 20m", subagentRunTimeout)
	}
}

func TestSubagentsTool_TrimmedResultHasHardCapAndDetailRefs(t *testing.T) {
	t.Parallel()

	items := make([]map[string]any, 0, 80)
	for i := 0; i < 80; i++ {
		id := fmt.Sprintf("child-%02d", i)
		items = append(items, map[string]any{
			"subagent_id":    id,
			"thread_id":      id,
			"status":         subagentStatusRunning,
			"title":          strings.Repeat("title ", 500),
			"task_name":      strings.Repeat("task ", 500),
			"last_message":   strings.Repeat("message ", 2000),
			"result_digest":  strings.Repeat("digest ", 2000),
			"waiting_prompt": strings.Repeat("waiting ", 2000),
			"tool_call":      map[string]any{"args_json": `{"command":"leak"}`},
			"tool_result":    map[string]any{"stdout": strings.Repeat("stdout ", 2000)},
			"messages":       []any{map[string]any{"content": "raw child transcript"}},
			"snapshot_count": 7,
			"task_id":        "legacy-task-id",
			"parent_turn_id": "parent-turn-id",
			"latest_turn_id": "latest-turn-id",
		})
	}
	out := trimSubagentToolResult(map[string]any{
		"status":               "ok",
		"action":               subagentActionWait,
		"items":                items,
		"requested_ids":        []string{"child-00"},
		"effective_timeout_ms": subagentDefaultTimeoutMS,
	})
	body, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("Marshal trimmed result: %v", err)
	}
	if len(body) > subagentToolResultHardBytes {
		t.Fatalf("trimmed payload bytes=%d, want <= %d", len(body), subagentToolResultHardBytes)
	}
	assertNoSubagentModelDetailFields(t, out)
	if out["detail_omitted"] != true {
		t.Fatalf("detail_omitted missing: %#v", out)
	}
	rawItems, _ := out["items"].([]map[string]any)
	if len(rawItems) == 0 {
		t.Fatalf("trimmed payload dropped all item refs: %#v", out)
	}
	first := rawItems[0]
	if strings.TrimSpace(anyToString(first["detail_ref"])) == "" || first["detail_omitted"] != true {
		t.Fatalf("trimmed item missing detail ref: %#v", first)
	}
	for _, forbidden := range []string{"last_message", "result_digest", "waiting_prompt"} {
		if _, ok := first[forbidden]; ok {
			t.Fatalf("wait status item must not include %s: %#v", forbidden, first)
		}
	}
}

func TestSubagentsTool_ContextModeHelpers(t *testing.T) {
	t.Parallel()

	if got := normalizeSubagentContextMode(""); got != subagentContextModeMissionOnly {
		t.Fatalf("empty context mode=%q, want mission_only", got)
	}
	if got := subagentForkModeForContextMode(subagentContextModeFullHistory); got != flruntime.SubAgentForkFullPath {
		t.Fatalf("full_history fork mode=%q, want full path", got)
	}
	if got := contextModeForSubagentForkMode(flruntime.SubAgentForkFullPath); got != subagentContextModeFullHistory {
		t.Fatalf("full path context mode=%q, want full_history", got)
	}
	if got := contextModeForSubagentForkMode(flruntime.SubAgentForkNone); got != subagentContextModeMissionOnly {
		t.Fatalf("none context mode=%q, want mission_only", got)
	}
	if got := aggregateSubagentContextMode([]subagentSnapshot{
		{ThreadID: "a", ContextMode: subagentContextModeMissionOnly},
		{ThreadID: "b", ContextMode: subagentContextModeFullHistory},
	}); got != subagentContextModeFullHistory {
		t.Fatalf("aggregate context mode=%q, want full_history", got)
	}
}

func recursiveKeyPath(value any, forbidden string, path string) string {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			childPath := path + "." + key
			if key == forbidden {
				return childPath
			}
			if found := recursiveKeyPath(child, forbidden, childPath); found != "" {
				return found
			}
		}
	case []any:
		for index, child := range typed {
			if found := recursiveKeyPath(child, forbidden, fmt.Sprintf("%s[%d]", path, index)); found != "" {
				return found
			}
		}
	case []map[string]any:
		for index, child := range typed {
			if found := recursiveKeyPath(child, forbidden, fmt.Sprintf("%s[%d]", path, index)); found != "" {
				return found
			}
		}
	}
	return ""
}

func TestSubagentsTool_ManageActions(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		AgentHomeDir: t.TempDir(),
		RunID:        "run_manage_actions",
	})
	r.subagentRuntime = &fakeManageSubagentRuntime{items: []subagentSnapshot{
		{ThreadID: "tool_running", TaskName: "task_running", AgentType: subagentAgentTypeWorker, Status: subagentStatusRunning, UpdatedAtMS: time.Now().Add(-3 * time.Second).UnixMilli(), CreatedAtMS: time.Now().Add(-5 * time.Second).UnixMilli(), CanClose: true, CanSendInput: true},
		{ThreadID: "tool_completed", TaskName: "task_completed", AgentType: subagentAgentTypeExplore, Status: subagentStatusCompleted, LastMessage: "done", UpdatedAtMS: time.Now().Add(-8 * time.Second).UnixMilli(), CreatedAtMS: time.Now().Add(-10 * time.Second).UnixMilli()},
	}}

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
	assertNoRecursiveKey(t, listOut, "path")

	taskInspectOut, err := r.manageSubagents(context.Background(), map[string]any{
		"action": "inspect",
		"target": "task_running",
	})
	if err != nil {
		t.Fatalf("manageSubagents(inspect task): %v", err)
	}
	if strings.TrimSpace(anyToString(taskInspectOut["status"])) != "not_found" {
		t.Fatalf("task-name inspect must not match child thread: %#v", taskInspectOut)
	}

	inspectOut, err := r.manageSubagents(context.Background(), map[string]any{
		"action": "inspect",
		"target": "tool_running",
	})
	if err != nil {
		t.Fatalf("manageSubagents(inspect): %v", err)
	}
	if strings.TrimSpace(anyToString(inspectOut["status"])) != "ok" {
		t.Fatalf("unexpected inspect payload: %#v", inspectOut)
	}
	if parseIntRaw(inspectOut["requested_count"], 0) != 1 || parseIntRaw(inspectOut["found_count"], 0) != 1 {
		t.Fatalf("unexpected inspect count payload: %#v", inspectOut)
	}
	itemsRaw := make([]any, 0, 1)
	if typed, ok := inspectOut["items"].([]any); ok {
		itemsRaw = typed
	} else if typed, ok := inspectOut["items"].([]map[string]any); ok {
		for _, item := range typed {
			itemsRaw = append(itemsRaw, item)
		}
	}
	if len(itemsRaw) != 1 {
		t.Fatalf("inspect items payload mismatch: %#v", inspectOut)
	}
	item, _ := itemsRaw[0].(map[string]any)
	if strings.TrimSpace(anyToString(item["subagent_id"])) != "tool_running" {
		t.Fatalf("inspect item mismatch: %#v", inspectOut)
	}
	assertNoRecursiveKey(t, inspectOut, "path")

	bulkInspectOut, err := r.manageSubagents(context.Background(), map[string]any{
		"action": "inspect",
		"ids":    []string{"tool_running", "tool_missing", "tool_completed"},
	})
	if err != nil {
		t.Fatalf("manageSubagents(inspect bulk): %v", err)
	}
	if strings.TrimSpace(anyToString(bulkInspectOut["status"])) != "partial" {
		t.Fatalf("unexpected bulk inspect status payload: %#v", bulkInspectOut)
	}
	if parseIntRaw(bulkInspectOut["requested_count"], 0) != 3 {
		t.Fatalf("unexpected bulk inspect requested_count payload: %#v", bulkInspectOut)
	}
	if parseIntRaw(bulkInspectOut["found_count"], 0) != 2 {
		t.Fatalf("unexpected bulk inspect found_count payload: %#v", bulkInspectOut)
	}
	if parseIntRaw(bulkInspectOut["missing_count"], 0) != 1 {
		t.Fatalf("unexpected bulk inspect missing_count payload: %#v", bulkInspectOut)
	}
	assertNoRecursiveKey(t, bulkInspectOut, "path")

	_, err = r.manageSubagents(context.Background(), map[string]any{
		"action": "inspect",
	})
	if err == nil {
		t.Fatalf("expected inspect validation error")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "inspect requires target or ids") {
		t.Fatalf("unexpected inspect validation error: %v", err)
	}

	sendInputOut, err := r.manageSubagents(context.Background(), map[string]any{
		"action":    "send_input",
		"target":    "tool_running",
		"message":   "continue with deeper validation",
		"interrupt": false,
	})
	if err != nil {
		t.Fatalf("manageSubagents(send_input): %v", err)
	}
	if strings.TrimSpace(anyToString(sendInputOut["status"])) != "ok" || sendInputOut["accepted"] != true {
		t.Fatalf("unexpected send_input payload: %#v", sendInputOut)
	}

	closeOut, err := r.manageSubagents(context.Background(), map[string]any{
		"action":     "close",
		"target":     "tool_running",
		"timeout_ms": 9_999_999,
	})
	if err != nil {
		t.Fatalf("manageSubagents(close): %v", err)
	}
	if strings.TrimSpace(anyToString(closeOut["status"])) != "ok" || closeOut["closed"] != true {
		t.Fatalf("unexpected close payload: %#v", closeOut)
	}

	closeAllOut, err := r.manageSubagents(context.Background(), map[string]any{
		"action": "close_all",
		"scope":  "current_run",
	})
	if err != nil {
		t.Fatalf("manageSubagents(close_all): %v", err)
	}
	if strings.TrimSpace(anyToString(closeAllOut["status"])) != "ok" {
		t.Fatalf("unexpected close_all payload: %#v", closeAllOut)
	}
	if parseIntRaw(closeAllOut["closed_count"], 0) != 1 {
		t.Fatalf("unexpected close_all closed_count payload: %#v", closeAllOut)
	}
	runningRaw := subagentItemByID(closeAllOut, "tool_running")
	if runningRaw == nil {
		t.Fatalf("close_all missing running snapshot: %#v", closeAllOut)
	}
	if strings.TrimSpace(anyToString(runningRaw["status"])) != subagentStatusCanceled {
		t.Fatalf("close_all running snapshot status=%#v payload=%#v", runningRaw["status"], closeAllOut)
	}
	assertNoSubagentModelDetailFields(t, closeAllOut)
}

type fakeCloseAllFloretHost struct {
	mu        sync.Mutex
	snapshots []flruntime.SubAgentSnapshot
}

func (h *fakeCloseAllFloretHost) StartThread(context.Context, flruntime.StartThreadRequest) (flruntime.ThreadSnapshot, error) {
	return flruntime.ThreadSnapshot{}, nil
}

func (h *fakeCloseAllFloretHost) EnsureThread(_ context.Context, req flruntime.EnsureThreadRequest) (flruntime.ThreadSummary, error) {
	now := time.Now()
	return flruntime.ThreadSummary{
		ID:               req.ThreadID,
		CreatedAt:        now,
		UpdatedAt:        now,
		CanAppendMessage: true,
	}, nil
}

func (h *fakeCloseAllFloretHost) ReadThread(context.Context, flruntime.ThreadID) (flruntime.ThreadSnapshot, error) {
	return flruntime.ThreadSnapshot{}, nil
}

func (h *fakeCloseAllFloretHost) RunTurn(context.Context, flruntime.RunTurnRequest) (flruntime.TurnResult, error) {
	return flruntime.TurnResult{}, nil
}

func (h *fakeCloseAllFloretHost) ListThreadDetailEvents(context.Context, flruntime.ListThreadDetailEventsRequest) (flruntime.ThreadDetailEvents, error) {
	return flruntime.ThreadDetailEvents{}, nil
}

func (h *fakeCloseAllFloretHost) CompactThread(context.Context, flruntime.CompactThreadRequest) (flruntime.CompactThreadResult, error) {
	return flruntime.CompactThreadResult{}, nil
}

func (h *fakeCloseAllFloretHost) RetryTurn(context.Context, flruntime.RetryTurnRequest) (flruntime.TurnResult, error) {
	return flruntime.TurnResult{}, nil
}

func (h *fakeCloseAllFloretHost) CompletePendingTool(context.Context, flruntime.PendingToolCompletionRequest) (flruntime.TurnResult, error) {
	return flruntime.TurnResult{}, nil
}

func (h *fakeCloseAllFloretHost) SpawnSubAgent(context.Context, flruntime.SpawnSubAgentRequest) (flruntime.SubAgentSnapshot, error) {
	return flruntime.SubAgentSnapshot{}, nil
}

func (h *fakeCloseAllFloretHost) SendSubAgentInput(context.Context, flruntime.SendSubAgentInputRequest) (flruntime.SubAgentSnapshot, error) {
	return flruntime.SubAgentSnapshot{}, nil
}

func (h *fakeCloseAllFloretHost) WaitSubAgents(context.Context, flruntime.WaitSubAgentsRequest) (flruntime.WaitSubAgentsResult, error) {
	return flruntime.WaitSubAgentsResult{}, nil
}

func (h *fakeCloseAllFloretHost) ListSubAgents(context.Context, flruntime.ThreadID) ([]flruntime.SubAgentSnapshot, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]flruntime.SubAgentSnapshot(nil), h.snapshots...), nil
}

func (h *fakeCloseAllFloretHost) ListSubAgentActivityTimeline(context.Context, flruntime.ListSubAgentActivityTimelineRequest) (flruntime.SubAgentActivityTimelineResult, error) {
	return flruntime.SubAgentActivityTimelineResult{}, nil
}

func (h *fakeCloseAllFloretHost) CloseSubAgent(_ context.Context, req flruntime.CloseSubAgentRequest) (flruntime.SubAgentSnapshot, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for index := range h.snapshots {
		if strings.TrimSpace(string(h.snapshots[index].ThreadID)) != strings.TrimSpace(string(req.ChildThreadID)) {
			continue
		}
		h.snapshots[index].Status = flruntime.SubAgentStatusCancelled
		h.snapshots[index].Closed = true
		h.snapshots[index].CanClose = false
		h.snapshots[index].CanSendInput = false
		h.snapshots[index].CanInterrupt = false
		h.snapshots[index].UpdatedAt = time.Now()
		return h.snapshots[index], nil
	}
	return flruntime.SubAgentSnapshot{}, fmt.Errorf("missing subagent %q", req.ChildThreadID)
}

func (h *fakeCloseAllFloretHost) CloseSubAgents(context.Context, flruntime.CloseSubAgentsRequest) (flruntime.CloseSubAgentsResult, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	result := flruntime.CloseSubAgentsResult{Snapshots: make([]flruntime.SubAgentSnapshot, 0, len(h.snapshots))}
	for index := range h.snapshots {
		snapshot := h.snapshots[index]
		if snapshot.Closed || !snapshot.CanClose {
			result.Snapshots = append(result.Snapshots, snapshot)
			continue
		}
		switch snapshot.Status {
		case flruntime.SubAgentStatusCompleted, flruntime.SubAgentStatusFailed, flruntime.SubAgentStatusCancelled, flruntime.SubAgentStatusClosed:
			result.Snapshots = append(result.Snapshots, snapshot)
			continue
		}
		snapshot.Status = flruntime.SubAgentStatusClosed
		snapshot.Closed = true
		snapshot.CanClose = false
		snapshot.CanSendInput = false
		snapshot.CanInterrupt = false
		snapshot.UpdatedAt = time.Now()
		h.snapshots[index] = snapshot
		result.Snapshots = append(result.Snapshots, snapshot)
		result.Closed++
	}
	return result, nil
}

func (h *fakeCloseAllFloretHost) ReadSubAgentDetail(context.Context, flruntime.ReadSubAgentDetailRequest) (flruntime.SubAgentDetail, error) {
	return flruntime.SubAgentDetail{}, nil
}

func (h *fakeCloseAllFloretHost) ListSubAgentDetailEvents(context.Context, flruntime.ListSubAgentDetailEventsRequest) (flruntime.SubAgentDetailEvents, error) {
	return flruntime.SubAgentDetailEvents{}, nil
}

func (h *fakeCloseAllFloretHost) DeleteThread(context.Context, flruntime.ThreadID) error {
	return nil
}

func (h *fakeCloseAllFloretHost) Close() error {
	return nil
}

func TestFloretSubagents_CloseAllActionReturnsTerminalSnapshots(t *testing.T) {
	t.Parallel()

	now := time.Now()
	host := &fakeCloseAllFloretHost{snapshots: []flruntime.SubAgentSnapshot{
		{
			ThreadID:       "child_running",
			TaskName:       "running child",
			ParentThreadID: "parent_close_all",
			HostProfileRef: subagentAgentTypeWorker,
			Status:         flruntime.SubAgentStatusRunning,
			CreatedAt:      now.Add(-2 * time.Minute),
			UpdatedAt:      now.Add(-1 * time.Minute),
			CanSendInput:   true,
			CanInterrupt:   true,
			CanClose:       true,
		},
		{
			ThreadID:       "child_completed",
			TaskName:       "completed child",
			ParentThreadID: "parent_close_all",
			HostProfileRef: subagentAgentTypeReviewer,
			Status:         flruntime.SubAgentStatusCompleted,
			CreatedAt:      now.Add(-4 * time.Minute),
			UpdatedAt:      now.Add(-3 * time.Minute),
			CanClose:       false,
		},
	}}
	runtime := &floretSubagentRuntime{
		parent: newRun(runOptions{
			Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
			AgentHomeDir: t.TempDir(),
			ThreadID:     "parent_close_all",
		}),
		host: host,
	}

	out, err := runtime.closeAllAction(context.Background(), nil)
	if err != nil {
		t.Fatalf("closeAllAction: %v", err)
	}
	if strings.TrimSpace(anyToString(out["status"])) != "ok" {
		t.Fatalf("unexpected close_all payload: %#v", out)
	}
	if parseIntRaw(out["closed_count"], 0) != 1 {
		t.Fatalf("unexpected closed_count payload: %#v", out)
	}
	if parseIntRaw(out["requested_timeout_ms"], 0) != subagentDefaultTimeoutMS ||
		parseIntRaw(out["effective_timeout_ms"], 0) != subagentDefaultTimeoutMS ||
		strings.TrimSpace(anyToString(out["timeout_source"])) != "default" {
		t.Fatalf("close_all default timeout fields mismatch: %#v", out)
	}
	items, ok := out["items"].([]map[string]any)
	if !ok || len(items) != 2 {
		t.Fatalf("missing bounded items payload: %#v", out)
	}
	byID := map[string]map[string]any{}
	for _, item := range items {
		byID[strings.TrimSpace(anyToString(item["thread_id"]))] = item
	}
	runningRaw := byID["child_running"]
	if runningRaw == nil {
		t.Fatalf("missing child_running terminal snapshot: %#v", out)
	}
	if strings.TrimSpace(anyToString(runningRaw["status"])) != subagentStatusCanceled {
		t.Fatalf("child_running status=%#v payload=%#v", runningRaw["status"], out)
	}
	if runningRaw["can_close"] == true || runningRaw["can_send_input"] == true || runningRaw["can_interrupt"] == true {
		t.Fatalf("closed child should not expose active controls: %#v", runningRaw)
	}
	completedRaw := byID["child_completed"]
	if completedRaw == nil {
		t.Fatalf("missing child_completed snapshot: %#v", out)
	}
	if strings.TrimSpace(anyToString(completedRaw["status"])) != subagentStatusCompleted {
		t.Fatalf("child_completed status=%#v payload=%#v", completedRaw["status"], out)
	}
}

func TestFloretSubagents_CloseActionCapsTimeoutAndReturnsBoundedSnapshot(t *testing.T) {
	t.Parallel()

	now := time.Now()
	host := &fakeCloseAllFloretHost{snapshots: []flruntime.SubAgentSnapshot{
		{
			ThreadID:       "child_running",
			TaskName:       "running child",
			ParentThreadID: "parent_close",
			HostProfileRef: subagentAgentTypeWorker,
			Status:         flruntime.SubAgentStatusRunning,
			CreatedAt:      now.Add(-2 * time.Minute),
			UpdatedAt:      now.Add(-1 * time.Minute),
			CanSendInput:   true,
			CanInterrupt:   true,
			CanClose:       true,
		},
	}}
	runtime := &floretSubagentRuntime{
		parent: newRun(runOptions{
			Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
			AgentHomeDir: t.TempDir(),
			ThreadID:     "parent_close",
		}),
		host: host,
	}

	out, err := runtime.close(context.Background(), map[string]any{
		"target":     "child_running",
		"timeout_ms": 9_999_999,
	})
	if err != nil {
		t.Fatalf("close: %v", err)
	}
	if strings.TrimSpace(anyToString(out["status"])) != "ok" || out["closed"] != true {
		t.Fatalf("unexpected close payload: %#v", out)
	}
	if parseIntRaw(out["requested_timeout_ms"], 0) != 9_999_999 ||
		parseIntRaw(out["effective_timeout_ms"], 0) != subagentMaxTimeoutMS ||
		strings.TrimSpace(anyToString(out["timeout_source"])) != "max" {
		t.Fatalf("close timeout fields not capped: %#v", out)
	}
	item := subagentItemByID(out, "child_running")
	if item == nil || item["detail_omitted"] != true {
		t.Fatalf("close payload missing bounded detail ref: %#v", out)
	}
	assertNoSubagentModelDetailFields(t, out)
}

func TestFloretSubagents_ChildRunInheritsParentToolAllowlist(t *testing.T) {
	t.Parallel()

	parent := newRun(runOptions{
		Log:           slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		AgentHomeDir:  t.TempDir(),
		ToolAllowlist: []string{"subagents", "terminal.exec", "apply_patch"},
	})
	child := parent.subagentChildRun()
	if child == nil {
		t.Fatal("subagentChildRun returned nil")
	}
	if _, ok := child.toolAllowlist["terminal.exec"]; !ok {
		t.Fatalf("child tool allowlist missing terminal.exec: %#v", child.toolAllowlist)
	}
	if _, ok := child.toolAllowlist["apply_patch"]; !ok {
		t.Fatalf("child tool allowlist missing apply_patch: %#v", child.toolAllowlist)
	}
	if _, ok := child.toolAllowlist["subagents"]; !ok {
		t.Fatalf("child tool allowlist missing subagents: %#v", child.toolAllowlist)
	}

	registry := NewInMemoryToolRegistry()
	if err := registerBuiltInTools(registry, child); err != nil {
		t.Fatalf("registerBuiltInTools: %v", err)
	}
	activeTools, contract := child.subagentToolSurface(registry.Snapshot(), flruntime.SubAgentForkNone)
	if contract.AllowSpawnSubagents || contract.AllowUserInput {
		t.Fatalf("child contract grants forbidden direct control surfaces: %#v", contract)
	}
	if !contract.AllowUserApproval {
		t.Fatalf("child contract should allow delegated approval to the parent thread: %#v", contract)
	}
	names := toolDefNames(activeTools)
	if !containsString(names, "terminal.exec") || !containsString(names, "apply_patch") {
		t.Fatalf("active child tools=%v, want terminal.exec and apply_patch", names)
	}
	if containsString(names, "subagents") {
		t.Fatalf("active child tools=%v, must not include subagents", names)
	}
}

func TestFloretSubagents_ChildToolsRespectParentReadonlyPermission(t *testing.T) {
	t.Parallel()

	parent := newRun(runOptions{
		Log:           slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		AgentHomeDir:  t.TempDir(),
		ToolAllowlist: []string{"terminal.exec", "apply_patch"},
	})
	parent.permissionType = FlowerPermissionReadonly

	child := parent.subagentChildRun()
	registry := NewInMemoryToolRegistry()
	if err := registerBuiltInTools(registry, child); err != nil {
		t.Fatalf("registerBuiltInTools: %v", err)
	}
	activeTools, _ := child.subagentToolSurface(registry.Snapshot(), flruntime.SubAgentForkNone)
	names := toolDefNames(activeTools)
	for _, hidden := range []string{"terminal.exec", "apply_patch"} {
		if containsString(names, hidden) {
			t.Fatalf("active child tools=%v, readonly parent must hide %s", names, hidden)
		}
	}
}

func TestSubagentsTool_RejectsOldActions(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{Log: slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})), AgentHomeDir: t.TempDir()})
	_, err := r.manageSubagents(context.Background(), map[string]any{"action": "create", "message": "legacy action", "agent_type": "explore"})
	if err == nil {
		t.Fatalf("expected old create action to be rejected")
	}
	if !strings.Contains(err.Error(), "unsupported action") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSubagentsTool_SpawnRequiresMessageAndAgentType(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{Log: slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})), AgentHomeDir: t.TempDir()})

	_, err := r.manageSubagents(context.Background(), map[string]any{"action": "spawn", "agent_type": "explore"})
	if err == nil {
		t.Fatalf("expected missing message to fail")
	}
	if !strings.Contains(err.Error(), "spawn requires message") {
		t.Fatalf("unexpected error: %v", err)
	}

	_, err = r.manageSubagents(context.Background(), map[string]any{"action": "spawn", "message": "summarize workspace", "agent_type": "invalid"})
	if err == nil {
		t.Fatalf("expected invalid agent_type to fail")
	}
	if !strings.Contains(err.Error(), "invalid agent_type") {
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

	r := newRun(runOptions{Log: slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})), AgentHomeDir: workspace})
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
