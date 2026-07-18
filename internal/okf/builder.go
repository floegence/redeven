package okf

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
	bundle, _, err := LoadSourceBundle(root)
	if err != nil {
		return BuildResult{}, err
	}

	bundleJSON, err := json.MarshalIndent(bundle, "", "  ")
	if err != nil {
		return BuildResult{}, err
	}

	bundleHash := sha256Hex(bundleJSON)
	sectionCount := 0
	evidenceCount := 0
	for _, concept := range bundle.Concepts {
		sectionCount += len(concept.Sections)
		evidenceCount += len(concept.Evidence)
	}
	manifest := BundleManifest{
		SchemaVersion: SchemaVersion,
		OKFVersion:    bundle.OKFVersion,
		ConceptCount:  len(bundle.Concepts),
		SectionCount:  sectionCount,
		EvidenceCount: evidenceCount,
		BundleSHA256:  bundleHash,
		SourceSHA256:  bundle.SourceSHA256,
	}
	manifestJSON, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return BuildResult{}, err
	}
	shaLine := fmt.Sprintf("%s  okf_bundle.json\n", bundleHash)

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
	if err := os.WriteFile(filepath.Join(root, "okf_bundle.json"), result.BundleJSON, 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(root, "okf_bundle.manifest.json"), result.ManifestJSON, 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(root, "okf_bundle.sha256"), result.SHA256File, 0o644); err != nil {
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
		{Name: "okf_bundle.json", Want: result.BundleJSON},
		{Name: "okf_bundle.manifest.json", Want: result.ManifestJSON},
		{Name: "okf_bundle.sha256", Want: result.SHA256File},
	}
	for _, item := range checks {
		got, err := os.ReadFile(filepath.Join(root, item.Name))
		if err != nil {
			return fmt.Errorf("read %s failed: %w", item.Name, err)
		}
		if strings.TrimSpace(string(got)) != strings.TrimSpace(string(item.Want)) {
			return fmt.Errorf("%s is stale; run scripts/build_okf_bundle.sh", item.Name)
		}
	}
	return nil
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
			if d.Name() == "dist" && path != root {
				return filepath.SkipDir
			}
			if strings.HasPrefix(d.Name(), ".") && path != root {
				return filepath.SkipDir
			}
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
