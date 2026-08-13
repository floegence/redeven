package session

import (
	"bufio"
	"encoding/json"
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	redevplugincontracts "github.com/floegence/redevplugin/pkg/contracts"
	"golang.org/x/mod/modfile"
	"gopkg.in/yaml.v3"
)

const (
	flowersecGoModule    = "github.com/floegence/flowersec/flowersec-go/v2"
	flowersecGoVersion   = "v2.3.9"
	flowersecCorePackage = "@floegence/flowersec-core"
	flowersecCoreVersion = "2.3.9"
)

func TestDesktopPnpmPeerInstallSettingMatchesLockfile(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	var workspace struct {
		AutoInstallPeers *bool `yaml:"autoInstallPeers"`
	}
	if err := yaml.Unmarshal([]byte(readRepoFile(t, root, "desktop", "pnpm-workspace.yaml")), &workspace); err != nil {
		t.Fatalf("parse desktop pnpm workspace: %v", err)
	}
	var lock struct {
		Settings struct {
			AutoInstallPeers *bool `yaml:"autoInstallPeers"`
		} `yaml:"settings"`
	}
	if err := yaml.Unmarshal([]byte(readRepoFile(t, root, "desktop", "pnpm-lock.yaml")), &lock); err != nil {
		t.Fatalf("parse desktop pnpm lockfile: %v", err)
	}
	if workspace.AutoInstallPeers == nil {
		t.Fatal("desktop/pnpm-workspace.yaml must explicitly set autoInstallPeers")
	}
	if lock.Settings.AutoInstallPeers == nil {
		t.Fatal("desktop/pnpm-lock.yaml must explicitly record settings.autoInstallPeers")
	}
	if *workspace.AutoInstallPeers != *lock.Settings.AutoInstallPeers {
		t.Fatalf(
			"desktop pnpm autoInstallPeers mismatch: workspace=%t lockfile=%t",
			*workspace.AutoInstallPeers,
			*lock.Settings.AutoInstallPeers,
		)
	}
}

func TestDesktopPackageManifestHasOneOverrideMap(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	content := readRepoFile(t, root, "desktop", "package.json")
	if got := strings.Count(content, "\n  \"overrides\": {"); got != 1 {
		t.Fatalf("desktop/package.json top-level overrides maps = %d, want 1", got)
	}
}

func TestFlowersecDependencyUsesPublishedRelease(t *testing.T) {
	t.Parallel()

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
		if requirement.Mod.Path == flowersecGoModule {
			requiredVersions = append(requiredVersions, requirement.Mod.Version)
		}
	}
	if len(requiredVersions) != 1 || requiredVersions[0] != flowersecGoVersion {
		t.Fatalf("go.mod Flowersec requirements=%v, want only %s", requiredVersions, flowersecGoVersion)
	}
	assertNoLocalGoModuleReference(t, "go.mod", goMod, flowersecGoModule, "flowersec")

	wantSumVersions := map[string]bool{
		flowersecGoVersion:             true,
		flowersecGoVersion + "/go.mod": true,
	}
	foundSumVersions := make(map[string]bool, len(wantSumVersions))
	scanner := bufio.NewScanner(strings.NewReader(goSum))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 || fields[0] != flowersecGoModule {
			continue
		}
		if !wantSumVersions[fields[1]] {
			t.Fatalf("go.sum contains unexpected Flowersec version %q", fields[1])
		}
		if len(fields) != 3 || !strings.HasPrefix(fields[2], "h1:") {
			t.Fatalf("go.sum has invalid Flowersec checksum entry %q", scanner.Text())
		}
		foundSumVersions[fields[1]] = true
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scan go.sum: %v", err)
	}
	for version := range wantSumVersions {
		if !foundSumVersions[version] {
			t.Fatalf("go.sum is missing Flowersec checksum for %s", version)
		}
	}
	assertNoLocalGoModuleReference(t, "go.sum", goSum, flowersecGoModule, "flowersec")
	assertOnlyCurrentFlowersecGoImports(t, root)
	assertNoticeDependency(t, notices, flowersecGoModule, flowersecGoVersion, "https://pkg.go.dev/"+flowersecGoModule+"@"+flowersecGoVersion)
	assertNoticeDependency(t, notices, flowersecCorePackage, flowersecCoreVersion, "https://www.npmjs.com/package/%40floegence%2Fflowersec-core/v/"+flowersecCoreVersion)
}

func TestReDevPluginDependenciesMatchPublishedPackageSet(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	packageSet := redevplugincontracts.PackageSet()
	parsedMod, err := modfile.Parse("go.mod", []byte(readRepoFile(t, root, "go.mod")), nil)
	if err != nil {
		t.Fatalf("parse go.mod: %v", err)
	}
	var goVersions []string
	for _, requirement := range parsedMod.Require {
		if requirement.Mod.Path == packageSet.GoModule.Module {
			goVersions = append(goVersions, requirement.Mod.Version)
		}
	}
	if len(goVersions) != 1 || goVersions[0] != packageSet.GoModule.Version {
		t.Fatalf("ReDevPlugin Go coordinate = %v, want %s", goVersions, packageSet.GoModule.Version)
	}

	type packageManifest struct {
		Dependencies map[string]string `json:"dependencies"`
	}
	var manifest packageManifest
	if err := json.Unmarshal([]byte(readRepoFile(t, root, "internal/envapp/ui_src/package.json")), &manifest); err != nil {
		t.Fatalf("parse Env App package.json: %v", err)
	}
	var npmLock struct {
		Packages map[string]struct {
			Version      string            `json:"version"`
			Dependencies map[string]string `json:"dependencies"`
		} `json:"packages"`
	}
	if err := json.Unmarshal([]byte(readRepoFile(t, root, "internal/envapp/ui_src/package-lock.json")), &npmLock); err != nil {
		t.Fatalf("parse Env App package-lock.json: %v", err)
	}
	var pnpmLock struct {
		Importers map[string]struct {
			Dependencies map[string]struct {
				Specifier string `yaml:"specifier"`
				Version   string `yaml:"version"`
			} `yaml:"dependencies"`
		} `yaml:"importers"`
		Packages  map[string]any `yaml:"packages"`
		Snapshots map[string]struct {
			Dependencies map[string]string `yaml:"dependencies"`
		} `yaml:"snapshots"`
	}
	if err := yaml.Unmarshal([]byte(readRepoFile(t, root, "internal/envapp/ui_src/pnpm-lock.yaml")), &pnpmLock); err != nil {
		t.Fatalf("parse Env App pnpm-lock.yaml: %v", err)
	}
	rootImporter, ok := pnpmLock.Importers["."]
	if !ok {
		t.Fatal("Env App pnpm lock is missing the root importer")
	}
	notices := readRepoFile(t, root, "THIRD_PARTY_NOTICES.md")
	npmVersions := make(map[string]string, len(packageSet.NPMPackages))
	for _, coordinate := range packageSet.NPMPackages {
		npmVersions[coordinate.Name] = coordinate.Version
		if got := manifest.Dependencies[coordinate.Name]; got != coordinate.Version {
			t.Fatalf("Env App package.json %s = %q, want %q", coordinate.Name, got, coordinate.Version)
		}
		if got := npmLock.Packages[""].Dependencies[coordinate.Name]; got != coordinate.Version {
			t.Fatalf("Env App npm root %s = %q, want %q", coordinate.Name, got, coordinate.Version)
		}
		installed, ok := npmLock.Packages["node_modules/"+coordinate.Name]
		if !ok || installed.Version != coordinate.Version {
			t.Fatalf("Env App npm lock %s = %q, want %q", coordinate.Name, installed.Version, coordinate.Version)
		}
		pnpmCoordinate, ok := rootImporter.Dependencies[coordinate.Name]
		if !ok || pnpmCoordinate.Specifier != coordinate.Version || pnpmCoordinate.Version != coordinate.Version {
			t.Fatalf("Env App pnpm importer %s = %+v, want %q", coordinate.Name, pnpmCoordinate, coordinate.Version)
		}
		pnpmKey := coordinate.Name + "@" + coordinate.Version
		if _, ok := pnpmLock.Packages[pnpmKey]; !ok {
			t.Fatalf("Env App pnpm lock is missing %s", pnpmKey)
		}
		if marker := coordinate.Name + " | " + coordinate.Version; !strings.Contains(notices, marker) {
			t.Fatalf("THIRD_PARTY_NOTICES.md is missing %q", marker)
		}
	}
	uiName := "@floegence/redevplugin-ui"
	contractsName := "@floegence/redevplugin-contracts"
	uiVersion := npmVersions[uiName]
	contractsVersion := npmVersions[contractsName]
	if got := npmLock.Packages["node_modules/"+uiName].Dependencies[contractsName]; got != contractsVersion {
		t.Fatalf("Env App npm UI contracts dependency = %q, want %q", got, contractsVersion)
	}
	if got := pnpmLock.Snapshots[uiName+"@"+uiVersion].Dependencies[contractsName]; got != contractsVersion {
		t.Fatalf("Env App pnpm UI contracts dependency = %q, want %q", got, contractsVersion)
	}
}

func TestFlowersecTransportPoliciesAreExplicit(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	agentSource := readRepoFile(t, root, "internal/agent/agent.go")
	for _, marker := range []string{
		"flowersec.NewConnectionController(&controlArtifactSource",
		"flowersec.Connect(ctx, lease, flowersec.ConnectorOptions{",
		"flowersec.ParseArtifact(grant.ArtifactJSON)",
		"flowersec.NewArtifactLease(artifact",
	} {
		if !strings.Contains(agentSource, marker) {
			t.Fatalf("internal/agent/agent.go must contain explicit remote transport policy %q", marker)
		}
	}
	for _, legacy := range []string{"fsclient.WithYamuxLimits", "endpoint.ConnectTunnel", "rpc.NewServerWithOptions", "OnNotify("} {
		if strings.Contains(agentSource, legacy) {
			t.Fatalf("internal/agent/agent.go must not retain legacy transport implementation %q", legacy)
		}
	}
	if strings.Contains(agentSource, "WithKeepaliveInterval") {
		t.Fatal("internal/agent/agent.go must not use the removed Flowersec keepalive API")
	}

	envAppSource := readRepoFile(t, root, "internal/envapp/ui_src/src/ui/EnvAppShell.tsx")
	for _, marker := range []string{
		"source: { acquire: acquireLocalDirectArtifact }",
		"source: { acquire: acquireRemoteArtifact }",
		"resolveLocalTransportSecurityPolicy(window.location.hostname)",
		"createProxyRuntimeTunnelConnectionConfig({",
	} {
		if !strings.Contains(envAppSource, marker) {
			t.Fatalf("EnvAppShell.tsx must contain explicit browser transport policy %q", marker)
		}
	}
	localTransportPolicySource := readRepoFile(t, root, "internal/envapp/ui_src/src/ui/security/localTransportSecurity.ts")
	for _, marker := range []string{
		"policy: true",
		"hostnameIsLoopback",
		"Flowersec plaintext direct sessions are restricted to canonical loopback hosts.",
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
	browserConfigSource := readRepoFile(t, root, "internal/envapp/ui_src/vitest.browser.config.ts")
	if strings.Contains(browserConfigSource, "@floegence/flowersec-core/streamio") {
		t.Fatal("vitest.browser.config.ts must not optimize the unavailable Flowersec streamio subpath")
	}

	dockerClientSource := readRepoFile(t, root, "tests/docker_runtime_e2e/testclient/main.go")
	for _, marker := range []string{
		"flowersec.ParseArtifact",
		"flowersec.NewArtifactLease",
		"flowersec.Connect",
	} {
		if !strings.Contains(dockerClientSource, marker) {
			t.Fatalf("Docker Local UI test client must contain explicit Flowersec policy marker %q", marker)
		}
	}

	localUISource := readRepoFile(t, root, "internal/localui/localui.go")
	for _, marker := range []string{"flowersec.NewAcceptor(", "controlplane.AuthorizeRuntime(", "flowersec.WebSocketDirectPath"} {
		if !strings.Contains(localUISource, marker) {
			t.Fatalf("Local UI direct server must use the Flowersec v2 Acceptor boundary %q", marker)
		}
	}
}

func TestFloeWebappDependenciesUsePublishedSecurityRelease(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	expectedPackages := map[string][]string{
		"desktop/package.json": {
			"\"@floegence/floe-webapp-core\": \"0.40.17\"",
		},
		"desktop/package-lock.json": {
			"floe-webapp-core-0.40.17.tgz",
		},
		"desktop/pnpm-lock.yaml": {
			"@floegence/floe-webapp-core@0.40.17",
		},
		"internal/envapp/ui_src/package.json": {
			"\"@floegence/floe-webapp-boot\": \"0.40.17\"",
			"\"@floegence/floe-webapp-core\": \"0.40.17\"",
			"\"@floegence/floe-webapp-protocol\": \"0.40.17\"",
			"\"@floegence/floeterm-terminal-web\": \"0.14.1\"",
			"\"@floegence/flowersec-core\": \"2.3.9\"",
		},
		"internal/envapp/ui_src/package-lock.json": {
			"floe-webapp-boot-0.40.17.tgz",
			"floe-webapp-core-0.40.17.tgz",
			"floe-webapp-protocol-0.40.17.tgz",
			"floeterm-terminal-web-0.14.1.tgz",
			"beamterm-renderer-1.0.2.tgz",
			"flowersec-core-2.3.9.tgz",
		},
		"internal/envapp/ui_src/pnpm-lock.yaml": {
			"@floegence/floe-webapp-boot@0.40.17",
			"@floegence/floe-webapp-core@0.40.17",
			"@floegence/floe-webapp-protocol@0.40.17",
			"@floegence/floeterm-terminal-web@0.14.1",
			"@floegence/beamterm-renderer@1.0.2",
			"@floegence/flowersec-core@2.3.9",
		},
		"internal/codeapp/ui_src/package.json": {
			"\"@floegence/flowersec-core\": \"2.3.9\"",
		},
		"internal/codeapp/ui_src/package-lock.json": {
			"flowersec-core-2.3.9.tgz",
		},
		"THIRD_PARTY_NOTICES.md": {
			"@floegence/floe-webapp-boot | 0.40.17",
			"@floegence/floe-webapp-core | 0.40.17",
			"@floegence/floe-webapp-protocol | 0.40.17",
			"@floegence/floeterm-terminal-web | 0.14.1",
			"@floegence/beamterm-renderer | 1.0.2",
			"@floegence/flowersec-core | 2.3.9",
		},
		"okf/architecture/runtime-transport-dependencies.md": {
			"terminal-go v0.8.7",
			"Flowersec Go v2.3.9",
			"Flowersec Core v2.3.9",
		},
		"okf/architecture/env-app-upstream-web-dependencies.md": {
			"terminal-web v0.14.1",
			"beamterm-renderer` v1.0.2",
			"Floe Webapp Core v0.40.17",
			"Flowersec Core v2.3.9",
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
			"flowersec-core-2.3.6.tgz",
			"@floegence/flowersec-core@2.3.6",
			"\"@floegence/flowersec-core\": \"2.3.6\"",
			"floe-webapp-boot-0.40.16.tgz",
			"floe-webapp-core-0.40.16.tgz",
			"floe-webapp-protocol-0.40.16.tgz",
			"@floegence/floe-webapp-boot@0.40.16",
			"@floegence/floe-webapp-core@0.40.16",
			"@floegence/floe-webapp-protocol@0.40.16",
			"\"@floegence/floeterm-terminal-web\": \"0.12.2\"",
			"@floegence/floeterm-terminal-web@0.12.2",
			"floeterm-terminal-web-0.12.2.tgz",
			"@floegence/floeterm-terminal-web | 0.12.2",
			"terminal-web v0.12.2",
			"@floegence/beamterm-renderer@1.0.1",
			"beamterm-renderer-1.0.1.tgz",
			"@floegence/beamterm-renderer | 1.0.1",
			"beamterm-renderer` v1.0.1",
			"\"@floegence/floe-webapp-boot\": \"0.40.0\"",
			"\"@floegence/floe-webapp-core\": \"0.40.0\"",
			"\"@floegence/floe-webapp-protocol\": \"0.40.0\"",
			"@floegence/floe-webapp-boot@0.40.0",
			"@floegence/floe-webapp-core@0.40.0",
			"@floegence/floe-webapp-protocol@0.40.0",
			"floe-webapp-boot-0.40.0.tgz",
			"floe-webapp-core-0.40.0.tgz",
			"floe-webapp-protocol-0.40.0.tgz",
			"@floegence/floe-webapp-boot | 0.40.0",
			"@floegence/floe-webapp-core | 0.40.0",
			"@floegence/floe-webapp-protocol | 0.40.0",
			"Floe Webapp Core v0.40.0",
			"\"@floegence/floe-webapp-boot\": \"0.39.10\"",
			"\"@floegence/floe-webapp-core\": \"0.39.10\"",
			"\"@floegence/floe-webapp-protocol\": \"0.39.10\"",
			"@floegence/floe-webapp-boot@0.39.10",
			"@floegence/floe-webapp-core@0.39.10",
			"@floegence/floe-webapp-protocol@0.39.10",
			"floe-webapp-boot-0.39.10.tgz",
			"floe-webapp-core-0.39.10.tgz",
			"floe-webapp-protocol-0.39.10.tgz",
			"@floegence/floe-webapp-boot | 0.39.10",
			"@floegence/floe-webapp-core | 0.39.10",
			"@floegence/floe-webapp-protocol | 0.39.10",
			"Floe Webapp Core v0.39.10",
			"\"@floegence/floe-webapp-core\": \"^0.39.3\"",
			"\"@floegence/floe-webapp-core\": \"0.39.3\"",
			"@floegence/floe-webapp-core@0.39.3",
			"floe-webapp-core-0.39.3.tgz",
			"@floegence/floe-webapp-core | 0.39.3",
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
			"\"@floegence/floeterm-terminal-web\": \"0.8.0\"",
			"@floegence/floeterm-terminal-web@0.8.0",
			"floeterm-terminal-web-0.8.0.tgz",
			"@floegence/floeterm-terminal-web | 0.8.0",
			"terminal-web v0.8.0",
			"\"@floegence/floeterm-terminal-web\": \"0.9.0\"",
			"@floegence/floeterm-terminal-web@0.9.0",
			"floeterm-terminal-web-0.9.0.tgz",
			"@floegence/floeterm-terminal-web | 0.9.0",
			"terminal-web v0.9.0",
			"Floe Webapp v0.37.3",
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
		} {
			if strings.Contains(content, previousMarker) {
				t.Fatalf("%s must not retain previous dependency marker %q", file, previousMarker)
			}
		}
		assertNoLocalNPMReference(t, file, content)
	}
	for _, file := range []string{
		"desktop/package.json",
		"desktop/package-lock.json",
		"desktop/pnpm-lock.yaml",
		"internal/envapp/ui_src/package.json",
		"internal/envapp/ui_src/package-lock.json",
		"internal/envapp/ui_src/pnpm-lock.yaml",
		"internal/codeapp/ui_src/package.json",
		"internal/codeapp/ui_src/package-lock.json",
		"internal/codeapp/ui_src/pnpm-lock.yaml",
	} {
		assertOnlyCurrentFlowersecNPMDependency(t, root, file)
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
				flowersecCorePackage + "/" + "client",
				flowersecCorePackage + "/" + "reconnect",
				flowersecCorePackage + "/" + "rpc",
				flowersecCorePackage + "/" + "stream",
				flowersecCorePackage + "/" + "protocolio",
				flowersecCorePackage + "/" + "controlplane",
				flowersecCorePackage + "/" + "observability",
				flowersecCorePackage + "/" + "endpoint",
				flowersecCorePackage + "/" + "origin",
				flowersecCorePackage + "/" + "gen",
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
		floretModule   = "github.com/floegence/floret/v3"
		floretVersion  = "v3.2.40"
		floretSum      = "h1:oVo5aK2QRB28tngY+cwTr/7Gt2MMMN2siqjAbT2VS8w="
		floretGoModSum = "h1:l9Z36ZEf/OHlHu+1hZeDp+WOT9TqWNgNQYOQi+eAWW0="
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

	wantSumVersions := map[string]string{
		floretVersion:             floretSum,
		floretVersion + "/go.mod": floretGoModSum,
	}
	foundSumVersions := make(map[string]bool, len(wantSumVersions))
	scanner := bufio.NewScanner(strings.NewReader(goSum))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 || fields[0] != floretModule {
			continue
		}
		wantSum, ok := wantSumVersions[fields[1]]
		if !ok {
			t.Fatalf("go.sum contains unexpected Floret version %q", fields[1])
		}
		if len(fields) != 3 || fields[2] != wantSum {
			t.Fatalf("go.sum checksum for %s=%v, want %s", fields[1], fields[2:], wantSum)
		}
		foundSumVersions[fields[1]] = true
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scan go.sum: %v", err)
	}
	for version := range wantSumVersions {
		if !foundSumVersions[version] {
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
			"TurnRequest.SupplementalContext",
			"TurnInput.References",
			"MessageReference",
			"raw `ResourceRef` never reaches the browser",
			"v3.2.40",
		},
		filepath.Join("okf", "ui", "flower-turn-launcher.md"): {
			"file_path",
			"metadata-only",
			"pending text attachment",
		},
		filepath.Join("okf", "ai", "ai-tool-runtime.md"): {
			"TurnRequest.SupplementalContext",
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
			"client_request_id",
			"canonical destination is empty at preparation time",
			"complete immutable snapshot",
		},
		filepath.Join("internal", "runtimeservice", "compatibility_contract.json"): {
			"Floret v3.2.40",
			"flowersec-v2-3-9-sdk-contracts",
			"ai_threadstore_product_v1",
			"Fresh stores initialize directly at version 1",
			"single persistent source of truth",
			"provider-owned thread titles",
			"public contracts",
			"parent-scoped SubAgent validation",
			"turn_projection_unavailable",
			"Thread deletion persists an immutable user-intent and upload cleanup snapshot",
			"only Floret's exact tombstone replay returns success",
			"a missing canonical thread without that tombstone fails terminally and preserves product data",
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
		"flruntime." + "Open",
		"*flruntime." + "Host",
	} {
		if strings.Contains(service, marker) {
			t.Fatalf("service.go must not mint Floret runtime capabilities directly, found %q", marker)
		}
	}
	maintenance := readRepoFile(t, root, filepath.Join("internal", "ai", "floret_store_maintenance.go"))
	for _, marker := range []string{"flstorage.SQLite", "type floretRuntimeOpener"} {
		if !strings.Contains(maintenance, marker) {
			t.Fatalf("floret_store_maintenance.go must open the current published storage contract with %q", marker)
		}
	}
	for _, marker := range []string{"PreflightV2Migration", "ApplyV2Migration", "ErrMigrationRequired"} {
		if strings.Contains(maintenance, marker) {
			t.Fatalf("floret_store_maintenance.go must not retain removed storage migration marker %q", marker)
		}
	}
	bootstrap := readRepoFile(t, root, filepath.Join("internal", "ai", "floret_bootstrap.go"))
	if !strings.Contains(bootstrap, "flruntime.Open") || !strings.Contains(bootstrap, "*flruntime.Host") {
		t.Fatal("floret_bootstrap.go must be the composition root that opens and consumes runtime.Host")
	}
	for _, marker := range []string{
		"host.Threads().CreateThread", "host.Thread(ctxOrBackground(ctx), threadID)",
		"thread.Reader()", "thread.Lifecycle()", "thread.TurnExecutor(agent)",
		"thread.Compactor(agent)", "thread.SubAgentManager(ctxOrBackground(ctx), agent)",
		"lifecycle.lifecycle.SetTitle", "lifecycle.lifecycle.Fork", "lifecycle.lifecycle.Delete",
		"lifecycle.InterruptedTurnRecovery", "child.InterruptedTurnRecovery", "PendingToolRecovery",
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
	if !strings.Contains(bootstrap, "boundFloretPendingToolRecoveryCoordinator") {
		t.Fatal("floret_bootstrap.go must construct recovery settlement only through the explicit coordinator")
	}
	recoverySource := readRepoFile(t, root, filepath.Join("internal", "ai", "floret_pending_tool_recovery.go"))
	if strings.Contains(recoverySource, "PendingToolRecoveryHostBinder") || strings.Contains(recoverySource, "github.com/floegence/floret/v3/runtime") {
		t.Fatal("Floret recovery interface must not retain concrete runtime capability types")
	}
	if !strings.Contains(bootstrap, "lifecycle.PendingToolRecovery") || !strings.Contains(bootstrap, "child.PendingToolRecovery") || !strings.Contains(bootstrap, "boundFloretPendingToolRecoveryCoordinator") {
		t.Fatal("Floret recovery handle must be issued and encapsulated inside the composition root")
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
			if importPath != "github.com/floegence/floret/v3/runtime" {
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
	expectedConstructors := map[string][]string{
		filepath.Join("internal", "ai", "floret_runtime.go"): {
			"flruntime.NewAgent", "flruntime.WithAgentThreadTitleMode", "flruntime.WithAgentDynamicToolSurface",
		},
		filepath.Join("internal", "ai", "compact_thread_context.go"): {
			"flruntime.NewAgent",
		},
		filepath.Join("internal", "ai", "subagents_floret.go"): {
			"flruntime.NewAgent", "flruntime.WithAgentThreadTitleMode", "flruntime.WithAgentDynamicToolSurface",
		},
	}
	for rel, requiredConstructors := range expectedConstructors {
		content := readRepoFile(t, root, rel)
		for _, marker := range []string{
			"flconfig." + "ProviderFake",
			"Fake" + "Response",
		} {
			if strings.Contains(content, marker) {
				t.Fatalf("%s must not configure gateway-backed Floret hosts with fake provider marker %q", rel, marker)
			}
		}
		for _, constructor := range requiredConstructors {
			if !strings.Contains(content, constructor) {
				t.Fatalf("%s must construct immutable Floret v3 Agent with %q", rel, constructor)
			}
		}
		if strings.HasSuffix(rel, "compact_thread_context.go") {
			if strings.Contains(content, "WithAgentThreadTitleMode") {
				t.Fatalf("%s must not receive title authority through the compaction capability", rel)
			}
		} else if !strings.Contains(content, "flruntime.ThreadTitleModeProvider") {
			t.Fatalf("%s must delegate provider title ownership to Floret", rel)
		}
		for _, forbidden := range []string{"TurnExecutionHostOptions", "ThreadCompactionHostOptions", "SubAgentHostOptions", "RunTurnRequest"} {
			if strings.Contains(content, forbidden) {
				t.Fatalf("%s must not construct opaque Floret v1 options with %q", rel, forbidden)
			}
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
		"github.com/floegence/floret/v3/" + "internal",
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
			if path != root {
				nested, nestedErr := isNestedRepositoryRoot(path)
				if nestedErr != nil {
					return nestedErr
				}
				if nested {
					return filepath.SkipDir
				}
			}
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

func TestNestedRepositoryRootDetection(t *testing.T) {
	t.Parallel()

	repositoryRoot := repoRootForTest(t)
	root := t.TempDir()
	ordinaryDir := filepath.Join(root, "ordinary")
	brokenMarkerDir := filepath.Join(root, "broken-marker")
	symlinkMarkerDir := filepath.Join(root, "symlink-marker")
	for _, dir := range []string{ordinaryDir, brokenMarkerDir, symlinkMarkerDir} {
		if err := os.Mkdir(dir, 0o755); err != nil {
			t.Fatalf("create fixture directory %s: %v", dir, err)
		}
	}
	if err := os.WriteFile(filepath.Join(brokenMarkerDir, ".git"), []byte("not git metadata\n"), 0o644); err != nil {
		t.Fatalf("create broken repository marker: %v", err)
	}
	if err := os.Symlink(filepath.Join(repositoryRoot, ".git"), filepath.Join(symlinkMarkerDir, ".git")); err != nil {
		t.Fatalf("create symlink repository marker: %v", err)
	}

	for _, testCase := range []struct {
		name string
		path string
		want bool
	}{
		{name: "current repository", path: repositoryRoot, want: true},
		{name: "ordinary directory", path: ordinaryDir, want: false},
		{name: "broken marker", path: brokenMarkerDir, want: false},
		{name: "symlink marker", path: symlinkMarkerDir, want: false},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			got, err := isNestedRepositoryRoot(testCase.path)
			if err != nil {
				t.Fatalf("detect nested repository root: %v", err)
			}
			if got != testCase.want {
				t.Fatalf("isNestedRepositoryRoot(%q) = %v, want %v", testCase.path, got, testCase.want)
			}
		})
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

func isNestedRepositoryRoot(path string) (bool, error) {
	markerPath := filepath.Join(path, ".git")
	markerInfo, err := os.Lstat(markerPath)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if markerInfo.Mode()&os.ModeSymlink != 0 {
		return false, nil
	}
	if !markerInfo.IsDir() && !markerInfo.Mode().IsRegular() {
		return false, nil
	}

	cmd := exec.Command("git", "-C", path, "rev-parse", "--show-toplevel")
	cmd.Env, err = environmentWithoutLocalGitRepository()
	if err != nil {
		return false, err
	}
	output, err := cmd.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return false, nil
		}
		return false, err
	}
	resolvedTopLevel, err := filepath.EvalSymlinks(strings.TrimSpace(string(output)))
	if err != nil {
		return false, err
	}
	resolvedPath, err := filepath.EvalSymlinks(path)
	if err != nil {
		return false, err
	}
	return filepath.Clean(resolvedTopLevel) == filepath.Clean(resolvedPath), nil
}

func environmentWithoutLocalGitRepository() ([]string, error) {
	output, err := exec.Command("git", "rev-parse", "--local-env-vars").Output()
	if err != nil {
		return nil, err
	}
	localVariables := make(map[string]bool)
	for _, name := range strings.Fields(string(output)) {
		localVariables[name] = true
	}
	environment := make([]string, 0, len(os.Environ()))
	for _, entry := range os.Environ() {
		name, _, _ := strings.Cut(entry, "=")
		if !localVariables[name] {
			environment = append(environment, entry)
		}
	}
	return environment, nil
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

func assertOnlyCurrentFlowersecGoImports(t *testing.T, root string) {
	t.Helper()

	moduleRoot := strings.TrimSuffix(flowersecGoModule, "/v2")
	cmd := exec.Command("git", "-C", root, "ls-files", "-z", "--", "*.go")
	trackedFiles, err := cmd.Output()
	if err != nil {
		t.Fatalf("list tracked Go files: %v", err)
	}
	for _, rel := range strings.Split(string(trackedFiles), "\x00") {
		if rel == "" {
			continue
		}
		path := filepath.Join(root, filepath.FromSlash(rel))
		parsed, parseErr := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
		if parseErr != nil {
			t.Fatalf("parse imports from %s: %v", rel, parseErr)
		}
		for _, imported := range parsed.Imports {
			importPath, unquoteErr := strconv.Unquote(imported.Path.Value)
			if unquoteErr != nil {
				t.Fatalf("parse import from %s: %v", rel, unquoteErr)
			}
			if importPath != moduleRoot && !strings.HasPrefix(importPath, moduleRoot+"/") {
				continue
			}
			if importPath != flowersecGoModule && !strings.HasPrefix(importPath, flowersecGoModule+"/") {
				t.Fatalf("%s imports a Flowersec package outside %s", rel, flowersecGoModule)
			}
		}
	}
}

func assertOnlyCurrentFlowersecNPMDependency(t *testing.T, root string, file string) {
	t.Helper()

	content := readRepoFile(t, root, file)
	var document any
	var err error
	switch filepath.Ext(file) {
	case ".json":
		err = json.Unmarshal([]byte(content), &document)
	case ".yaml", ".yml":
		err = yaml.Unmarshal([]byte(content), &document)
	default:
		t.Fatalf("unsupported dependency document %s", file)
	}
	if err != nil {
		t.Fatalf("parse %s: %v", file, err)
	}
	found := 0
	validateFlowersecNPMNode(t, file, document, &found)
	if found == 0 {
		t.Fatalf("%s does not declare or resolve %s", file, flowersecCorePackage)
	}
}

func validateFlowersecNPMNode(t *testing.T, file string, value any, found *int) {
	t.Helper()

	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			switch {
			case key == flowersecCorePackage:
				*found++
				assertFlowersecNPMReference(t, file, key, child)
			case key == "node_modules/"+flowersecCorePackage:
				*found++
				resolved, ok := child.(map[string]any)
				if !ok || resolved["version"] != flowersecCoreVersion {
					t.Fatalf("%s resolves %s without exact version %s", file, key, flowersecCoreVersion)
				}
			case strings.HasPrefix(key, flowersecCorePackage+"@"):
				*found++
				want := flowersecCorePackage + "@" + flowersecCoreVersion
				if key != want && !strings.HasPrefix(key, want+"(") {
					t.Fatalf("%s resolves unexpected Flowersec package key %q", file, key)
				}
			}
			validateFlowersecNPMNode(t, file, child, found)
		}
	case []any:
		for _, child := range typed {
			validateFlowersecNPMNode(t, file, child, found)
		}
	case string:
		if strings.Contains(typed, "flowersec-core-") && strings.Contains(typed, ".tgz") {
			*found++
			if !strings.Contains(typed, "flowersec-core-"+flowersecCoreVersion+".tgz") {
				t.Fatalf("%s contains unexpected Flowersec package artifact %q", file, typed)
			}
		}
	}
}

func assertFlowersecNPMReference(t *testing.T, file string, key string, value any) {
	t.Helper()

	switch typed := value.(type) {
	case string:
		if typed != flowersecCoreVersion {
			t.Fatalf("%s declares %s=%q, want %s", file, key, typed, flowersecCoreVersion)
		}
	case map[string]any:
		matched := false
		for _, field := range []string{"specifier", "version"} {
			if fieldValue, ok := typed[field]; ok {
				matched = true
				if fieldValue != flowersecCoreVersion {
					t.Fatalf("%s declares %s.%s=%v, want %s", file, key, field, fieldValue, flowersecCoreVersion)
				}
			}
		}
		if !matched {
			t.Fatalf("%s declares %s without a structured version", file, key)
		}
	default:
		t.Fatalf("%s declares %s using unsupported value %T", file, key, value)
	}
}

func assertNoticeDependency(t *testing.T, notices string, dependency string, version string, source string) {
	t.Helper()

	var rows [][]string
	for _, line := range strings.Split(notices, "\n") {
		if !strings.HasPrefix(strings.TrimSpace(line), "|") {
			continue
		}
		columns := strings.Split(line, "|")
		if len(columns) < 7 || strings.TrimSpace(columns[1]) != dependency {
			continue
		}
		rows = append(rows, columns)
	}
	if len(rows) != 1 {
		t.Fatalf("THIRD_PARTY_NOTICES.md %s rows=%d, want one", dependency, len(rows))
	}
	if got := strings.TrimSpace(rows[0][2]); got != version {
		t.Fatalf("THIRD_PARTY_NOTICES.md %s version=%q, want %s", dependency, got, version)
	}
	if got := strings.TrimSpace(rows[0][5]); got != source {
		t.Fatalf("THIRD_PARTY_NOTICES.md %s source=%q, want %s", dependency, got, source)
	}
}

func assertNoLocalNPMReference(t *testing.T, file string, content string) {
	t.Helper()

	for _, marker := range []string{"../" + "flowersec", "../" + "floe-webapp"} {
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
