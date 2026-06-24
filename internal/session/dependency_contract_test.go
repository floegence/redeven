package session

import (
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

	if !strings.Contains(goMod, "github.com/floegence/flowersec/flowersec-go v0.19.10") {
		t.Fatalf("go.mod must depend on flowersec-go v0.19.10")
	}
	if strings.Contains(goMod, "\nreplace ") || strings.Contains(goMod, "\nreplace(") {
		t.Fatalf("go.mod must not use replace directives")
	}
	if strings.Contains(goMod, "../flowersec") || strings.Contains(goMod, "file:") || strings.Contains(goMod, "link:") {
		t.Fatalf("go.mod must not reference local flowersec checkouts")
	}

	if !strings.Contains(goSum, "github.com/floegence/flowersec/flowersec-go v0.19.10 ") {
		t.Fatalf("go.sum must include flowersec-go v0.19.10 module checksum")
	}
	if !strings.Contains(goSum, "github.com/floegence/flowersec/flowersec-go v0.19.10/go.mod ") {
		t.Fatalf("go.sum must include flowersec-go v0.19.10 go.mod checksum")
	}

	if !strings.Contains(notices, "github.com/floegence/flowersec/flowersec-go | v0.19.10") {
		t.Fatalf("THIRD_PARTY_NOTICES.md must list flowersec-go v0.19.10")
	}
	if !strings.Contains(notices, "flowersec-go@v0.19.10") {
		t.Fatalf("THIRD_PARTY_NOTICES.md must link to flowersec-go@v0.19.10")
	}
	if !strings.Contains(notices, "@floegence/flowersec-core | 0.19.10") {
		t.Fatalf("THIRD_PARTY_NOTICES.md must list @floegence/flowersec-core 0.19.10")
	}
	if strings.Contains(notices, "flowersec-core | 0.19.7") {
		t.Fatalf("THIRD_PARTY_NOTICES.md must not retain @floegence/flowersec-core 0.19.7")
	}
}

func TestFloeWebappDependenciesUsePublishedSecurityRelease(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	expectedPackages := map[string][]string{
		"desktop/package.json": {
			"\"@floegence/floe-webapp-core\": \"^0.36.68\"",
		},
		"desktop/package-lock.json": {
			"floe-webapp-core-0.36.68.tgz",
		},
		"desktop/pnpm-lock.yaml": {
			"@floegence/floe-webapp-core@0.36.68",
		},
		"internal/envapp/ui_src/package.json": {
			"\"@floegence/floe-webapp-boot\": \"^0.36.68\"",
			"\"@floegence/floe-webapp-core\": \"^0.36.68\"",
			"\"@floegence/floe-webapp-protocol\": \"^0.36.68\"",
			"\"@floegence/flowersec-core\": \"^0.19.10\"",
		},
		"internal/envapp/ui_src/package-lock.json": {
			"floe-webapp-boot-0.36.68.tgz",
			"floe-webapp-core-0.36.68.tgz",
			"floe-webapp-protocol-0.36.68.tgz",
			"flowersec-core-0.19.10.tgz",
		},
		"internal/envapp/ui_src/pnpm-lock.yaml": {
			"@floegence/floe-webapp-boot@0.36.68",
			"@floegence/floe-webapp-core@0.36.68",
			"@floegence/floe-webapp-protocol@0.36.68",
			"@floegence/flowersec-core@0.19.10",
		},
		"internal/codeapp/ui_src/package.json": {
			"\"@floegence/flowersec-core\": \"^0.19.10\"",
		},
		"internal/codeapp/ui_src/package-lock.json": {
			"flowersec-core-0.19.10.tgz",
		},
		"THIRD_PARTY_NOTICES.md": {
			"@floegence/floe-webapp-boot | 0.36.68",
			"@floegence/floe-webapp-core | 0.36.68",
			"@floegence/floe-webapp-protocol | 0.36.68",
			"@floegence/flowersec-core | 0.19.10",
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
		if strings.Contains(content, "0.19.7") || strings.Contains(content, "0.19.8") {
			t.Fatalf("%s must not retain old @floegence/flowersec-core versions", file)
		}
		assertNoLocalNPMReference(t, file, content)
	}
}

func TestFloretDependencyUsesPublishedRelease(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	goMod := readRepoFile(t, root, "go.mod")
	goSum := readRepoFile(t, root, "go.sum")

	if !strings.Contains(goMod, "github.com/floegence/floret v0.3.22") {
		t.Fatalf("go.mod must depend on floret v0.3.22")
	}
	assertNoLocalGoModuleReference(t, "go.mod", goMod, "github.com/floegence/floret", "floret")
	if !strings.Contains(goSum, "github.com/floegence/floret v0.3.22 ") {
		t.Fatalf("go.sum must include floret v0.3.22 module checksum")
	}
	if !strings.Contains(goSum, "github.com/floegence/floret v0.3.22/go.mod ") {
		t.Fatalf("go.sum must include floret v0.3.22 go.mod checksum")
	}
	assertNoLocalGoModuleReference(t, "go.sum", goSum, "github.com/floegence/floret", "floret")
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
