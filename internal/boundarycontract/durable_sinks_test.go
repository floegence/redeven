package boundarycontract

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestClosedSetRejectsUnregisteredDurableSinksAcrossLanguages(t *testing.T) {
	fixtures := map[string]string{
		"internal/store/write.go":   `package store; import "os"; func save() { _ = os.WriteFile("state.json", nil, 0600) }`,
		"internal/store/schema.sql": `INSERT INTO product_state(id) VALUES ('one');`,
		"internal/ui/settings.tsx":  `export const save = () => localStorage.setItem("theme", "dark")`,
		"desktop/bridge/session.ts": `export const save = () => sessionStorage.setItem("window", "open")`,
		"internal/ui/indexed.ts":    `export const open = () => indexedDB.open("product")`,
		"internal/ui/cache.ts":      `export const open = () => caches.open("product-assets")`,
	}
	for path, source := range fixtures {
		t.Run(strings.ReplaceAll(path, "/", "_"), func(t *testing.T) {
			root := t.TempDir()
			writeFixture(t, root, path, source)
			findings, err := Scan(root)
			if err != nil {
				t.Fatal(err)
			}
			issues := Validate(Registry{Version: RegistryVersion}, findings)
			if len(findings) != 1 || len(issues) != 1 || !strings.Contains(issues[0], "unregistered durable sink") {
				t.Fatalf("findings=%#v issues=%v", findings, issues)
			}
		})
	}
}

func TestClosedSetAcceptsExplicitReviewedProductSinks(t *testing.T) {
	root := t.TempDir()
	fixtures := map[string]string{
		"internal/queue/store.go": `package queue; import "database/sql"; func save(db *sql.DB) { _, _ = db.Exec("INSERT INTO queued_commands(id) VALUES (?)", "q") }`,
		"internal/audit/store.go": `package audit; import ("encoding/json"; "os"); func save(v any) { b, _ := json.Marshal(v); _ = os.WriteFile("audit.json", b, 0600) }`,
		"internal/ui/theme.ts":    `export const save = () => localStorage.setItem("redeven.theme", "dark")`,
	}
	for path, source := range fixtures {
		writeFixture(t, root, path, source)
	}
	findings, err := Scan(root)
	if err != nil {
		t.Fatal(err)
	}
	registry := Registry{Version: RegistryVersion}
	for _, finding := range findings {
		entry := NewReviewedEntry(finding)
		switch finding.Path {
		case "internal/queue/store.go":
			entry.Authority = "product_coordination"
			entry.Tables = []string{"queued_commands"}
			entry.DataClasses = []string{"unadmitted command"}
		case "internal/audit/store.go":
			entry.Authority = "security_audit"
			entry.DataClasses = []string{"product permission audit"}
		case "internal/ui/theme.ts":
			entry.Authority = "browser_ui_preference"
			entry.Keys = []string{"redeven.theme"}
			entry.DataClasses = []string{"theme preference"}
		}
		registry.Entries = append(registry.Entries, entry)
	}
	if issues := Validate(registry, findings); len(issues) != 0 {
		t.Fatalf("reviewed legal sinks rejected: %v", issues)
	}
}

func TestClosedSetRejectsChangedAndStaleRegistrations(t *testing.T) {
	root := t.TempDir()
	const path = "internal/store/write.go"
	const source = `package store; import "os"; func save() { _ = os.WriteFile("state", nil, 0600) }`
	writeFixture(t, root, path, source)
	findings, err := Scan(root)
	if err != nil {
		t.Fatal(err)
	}
	entry := NewReviewedEntry(findings[0])
	entry.SHA256 = strings.Repeat("0", 64)
	staleBody := sha256.Sum256([]byte("stale"))
	stale := NewReviewedEntry(Finding{Path: "internal/store/removed.go", SHA256: hex.EncodeToString(staleBody[:]), SinkKinds: []string{"file"}})
	issues := Validate(Registry{Version: RegistryVersion, Entries: []RegistryEntry{entry, stale}}, findings)
	joined := strings.Join(issues, "\n")
	if !strings.Contains(joined, "changed after review") || !strings.Contains(joined, "stale durable sink registry entry") {
		t.Fatalf("issues=%v", issues)
	}
}

func TestClosedSetRejectsRegisteredCanonicalAgentState(t *testing.T) {
	finding := Finding{
		Path:      "internal/store/messages.go",
		SHA256:    strings.Repeat("a", 64),
		SinkKinds: []string{"sqlite"},
		Tables:    []string{"ai_messages"},
	}
	entry := NewReviewedEntry(finding)
	entry.DataClasses = []string{"canonical message and turn lifecycle"}
	issues := Validate(Registry{Version: RegistryVersion, Entries: []RegistryEntry{entry}}, []Finding{finding})
	joined := strings.Join(issues, "\n")
	if !strings.Contains(joined, "forbidden Floret-owned data class") || !strings.Contains(joined, "forbidden Agent shadow storage identifier") {
		t.Fatalf("issues=%v", issues)
	}
}

func TestClosedSetRejectsRenamedLifecyclePayloadMetadata(t *testing.T) {
	finding := Finding{
		Path:      "internal/store/product_cache.go",
		SHA256:    strings.Repeat("b", 64),
		SinkKinds: []string{"json_file"},
		Codecs:    []string{"encoding/json.Marshal"},
		DTOs:      []string{"assistantOutputEnvelope"},
	}
	entry := NewReviewedEntry(finding)
	entry.DataClasses = []string{"product-owned state"}
	issues := Validate(Registry{Version: RegistryVersion, Entries: []RegistryEntry{entry}}, []Finding{finding})
	if joined := strings.Join(issues, "\n"); !strings.Contains(joined, "forbidden Agent shadow storage identifier") {
		t.Fatalf("issues=%v", issues)
	}
}

func TestClosedSetRejectsRegistryInventoryThatDoesNotMatchScanner(t *testing.T) {
	finding := Finding{
		Path:      "internal/store/preferences.ts",
		SHA256:    strings.Repeat("c", 64),
		SinkKinds: []string{"web_storage"},
		Keys:      []string{"redeven.theme"},
	}
	entry := NewReviewedEntry(finding)
	entry.Keys = []string{"redeven.layout"}
	issues := Validate(Registry{Version: RegistryVersion, Entries: []RegistryEntry{entry}}, []Finding{finding})
	if joined := strings.Join(issues, "\n"); !strings.Contains(joined, "durable sink keys") {
		t.Fatalf("issues=%v", issues)
	}
}

func writeFixture(t *testing.T, root, path, source string) {
	t.Helper()
	target := filepath.Join(root, filepath.FromSlash(path))
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte(source), 0o600); err != nil {
		t.Fatal(err)
	}
}
