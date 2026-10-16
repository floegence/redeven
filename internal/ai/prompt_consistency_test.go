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
					assertPromptContains(t, prompt, "Never replay an effect with an unknown outcome")
				})
			}
		}
	}
}

func TestFlowerPromptSeparatesResearchFromInteractiveFallback(t *testing.T) {
	prompt := buildPromptForToolSetTest(t, FlowerPermissionFullAccess, []ToolDef{{Name: "computer.screenshot"}, {Name: "web_fetch"}})
	assertPromptContains(t, prompt, "For ordinary web research, use the available research tools directly")
	assertPromptContains(t, prompt, "When replacing an explicitly requested interactive GUI task")
	assertPromptNotContains(t, prompt, "Use web_fetch only when the user explicitly accepts")
}

func TestFlowerPromptScopesDelegationAndTodos(t *testing.T) {
	prompt := buildPromptForToolSetTest(t, FlowerPermissionFullAccess, []ToolDef{{Name: "subagents"}, {Name: "write_todos"}})
	assertPromptContains(t, prompt, "User and applicable repository restrictions take precedence over these delegation defaults")
	assertPromptContains(t, prompt, "at most one active task")
	assertPromptContains(t, prompt, "clear obsolete work")
	if strings.Count(prompt, "# Interaction Policy") != 1 {
		t.Fatal("expected one interaction policy owner")
	}
}
