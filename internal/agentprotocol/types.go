package agentprotocol

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"strings"
)

const SchemaVersion = 1

const (
	ErrCodeAgentProtocol         = "AGENT_PROTOCOL_ERROR"
	ErrCodeTargetDiscoveryFailed = "TARGET_DISCOVERY_FAILED"
	ErrCodeTargetMissing         = "TARGET_MISSING"
	ErrCodeTargetNotFound        = "TARGET_NOT_FOUND"
)

type Response struct {
	SchemaVersion int            `json:"schema_version"`
	OK            bool           `json:"ok"`
	Data          any            `json:"data,omitempty"`
	Error         *ResponseError `json:"error,omitempty"`
	Trace         ResponseTrace  `json:"trace"`
}

type ResponseError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type ResponseTrace struct {
	RequestID string `json:"request_id"`
	TargetID  string `json:"target_id,omitempty"`
	Source    string `json:"source"`
}

func Success(data any, targetID string) Response {
	return Response{
		SchemaVersion: SchemaVersion,
		OK:            true,
		Data:          data,
		Trace: ResponseTrace{
			RequestID: newRequestID(),
			TargetID:  strings.TrimSpace(targetID),
			Source:    "redeven_cli",
		},
	}
}

func Failure(code string, message string, targetID string) Response {
	code = strings.TrimSpace(code)
	if code == "" {
		code = ErrCodeAgentProtocol
	}
	message = strings.TrimSpace(message)
	if message == "" {
		message = "request failed"
	}
	return Response{
		SchemaVersion: SchemaVersion,
		OK:            false,
		Error: &ResponseError{
			Code:    code,
			Message: message,
		},
		Trace: ResponseTrace{
			RequestID: newRequestID(),
			TargetID:  strings.TrimSpace(targetID),
			Source:    "redeven_cli",
		},
	}
}

func MarshalJSONLine(resp Response) ([]byte, error) {
	body, err := json.Marshal(resp)
	if err != nil {
		return nil, err
	}
	return append(body, '\n'), nil
}

func newRequestID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "req_unknown"
	}
	return "req_" + hex.EncodeToString(b[:])
}

type TargetCatalog struct {
	Targets []TargetDescriptor `json:"targets"`
}

type TargetDescriptor struct {
	ID                    string   `json:"id"`
	Kind                  string   `json:"kind"`
	Label                 string   `json:"label"`
	Status                string   `json:"status"`
	StateRoot             string   `json:"state_root,omitempty"`
	StateDir              string   `json:"state_dir,omitempty"`
	ConfigPath            string   `json:"config_path,omitempty"`
	RuntimeStatePath      string   `json:"runtime_state_path,omitempty"`
	LocalUIURL            string   `json:"local_ui_url,omitempty"`
	LocalUIURLs           []string `json:"local_ui_urls,omitempty"`
	PasswordRequired      bool     `json:"password_required,omitempty"`
	EffectiveRunMode      string   `json:"effective_run_mode,omitempty"`
	RemoteEnabled         bool     `json:"remote_enabled,omitempty"`
	DesktopManaged        bool     `json:"desktop_managed,omitempty"`
	ControlplaneBaseURL   string   `json:"controlplane_base_url,omitempty"`
	ControlplaneProvider  string   `json:"controlplane_provider_id,omitempty"`
	EnvPublicID           string   `json:"env_public_id,omitempty"`
	LocalEnvironmentID    string   `json:"local_environment_public_id,omitempty"`
	AgentHomeDir          string   `json:"agent_home_dir,omitempty"`
	Shell                 string   `json:"shell,omitempty"`
	Capabilities          []string `json:"capabilities"`
	UnavailableReasonCode string   `json:"unavailable_reason_code,omitempty"`
}
