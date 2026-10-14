package gatewaystate

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestVersionedReadRejectsOldAndFutureSchemasWithoutRewrite(t *testing.T) {
	for _, body := range []string{`{"schema_version":4,"retired_secret":"do-not-expose"}`, `{"schema_version":6}`} {
		file := filepath.Join(t.TempDir(), "members.json")
		if err := os.WriteFile(file, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
		var current struct {
			SchemaVersion int `json:"schema_version"`
		}
		err := ReadVersioned(file, &current, 5)
		var rejected *ReadError
		if !errors.As(err, &rejected) || rejected.Code != "gateway_state_unsupported" || !errors.Is(err, ErrState) {
			t.Fatalf("error = %v", err)
		}
		if strings.Contains(err.Error(), "do-not-expose") || current.SchemaVersion != 0 {
			t.Fatal("rejected state leaked or was decoded")
		}
		after, _ := os.ReadFile(file)
		if string(after) != body {
			t.Fatal("rejected state was rewritten")
		}
	}
}

func TestVersionedReadDistinguishesInvalidAndMissingState(t *testing.T) {
	file := filepath.Join(t.TempDir(), "members.json")
	var current struct {
		SchemaVersion int `json:"schema_version"`
	}
	if err := ReadVersioned(file, &current, 5); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing file = %v", err)
	}
	for _, body := range []string{`{"schema_version":5,"secret":"do-not-expose"}`, `{"schema_version":5} {}`, `invalid-secret`} {
		if err := os.WriteFile(file, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
		var rejected *ReadError
		err := ReadVersioned(file, &current, 5)
		if !errors.As(err, &rejected) || rejected.Code != "gateway_state_invalid" || strings.Contains(err.Error(), "secret") {
			t.Fatalf("invalid file = %v", err)
		}
	}
}
