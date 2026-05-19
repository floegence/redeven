package runtimepresentation

import "time"

type Phase string

const (
	PhaseResolveState   Phase = "resolve_state"
	PhaseAcquireLock    Phase = "acquire_lock"
	PhaseLoadConfig     Phase = "load_config"
	PhaseBootstrap      Phase = "bootstrap"
	PhaseStartServices  Phase = "start_services"
	PhaseStartLocalUI   Phase = "start_local_ui"
	PhaseConnectControl Phase = "connect_control"
	PhaseReady          Phase = "ready"
	PhaseShutdown       Phase = "shutdown"
)

type EventKind string

const (
	EventPhaseStarted EventKind = "phase_started"
	EventPhaseDone    EventKind = "phase_done"
	EventInfo         EventKind = "info"
	EventWarning      EventKind = "warning"
	EventFailure      EventKind = "failure"
	EventReady        EventKind = "ready"
)

type Severity string

const (
	SeverityInfo     Severity = "info"
	SeverityWarning  Severity = "warning"
	SeverityError    Severity = "error"
	SeverityCritical Severity = "critical"
)

type Snapshot struct {
	Version                  string
	Commit                   string
	RequestedRunMode         string
	EffectiveRunMode         string
	PresentationMode         string
	DesktopManaged           bool
	RemoteEnabled            bool
	ControlChannelEnabled    bool
	LocalUIEnabled           bool
	ControlplaneBaseURL      string
	ControlplaneProviderID   string
	EnvPublicID              string
	StateDir                 string
	LocalUIBind              string
	LocalUIURLs              []string
	EnvironmentURL           string
	RuntimeControlSocketPath string
}

type Event struct {
	Kind        EventKind
	Phase       Phase
	Title       string
	Detail      string
	Snapshot    Snapshot
	ErrorCode   string
	ErrorDetail string
	Severity    Severity
	Remediation string
	At          time.Time
}

func (e Event) withTime() Event {
	if e.At.IsZero() {
		e.At = time.Now()
	}
	return e
}

type Result struct {
	Success  bool
	Snapshot Snapshot
	Error    error
}
