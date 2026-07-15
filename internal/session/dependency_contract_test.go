package session

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFlowersecDependencyUsesPublishedRelease(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	goMod := readRepoFile(t, root, "go.mod")
	goSum := readRepoFile(t, root, "go.sum")
	notices := readRepoFile(t, root, "THIRD_PARTY_NOTICES.md")

	if !strings.Contains(goMod, "github.com/floegence/flowersec/flowersec-go v0.21.1") {
		t.Fatalf("go.mod must depend on flowersec-go v0.21.1")
	}
	if strings.Contains(goMod, "\nreplace ") || strings.Contains(goMod, "\nreplace(") {
		t.Fatalf("go.mod must not use replace directives")
	}
	if strings.Contains(goMod, "../flowersec") || strings.Contains(goMod, "file:") || strings.Contains(goMod, "link:") {
		t.Fatalf("go.mod must not reference local flowersec checkouts")
	}

	if !strings.Contains(goSum, "github.com/floegence/flowersec/flowersec-go v0.21.1 ") {
		t.Fatalf("go.sum must include flowersec-go v0.21.1 module checksum")
	}
	if !strings.Contains(goSum, "github.com/floegence/flowersec/flowersec-go v0.21.1/go.mod ") {
		t.Fatalf("go.sum must include flowersec-go v0.21.1 go.mod checksum")
	}

	if !strings.Contains(notices, "github.com/floegence/flowersec/flowersec-go | v0.21.1") {
		t.Fatalf("THIRD_PARTY_NOTICES.md must list flowersec-go v0.21.1")
	}
	if !strings.Contains(notices, "flowersec-go@v0.21.1") {
		t.Fatalf("THIRD_PARTY_NOTICES.md must link to flowersec-go@v0.21.1")
	}
	if !strings.Contains(notices, "@floegence/flowersec-core | 0.21.1") {
		t.Fatalf("THIRD_PARTY_NOTICES.md must list @floegence/flowersec-core 0.21.1")
	}
	if strings.Contains(notices, "flowersec-core | 0.19.7") {
		t.Fatalf("THIRD_PARTY_NOTICES.md must not retain @floegence/flowersec-core 0.19.7")
	}
	previousReleaseMarkers := map[string][]string{
		"go.mod": {
			"github.com/floegence/flowersec/flowersec-go v0.19.11",
			"github.com/floegence/flowersec/flowersec-go v0.20.0",
		},
		"go.sum": {
			"github.com/floegence/flowersec/flowersec-go v0.19.11 ",
			"github.com/floegence/flowersec/flowersec-go v0.20.0 ",
		},
		"THIRD_PARTY_NOTICES.md": {
			"github.com/floegence/flowersec/flowersec-go | v0.19.11",
			"@floegence/flowersec-core | 0.19.11",
			"github.com/floegence/flowersec/flowersec-go | v0.20.0",
			"@floegence/flowersec-core | 0.20.0",
		},
	}
	for file, markers := range previousReleaseMarkers {
		content := readRepoFile(t, root, file)
		for _, marker := range markers {
			if strings.Contains(content, marker) {
				t.Fatalf("%s must not retain previous Flowersec dependency marker %q", file, marker)
			}
		}
	}
}

func TestFlowersecTransportPoliciesAreExplicit(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	agentSource := readRepoFile(t, root, "internal/agent/agent.go")
	for _, marker := range []string{
		"fsclient.WithOutboundRecordChunkBytes(64*1024)",
		"fsclient.WithYamuxLimits(fsclient.YamuxLimits{",
		"fsclient.WithTransportSecurityPolicy(fsclient.RequireTLS)",
		"fsclient.WithLiveness(fsclient.LivenessOptions{",
		"endpoint.WithOutboundRecordChunkBytes(64*1024)",
		"endpoint.WithYamuxLimits(endpoint.YamuxLimits{",
		"endpoint.WithTransportSecurityPolicy(endpoint.RequireTLS)",
		"rpc.NewServerWithOptions(stream, router, rpc.ServerOptions{",
	} {
		if !strings.Contains(agentSource, marker) {
			t.Fatalf("internal/agent/agent.go must contain explicit remote transport policy %q", marker)
		}
	}
	if strings.Contains(agentSource, "WithKeepaliveInterval") {
		t.Fatal("internal/agent/agent.go must not use the removed Flowersec keepalive API")
	}

	envAppSource := readRepoFile(t, root, "internal/envapp/ui_src/src/ui/EnvAppShell.tsx")
	for _, marker := range []string{
		"source: { kind: 'refreshable'",
		"outboundRecordChunkBytes: 64 * 1024",
		"webSocketLimits:",
		"yamuxLimits:",
		"liveness: { intervalMs: 15_000, timeoutMs: 10_000 }",
		"transportSecurityPolicy: AllowPlaintextForLoopback",
		"transportSecurityPolicy: RequireTLS",
	} {
		if !strings.Contains(envAppSource, marker) {
			t.Fatalf("EnvAppShell.tsx must contain explicit browser transport policy %q", marker)
		}
	}
	for _, removed := range []string{"createArtifactSourceFromFactory", "keepaliveIntervalMs", "artifactSource:"} {
		if strings.Contains(envAppSource, removed) {
			t.Fatalf("EnvAppShell.tsx must not retain removed Flowersec reconnect API %q", removed)
		}
	}

	dockerClientSource := readRepoFile(t, root, "tests/docker_runtime_e2e/testclient/main.go")
	if !strings.Contains(dockerClientSource, "fsclient.WithTransportSecurityPolicy(fsclient.AllowPlaintextForLoopback)") {
		t.Fatal("Docker Local UI test client must explicitly allow plaintext only for loopback")
	}

	localUISource := readRepoFile(t, root, "internal/localui/localui.go")
	if !strings.Contains(localUISource, "ResolveCredential:") || strings.Contains(localUISource, "Resolve: func(_ctx context.Context, init endpoint.DirectHandshakeInit)") {
		t.Fatal("Local UI direct handshake must use authenticated credential commit instead of eager resolver consumption")
	}
	for _, marker := range []string{"OutboundRecordChunkBytes: 64 * 1024", "YamuxLimits: endpoint.YamuxLimits{"} {
		if !strings.Contains(localUISource, marker) {
			t.Fatalf("Local UI direct server must contain Flowersec resource control %q", marker)
		}
	}
}

func TestFloeWebappDependenciesUsePublishedSecurityRelease(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	expectedPackages := map[string][]string{
		"desktop/package.json": {
			"\"@floegence/floe-webapp-core\": \"^0.37.2\"",
		},
		"desktop/package-lock.json": {
			"floe-webapp-core-0.37.2.tgz",
		},
		"desktop/pnpm-lock.yaml": {
			"@floegence/floe-webapp-core@0.37.2",
		},
		"internal/envapp/ui_src/package.json": {
			"\"@floegence/floe-webapp-boot\": \"^0.37.2\"",
			"\"@floegence/floe-webapp-core\": \"^0.37.2\"",
			"\"@floegence/floe-webapp-protocol\": \"^0.37.2\"",
			"\"@floegence/flowersec-core\": \"^0.21.1\"",
		},
		"internal/envapp/ui_src/package-lock.json": {
			"floe-webapp-boot-0.37.2.tgz",
			"floe-webapp-core-0.37.2.tgz",
			"floe-webapp-protocol-0.37.2.tgz",
			"flowersec-core-0.21.1.tgz",
		},
		"internal/envapp/ui_src/pnpm-lock.yaml": {
			"@floegence/floe-webapp-boot@0.37.2",
			"@floegence/floe-webapp-core@0.37.2",
			"@floegence/floe-webapp-protocol@0.37.2",
			"@floegence/flowersec-core@0.21.1",
		},
		"internal/codeapp/ui_src/package.json": {
			"\"@floegence/flowersec-core\": \"^0.21.1\"",
		},
		"internal/codeapp/ui_src/package-lock.json": {
			"flowersec-core-0.21.1.tgz",
		},
		"THIRD_PARTY_NOTICES.md": {
			"@floegence/floe-webapp-boot | 0.37.2",
			"@floegence/floe-webapp-core | 0.37.2",
			"@floegence/floe-webapp-protocol | 0.37.2",
			"@floegence/flowersec-core | 0.21.1",
		},
	}
	for file, expectedMarkers := range expectedPackages {
		content := readRepoFile(t, root, file)
		for _, expected := range expectedMarkers {
			if !strings.Contains(content, expected) {
				t.Fatalf("%s must contain published dependency marker %q", file, expected)
			}
		}
		if strings.Contains(content, "0.36.66") {
			t.Fatalf("%s must not retain @floegence/floe-webapp 0.36.66", file)
		}
		if strings.Contains(content, "0.36.74") {
			t.Fatalf("%s must not retain previous @floegence/floe-webapp 0.36.74 release", file)
		}
		for _, previousMarker := range []string{
			"@floegence/floe-webapp-boot@0.37.0",
			"@floegence/floe-webapp-core@0.37.0",
			"@floegence/floe-webapp-protocol@0.37.0",
			"floe-webapp-boot-0.37.0.tgz",
			"floe-webapp-core-0.37.0.tgz",
			"floe-webapp-protocol-0.37.0.tgz",
			"@floegence/floe-webapp-boot | 0.37.0",
			"@floegence/floe-webapp-core | 0.37.0",
			"@floegence/floe-webapp-protocol | 0.37.0",
			"@floegence/flowersec-core@0.20.0",
			"flowersec-core-0.20.0.tgz",
			"@floegence/flowersec-core | 0.20.0",
		} {
			if strings.Contains(content, previousMarker) {
				t.Fatalf("%s must not retain previous dependency marker %q", file, previousMarker)
			}
		}
		if strings.Contains(content, "0.19.7") || strings.Contains(content, "0.19.8") {
			t.Fatalf("%s must not retain old @floegence/flowersec-core versions", file)
		}
		if strings.Contains(content, "0.19.11") {
			t.Fatalf("%s must not retain previous @floegence/flowersec-core 0.19.11 release", file)
		}
		assertNoLocalNPMReference(t, file, content)
	}
}

func TestFloretDependencyUsesPublishedRelease(t *testing.T) {
	t.Parallel()

	const floretVersion = "v0.5.0"
	oldFloretVersions := []string{"v0.4.0", "v0.3." + "45", "v0.3." + "46", "v0.3." + "47", "v0.3." + "53", "v0.3." + "54", "v0.3." + "55", "v0.3." + "56", "v0.3." + "57", "v0.3." + "58", "v0.3." + "59", "v0.3." + "60", "v0.3." + "61", "v0.3." + "62", "v0.3." + "63", "v0.3." + "64", "v0.3." + "65", "v0.3." + "66", "v0.3." + "67", "v0.3." + "68", "v0.3." + "69", "v0.3." + "70", "v0.3." + "71", "v0.3." + "72", "v0.3." + "73", "v0.3." + "74", "v0.3." + "75", "v0.3." + "76", "v0.3." + "77", "v0.3." + "78", "v0.3." + "79", "v0.3." + "80", "v0.3." + "81", "v0.3." + "82", "v0.3." + "83", "v0.3." + "84", "v0.3." + "85", "v0.3." + "86", "v0.3." + "87", "v0.3." + "88", "v0.3." + "89", "v0.3." + "90"}
	root := repoRootForTest(t)
	goMod := readRepoFile(t, root, "go.mod")
	goSum := readRepoFile(t, root, "go.sum")
	notices := readRepoFile(t, root, "THIRD_PARTY_NOTICES.md")

	if !strings.Contains(goMod, "github.com/floegence/floret "+floretVersion) {
		t.Fatalf("go.mod must depend on floret %s", floretVersion)
	}
	assertNoLocalGoModuleReference(t, "go.mod", goMod, "github.com/floegence/floret", "floret")
	if !strings.Contains(goSum, "github.com/floegence/floret "+floretVersion+" ") {
		t.Fatalf("go.sum must include floret %s module checksum", floretVersion)
	}
	if !strings.Contains(goSum, "github.com/floegence/floret "+floretVersion+"/go.mod ") {
		t.Fatalf("go.sum must include floret %s go.mod checksum", floretVersion)
	}
	assertNoLocalGoModuleReference(t, "go.sum", goSum, "github.com/floegence/floret", "floret")
	if !strings.Contains(notices, "| github.com/floegence/floret | "+floretVersion+" |") {
		t.Fatalf("THIRD_PARTY_NOTICES.md must include floret %s", floretVersion)
	}
	if !strings.Contains(notices, "github.com/floegence/floret@"+floretVersion) {
		t.Fatalf("THIRD_PARTY_NOTICES.md must link floret %s", floretVersion)
	}
	for _, oldFloretVersion := range oldFloretVersions {
		if strings.Contains(goMod, "github.com/floegence/floret "+oldFloretVersion) ||
			strings.Contains(goSum, "github.com/floegence/floret "+oldFloretVersion) ||
			strings.Contains(notices, "github.com/floegence/floret@"+oldFloretVersion) {
			t.Fatalf("repository must not retain old floret %s dependency markers", oldFloretVersion)
		}
	}
}

func TestFlowerDocumentationMatchesPublishedFloretBoundaries(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	expectedMarkers := map[string][]string{
		filepath.Join("okf", "ai", "flower-context-action-records.md"): {
			"SupplementalContext",
			"metadata-only",
			"attachment_metadata",
			"flower.context_action.injected",
			"v0.3.89",
		},
		filepath.Join("okf", "ui", "flower-turn-launcher.md"): {
			"file_path",
			"metadata-only",
			"pending text attachment",
		},
		filepath.Join("okf", "ai", "ai-tool-runtime.md"): {
			"RunTurnRequest.SupplementalContext",
			"TurnSupplementalContextItem",
			"attachment_metadata",
		},
		filepath.Join("okf", "ui", "flower-live-timeline.md"): {
			"ThroughOrdinal",
			"floret_projection_unavailable",
			"floret.contract.rejected",
		},
		filepath.Join("okf", "ai", "flower-thread-fork-coordination.md"): {
			"ai_thread_fork_operations",
			"snapshot schema v1",
			"ForkOperationID",
		},
		filepath.Join("internal", "runtimeservice", "compatibility_contract.json"): {
			"flower-model-directed-tool-concurrency",
			"v0.5.0",
			"execute concurrently",
			"approval queue",
			"Permission snapshots",
			"redeven-runtime-v1",
		},
	}
	for rel, markers := range expectedMarkers {
		content := readRepoFile(t, root, rel)
		for _, marker := range markers {
			if !strings.Contains(content, marker) {
				t.Fatalf("%s must document published Floret boundary marker %q", rel, marker)
			}
		}
	}
}

func TestFloretDefaultPromptBoundaryStaysInFloret(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	forbidden := []string{
		"Default" + "FloretSystemPrompt",
		"Default" + "SystemPrompt",
		"PromptSource" + "DefaultFloret",
		"PromptSource" + "DefaultAgent",
		"default_" + "floret",
		"default_" + "agent",
		"You are " + "Floret.",
		"You are a helpful AI " + "assistant.",
		"Floret default " + "assistant",
		"Default interactive Floret " + "agent.",
		"Floret Compaction " + "Summary",
		"Floret's context compaction " + "writer.",
		"Context Compaction " + "Summary",
	}
	err := filepath.WalkDir(filepath.Join(root, "internal", "ai"), func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		if filepath.Ext(path) != ".go" || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		content := string(data)
		for _, marker := range forbidden {
			if strings.Contains(content, marker) {
				rel, _ := filepath.Rel(root, path)
				t.Fatalf("%s must not depend on Floret default prompt/profile marker %q", rel, marker)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("scan ai package: %v", err)
	}
}

func TestFloretAssistantProjectionIsNotStoredAsThreadstoreShadowCopy(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	for _, rel := range []string{
		filepath.Join("internal", "ai", "service.go"),
		filepath.Join("internal", "ai", "floret_thread_projection.go"),
		filepath.Join("internal", "ai", "flower_live_projection.go"),
		filepath.Join("internal", "ai", "terminal_process_service.go"),
	} {
		content := readRepoFile(t, root, rel)
		for _, marker := range []string{
			"persist" + "AssistantSnapshot",
			"persist" + "FloretProjectionToAssistantMessage",
			"Update" + "TranscriptMessageJSONByRowID",
			"snapshot" + "AssistantMessageJSONWithStatus(\"complete\")",
			"Project" + "ThreadTurn",
		} {
			if strings.Contains(content, marker) {
				t.Fatalf("%s must not store Floret assistant projection shadow copy marker %q", rel, marker)
			}
		}
	}
}

func TestFloretMaintenanceBoundaryUsesProviderFreeThreadMaintenanceHost(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	content := readRepoFile(t, root, filepath.Join("internal", "ai", "service.go"))
	for _, marker := range []string{
		"flconfig." + "ProviderFake",
		"Fake" + "Response",
		"flruntime." + "NewHost",
		"flruntime." + "NewLifecycleHost",
		"flruntime." + "LifecycleHost",
		"Lifecycle" + "HostOptions",
		"open" + "FloretLifecycleHost",
	} {
		if strings.Contains(content, marker) {
			t.Fatalf("service.go maintenance cleanup must use Floret NewThreadMaintenanceHost instead of retaining marker %q", marker)
		}
	}
	if !strings.Contains(content, "flruntime."+"NewThreadMaintenanceHost") {
		t.Fatalf("service.go must use Floret NewThreadMaintenanceHost for provider-free maintenance")
	}
}

func TestFloretGatewayBoundaryUsesGatewayIdentity(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	for _, rel := range []string{
		filepath.Join("internal", "ai", "floret_runtime.go"),
		filepath.Join("internal", "ai", "compact_thread_context.go"),
		filepath.Join("internal", "ai", "subagents_floret.go"),
	} {
		content := readRepoFile(t, root, rel)
		for _, marker := range []string{
			"flconfig." + "ProviderFake",
			"Fake" + "Response",
		} {
			if strings.Contains(content, marker) {
				t.Fatalf("%s must not configure gateway-backed Floret hosts with fake provider marker %q", rel, marker)
			}
		}
		if !strings.Contains(content, "ModelGatewayIdentity:") {
			t.Fatalf("%s must pass Floret ModelGatewayIdentity for gateway-backed hosts", rel)
		}
	}
}

func TestFloretSubagentDetailUsesProviderFreeMaintenanceHost(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	content := readRepoFile(t, root, filepath.Join("internal", "ai", "subagents_floret.go"))
	for _, marker := range []string{
		"detached" + "SubagentParentRun",
		"out[\"item\"] =",
		"minimal[\"item\"] =",
		"\"snapshot\":",
		"\"subagent\":",
		"\"item\":",
	} {
		if strings.Contains(content, marker) {
			t.Fatalf("subagents_floret.go must not retain provider-backed detail or legacy subagent shape marker %q", marker)
		}
	}
	if !strings.Contains(content, "open"+"FloretMaintenanceHost") {
		t.Fatalf("subagents_floret.go must use provider-free Floret maintenance host for detached subagent detail reads")
	}
}

func TestFloretOKFAndContractsUseThreadMaintenanceHost(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	for _, rel := range []string{
		filepath.Join("okf", "ai", "ai-tool-runtime.md"),
		filepath.Join("okf", "ui", "flower-live-timeline.md"),
		filepath.Join("internal", "runtimeservice", "compatibility_contract.json"),
	} {
		content := readRepoFile(t, root, rel)
		for _, marker := range []string{
			"Lifecycle" + "Host",
			"v0.3." + "70",
			"v0.3." + "71",
		} {
			if strings.Contains(content, marker) {
				t.Fatalf("%s must not retain old Floret boundary marker %q", rel, marker)
			}
		}
	}
}

func TestFloretContextLifecycleBoundaryDoesNotUseHostHistoryAPIs(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	forbidden := []string{
		"github.com/floegence/floret/" + "internal",
		"Run" + "ProjectedTurn",
		"ProjectedTurn" + "Request",
		"ProjectedTurn" + "Result",
		"Compact" + "ProjectedContext",
		"Active" + "Transcript",
		"Prompt" + "Pack",
		"Snapshot" + "Compactor",
		"Compact" + "PromptPack",
		"context_" + "snapshots",
		"compacted_" + "context_json",
		"compact" + "Messages",
		"prune" + "ToolResultPayloads",
		"Compressed " + "context summary",
		"tool_result_" + "compacted",
		"modelGatewayDefault" + "CompactThreshold",
		"modelGatewayToolResult" + "Prune",
		"User" + "ProvidedContext",
	}
	allowedPrefixes := []string{
		filepath.Join(root, "internal", "codexbridge") + string(os.PathSeparator),
		filepath.Join(root, "okf", "dist") + string(os.PathSeparator),
	}
	allowedFiles := map[string]bool{
		filepath.Join(root, "internal", "session", "dependency_contract_test.go"): true,
	}
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		name := entry.Name()
		if entry.IsDir() {
			switch name {
			case ".git", "node_modules", ".next", "dist", "build", "tmp":
				return filepath.SkipDir
			}
			return nil
		}
		if allowedFiles[path] || !floretBoundaryScanFile(path) {
			return nil
		}
		for _, prefix := range allowedPrefixes {
			if strings.HasPrefix(path, prefix) {
				return nil
			}
		}
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		content := string(data)
		for _, marker := range forbidden {
			if strings.Contains(content, marker) {
				rel, _ := filepath.Rel(root, path)
				t.Fatalf("%s must not contain Floret context lifecycle boundary marker %q", rel, marker)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("scan repository: %v", err)
	}
}

func TestFloretContextPolicyUsesOnlyHostSelectableModelLimits(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	for _, rel := range []string{
		filepath.Join("internal", "ai", "floret_runtime.go"),
		filepath.Join("internal", "ai", "compact_thread_context.go"),
	} {
		content := readRepoFile(t, root, rel)
		for _, marker := range []string{
			"Recent" + "TailTokens",
			"Recent" + "UserTokens",
			"Compacted" + "ContextTargetTokens",
			"Summary" + "Tokens",
			"Prompt" + "CacheSegments",
		} {
			if strings.Contains(content, marker) {
				t.Fatalf("%s must not set Floret context policy strategy field %q", rel, marker)
			}
		}
	}
}

func TestFloretThreadTranscriptAPIsAreNotUsedInProduction(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	err := filepath.WalkDir(filepath.Join(root, "internal", "ai"), func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		if filepath.Ext(path) != ".go" || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		content := string(data)
		for _, marker := range []string{
			".Read" + "Thread(",
			"flruntime." + "ThreadMessage",
		} {
			if strings.Contains(content, marker) {
				rel, _ := filepath.Rel(root, path)
				t.Fatalf("%s must not use Floret transcript API marker %q", rel, marker)
			}
		}
		if strings.Contains(content, "flruntime."+"ThreadSnapshot") && strings.Contains(content, ".Messages") {
			rel, _ := filepath.Rel(root, path)
			t.Fatalf("%s must not inspect Floret thread snapshot messages", rel)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("scan ai package: %v", err)
	}
	content := readRepoFile(t, root, filepath.Join("internal", "ai", "subagents_floret.go"))
	for _, marker := range []string{
		"sync" + "ProjectedSubagent",
		"projected" + "Subagent",
		"Upsert" + "ProjectedThreadWithFlowerMetadata",
		"Upsert" + "ProjectedMessage",
	} {
		if strings.Contains(content, marker) {
			t.Fatalf("subagents_floret.go must not retain subagent projection marker %q", marker)
		}
	}
}

func TestFloretDetailBoundaryDoesNotReadRawOrRebuildSubagentActivity(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	err := filepath.WalkDir(filepath.Join(root, "internal", "ai"), func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		if filepath.Ext(path) != ".go" || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		if strings.Contains(string(data), "IncludeRaw:"+" true") {
			rel, _ := filepath.Rel(root, path)
			t.Fatalf("%s must not read Floret detail events with IncludeRaw=true in production", rel)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("scan ai package: %v", err)
	}

	content := readRepoFile(t, root, filepath.Join("internal", "ai", "subagents_floret.go"))
	for _, marker := range []string{
		"observation." + "BuildActivityTimeline",
		"flowerSubagent" + "ObservationEvent",
		"floretActivity" + "ForToolResult(nil",
	} {
		if strings.Contains(content, marker) {
			t.Fatalf("subagents_floret.go must consume Floret detail activity_timeline instead of retaining marker %q", marker)
		}
	}
}

func TestFloretMainActivityBoundaryUsesThreadTurnProjection(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	err := filepath.WalkDir(filepath.Join(root, "internal", "ai"), func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		if filepath.Ext(path) != ".go" || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		content := string(data)
		for _, marker := range []string{
			"observation." + "BuildActivityTimeline",
			"publish" + "FinalActivityTimeline",
			"remove" + "SyntheticSuccessfulFinalToolItems",
		} {
			if strings.Contains(content, marker) {
				rel, _ := filepath.Rel(root, path)
				t.Fatalf("%s must map Floret ThreadTurnProjection instead of retaining marker %q", rel, marker)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("scan ai package: %v", err)
	}
}

func TestFloretV05BoundaryRemovesProjectionAndForkFallbacks(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	for _, rel := range []string{
		filepath.Join("internal", "ai", "floret_runtime.go"),
		filepath.Join("internal", "ai", "floret_thread_projection.go"),
		filepath.Join("internal", "ai", "threads.go"),
	} {
		content := readRepoFile(t, root, rel)
		for _, marker := range []string{
			"ErrTurnProjectionUnavailable",
			"retryUnavailableFloretTurnProjection",
			"terminalLifecycleFloor",
			"markTerminalSettlementProjectionApplied",
			"deleteFloretForkThread",
		} {
			if strings.Contains(content, marker) {
				t.Fatalf("%s must not retain Floret pre-v0.5 fallback marker %q", rel, marker)
			}
		}
	}
}

func TestTerminalProcessUsesFloretSettlementGateway(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	content := readRepoFile(t, root, filepath.Join("internal", "ai", "terminal_process_service.go"))
	for _, marker := range []string{
		"floret" + "ThreadStorePath",
		"Open" + "SQLiteStore",
		"flruntime." + "NewHost",
		"open" + "FloretLifecycleHost",
		"persist" + "TerminalSettlementProjection",
		"snapshotAssistantMessageJSONWithStatus(\"complete\")",
	} {
		if strings.Contains(content, marker) {
			t.Fatalf("terminal_process_service.go must hand pending settlements to the Floret integration gateway instead of retaining marker %q", marker)
		}
	}
}

func TestFloretControlSignalsAreNotSyntheticToolCallRecords(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	err := filepath.WalkDir(filepath.Join(root, "internal", "ai"), func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		if filepath.Ext(path) != ".go" || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		content := string(data)
		for _, marker := range []string{
			"persist" + "SyntheticToolSuccess",
			"persist" + "TaskCompleteSignal",
			"persist" + "AskUserWaitingSignal",
			"record" + "TaskCompleteSignal",
		} {
			if strings.Contains(content, marker) {
				rel, _ := filepath.Rel(root, path)
				t.Fatalf("%s must not persist Floret control signals as synthetic tool-call records: %q", rel, marker)
			}
		}
		if strings.Contains(content, "ai_tool_calls") &&
			(strings.Contains(content, `"task_complete"`) || strings.Contains(content, `"ask_user"`)) {
			rel, _ := filepath.Rel(root, path)
			t.Fatalf("%s must not couple control signals to ai_tool_calls persistence", rel)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("scan ai package: %v", err)
	}
}

func TestRepositoryDoesNotRetainLegacySubagentProjectionMarker(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	forbidden := "subagent_" + "projection"
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			switch entry.Name() {
			case ".git", "node_modules", ".next", "build", "tmp":
				return filepath.SkipDir
			default:
				return nil
			}
		}
		if !floretBoundaryScanFile(path) {
			return nil
		}
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		if strings.Contains(string(data), forbidden) {
			rel, _ := filepath.Rel(root, path)
			t.Fatalf("%s must not retain legacy subagent projection marker", rel)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("scan repository: %v", err)
	}
}

func TestRepositoryDoesNotUseGoWorkspaceForPublishedDependencies(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	for _, name := range []string{"go.work", "go.work.sum"} {
		if _, err := os.Stat(filepath.Join(root, name)); err == nil {
			t.Fatalf("repository must not contain %s", name)
		} else if !os.IsNotExist(err) {
			t.Fatalf("stat %s: %v", name, err)
		}
	}
}

func floretBoundaryScanFile(path string) bool {
	switch filepath.Ext(path) {
	case ".go", ".md", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".yaml", ".yml", ".sh":
		return true
	default:
		return false
	}
}

func repoRootForTest(t *testing.T) string {
	t.Helper()

	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("could not find repository root")
		}
		dir = parent
	}
}

func readRepoFile(t *testing.T, root string, parts ...string) string {
	t.Helper()

	path := filepath.Join(append([]string{root}, parts...)...)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(data)
}

func assertNoLocalNPMReference(t *testing.T, file string, content string) {
	t.Helper()

	for _, marker := range []string{"../flowersec", "../floe-webapp"} {
		if strings.Contains(content, marker) {
			t.Fatalf("%s must not use local npm dependency reference %q", file, marker)
		}
	}
	for _, dependency := range []string{"@floegence/floe-webapp", "@floegence/flowersec-core"} {
		for _, marker := range []string{"file:", "link:", "workspace:", "portal:"} {
			if strings.Contains(content, dependency) && strings.Contains(content, dependency+marker) {
				t.Fatalf("%s must not use local npm dependency reference %q for %s", file, marker, dependency)
			}
			if strings.Contains(content, dependency+"@") && strings.Contains(content, marker) {
				for _, line := range strings.Split(content, "\n") {
					if strings.Contains(line, dependency) && strings.Contains(line, marker) {
						t.Fatalf("%s must not use local npm dependency reference %q for %s", file, marker, dependency)
					}
				}
			}
		}
	}
}

func assertNoLocalGoModuleReference(t *testing.T, file string, content string, module string, sibling string) {
	t.Helper()

	if strings.Contains(content, "\nreplace ") || strings.Contains(content, "\nreplace(") {
		t.Fatalf("%s must not use replace directives", file)
	}
	for _, marker := range []string{"../" + sibling, "./" + sibling, "file:", "link:", "workspace:", "portal:"} {
		for _, line := range strings.Split(content, "\n") {
			if strings.Contains(line, module) && strings.Contains(line, marker) {
				t.Fatalf("%s must not reference local %s checkout via %q", file, sibling, marker)
			}
		}
	}
}
