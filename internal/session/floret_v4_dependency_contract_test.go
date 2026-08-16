package session

import (
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

func TestFloretDependencyIsExactPublishedV4(t *testing.T) {
	t.Parallel()

	root := repoRootForTest(t)
	data, err := os.ReadFile(filepath.Join(root, "go.mod"))
	if err != nil {
		t.Fatal(err)
	}
	module, err := modfile.Parse("go.mod", data, nil)
	if err != nil {
		t.Fatal(err)
	}
	const path = "github.com/floegence/floret/v4"
	const version = "v4.0.10"
	found := false
	for _, requirement := range module.Require {
		if requirement.Mod.Path == path {
			found = true
			if requirement.Mod.Version != version {
				t.Fatalf("Floret version = %q, want %q", requirement.Mod.Version, version)
			}
		}
		if requirement.Mod.Path == "github.com/floegence/floret" {
			t.Fatal("v1 Floret module requirement remains")
		}
	}
	if !found {
		t.Fatalf("missing exact %s %s requirement", path, version)
	}
	for _, replacement := range module.Replace {
		if strings.HasPrefix(replacement.Old.Path, "github.com/floegence/floret") {
			t.Fatalf("Floret replacement is forbidden: %#v", replacement)
		}
	}

	err = filepath.WalkDir(root, func(filePath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if filePath != root {
				nested, nestedErr := isNestedRepositoryRoot(filePath)
				if nestedErr != nil {
					return nestedErr
				}
				if nested {
					return filepath.SkipDir
				}
			}
			if entry.Name() == ".git" || entry.Name() == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		if filepath.Ext(filePath) != ".go" {
			return nil
		}
		parsed, parseErr := parser.ParseFile(token.NewFileSet(), filePath, nil, parser.ImportsOnly)
		if parseErr != nil {
			return parseErr
		}
		for _, imported := range parsed.Imports {
			path, unquoteErr := strconv.Unquote(imported.Path.Value)
			if unquoteErr != nil {
				return unquoteErr
			}
			if path == "github.com/floegence/floret" || strings.HasPrefix(path, "github.com/floegence/floret/") && !strings.HasPrefix(path, "github.com/floegence/floret/v4/") {
				relative, _ := filepath.Rel(root, filePath)
				t.Fatalf("%s imports the v1 Floret module path %q", relative, path)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("scan Go imports: %v", err)
	}
}

func TestCurrentSourceAndOKFDoNotNameTheRetiredFloretContract(t *testing.T) {
	t.Parallel()
	root := repoRootForTest(t)
	forbidden := []string{"Floret " + "v3", "v3." + "2.40"}
	for _, relativeRoot := range []string{"internal", "okf"} {
		err := filepath.WalkDir(filepath.Join(root, relativeRoot), func(filePath string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() {
				if entry.Name() == "dist" || entry.Name() == "node_modules" {
					return filepath.SkipDir
				}
				return nil
			}
			if filepath.ToSlash(filePath) == filepath.ToSlash(filepath.Join(root, "okf", "log.md")) {
				return nil
			}
			ext := strings.ToLower(filepath.Ext(filePath))
			if ext != ".go" && ext != ".ts" && ext != ".tsx" && ext != ".md" {
				return nil
			}
			body, err := os.ReadFile(filePath)
			if err != nil {
				return err
			}
			for _, token := range forbidden {
				if strings.Contains(string(body), token) {
					relative, _ := filepath.Rel(root, filePath)
					t.Fatalf("%s names retired current Floret contract %q", relative, token)
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
}
