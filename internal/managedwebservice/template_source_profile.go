package managedwebservice

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"

	servicetemplates "github.com/floegence/redeven-service-templates"
	templatecontract "github.com/floegence/redeven-service-templates/template"
)

// A market classification or a transferred repository identity cannot grant
// privileged runtime settings. Only the exact originals audited in the
// published package can use the reserved profile, including after restart.
func reviewedTemplateSource(documentID string, files []templatecontract.File) bool {
	return matchesPublishedTemplateInputs(servicetemplates.Manifest(), documentID, files)
}

func matchesPublishedTemplateInputs(raw []byte, documentID string, files []templatecontract.File) bool {
	var manifest struct {
		SchemaVersion  int    `json:"schema_version"`
		CatalogVersion string `json:"catalog_version"`
		BundleSHA256   string `json:"bundle_sha256"`
		Inputs         []struct {
			Path   string `json:"path"`
			SHA256 string `json:"sha256"`
		} `json:"inputs"`
	}
	if json.Unmarshal(raw, &manifest) != nil || manifest.SchemaVersion != 1 || manifest.CatalogVersion != servicetemplates.Version || manifest.BundleSHA256 != servicetemplates.BundleSHA256() {
		return false
	}
	prefix := "templates/" + documentID + "/"
	expected := map[string]string{}
	for _, input := range manifest.Inputs {
		if name, ok := strings.CutPrefix(input.Path, prefix); ok {
			if _, duplicate := expected[name]; duplicate {
				return false
			}
			expected[name] = input.SHA256
		}
	}
	if len(expected) == 0 || len(files) != len(expected) {
		return false
	}
	for _, file := range files {
		digest, ok := expected[file.Path]
		sum := sha256.Sum256(file.Content)
		// The published catalog manifest describes data files, not executable modes.
		if !ok || file.Mode != "100644" || hex.EncodeToString(sum[:]) != digest {
			return false
		}
		delete(expected, file.Path)
	}
	return len(expected) == 0
}
