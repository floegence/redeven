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

func BuildFromSource(sourceRoot string) (BuildResult, error) {
	root := strings.TrimSpace(sourceRoot)
	if root == "" {
		return BuildResult{}, fmt.Errorf("missing source root")
	}

	sourceManifest, _, err := LoadSourceManifest(root)
	if err != nil {
		return BuildResult{}, err
	}
	allowedRepos := make(map[string]struct{}, len(sourceManifest.AllowedRepos))
	for _, repo := range sourceManifest.AllowedRepos {
		allowedRepos[repo] = struct{}{}
	}

	cards, err := LoadSourceCards(root, allowedRepos)
	if err != nil {
		return BuildResult{}, err
	}
	indices, err := LoadSourceIndices(root, allowedRepos)
	if err != nil {
		return BuildResult{}, err
	}
	if err := validateCardsAndIndices(cards, indices); err != nil {
		return BuildResult{}, err
	}

	sourceHash, err := hashTree(root)
	if err != nil {
		return BuildResult{}, err
	}

	bundle := Bundle{
		SchemaVersion: SchemaVersion,
		BuiltAt:       sourceManifest.UpdatedAt,
		KnowledgeID:   sourceManifest.KnowledgeID,
		KnowledgeName: sourceManifest.KnowledgeName,
		AllowedRepos:  append([]string(nil), sourceManifest.AllowedRepos...),
		SourceRefs:    cloneSourceRefs(sourceManifest.SourceRefs),
		SourceSHA256:  sourceHash,
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
		BuiltAt:          bundle.BuiltAt,
		KnowledgeID:      bundle.KnowledgeID,
		AllowedRepos:     append([]string(nil), bundle.AllowedRepos...),
		CardCount:        len(bundle.Cards),
		BundleSHA256:     bundleHash,
		CardsSHA256:      sha256Hex(cardsJSON),
		TopicIndexSHA256: sha256Hex(topicsJSON),
		CodeIndexSHA256:  sha256Hex(codeJSON),
		SourceSHA256:     sourceHash,
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

func validateCardsAndIndices(cards []Card, indices Indices) error {
	cardIDs := make(map[string]struct{}, len(cards))
	for _, card := range cards {
		cardIDs[card.ID] = struct{}{}
	}
	for topic, ids := range indices.Topics {
		if strings.TrimSpace(topic) == "" {
			return fmt.Errorf("topic index contains empty topic")
		}
		for _, id := range ids {
			if _, ok := cardIDs[id]; !ok {
				return fmt.Errorf("topic index references unknown card id %q", id)
			}
		}
	}
	for path, ids := range indices.CodePaths {
		repo, _, err := splitRepoPath(path)
		if err != nil {
			return fmt.Errorf("invalid code index path %q: %w", path, err)
		}
		if strings.EqualFold(repo, "redeven") {
			return fmt.Errorf("code index must not contain redeven path %q", path)
		}
		for _, id := range ids {
			if _, ok := cardIDs[id]; !ok {
				return fmt.Errorf("code index references unknown card id %q", id)
			}
		}
	}
	return nil
}

func cloneSourceRefs(raw map[string]string) map[string]string {
	if len(raw) == 0 {
		return nil
	}
	out := make(map[string]string, len(raw))
	for repo, ref := range raw {
		repo = strings.TrimSpace(repo)
		ref = strings.TrimSpace(ref)
		if repo == "" || ref == "" {
			continue
		}
		out[repo] = ref
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func sha256Hex(payload []byte) string {
	h := sha256.Sum256(payload)
	return hex.EncodeToString(h[:])
}

func hashTree(root string) (string, error) {
	entries := make([]string, 0, 64)
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		entries = append(entries, filepath.ToSlash(rel))
		return nil
	})
	if err != nil {
		return "", err
	}
	sort.Strings(entries)
	h := sha256.New()
	for _, rel := range entries {
		payload, err := os.ReadFile(filepath.Join(root, rel))
		if err != nil {
			return "", err
		}
		_, _ = h.Write([]byte(rel))
		_, _ = h.Write([]byte("\n"))
		_, _ = h.Write(payload)
		_, _ = h.Write([]byte("\n"))
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
