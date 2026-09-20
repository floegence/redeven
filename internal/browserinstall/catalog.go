// Package browserinstall owns Redeven's optional browser distribution and consent.
package browserinstall

import (
	"embed"
	"encoding/json"
	"fmt"
	"runtime"
)

//go:embed catalog.json
var catalogFS embed.FS

type Package struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Platform       string `json:"platform"`
	Architecture   string `json:"architecture"`
	Version        string `json:"version"`
	URL            string `json:"url"`
	SHA256         string `json:"sha256"`
	SizeBytes      int64  `json:"size_bytes"`
	InstalledBytes int64  `json:"installed_bytes"`
	Executable     string `json:"executable"`
}

func NativePackage() (Package, error) { return ForPlatform(runtime.GOOS, runtime.GOARCH) }
func ForPlatform(platform, architecture string) (Package, error) {
	var catalog struct {
		Packages []Package `json:"packages"`
	}
	data, err := catalogFS.ReadFile("catalog.json")
	if err != nil {
		return Package{}, err
	}
	if err = json.Unmarshal(data, &catalog); err != nil {
		return Package{}, err
	}
	for _, item := range catalog.Packages {
		if item.Platform == platform && item.Architecture == architecture {
			return item, nil
		}
	}
	return Package{}, fmt.Errorf("built-in browser is unsupported on %s/%s", platform, architecture)
}
