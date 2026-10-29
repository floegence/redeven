package environmentcenter

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestSensitiveAuthenticationAuditDoesNotPersistActionPayload(t *testing.T) {
	c, _, _, codes := configuredCenter(t)
	login := loginRecovery(t, c, "audit-browser", codes[0])
	action := passwordAction("replacement horse battery staple", login.Device.ID)
	challenge, err := c.Authenticate("audit-browser", login.Token, "source", "Browser", Authentication{Password: testPassword, Action: action})
	if err != nil {
		t.Fatal(err)
	}
	grant, err := c.Authenticate("audit-browser", login.Token, "source", "Browser", Authentication{Challenge: challenge.Challenge, Recovery: codes[1], Action: action})
	if err != nil || grant.Grant == "" {
		t.Fatalf("step-up failed: %v", err)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	raw, err := json.Marshal(c.state)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), action) || strings.Contains(string(raw), digest("replacement horse battery staple")) {
		t.Fatal("persistent audit retains a fast password digest")
	}
	last := c.state.Audit[len(c.state.Audit)-1]
	if last.Action != "sensitive_authentication" || last.Result != "succeeded" || last.Reference != "password" {
		t.Fatalf("audit lost safe event facts: %+v", last)
	}
	if c.grants[digest(grant.Grant)].Action != action {
		t.Fatal("audit redaction weakened the exact action binding")
	}
}

func TestAuditMigrationPreservesAuthorityAndEventFacts(t *testing.T) {
	c, dir, _, codes := configuredCenter(t)
	next := c.state
	next.Audit = []auditEvent{
		{Time: 12, Action: "sensitive_authentication", Result: "succeeded", Reference: "password:" + digest("old password binding"), Revision: 4},
		{Time: 13, Action: "sensitive_authentication", Result: "succeeded", Reference: "gateway:add:secret-derived-payload", Revision: 4},
		{Time: 14, Action: "device_revoke", Result: "committed", Reference: "device-id", Revision: 4},
	}
	if err := c.saveLocked(next); err != nil {
		t.Fatal(err)
	}
	// Retain every unrelated serialized field while removing only audit payloads.
	tx, err := c.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	document, _, err := c.auditDocument(tx)
	if err != nil {
		t.Fatal(err)
	}
	document["ExtensionMetadata"] = json.RawMessage(`{"value":17}`)
	plain, _ := json.Marshal(document)
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec("UPDATE center_state SET sealed=?", c.aead.Seal(nonce, nonce, plain, c.aad())); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec("PRAGMA user_version=1"); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	want := next
	want.Audit = append([]auditEvent(nil), next.Audit...)
	want.Audit[0].Reference = "password"
	want.Audit[1].Reference = "gateway:add"
	if err := c.Close(); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		c, err = Open(dir, "https://center.example.test")
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(c.state, want) {
			t.Fatal("migration changed credentials, directory, or audit event facts")
		}
		var version int
		if err = c.db.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != 2 {
			t.Fatalf("migration version: %d, %v", version, err)
		}
		tx, err = c.db.Begin()
		if err != nil {
			t.Fatal(err)
		}
		after, _, err := c.auditDocument(tx)
		_ = tx.Rollback()
		if err != nil || !bytes.Equal(after["ExtensionMetadata"], document["ExtensionMetadata"]) {
			t.Fatal("migration discarded unrelated serialized data")
		}
		if err = c.Close(); err != nil {
			t.Fatal(err)
		}
	}
	c, err = Open(dir, "https://center.example.test")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	loginRecovery(t, c, "after-migration", codes[0])
}

func TestAuditMigrationRejectsDamagedAndFutureStateUnchanged(t *testing.T) {
	for _, fixture := range []string{"damaged", "future"} {
		t.Run(fixture, func(t *testing.T) {
			c, dir, _, _ := configuredCenter(t)
			statement := "PRAGMA user_version=3"
			if fixture == "damaged" {
				if _, err := c.db.Exec("UPDATE center_state SET sealed=x'00'"); err != nil {
					t.Fatal(err)
				}
				statement = "PRAGMA user_version=1"
			}
			if _, err := c.db.Exec(statement); err != nil {
				t.Fatal(err)
			}
			if err := c.Close(); err != nil {
				t.Fatal(err)
			}
			file := filepath.Join(dir, "center.sqlite")
			before, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			if opened, err := Open(dir, "https://center.example.test"); err == nil {
				opened.Close()
				t.Fatal("unsupported audit state opened")
			}
			after, err := os.ReadFile(file)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatal("failed migration modified stored state")
			}
		})
	}
}
