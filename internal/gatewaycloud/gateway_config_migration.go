package gatewaycloud

import (
	"encoding/json"
	"github.com/floegence/redeven/internal/gatewaystate"
)

// readGatewayConfig is the one-time reader for retired Cloud-only membership.
// It deliberately retains no old member credential, root CA or network route.
func readGatewayConfig(path string, config *GatewayConfig) error {
	var raw json.RawMessage
	if err := gatewaystate.Read(path, &raw); err != nil {
		return err
	}
	var version struct {
		SchemaVersion int `json:"schema_version"`
	}
	if err := json.Unmarshal(raw, &version); err != nil {
		return err
	}
	if version.SchemaVersion != 1 {
		return gatewaystate.Read(path, config)
	}
	if err := json.Unmarshal(raw, config); err != nil {
		return err
	}
	config.SchemaVersion, config.Status = 2, nil
	return gatewaystate.Write(path, config)
}
