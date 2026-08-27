package desktopbridge

const (
	ProtocolVersion = "redeven-desktop-placement-h2/1"

	HelloPath           = "/redeven/placement/v1/hello"
	ShutdownRuntimePath = "/redeven/placement/v1/actions/shutdown-runtime"
	BridgeAuthority     = "redeven-placement"
	ErrorCodeHeader     = "X-Redeven-Placement-Error-Code"
)

const (
	MaxConcurrentStreams      = 64
	MaxHeaderListBytes        = 8 << 10
	MaxControlResponseBytes   = 1 << 20
	StreamReceiveWindowBytes  = 256 << 10
	SessionReceiveWindowBytes = 16 << 20
)

const (
	ErrorInvalidRequest     = "INVALID_REQUEST"
	ErrorSurfaceUnavailable = "SURFACE_UNAVAILABLE"
	ErrorSurfaceDialFailed  = "SURFACE_DIAL_FAILED"
)

type Hello struct {
	ProtocolVersion string          `json:"protocol_version"`
	RuntimeVersion  string          `json:"runtime_version"`
	RuntimeCommit   string          `json:"runtime_commit,omitempty"`
	StartedAtUnixMS int64           `json:"started_at_unix_ms,omitempty"`
	LocalUI         HelloLocalUI    `json:"local_ui"`
	RuntimeControl  RuntimeControl  `json:"runtime_control"`
	RuntimeService  any             `json:"runtime_service"`
	GatewayProtocol GatewayProtocol `json:"gateway_protocol,omitempty"`
	GatewayService  *GatewayService `json:"gateway_service,omitempty"`
}

type HelloLocalUI struct {
	Available   bool   `json:"available"`
	BasePath    string `json:"base_path"`
	BridgeToken string `json:"bridge_token,omitempty"`
}

type GatewayProtocol struct {
	Available bool `json:"available"`
}

type GatewayService struct {
	StateRoot          string `json:"state_root"`
	ExecutablePath     string `json:"executable_path"`
	ServicePID         int    `json:"service_pid"`
	ManagedBridgeToken string `json:"managed_bridge_token"`
}

type RuntimeControl struct {
	Available       bool   `json:"available"`
	ProtocolVersion string `json:"protocol_version,omitempty"`
	BaseURL         string `json:"base_url,omitempty"`
	Token           string `json:"token,omitempty"`
}

type StreamSurface string

const (
	StreamSurfaceLocalUI         StreamSurface = "local_ui"
	StreamSurfaceRuntimeControl  StreamSurface = "runtime_control"
	StreamSurfaceGatewayProtocol StreamSurface = "gateway_protocol"
)

func (surface StreamSurface) Authority() string {
	switch surface {
	case StreamSurfaceLocalUI:
		return "local-ui"
	case StreamSurfaceRuntimeControl:
		return "runtime-control"
	case StreamSurfaceGatewayProtocol:
		return "gateway-protocol"
	default:
		return ""
	}
}

func SurfaceFromAuthority(authority string) (StreamSurface, bool) {
	switch authority {
	case "local-ui":
		return StreamSurfaceLocalUI, true
	case "runtime-control":
		return StreamSurfaceRuntimeControl, true
	case "gateway-protocol":
		return StreamSurfaceGatewayProtocol, true
	default:
		return "", false
	}
}
