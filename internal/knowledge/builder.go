package knowledge

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type BuildResult struct {
	Bundle       Bundle
	BundleJSON   []byte
	Manifest     BundleManifest
	ManifestJSON []byte
	SHA256File   []byte
}

func BuildFromGenerated(generatedRoot string) (BuildResult, error) {
	cards, err := LoadGeneratedCards(generatedRoot)
	if err != nil {
		return BuildResult{}, err
	}
	indices, err := LoadGeneratedIndices(generatedRoot)
	if err != nil {
		return BuildResult{}, err
	}
	lock, lockRaw, err := loadLockFile(filepath.Join(strings.TrimSpace(generatedRoot), "knowledge_lock.json"))
	if err != nil {
		return BuildResult{}, err
	}

	bundle := Bundle{
		SchemaVersion: SchemaVersion,
		GeneratedAt:   strings.TrimSpace(lock.GeneratedAt),
		SourceCommit:  strings.TrimSpace(lock.RedevenSourceCommit),
		PromptVersion: strings.TrimSpace(lock.Generator.PromptVersion),
		Cards:         cards,
		Indices:       indices,
	}
	bundleJSON, err := json.MarshalIndent(bundle, "", "  ")
	if err != nil {
		return BuildResult{}, err
	}

	cardsJSON, err := json.Marshal(cards)
	if err != nil {
		return BuildResult{}, err
	}
	topicsJSON, err := json.Marshal(bundle.Indices.Topics)
	if err != nil {
		return BuildResult{}, err
	}
	codeJSON, err := json.Marshal(bundle.Indices.CodePaths)
	if err != nil {
		return BuildResult{}, err
	}

	bundleHash := sha256Hex(bundleJSON)
	manifest := BundleManifest{
		SchemaVersion:    SchemaVersion,
		GeneratedAt:      bundle.GeneratedAt,
		SourceCommit:     bundle.SourceCommit,
		CardCount:        len(bundle.Cards),
		BundleSHA256:     bundleHash,
		CardsSHA256:      sha256Hex(cardsJSON),
		TopicIndexSHA256: sha256Hex(topicsJSON),
		CodeIndexSHA256:  sha256Hex(codeJSON),
		LockSHA256:       sha256Hex(lockRaw),
	}
	manifestJSON, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return BuildResult{}, err
	}
	shaLine := fmt.Sprintf("%s  knowledge_bundle.json\n", bundleHash)

	return BuildResult{
		Bundle:       bundle,
		BundleJSON:   bundleJSON,
		Manifest:     manifest,
		ManifestJSON: manifestJSON,
		SHA256File:   []byte(shaLine),
	}, nil
}

func WriteDistFiles(distRoot string, result BuildResult) error {
	root := strings.TrimSpace(distRoot)
	if root == "" {
		return fmt.Errorf("missing dist root")
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(root, "knowledge_bundle.json"), result.BundleJSON, 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(root, "knowledge_bundle.manifest.json"), result.ManifestJSON, 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(root, "knowledge_bundle.sha256"), result.SHA256File, 0o644); err != nil {
		return err
	}
	return nil
}

func VerifyDistFiles(distRoot string, result BuildResult) error {
	root := strings.TrimSpace(distRoot)
	if root == "" {
		return fmt.Errorf("missing dist root")
	}
	checks := []struct {
		Name string
		Want []byte
	}{
		{Name: "knowledge_bundle.json", Want: result.BundleJSON},
		{Name: "knowledge_bundle.manifest.json", Want: result.ManifestJSON},
		{Name: "knowledge_bundle.sha256", Want: result.SHA256File},
	}
	for _, item := range checks {
		got, err := os.ReadFile(filepath.Join(root, item.Name))
		if err != nil {
			return fmt.Errorf("read %s failed: %w", item.Name, err)
		}
		if strings.TrimSpace(string(got)) != strings.TrimSpace(string(item.Want)) {
			return fmt.Errorf("%s is stale; run scripts/build_knowledge_bundle.sh", item.Name)
		}
	}
	return nil
}

func loadLockFile(path string) (LockFile, []byte, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return LockFile{}, nil, err
	}
	var lock LockFile
	if err := json.Unmarshal(raw, &lock); err != nil {
		return LockFile{}, nil, fmt.Errorf("parse lock failed: %w", err)
	}
	if lock.SchemaVersion <= 0 {
		return LockFile{}, nil, fmt.Errorf("invalid schema_version in lock file")
	}
	if strings.TrimSpace(lock.RedevenSourceCommit) == "" {
		return LockFile{}, nil, fmt.Errorf("lock file missing redeven_source_commit")
	}
	if strings.TrimSpace(lock.Generator.Engine) == "" {
		return LockFile{}, nil, fmt.Errorf("lock file missing generator.engine")
	}
	if strings.TrimSpace(lock.GeneratedAt) == "" {
		return LockFile{}, nil, fmt.Errorf("lock file missing generated_at")
	}
	return lock, raw, nil
}

func sha256Hex(payload []byte) string {
	h := sha256.Sum256(payload)
	return hex.EncodeToString(h[:])
}

func SortCardIDs(mapping map[string][]string) {
	for key := range mapping {
		ids := mapping[key]
		sort.Strings(ids)
		mapping[key] = ids
	}
}
