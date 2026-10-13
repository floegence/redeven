package config

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ModelCatalogIdentity contains no credential bytes. Rotating credentials or
// changing an account/endpoint starts a separate inventory scope.
func ModelCatalogIdentity(p AIProvider, key string) string {
	if p.EffectiveAuthMethod() == AIAuthChatGPT {
		key = ""
	}
	credential := sha256.Sum256([]byte(key))
	raw, _ := json.Marshal([]string{p.ID, p.Type, strings.TrimRight(p.BaseURL, "/"), p.EffectiveAuthMethod(), p.AccountID, hex.EncodeToString(credential[:])})
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}

type modelCatalogSnapshot struct {
	Version  int               `json:"version"`
	Identity string            `json:"identity"`
	Models   []AIProviderModel `json:"models"`
}

func ReadModelCatalogSnapshot(root, identity string) ([]AIProviderModel, error) {
	if len(identity) != 64 {
		return nil, errors.New("invalid model catalog scope")
	}
	if _, err := hex.DecodeString(identity); err != nil {
		return nil, errors.New("invalid model catalog scope")
	}
	f, err := os.Open(filepath.Join(root, identity+".json"))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, 16<<20+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > 16<<20 {
		return nil, errors.New("model snapshot exceeds limit")
	}
	var snapshot modelCatalogSnapshot
	if err = json.Unmarshal(raw, &snapshot); err != nil {
		return nil, err
	}
	if snapshot.Version != 1 || snapshot.Identity != identity || snapshot.Models == nil {
		return nil, errors.New("invalid model snapshot")
	}
	if err = ValidateModelCatalogSnapshot(snapshot.Models); err != nil {
		return nil, err
	}
	return cloneAIModels(snapshot.Models), nil
}

func ValidateModelCatalogSnapshot(models []AIProviderModel) error {
	if len(models) > 10000 {
		return errors.New("model catalog exceeds inventory limit")
	}
	seen := map[string]bool{}
	for _, m := range models {
		if strings.TrimSpace(m.ModelName) == "" || strings.ContainsAny(m.ModelName, "/\x00\r\n") || strings.ContainsAny(m.WireModelName, "\x00\r\n") || seen[m.ModelName] || m.ContextWindow < 0 || m.MaxOutputTokens < 0 || m.ContextWindow > 0 && m.MaxOutputTokens > m.ContextWindow {
			return errors.New("invalid model catalog identity or capability")
		}
		seen[m.ModelName] = true
		if err := validateAIInputModalities(m.InputModalities); err != nil {
			return err
		}
		if err := m.ReasoningCapability.Validate(); err != nil {
			return err
		}
	}
	return nil
}

// WriteModelCatalogSnapshot publishes a complete inventory atomically. Readers
// in Desktop processes see either the old complete file or the new complete file.
func WriteModelCatalogSnapshot(root, identity string, models []AIProviderModel) error {
	if len(identity) != 64 {
		return errors.New("invalid model catalog scope")
	}
	if _, err := hex.DecodeString(identity); err != nil {
		return errors.New("invalid model catalog scope")
	}
	if err := ValidateModelCatalogSnapshot(models); err != nil {
		return err
	}
	if models == nil {
		models = []AIProviderModel{}
	}
	raw, err := json.Marshal(modelCatalogSnapshot{Version: 1, Identity: identity, Models: models})
	if err != nil {
		return err
	}
	if len(raw) > 16<<20 {
		return errors.New("model snapshot exceeds limit")
	}
	if err = os.MkdirAll(root, 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(root, ".catalog-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(raw)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), filepath.Join(root, identity+".json"))
}

// WithLocalModelCatalogs reads metadata only, never a provider endpoint. It is
// shared by the Runtime writer and the read-only Desktop model source.
func WithLocalModelCatalogs(cfg *AIConfig, root string, resolveKey func(string) (string, bool, error)) *AIConfig {
	if cfg == nil {
		return nil
	}
	next := *cfg
	next.Providers = append([]AIProvider(nil), cfg.Providers...)
	for i, p := range next.Providers {
		key := ""
		if resolveKey != nil && p.EffectiveAuthMethod() != AIAuthChatGPT {
			var err error
			key, _, err = resolveKey(p.ID)
			if err != nil {
				continue
			}
		}
		if models, err := ReadModelCatalogSnapshot(root, ModelCatalogIdentity(p, key)); err == nil {
			next.Providers[i] = p.WithDiscoveredModels(models)
		}
	}
	return &next
}
