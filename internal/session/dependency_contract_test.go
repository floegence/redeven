package session

import (
	"bufio"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
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

	if !strings.Contains(goMod, "github.com/floegence/flowersec/flowersec-go v0.27.0") {
		t.Fatalf("go.mod must depend on flowersec-go v0.27.0")
	}
	if strings.Contains(goMod, "\nreplace ") || strings.Contains(goMod, "\nreplace(") {
		t.Fatalf("go.mod must not use replace directives")
	}
	if strings.Contains(goMod, "../flowersec") || strings.Contains(goMod, "file:") || strings.Contains(goMod, "link:") {
		t.Fatalf("go.mod must not reference local flowersec checkouts")
	}

	if !strings.Contains(goSum, "github.com/floegence/flowersec/flowersec-go v0.27.0 ") {
		t.Fatalf("go.sum must include flowersec-go v0.27.0 module checksum")
	}
	if !strings.Contains(goSum, "github.com/floegence/flowersec/flowersec-go v0.27.0/go.mod ") {
		t.Fatalf("go.sum must include flowersec-go v0.27.0 go.mod checksum")
	}

	if !strings.Contains(notices, "github.com/floegence/flowersec/flowersec-go | v0.27.0") {
		t.Fatalf("THIRD_PARTY_NOTICES.md must list flowersec-go v0.27.0")
	}
	if !strings.Contains(notices, "flowersec-go@v0.27.0") {
		t.Fatalf("THIRD_PARTY_NOTICES.md must link to flowersec-go@v0.27.0")
	}
	if !strings.Contains(notices, "@floegence/flowersec-core | 0.27.0") {
		t.Fatalf("THIRD_PARTY_NOTICES.md must list @floegence/flowersec-core 0.27.0")
	}
	if strings.Contains(notices, "flowersec-core | 0.19.7") {
		t.Fatalf("THIRD_PARTY_NOTICES.md must not retain @floegence/flowersec-core 0.19.7")
	}
	previousReleaseMarkers := map[string][]string{
		"go.mod": {
			"github.com/floegence/flowersec/flowersec-go v0.26.0",
			"github.com/floegence/flowersec/flowersec-go v0.19.11",
			"github.com/floegence/flowersec/flowersec-go v0.20.0",
			"github.com/floegence/flowersec/flowersec-go v0.21.1",
			"github.com/floegence/flowersec/flowersec-go v0.22.1",
			"github.com/floegence/flowersec/flowersec-go v0.23.0",
			"github.com/floegence/flowersec/flowersec-go v0.25.0",
		},
		"go.sum": {
			"github.com/floegence/flowersec/flowersec-go v0.26.0 ",
			"github.com/floegence/flowersec/flowersec-go v0.19.11 ",
			"github.com/floegence/flowersec/flowersec-go v0.20.0 ",
			"github.com/floegence/flowersec/flowersec-go v0.21.1 ",
			"github.com/floegence/flowersec/flowersec-go v0.22.1 ",
			"github.com/floegence/flowersec/flowersec-go v0.23.0 ",
			"github.com/floegence/flowersec/flowersec-go v0.25.0 ",
		},
		"THIRD_PARTY_NOTICES.md": {
			"github.com/floegence/flowersec/flowersec-go | v0.26.0",
			"@floegence/flowersec-core | 0.26.0",
			"github.com/floegence/flowersec/flowersec-go | v0.19.11",
			"@floegence/flowersec-core | 0.19.11",
			"github.com/floegence/flowersec/flowersec-go | v0.20.0",
			"@floegence/flowersec-core | 0.20.0",
			"github.com/floegence/flowersec/flowersec-go | v0.21.1",
			"@floegence/flowersec-core | 0.21.1",
			"github.com/floegence/flowersec/flowersec-go | v0.22.1",
			"@floegence/flowersec-core | 0.22.1",
			"github.com/floegence/flowersec/flowersec-go | v0.23.0",
			"@floegence/flowersec-core | 0.23.0",
			"github.com/floegence/flowersec/flowersec-go | v0.25.0",
			"@floegence/flowersec-core | 0.25.0",
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
			"\"@floegence/floe-webapp-core\": \"^0.39.3\"",
		},
		"desktop/package-lock.json": {
			"floe-webapp-core-0.39.3.tgz",
		},
		"desktop/pnpm-lock.yaml": {
			"@floegence/floe-webapp-core@0.39.3",
		},
		"internal/envapp/ui_src/package.json": {
			"\"@floegence/floe-webapp-boot\": \"^0.39.3\"",
			"\"@floegence/floe-webapp-core\": \"0.39.6\"",
			"\"@floegence/floe-webapp-protocol\": \"^0.39.3\"",
			"\"@floegence/floeterm-terminal-web\": \"0.8.0\"",
			"\"@floegence/flowersec-core\": \"^0.27.0\"",
		},
		"internal/envapp/ui_src/package-lock.json": {
			"floe-webapp-boot-0.39.3.tgz",
			"floe-webapp-core-0.39.6.tgz",
			"floe-webapp-protocol-0.39.3.tgz",
			"floeterm-terminal-web-0.8.0.tgz",
			"beamterm-renderer-1.0.1.tgz",
			"flowersec-core-0.27.0.tgz",
		},
		"internal/envapp/ui_src/pnpm-lock.yaml": {
			"@floegence/floe-webapp-boot@0.39.3",
			"@floegence/floe-webapp-core@0.39.6",
			"@floegence/floe-webapp-protocol@0.39.3",
			"@floegence/floeterm-terminal-web@0.8.0",
			"@floegence/beamterm-renderer@1.0.1",
			"@floegence/flowersec-core@0.27.0",
		},
		"internal/codeapp/ui_src/package.json": {
			"\"@floegence/flowersec-core\": \"^0.27.0\"",
		},
		"internal/codeapp/ui_src/package-lock.json": {
			"flowersec-core-0.27.0.tgz",
		},
		"THIRD_PARTY_NOTICES.md": {
			"@floegence/floe-webapp-boot | 0.39.3",
			"@floegence/floe-webapp-core | 0.39.3",
			"@floegence/floe-webapp-core | 0.39.6",
			"@floegence/floe-webapp-protocol | 0.39.3",
			"@floegence/floeterm-terminal-web | 0.8.0",
			"@floegence/beamterm-renderer | 1.0.1",
			"@floegence/flowersec-core | 0.27.0",
		},
		"okf/architecture/runtime-transport-dependencies.md": {
			"terminal-go v0.6.3",
			"Flowersec Go v0.27.0",
			"Flowersec Core v0.27.0",
		},
		"okf/architecture/env-app-upstream-web-dependencies.md": {
			"terminal-web v0.8.0",
			"beamterm-renderer` v1.0.1",
			"Floe Webapp Core v0.39.6",
			"Flowersec Core v0.27.0",
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
			"\"@floegence/floe-webapp-boot\": \"^0.39.2\"",
			"\"@floegence/floe-webapp-core\": \"^0.39.2\"",
			"\"@floegence/floe-webapp-protocol\": \"^0.39.2\"",
			"@floegence/floe-webapp-boot@0.39.2",
			"@floegence/floe-webapp-core@0.39.2",
			"@floegence/floe-webapp-protocol@0.39.2",
			"floe-webapp-boot-0.39.2.tgz",
			"floe-webapp-core-0.39.2.tgz",
			"floe-webapp-protocol-0.39.2.tgz",
			"@floegence/floe-webapp-boot | 0.39.2",
			"@floegence/floe-webapp-core | 0.39.2",
			"@floegence/floe-webapp-protocol | 0.39.2",
			"Floe Webapp v0.39.2",
			"\"@floegence/floe-webapp-core\": \"^0.39.4\"",
			"@floegence/floe-webapp-core@0.39.4",
			"floe-webapp-core-0.39.4.tgz",
			"@floegence/floe-webapp-core | 0.39.4",
			"Floe Webapp Core v0.39.4",
			"@floegence/floe-webapp-boot@0.39.0",
			"@floegence/floe-webapp-core@0.39.0",
			"@floegence/floe-webapp-protocol@0.39.0",
			"floe-webapp-boot-0.39.0.tgz",
			"floe-webapp-core-0.39.0.tgz",
			"floe-webapp-protocol-0.39.0.tgz",
			"@floegence/floe-webapp-boot | 0.39.0",
			"@floegence/floe-webapp-core | 0.39.0",
			"@floegence/floe-webapp-protocol | 0.39.0",
			"Floe Webapp v0.39.0",
			"@floegence/floe-webapp-boot@0.38.0",
			"@floegence/floe-webapp-core@0.38.0",
			"@floegence/floe-webapp-protocol@0.38.0",
			"floe-webapp-boot-0.38.0.tgz",
			"floe-webapp-core-0.38.0.tgz",
			"floe-webapp-protocol-0.38.0.tgz",
			"@floegence/floe-webapp-boot | 0.38.0",
			"@floegence/floe-webapp-core | 0.38.0",
			"@floegence/floe-webapp-protocol | 0.38.0",
			"Floe Webapp v0.38.0",
			"@floegence/floe-webapp-boot@0.37.4",
			"@floegence/floe-webapp-core@0.37.4",
			"@floegence/floe-webapp-protocol@0.37.4",
			"floe-webapp-boot-0.37.4.tgz",
			"floe-webapp-core-0.37.4.tgz",
			"floe-webapp-protocol-0.37.4.tgz",
			"@floegence/floe-webapp-boot | 0.37.4",
			"@floegence/floe-webapp-core | 0.37.4",
			"@floegence/floe-webapp-protocol | 0.37.4",
			"Floe Webapp v0.37.4",
			"@floegence/flowersec-core@0.26.0",
			"flowersec-core-0.26.0.tgz",
			"@floegence/flowersec-core | 0.26.0",
			"Flowersec Core v0.26.0",
			"@floegence/floe-webapp-boot@0.37.3",
			"@floegence/floe-webapp-core@0.37.3",
			"@floegence/floe-webapp-protocol@0.37.3",
			"floe-webapp-boot-0.37.3.tgz",
			"floe-webapp-core-0.37.3.tgz",
			"floe-webapp-protocol-0.37.3.tgz",
			"@floegence/floe-webapp-boot | 0.37.3",
			"@floegence/floe-webapp-core | 0.37.3",
			"@floegence/floe-webapp-protocol | 0.37.3",
			"@floegence/floeterm-terminal-web@0.5.24",
			"floeterm-terminal-web-0.5.24.tgz",
			"@floegence/floeterm-terminal-web | 0.5.24",
			"terminal-web v0.5.24",
			"@floegence/floeterm-terminal-web@0.6.0",
			"floeterm-terminal-web-0.6.0.tgz",
			"@floegence/floeterm-terminal-web | 0.6.0",
			"terminal-web v0.6.0",
			"@floegence/flowersec-core@0.25.0",
			"flowersec-core-0.25.0.tgz",
			"@floegence/flowersec-core | 0.25.0",
			"Floe Webapp v0.37.3",
			"Flowersec Core v0.25.0",
			"@floegence/floe-webapp-boot@0.37.0",
			"@floegence/floe-webapp-core@0.37.0",
			"@floegence/floe-webapp-protocol@0.37.0",
			"floe-webapp-boot-0.37.0.tgz",
			"floe-webapp-core-0.37.0.tgz",
			"floe-webapp-protocol-0.37.0.tgz",
			"@floegence/floe-webapp-boot | 0.37.0",
			"@floegence/floe-webapp-core | 0.37.0",
			"@floegence/floe-webapp-protocol | 0.37.0",
			"@floegence/floe-webapp-boot@0.37.2",
			"@floegence/floe-webapp-core@0.37.2",
			"@floegence/floe-webapp-protocol@0.37.2",
			"floe-webapp-boot-0.37.2.tgz",
			"floe-webapp-core-0.37.2.tgz",
			"floe-webapp-protocol-0.37.2.tgz",
			"@floegence/floe-webapp-boot | 0.37.2",
			"@floegence/floe-webapp-core | 0.37.2",
			"@floegence/floe-webapp-protocol | 0.37.2",
			"@floegence/flowersec-core@0.20.0",
			"flowersec-core-0.20.0.tgz",
			"@floegence/flowersec-core | 0.20.0",
			"@floegence/flowersec-core@0.21.1",
			"flowersec-core-0.21.1.tgz",
			"@floegence/flowersec-core | 0.21.1",
			"@floegence/flowersec-core@0.22.1",
			"flowersec-core-0.22.1.tgz",
			"@floegence/flowersec-core | 0.22.1",
			"@floegence/flowersec-core@0.23.0",
			"flowersec-core-0.23.0.tgz",
			"@floegence/flowersec-core | 0.23.0",
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

	for _, relDir := range []string{
		filepath.Join("internal", "envapp", "ui_src", "src"),
		filepath.Join("internal", "codeapp", "ui_src", "src"),
		filepath.Join("desktop", "src"),
	} {
		err := filepath.WalkDir(filepath.Join(root, relDir), func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() {
				return nil
			}
			switch filepath.Ext(path) {
			case ".js", ".mjs", ".ts", ".tsx":
			default:
				return nil
			}
			content, readErr := os.ReadFile(path)
			if readErr != nil {
				return readErr
			}
			for _, marker := range []string{
				"request" + "ChannelGrant",
				"request" + "EntryChannelGrant",
				"@floegence/flowersec-core/" + "internal",
			} {
				if strings.Contains(string(content), marker) {
					rel, _ := filepath.Rel(root, path)
					t.Fatalf("%s must not retain removed Flowersec API marker %q", rel, marker)
				}
			}
			return nil
		})
		if err != nil {
			t.Fatalf("scan %s: %v", relDir, err)
		}
	}
}

func TestFloretDependencyUsesPublishedRelease(t *testing.T) {
	t.Parallel()

	const (
		floretModule  = "github.com/floegence/floret"
		floretVersion = "v0.23.0"
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
			"RunTurnRequest.SupplementalContext",
			"TurnInput.References",
			"MessageReference",
			"raw `ResourceRef` never reaches the browser",
			"v0.23.0",
		},
		filepath.Join("okf", "ui", "flower-turn-launcher.md"): {
			"file_path",
			"metadata-only",
			"pending text attachment",
		},
		filepath.Join("okf", "ai", "ai-tool-runtime.md"): {
			"RunTurnRequest.SupplementalContext",
			"TurnSupplementalContextItem",
			"TurnInput.Attachments",
			"ResourceRef",
		},
		filepath.Join("okf", "ui", "flower-live-timeline.md"): {
			"ThroughOrdinal",
			"ListThreadTurns",
			"turn_projection_unavailable",
			"floret.contract.rejected",
		},
		filepath.Join("okf", "ai", "flower-thread-fork-coordination.md"): {
			"ai_thread_fork_operations",
			"snapshot schema v3",
			"ForkOperationID",
			"complete immutable snapshot",
		},
		filepath.Join("internal", "runtimeservice", "compatibility_contract.json"): {
			"Floret v0.23.0",
			"single persistent source of truth",
			"provider-owned thread titles",
			"public contracts",
			"parent-scoped SubAgent validation",
			"turn_projection_unavailable",
			"Thread deletion persists an immutable user-intent and upload cleanup snapshot",
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

func TestFloretCapabilitiesAreMintedOnlyDuringBootstrap(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	service := readRepoFile(t, root, filepath.Join("internal", "ai", "service.go"))
	for _, marker := range []string{
		"flconfig." + "ProviderFake",
		"Fake" + "Response",
		"flruntime." + "OpenSQLiteStore",
		"flruntime." + "ConfigureHostCapabilities",
		"flruntime." + "NewTurnExecutionHostBinder",
		"flruntime." + "NewSubAgentHostBinder",
		"flruntime." + "NewThreadCreateHostBinder",
		"flruntime." + "NewThreadDeleteHostBinder",
	} {
		if strings.Contains(service, marker) {
			t.Fatalf("service.go must not mint Floret runtime capabilities directly, found %q", marker)
		}
	}
	bootstrap := readRepoFile(t, root, filepath.Join("internal", "ai", "floret_bootstrap.go"))
	for _, marker := range []string{
		"flruntime." + "OpenSQLiteStore",
		"flruntime." + "ConfigureHostCapabilities",
		"flruntime." + "NewTurnExecutionHostBinder",
		"flruntime." + "NewThreadCompactionHostBinder",
		"flruntime." + "NewSubAgentHostBinder",
		"flruntime." + "NewSubAgentReadHostBinder",
		"flruntime." + "NewPendingToolRecoveryHostBinder",
		"flruntime." + "NewInterruptedTurnRecoveryHostBinder",
		"flruntime." + "NewThreadReadHostBinder",
		"flruntime." + "NewThreadCreateHostBinder",
		"flruntime." + "NewThreadTitleHostBinder",
		"flruntime." + "NewThreadForkHostBinder",
		"flruntime." + "NewThreadDeleteHostBinder",
	} {
		if !strings.Contains(bootstrap, marker) {
			t.Fatalf("floret_bootstrap.go is missing capability constructor %q", marker)
		}
	}
}

func TestFloretActiveSettlementHasNoRecoveryFallback(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	runSource := readRepoFile(t, root, filepath.Join("internal", "ai", "run.go"))
	for _, forbidden := range []string{"opts.PendingToolSettler", "floretPendingSettlementHost", "PendingToolRecoveryHostFactory"} {
		if strings.Contains(runSource, forbidden) {
			t.Fatalf("run.go must not receive recovery settlement authority, found %q", forbidden)
		}
	}
	bootstrap := readRepoFile(t, root, filepath.Join("internal", "ai", "floret_bootstrap.go"))
	for _, required := range []string{"floretTurnHostAdapter) SettlePendingTool", "floretSubagentHostAdapter) SettlePendingTool"} {
		if !strings.Contains(bootstrap, required) {
			t.Fatalf("floret_bootstrap.go must derive active settlement capability with %q", required)
		}
	}
	if !strings.Contains(bootstrap, "newFloretPendingToolRecoveryCoordinator") {
		t.Fatal("floret_bootstrap.go must construct recovery settlement only through the explicit coordinator")
	}
	recoverySource := readRepoFile(t, root, filepath.Join("internal", "ai", "floret_pending_tool_recovery.go"))
	if strings.Contains(recoverySource, "PendingToolRecoveryHostBinder") || strings.Contains(recoverySource, "github.com/floegence/floret/runtime") {
		t.Fatal("Floret recovery interface must not retain concrete runtime capability types")
	}
	if !strings.Contains(bootstrap, "NewPendingToolRecoveryHostBinder") || !strings.Contains(bootstrap, "boundFloretPendingToolRecoveryCoordinator") {
		t.Fatal("Floret recovery binder must be minted and encapsulated inside the composition root")
	}
	runHost := readRepoFile(t, root, filepath.Join("internal", "ai", "run_host_capabilities.go"))
	if strings.Contains(runSource, "*Service") || strings.Contains(runSource, "service *Service") || strings.Contains(runHost, "floretBootstrapResult") {
		t.Fatal("run capability objects must not retain Service or Floret capability binders")
	}
	serviceSource := readRepoFile(t, root, filepath.Join("internal", "ai", "service.go"))
	if strings.Contains(serviceSource, "*floretBootstrapResult") {
		t.Fatal("Service must not retain the aggregate Floret bootstrap capability result")
	}
	for _, forbidden := range []string{"newFloretThreadCreate", "newFloretThreadDelete", "newFloretThreadFork", "newFloretThreadTitle", "InterruptedTurnRecovery"} {
		if strings.Contains(runHost, forbidden) {
			t.Fatalf("run capability object retained lifecycle capability %q", forbidden)
		}
	}
	if strings.Contains(runHost, "forSubagentExecution") || strings.Contains(runHost, "childHost := host") {
		t.Fatal("child execution must not copy the root capability bundle")
	}
	for _, forbidden := range []string{"floretPendingToolRecoveryFactory", ".Bind(", "RecoverySettlementOwner"} {
		if strings.Contains(runHost, forbidden) {
			t.Fatalf("active run host must not retain a recovery settlement issuer, found %q", forbidden)
		}
	}
	terminalProcess := readRepoFile(t, root, filepath.Join("internal", "ai", "terminal_process.go"))
	for _, forbidden := range []string{"floretPendingToolRecoveryFactory", "RecoverySettlementOwner"} {
		if strings.Contains(terminalProcess, forbidden) {
			t.Fatalf("terminal process must not retain a recovery settlement issuer, found %q", forbidden)
		}
	}
	for _, required := range []string{"RecoveryCoordinator", "RecoveryAuthorityThreadID", "terminal process authority barrier is required"} {
		if !strings.Contains(terminalProcess, required) {
			t.Fatalf("terminal process is missing post-terminal recovery contract %q", required)
		}
	}
	if !strings.Contains(serviceSource, "func (s *Service) bindSubagentExecutionForParent") ||
		!strings.Contains(serviceSource, "s.bindExactRunExecutionCapabilities(parent.endpointID, childThreadID, parent.threadID)") ||
		!strings.Contains(serviceSource, "bindChildRunProductCapabilities(s.threadsDB, parent.endpointID, parent.threadID, childThreadID, childRunID)") {
		t.Fatal("child execution must be constructed from exact child and parent authority identities")
	}
}

func TestFloretCanonicalThreadCreationIsCreateCoordinatorOnly(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	aiRoot := filepath.Join(root, "internal", "ai")
	allowedCreateRequest := filepath.Join(aiRoot, "thread_create_operation.go")
	allowedCreateInterface := filepath.Join(aiRoot, "floret_contracts.go")
	allowedCreateAdapter := filepath.Join(aiRoot, "floret_bootstrap.go")
	allowedCreateOpener := filepath.Join(aiRoot, "service.go")
	err := filepath.WalkDir(aiRoot, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || filepath.Ext(path) != ".go" || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		content := string(body)
		if strings.Contains(content, "Ensure"+"Thread") || strings.Contains(content, "Ensure"+"ThreadRequest") ||
			strings.Contains(content, "floret_"+"ensured") || strings.Contains(content, "Floret"+"Ensured") {
			t.Fatalf("%s reintroduces implicit canonical thread recovery", path)
		}
		parsed, err := parser.ParseFile(token.NewFileSet(), path, body, 0)
		if err != nil {
			return err
		}
		floretRuntimeAliases := map[string]struct{}{}
		for _, spec := range parsed.Imports {
			importPath, err := strconv.Unquote(spec.Path.Value)
			if err != nil {
				return err
			}
			if importPath != "github.com/floegence/floret/runtime" {
				continue
			}
			alias := "runtime"
			if spec.Name != nil {
				alias = spec.Name.Name
			}
			if alias == "." || alias == "_" {
				t.Fatalf("%s uses unsupported Floret runtime import alias %q", path, alias)
			}
			floretRuntimeAliases[alias] = struct{}{}
		}
		ast.Inspect(parsed, func(node ast.Node) bool {
			selector, ok := node.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			ident, ok := selector.X.(*ast.Ident)
			if !ok {
				return true
			}
			if _, ok := floretRuntimeAliases[ident.Name]; !ok {
				return true
			}
			switch selector.Sel.Name {
			case "StartThreadRequest":
				t.Fatalf("%s reintroduces the removed Floret StartThread creation path", path)
			case "CreateThreadRequest":
				if path != allowedCreateRequest && path != allowedCreateInterface && path != allowedCreateAdapter {
					t.Fatalf("%s holds canonical thread creation request outside the create coordinator", path)
				}
			}
			return true
		})
		if strings.Contains(content, "new"+"FloretMaintenanceHost(") && path != allowedCreateOpener {
			t.Fatalf("%s constructs a full Floret maintenance host outside service.go", path)
		}
		if strings.Contains(content, "open"+"FloretThreadCreateHost") && path != allowedCreateRequest && path != allowedCreateOpener {
			t.Fatalf("%s opens canonical thread creation capability outside the create coordinator", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
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
		if strings.HasSuffix(rel, "compact_thread_context.go") {
			if strings.Contains(content, "ThreadTitleMode:") {
				t.Fatalf("%s must not receive title authority through the compaction capability", rel)
			}
		} else if !strings.Contains(content, "ThreadTitleMode:") || !strings.Contains(content, "flruntime.ThreadTitleModeProvider") {
			t.Fatalf("%s must delegate provider title ownership to Floret", rel)
		}
	}
}

func TestFloretLifecycleEventsDoNotMirrorEngineState(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	content := readRepoFile(t, root, filepath.Join("internal", "ai", "floret_events.go"))
	for _, marker := range []string{
		"floretEvent" + "MetadataString",
		"floretEventMetadataString(ev.Metadata, \"completion_reason\")",
		"floretEventMetadataString(ev.Metadata, \"continuation_reason\")",
		"floret.step.end",
		"floret.run.end",
		"floret.context.compact",
		"floret.context.continue",
	} {
		if strings.Contains(content, marker) {
			t.Fatalf("floret_events.go must not mirror Floret engine lifecycle marker %q", marker)
		}
	}
	for _, marker := range []string{"ev.FinishReason", "ev.RawFinishReason", "ev.FinishInferred"} {
		if !strings.Contains(content, marker) {
			t.Fatalf("floret_events.go missing typed provider diagnostic field %q", marker)
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

func TestFloretSubagentDetailUsesParentBoundReadHost(t *testing.T) {
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
	if !strings.Contains(content, "open"+"FloretSubagentReadHost") {
		t.Fatalf("subagents_floret.go must use a parent-bound Floret read host for detached subagent detail reads")
	}
}

func TestFloretOKFAndContractsAvoidRemovedLifecycleFacades(t *testing.T) {
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

func TestFloretLegacyThreadTranscriptAPIsAreNotUsedInProduction(t *testing.T) {
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
		for _, marker := range []string{"flruntime." + "ThreadMessage"} {
			if strings.Contains(content, marker) {
				rel, _ := filepath.Rel(root, path)
				t.Fatalf("%s must not use Floret transcript API marker %q", rel, marker)
			}
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
	canonicalMigrationPath := filepath.Join(root, "internal", "ai", "threadstore", "canonical_migrations.go")
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
		// The explicit v15-v40 migration contract must identify and delete the
		// historical marker; current runtime and product schema code must not.
		if path == canonicalMigrationPath {
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
