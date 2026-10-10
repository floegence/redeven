package tessiven

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	tessivenspec "github.com/floegence/redeven/spec/tessiven"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestSemanticDSLVersionAndLegacyUpgrade(t *testing.T) {
	const current = "redeven.io/tessiven/v1.0.0"
	legacy := strings.Replace(exampleDocument, current, "redeven.io/tessiven/v1", 1)
	for name, source := range map[string]string{
		"current": strings.Replace(legacy, "redeven.io/tessiven/v1", current, 1),
		"legacy":  legacy,
	} {
		t.Run(name, func(t *testing.T) {
			result := Validate(source)
			if !result.Valid || result.Document.APIVersion != current {
				t.Fatalf("expected current DSL projection: %+v", result)
			}
		})
	}
	var schema map[string]any
	if err := json.Unmarshal(Schema(), &schema); err != nil {
		t.Fatal(err)
	}
	if schema["properties"].(map[string]any)["apiVersion"].(map[string]any)["const"] != current {
		t.Fatal("the authoritative schema does not define the current semantic version")
	}
}

func TestLegacyWriteUpgradesOnlyTheDSLHeader(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "canvases.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	source := strings.Replace(exampleDocument, "redeven.io/tessiven/v1.0.0", "redeven.io/tessiven/v1", 1)
	source = "# Preserve formatting and comments\n" + source
	first, err := s.Save(t.Context(), SaveRequest{RequestID: "legacy", DocumentYAML: source}, "import")
	if err != nil {
		t.Fatal(err)
	}
	want := strings.Replace(source, "apiVersion: redeven.io/tessiven/v1\n", "apiVersion: redeven.io/tessiven/v1.0.0\n", 1)
	if first.Version.DocumentYAML != want || first.Version.Digest != digest(want) {
		t.Fatal("a legacy write must upgrade its header without rewriting unrelated YAML")
	}
	retry, err := s.Save(t.Context(), SaveRequest{RequestID: "legacy", DocumentYAML: source}, "import")
	if err != nil || retry.Version.Number != first.Version.Number {
		t.Fatalf("retry: %v", err)
	}
	if _, err := s.Save(t.Context(), SaveRequest{RequestID: "legacy", DocumentYAML: want}, "import"); err != ErrRequestConflict {
		t.Fatalf("different original arguments must not be treated as the same retry: %v", err)
	}
}

func TestLegacyMigrationPreservesScalarStyles(t *testing.T) {
	const old = "redeven.io/tessiven/v1"
	const current = "redeven.io/tessiven/v1.0.0"
	cases := []struct{ name, source, want string }{
		{"bom", "\ufeffapiVersion: " + old + "\n", "\ufeffapiVersion: " + current + "\n"},
		{"plain", "apiVersion: " + old + " # keep\n", "apiVersion: " + current + " # keep\n"},
		{"single-quoted", "apiVersion: '" + old + "'\n", "apiVersion: '" + current + "'\n"},
		{"double-quoted", "apiVersion: \"" + old + "\"\n", "apiVersion: \"" + current + "\"\n"},
		{"escaped", "apiVersion: \"redeven.io/tessiven/v\\u0031\"\n", "apiVersion: \"" + current + "\"\n"},
		{"explicit-tag", "apiVersion: !!str '" + old + "'\n", "apiVersion: !!str '" + current + "'\n"},
		{"literal", "apiVersion: |- # keep\n  " + old + "\n", "apiVersion: |- # keep\n  " + current + "\n"},
		{"folded", "apiVersion: >-\n  " + old + "\n", "apiVersion: >-\n  " + current + "\n"},
		{"cr-only", "# preface\rapiVersion: " + old + "\r", "# preface\rapiVersion: " + current + "\r"},
		{"nel", "# preface\u0085apiVersion: " + old + "\n", "# preface\u0085apiVersion: " + current + "\n"},
		{"crlf", "apiVersion: " + old + "\r\n", "apiVersion: " + current + "\r\n"},
		{"unicode-flow", "{metadata: {title: '版本'}, apiVersion: '" + old + "', kind: ServiceCanvas}\n", "{metadata: {title: '版本'}, apiVersion: '" + current + "', kind: ServiceCanvas}\n"},
		{"json", `{"kind":"ServiceCanvas","apiVersion":"redeven.io/tessiven/v1","metadata":{"title":"Example"}}`, `{"kind":"ServiceCanvas","apiVersion":"redeven.io/tessiven/v1.0.0","metadata":{"title":"Example"}}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			source, want := tc.source, tc.want
			if !strings.Contains(source, "ServiceCanvas") {
				source += "kind: ServiceCanvas\nmetadata: {title: 'redeven.io/tessiven/v1'}\n"
				want += "kind: ServiceCanvas\nmetadata: {title: 'redeven.io/tessiven/v1'}\n"
			}
			result := Validate(source)
			if !result.Valid || result.documentYAML != want {
				t.Fatalf("migration: %+v; source: %q; got: %q; want: %q", result, source, result.documentYAML, want)
			}
			again := Validate(result.documentYAML)
			if !again.Valid || len(again.Migrations) != 0 || again.documentYAML != want {
				t.Fatal("migration must be idempotent")
			}
		})
	}
}

func TestDSLRegistryHasFrozenSchemasAndCompleteUpgradePaths(t *testing.T) {
	formats := tessivenspec.Formats()
	versions := map[string]tessivenspec.Format{}
	for _, format := range formats {
		if _, duplicate := versions[format.Version]; duplicate {
			t.Fatal("duplicate DSL version")
		}
		if format.Version != "v1" && !regexp.MustCompile(`^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`).MatchString(format.Version) {
			t.Fatal("DSL versions must be stable vMAJOR.MINOR.PATCH")
		}
		var schema map[string]any
		if err := json.Unmarshal(format.Schema, &schema); err != nil {
			t.Fatal(err)
		}
		if schema["properties"].(map[string]any)["apiVersion"].(map[string]any)["const"] != tessivenspec.Namespace+format.Version {
			t.Fatal("schema identity disagrees with registry")
		}
		versions[format.Version] = format
	}
	for _, format := range formats {
		seen := map[string]bool{}
		for format.UpgradeTo != "" {
			if seen[format.Version] {
				t.Fatal("cyclic upgrade chain")
			}
			seen[format.Version] = true
			var exists bool
			format, exists = versions[format.UpgradeTo]
			if !exists {
				t.Fatal("incomplete upgrade chain")
			}
		}
		if format.Version != tessivenspec.CurrentVersion {
			t.Fatal("every supported version must reach current")
		}
	}
	legacy, _ := SchemaForVersion("v1")
	sum := sha256.Sum256(legacy)
	if fmt.Sprintf("%x", sum) != "6dea5d0bf44390492072c28d1ef7b4c1d3f35870277ee01ceac1250b8ebf3af7" {
		t.Fatal("the published legacy schema must never be edited")
	}
	legacy[0] = '!'
	intact, _ := SchemaForVersion("v1")
	if !json.Valid(intact) {
		t.Fatal("schema callers must not mutate the registry")
	}
}

func TestUnsupportedDSLVersionsFailWithLocationsAndNoWrites(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "canvases.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	saved, err := s.Save(t.Context(), SaveRequest{RequestID: "initial", DocumentYAML: exampleDocument}, "manual")
	if err != nil {
		t.Fatal(err)
	}
	for index, version := range []string{"v1.0.1", "v1.1.0", "v2.0.0", "v1.2", "v01.0.0", "v1.0.0-beta", "", "tessiven/v1.0.0"} {
		t.Run(version, func(t *testing.T) {
			source := strings.Replace(exampleDocument, "redeven.io/tessiven/v1.0.0", tessivenspec.Namespace+version, 1)
			result := Validate(source)
			if result.Valid || len(result.Diagnostics) != 1 || result.Diagnostics[0].Path != "/apiVersion" || result.Diagnostics[0].Line != 1 || result.Diagnostics[0].Column <= 1 || !strings.Contains(result.Diagnostics[0].Message, "supported versions") {
				t.Fatalf("version error must be located and actionable: %+v", result)
			}
			_, err := s.Save(t.Context(), SaveRequest{RequestID: fmt.Sprintf("unknown-%d", index), CanvasID: saved.Canvas.ID, ExpectedVersion: 1, DocumentYAML: source}, "import")
			var validation *ValidationError
			if !errors.As(err, &validation) {
				t.Fatalf("unknown save: %v", err)
			}
			if _, err := SchemaForVersion(version); version != "" && !errors.Is(err, ErrInvalidRequest) {
				t.Fatalf("unknown schema: %v", err)
			}
		})
	}
	canvas, err := s.Canvas(t.Context(), saved.Canvas.ID)
	if err != nil || canvas.LatestVersion != 1 {
		t.Fatal("failed upgrade changed the canvas")
	}
	var count int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM requests WHERE request_id LIKE 'unknown-%'").Scan(&count); err != nil || count != 0 {
		t.Fatal("failed upgrade persisted a request")
	}
}

func TestLegacyHistoryUpgradesOnEditWithoutRewritingHistory(t *testing.T) {
	path, request, _ := createV1Library(t)
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	var cachedBefore string
	if err := s.db.QueryRow("SELECT result_json FROM requests WHERE request_id=?", request.RequestID).Scan(&cachedBefore); err != nil {
		t.Fatal(err)
	}
	read, err := s.Read(t.Context(), ReadRequest{CanvasID: request.CanvasID, Version: 1})
	if err != nil || read.DSLVersion != "v1" || len(read.Migrations) != 1 {
		t.Fatalf("legacy read: %+v %v", read, err)
	}
	edited, err := s.Edit(t.Context(), EditRequest{RequestID: "upgrade-edit", CanvasID: request.CanvasID, ExpectedVersion: 2, Summary: "Upgrade with a title edit", Edits: []TextEdit{{OldString: "Commerce / Production", NewString: "Upgraded commerce"}}})
	if err != nil {
		t.Fatal(err)
	}
	if edited.Version.DSLVersion != "v1.0.0" || edited.Version.Document.APIVersion != tessivenspec.CurrentAPIVersion {
		t.Fatal("new snapshot was not upgraded")
	}
	legacy, err := s.Version(t.Context(), request.CanvasID, 1)
	if err != nil || legacy.DocumentYAML != request.DocumentYAML || legacy.Digest != digest(request.DocumentYAML) || legacy.Document.APIVersion != tessivenspec.CurrentAPIVersion {
		t.Fatalf("history: %+v %v", legacy, err)
	}
	if _, err := s.Save(t.Context(), request, "flower"); err != nil {
		t.Fatal(err)
	}
	var cachedAfter string
	if err := s.db.QueryRow("SELECT result_json FROM requests WHERE request_id=?", request.RequestID).Scan(&cachedAfter); err != nil || cachedAfter != cachedBefore {
		t.Fatal("read/retry rewrote the cached historical result")
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	latest, err := s.Version(t.Context(), request.CanvasID, 0)
	if err != nil || latest.Number != 3 || latest.Document.Metadata.Title != "Upgraded commerce" {
		t.Fatalf("restart: %+v %v", latest, err)
	}
}

func TestCurrentDSLDoesNotInheritLegacyPlacementTolerance(t *testing.T) {
	unplaced := "apiVersion: redeven.io/tessiven/v1.0.0\nkind: ServiceCanvas\nmetadata: {title: Invalid}\nservices: [{id: api, name: API, kind: api}]\n"
	if result := validateDocument(unplaced, true); result.Valid {
		t.Fatal("current stored documents must satisfy current placement rules")
	}
	if result := validateDocument(strings.Replace(unplaced, "v1.0.0", "v1", 1), true); !result.Valid || len(result.Diagnostics) != 1 || len(result.Migrations) != 1 {
		t.Fatalf("legacy repair compatibility: %+v", result)
	}
}

func TestFutureStoredDSLIsRejectedWithoutChangingOriginalRecords(t *testing.T) {
	path, request, _ := createV1Library(t)
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	future := strings.Replace(request.DocumentYAML, "redeven.io/tessiven/v1", "redeven.io/tessiven/v9.0.0", 1)
	if _, err := s.db.Exec(`INSERT INTO versions VALUES(?,3,?,?,300,'import','Future DSL')`, request.CanvasID, future, digest(future)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE canvases SET latest_version=3 WHERE id=?`, request.CanvasID); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	var validation *ValidationError
	if _, err := s.Version(t.Context(), request.CanvasID, 0); !errors.As(err, &validation) || !strings.Contains(err.Error(), "v9.0.0") {
		t.Fatalf("stored version must report its unsupported DSL: %v", err)
	}
	var original, hash string
	if err := s.db.QueryRow(`SELECT document_yaml,digest FROM versions WHERE canvas_id=? AND number=3`, request.CanvasID).Scan(&original, &hash); err != nil || original != future || hash != digest(future) {
		t.Fatal("unsupported stored DSL was rewritten")
	}
	old, err := s.Version(t.Context(), request.CanvasID, 1)
	if err != nil || old.DocumentYAML != request.DocumentYAML {
		t.Fatal("unsupported latest version corrupted supported history")
	}
}

func TestLegacyUpgradeCannotPersistAnOversizedTarget(t *testing.T) {
	legacy := strings.Replace(exampleDocument, "v1.0.0", "v1", 1)
	source := legacy + "#" + strings.Repeat(" ", MaxDocumentBytes-len(legacy)-1)
	if result := validateDocument(source, true); !result.Valid {
		t.Fatalf("supported original history must remain readable: %+v", result.Diagnostics)
	}
	result := Validate(source)
	if result.Valid || len(result.Diagnostics) != 1 || result.Diagnostics[0].Path != "/apiVersion" || !strings.Contains(result.Diagnostics[0].Message, "upgraded document exceeds") {
		t.Fatalf("target size must be checked before persistence: %+v", result.Diagnostics)
	}
}

func TestGeneratedLegacyRequestsRemainReplayableAfterDSLUpgrade(t *testing.T) {
	path, base, _ := createV1Library(t)
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for _, operation := range []string{"created", "rename", "duplicate"} {
		t.Run(operation, func(t *testing.T) {
			document := Validate(base.DocumentYAML).Document
			document.APIVersion = "redeven.io/tessiven/v1"
			document.Metadata.Title = "Generated title"
			req := SaveRequest{RequestID: "legacy-" + operation}
			switch operation {
			case "created":
				document = &Document{APIVersion: "redeven.io/tessiven/v1", Kind: "ServiceCanvas", Metadata: Metadata{Title: "Generated title"}}
				req.Summary = "Create canvas"
			case "rename":
				req.CanvasID = base.CanvasID
				req.ExpectedVersion = 2
				req.Summary = "Rename canvas"
			case "duplicate":
				req.Summary = fmt.Sprintf("Copy %s version 1", base.CanvasID)
			}
			source, err := documentYAML(document)
			if err != nil {
				t.Fatal(err)
			}
			req.DocumentYAML = source
			input, _ := json.Marshal(struct {
				SaveRequest
				Source string
			}{req, operation})
			original := SaveResult{Canvas: Canvas{ID: "original-" + operation, LatestVersion: 1}, Version: Version{CanvasID: "original-" + operation, Number: 1, DocumentYAML: source, Digest: digest(source), Source: operation, Document: document}}
			encoded, _ := json.Marshal(original)
			if _, err := s.db.Exec(`INSERT INTO requests VALUES(?,?,?)`, req.RequestID, digest(string(input)), string(encoded)); err != nil {
				t.Fatal(err)
			}
			var retry SaveResult
			switch operation {
			case "created":
				retry, err = s.Create(t.Context(), req.RequestID, "Generated title")
			case "rename":
				retry, err = s.Rename(t.Context(), base.CanvasID, RevisionRequest{RequestID: req.RequestID, ExpectedVersion: 2, Title: "Generated title"})
			case "duplicate":
				retry, err = s.Duplicate(t.Context(), base.CanvasID, RevisionRequest{RequestID: req.RequestID, Version: 1, Title: "Generated title"})
			}
			if err != nil || retry.Canvas.ID != original.Canvas.ID || retry.Version.DocumentYAML != source || retry.Version.Document.APIVersion != tessivenspec.CurrentAPIVersion {
				t.Fatalf("generated legacy retry: %+v %v", retry, err)
			}
		})
	}
}
