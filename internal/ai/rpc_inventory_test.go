package ai

import (
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"testing"
)

func TestAIRPCInventoryMatchesTypeScriptProtocol(t *testing.T) {
	path := filepath.Join("..", "envapp", "ui_src", "src", "ui", "protocol", "redeven_v1", "typeIds.ts")
	source, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile(%q) error = %v", path, err)
	}

	match := regexp.MustCompile(`(?s)ai:\s*\{(.*?)\n\s*\},`).FindSubmatch(source)
	if len(match) != 2 {
		t.Fatal("TypeScript protocol does not contain an ai type ID block")
	}
	entryPattern := regexp.MustCompile(`(?m)^\s*([A-Za-z][A-Za-z0-9]*):\s*([0-9]+),\s*$`)
	tsIDs := make(map[string]uint32)
	for _, entry := range entryPattern.FindAllSubmatch(match[1], -1) {
		value, parseErr := strconv.ParseUint(string(entry[2]), 10, 32)
		if parseErr != nil {
			t.Fatalf("parse TypeScript type ID %q: %v", entry[2], parseErr)
		}
		tsIDs[string(entry[1])] = uint32(value)
	}

	inventory := RPCMethodInventory()
	if len(tsIDs) != len(inventory) {
		t.Fatalf("TypeScript AI RPC count = %d, Go inventory count = %d", len(tsIDs), len(inventory))
	}
	for _, method := range inventory {
		if got, ok := tsIDs[method.Method]; !ok || got != method.TypeID {
			t.Errorf("TypeScript AI RPC %s = %d (present %v), want %d", method.Method, got, ok, method.TypeID)
		}
	}
}
