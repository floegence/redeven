package ai

import (
	"io"
	"log/slog"
	"strings"
	"testing"
)

func buildPromptForToolRoutingTest(t *testing.T) string {
	t.Helper()
	r := newRun(runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		AgentHomeDir: t.TempDir(),
	})
	tools := []ToolDef{{Name: "terminal.exec"}, {Name: "file.read"}, {Name: "okf.search"}, {Name: "web.search"}}
	contract := resolveRunCapabilityContract(r, tools, false)
	return r.buildLayeredSystemPrompt("objective", "act", TaskComplexityStandard, 0, 8, true, tools, newRuntimeState("objective"), "", contract)
}

func assertPromptContains(t *testing.T, prompt string, want string) {
	t.Helper()
	if !strings.Contains(prompt, want) {
		t.Fatalf("prompt missing %q:\n%s", want, prompt)
	}
}

func assertPromptNotContains(t *testing.T, prompt string, forbidden string) {
	t.Helper()
	if strings.Contains(prompt, forbidden) {
		t.Fatalf("prompt unexpectedly contains %q:\n%s", forbidden, prompt)
	}
}

func TestBuildLayeredSystemPrompt_RoutesOKFToRedevenRepositoryKnowledgeOnly(t *testing.T) {
	t.Parallel()

	prompt := buildPromptForToolRoutingTest(t)
	assertPromptContains(t, prompt, "Information source routing:")
	assertPromptContains(t, prompt, "Redeven repository knowledge")
	assertPromptContains(t, prompt, "maintained OKF concepts) -> okf.search")
	assertPromptContains(t, prompt, "Source-level conclusions -> verify any OKF background with terminal.exec or file tools before final conclusions.")
	assertPromptContains(t, prompt, "Use okf.search only for Redeven repository knowledge")
}

func TestBuildLayeredSystemPrompt_ExcludesOKFFromExternalResearch(t *testing.T) {
	t.Parallel()

	prompt := buildPromptForToolRoutingTest(t)
	assertPromptContains(t, prompt, "External/current/recent/news/third-party/general web facts -> authoritative URLs via terminal.exec/curl")
	assertPromptContains(t, prompt, "OKF does not access the internet and must not be used for external/current/recent/news/third-party/general web facts.")
	assertPromptContains(t, prompt, "Do not use okf.search as a fallback when web.search is unavailable")
}

func TestBuildLayeredSystemPrompt_RemovesOKFFirstDomainBackgroundRule(t *testing.T) {
	t.Parallel()

	prompt := buildPromptForToolRoutingTest(t)
	assertPromptNotContains(t, prompt, "query it first for domain background")
	assertPromptNotContains(t, prompt, "When okf.search is available, query it first")
}

func TestBuildLayeredSystemPrompt_RoutesRedevenEnvironmentLifecycleToEnvCLI(t *testing.T) {
	t.Parallel()

	prompt := buildPromptForToolRoutingTest(t)
	assertPromptContains(t, prompt, "Redeven environment lifecycle operations:")
	assertPromptContains(t, prompt, "`redeven env ... --json` CLI surface")
	assertPromptContains(t, prompt, "Use `execution_context.current_target_id` as the primary target")
	assertPromptContains(t, prompt, "then `target.target_id`, then `execution_context.source_env_public_id`")
	assertPromptContains(t, prompt, "The literal target `current` is a Redeven environment alias")
	assertPromptContains(t, prompt, "Do not infer Docker, SSH, systemd, launchctl, or process-manager commands from a Redeven target string")
	assertPromptContains(t, prompt, "structured unavailable or blocked plan")
}
