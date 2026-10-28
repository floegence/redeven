//go:build !darwin && !linux

package environmentcenter

import "errors"

func validateStateOwnership(string) error {
	return errors.New("Center requires Linux or macOS owner credentials")
}
