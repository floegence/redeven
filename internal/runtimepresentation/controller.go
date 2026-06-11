package runtimepresentation

import "context"

type ControlPlaneSetup struct {
	ProviderOrigin    string
	AccessPointOrigin string
	EnvironmentID     string
	BootstrapTicket   string
}

type ControlPlaneStatus struct {
	Enabled        bool
	Connected      bool
	Connectable    bool
	Label          string
	ActionLabel    string
	DisabledReason string
}

type RuntimeWorkload struct {
	ActiveSessions      int
	AgentSessions       int
	CodeSessions        int
	PortForwardSessions int
	TerminalSessions    int
	ActiveTasks         int
}

type RuntimeProviderLink struct {
	State                    string
	ProviderOrigin           string
	ProviderID               string
	EnvPublicID              string
	AccessPointOrigin        string
	LocalEnvironmentPublicID string
	RemoteEnabled            bool
	LastErrorCode            string
	LastErrorMessage         string
}

type RuntimeOverview struct {
	Version                 string
	Commit                  string
	BuildTime               string
	ProtocolVersion         string
	Compatibility           string
	CompatibilityMessage    string
	MinimumDesktopVersion   string
	MinimumRuntimeVersion   string
	ServiceOwner            string
	DesktopManaged          bool
	EffectiveRunMode        string
	RemoteEnabled           bool
	OpenReadinessState      string
	OpenReadinessReasonCode string
	OpenReadinessMessage    string
	Workload                RuntimeWorkload
	ProviderLink            RuntimeProviderLink
}

type RuntimeSession struct {
	ChannelID         string
	UserPublicID      string
	UserEmail         string
	FloeApp           string
	AppLabel          string
	CodeSpaceID       string
	SessionKind       string
	TunnelURL         string
	CreatedAtUnixMs   int64
	ConnectedAtUnixMs int64
	CanRead           bool
	CanWrite          bool
	CanExecute        bool
}

type Controller interface {
	ConnectControlPlane(ctx context.Context) error
	DisconnectControlPlane(ctx context.Context) error
	ConfigureControlPlane(ctx context.Context, setup ControlPlaneSetup) (ControlPlaneStatus, error)
	ControlPlaneStatus() ControlPlaneStatus
	RuntimeOverview() RuntimeOverview
	RuntimeSessions() []RuntimeSession
}
