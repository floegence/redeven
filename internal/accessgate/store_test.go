package accessgate

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestAuthenticationInterruptedMigrationKeepsLegacyPassword(t *testing.T) {
	dir := t.TempDir()
	hash, err := HashPassword("original password")
	if err != nil {
		t.Fatal(err)
	}
	if err = WritePasswordHash(dir, hash); err != nil {
		t.Fatal(err)
	}
	key, _ := json.Marshal(authKey{EnvironmentID: "interrupted-initialization", Key: bytes.Repeat([]byte{1}, 32)})
	if err = os.WriteFile(filepath.Join(dir, authKeyName), key, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(dir, authDatabaseName), nil, 0600); err != nil {
		t.Fatal(err)
	}
	before, err := ReadPasswordHash(dir)
	if err != nil || !bytes.Equal(before, hash) {
		t.Fatalf("read interrupted authority: %v", err)
	}
	info, _ := os.Stat(filepath.Join(dir, authDatabaseName))
	if info.Size() != 0 {
		t.Fatal("startup probe wrote state")
	}
	gate, err := OpenPersistent(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer gate.Close()
	if !gate.Enabled() || bcrypt.CompareHashAndPassword(gate.auth.PasswordHash, []byte("original password")) != nil {
		t.Fatal("migration weakened original password policy")
	}
}

func TestAuthenticationInvalidAuthorityIsNeverRewritten(t *testing.T) {
	for _, damage := range []string{"future", "schema", "ciphertext", "missing-key"} {
		t.Run(damage, func(t *testing.T) {
			g, dir := persistentTestGate(t)
			enableTestMFA(t, g)
			_ = g.Close()
			path := filepath.Join(dir, authDatabaseName)
			if damage == "missing-key" {
				if err := os.Remove(filepath.Join(dir, authKeyName)); err != nil {
					t.Fatal(err)
				}
			} else {
				db, err := sql.Open("sqlite", path)
				if err != nil {
					t.Fatal(err)
				}
				statement := map[string]string{"future": "PRAGMA user_version=99", "schema": "CREATE TABLE unexpected (value TEXT)", "ciphertext": "UPDATE authentication SET sealed=zeroblob(100)"}[damage]
				if _, err = db.Exec(statement); err != nil {
					t.Fatal(err)
				}
				_ = db.Close()
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = ReadPasswordHash(dir); err == nil {
				t.Fatal("invalid authority accepted by startup probe")
			}
			if opened, err := OpenPersistent(dir); err == nil {
				_ = opened.Close()
				t.Fatal("invalid authority accepted")
			}
			after, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(before, after) {
				t.Fatal("invalid authority was modified")
			}
		})
	}
}

func TestAuthenticationReadProbeDoesNotWrite(t *testing.T) {
	g, dir := persistentTestGate(t)
	_ = g.Close()
	path := filepath.Join(dir, authDatabaseName)
	before, _ := os.ReadFile(path)
	hash, err := ReadPasswordHash(dir)
	if err != nil || len(hash) == 0 {
		t.Fatalf("read probe: %v", err)
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("read probe modified committed authority")
	}
}

func TestAuthenticationWriteFailureCannotGrantAccess(t *testing.T) {
	g, _ := persistentTestGate(t)
	_, codes := enableTestMFA(t, g)
	challenge := loginChallenge(t, g, "write-failure")
	if _, err := g.store.db.Exec("PRAGMA query_only=ON"); err != nil {
		t.Fatal(err)
	}
	if out, err := g.AuthenticateLocal(AuthenticationRequest{ChallengeID: challenge, RecoveryCode: codes[0]}, "peer", "write-failure"); err == nil || out != nil {
		t.Fatal("unpersisted factor granted access")
	}
	if g.SecurityStatus().RecoveryCodesRemaining != 8 {
		t.Fatal("failed commit changed memory authority")
	}
}
