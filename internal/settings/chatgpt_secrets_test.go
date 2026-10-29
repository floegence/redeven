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

func TestRemoveSignedOutChatGPTAccountPreservesOtherSecrets(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secrets.json")
	store := NewSecretsStore(path)
	if err := store.SetAIProviderAPIKey("kept-provider", "kept-key"); err != nil {
		t.Fatal(err)
	}
	account := ChatGPTAccount{Issuer: "https://auth.openai.com", Subject: "removed", Email: "removed@example.com", ClientID: "issued", Lifecycle: "signed_out"}
	other := account
	other.Subject = "kept"
	for _, item := range []ChatGPTAccount{account, other} {
		if err := store.UpdateChatGPTAccount(t.Context(), item.ID(), func(p *ChatGPTAccount) error { *p = item; return nil }); err != nil {
			t.Fatal(err)
		}
	}
	for _, mutate := range []func(*ChatGPTAccount){
		func(a *ChatGPTAccount) { a.Lifecycle = "signing_out" },
		func(a *ChatGPTAccount) { a.Lifecycle = "" },
		func(a *ChatGPTAccount) { a.AccessToken = "token" },
		func(a *ChatGPTAccount) { a.RefreshToken = "token" },
		func(a *ChatGPTAccount) { a.IDToken = "token" },
	} {
		unsafe := account
		mutate(&unsafe)
		if err := store.UpdateChatGPTAccount(t.Context(), unsafe.ID(), func(p *ChatGPTAccount) error { *p = unsafe; return nil }); err != nil {
			t.Fatal(err)
		}
		before, _ := os.ReadFile(path)
		if err := store.RemoveSignedOutChatGPTAccount(t.Context(), account.ID()); err == nil {
			t.Fatal("removed an account before complete local cleanup")
		}
		after, _ := os.ReadFile(path)
		if string(before) != string(after) {
			t.Fatal("rejected removal mutated secrets")
		}
	}
	if err := store.UpdateChatGPTAccount(t.Context(), account.ID(), func(p *ChatGPTAccount) error { *p = account; return nil }); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if err := store.RemoveSignedOutChatGPTAccount(ctx, account.ID()); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled removal: %v", err)
	}
	for range 2 {
		if err := store.RemoveSignedOutChatGPTAccount(t.Context(), account.ID()); err != nil {
			t.Fatal(err)
		}
	}
	reopened := NewSecretsStore(path)
	accounts, err := reopened.ChatGPTAccounts(t.Context())
	if err != nil || len(accounts) != 1 || accounts[other.ID()].Email != other.Email {
		t.Fatalf("unexpected remaining accounts: %+v, %v", accounts, err)
	}
	if key, ok, err := reopened.GetAIProviderAPIKey("kept-provider"); err != nil || !ok || key != "kept-key" {
		t.Fatal("removal lost an API key")
	}
}

func TestChatGPTSecretsMigrationAndAtomicFailure(t *testing.T) {
	for _, version := range []int{0, 1, 2, 3, 4, 5} {
		t.Run(string(rune('0'+version)), func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "secrets.json")
			raw, _ := json.Marshal(map[string]any{"schema_version": version, "ai": map[string]any{"provider_api_keys": map[string]string{"provider": "kept"}}})
			if err := os.WriteFile(path, raw, 0600); err != nil {
				t.Fatal(err)
			}
			store := NewSecretsStore(path)
			key, ok, err := store.GetAIProviderAPIKey("provider")
			if version == 5 {
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
	if json.Unmarshal(before, &sf) != nil || sf.SchemaVersion != 4 {
		t.Fatal("schema two did not migrate to current")
	}
	if _, _, err := NewSecretsStore(path).ChatGPTAccount(a.ID()); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Fatal("current schema was rewritten")
	}
}
