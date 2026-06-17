package okf

import (
	"embed"
	"fmt"
)

//go:embed dist/okf_bundle.json dist/okf_bundle.manifest.json
var embeddedBundle embed.FS

func embeddedBundleBytes() ([]byte, error) {
	payload, err := embeddedBundle.ReadFile("dist/okf_bundle.json")
	if err != nil {
		return nil, fmt.Errorf("read embedded bundle failed: %w", err)
	}
	return payload, nil
}
