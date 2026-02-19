package knowledge

import (
	"embed"
	"fmt"
)

//go:embed dist/knowledge_bundle.json dist/knowledge_bundle.manifest.json
var embeddedBundle embed.FS

func embeddedBundleBytes() ([]byte, error) {
	payload, err := embeddedBundle.ReadFile("dist/knowledge_bundle.json")
	if err != nil {
		return nil, fmt.Errorf("read embedded bundle failed: %w", err)
	}
	return payload, nil
}
