package boundarycontract

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"reflect"
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

func TestScanStopsOnlyAtValidNestedGitRepositoryRoots(t *testing.T) {
	const sink = `package nested; import "os"; func save() { _ = os.WriteFile("state.json", nil, 0600) }`

	t.Run("repository directory", func(t *testing.T) {
		root := t.TempDir()
		writeFixture(t, root, "tools/checkout/.git/HEAD", "ref: refs/heads/main\n")
		writeFixture(t, root, "tools/checkout/internal/store.go", sink)

		findings, err := Scan(root)
		if err != nil {
			t.Fatal(err)
		}
		if len(findings) != 0 {
			t.Fatalf("nested repository escaped its boundary: %#v", findings)
		}
	})

	t.Run("worktree marker", func(t *testing.T) {
		root := t.TempDir()
		gitDir := filepath.Join(root, "git-metadata", "worktrees", "feature")
		if err := os.MkdirAll(gitDir, 0o755); err != nil {
			t.Fatal(err)
		}
		writeFixture(t, root, "tools/worktree/.git", "gitdir: "+gitDir+"\n")
		writeFixture(t, root, "tools/worktree/internal/store.go", sink)

		findings, err := Scan(root)
		if err != nil {
			t.Fatal(err)
		}
		if len(findings) != 0 {
			t.Fatalf("nested worktree escaped its boundary: %#v", findings)
		}
	})

	for name, marker := range map[string]string{
		"malformed marker": "not-a-git-marker\n",
		"missing gitdir":   "gitdir: ../missing\n",
	} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			writeFixture(t, root, "tools/source/.git", marker)
			writeFixture(t, root, "tools/source/internal/store.go", sink)

			findings, err := Scan(root)
			if err != nil {
				t.Fatal(err)
			}
			if len(findings) != 1 || findings[0].Path != "tools/source/internal/store.go" {
				t.Fatalf("invalid Git marker hid a durable sink: %#v", findings)
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

func TestScanPropagatesGoDurableCapabilitiesAcrossFilesAndWrappers(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "internal/store/open.go", `package store
import ("io"; disk "os")
func OpenProductWriter(path string) (io.WriteCloser, error) { return openProductWriter(path) }
func openProductWriter(path string) (io.WriteCloser, error) { return disk.Create(path) }
`)
	writeFixture(t, root, "internal/store/codec_leaf.go", `package store
import wire "encoding/json"
type BloomParcel struct { Value string }
func encodeLeaf(value BloomParcel) []byte { body, _ := wire.Marshal(value); return body }
`)
	writeFixture(t, root, "internal/store/codec_wrapper.go", `package store
func encodeMiddle(value BloomParcel) []byte { return encodeLeaf(value) }
func encodeOuter(value BloomParcel) []byte { return encodeMiddle(value) }
`)
	writeFixture(t, root, "internal/store/write.go", `package store
import ("bufio"; "io")
func save(path string, value BloomParcel) error {
	raw, err := OpenProductWriter(path)
	if err != nil { return err }
	buffered := bufio.NewWriter(raw)
	if _, err := buffered.Write(encodeOuter(value)); err != nil { return err }
	_, err = io.WriteString(buffered, "\n")
	return err
}
`)
	writeFixture(t, root, "internal/store/sql_types.go", `package store
type statementRunner interface {
	Exec(statement string, args ...any) (any, error)
	ExecContext(ctx any, statement string, args ...any) (any, error)
	Query(statement string, args ...any) (any, error)
	QueryContext(ctx any, statement string, args ...any) (any, error)
	Prepare(statement string) (any, error)
	PrepareContext(ctx any, statement string) (any, error)
}
`)
	writeFixture(t, root, "internal/store/sql_wrapper.go", `package store
func applyStatement(handle statementRunner, statement string) {
	_, _ = handle.Exec(statement)
	_, _ = handle.ExecContext(nil, statement)
	_, _ = handle.Query(statement)
	_, _ = handle.QueryContext(nil, statement)
	_, _ = handle.Prepare(statement)
	_, _ = handle.PrepareContext(nil, statement)
}
`)
	writeFixture(t, root, "internal/store/method.go", `package store
import (dbsql "database/sql"; "io")
type durableRepo struct {
	db *dbsql.DB
	output io.WriteCloser
}
func (repo *durableRepo) save(statement string, body []byte) {
	_, _ = repo.db.Exec(statement)
	_, _ = repo.output.Write(body)
}
`)
	writeFixture(t, root, "internal/store/method_caller.go", `package store
func delegateSave(repo *durableRepo, statement string, body []byte) {
	repo.save(statement, body)
}
`)

	findings, err := Scan(root)
	if err != nil {
		t.Fatal(err)
	}
	byPath := findingsByPath(findings)
	writer := byPath["internal/store/write.go"]
	if !contains(writer.SinkKinds, "file") || !contains(writer.SinkKinds, "json_file") {
		t.Fatalf("wrapped writer capability was not propagated: %#v", writer)
	}
	if !contains(writer.Codecs, "encoding/json.Marshal") || !contains(writer.DTOs, "value") {
		t.Fatalf("multi-layer codec capability was not propagated: %#v", writer)
	}
	sqlWrapper := byPath["internal/store/sql_wrapper.go"]
	if !contains(sqlWrapper.SinkKinds, "sqlite") || !contains(sqlWrapper.Tables, "expression:statement") {
		t.Fatalf("interface SQL capability was not propagated: %#v", sqlWrapper)
	}
	method := byPath["internal/store/method.go"]
	if !contains(method.SinkKinds, "file") || !contains(method.SinkKinds, "sqlite") || !contains(method.Tables, "expression:statement") {
		t.Fatalf("struct receiver durable capabilities were not propagated: %#v", method)
	}
	methodCaller := byPath["internal/store/method_caller.go"]
	if !contains(methodCaller.SinkKinds, "file") || !contains(methodCaller.SinkKinds, "sqlite") || !contains(methodCaller.Tables, "expression:statement") {
		t.Fatalf("method durable effects were not propagated to caller: %#v", methodCaller)
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

func TestThreadstoreBoundaryManifestRejectsSchemaAndQueryDrift(t *testing.T) {
	table := ThreadstoreTableContract{
		Table: "product_rows", Columns: []string{"row_id"}, Indexes: []string{"idx_product_rows"},
		Owner: "redeven", Authority: "product_settings", DataClass: "product setting",
		AllowedPurpose: "store a product setting", AllowedLookupKeys: []string{"row_id"}, Consumers: []string{"settings service"},
		RetentionOrDeletion: "deleted with the product setting", CanonicalIdentity: "none", APIUIVisibility: "product setting only",
		LifecycleProhibition: "must not provide Agent lifecycle inventory, timeline, status, or search",
	}
	query := ThreadstoreQueryContract{
		ID: "threadstore.fixture", Path: "internal/ai/threadstore/fixture.go", Function: "Store.readFixture", Method: "QueryRowContext",
		SQLSHA256: strings.Repeat("a", 64), Tables: []string{"product_rows"}, LookupKeys: []string{"row_id"}, Action: "read", Consumer: "Store.readFixture", ConsumerKind: "product_operation",
	}
	manifest := ThreadstoreBoundaryManifest{Version: ThreadstoreBoundaryManifestVersion, Tables: []ThreadstoreTableContract{table}, Queries: []ThreadstoreQueryContract{query}}
	manifest = RefreshThreadstoreUsageContracts(manifest)
	if issues := ValidateThreadstoreBoundaryManifest(manifest, map[string][]string{"product_rows": {"row_id"}}, map[string]string{"idx_product_rows": "product_rows"}, map[string]string{}, []ThreadstoreQueryContract{query}); len(issues) != 0 {
		t.Fatalf("valid fixture rejected: %v", issues)
	}
	if issues := ValidateThreadstoreBoundaryManifest(manifest, map[string][]string{"product_rows": {"row_id"}, "shadow_rows": {"id"}}, map[string]string{"idx_product_rows": "product_rows"}, nil, []ThreadstoreQueryContract{query}); !issuesContain(issues, "schema table shadow_rows has no reviewed owner") {
		t.Fatalf("schema omission was accepted: %v", issues)
	}
	changed := query
	changed.SQLSHA256 = strings.Repeat("b", 64)
	if issues := ValidateThreadstoreBoundaryManifest(manifest, map[string][]string{"product_rows": {"row_id"}}, map[string]string{"idx_product_rows": "product_rows"}, nil, []ThreadstoreQueryContract{changed}); !issuesContain(issues, "changed after review") {
		t.Fatalf("query drift was accepted: %v", issues)
	}
	dynamic := query
	dynamic.SQLSHA256 = ""
	dynamic.BuilderSHA256 = strings.Repeat("c", 64)
	dynamic.DynamicReview = "reviewed fixture builder"
	dynamic.RenderedSQLExpr = "query"
	manifest.Queries = []ThreadstoreQueryContract{dynamic}
	manifest = RefreshThreadstoreUsageContracts(manifest)
	changedDynamic := dynamic
	changedDynamic.BuilderSHA256 = strings.Repeat("d", 64)
	if issues := ValidateThreadstoreBoundaryManifest(manifest, map[string][]string{"product_rows": {"row_id"}}, map[string]string{"idx_product_rows": "product_rows"}, nil, []ThreadstoreQueryContract{changedDynamic}); !issuesContain(issues, "changed after review") {
		t.Fatalf("dynamic builder drift was accepted: %v", issues)
	}
}

func TestThreadstoreBoundaryManifestRejectsUnreviewedDynamicSQL(t *testing.T) {
	table := ThreadstoreTableContract{
		Table: "product_rows", Columns: []string{"row_id"}, Owner: "redeven", Authority: "product_settings", DataClass: "product setting",
		AllowedPurpose: "store a product setting", Consumers: []string{"settings service"}, RetentionOrDeletion: "deleted with the product setting",
		CanonicalIdentity: "none", APIUIVisibility: "product setting only", LifecycleProhibition: "must not provide Agent lifecycle inventory, timeline, status, or search",
	}
	query := ThreadstoreQueryContract{
		ID: "threadstore.dynamic", Path: "internal/ai/threadstore/fixture.go", Function: "Store.readFixture",
		Method: "QueryContext", BuilderSHA256: strings.Repeat("a", 64), Tables: []string{"product_rows"}, Action: "read", Consumer: "Store.readFixture", ConsumerKind: "product_operation", RenderedSQLExpr: "query",
	}
	manifest := ThreadstoreBoundaryManifest{Version: ThreadstoreBoundaryManifestVersion, Tables: []ThreadstoreTableContract{table}, Queries: []ThreadstoreQueryContract{query}}
	if issues := ValidateThreadstoreBoundaryManifest(manifest, map[string][]string{"product_rows": {"row_id"}}, nil, nil, []ThreadstoreQueryContract{query}); !issuesContain(issues, "requires an explicit review exception") {
		t.Fatalf("unreviewed dynamic SQL was accepted: %v", issues)
	}
}

func TestThreadstoreBoundaryManifestRejectsUnboundDML(t *testing.T) {
	table := ThreadstoreTableContract{
		Table: "product_rows", Columns: []string{"row_id"}, Owner: "redeven", Authority: "product_settings", DataClass: "product setting",
		AllowedPurpose: "store a product setting", Consumers: []string{"settings service"}, RetentionOrDeletion: "deleted with the product setting",
		CanonicalIdentity: "none", APIUIVisibility: "product setting only", LifecycleProhibition: "must not provide Agent lifecycle inventory, timeline, status, or search",
	}
	query := ThreadstoreQueryContract{
		ID: "threadstore.unbound-dml", Path: "internal/ai/threadstore/fixture.go", Function: "Store.writeFixture", Method: "ExecContext",
		SQLSHA256: strings.Repeat("a", 64), Action: "insert", Consumer: "Store.writeFixture", ConsumerKind: "product_operation",
	}
	manifest := ThreadstoreBoundaryManifest{Version: ThreadstoreBoundaryManifestVersion, Tables: []ThreadstoreTableContract{table}, Queries: []ThreadstoreQueryContract{query}}
	issues := ValidateThreadstoreBoundaryManifest(manifest, map[string][]string{"product_rows": {"row_id"}}, nil, nil, []ThreadstoreQueryContract{query})
	if !issuesContain(issues, "has no owned table") || !issuesContain(issues, "has no reviewed write columns") {
		t.Fatalf("unbound DML was accepted: %v", issues)
	}
}

func TestExtractSQLTablesSupportsSQLiteInsertConflictActions(t *testing.T) {
	for _, action := range []string{"ROLLBACK", "ABORT", "REPLACE", "FAIL", "IGNORE"} {
		t.Run(action, func(t *testing.T) {
			sqlText := "INSERT OR " + action + " INTO product_rows(row_id) VALUES(?)"
			tables := extractSQLTables([]byte(sqlText))
			if !reflect.DeepEqual(tables, []string{"product_rows"}) {
				t.Fatalf("INSERT OR %s tables = %v", action, tables)
			}
			_, writes := extractThreadstoreColumns(sqlText, "insert", map[string]struct{}{"row_id": {}}, nil)
			if !reflect.DeepEqual(writes, []string{"row_id"}) {
				t.Fatalf("INSERT OR %s write columns = %v", action, writes)
			}
			root := t.TempDir()
			writeFixture(t, root, "schema/insert.sql", sqlText)
			findings, err := Scan(root)
			if err != nil {
				t.Fatal(err)
			}
			if len(findings) != 1 || !contains(findings[0].SinkKinds, "sql_file") || !contains(findings[0].Tables, "product_rows") {
				t.Fatalf("INSERT OR %s SQL file bypassed durable-sink scan: %#v", action, findings)
			}
		})
	}
}

func TestThreadstoreBoundaryManifestRejectsReceiptConsumerOutsideClosedSet(t *testing.T) {
	table := ThreadstoreTableContract{
		Table: "ai_turn_admission_receipts", Columns: []string{"queue_id"}, Owner: "redeven", Authority: "coordination_operation", DataClass: "coordination receipt",
		AllowedPurpose: "coordinate admission", AllowedLookupKeys: []string{"queue_id"}, Consumers: []string{"turn admission coordinator"},
		RetentionOrDeletion: "retry window", CanonicalIdentity: "integrity only", APIUIVisibility: "not exposed",
		LifecycleProhibition: "must not provide Agent lifecycle inventory, timeline, status, or search",
	}
	query := ThreadstoreQueryContract{
		ID: "threadstore.0ea12aa5ec35d13c", Path: "internal/ai/threadstore/admission_receipt.go", Function: "Store.GetPendingTurnAdmissionReceipt", Method: "QueryRowContext",
		SQLSHA256: strings.Repeat("a", 64), Tables: []string{"ai_turn_admission_receipts"}, LookupKeys: []string{"queue_id"}, ReadColumns: []string{"queue_id"},
		Action: "read", Consumer: "Store.GetPendingTurnAdmissionReceipt", ConsumerKind: "product_operation",
	}
	manifest := ThreadstoreBoundaryManifest{Version: ThreadstoreBoundaryManifestVersion, Tables: []ThreadstoreTableContract{table}, Queries: []ThreadstoreQueryContract{query}}
	issues := ValidateThreadstoreBoundaryManifest(manifest, map[string][]string{"ai_turn_admission_receipts": {"queue_id"}}, nil, nil, []ThreadstoreQueryContract{query})
	if !issuesContain(issues, "use is (read, product_operation), want (read, startup_recovery)") {
		t.Fatalf("receipt consumer drift was accepted: %v", issues)
	}
}

func issuesContain(issues []string, fragment string) bool {
	for _, issue := range issues {
		if strings.Contains(issue, fragment) {
			return true
		}
	}
	return false
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

func TestScanPropagatesTypeScriptStorageAliasesToFixedPoint(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "internal/ui/preferences.ts", `
const first = globalThis.localStorage;
const second = first;
let third: Storage;
third = second;
const fourth = third;
fourth.setItem("redeven.garden.layout", "dense");
`)
	findings, err := Scan(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(findings) != 1 || !contains(findings[0].SinkKinds, "web_storage") || !contains(findings[0].Keys, "redeven.garden.layout") {
		t.Fatalf("multi-level browser storage alias escaped scanning: %#v", findings)
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

func TestEndToEndRequiresReviewForNovelDurableShapeWithoutForbiddenNames(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "internal/garden/reviewed.go", `package garden
import disk "os"
func saveTheme(body []byte) error { return disk.WriteFile("theme", body, 0600) }
`)
	initialFindings, err := Scan(root)
	if err != nil {
		t.Fatal(err)
	}
	initial := Registry{Version: RegistryVersion}
	for _, finding := range initialFindings {
		entry := NewReviewedEntry(finding)
		entry.Owner = "garden settings"
		entry.Authority = "product_configuration"
		entry.DataClasses = []string{"garden theme preference"}
		entry.ReviewNote = "Reviewed legal host preference fixture."
		initial.Entries = append(initial.Entries, entry)
	}
	initial = roundTripRegistry(t, root, initial)
	if issues := Validate(initial, initialFindings); len(issues) != 0 {
		t.Fatalf("initial legal host chain failed: %v", issues)
	}

	writeFixture(t, root, "internal/garden/codec.go", `package garden
import wire "encoding/json"
type BloomParcel struct { Petal string }
func foldBloom(value BloomParcel) []byte { body, _ := wire.Marshal(value); return body }
func wrapBloom(value BloomParcel) []byte { return foldBloom(value) }
`)
	writeFixture(t, root, "internal/garden/delegated.go", `package garden
import wire "encoding/json"
type CedarParcel struct { Ring string }
func encodeCedar(value CedarParcel) []byte { body, _ := wire.Marshal(value); return body }
func saveCedar(value CedarParcel) error { return saveTheme(encodeCedar(value)) }
func forwardCedar(value CedarParcel) error { return saveCedar(value) }
`)
	writeFixture(t, root, "internal/garden/output.go", `package garden
import ("io"; disk "os")
func openBloom(path string) (io.WriteCloser, error) { return disk.Create(path) }
func emitBloom(path string, value BloomParcel) error {
	stream, err := openBloom(path)
	if err != nil { return err }
	_, err = stream.Write(wrapBloom(value))
	return err
}
`)
	writeFixture(t, root, "internal/garden/records.go", `package garden
type orchardExecutor interface { Exec(string, ...any) (any, error) }
const orchardDDL = "CREATE TABLE orchard_records (seed TEXT PRIMARY KEY)"
func alterOrchard(db orchardExecutor, statement string) { _, _ = db.Exec(statement) }
func cultivateOrchard(db orchardExecutor) { alterOrchard(db, orchardDDL) }
`)
	writeFixture(t, root, "internal/garden/layout.ts", `
const gardenRoot = window.localStorage;
const gardenShelf = gardenRoot;
gardenShelf.setItem("redeven.garden.layout", "dense");
`)

	changedFindings, err := Scan(root)
	if err != nil {
		t.Fatal(err)
	}
	byPath := findingsByPath(changedFindings)
	for path, kind := range map[string]string{
		"internal/garden/delegated.go": "json_file",
		"internal/garden/output.go":    "json_file",
		"internal/garden/records.go":   "sqlite",
		"internal/garden/layout.ts":    "web_storage",
	} {
		if !contains(byPath[path].SinkKinds, kind) {
			t.Fatalf("novel %s shape was not discovered in %s: %#v", kind, path, byPath[path])
		}
	}
	if !contains(byPath["internal/garden/output.go"].Codecs, "encoding/json.Marshal") || !contains(byPath["internal/garden/output.go"].DTOs, "value") {
		t.Fatalf("renamed codec/DTO inventory missing: %#v", byPath["internal/garden/output.go"])
	}
	if !contains(byPath["internal/garden/records.go"].Tables, "orchard_records") {
		t.Fatalf("renamed table inventory missing: %#v", byPath["internal/garden/records.go"])
	}
	if !contains(byPath["internal/garden/layout.ts"].Keys, "redeven.garden.layout") {
		t.Fatalf("renamed key inventory missing: %#v", byPath["internal/garden/layout.ts"])
	}
	refreshed := RefreshRegistry(initial, changedFindings)
	loaded := roundTripRegistry(t, root, refreshed)
	issues := strings.Join(Validate(loaded, changedFindings), "\n")
	if !strings.Contains(issues, "requires explicit review") {
		t.Fatalf("novel durable shape passed without review: %s", issues)
	}
	for _, entry := range loaded.Entries {
		if entry.Path == "internal/garden/reviewed.go" {
			if entry.ReviewStatus != ReviewStatusReviewed {
				t.Fatalf("unchanged reviewed helper lost approval: %#v", entry)
			}
			continue
		}
		if entry.ReviewStatus != ReviewStatusPendingReview || entry.Owner != "" || entry.Authority != "" || len(entry.DataClasses) != 0 {
			t.Fatalf("novel durable shape was implicitly signed: %#v", entry)
		}
	}

	approved := Registry{Version: RegistryVersion}
	for _, finding := range changedFindings {
		entry := NewReviewedEntry(finding)
		entry.Owner = "garden product state"
		entry.Authority = "product_configuration"
		entry.DataClasses = []string{"garden layout and orchard records"}
		entry.ReviewNote = "Explicitly reviewed legal host facts."
		approved.Entries = append(approved.Entries, entry)
	}
	approved = roundTripRegistry(t, root, approved)
	if issues := Validate(approved, changedFindings); len(issues) != 0 {
		t.Fatalf("explicitly reviewed legal host chain failed: %v", issues)
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
