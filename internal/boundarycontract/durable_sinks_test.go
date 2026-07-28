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
	registry = roundTripRegistry(t, root, registry)
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

func TestScanRecognizesAliasedGoSinksAndCrossFileCodecCalls(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "internal/store/codec.go", `package store
import wire "encoding/json"
type AssistantOutputEnvelope struct { Value string }
func encode() []byte { body, _ := wire.Marshal(AssistantOutputEnvelope{}); return body }
`)
	writeFixture(t, root, "internal/store/write.go", `package store
import (disk "os"; stream "io")
func save(file *disk.File) {
	_ = disk.WriteFile("state.json", encode(), 0600)
	_, _ = file.Write(encode())
	_, _ = file.WriteString("state")
	_, _ = stream.WriteString(file, "state")
}
`)
	writeFixture(t, root, "internal/store/encoder.go", `package store
import (wire "encoding/json"; disk "os")
func stream(file *disk.File) { encoder := wire.NewEncoder(file); _ = encoder.Encode(AssistantOutputEnvelope{}) }
`)
	findings, err := Scan(root)
	if err != nil {
		t.Fatal(err)
	}
	byPath := findingsByPath(findings)
	writeFinding := byPath["internal/store/write.go"]
	if !contains(writeFinding.SinkKinds, "json_file") || !contains(writeFinding.Codecs, "encoding/json.Marshal") || !contains(writeFinding.DTOs, "AssistantOutputEnvelope{}") {
		t.Fatalf("cross-file codec/write combination not inventoried: %#v", writeFinding)
	}
	encoderFinding := byPath["internal/store/encoder.go"]
	if !contains(encoderFinding.SinkKinds, "json_file") || !contains(encoderFinding.Codecs, "encoding/json.NewEncoder") || !contains(encoderFinding.DTOs, "AssistantOutputEnvelope{}") {
		t.Fatalf("encoder sink not inventoried: %#v", encoderFinding)
	}
}

func TestScanRecognizesAliasedSQLCallsAndDynamicExpressions(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "internal/store/sql.go", `package store
import (dbsql "database/sql"; "context")
func save(ctx context.Context, db *dbsql.DB, statement string) {
	_, _ = db.ExecContext(ctx, statement)
	_, _ = db.Query(statement)
	_, _ = db.Prepare(statement)
}
`)
	findings, err := Scan(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(findings) != 1 || !contains(findings[0].SinkKinds, "sqlite") || !contains(findings[0].Tables, "expression:statement") {
		t.Fatalf("dynamic SQL was not fail-closed: %#v", findings)
	}
}

func TestScanRecognizesTypeScriptAliasesAndBrowserGlobals(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "desktop/store.ts", `
import * as disk from "node:fs";
import { writeFile as persist, promises as asyncDisk } from "node:fs";
const prefs = globalThis.localStorage;
disk.appendFileSync("audit", "x");
persist("state", "x", () => {});
asyncDisk.writeFile("async", "x");
prefs.setItem("assistantOutputCache", "x");
self.indexedDB.open("conversation_turns");
window.caches.open("agent-cache");
`)
	findings, err := Scan(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(findings) != 1 {
		t.Fatalf("findings=%#v", findings)
	}
	finding := findings[0]
	for _, kind := range []string{"file", "web_storage", "indexed_db", "cache_storage"} {
		if !contains(finding.SinkKinds, kind) {
			t.Errorf("missing %s in %#v", kind, finding)
		}
	}
	for _, key := range []string{"assistantOutputCache", "conversation_turns", "agent-cache"} {
		if !contains(finding.Keys, key) {
			t.Errorf("missing key %s in %#v", key, finding)
		}
	}
}

func TestRegistryWriterLeavesNewAndChangedSinksPendingReview(t *testing.T) {
	root := t.TempDir()
	const path = "internal/store/write.go"
	writeFixture(t, root, path, `package store; import disk "os"; func save() { _ = disk.WriteFile("state", nil, 0600) }`)
	findings, err := Scan(root)
	if err != nil {
		t.Fatal(err)
	}
	registry := RefreshRegistry(Registry{Version: RegistryVersion}, findings)
	registryPath := filepath.Join(root, "scripts", "contracts", "durable_sink_registry.json")
	if err := os.MkdirAll(filepath.Dir(registryPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := WriteRegistry(registryPath, registry); err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadRegistry(registryPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := loaded.Entries[0]; got.ReviewStatus != ReviewStatusPendingReview || got.Owner != "" || got.Authority != "" || len(got.DataClasses) != 0 {
		t.Fatalf("new sink was implicitly signed: %#v", got)
	}
	if issues := Validate(loaded, findings); !strings.Contains(strings.Join(issues, "\n"), "requires explicit review") {
		t.Fatalf("pending registry validated: %v", issues)
	}

	reviewed := NewReviewedEntry(findings[0])
	reviewed.Owner = "product settings"
	reviewed.Authority = "product_configuration"
	reviewed.DataClasses = []string{"product preference"}
	reviewed.ReviewNote = "Explicitly reviewed product preference."
	approved := Registry{Version: RegistryVersion, Entries: []RegistryEntry{reviewed}}
	if issues := Validate(approved, findings); len(issues) != 0 {
		t.Fatalf("explicit registry rejected: %v", issues)
	}
	refreshed := RefreshRegistry(approved, findings)
	if refreshed.Entries[0].ReviewStatus != ReviewStatusReviewed || refreshed.Entries[0].Owner != reviewed.Owner {
		t.Fatalf("exact reviewed metadata was not preserved: %#v", refreshed.Entries[0])
	}

	writeFixture(t, root, path, `package store; import disk "os"; func save() { _ = disk.WriteFile("renamed", nil, 0600) }`)
	changed, err := Scan(root)
	if err != nil {
		t.Fatal(err)
	}
	refreshed = RefreshRegistry(approved, changed)
	if refreshed.Entries[0].ReviewStatus != ReviewStatusPendingReview || refreshed.Entries[0].Owner != "" {
		t.Fatalf("changed fingerprint retained approval: %#v", refreshed.Entries[0])
	}
}

func TestEndToEndRejectsRenamedShadowStorageThroughAliases(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "internal/store/codec.go", `package store
import wire "encoding/json"
type AssistantOutputEnvelope struct { Value string }
func renamedCodec() []byte { data, _ := wire.Marshal(AssistantOutputEnvelope{}); return data }
`)
	writeFixture(t, root, "internal/store/write.go", `package store
import disk "os"
func save() { _ = disk.WriteFile("cache", renamedCodec(), 0600) }
`)
	writeFixture(t, root, "internal/store/sql.go", `package store
import dbsql "database/sql"
func saveSQL(db *dbsql.DB) { _, _ = db.Exec("INSERT INTO conversation_turns(id) VALUES (?)", "1") }
`)
	writeFixture(t, root, "internal/store/browser.ts", `
import { writeFile as renamedWriteAPI } from "node:fs";
const renamedStorage = window.localStorage;
renamedStorage.setItem("assistantOutputCache", "x");
renamedWriteAPI("payload", "x", () => {});
`)
	findings, err := Scan(root)
	if err != nil {
		t.Fatal(err)
	}
	registry := RefreshRegistry(Registry{Version: RegistryVersion}, findings)
	for i := range registry.Entries {
		entry := &registry.Entries[i]
		entry.ReviewStatus = ReviewStatusReviewed
		entry.Owner = "product state"
		entry.Authority = "product_configuration"
		entry.DataClasses = []string{"product-owned state"}
		entry.ReviewNote = "Explicit review fixture."
	}
	registry = roundTripRegistry(t, root, registry)
	issues := strings.Join(Validate(registry, findings), "\n")
	for _, identifier := range []string{"assistant_output", "conversation_turns"} {
		if !strings.Contains(issues, identifier) {
			t.Errorf("renamed shadow identifier %q escaped validation: %s", identifier, issues)
		}
	}
}

func roundTripRegistry(t *testing.T, root string, registry Registry) Registry {
	t.Helper()
	path := filepath.Join(root, "scripts", "contracts", "durable_sink_registry.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := WriteRegistry(path, registry); err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadRegistry(path)
	if err != nil {
		t.Fatal(err)
	}
	return loaded
}

func findingsByPath(findings []Finding) map[string]Finding {
	result := make(map[string]Finding, len(findings))
	for _, finding := range findings {
		result[finding.Path] = finding
	}
	return result
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
