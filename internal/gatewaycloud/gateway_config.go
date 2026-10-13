package gatewaycloud

import "github.com/floegence/redeven/internal/gatewaystate"

// Unsupported state is rejected read-only. Management re-registration uses a
// fresh state root; it never rewrites old credentials or routes.
func readGatewayConfig(path string, config *GatewayConfig) error {
	if err := gatewaystate.Read(path, config); err != nil {
		return err
	}
	if config.SchemaVersion != gatewayConfigVersion {
		return ErrState
	}
	return nil
}
