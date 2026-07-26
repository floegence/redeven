package ai

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"testing"
)

var forbiddenAgentShadowTypes = map[string]struct{}{
	"DialogueTurn":        {},
	"StructuredUserInput": {},
	"TurnSnapshot":        {},
	"LoopDetector":        {},
}

var forbiddenAgentShadowFields = map[string]struct{}{
	"PendingToolCalls":      {},
	"RecentErrors":          {},
	"NoProgressSignatures":  {},
	"PendingUserInputQueue": {},
	"ActiveObjectiveDigest": {},
	"EstimateSource":        {},
}

var forbiddenAgentShadowJSONKeys = map[string]struct{}{
	"pending_tool_calls":       {},
	"recent_errors":            {},
	"no_progress_signatures":   {},
	"pending_user_input_queue": {},
	"active_objective_digest":  {},
	"estimate_source":          {},
}

func TestAgentShadowContractsStayRemoved(t *testing.T) {
	root := aiRepositoryRoot(t)
	aiRoot := filepath.Join(root, "internal", "ai")
	var violations []string
	err := filepath.WalkDir(aiRoot, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || filepath.Ext(path) != ".go" || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		source, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		found, err := inspectAgentBoundarySource(rel, source, strings.HasPrefix(filepath.ToSlash(rel), "internal/ai/threadstore/"))
		if err != nil {
			return err
		}
		violations = append(violations, found...)
		return nil
	})
	if err != nil {
		t.Fatalf("scan AI production contracts: %v", err)
	}
	if len(violations) > 0 {
		sort.Strings(violations)
		t.Fatalf("removed Agent shadow contracts returned:\n%s", strings.Join(violations, "\n"))
	}
}

func TestAgentShadowContractScannerRejectsForbiddenShapes(t *testing.T) {
	testCases := []struct {
		name       string
		source     string
		durable    bool
		wantIssues int
	}{
		{name: "legal live diagnostic", source: `package fixture; var live = map[string]any{"recent_errors": nil}`},
		{name: "removed type", source: `package fixture; type DialogueTurn struct{}`, wantIssues: 1},
		{name: "removed field", source: `package fixture; type State struct { PendingToolCalls []string }`, wantIssues: 1},
		{name: "removed JSON tag", source: "package fixture; type State struct { Value string `json:\"estimate_source,omitempty\"` }", wantIssues: 1},
		{name: "durable anonymous JSON key", source: `package fixture; var stored = map[string]any{"active_objective_digest": "digest"}`, durable: true, wantIssues: 1},
		{name: "durable encoded JSON key", source: "package fixture; const stored = `{\"pending_user_input_queue\":[]}`", durable: true, wantIssues: 1},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			issues, err := inspectAgentBoundarySource("fixture.go", []byte(testCase.source), testCase.durable)
			if err != nil {
				t.Fatal(err)
			}
			if len(issues) != testCase.wantIssues {
				t.Fatalf("issues=%v, want %d", issues, testCase.wantIssues)
			}
		})
	}
}

func TestTodoRuntimeStateShapeIsExact(t *testing.T) {
	typeOfState := reflect.TypeOf(todoRuntimeState{})
	want := []string{
		"TodoTrackingEnabled",
		"TodoTotalCount",
		"TodoOpenCount",
		"TodoInProgressCount",
		"TodoSnapshotVersion",
		"TodoLastUpdatedRound",
	}
	if typeOfState.NumField() != len(want) {
		t.Fatalf("todoRuntimeState fields=%d, want %d", typeOfState.NumField(), len(want))
	}
	for index, name := range want {
		field := typeOfState.Field(index)
		if field.Name != name {
			t.Fatalf("todoRuntimeState field %d=%q, want %q", index, field.Name, name)
		}
		if field.Tag != "" {
			t.Fatalf("todoRuntimeState field %q has serialization tag %q", field.Name, field.Tag)
		}
	}
	if state := newTodoRuntimeState(); state.TodoLastUpdatedRound != -1 {
		t.Fatalf("new todo state last updated round=%d, want -1", state.TodoLastUpdatedRound)
	}
}

func inspectAgentBoundarySource(filename string, source []byte, durable bool) ([]string, error) {
	file, err := parser.ParseFile(token.NewFileSet(), filename, source, parser.SkipObjectResolution)
	if err != nil {
		return nil, fmt.Errorf("parse %s: %w", filename, err)
	}
	var violations []string
	ast.Inspect(file, func(node ast.Node) bool {
		switch typed := node.(type) {
		case *ast.TypeSpec:
			if _, forbidden := forbiddenAgentShadowTypes[typed.Name.Name]; forbidden {
				violations = append(violations, fmt.Sprintf("%s: forbidden type %s", filename, typed.Name.Name))
			}
		case *ast.Field:
			for _, name := range typed.Names {
				if _, forbidden := forbiddenAgentShadowFields[name.Name]; forbidden {
					violations = append(violations, fmt.Sprintf("%s: forbidden field %s", filename, name.Name))
				}
			}
			if typed.Tag != nil {
				tag, unquoteErr := strconv.Unquote(typed.Tag.Value)
				if unquoteErr == nil {
					jsonName := strings.Split(reflect.StructTag(tag).Get("json"), ",")[0]
					if _, forbidden := forbiddenAgentShadowJSONKeys[jsonName]; forbidden {
						violations = append(violations, fmt.Sprintf("%s: forbidden JSON tag %s", filename, jsonName))
					}
				}
			}
		case *ast.BasicLit:
			if !durable || typed.Kind != token.STRING {
				break
			}
			value, unquoteErr := strconv.Unquote(typed.Value)
			if unquoteErr != nil {
				break
			}
			for key := range forbiddenAgentShadowJSONKeys {
				if value == key || strings.Contains(value, `"`+key+`"`+":") {
					violations = append(violations, fmt.Sprintf("%s: forbidden durable JSON key %s", filename, key))
				}
			}
		}
		return true
	})
	return violations, nil
}

func aiRepositoryRoot(t *testing.T) string {
	t.Helper()
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve boundary test source path")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(currentFile), "..", ".."))
}
