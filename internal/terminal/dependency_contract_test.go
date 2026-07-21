package terminal

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/mod/modfile"
)

func TestFloetermDependencyUsesPublishedPromptCommandRelease(t *testing.T) {
	repoRoot := filepath.Clean(filepath.Join("..", ".."))
	goModBytes, err := os.ReadFile(filepath.Join(repoRoot, "go.mod"))
	if err != nil {
		t.Fatalf("read go.mod: %v", err)
	}
	parsed, err := modfile.Parse("go.mod", goModBytes, nil)
	if err != nil {
		t.Fatalf("parse go.mod: %v", err)
	}

	const modulePath = "github.com/floegence/floeterm/terminal-go"
	versions := make([]string, 0, 1)
	for _, requirement := range parsed.Require {
		if requirement.Mod.Path == modulePath {
			versions = append(versions, requirement.Mod.Version)
		}
	}
	if len(versions) != 1 || versions[0] != "v0.6.3" {
		t.Fatalf("go.mod Floeterm terminal-go requirements = %v, want only v0.6.3", versions)
	}
	for _, replacement := range parsed.Replace {
		if replacement.Old.Path == modulePath || replacement.New.Path == modulePath {
			t.Fatalf("go.mod must consume the published terminal-go release, found replace %#v", replacement)
		}
	}
	goMod := string(goModBytes)
	for _, forbidden := range []string{"../floeterm", "file:", "link:", "workspace:", "portal:"} {
		if strings.Contains(goMod, forbidden) {
			t.Fatalf("go.mod must not contain local dependency marker %q", forbidden)
		}
	}

	goSumBytes, err := os.ReadFile(filepath.Join(repoRoot, "go.sum"))
	if err != nil {
		t.Fatalf("read go.sum: %v", err)
	}
	goSum := string(goSumBytes)
	if !strings.Contains(goSum, modulePath+" v0.6.3 h1:") || !strings.Contains(goSum, modulePath+" v0.6.3/go.mod h1:") {
		t.Fatal("go.sum must contain published terminal-go v0.6.3 checksums")
	}
}
