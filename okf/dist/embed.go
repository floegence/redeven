package dist

import (
	"embed"
	"fmt"
)

//go:embed okf_bundle.json okf_bundle.manifest.json
var embeddedBundle embed.FS

func BundleJSON() ([]byte, error) {
	payload, err := embeddedBundle.ReadFile("okf_bundle.json")
	if err != nil {
		return nil, fmt.Errorf("read embedded OKF bundle failed: %w", err)
	}
	return payload, nil
}
