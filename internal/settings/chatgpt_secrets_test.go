package settings

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestChatGPTSecretsMigrationAndAtomicFailure(t *testing.T) {
	for _, version := range []int{0, 1, 2, 3, 4} {
		t.Run(string(rune('0'+version)), func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "secrets.json")
			raw, _ := json.Marshal(map[string]any{"schema_version": version, "ai": map[string]any{"provider_api_keys": map[string]string{"provider": "kept"}}})
			if err := os.WriteFile(path, raw, 0600); err != nil {
				t.Fatal(err)
			}
			store := NewSecretsStore(path)
			key, ok, err := store.GetAIProviderAPIKey("provider")
			if version == 4 {
				if err == nil {
					t.Fatal("future schema accepted")
				}
				after, _ := os.ReadFile(path)
				if string(after) != string(raw) {
					t.Fatal("future state mutated")
				}
				return
			}
			if err != nil || !ok || key != "kept" {
				t.Fatal("migration lost API key")
			}
			host, err := store.ChatGPTHostID(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			next, err := NewSecretsStore(path).ChatGPTHostID(context.Background())
			if err != nil || next != host {
				t.Fatal("host identity changed across restart")
			}
			before, _ := os.ReadFile(path)
			account := ChatGPTAccount{Issuer: "issuer", Subject: "subject", ClientID: "issued"}
			sentinel := errors.New("write failure")
			if err := store.UpdateChatGPTAccount(context.Background(), account.ID(), func(a *ChatGPTAccount) error { *a = account; return sentinel }); !errors.Is(err, sentinel) {
				t.Fatal("callback failure lost")
			}
			after, _ := os.ReadFile(path)
			if string(after) != string(before) {
				t.Fatal("failed update changed canonical bytes")
			}
			if err := store.UpdateChatGPTAccount(context.Background(), account.ID(), func(a *ChatGPTAccount) error { *a = account; return nil }); err != nil {
				t.Fatal(err)
			}
			info, _ := os.Stat(path)
			if info.Mode().Perm() != 0600 {
				t.Fatalf("mode %o", info.Mode().Perm())
			}
			if key, ok, err := store.GetAIProviderAPIKey("provider"); err != nil || !ok || key != "kept" {
				t.Fatal("auth update overwrote API key")
			}
		})
	}
}

func TestChatGPTSecretsFilesystemWriteFailure(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX directory permissions")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "secrets.json")
	store := NewSecretsStore(path)
	if _, err := store.ChatGPTHostID(context.Background()); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(path)
	account := ChatGPTAccount{Issuer: "issuer", Subject: "subject", ClientID: "issued"}
	t.Cleanup(func() { _ = os.Chmod(dir, 0700) })
	err := store.UpdateChatGPTAccount(context.Background(), account.ID(), func(a *ChatGPTAccount) error { *a = account; return os.Chmod(dir, 0500) })
	_ = os.Chmod(dir, 0700)
	if err == nil {
		t.Fatal("protected write unexpectedly succeeded")
	}
	after, _ := os.ReadFile(path)
	if string(after) != string(before) {
		t.Fatal("failed write changed canonical bytes")
	}
	entries, _ := os.ReadDir(dir)
	for _, entry := range entries {
		if entry.Name() != "secrets.json" && entry.Name() != "secrets.json.lock" {
			t.Fatal("failed write left temporary credentials")
		}
	}
}

func TestChatGPTSecretsLockCancellation(t *testing.T) {
	store := NewSecretsStore(filepath.Join(t.TempDir(), "secrets.json"))
	unlock, err := store.lock(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	started := time.Now()
	if _, err := store.ChatGPTHostID(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation lost: %v", err)
	}
	if time.Since(started) > time.Second {
		t.Fatal("cancelled request waited for active refresh")
	}
}

func TestChatGPTSchemaTwoMigrationPreservesRegistrationAndIsIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.json")
	a := ChatGPTAccount{Issuer: "https://auth.openai.com", Subject: "subject", Email: "person@example.com", ClientID: "issued", AccessToken: "saved-access", RefreshToken: "saved-refresh", IDToken: "saved-id", Scopes: []string{"offline_access", "resource.invoke", "chatgpt.tokens.use.direct"}, ExpiresAt: time.Now().UTC().Truncate(time.Second).Add(time.Hour)}
	raw, err := json.Marshal(secretsFile{SchemaVersion: 2, ChatGPT: &chatGPTSecrets{HostID: "stable-host", Accounts: map[string]ChatGPTAccount{a.ID(): a}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	store := NewSecretsStore(path)
	got, exists, err := store.ChatGPTAccount(a.ID())
	if err != nil || !exists || got.AccessToken != a.AccessToken || got.RefreshToken != a.RefreshToken || got.ClientID != a.ClientID {
		t.Fatal("migration lost existing credentials")
	}
	host, err := store.ChatGPTHostID(t.Context())
	if err != nil || host != "stable-host" {
		t.Fatal("migration changed host registration")
	}
	before, _ := os.ReadFile(path)
	var sf secretsFile
	if json.Unmarshal(before, &sf) != nil || sf.SchemaVersion != 3 {
		t.Fatal("schema two did not migrate to three")
	}
	if _, _, err := NewSecretsStore(path).ChatGPTAccount(a.ID()); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Fatal("current schema was rewritten")
	}
}
