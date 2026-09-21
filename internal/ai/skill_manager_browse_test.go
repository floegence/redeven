package ai

import (
	"encoding/base64"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSkillManager_BrowseSystemSkill(t *testing.T) {
	t.Parallel()
	mgr := newSkillManager(t.TempDir(), t.TempDir())
	mgr.userHome = t.TempDir()
	const skillPath = "system:redeven-environment/SKILL.md"
	const root = "system:redeven-environment"
	raw, err := systemSkillFS.ReadFile("system_skills/redeven-environment/SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	want := strings.TrimSpace(string(raw))
	for _, dir := range []string{"", "."} {
		t.Run("tree/"+dir, func(t *testing.T) {
			tree, err := mgr.BrowseTree(skillPath, dir)
			if err != nil {
				t.Fatal(err)
			}
			if tree.Root != root || tree.Dir != "." || len(tree.Entries) != 1 {
				t.Fatalf("unexpected system tree: %+v", tree)
			}
			entry := tree.Entries[0]
			if entry.Name != "SKILL.md" || entry.Path != "SKILL.md" || entry.IsDir || entry.Size != int64(len(want)) || entry.ModifiedAtUnixMs != 0 {
				t.Fatalf("unexpected embedded file metadata: %+v", entry)
			}
		})
	}
	for _, tc := range []struct {
		name, encoding, content string
		maxBytes                int
		truncated               bool
	}{
		{name: "default", encoding: "", content: want},
		{name: "utf8", encoding: "utf8", content: want},
		{name: "base64", encoding: "base64", content: base64.StdEncoding.EncodeToString([]byte(want))},
		{name: "truncated", encoding: "utf8", maxBytes: 3, content: want[:3], truncated: true},
		{name: "truncated-base64", encoding: "base64", maxBytes: 3, content: base64.StdEncoding.EncodeToString([]byte(want[:3])), truncated: true},
		{name: "exact-limit", encoding: "utf8", maxBytes: len(want), content: want},
	} {
		t.Run(tc.name, func(t *testing.T) {
			file, err := mgr.BrowseFile(skillPath, "SKILL.md", tc.encoding, tc.maxBytes)
			if err != nil {
				t.Fatal(err)
			}
			encoding := tc.encoding
			if encoding == "" {
				encoding = "utf8"
			}
			if file.Root != root || file.File != "SKILL.md" || file.Content != tc.content || file.Encoding != encoding || file.Size != int64(len(want)) || file.Truncated != tc.truncated {
				t.Fatalf("unexpected embedded file result: root=%q file=%q encoding=%q size=%d truncated=%v", file.Root, file.File, file.Encoding, file.Size, file.Truncated)
			}
		})
	}
}

func TestSkillManager_BrowseSystemSkillBoundaries(t *testing.T) {
	t.Parallel()
	mgr := newSkillManager(t.TempDir(), t.TempDir())
	mgr.userHome = t.TempDir()
	const skillPath = "system:redeven-environment/SKILL.md"
	for _, tc := range []struct {
		name, skillPath, relative, encoding, code string
		tree                                      bool
		maxBytes, status                          int
	}{
		{name: "unknown-tree", skillPath: "system:unknown/SKILL.md", tree: true, code: ErrCodeAISkillsBrowseForbidden, status: http.StatusNotFound},
		{name: "unknown-file", skillPath: "system:unknown/SKILL.md", relative: "SKILL.md", code: ErrCodeAISkillsBrowseForbidden, status: http.StatusNotFound},
		{name: "missing-directory", tree: true, relative: "scripts", code: ErrCodeAISkillsSkillNotFound, status: http.StatusNotFound},
		{name: "missing-file", relative: "missing.md", code: ErrCodeAISkillsSkillNotFound, status: http.StatusNotFound},
		{name: "tree-escape", tree: true, relative: "..", code: ErrCodeAISkillsPathEscape, status: http.StatusUnprocessableEntity},
		{name: "file-escape", relative: "../other/SKILL.md", code: ErrCodeAISkillsPathEscape, status: http.StatusUnprocessableEntity},
		{name: "backslash-escape", relative: `..\other\SKILL.md`, code: ErrCodeAISkillsPathEscape, status: http.StatusUnprocessableEntity},
		{name: "absolute-file", relative: "/etc/passwd", code: ErrCodeAISkillsInvalidPath, status: http.StatusBadRequest},
		{name: "missing-file-path", code: ErrCodeAISkillsInvalidPath, status: http.StatusBadRequest},
		{name: "invalid-encoding", relative: "SKILL.md", encoding: "hex", code: ErrCodeAISkillsInvalidPath, status: http.StatusBadRequest},
		{name: "excessive-limit", relative: "SKILL.md", maxBytes: 10*1024*1024 + 1, code: ErrCodeAISkillsFileTooLarge, status: http.StatusUnprocessableEntity},
	} {
		t.Run(tc.name, func(t *testing.T) {
			selected := tc.skillPath
			if selected == "" {
				selected = skillPath
			}
			var err error
			if tc.tree {
				_, err = mgr.BrowseTree(selected, tc.relative)
			} else {
				_, err = mgr.BrowseFile(selected, tc.relative, tc.encoding, tc.maxBytes)
			}
			if SkillErrorCode(err) != tc.code || SkillErrorStatus(err) != tc.status {
				t.Fatalf("error=%v code=%q status=%d, want %q/%d", err, SkillErrorCode(err), SkillErrorStatus(err), tc.code, tc.status)
			}
		})
	}
}

func TestSkillManager_BrowseLocalSymlinkEscape(t *testing.T) {
	t.Parallel()
	mgr := newSkillManager(t.TempDir(), t.TempDir())
	mgr.userHome = t.TempDir()
	root := filepath.Join(mgr.userHome, ".redeven", "skills", "manual")
	if err := os.MkdirAll(root, 0o700); err != nil {
		t.Fatal(err)
	}
	skillPath := filepath.Join(root, "SKILL.md")
	const content = "---\nname: manual\ndescription: manual\n---\n\n# Manual"
	if err := os.WriteFile(skillPath, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(t.TempDir(), filepath.Join(root, "outside")); err != nil {
		t.Fatal(err)
	}
	tree, err := mgr.BrowseTree(skillPath, "")
	if err != nil || len(tree.Entries) != 1 || tree.Entries[0].Name != "SKILL.md" {
		t.Fatalf("directory listing must hide escaped symlinks: %+v, %v", tree, err)
	}
	file, err := mgr.BrowseFile(skillPath, "SKILL.md", "", 0)
	if err != nil || file.Content != content {
		t.Fatalf("local file should remain readable: %+v, %v", file, err)
	}
	_, err = mgr.BrowseTree(skillPath, "outside")
	if SkillErrorCode(err) != ErrCodeAISkillsPathEscape {
		t.Fatalf("expected directory symlink escape rejection, got %v", err)
	}
	_, err = mgr.BrowseFile(skillPath, "outside/missing.txt", "", 0)
	if SkillErrorCode(err) != ErrCodeAISkillsPathEscape {
		t.Fatalf("expected file symlink escape rejection, got %v", err)
	}
}
