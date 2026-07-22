package sqliteutil

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

func TestRedevenOwnedSQLiteOpeningsUseMigrationEngine(t *testing.T) {
	t.Parallel()

	root := repositoryRoot(t)
	wantMigratingOpeners := map[string]struct{}{
		"internal/ai/threadstore/store.go":                       {},
		"internal/codeapp/registry/registry.go":                  {},
		"internal/notes/service.go":                              {},
		"internal/portforward/registry/registry.go":              {},
		"internal/redevpluginintegration/release_trust_store.go": {},
		"internal/threadreadstate/store.go":                      {},
		"internal/workbenchlayout/service.go":                    {},
	}
	wantDirectOpeners := map[string]struct{}{
		"internal/ai/threadstore/schema.go":           {}, // In-memory canonical schema verification.
		"internal/ai/threadstore/schema_preflight.go": {}, // Read-only validation before a cross-owner migration.
		"internal/persistence/sqliteutil/engine.go":   {}, // The migration engine owns the physical connection.
	}
	wantFloretOpeners := map[string]struct{}{
		"internal/ai/floret_bootstrap.go": {},
	}

	gotMigratingOpeners := make(map[string]struct{})
	gotDirectOpeners := make(map[string]struct{})
	gotFloretOpeners := make(map[string]struct{})
	fset := token.NewFileSet()

	for _, scanRoot := range []string{"cmd", "internal"} {
		err := filepath.WalkDir(filepath.Join(root, scanRoot), func(path string, entry os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() {
				switch entry.Name() {
				case ".git", "node_modules", "dist", "build":
					return filepath.SkipDir
				}
				if path == filepath.Join(root, "internal", "testutil") {
					return filepath.SkipDir
				}
				return nil
			}
			if filepath.Ext(path) != ".go" || strings.HasSuffix(path, "_test.go") {
				return nil
			}

			parsed, parseErr := parser.ParseFile(fset, path, nil, 0)
			if parseErr != nil {
				return parseErr
			}
			rel, relErr := filepath.Rel(root, path)
			if relErr != nil {
				return relErr
			}
			rel = filepath.ToSlash(rel)

			sqlAliases := importAliases(parsed, "database/sql", "sql")
			sqliteutilAliases := importAliases(parsed, "github.com/floegence/redeven/internal/persistence/sqliteutil", "sqliteutil")
			floretRuntimeAliases := importAliases(parsed, "github.com/floegence/floret/runtime", "runtime")
			ast.Inspect(parsed, func(node ast.Node) bool {
				call, ok := node.(*ast.CallExpr)
				if !ok {
					return true
				}
				selector, ok := call.Fun.(*ast.SelectorExpr)
				if !ok {
					return true
				}
				receiver, ok := selector.X.(*ast.Ident)
				if !ok {
					return true
				}
				switch {
				case selector.Sel.Name == "Open" && hasAlias(sqliteutilAliases, receiver.Name):
					gotMigratingOpeners[rel] = struct{}{}
				case selector.Sel.Name == "Open" && hasAlias(sqlAliases, receiver.Name) && firstStringArgument(call) == "sqlite":
					gotDirectOpeners[rel] = struct{}{}
				case selector.Sel.Name == "OpenSQLiteStore" && hasAlias(floretRuntimeAliases, receiver.Name):
					gotFloretOpeners[rel] = struct{}{}
				}
				return true
			})
			return nil
		})
		if err != nil {
			t.Fatalf("scan production Go sources: %v", err)
		}
	}

	assertPathSet(t, "Redeven migration-engine SQLite openers", gotMigratingOpeners, wantMigratingOpeners)
	assertPathSet(t, "reviewed direct SQLite openers", gotDirectOpeners, wantDirectOpeners)
	assertPathSet(t, "Floret-owned SQLite openers", gotFloretOpeners, wantFloretOpeners)
}

func repositoryRoot(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	root, err := filepath.Abs(filepath.Join(wd, "..", "..", ".."))
	if err != nil {
		t.Fatalf("resolve repository root: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "go.mod")); err != nil {
		t.Fatalf("repository root %q is invalid: %v", root, err)
	}
	return root
}

func importAliases(file *ast.File, importPath string, defaultAlias string) map[string]struct{} {
	aliases := make(map[string]struct{})
	for _, spec := range file.Imports {
		path, err := strconv.Unquote(spec.Path.Value)
		if err != nil || path != importPath {
			continue
		}
		alias := defaultAlias
		if spec.Name != nil {
			alias = spec.Name.Name
		}
		if alias != "_" && alias != "." {
			aliases[alias] = struct{}{}
		}
	}
	return aliases
}

func hasAlias(aliases map[string]struct{}, alias string) bool {
	_, ok := aliases[alias]
	return ok
}

func firstStringArgument(call *ast.CallExpr) string {
	if len(call.Args) == 0 {
		return ""
	}
	literal, ok := call.Args[0].(*ast.BasicLit)
	if !ok || literal.Kind != token.STRING {
		return ""
	}
	value, err := strconv.Unquote(literal.Value)
	if err != nil {
		return ""
	}
	return value
}

func assertPathSet(t *testing.T, label string, got map[string]struct{}, want map[string]struct{}) {
	t.Helper()
	missing := pathSetDifference(want, got)
	unexpected := pathSetDifference(got, want)
	if len(missing) == 0 && len(unexpected) == 0 {
		return
	}
	t.Fatalf("%s changed without an ownership/migration contract review: missing=%v unexpected=%v", label, missing, unexpected)
}

func pathSetDifference(left map[string]struct{}, right map[string]struct{}) []string {
	result := make([]string, 0)
	for path := range left {
		if _, ok := right[path]; !ok {
			result = append(result, path)
		}
	}
	sort.Strings(result)
	return result
}
