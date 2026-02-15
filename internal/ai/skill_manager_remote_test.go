package ai

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type testGitHubFixture struct {
	skillMarkdown string
	zipBytes      []byte
	zipStatus     int
}

func newGitHubFixtureServer(t *testing.T, fx testGitHubFixture) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimSpace(r.URL.Path)
		switch {
		case strings.HasPrefix(path, "/repos/openai/skills/contents/skills/.curated"):
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]map[string]any{{
				"name": "skill-installer",
				"path": "skills/.curated/skill-installer",
				"type": "dir",
			}})
			return
		case path == "/raw/openai/skills/main/skills/.curated/skill-installer/SKILL.md":
			w.Header().Set("Content-Type", "text/markdown")
			_, _ = w.Write([]byte(fx.skillMarkdown))
			return
		case path == "/repos/openai/skills/zipball/main":
			status := fx.zipStatus
			if status <= 0 {
				status = http.StatusOK
			}
			w.WriteHeader(status)
			if status == http.StatusOK {
				_, _ = w.Write(fx.zipBytes)
			}
			return
		default:
			http.NotFound(w, r)
			return
		}
	}))
}

func buildZipArchive(t *testing.T, files map[string]string) []byte {
	t.Helper()
	buf := &bytes.Buffer{}
	zw := zip.NewWriter(buf)
	for name, body := range files {
		f, err := zw.Create(name)
		if err != nil {
			t.Fatalf("create zip entry %s: %v", name, err)
		}
		if _, err := f.Write([]byte(body)); err != nil {
			t.Fatalf("write zip entry %s: %v", name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close zip writer: %v", err)
	}
	return buf.Bytes()
}

func TestSkillManager_GitHubImportAndBrowse(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	stateDir := t.TempDir()

	skillMD := `---
name: skill-installer
description: Install Codex skills
---

# Skill Installer`
	zipBytes := buildZipArchive(t, map[string]string{
		"openai-skills-main/skills/.curated/skill-installer/SKILL.md":           skillMD,
		"openai-skills-main/skills/.curated/skill-installer/scripts/install.sh": "echo ok",
	})
	server := newGitHubFixtureServer(t, testGitHubFixture{skillMarkdown: skillMD, zipBytes: zipBytes})
	defer server.Close()

	mgr := newSkillManager(workspace, stateDir)
	mgr.githubAPIBaseURL = server.URL
	mgr.githubRawBaseURL = server.URL + "/raw"
	mgr.githubRepoBaseURL = server.URL

	validated, err := mgr.ValidateGitHubImport(SkillGitHubImportRequest{
		Scope: "workspace",
		Repo:  "openai/skills",
		Ref:   "main",
		Paths: []string{"skills/.curated/skill-installer"},
	})
	if err != nil {
		t.Fatalf("ValidateGitHubImport: %v", err)
	}
	if len(validated.Resolved) != 1 {
		t.Fatalf("expected one resolved skill, got=%d", len(validated.Resolved))
	}
	if validated.Resolved[0].AlreadyExists {
		t.Fatalf("expected skill to not exist before install")
	}

	imported, err := mgr.ImportFromGitHub(SkillGitHubImportRequest{
		Scope: "workspace",
		Repo:  "openai/skills",
		Ref:   "main",
		Paths: []string{"skills/.curated/skill-installer"},
	})
	if err != nil {
		t.Fatalf("ImportFromGitHub: %v", err)
	}
	if len(imported.Imports) != 1 {
		t.Fatalf("expected one import, got=%d", len(imported.Imports))
	}
	if strings.TrimSpace(imported.Imports[0].InstallMode) != "zip" {
		t.Fatalf("expected zip install mode, got=%q", imported.Imports[0].InstallMode)
	}

	sources, err := mgr.ListSources()
	if err != nil {
		t.Fatalf("ListSources: %v", err)
	}
	if len(sources.Items) == 0 {
		t.Fatalf("expected non-empty sources")
	}
	if string(sources.Items[0].SourceType) != string(SkillSourceTypeGitHub) {
		t.Fatalf("expected github source type, got=%q", sources.Items[0].SourceType)
	}

	skillPath := imported.Imports[0].SkillPath
	tree, err := mgr.BrowseTree(skillPath, ".")
	if err != nil {
		t.Fatalf("BrowseTree: %v", err)
	}
	if len(tree.Entries) == 0 {
		t.Fatalf("expected non-empty tree entries")
	}

	file, err := mgr.BrowseFile(skillPath, "SKILL.md", "utf8", 1024)
	if err != nil {
		t.Fatalf("BrowseFile: %v", err)
	}
	if !strings.Contains(file.Content, "Install Codex skills") {
		t.Fatalf("unexpected file content: %q", file.Content)
	}

	catalog, err := mgr.ListGitHubCatalog(SkillGitHubCatalogRequest{Repo: "openai/skills", Ref: "main", BasePath: "skills/.curated"})
	if err != nil {
		t.Fatalf("ListGitHubCatalog: %v", err)
	}
	if len(catalog.Skills) == 0 || !catalog.Skills[0].ExistsLocal {
		t.Fatalf("expected local installation marker in github catalog")
	}
}

func TestSkillManager_ReinstallFromGitHubSource(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	stateDir := t.TempDir()

	skillMD := `---
name: skill-installer
description: Install Codex skills
---

# Skill Installer

Follow installer guide.`
	zipBytes := buildZipArchive(t, map[string]string{
		"openai-skills-main/skills/.curated/skill-installer/SKILL.md": skillMD,
	})
	server := newGitHubFixtureServer(t, testGitHubFixture{skillMarkdown: skillMD, zipBytes: zipBytes})
	defer server.Close()

	mgr := newSkillManager(workspace, stateDir)
	mgr.githubAPIBaseURL = server.URL
	mgr.githubRawBaseURL = server.URL + "/raw"
	mgr.githubRepoBaseURL = server.URL

	imported, err := mgr.ImportFromGitHub(SkillGitHubImportRequest{
		Scope: "workspace",
		Repo:  "openai/skills",
		Ref:   "main",
		Paths: []string{"skills/.curated/skill-installer"},
	})
	if err != nil {
		t.Fatalf("ImportFromGitHub: %v", err)
	}
	skillPath := imported.Imports[0].SkillPath
	if err := os.WriteFile(skillPath, []byte("tampered"), 0o600); err != nil {
		t.Fatalf("tamper skill file: %v", err)
	}

	reinstalled, err := mgr.Reinstall([]string{skillPath}, true)
	if err != nil {
		t.Fatalf("Reinstall: %v", err)
	}
	if len(reinstalled.Reinstalled) != 1 {
		t.Fatalf("expected one reinstalled item, got=%d", len(reinstalled.Reinstalled))
	}
	raw, err := os.ReadFile(skillPath)
	if err != nil {
		t.Fatalf("read skill file: %v", err)
	}
	if !strings.Contains(string(raw), "Follow installer guide") {
		t.Fatalf("expected file content to be restored, got=%q", string(raw))
	}
}

func TestSkillManager_GitHubZipRejectsPathEscape(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	stateDir := t.TempDir()

	skillMD := `---
name: skill-installer
description: Install Codex skills
---

# Skill Installer`
	zipBytes := buildZipArchive(t, map[string]string{
		"openai-skills-main/skills/.curated/skill-installer/SKILL.md":       skillMD,
		"openai-skills-main/skills/.curated/skill-installer/../../evil.txt": "escape",
	})
	server := newGitHubFixtureServer(t, testGitHubFixture{skillMarkdown: skillMD, zipBytes: zipBytes})
	defer server.Close()

	mgr := newSkillManager(workspace, stateDir)
	mgr.githubAPIBaseURL = server.URL
	mgr.githubRawBaseURL = server.URL + "/raw"
	mgr.githubRepoBaseURL = server.URL

	resolved := []SkillGitHubResolvedSkill{{
		Name:            "skill-installer",
		Scope:           "workspace",
		Repo:            "openai/skills",
		Ref:             "main",
		RepoPath:        "skills/.curated/skill-installer",
		TargetDir:       filepath.Join(workspace, ".redeven", "skills", "skill-installer"),
		TargetSkillPath: filepath.Join(workspace, ".redeven", "skills", "skill-installer", "SKILL.md"),
	}}
	input := resolvedGitHubImportInput{
		scope:     "workspace",
		repo:      "openai/skills",
		ref:       "main",
		repoPaths: []string{"skills/.curated/skill-installer"},
	}
	_, _, err := mgr.fetchGitHubSkillTreesByZipLocked(input, resolved, t.TempDir())
	if err == nil {
		t.Fatalf("expected zip extraction error")
	}
	se, ok := AsSkillError(err)
	if !ok {
		t.Fatalf("expected SkillError, got=%T %v", err, err)
	}
	if se.Code() != ErrCodeAISkillsArchiveInvalid {
		t.Fatalf("expected archive invalid code, got=%q", se.Code())
	}
}

func TestSkillManager_BrowsePathEscape(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	stateDir := t.TempDir()
	skillDir := filepath.Join(workspace, ".redeven", "skills", "manual")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("mkdir skill dir: %v", err)
	}
	skillPath := filepath.Join(skillDir, "SKILL.md")
	if err := os.WriteFile(skillPath, []byte("---\nname: manual\ndescription: manual\n---\n\n# Manual"), 0o600); err != nil {
		t.Fatalf("write skill file: %v", err)
	}

	mgr := newSkillManager(workspace, stateDir)
	mgr.Discover()
	_, err := mgr.BrowseFile(skillPath, "../outside", "utf8", 1024)
	if err == nil {
		t.Fatalf("expected browse path escape error")
	}
	se, ok := AsSkillError(err)
	if !ok {
		t.Fatalf("expected SkillError, got=%T %v", err, err)
	}
	if se.Code() != ErrCodeAISkillsPathEscape {
		t.Fatalf("expected path escape code, got=%q", se.Code())
	}
}
