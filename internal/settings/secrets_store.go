package settings

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// SecretsStore persists user-managed secrets to a local file.
//
// It is intentionally separate from config.json:
// - config.json contains control-plane managed fields (including some secrets like E2EE PSK)
// - secrets.json contains user-provided secrets (like AI provider API keys)
//
// Secrets must never be returned back to the UI in plaintext. The UI should only see
// derived status fields such as "api_key_set".
type SecretsStore struct {
	path string
	mu   sync.Mutex
}

func NewSecretsStore(path string) *SecretsStore {
	return &SecretsStore{path: filepath.Clean(strings.TrimSpace(path))}
}

func (s *SecretsStore) Path() string {
	if s == nil {
		return ""
	}
	return strings.TrimSpace(s.path)
}

type secretsFile struct {
	SchemaVersion int        `json:"schema_version"`
	AI            *aiSecrets `json:"ai,omitempty"`
}

type aiSecrets struct {
	ProviderAPIKeys map[string]string `json:"provider_api_keys,omitempty"`
}

func (s *SecretsStore) getAIProviderKey(providerID string) (string, bool, error) {
	if s == nil {
		return "", false, errors.New("nil secrets store")
	}
	providerID = strings.TrimSpace(providerID)
	if providerID == "" {
		return "", false, errors.New("missing provider id")
	}

	sf, err := s.loadLocked()
	if err != nil {
		return "", false, err
	}
	if sf == nil || sf.AI == nil || len(sf.AI.ProviderAPIKeys) == 0 {
		return "", false, nil
	}
	v, ok := sf.AI.ProviderAPIKeys[providerID]
	if !ok {
		return "", false, nil
	}
	v = strings.TrimSpace(v)
	if v == "" {
		return "", false, nil
	}
	return v, true, nil
}

func (s *SecretsStore) HasAIProviderAPIKey(providerID string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok, err := s.getAIProviderKey(providerID)
	return ok, err
}

func (s *SecretsStore) GetAIProviderAPIKey(providerID string) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.getAIProviderKey(providerID)
}

func (s *SecretsStore) SetAIProviderAPIKey(providerID string, apiKey string) error {
	if s == nil {
		return errors.New("nil secrets store")
	}
	providerID = strings.TrimSpace(providerID)
	if providerID == "" {
		return errors.New("missing provider id")
	}
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return errors.New("missing api key")
	}

	return s.ApplyAIProviderAPIKeyPatches([]AIProviderAPIKeyPatch{{ProviderID: providerID, APIKey: &apiKey}})
}

func (s *SecretsStore) ClearAIProviderAPIKey(providerID string) error {
	if s == nil {
		return errors.New("nil secrets store")
	}
	providerID = strings.TrimSpace(providerID)
	if providerID == "" {
		return errors.New("missing provider id")
	}

	return s.ApplyAIProviderAPIKeyPatches([]AIProviderAPIKeyPatch{{ProviderID: providerID, APIKey: nil}})
}

type AIProviderAPIKeyPatch struct {
	ProviderID string
	// APIKey is the new key to set. If nil, the key is cleared.
	APIKey *string
}

func (s *SecretsStore) ApplyAIProviderAPIKeyPatches(patches []AIProviderAPIKeyPatch) error {
	if s == nil {
		return errors.New("nil secrets store")
	}
	if len(patches) == 0 {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	sf, err := s.loadLocked()
	if err != nil {
		return err
	}
	if sf == nil {
		sf = &secretsFile{SchemaVersion: 1}
	}
	if sf.SchemaVersion == 0 {
		sf.SchemaVersion = 1
	}
	if sf.AI == nil {
		sf.AI = &aiSecrets{}
	}
	if sf.AI.ProviderAPIKeys == nil {
		sf.AI.ProviderAPIKeys = make(map[string]string)
	}

	for i := range patches {
		p := patches[i]
		providerID := strings.TrimSpace(p.ProviderID)
		if providerID == "" {
			return errors.New("missing provider id")
		}
		if p.APIKey == nil {
			delete(sf.AI.ProviderAPIKeys, providerID)
			continue
		}
		key := strings.TrimSpace(*p.APIKey)
		if key == "" {
			return errors.New("missing api key")
		}
		sf.AI.ProviderAPIKeys[providerID] = key
	}

	if len(sf.AI.ProviderAPIKeys) == 0 {
		sf.AI.ProviderAPIKeys = nil
	}
	return s.saveLocked(sf)
}

func (s *SecretsStore) GetAIProviderAPIKeySet(providerIDs []string) (map[string]bool, error) {
	if s == nil {
		return nil, errors.New("nil secrets store")
	}
	out := make(map[string]bool, len(providerIDs))

	s.mu.Lock()
	defer s.mu.Unlock()
	sf, err := s.loadLocked()
	if err != nil {
		return nil, err
	}

	var keys map[string]string
	if sf != nil && sf.AI != nil {
		keys = sf.AI.ProviderAPIKeys
	}
	for _, id := range providerIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		v := strings.TrimSpace(keys[id])
		out[id] = v != ""
	}
	return out, nil
}

func (s *SecretsStore) loadLocked() (*secretsFile, error) {
	path := strings.TrimSpace(s.path)
	if path == "" {
		return nil, errors.New("missing secrets path")
	}
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &secretsFile{SchemaVersion: 1}, nil
		}
		return nil, err
	}
	var sf secretsFile
	if err := json.Unmarshal(b, &sf); err != nil {
		return nil, err
	}
	if sf.SchemaVersion == 0 {
		sf.SchemaVersion = 1
	}
	return &sf, nil
}

func (s *SecretsStore) saveLocked(sf *secretsFile) error {
	if sf == nil {
		return errors.New("nil secrets")
	}
	path := strings.TrimSpace(s.path)
	if path == "" {
		return errors.New("missing secrets path")
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}

	b, err := json.MarshalIndent(sf, "", "  ")
	if err != nil {
		return err
	}
	b = append(b, '\n')

	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
