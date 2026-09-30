// Package nativebridge defines the restricted native client placement protocol.
package nativebridge

import "github.com/floegence/redeven/internal/runtimemanagement"

const (
	ProtocolVersion  = "redeven-native-runtime-h2/1"
	BridgeAuthority  = "redeven-native"
	HelloPath        = "/redeven/native/v1/hello"
	RuntimeAuthority = "native-runtime"
	TokenHeader      = "X-Redeven-Native-Token"
)

type Hello struct {
	ProtocolVersion string                                    `json:"protocol_version"`
	Identity        runtimemanagement.RuntimeInstanceIdentity `json:"identity"`
	Endpoint        string                                    `json:"endpoint"`
	ChannelToken    string                                    `json:"channel_token"`
	ExpiresAtUnixMS int64                                     `json:"expires_at_unix_ms"`
}
