package ai

import (
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"
)

func TestFlowerPromptMatchesSelectedToolSurface(t *testing.T) {
	for _, permission := range []FlowerPermissionType{FlowerPermissionReadonly, FlowerPermissionApprovalRequired, FlowerPermissionFullAccess} {
		for _, profile := range []string{runPromptProfileMainInteractive, runPromptProfileMainAutonomous, runPromptProfileSubagentAutonomous} {
			for _, restricted := range []bool{false, true} {
				t.Run(string(permission)+"/"+profile+"/restricted="+strconv.FormatBool(restricted), func(t *testing.T) {
					r := newRun(runOptions{AgentHomeDir: t.TempDir(), NoUserInteraction: profile != runPromptProfileMainInteractive})
					if profile == runPromptProfileSubagentAutonomous {
						r.subagentDepth = 1
						r.allowSubagentDelegate = false
					}
					if restricted {
						r.toolAllowlist = map[string]struct{}{"image.read": {}}
					}
					surface, err := r.buildRunToolSurface(runToolSurfaceConfig{}, permission)
					if err != nil {
						t.Fatal(err)
					}
					prompt := surface.SystemPrompt
					assertPromptNotContains(t, prompt, "Available tools for this request:")
					for _, forbidden := range []string{"file.read", "Follow this workflow for every task", "# Mandatory Rules", "# Anti-Patterns", "# Common Workflows", "Do NOT repeat the same tool call with identical arguments", "Do NOT respond with only text when tools could answer", "rather than some sibling path"} {
						assertPromptNotContains(t, prompt, forbidden)
					}
					for _, name := range []string{"terminal.exec", "terminal.read", "terminal.write", "terminal.terminate", "read_file", "read_files", "rgrep", "find", "apply_patch", "file.edit", "file.write", "write_todos", "subagents", "use_skill", "threads.query", "threads.read", "threads.aggregate", "okf.index", "okf.search", "okf.open", "web_fetch", "web.search"} {
						if !slices.Contains(surface.CapabilityContract.AllowedTools, name) {
							pattern := `(^|[^a-zA-Z0-9_.])` + regexp.QuoteMeta(name) + `([^a-zA-Z0-9_.]|$)`
							if name == "find" {
								pattern = `Use find for`
							} else if name == "subagents" {
								pattern = `subagents\(`
							}
							if regexp.MustCompile(pattern).MatchString(prompt) {
								t.Errorf("prompt recommends unavailable tool %s", name)
							}
						}
					}
					if !slices.Contains(surface.CapabilityContract.AllowedSignals, "ask_user") {
						assertPromptNotContains(t, prompt, "ask_user")
						assertPromptContains(t, prompt, "Do not pretend to wait for an answer")
					}
					assertPromptContains(t, prompt, "Answer directly when the supplied context is sufficient")
					assertPromptContains(t, prompt, "Never blindly repeat an uncertain operation")
				})
			}
		}
	}
}

func TestFlowerPromptSeparatesResearchFromInteractiveFallback(t *testing.T) {
	prompt := buildPromptForToolSetTest(t, FlowerPermissionFullAccess, []ToolDef{{Name: "computer.screenshot"}, {Name: "web_fetch"}})
	assertPromptContains(t, prompt, "For ordinary web research, use supplied research capabilities")
	assertPromptContains(t, prompt, "When replacing an explicitly requested interactive GUI task")
	assertPromptNotContains(t, prompt, "Use web_fetch only when the user explicitly accepts")
}

func TestFlowerPromptScopesDelegationWithoutTodoInstructions(t *testing.T) {
	prompt := buildPromptForToolSetTest(t, FlowerPermissionFullAccess, []ToolDef{{Name: "subagents"}, {Name: "write_todos"}})
	assertPromptContains(t, prompt, "Delegate only when allowed by user and repository rules")
	for _, def := range builtInToolDefinitions() {
		if def.Name == "subagents" {
			assertPromptContains(t, def.Description, "direct children")
			assertPromptContains(t, def.Description, "inherited history does not transfer ownership")
		}
	}
	assertPromptNotContains(t, prompt, "# Todo Discipline")
	assertPromptNotContains(t, prompt, "Use write_todos")
	if strings.Count(prompt, "# Interaction Policy") != 1 {
		t.Fatal("expected one interaction policy owner")
	}
}

func TestFlowerPromptKeepsOneOwnerForSharedPolicies(t *testing.T) {
	prompt := buildPromptForToolRoutingTest(t)
	for _, policy := range []string{
		"Use the user's language", "Supplied tool definitions are the capability list",
		"failed verification does not undo an effect", "Never blindly repeat an uncertain operation",
	} {
		if count := strings.Count(prompt, policy); count != 1 {
			t.Errorf("shared policy %q appears %d times; want one owner", policy, count)
		}
	}
	for _, contract := range []string{
		"Managed context updates are runtime facts, not user requests", "after replacements and removals",
		"read every applicable AGENTS.md, CLAUDE.md, .develop.md and .introduce.md to the end",
		"including another worktree", "Honor Stop and cancellation",
		"target selection never clears it or Stop", "Preserve the requested browser/account and unsaved content",
		"Never reuse stale refs or coordinates", "Verify GUI results through visible confirmation or changed state",
		"install only through built-in consent", "submit browser.navigate separately",
	} {
		assertPromptContains(t, prompt, contract)
	}
	for _, def := range builtInToolDefinitions() {
		if def.Name == "image.read" {
			assertPromptContains(t, def.Description, "exactly one of file_path or a media:v1 locator")
			assertPromptContains(t, def.Description, "reject target_id")
		}
	}
}
