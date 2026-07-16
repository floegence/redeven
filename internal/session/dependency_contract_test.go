package session

import (
	"bufio"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/mod/modfile"
)

func TestFlowersecDependencyUsesPublishedRelease(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	goMod := readRepoFile(t, root, "go.mod")
	goSum := readRepoFile(t, root, "go.sum")
	notices := readRepoFile(t, root, "THIRD_PARTY_NOTICES.md")

	if !strings.Contains(goMod, "github.com/floegence/flowersec/flowersec-go v0.23.0") {
		t.Fatalf("go.mod must depend on flowersec-go v0.23.0")
	}
	if strings.Contains(goMod, "\nreplace ") || strings.Contains(goMod, "\nreplace(") {
		t.Fatalf("go.mod must not use replace directives")
	}
	if strings.Contains(goMod, "../flowersec") || strings.Contains(goMod, "file:") || strings.Contains(goMod, "link:") {
		t.Fatalf("go.mod must not reference local flowersec checkouts")
	}

	if !strings.Contains(goSum, "github.com/floegence/flowersec/flowersec-go v0.23.0 ") {
		t.Fatalf("go.sum must include flowersec-go v0.23.0 module checksum")
	}
	if !strings.Contains(goSum, "github.com/floegence/flowersec/flowersec-go v0.23.0/go.mod ") {
		t.Fatalf("go.sum must include flowersec-go v0.23.0 go.mod checksum")
	}

	if !strings.Contains(notices, "github.com/floegence/flowersec/flowersec-go | v0.23.0") {
		t.Fatalf("THIRD_PARTY_NOTICES.md must list flowersec-go v0.23.0")
	}
	if !strings.Contains(notices, "flowersec-go@v0.23.0") {
		t.Fatalf("THIRD_PARTY_NOTICES.md must link to flowersec-go@v0.23.0")
	}
	if !strings.Contains(notices, "@floegence/flowersec-core | 0.23.0") {
		t.Fatalf("THIRD_PARTY_NOTICES.md must list @floegence/flowersec-core 0.23.0")
	}
	if strings.Contains(notices, "flowersec-core | 0.19.7") {
		t.Fatalf("THIRD_PARTY_NOTICES.md must not retain @floegence/flowersec-core 0.19.7")
	}
	previousReleaseMarkers := map[string][]string{
		"go.mod": {
			"github.com/floegence/flowersec/flowersec-go v0.19.11",
			"github.com/floegence/flowersec/flowersec-go v0.20.0",
			"github.com/floegence/flowersec/flowersec-go v0.21.1",
			"github.com/floegence/flowersec/flowersec-go v0.22.1",
		},
		"go.sum": {
			"github.com/floegence/flowersec/flowersec-go v0.19.11 ",
			"github.com/floegence/flowersec/flowersec-go v0.20.0 ",
			"github.com/floegence/flowersec/flowersec-go v0.21.1 ",
			"github.com/floegence/flowersec/flowersec-go v0.22.1 ",
		},
		"THIRD_PARTY_NOTICES.md": {
			"github.com/floegence/flowersec/flowersec-go | v0.19.11",
			"@floegence/flowersec-core | 0.19.11",
			"github.com/floegence/flowersec/flowersec-go | v0.20.0",
			"@floegence/flowersec-core | 0.20.0",
			"github.com/floegence/flowersec/flowersec-go | v0.21.1",
			"@floegence/flowersec-core | 0.21.1",
			"github.com/floegence/flowersec/flowersec-go | v0.22.1",
			"@floegence/flowersec-core | 0.22.1",
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
		"resolveLocalTransportSecurityPolicy(window.location.hostname)",
		"transportSecurityPolicy: RequireTLS",
	} {
		if !strings.Contains(envAppSource, marker) {
			t.Fatalf("EnvAppShell.tsx must contain explicit browser transport policy %q", marker)
		}
	}
	localTransportPolicySource := readRepoFile(t, root, "internal/envapp/ui_src/src/ui/security/localTransportSecurity.ts")
	for _, marker := range []string{
		"AllowPlaintextForLoopback",
		"createNetworkPlaintextPolicy({",
		"allowedHosts: [hostname]",
		"PlaintextRiskAcceptance.acceptPreE2ECredentialExposure",
	} {
		if !strings.Contains(localTransportPolicySource, marker) {
			t.Fatalf("localTransportSecurity.ts must contain explicit Local UI transport policy %q", marker)
		}
	}
	if strings.Contains(envAppSource, "\n  AllowPlaintext,\n") ||
		strings.Contains(envAppSource, "transportSecurityPolicy: AllowPlaintext,") ||
		strings.Contains(localTransportPolicySource, "\n  AllowPlaintext,\n") {
		t.Fatal("Env App must not use deprecated unrestricted AllowPlaintext")
	}
	for _, removed := range []string{"createArtifactSourceFromFactory", "keepaliveIntervalMs", "artifactSource:"} {
		if strings.Contains(envAppSource, removed) {
			t.Fatalf("EnvAppShell.tsx must not retain removed Flowersec reconnect API %q", removed)
		}
	}

	dockerClientSource := readRepoFile(t, root, "tests/docker_runtime_e2e/testclient/main.go")
	for _, marker := range []string{
		"transportSecurityPolicyForHost(parsedBase.Hostname())",
		"return fsclient.AllowPlaintextForLoopback, nil",
		"fsclient.NewNetworkPlaintextPolicy(fsclient.NetworkPlaintextPolicyOptions{",
		"AllowedHosts:   []string{addr.String()}",
		"RiskAcceptance: fsclient.PlaintextRiskAcceptPreE2ECredentialExposure",
	} {
		if !strings.Contains(dockerClientSource, marker) {
			t.Fatalf("Docker Local UI test client must contain explicit Flowersec policy marker %q", marker)
		}
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
			"\"@floegence/flowersec-core\": \"^0.23.0\"",
		},
		"internal/envapp/ui_src/package-lock.json": {
			"floe-webapp-boot-0.37.2.tgz",
			"floe-webapp-core-0.37.2.tgz",
			"floe-webapp-protocol-0.37.2.tgz",
			"flowersec-core-0.23.0.tgz",
		},
		"internal/envapp/ui_src/pnpm-lock.yaml": {
			"@floegence/floe-webapp-boot@0.37.2",
			"@floegence/floe-webapp-core@0.37.2",
			"@floegence/floe-webapp-protocol@0.37.2",
			"@floegence/flowersec-core@0.23.0",
		},
		"internal/codeapp/ui_src/package.json": {
			"\"@floegence/flowersec-core\": \"^0.23.0\"",
		},
		"internal/codeapp/ui_src/package-lock.json": {
			"flowersec-core-0.23.0.tgz",
		},
		"THIRD_PARTY_NOTICES.md": {
			"@floegence/floe-webapp-boot | 0.37.2",
			"@floegence/floe-webapp-core | 0.37.2",
			"@floegence/floe-webapp-protocol | 0.37.2",
			"@floegence/flowersec-core | 0.23.0",
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
			"@floegence/flowersec-core@0.21.1",
			"flowersec-core-0.21.1.tgz",
			"@floegence/flowersec-core | 0.21.1",
			"@floegence/flowersec-core@0.22.1",
			"flowersec-core-0.22.1.tgz",
			"@floegence/flowersec-core | 0.22.1",
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

	const (
		floretModule  = "github.com/floegence/floret"
		floretVersion = "v0.9.0"
	)
	root := repoRootForTest(t)
	goMod := readRepoFile(t, root, "go.mod")
	goSum := readRepoFile(t, root, "go.sum")
	notices := readRepoFile(t, root, "THIRD_PARTY_NOTICES.md")

	parsedMod, err := modfile.Parse("go.mod", []byte(goMod), nil)
	if err != nil {
		t.Fatalf("parse go.mod: %v", err)
	}
	var requiredVersions []string
	for _, requirement := range parsedMod.Require {
		if requirement.Mod.Path == floretModule {
			requiredVersions = append(requiredVersions, requirement.Mod.Version)
		}
	}
	if len(requiredVersions) != 1 || requiredVersions[0] != floretVersion {
		t.Fatalf("go.mod Floret requirements=%v, want only %s", requiredVersions, floretVersion)
	}
	assertNoLocalGoModuleReference(t, "go.mod", goMod, floretModule, "floret")

	wantSumVersions := map[string]bool{
		floretVersion:             false,
		floretVersion + "/go.mod": false,
	}
	scanner := bufio.NewScanner(strings.NewReader(goSum))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 || fields[0] != floretModule {
			continue
		}
		if _, ok := wantSumVersions[fields[1]]; !ok {
			t.Fatalf("go.sum contains unexpected Floret version %q", fields[1])
		}
		wantSumVersions[fields[1]] = true
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scan go.sum: %v", err)
	}
	for version, found := range wantSumVersions {
		if !found {
			t.Fatalf("go.sum is missing Floret checksum for %s", version)
		}
	}
	assertNoLocalGoModuleReference(t, "go.sum", goSum, floretModule, "floret")

	var noticeRows [][]string
	for _, line := range strings.Split(notices, "\n") {
		if !strings.HasPrefix(strings.TrimSpace(line), "|") {
			continue
		}
		columns := strings.Split(line, "|")
		if len(columns) < 7 || strings.TrimSpace(columns[1]) != floretModule {
			continue
		}
		noticeRows = append(noticeRows, columns)
	}
	if len(noticeRows) != 1 {
		t.Fatalf("THIRD_PARTY_NOTICES.md Floret rows=%d, want one", len(noticeRows))
	}
	noticeVersion := strings.TrimSpace(noticeRows[0][2])
	noticeSource := strings.TrimSpace(noticeRows[0][5])
	if noticeVersion != floretVersion || noticeSource != "https://pkg.go.dev/"+floretModule+"@"+floretVersion {
		t.Fatalf("THIRD_PARTY_NOTICES.md Floret row version=%q source=%q", noticeVersion, noticeSource)
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
			"v0.9.0",
			"single persistent source of truth",
			"host-owned thread titles",
			"typed event fields",
			"turn_projection_unavailable",
			"Thread deletion persists an immutable cleanup snapshot",
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
		if !strings.Contains(content, "ThreadTitleMode:") || !strings.Contains(content, "flruntime.ThreadTitleModeHostOwned") {
			t.Fatalf("%s must declare Redeven ownership of thread titles", rel)
		}
	}
}

func TestFloretLifecycleReasonsUseTypedFields(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	content := readRepoFile(t, root, filepath.Join("internal", "ai", "floret_events.go"))
	for _, marker := range []string{
		"floretEvent" + "MetadataString",
		"floretEventMetadataString(ev.Metadata, \"completion_reason\")",
		"floretEventMetadataString(ev.Metadata, \"continuation_reason\")",
	} {
		if strings.Contains(content, marker) {
			t.Fatalf("floret_events.go must consume typed lifecycle reasons instead of marker %q", marker)
		}
	}
	for _, marker := range []string{"ev.CompletionReason", "ev.ContinuationReason", "ev.RawFinishReason", "ev.FinishInferred"} {
		if !strings.Contains(content, marker) {
			t.Fatalf("floret_events.go missing typed lifecycle field %q", marker)
		}
	}
}

func TestFlowerThreadDeleteUsesPersistentReplayWithoutCompensation(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	for rel, markers := range map[string][]string{
		filepath.Join("internal", "threadreadstate", "store.go"): {
			"Restore" + "Records",
		},
		filepath.Join("internal", "codeapp", "appserver", "thread_read_state.go"): {
			"restoreFlower" + "ThreadReadState",
			"deleteFlowerThreadWith" + "ReadStateCleanup",
		},
		filepath.Join("internal", "ai", "thread_delete_operation.go"): {
			"Close" + "SubAgents",
		},
	} {
		content := readRepoFile(t, root, rel)
		for _, marker := range markers {
			if strings.Contains(content, marker) {
				t.Fatalf("%s must not retain thread delete compensation marker %q", rel, marker)
			}
		}
	}
	prepareSource := readRepoFile(t, root, filepath.Join("internal", "ai", "threads.go"))
	if !strings.Contains(prepareSource, "PrepareThreadDeleteOperation") {
		t.Fatalf("threads.go must persist the thread delete operation before replay")
	}
	operationSource := readRepoFile(t, root, filepath.Join("internal", "ai", "thread_delete_operation.go"))
	for _, marker := range []string{"ConfirmThreadDeleteFilesCleaned", "ConfirmThreadDeleteFloretDeleted", "ConfirmThreadDeleteReadStateDeleted"} {
		if !strings.Contains(operationSource, marker) {
			t.Fatalf("thread delete replay missing persistent step %q", marker)
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
		"open" + "FloretMaintenanceHost",
		"settlePendingToolWith" + "ActiveRedevenRun",
		"runForFloret" + "Settlement",
	} {
		if strings.Contains(content, marker) {
			t.Fatalf("terminal_process_service.go must hand pending settlements to the Floret integration gateway instead of retaining marker %q", marker)
		}
	}
}

func TestFlowerDoesNotPersistOrRebuildFloretToolState(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	productionRoots := []string{
		filepath.Join(root, "internal", "ai"),
		filepath.Join(root, "internal", "codeapp", "appserver"),
		filepath.Join(root, "cmd", "ai-loop-eval"),
	}
	forbidden := []string{
		"ToolCall" + "Record",
		"ExecutionSpan" + "Record",
		"Upsert" + "ToolCall",
		"Get" + "ToolCall",
		"List" + "ToolCalls",
		"Append" + "ExecutionSpan",
		"List" + "ExecutionSpans",
		"GetTerminal" + "ToolOutput",
		"GetTool" + "Detail",
		"ToolCall" + "Ledger",
		"CompletedAction" + "Facts",
		"BlockedAction" + "Facts",
		"BlockedEvidence" + "Refs",
		"\"tool.call\"",
		"\"tool.result\"",
		"\"tool.error\"",
		"\"floret.tool.lifecycle\"",
		"\"delegation.child.event\"",
	}
	for _, scanRoot := range productionRoots {
		err := filepath.WalkDir(scanRoot, func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() {
				return nil
			}
			if filepath.Ext(path) != ".go" || strings.HasSuffix(path, "_test.go") {
				return nil
			}
			if path == filepath.Join(root, "internal", "ai", "threadstore", "schema.go") {
				return nil
			}
			content, readErr := os.ReadFile(path)
			if readErr != nil {
				return readErr
			}
			for _, marker := range forbidden {
				if strings.Contains(string(content), marker) {
					rel, _ := filepath.Rel(root, path)
					t.Fatalf("%s must not retain Floret tool-state mirror marker %q", rel, marker)
				}
			}
			return nil
		})
		if err != nil {
			t.Fatalf("scan %s: %v", scanRoot, err)
		}
	}

	serverSource := readRepoFile(t, root, "internal", "codeapp", "appserver", "server.go")
	for _, marker := range []string{
		"ai_terminal_" + "output",
		"ai_tool_" + "detail",
		"meta_" + "only",
	} {
		if strings.Contains(serverSource, marker) {
			t.Fatalf("AppServer must not retain removed tool-state API marker %q", marker)
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
