package ai

import (
	"regexp"
	"strings"
	"testing"
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
