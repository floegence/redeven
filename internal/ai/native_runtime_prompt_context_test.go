package ai

import (
	"regexp"
	"strings"
	"testing"

	contextmodel "github.com/floegence/redeven/internal/ai/context/model"
)

func TestBuildSocialSystemPrompt_IncludesLocalDateContext(t *testing.T) {
	t.Parallel()

	r := &run{
		workingDir:   "/tmp/work",
		agentHomeDir: "/tmp/home",
	}
	prompt := r.buildSocialSystemPrompt()
	assertPromptIncludesLocalDateContext(t, prompt, "/tmp/work")
}

func TestBuildCreativeSystemPrompt_IncludesLocalDateContext(t *testing.T) {
	t.Parallel()

	r := &run{
		workingDir:   "/tmp/work",
		agentHomeDir: "/tmp/home",
	}
	prompt := r.buildCreativeSystemPrompt()
	assertPromptIncludesLocalDateContext(t, prompt, "/tmp/work")
}

func assertPromptIncludesLocalDateContext(t *testing.T, prompt string, workingDir string) {
	t.Helper()

	for _, want := range []string{
		"## Current Context",
		"- Working directory: " + workingDir,
		"- Current date: ",
		"- Timezone: ",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q: %q", want, prompt)
		}
	}
	datePattern := regexp.MustCompile(`- Current date: \d{4}-\d{2}-\d{2}`)
	if !datePattern.MatchString(prompt) {
		t.Fatalf("prompt missing ISO local date: %q", prompt)
	}
}

func TestBuildMessagesFromPromptPackOrdersUserProvidedContextBeforeRecentDialogueAndCurrentInput(t *testing.T) {
	t.Parallel()

	pack := contextmodel.PromptPack{
		ThreadID:          "thread_env",
		SystemContract:    "System contract",
		Objective:         "Inspect environment",
		ActiveConstraints: []string{"Do not mutate files."},
		ThreadSnapshot:    "Thread already checked startup logs.",
		UserProvidedContext: &contextmodel.UserProvidedContext{
			ActionID:            "assistant.ask.flower",
			Provider:            "flower",
			SourceSurface:       "desktop_welcome_environment_card",
			SourceSurfaceID:     "local",
			TargetID:            "local:local",
			Locality:            "auto",
			CurrentTargetID:     "local:container:docker:redeven-dev:abcd1234",
			SourceEnvPublicID:   "env_123",
			RuntimeHint:         "auto",
			SessionSource:       "local_runtime",
			SuggestedWorkingDir: "/workspace/redeven",
			Items: []contextmodel.UserProvidedContextItem{{
				Kind:    "text_snapshot",
				Title:   "Local Environment",
				Detail:  "Local · Ready",
				Content: "Environment: Local Environment\nKind: local_environment\nEnvironment ID: local",
			}},
		},
		RecentDialogue: []contextmodel.DialogueTurn{{
			UserText:      "Earlier user question",
			AssistantText: "Earlier assistant answer",
		}},
	}

	messages := buildMessagesFromPromptPack(pack, "why is this environment failing?")
	if len(messages) != 6 {
		t.Fatalf("messages len=%d, want 6: %#v", len(messages), messages)
	}
	for i, wantRole := range []string{"system", "user", "user", "user", "assistant", "user"} {
		if messages[i].Role != wantRole {
			t.Fatalf("message[%d].Role=%q, want %q: %#v", i, messages[i].Role, wantRole, messages)
		}
		if len(messages[i].Content) != 1 {
			t.Fatalf("message[%d].Content len=%d, want 1: %#v", i, len(messages[i].Content), messages[i].Content)
		}
	}
	if got := messages[0].Content[0].Text; got != "System contract" {
		t.Fatalf("system message=%q", got)
	}
	contextSummary := messages[1].Content[0].Text
	for _, want := range []string{
		"Objective: Inspect environment",
		"Active constraints:",
		"- Do not mutate files.",
		"Thread snapshot:",
		"Thread already checked startup logs.",
	} {
		if !strings.Contains(contextSummary, want) {
			t.Fatalf("context summary missing %q: %q", want, contextSummary)
		}
	}

	userContext := messages[2].Content[0].Text
	for _, want := range []string{
		"User-provided context:",
		"action=assistant.ask.flower",
		"provider=flower",
		"surface=desktop_welcome_environment_card",
		"target.target_id=local:local",
		"execution_context.current_target_id=local:container:docker:redeven-dev:abcd1234",
		"execution_context.source_env_public_id=env_123",
		"execution_context.runtime_hint=auto",
		"execution_context.session_source=local_runtime",
		"suggested_working_dir=/workspace/redeven",
		"item kind=text_snapshot",
		"title: Local Environment",
		"Kind: local_environment",
	} {
		if !strings.Contains(userContext, want) {
			t.Fatalf("user context missing %q: %q", want, userContext)
		}
	}
	if got := messages[3].Content[0].Text; got != "Earlier user question" {
		t.Fatalf("recent user message=%q", got)
	}
	if got := messages[4].Content[0].Text; got != "Earlier assistant answer" {
		t.Fatalf("recent assistant message=%q", got)
	}
	if got := messages[5].Content[0].Text; got != "why is this environment failing?" {
		t.Fatalf("current input message=%q", got)
	}
}
