package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestAgentSkillBundles(t *testing.T) {
	repoRoot := repoRootForTest(t)
	skillNames := []string{"redeven-control", "redeven-assist"}
	for _, skillName := range skillNames {
		skillName := skillName
		t.Run(skillName, func(t *testing.T) {
			skillPath := filepath.Join(repoRoot, "agent-skills", skillName, "SKILL.md")
			body, err := os.ReadFile(skillPath)
			if err != nil {
				t.Fatalf("ReadFile(%s) error = %v", skillPath, err)
			}
			text := string(body)
			assertContainsAll(t, text,
				"---",
				"name: "+skillName,
				"description:",
			)
			if strings.Contains(text, "mcp_servers:") {
				t.Fatalf("skill %s must not declare MCP dependencies", skillName)
			}
		})
	}
}

func TestRedevenControlSkillScripts(t *testing.T) {
	repoRoot := repoRootForTest(t)
	scripts := []string{
		filepath.Join(repoRoot, "agent-skills", "redeven-control", "scripts", "list_targets.sh"),
		filepath.Join(repoRoot, "agent-skills", "redeven-control", "scripts", "resolve_target.sh"),
	}
	for _, script := range scripts {
		script := script
		t.Run(filepath.Base(script), func(t *testing.T) {
			info, err := os.Stat(script)
			if err != nil {
				t.Fatalf("Stat(%s) error = %v", script, err)
			}
			if info.Mode()&0o111 == 0 {
				t.Fatalf("script is not executable: %s", script)
			}
			cmd := exec.Command("sh", "-n", script)
			if out, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("sh -n %s error = %v\n%s", script, err, string(out))
			}
		})
	}
}

func repoRootForTest(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatalf("runtime.Caller failed")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", ".."))
}
