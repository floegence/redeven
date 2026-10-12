package registry

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

func TestTemplateV7MigrationPreservesRecordsAndRollsBack(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "upgrade", true: "rollback"}[fail], func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "registry.sqlite")
			spec := registrySchemaSpec()
			spec.CurrentVersion = 5
			spec.MinimumVersion = 5
			spec.Migrations = nil
			spec.Verify = func(tx *sql.Tx) error { return verifyRegistryVersion(tx, 5) }
			db, err := sqliteutil.Open(path, spec)
			if err != nil {
				t.Fatal(err)
			}
			raw := `{"schema_version":6,"kind":"host","endpoint":{"scheme":"http","path":"/dashboard?view=initial#panel"},"host":{"start_script":"exec server"}}`
			hash := sha256.Sum256([]byte(raw))
			digest := hex.EncodeToString(hash[:])
			reg := &Registry{db: db}
			if err := reg.CreateManagedTemplate(context.Background(), ManagedTemplate{TemplateID: "frozen", Name: "User template", Source: "custom", Deployment: "host", Revision: 9, SpecJSON: raw, SpecSHA256: digest, ServiceFamilyID: "retained-family"}); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(`INSERT INTO port_forwards(forward_id,target_url,created_at_unix_ms,updated_at_unix_ms,last_opened_at_unix_ms) VALUES('retained','http://127.0.0.1:3080',1,2,3)`); err != nil {
				t.Fatal(err)
			}
			source := filepath.Join(root, "external.json")
			if err := os.WriteFile(source, []byte(raw), 0600); err != nil {
				t.Fatal(err)
			}
			db.Close()
			next := registrySchemaSpec()
			if fail {
				next.Migrations[4].Apply = func(tx *sql.Tx) error {
					if err := migrateRegistryV5ToV6(tx); err != nil {
						return err
					}
					return errors.New("injected final migration failure")
				}
			}
			upgraded, err := sqliteutil.Open(path, next)
			if fail {
				if err == nil {
					upgraded.Close()
					t.Fatal("failed migration committed")
				}
				upgraded, err = sql.Open("sqlite", path)
			}
			if err != nil {
				t.Fatal(err)
			}
			defer upgraded.Close()
			var version int
			upgraded.QueryRow(`PRAGMA user_version`).Scan(&version)
			want := 6
			if fail {
				want = 5
			}
			if version != want {
				t.Fatal("migration metadata was not atomic")
			}
			var actual, name, family, target string
			var revision, last int
			if err := upgraded.QueryRow(`SELECT spec_json,name,service_family_id,revision FROM managed_web_service_templates WHERE template_id='frozen'`).Scan(&actual, &name, &family, &revision); err != nil {
				t.Fatal(err)
			}
			if name != "User template" || family != "retained-family" || revision != 9 {
				t.Fatal("template metadata changed")
			}
			if fail && actual != raw {
				t.Fatal("failed migration changed original template")
			}
			if !fail && (actual == raw || !containsV7(actual)) {
				t.Fatal("execution document was not adapted")
			}
			if err := upgraded.QueryRow(`SELECT target_url,last_opened_at_unix_ms FROM port_forwards WHERE forward_id='retained'`).Scan(&target, &last); err != nil || target != "http://127.0.0.1:3080" || last != 3 {
				t.Fatal("user route changed", err)
			}
			retained, _ := os.ReadFile(source)
			if string(retained) != raw {
				t.Fatal("external source bytes changed")
			}
		})
	}
}

func containsV7(raw string) bool {
	var spec struct {
		Version int `json:"schema_version"`
	}
	return json.Unmarshal([]byte(raw), &spec) == nil && spec.Version == 7
}
