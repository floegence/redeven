package okf

import (
	"fmt"

	okfdist "github.com/floegence/redeven/okf/dist"
)

func embeddedBundleBytes() ([]byte, error) {
	payload, err := okfdist.BundleJSON()
	if err != nil {
		return nil, fmt.Errorf("read embedded bundle failed: %w", err)
	}
	return payload, nil
}
