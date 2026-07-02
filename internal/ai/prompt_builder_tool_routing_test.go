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
	tools := []ToolDef{{Name: "terminal.exec"}, {Name: "file.read"}, {Name: "okf.index"}, {Name: "okf.search"}, {Name: "okf.open"}, {Name: "web.search"}}
	contract := resolveRunCapabilityContract(r, tools, nil, false)
	return r.buildLayeredSystemPrompt("objective", permissionTypeString(FlowerPermissionApprovalRequired), TaskComplexityStandard, 0, true, tools, newRuntimeState("objective"), "", contract)
}

func buildReadonlyPromptForToolRoutingTest(t *testing.T) string {
	t.Helper()
	r := newRun(runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		AgentHomeDir: t.TempDir(),
	})
	r.permissionType = FlowerPermissionReadonly
	tools := []ToolDef{
		{Name: "read_file", Visibility: ToolVisibilityReadonlyExclusive},
		{Name: "read_files", Visibility: ToolVisibilityReadonlyExclusive},
		{Name: "rgrep", Visibility: ToolVisibilityReadonlyExclusive},
		{Name: "find", Visibility: ToolVisibilityReadonlyExclusive},
		{Name: "web_fetch", Visibility: ToolVisibilityReadonlyExclusive},
		{Name: "okf.index", Visibility: ToolVisibilitySharedReadonly},
		{Name: "okf.search", Visibility: ToolVisibilitySharedReadonly},
		{Name: "okf.open", Visibility: ToolVisibilitySharedReadonly},
		{Name: "web.search", Visibility: ToolVisibilitySharedReadonly},
		{Name: "subagents", Visibility: ToolVisibilityDelegationControl},
	}
	contract := resolveRunCapabilityContract(r, tools, nil, false)
	return r.buildLayeredSystemPrompt("objective", permissionTypeString(FlowerPermissionReadonly), TaskComplexityStandard, 0, true, tools, newRuntimeState("objective"), "", contract)
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
	assertPromptContains(t, prompt, "Redeven maintained repository knowledge -> okf.index, okf.search, and okf.open.")
	assertPromptContains(t, prompt, "Use okf.index to discover OKF areas for broad Redeven-internal questions.")
	assertPromptContains(t, prompt, "Use okf.search to find candidate concepts; keep broad searches short, usually max_results=3.")
	assertPromptContains(t, prompt, "Use okf.open before relying on OKF for detailed facts, boundaries, contracts, or workflows.")
	assertPromptContains(t, prompt, "Source-level conclusions require file or terminal verification after OKF navigation.")
}

func TestBuildLayeredSystemPrompt_ExcludesOKFFromExternalResearch(t *testing.T) {
	t.Parallel()

	prompt := buildPromptForToolRoutingTest(t)
	assertPromptContains(t, prompt, "External/current/recent/news/third-party/general web facts -> authoritative URLs via terminal.exec/curl")
	assertPromptContains(t, prompt, "OKF does not access the internet and must not be used for external/current/recent/news/third-party/general web facts.")
	assertPromptContains(t, prompt, "Do not use OKF tools as a fallback when web.search is unavailable")
}

func TestBuildLayeredSystemPrompt_RemovesOKFFirstDomainBackgroundRule(t *testing.T) {
	t.Parallel()

	prompt := buildPromptForToolRoutingTest(t)
	assertPromptNotContains(t, prompt, "query it first for domain background")
	assertPromptNotContains(t, prompt, "When okf.search is available, query it first")
}

func TestBuildLayeredSystemPrompt_UsesGenericSkillRoutingInsteadOfRedevenEnvSpecialCase(t *testing.T) {
	t.Parallel()

	prompt := buildPromptForToolRoutingTest(t)
	assertPromptContains(t, prompt, "Skill routing:")
	assertPromptContains(t, prompt, "activate it with use_skill before acting")
	assertPromptNotContains(t, prompt, "Redeven environment lifecycle operations:")
	assertPromptNotContains(t, prompt, "Use `execution_context.current_target_id` as the primary target")
	assertPromptNotContains(t, prompt, "Do not infer Docker, SSH, systemd, launchctl, or process-manager commands from a Redeven target string")
}

func TestBuildLayeredSystemPrompt_UsesCanonicalToolNamesAndTerminalLimits(t *testing.T) {
	t.Parallel()

	prompt := buildPromptForToolRoutingTest(t)
	assertPromptContains(t, prompt, "Use canonical tool names exactly as listed in Current Context")
	assertPromptContains(t, prompt, "terminal.exec yield_ms and terminal.read wait_ms must be <= 30000")
	assertPromptContains(t, prompt, "file.read")
	assertPromptNotContains(t, prompt, "file_read")
}

func TestBuildLayeredSystemPrompt_ReadonlyRoutesThroughReadonlyExclusiveTools(t *testing.T) {
	t.Parallel()

	prompt := buildReadonlyPromptForToolRoutingTest(t)
	assertPromptContains(t, prompt, "Use read_file/read_files, rgrep, and find")
	assertPromptContains(t, prompt, "authoritative URLs via web_fetch")
	assertPromptContains(t, prompt, "Default rgrep:")
	assertPromptNotContains(t, prompt, "terminal.exec")
	assertPromptNotContains(t, prompt, "curl")
	assertPromptNotContains(t, prompt, "file.read")
}
