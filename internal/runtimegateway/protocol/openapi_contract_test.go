package protocol

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestGatewayOpenAPIContractExposesAccessOnlySurface(t *testing.T) {
	root := filepath.Join("..", "..", "..")
	raw, err := os.ReadFile(filepath.Join(root, "spec", "openapi", "gateway-v2.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	var document struct {
		Paths map[string]map[string]any `yaml:"paths"`
	}
	if err := yaml.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"/gateway/v2/pairing/challenge",
		"/gateway/v2/pairing/complete",
		"/gateway/v2/catalog",
		"/gateway/v2/open-session",
		"/gateway/v2/env-profiles/upsert",
		"/gateway/v2/env-profiles/delete",
	}
	if len(document.Paths) != len(want) {
		t.Fatalf("Gateway OpenAPI path count = %d, want %d", len(document.Paths), len(want))
	}
	for _, path := range want {
		if _, ok := document.Paths[path]; !ok {
			t.Fatalf("Gateway OpenAPI contract is missing access path %q", path)
		}
	}
	for path := range document.Paths {
		if strings.Contains(path, "runtime") || strings.Contains(path, "lifecycle") {
			t.Fatalf("Gateway OpenAPI contract exposes Runtime lifecycle path %q", path)
		}
	}
}
