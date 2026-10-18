package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/florettest"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/storage"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
)

// Decode only automatic context messages. Tool calls and their complete outputs
// are legitimate history even when they contain Git details or rule contents.
type providerModelContextUpdate struct {
	Baseline bool                            `json:"baseline"`
	Sections []flruntime.ModelContextSection `json:"sections"`
	Removed  []string                        `json:"removed"`
}

func providerModelContextUpdates(t *testing.T, texts []string) []providerModelContextUpdate {
	t.Helper()
	var updates []providerModelContextUpdate
	for _, text := range texts {
		if !strings.HasPrefix(text, "Model context update (") {
			continue
		}
		_, raw, ok := strings.Cut(text, "\n")
		if !ok {
			t.Fatalf("missing context payload: %s", text)
		}
		var update providerModelContextUpdate
		if err := json.Unmarshal([]byte(raw), &update); err != nil {
			t.Fatal(err)
		}
		updates = append(updates, update)
	}
	return updates
}

func openAIModelContextUpdates(t *testing.T, request map[string]any) []providerModelContextUpdate {
	t.Helper()
	var texts []string
	items, _ := request["input"].([]any)
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		if item["role"] != "user" {
			continue
		}
		switch content := item["content"].(type) {
		case string:
			texts = append(texts, content)
		case []any:
			for _, raw := range content {
				part, _ := raw.(map[string]any)
				if text, ok := part["text"].(string); ok {
					texts = append(texts, text)
				}
			}
		}
	}
	return providerModelContextUpdates(t, texts)
}

func TestModelContextGitChangesStayInToolHistory(t *testing.T) {
	repo := initPromptWorkspaceRepo(t)
	runPromptWorkspaceGit(t, repo, "branch", "context-upstream")
	for name, text := range map[string]string{"second.txt": "initial\n", "AGENTS.md": "RULES_READ_ON_DEMAND: inspect applicable rules before editing.\n"} {
		if err := os.WriteFile(filepath.Join(repo, name), []byte(text), 0644); err != nil {
			t.Fatal(err)
		}
	}
	runPromptWorkspaceGit(t, repo, "add", "second.txt", "AGENTS.md")
	runPromptWorkspaceGit(t, repo, "commit", "-m", "add tracked fixtures")
	commands := []string{
		"cat AGENTS.md",
		"printf 'first edit\n' >> README.md",
		"printf 'same file edit\n' >> README.md",
		"printf 'second file edit\n' >> second.txt",
		"git add README.md && printf 'untracked\n' > scratch.txt",
		"git checkout -b context-changed && git branch --set-upstream-to=context-upstream && git -c user.name=Tester -c user.email=tester@example.com commit -m 'record staged edit'",
		"git branch --unset-upstream && git add second.txt && git reset HEAD -- second.txt",
		"git status --short --branch && git diff -- second.txt",
	}
	var mu sync.Mutex
	var requests []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Error(err)
			http.Error(w, err.Error(), 400)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		tools, _ := body["tools"].([]any)
		if len(tools) == 0 {
			writeAskUserIntegrationTextResponse(w, flusher, "title", "Git on demand")
			return
		}
		mu.Lock()
		index := len(requests)
		requests = append(requests, body)
		mu.Unlock()
		if index >= len(commands) {
			writeAskUserIntegrationTextResponse(w, flusher, "done", "Workspace checked.")
			return
		}
		args, _ := json.Marshal(map[string]any{"command": commands[index]})
		id := fmt.Sprintf("git-context-%d", index)
		item := map[string]any{"type": "function_call", "id": id, "call_id": id, "name": "terminal_exec", "arguments": string(args)}
		for _, event := range []string{"response.output_item.added", "response.output_item.done"} {
			writeOpenAISSEJSON(w, flusher, map[string]any{"type": event, "output_index": 0, "item": item})
		}
		writeAskUserIntegrationCompletedResponse(w, flusher, id)
	}))
	t.Cleanup(server.Close)
	stateDir := t.TempDir()
	svc, err := NewService(Options{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: repo, Shell: "/bin/sh",
		Config:                       &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: server.URL + "/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}},
		ResolveProviderAPIKey:        func(string) (string, bool, error) { return "sk-test", true, nil },
		ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 10 * time.Second, FirstOutputTimeout: 10 * time.Second, IdleTimeout: 10 * time.Second},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	svc.skillManager.userHome = stateDir
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Git on demand", "openai/gpt-5-mini", string(FlowerPermissionFullAccess), repo)
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{
		ClientRequestID: "git-on-demand", ThreadID: thread.ThreadID, Model: "openai/gpt-5-mini", Input: RunInput{Text: "Read the rules, edit two files, and inspect Git explicitly."}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess},
	})
	if err != nil {
		t.Fatal(err)
	}
	// This exercises several real terminal round trips; it has no latency SLA.
	terminal := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool {
		return view.RunStatus == "success" || view.RunStatus == "failed"
	}, time.Minute)
	if terminal.RunStatus != "success" {
		t.Fatalf("turn failed: %s", terminal.RunError)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(requests) != len(commands)+1 {
		t.Fatalf("requests=%d want %d", len(requests), len(commands)+1)
	}
	for i, request := range requests {
		updates := openAIModelContextUpdates(t, request)
		if len(updates) != 1 || !updates[0].Baseline {
			t.Fatalf("request %d: Git changes appended automatic facts: %+v", i, updates)
		}
		for _, section := range updates[0].Sections {
			if section.Key == "repository" {
				t.Fatalf("request %d contains repository facts: %+v", i, section)
			}
			for _, unwanted := range []string{"Workspace changes:", "Current branch:", "Ahead/behind", "Linked worktree", "RULES_READ_ON_DEMAND"} {
				if strings.Contains(section.Text, unwanted) {
					t.Errorf("automatic %s contains %q", section.Key, unwanted)
				}
			}
		}
		outputs := collectOpenAIFunctionOutputs(request["input"])
		if len(outputs) != i {
			t.Fatalf("request %d lost tool results: %+v", i, outputs)
		}
	}
	baseline := openAIModelContextUpdates(t, requests[0])[0]
	var environment, rules string
	for _, section := range baseline.Sections {
		if section.Key == "execution_environment" {
			environment = section.Text
		}
		if section.Key == "repository_rules" {
			rules = section.Text
		}
	}
	if !strings.Contains(environment, repo) || !strings.Contains(rules, filepath.Join(repo, "AGENTS.md")) || !strings.Contains(rules, "contents not loaded") {
		t.Fatalf("environment=%s rules=%s", environment, rules)
	}
	outputs := collectOpenAIFunctionOutputs(requests[len(commands)]["input"])
	for i, output := range outputs {
		var result struct {
			Status    string `json:"status"`
			Truncated bool   `json:"truncated"`
			Data      struct {
				Completed bool `json:"completed"`
				ExitCode  int  `json:"exit_code"`
			} `json:"data"`
		}
		if err := json.Unmarshal([]byte(output.Output), &result); err != nil {
			t.Fatal(err)
		}
		if result.Status != "success" || result.Truncated || !result.Data.Completed || result.Data.ExitCode != 0 {
			t.Fatalf("command %d did not complete successfully: %s", i, output.Output)
		}
	}
	if !strings.Contains(outputs[0].Output, "RULES_READ_ON_DEMAND") {
		t.Fatalf("rule read lost: %+v", outputs[0])
	}
	var gitResult struct {
		Data struct {
			Output string `json:"output"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(outputs[len(outputs)-1].Output), &gitResult); err != nil {
		t.Fatal(err)
	}
	wantGit := runPromptWorkspaceGit(t, repo, "status", "--short", "--branch") + "\n" + runPromptWorkspaceGit(t, repo, "diff", "--", "second.txt") + "\n"
	if got := strings.ReplaceAll(gitResult.Data.Output, "\r\n", "\n"); got != wantGit {
		t.Fatalf("explicit Git output changed: got %q want %q", got, wantGit)
	}
}

func TestModelContextRemovesHistoricalRepositoryOnceAcrossRestart(t *testing.T) {
	root := initPromptWorkspaceRepo(t)
	r := newRun(runOptions{WorkingDir: root, AgentHomeDir: root})
	now := func() time.Time { return time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC) }
	legacy, err := r.collectModelContextSnapshot(t.Context(), FlowerPermissionFullAccess, now)
	if err != nil {
		t.Fatal(err)
	}
	// Seed an old thread through the public runtime, without patching storage.
	legacy.Sections = append(legacy.Sections, flruntime.ModelContextSection{Key: "repository", Title: "Repository state", Text: "OLD_REPOSITORY_FACTS: branch=old; staged=1, unstaged=2, untracked=3"})
	done := florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventDelta, Text: "done"}, {Type: flprovider.EventDone, Reason: "stop"}}}
	gateway := florettest.NewScriptedGateway(flprovider.Identity{Provider: "test", Model: "repository-context", StateCompatibilityKey: "test:repository-context:v1"}, flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported}, done, done, done)
	db := filepath.Join(t.TempDir(), "thread.sqlite")
	open := func(old bool) (*flruntime.Host, flruntime.ThreadService) {
		host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: storage.SQLite(db)})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = host.Shutdown(context.Background()) })
		service, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) {
			return flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "repository-context", Name: "Repository context"}, SystemPrompt: "Test runtime facts.", Context: flconfig.ContextPolicy{ContextWindowTokens: flconfig.DefaultContextWindowTokens}}, gateway, flruntime.WithAgentDynamicToolSurface(func(context.Context, flruntime.ToolSurfaceRequest) (flruntime.ToolSurface, error) {
				if old {
					return flruntime.ToolSurface{ModelContextSnapshot: legacy}, nil
				}
				snapshot, err := r.collectModelContextSnapshot(t.Context(), FlowerPermissionFullAccess, now)
				return flruntime.ToolSurface{ModelContextSnapshot: snapshot}, err
			}))
		}))
		if err != nil {
			t.Fatal(err)
		}
		return host, service
	}
	host, service := open(true)
	thread, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create"})
	if err != nil {
		t.Fatal(err)
	}
	send := func(service flruntime.ThreadService, key string) {
		t.Helper()
		if _, err := service.Send(t.Context(), flruntime.SendInput{ThreadID: thread.ThreadID, RequestKey: flruntime.RequestKey(key), Input: flruntime.UserInput{Text: key}}); err != nil {
			t.Fatal(err)
		}
		waitForFloretThreadIdle(t, service, thread.ThreadID)
		view, err := service.View(t.Context(), thread.ThreadID)
		if err != nil || view.Failure != nil {
			t.Fatalf("view=%+v err=%v", view, err)
		}
	}
	send(service, "before-upgrade")
	if err := host.Shutdown(t.Context()); err != nil {
		t.Fatal(err)
	}
	host, service = open(false)
	send(service, "after-upgrade")
	current, err := service.(flruntime.ThreadContextReader).Context(t.Context(), thread.ThreadID)
	if err != nil || current.ModelContext == nil {
		t.Fatalf("current=%+v err=%v", current, err)
	}
	entryID := current.ModelContext.EntryID
	if !reflect.DeepEqual(current.ModelContext.RemovedKeys, []string{"repository"}) {
		t.Fatalf("canonical removal=%+v", current.ModelContext)
	}
	for _, section := range current.ModelContext.Snapshot.Sections {
		if section.Key == "repository" {
			t.Fatal("old repository facts remain current")
		}
	}
	if err := host.Shutdown(t.Context()); err != nil {
		t.Fatal(err)
	}
	_, service = open(false)
	send(service, "unchanged-after-restart")
	after, err := service.(flruntime.ThreadContextReader).Context(t.Context(), thread.ThreadID)
	if err != nil || after.ModelContext == nil || after.ModelContext.EntryID != entryID {
		t.Fatalf("unchanged snapshot was appended: %+v %v", after.ModelContext, err)
	}
	requests := gateway.Requests()
	if len(requests) != 3 {
		t.Fatalf("requests=%d", len(requests))
	}
	var prior []providerModelContextUpdate
	for i, request := range requests {
		var texts []string
		for _, message := range request.Messages {
			if message.Role == flprovider.RoleUser {
				texts = append(texts, message.Text)
			}
		}
		updates := providerModelContextUpdates(t, texts)
		if i == 0 {
			if len(updates) != 1 {
				t.Fatalf("old baseline=%+v", updates)
			}
			prior = updates
			continue
		}
		if len(updates) != 2 || !reflect.DeepEqual(updates[:1], prior[:1]) || !reflect.DeepEqual(updates[1].Removed, []string{"repository"}) || len(updates[1].Sections) != 0 {
			t.Fatalf("request %d: removal or historical prefix changed: %+v", i, updates)
		}
		if i == 2 && !reflect.DeepEqual(updates, prior) {
			t.Fatal("repeated removal after restart")
		}
		prior = updates
	}
}

func TestModelContextNecessaryFactsAndToolSurfaceStillRefresh(t *testing.T) {
	root := initPromptWorkspaceRepo(t)
	nested := filepath.Join(root, "nested")
	if err := os.MkdirAll(nested, 0755); err != nil {
		t.Fatal(err)
	}
	writeContextTestSkill(t, root, "INITIAL_REQUIRED_SKILL")
	manager := newSkillManager(root, root)
	manager.userHome = root
	scope := func(write bool) *filesystemscope.Registry {
		registry, err := filesystemscope.NewRegistry(&config.Config{AgentHomeDir: root, FilesystemScope: &config.FilesystemScope{
			SchemaVersion: config.FilesystemScopeSchemaVersionV1, DefaultRootID: "workspace", Roots: []config.FilesystemRootPolicy{{ID: "workspace", Label: "Workspace", Path: root, Kind: config.FilesystemRootCustom, Permissions: config.FilesystemPermissionSet{Read: true, Write: write}}},
		}})
		if err != nil {
			t.Fatal(err)
		}
		return registry
	}
	permission := FlowerPermissionFullAccess
	r := newRun(runOptions{WorkingDir: root, AgentHomeDir: root, SkillManager: manager, FilesystemScope: scope(true), Shell: "/bin/sh", ProductCapabilities: runProductCapabilities{
		currentSettings: func(context.Context) (*threadstore.ThreadSettings, error) {
			return &threadstore.ThreadSettings{PermissionType: string(permission)}, nil
		},
	}})
	cfg := r.buildRunToolSurfaceConfig(true, nil)
	live := r.liveFloretToolSurface(cfg)
	done := florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventDelta, Text: "done"}, {Type: flprovider.EventDone, Reason: "stop"}}}
	gateway := florettest.NewScriptedGateway(flprovider.Identity{Provider: "test", Model: "required-facts", StateCompatibilityKey: "test:required-facts:v1"}, flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported}, done, done, done)
	host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: storage.Memory()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = host.Shutdown(context.Background()) })
	service, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) {
		return flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "required-facts", Name: "Required facts"}, SystemPrompt: "Test runtime facts.", Context: flconfig.ContextPolicy{ContextWindowTokens: flconfig.DefaultContextWindowTokens}}, gateway, flruntime.WithAgentDynamicToolSurface(live))
	}))
	if err != nil {
		t.Fatal(err)
	}
	thread, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create"})
	if err != nil {
		t.Fatal(err)
	}
	send := func(key string) {
		t.Helper()
		if _, err := service.Send(t.Context(), flruntime.SendInput{ThreadID: thread.ThreadID, RequestKey: flruntime.RequestKey(key), Input: flruntime.UserInput{Text: key}}); err != nil {
			t.Fatal(err)
		}
		waitForFloretThreadIdle(t, service, thread.ThreadID)
		view, err := service.View(t.Context(), thread.ThreadID)
		if err != nil || view.Failure != nil {
			t.Fatalf("view=%+v err=%v", view, err)
		}
	}
	send("initial")
	// Mutate configuration only while idle, then use the production live surface.
	r.workingDir = nested
	r.scope = scope(false)
	permission = FlowerPermissionReadonly
	writeContextTestSkill(t, root, "UPDATED_REQUIRED_SKILL")
	if err := os.WriteFile(filepath.Join(root, "AGENTS.md"), []byte("ROOT_RULE_BODY_NOT_AUTOMATIC"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nested, "AGENTS.md"), []byte("NESTED_RULE_BODY_NOT_AUTOMATIC"), 0644); err != nil {
		t.Fatal(err)
	}
	send("updated")
	send("unchanged")
	requests := gateway.Requests()
	if len(requests) != 3 {
		t.Fatalf("requests=%d", len(requests))
	}
	var prior []providerModelContextUpdate
	for i, request := range requests {
		var texts []string
		for _, message := range request.Messages {
			if message.Role == flprovider.RoleUser {
				texts = append(texts, message.Text)
			}
		}
		updates := providerModelContextUpdates(t, texts)
		if len(updates) != 1+min(i, 1) {
			t.Fatalf("request %d updates=%+v", i, updates)
		}
		sections := map[string]string{}
		for _, section := range updates[len(updates)-1].Sections {
			sections[section.Key] = section.Text
		}
		if _, ok := sections["repository"]; ok {
			t.Fatal("Git context was restored")
		}
		wantDir, wantPermission, wantAccess, wantSkill := root, "full_access", "read-write", "INITIAL_REQUIRED_SKILL"
		if i > 0 {
			wantDir, wantPermission, wantAccess, wantSkill = nested, "readonly", "read-only", "UPDATED_REQUIRED_SKILL"
		}
		for _, want := range []string{"- Working directory: " + wantDir, "- Permission type: " + wantPermission, "(" + wantAccess + ")"} {
			if !strings.Contains(sections["execution_environment"], want) {
				t.Errorf("request %d missing %q: %s", i, want, sections["execution_environment"])
			}
		}
		if !strings.Contains(sections["skills"], wantSkill) {
			t.Errorf("request %d stale skills: %s", i, sections["skills"])
		}
		if i > 0 {
			for _, path := range []string{filepath.Join(root, "AGENTS.md"), filepath.Join(nested, "AGENTS.md")} {
				if !strings.Contains(sections["repository_rules"], path) {
					t.Errorf("request %d lost scoped rule %s", i, path)
				}
			}
			if strings.Contains(sections["repository_rules"], "RULE_BODY_NOT_AUTOMATIC") {
				t.Fatal("rule contents were injected automatically")
			}
		}
		tools := map[string]bool{}
		for _, tool := range request.Tools {
			tools[tool.Name] = true
		}
		if tools["terminal.exec"] != (i == 0) || tools["read_file"] != (i > 0) {
			t.Errorf("request %d stale tool surface: %v", i, tools)
		}
		if i == 2 && !reflect.DeepEqual(prior, updates) {
			t.Fatal("unchanged facts appended another update")
		}
		prior = updates
	}
}

func TestModelContextGitProbeOnlyDiscoversRuleRoot(t *testing.T) {
	// A fake Git executable permits only the one command needed for rule scope.
	// Every collector call is inspected, including repeated calls and a worktree.
	root := initPromptWorkspaceRepo(t)
	worktree := filepath.Join(t.TempDir(), "worktree")
	runPromptWorkspaceGit(t, root, "worktree", "add", "-b", "rule-scope", worktree)
	nested := filepath.Join(worktree, "nested")
	if err := os.MkdirAll(nested, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(worktree, "AGENTS.md"), []byte("root rules"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nested, "AGENTS.md"), []byte("nested rules"), 0644); err != nil {
		t.Fatal(err)
	}
	bin := t.TempDir()
	logPath := filepath.Join(bin, "git-calls")
	script := "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$PROMPT_TEST_GIT_LOG\"\ncase \"$*\" in\n  *' rev-parse --show-toplevel') printf '%s\\n' \"$PROMPT_TEST_GIT_ROOT\" ;;\n  *) exit 97 ;;\nesac\n"
	if err := os.WriteFile(filepath.Join(bin, "git"), []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("PROMPT_TEST_GIT_LOG", logPath)
	t.Setenv("PROMPT_TEST_GIT_ROOT", worktree)
	r := newRun(runOptions{AgentHomeDir: worktree, WorkingDir: nested})
	now := func() time.Time { return time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC) }
	for range 2 {
		snapshot, err := r.collectModelContextSnapshot(t.Context(), FlowerPermissionFullAccess, now)
		if err != nil {
			t.Fatal(err)
		}
		for _, section := range snapshot.Sections {
			if section.Key == "repository" {
				t.Fatal("unexpected repository snapshot")
			}
			if section.Key == "repository_rules" {
				for _, path := range []string{filepath.Join(worktree, "AGENTS.md"), filepath.Join(nested, "AGENTS.md")} {
					if !strings.Contains(section.Text, path) {
						t.Fatalf("lost worktree rule source %s: %s", path, section.Text)
					}
				}
			}
		}
	}
	raw, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
	if len(lines) != 2 {
		t.Fatalf("automatic Git calls=%q", raw)
	}
	for _, line := range lines {
		if !strings.HasSuffix(line, " rev-parse --show-toplevel") {
			t.Fatalf("automatic Git status probe remains: %s", line)
		}
	}
}
