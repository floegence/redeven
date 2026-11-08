package managedwebservice

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"

	servicetemplates "github.com/floegence/redeven-service-templates"
	templatecontract "github.com/floegence/redeven-service-templates/template"
)

func TestPublishedTemplateProfileRequiresEveryOriginalByteAndMode(t *testing.T) {
	files := []templatecontract.File{{Path: templatecontract.Filename, Mode: "100644", Content: []byte("declaration")}, {Path: "locales/en-US.json", Mode: "100644", Content: []byte("localization")}}
	inputs := []map[string]string{}
	for _, f := range files {
		sum := sha256.Sum256(f.Content)
		inputs = append(inputs, map[string]string{"path": "templates/example/" + f.Path, "sha256": hex.EncodeToString(sum[:])})
	}
	manifest := map[string]any{"schema_version": 1, "catalog_version": servicetemplates.Version, "bundle_sha256": servicetemplates.BundleSHA256(), "inputs": inputs}
	raw, _ := json.Marshal(manifest)
	if !matchesPublishedTemplateInputs(raw, "example", files) {
		t.Fatal("published originals rejected")
	}
	for _, mode := range []string{"changed", "executable", "added", "missing", "duplicate", "wrong-document", "invalid-manifest", "different-release", "different-bundle"} {
		t.Run(mode, func(t *testing.T) {
			copy := append([]templatecontract.File(nil), files...)
			data := raw
			id := "example"
			switch mode {
			case "changed":
				copy[0].Content = []byte("changed")
			case "executable":
				copy[0].Mode = "100755"
			case "added":
				copy = append(copy, templatecontract.File{Path: "script.sh", Mode: "100755", Content: []byte("exec true")})
			case "missing":
				copy = copy[1:]
			case "duplicate":
				copy[1] = copy[0]
			case "wrong-document":
				id = "another"
			case "invalid-manifest":
				data = []byte("{}")
			case "different-release", "different-bundle":
				var altered map[string]any
				json.Unmarshal(raw, &altered)
				if mode == "different-release" {
					altered["catalog_version"] = "v0.0.0"
				} else {
					altered["bundle_sha256"] = "changed"
				}
				data, _ = json.Marshal(altered)
			}
			if matchesPublishedTemplateInputs(data, id, copy) {
				t.Fatal("unreviewed source granted privileged profile")
			}
		})
	}
}
