package terminal

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestTerminalRPCTypeIDsAreUnique(t *testing.T) {
	typeIDs := map[uint32]string{}
	for name, typeID := range map[string]uint32{
		"session create":            TypeID_TERMINAL_SESSION_CREATE,
		"session list":              TypeID_TERMINAL_SESSION_LIST,
		"history":                   TypeID_TERMINAL_HISTORY,
		"clear":                     TypeID_TERMINAL_CLEAR,
		"session delete":            TypeID_TERMINAL_SESSION_DELETE,
		"name update":               TypeID_TERMINAL_NAME_UPDATE,
		"session stats":             TypeID_TERMINAL_SESSION_STATS,
		"sessions changed":          TypeID_TERMINAL_SESSIONS_CHANGED,
		"foreground command update": TypeID_TERMINAL_FOREGROUND_COMMAND_UPDATE,
		"output activity update":    TypeID_TERMINAL_OUTPUT_ACTIVITY_UPDATE,
	} {
		if previous, exists := typeIDs[typeID]; exists {
			t.Fatalf("terminal RPC Type ID %d is shared by %q and %q", typeID, previous, name)
		}
		typeIDs[typeID] = name
	}

	if TypeID_TERMINAL_OUTPUT_ACTIVITY_UPDATE != 2014 {
		t.Fatalf("output activity Type ID = %d, want 2014", TypeID_TERMINAL_OUTPUT_ACTIVITY_UPDATE)
	}
}

func TestOutputActivityRPCTypeIDIsGloballyUnique(t *testing.T) {
	repoRoot := filepath.Clean(filepath.Join("..", ".."))
	internalRoot := filepath.Join(repoRoot, "internal")
	locations := make([]string, 0, 1)
	files := token.NewFileSet()

	err := filepath.WalkDir(internalRoot, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || filepath.Ext(path) != ".go" || strings.HasSuffix(path, "_test.go") {
			return nil
		}

		file, err := parser.ParseFile(files, path, nil, 0)
		if err != nil {
			return err
		}
		ast.Inspect(file, func(node ast.Node) bool {
			spec, ok := node.(*ast.ValueSpec)
			if !ok {
				return true
			}
			for index, name := range spec.Names {
				if !strings.Contains(strings.ToLower(name.Name), "typeid") || index >= len(spec.Values) {
					continue
				}
				literal, ok := spec.Values[index].(*ast.BasicLit)
				if !ok || literal.Kind != token.INT {
					continue
				}
				value, err := strconv.ParseUint(literal.Value, 0, 32)
				if err == nil && uint32(value) == TypeID_TERMINAL_OUTPUT_ACTIVITY_UPDATE {
					position := files.Position(name.Pos())
					locations = append(locations, position.String()+" "+name.Name)
				}
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatalf("scan global RPC Type IDs: %v", err)
	}
	if len(locations) != 1 {
		t.Fatalf("RPC Type ID %d declarations = %v, want only terminal output activity", TypeID_TERMINAL_OUTPUT_ACTIVITY_UPDATE, locations)
	}
}
