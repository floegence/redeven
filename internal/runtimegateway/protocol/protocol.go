package protocol

import (
	"errors"
	"strings"
)

const Version = "redeven-runtime-gateway-v1"

type EnvironmentState string

const (
	EnvironmentStateUnknown   EnvironmentState = "unknown"
	EnvironmentStateAvailable EnvironmentState = "available"
	EnvironmentStateStarting  EnvironmentState = "starting"
	EnvironmentStateStopped   EnvironmentState = "stopped"
)

type CatalogRequest struct {
	ProtocolVersion string `json:"protocol_version,omitempty"`
}

type CatalogResponse struct {
	ProtocolVersion string        `json:"protocol_version"`
	Environments    []Environment `json:"environments"`
}

type Environment struct {
	EnvPublicID string           `json:"env_public_id"`
	Name        string           `json:"name,omitempty"`
	State       EnvironmentState `json:"state"`
}

type OpenSessionRequest struct {
	ProtocolVersion string `json:"protocol_version,omitempty"`
	EnvPublicID     string `json:"env_public_id"`
	ClientSessionID string `json:"client_session_id,omitempty"`
}

type OpenSessionResponse struct {
	ProtocolVersion string `json:"protocol_version"`
	SessionID       string `json:"session_id"`
	EnvPublicID     string `json:"env_public_id"`
	State           string `json:"state"`
}

var ErrMissingEnvPublicID = errors.New("env_public_id is required")

func NewCatalogResponse(environments []Environment) CatalogResponse {
	if environments == nil {
		environments = []Environment{}
	}
	return CatalogResponse{
		ProtocolVersion: Version,
		Environments:    NormalizeEnvironments(environments),
	}
}

func NormalizeEnvironments(environments []Environment) []Environment {
	out := make([]Environment, 0, len(environments))
	for _, environment := range environments {
		environment.EnvPublicID = strings.TrimSpace(environment.EnvPublicID)
		environment.Name = strings.TrimSpace(environment.Name)
		switch environment.State {
		case EnvironmentStateAvailable, EnvironmentStateStarting, EnvironmentStateStopped:
		default:
			environment.State = EnvironmentStateUnknown
		}
		if environment.EnvPublicID == "" {
			continue
		}
		out = append(out, environment)
	}
	return out
}

func NormalizeOpenSessionRequest(req OpenSessionRequest) OpenSessionRequest {
	req.ProtocolVersion = strings.TrimSpace(req.ProtocolVersion)
	req.EnvPublicID = strings.TrimSpace(req.EnvPublicID)
	req.ClientSessionID = strings.TrimSpace(req.ClientSessionID)
	return req
}

func ValidateOpenSessionRequest(req OpenSessionRequest) error {
	req = NormalizeOpenSessionRequest(req)
	if req.EnvPublicID == "" {
		return ErrMissingEnvPublicID
	}
	return nil
}
