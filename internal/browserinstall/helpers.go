package browserinstall

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
)

// PrepareComputerHelpers unpacks the immutable helper archive from an already
// verified Redeven Runtime suite. It never downloads a browser or executes code.
func PrepareComputerHelpers(archivePath, stateDirectory string) (string, error) {
	file, err := os.Open(archivePath)
	if err != nil {
		return "", err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > 256<<20 {
		return "", errors.New("invalid computer helper archive")
	}
	digest := sha256.New()
	if _, err = io.Copy(digest, file); err != nil {
		return "", err
	}
	root := filepath.Join(stateDirectory, "helpers", fmt.Sprintf("%x", digest.Sum(nil)))
	if err = validateHelpers(root); err == nil {
		return filepath.Join(root, "redevenComputerHost.mjs"), nil
	}
	if err = os.MkdirAll(filepath.Dir(root), 0700); err != nil {
		return "", err
	}
	staging, err := os.MkdirTemp(filepath.Dir(root), ".prepare-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(staging)
	if err = extract(context.Background(), file, info.Size(), staging, 1<<30); err != nil {
		return "", err
	}
	if err = validateHelpers(staging); err != nil {
		return "", err
	}
	if err = os.RemoveAll(root); err != nil {
		return "", err
	}
	if err = os.Rename(staging, root); err != nil {
		return "", err
	}
	return filepath.Join(root, "redevenComputerHost.mjs"), nil
}
func validateHelpers(root string) error {
	data, err := os.ReadFile(filepath.Join(root, "manifest.json"))
	if err != nil {
		return err
	}
	var manifest struct {
		Version      int    `json:"schema_version"`
		Platform     string `json:"platform"`
		Architecture string `json:"architecture"`
		Files        []struct {
			Path       string `json:"path"`
			SHA256     string `json:"sha256"`
			Size       int64  `json:"size_bytes"`
			Executable bool   `json:"executable"`
		} `json:"files"`
	}
	arch := runtime.GOARCH
	if arch == "amd64" {
		arch = "x64"
	}
	if json.Unmarshal(data, &manifest) != nil || manifest.Version != 1 || manifest.Platform != runtime.GOOS || manifest.Architecture != arch {
		return errors.New("computer helper platform mismatch")
	}
	required := map[string]bool{"node": false, "redevenComputerHost.mjs": false, "redevenManagedBrowser.mjs": false,
		"computerBrowserSource.mjs": false, "node_modules/playwright/package.json": false,
		"redevenBrowserHost.mjs": false, "computerBrowserHost.mjs": false, "computerManagedDownloads.mjs": false, "computerBrowserLineage.mjs": false, "computerExtensionTransport.mjs": false,
		"node_modules/@floegence/floebrowser/package.json": false, "node_modules/@floegence/floebrowser/dist/host/index.js": false,
		"node_modules/@floegence/floebrowser/dist/bin/manifest.json":                                       false,
		"node_modules/@floegence/floebrowser/dist/bin/" + runtime.GOOS + "-" + arch + "/floebrowser-media": false,
		"extension/manifest.json": false, "extension/background.mjs": false, "extension/computerBrowserLineage.mjs": false, "extension/popup.html": false, "extension/popup.mjs": false}
	seen := map[string]bool{}
	for _, item := range manifest.Files {
		if !filepath.IsLocal(item.Path) || filepath.Clean(item.Path) != item.Path || seen[item.Path] {
			return errors.New("invalid computer helper manifest")
		}
		seen[item.Path] = true
		name := filepath.Join(root, item.Path)
		stat, err := os.Lstat(name)
		if err != nil || !stat.Mode().IsRegular() || stat.Size() != item.Size || (stat.Mode()&0111 != 0) != item.Executable {
			return errors.New("computer helper inventory mismatch")
		}
		file, err := os.Open(name)
		if err != nil {
			return err
		}
		digest := sha256.New()
		_, err = io.Copy(digest, file)
		file.Close()
		if err != nil || fmt.Sprintf("%x", digest.Sum(nil)) != item.SHA256 {
			return errors.New("computer helper digest mismatch")
		}
		if _, ok := required[item.Path]; ok {
			required[item.Path] = true
		}
	}
	for _, present := range required {
		if !present {
			return errors.New("computer helper entrypoint missing")
		}
	}
	return filepath.WalkDir(root, func(name string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		relative, err := filepath.Rel(root, name)
		if err != nil {
			return err
		}
		if relative != "manifest.json" && !seen[relative] {
			return errors.New("undeclared computer helper file")
		}
		return nil
	})
}
