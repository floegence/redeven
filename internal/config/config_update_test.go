package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func savedChatGPTConfig() *AIConfig {
	return &AIConfig{CurrentModelID: "openai/gpt-6.1-sol", Providers: []AIProvider{{
		ID: "openai", Type: "openai", AuthMethod: AIAuthChatGPT, AccountID: "saved-account",
		ModelSelection: &AIModelSelection{SelectedModels: []string{"gpt-6.1-sol"}},
	}}}
}

func TestSaveConnectionPreservesCurrentSettingsAndAccountRemoval(t *testing.T) {
	for _, test := range []struct {
		name string
		ai   *AIConfig
	}{
		{"signed_in", savedChatGPTConfig()},
		{"removed", nil},
		{"api_key", &AIConfig{Providers: []AIProvider{{ID: "openai", Type: "openai", AuthMethod: AIAuthAPIKey, ModelSelection: &AIModelSelection{SelectedModels: []string{}}}}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "config.json")
			stale := configWithDirectArtifact(json.RawMessage(directArtifactFixture), false)
			stale.AI = savedChatGPTConfig()
			if err := Save(path, stale); err != nil {
				t.Fatal(err)
			}
			current, err := Update(path, func(cfg *Config) error {
				cfg.AI = test.ai
				cfg.Shell, cfg.LogLevel = "/bin/zsh", "debug"
				cfg.AgentHomeDir = t.TempDir()
				cfg.CodeServerPortMin, cfg.CodeServerPortMax = 32000, 32100
				cfg.extra = map[string]json.RawMessage{"extension_settings": json.RawMessage(`{"enabled":true}`)}
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
			stale.Direct.Spent = true
			if err := SaveConnection(path, stale); err != nil {
				t.Fatal(err)
			}
			restarted, err := LoadForStartup(path)
			if err != nil {
				t.Fatal(err)
			}
			current.Direct.Spent = true
			if !jsonEqual(mustCanonicalJSON(restarted), mustCanonicalJSON(current)) || !jsonEqual(mustCanonicalJSON(stale), mustCanonicalJSON(current)) {
				t.Fatal("connection save lost current settings, restored a removed account, or failed to publish the committed configuration")
			}
		})
	}
}

func TestSettingsAndConnectionUpdatesSerialize(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	connection := configWithDirectArtifact(json.RawMessage(directArtifactFixture), false)
	if err := Save(path, connection); err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	settingsDone, connectionDone := make(chan error, 1), make(chan error, 1)
	go func() {
		_, err := Update(path, func(cfg *Config) error {
			close(entered)
			<-release
			cfg.AI = savedChatGPTConfig()
			return nil
		})
		settingsDone <- err
	}()
	<-entered
	connection.Direct.Spent = true
	go func() { connectionDone <- SaveConnection(path, connection) }()
	select {
	case err := <-connectionDone:
		close(release)
		<-settingsDone
		t.Fatalf("connection save bypassed the in-flight settings transaction: %v", err)
	case <-time.After(25 * time.Millisecond):
	}
	close(release)
	if err := <-settingsDone; err != nil {
		t.Fatal(err)
	}
	if err := <-connectionDone; err != nil {
		t.Fatal(err)
	}
	// The reverse order must also retain the connection owner's committed facts.
	if _, err := Update(path, func(cfg *Config) error { cfg.Shell = "/bin/zsh"; return nil }); err != nil {
		t.Fatal(err)
	}
	restarted, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(restarted.AI, savedChatGPTConfig()) || !restarted.Direct.Spent || restarted.Shell != "/bin/zsh" {
		t.Fatal("concurrent settings and connection updates lost a committed fact")
	}
}

func TestSaveConnectionFailurePreservesDiskAndCandidate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	current := configWithDirectArtifact(json.RawMessage(directArtifactFixture), false)
	current.AI = savedChatGPTConfig()
	if err := Save(path, current); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	next := configWithDirectArtifact(json.RawMessage(directArtifactFixture), true)
	want := configWithDirectArtifact(json.RawMessage(directArtifactFixture), true)
	writeErr := errors.New("rename denied")
	persistence := defaultConfigPersistence()
	persistence.writeConfig = func(string, *Config) error { return writeErr }
	if err := saveConnectionConfig(path, next, persistence); !errors.Is(err, writeErr) {
		t.Fatalf("save error = %v, want storage failure", err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) || !reflect.DeepEqual(next, want) {
		t.Fatal("failed save modified disk or published uncommitted settings")
	}
	for _, invalid := range []string{`{`, `{"gateways":[null]}`} {
		if err := os.WriteFile(path, []byte(invalid), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := SaveConnection(path, next); err == nil {
			t.Fatal("connection maintenance must not replace unreadable or invalid configuration")
		}
		after, err := os.ReadFile(path)
		if err != nil || string(after) != invalid || !reflect.DeepEqual(next, want) {
			t.Fatal("rejected configuration was mutated")
		}
	}
}

func TestUpdateRejectedMutationPreservesConfig(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := Save(path, &Config{AI: savedChatGPTConfig()}); err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	rejected := errors.New("settings rejected")
	if _, err := Update(path, func(cfg *Config) error { cfg.AI = nil; return rejected }); !errors.Is(err, rejected) {
		t.Fatalf("Update() = %v, want rejected mutation", err)
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(want, after) {
		t.Fatal("rejected mutation changed saved account binding")
	}
}
