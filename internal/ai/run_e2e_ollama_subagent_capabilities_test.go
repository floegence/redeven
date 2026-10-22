package ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/settings"
)

func ollamaTaskSubagentDirectInstructionCapabilities(f *ollamaTaskFixture) {
	repository := filepath.Join(f.root, "git-audit")
	remote := filepath.Join(f.root, "git-origin.git")
	writer := filepath.Join(f.root, "git-writer")
	ollamaTaskGitCommand(f.t, f.root, "init", "--bare", "--initial-branch=main", remote)
	ollamaTaskGitCommand(f.t, f.root, "init", "--initial-branch=main", repository)
	ollamaTaskGitCommand(f.t, f.root, "-C", repository, "config", "user.name", "Flower Qualification")
	ollamaTaskGitCommand(f.t, f.root, "-C", repository, "config", "user.email", "flower-qualification@example.invalid")
	if err := os.WriteFile(filepath.Join(repository, "base.txt"), []byte("base\n"), 0600); err != nil {
		f.t.Fatal(err)
	}
	ollamaTaskGitCommand(f.t, f.root, "-C", repository, "add", "base.txt")
	ollamaTaskGitCommand(f.t, f.root, "-C", repository, "commit", "-m", "BASE_COMMON_SUBJECT")
	ollamaTaskGitCommand(f.t, f.root, "-C", repository, "remote", "add", "origin", remote)
	ollamaTaskGitCommand(f.t, f.root, "-C", repository, "push", "-u", "origin", "main")
	ollamaTaskGitCommand(f.t, f.root, "clone", remote, writer)
	ollamaTaskGitCommand(f.t, f.root, "-C", writer, "config", "user.name", "Flower Qualification")
	ollamaTaskGitCommand(f.t, f.root, "-C", writer, "config", "user.email", "flower-qualification@example.invalid")
	if err := os.WriteFile(filepath.Join(writer, "remote.txt"), []byte("remote\n"), 0600); err != nil {
		f.t.Fatal(err)
	}
	ollamaTaskGitCommand(f.t, f.root, "-C", writer, "add", "remote.txt")
	ollamaTaskGitCommand(f.t, f.root, "-C", writer, "commit", "-m", "REMOTE_ONLY_GIT_SUBJECT_7F2A")
	ollamaTaskGitCommand(f.t, f.root, "-C", writer, "push", "origin", "main")
	ollamaTaskGitCommand(f.t, f.root, "-C", repository, "fetch", "origin")
	if err := os.WriteFile(filepath.Join(repository, "local.txt"), []byte("local\n"), 0600); err != nil {
		f.t.Fatal(err)
	}
	ollamaTaskGitCommand(f.t, f.root, "-C", repository, "add", "local.txt")
	ollamaTaskGitCommand(f.t, f.root, "-C", repository, "commit", "-m", "LOCAL_ONLY_GIT_SUBJECT_39A1")

	originMainBefore := ollamaTaskGitCommand(f.t, f.root, "-C", repository, "rev-parse", "refs/remotes/origin/main")
	mergeBaseBefore := ollamaTaskGitCommand(f.t, f.root, "-C", repository, "merge-base", "HEAD", "origin/main")
	headBefore := ollamaTaskGitCommand(f.t, f.root, "-C", repository, "rev-parse", "HEAD")
	if got := ollamaTaskGitCommand(f.t, f.root, "-C", repository, "rev-list", "--left-right", "--count", "origin/main...HEAD"); got != "1\t1" {
		f.t.Fatalf("test repository divergence=%q, want one commit on each side", got)
	}
	baseFileBefore, err := os.ReadFile(filepath.Join(repository, "base.txt"))
	if err != nil {
		f.t.Fatal(err)
	}
	localFileBefore, err := os.ReadFile(filepath.Join(repository, "local.txt"))
	if err != nil {
		f.t.Fatal(err)
	}

	gitMessage := fmt.Sprintf("You are authorized to use terminal.exec for read-only Git investigation in %q. Use GIT_OPTIONAL_LOCKS=0 for git status. Inspect git status, git worktree list, the full hashes and subjects of HEAD, origin/main and their merge base, git rev-list --left-right --count origin/main...HEAD, and git diff --stat origin/main HEAD. Check whether the worktree is clean. Do not modify files or Git refs, delete anything, or run git fetch. Report the exact values you observed.", repository)
	childrenBefore := len(f.children())
	gitParent := f.finish("subagent-git-audit", fmt.Sprintf("Use subagents to spawn exactly one child named Git History Audit with mission_only context and task description Read-only Git audit. Pass this complete task and authorization as the child's message without changing it:\n\n%s\n\nWait for its completed handoff and reply GIT_AUDIT_COMPLETE. Do not perform the Git inspection yourself or spawn another child.", gitMessage), "GIT_AUDIT_COMPLETE")
	if hasOllamaTaskToolActivity(gitParent.Current, "terminal.exec") {
		f.t.Fatal("parent performed the delegated Git inspection")
	}
	gitChild := ollamaTaskFinishedChild(f, childrenBefore, gitParent.Current.TurnID, gitMessage, "terminal.exec")
	gitReport := ollamaTaskText(gitChild.Current)
	for _, expected := range []string{
		"BASE_COMMON_SUBJECT", "REMOTE_ONLY_GIT_SUBJECT_7F2A", "LOCAL_ONLY_GIT_SUBJECT_39A1",
		headBefore, originMainBefore, mergeBaseBefore, "1",
		filepath.Clean(repository), "remote.txt", "local.txt",
	} {
		if !strings.Contains(gitReport, expected) {
			f.t.Fatalf("child Git report %q does not contain %q", gitReport, expected)
		}
	}
	if !strings.Contains(strings.ToLower(gitReport), "clean") {
		f.t.Fatalf("child Git report omitted the worktree state: %q", gitReport)
	}
	if got := ollamaTaskGitCommand(f.t, f.root, "-C", repository, "rev-parse", "refs/remotes/origin/main"); got != originMainBefore {
		f.t.Fatalf("Git audit changed origin/main from %s to %s", originMainBefore, got)
	}
	if got := ollamaTaskGitCommand(f.t, f.root, "-C", repository, "merge-base", "HEAD", "origin/main"); got != mergeBaseBefore {
		f.t.Fatalf("Git audit changed merge base from %s to %s", mergeBaseBefore, got)
	}
	if got := ollamaTaskGitCommand(f.t, f.root, "-C", repository, "rev-parse", "HEAD"); got != headBefore {
		f.t.Fatalf("Git audit changed HEAD from %s to %s", headBefore, got)
	}
	if got := ollamaTaskGitCommand(f.t, f.root, "-C", repository, "status", "--porcelain"); got != "" {
		f.t.Fatalf("Git audit left worktree changes: %q", got)
	}
	baseFileAfter, err := os.ReadFile(filepath.Join(repository, "base.txt"))
	if err != nil {
		f.t.Fatal(err)
	}
	localFileAfter, err := os.ReadFile(filepath.Join(repository, "local.txt"))
	if err != nil {
		f.t.Fatal(err)
	}
	if !bytes.Equal(baseFileBefore, baseFileAfter) || !bytes.Equal(localFileBefore, localFileAfter) {
		f.t.Fatal("Git audit changed a tracked file")
	}

	fileMessage := fmt.Sprintf("You are authorized to use terminal.exec to create %s/child-authorized.txt with exactly AUTHORIZED_WRITE followed by a newline. Verify the complete file contents and report them.", f.root)
	fileChildrenBefore := len(f.children())
	fileParent := f.finish("subagent-file-write", fmt.Sprintf("Use subagents to spawn exactly one child named File Update with mission_only context and task description Create the requested test artifact. Pass this complete task and authorization as the child's message without changing it:\n\n%s\n\nWait for its completed handoff and reply FILE_WRITE_COMPLETE. Do not create the file yourself or spawn another child.", fileMessage), "FILE_WRITE_COMPLETE")
	if hasOllamaTaskToolActivity(fileParent.Current, "terminal.exec") {
		f.t.Fatal("parent performed the delegated file update")
	}
	ollamaTaskFinishedChild(f, fileChildrenBefore, fileParent.Current.TurnID, fileMessage, "terminal.exec")
	f.file("child-authorized.txt", "AUTHORIZED_WRITE\n")

	networkMessage := "You are authorized to use web_fetch to inspect the public page https://example.com/. Read the returned page title and content, then report the title and whether the page contains the phrase Example Domain."
	networkChildrenBefore := len(f.children())
	networkParent := f.finish("subagent-network-research", fmt.Sprintf("Use subagents to spawn exactly one child named Public Page Research with mission_only context and task description Inspect a public reference page. Pass this complete task and authorization as the child's message without changing it:\n\n%s\n\nWait for its completed handoff and reply NETWORK_RESEARCH_COMPLETE. Do not fetch the page yourself or spawn another child.", networkMessage), "NETWORK_RESEARCH_COMPLETE")
	if hasOllamaTaskToolActivity(networkParent.Current, "web_fetch") {
		f.t.Fatal("parent performed the delegated network lookup")
	}
	networkChild := ollamaTaskFinishedChild(f, networkChildrenBefore, networkParent.Current.TurnID, networkMessage, "web_fetch")
	if !strings.Contains(strings.ToLower(ollamaTaskText(networkChild.Current)), "example domain") {
		f.t.Fatal("child network report omitted the fetched page content")
	}
	f.report["subagent_direct_instruction_capabilities"] = true
}

func TestE2E_FlowerSubagentDirectInstructionCapabilities(t *testing.T) {
	if os.Getenv("REDEVEN_FLOWER_SUBAGENT_CAPABILITY_E2E") != "1" {
		t.Skip("set REDEVEN_FLOWER_SUBAGENT_CAPABILITY_E2E=1 to qualify delegated capabilities with the selected real model")
	}
	profile, model, key := loadSelectedFlowerTaskProfile(t)
	modelID := profile.ID + "/" + model.ModelName
	t.Logf("selected model=%s", model.EffectiveWireModelName())
	fixture := newOllamaTaskFixture(t, profile, model, modelID, key)
	ollamaTaskSubagentDirectInstructionCapabilities(fixture)
	fixture.verifyLive()
}

func loadSelectedFlowerTaskProfile(t *testing.T) (config.AIProvider, config.AIProviderModel, string) {
	t.Helper()
	root := os.Getenv("REDEVEN_FLOWER_CONTEXT_SOURCE_STATE_ROOT")
	if root == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			t.Fatal(err)
		}
		root = filepath.Join(home, ".redeven", "local-environment")
	}
	raw, err := os.ReadFile(filepath.Join(root, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	var source struct {
		AI config.AIConfig `json:"ai"`
	}
	if err := json.Unmarshal(raw, &source); err != nil {
		t.Fatal("invalid local AI configuration")
	}
	providerID, modelName, found := strings.Cut(source.AI.CurrentModelID, "/")
	if !found {
		t.Fatal("local configuration has no selected provider/model")
	}
	var selected config.AIProvider
	for _, provider := range source.AI.Providers {
		if provider.ID == providerID {
			selected = provider
			break
		}
	}
	if selected.ID == "" {
		t.Fatal("selected provider is missing from local configuration")
	}
	model, found := config.AIModelCatalogEntry(selected.Type, modelName)
	if !found {
		for _, candidate := range selected.EffectiveModels() {
			if candidate.ModelName == modelName {
				model, found = candidate, true
				break
			}
		}
	}
	if !found || model.ContextWindow == 0 || model.MaxOutputTokens == 0 {
		t.Fatal("selected model is missing its published effective budget")
	}
	key, found, err := settings.NewSecretsStore(filepath.Join(root, "secrets.json")).GetAIProviderAPIKey(providerID)
	if err != nil || !found || key == "" {
		t.Fatal("selected provider credential is unavailable")
	}
	selected.ModelSelection = nil
	selected.Models = []config.AIProviderModel{model}
	return selected, model, key
}

func ollamaTaskFinishedChild(f *ollamaTaskFixture, previousCount int, parentTurnID identity.TurnID, expectedInput, expectedTool string) *FlowerSubagentDetailResponse {
	f.t.Helper()
	children := f.children()
	if len(children) != previousCount+1 {
		f.t.Fatalf("delegation created %d children, want %d", len(children)-previousCount, 1)
	}
	var selected *flruntime.ThreadSummary
	for index := range children {
		if children[index].ParentTurnID == parentTurnID {
			selected = &children[index]
			break
		}
	}
	if selected == nil {
		f.t.Fatalf("missing child for parent turn %s", parentTurnID)
	}
	settings, err := f.svc.threadsDB.GetThreadSettings(f.ctx, f.meta.EndpointID, selected.ID.String())
	if err != nil || settings == nil || settings.PermissionType != permissionTypeString(FlowerPermissionFullAccess) {
		f.t.Fatalf("child permission settings=%#v err=%v, want full_access", settings, err)
	}
	detail, err := f.svc.GetFlowerSubagentDetail(f.ctx, f.meta, f.threadID, selected.ID.String())
	if err != nil {
		f.t.Fatal(err)
	}
	if detail.Current.LastOutcome == nil || *detail.Current.LastOutcome != flruntime.TurnOutcomeCompleted {
		f.t.Fatalf("child did not complete: outcome=%v failure=%+v", detail.Current.LastOutcome, detail.Current.Failure)
	}
	if !hasOllamaTaskToolActivity(detail.Current, expectedTool) {
		f.t.Fatalf("child did not successfully use %s", expectedTool)
	}
	foundInput := false
	for _, item := range detail.Current.Items {
		if item.Kind == flruntime.ThreadItemUser && item.TurnID == detail.Current.TurnID && item.Text == expectedInput {
			foundInput = true
			break
		}
	}
	if !foundInput {
		f.t.Fatalf("child did not receive the exact delegated message %q", expectedInput)
	}
	return detail
}

func hasOllamaTaskToolActivity(view flruntime.ThreadView, toolName string) bool {
	for _, item := range view.Items {
		if item.Activity != nil && item.Activity.ToolName == toolName && string(item.Activity.Status) == "success" {
			return true
		}
	}
	return false
}

func ollamaTaskGitCommand(t *testing.T, directory string, args ...string) string {
	t.Helper()
	command := exec.Command("git", args...)
	command.Dir = directory
	command.Env = append(os.Environ(), "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_TERMINAL_PROMPT=0")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, output)
	}
	return strings.TrimSpace(string(output))
}
