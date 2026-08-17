package protocol

import (
	"encoding/json"
	"strings"
)

const (
	ProviderRuntimeManagementProtocolVersion = "rcpp-v3"
	ProviderRuntimeManagementMaxBodyBytes    = 384 * 1024
)

type ProviderRuntimeManagementTunnelRequest struct {
	ProtocolVersion   string                         `json:"protocol_version"`
	EnvPublicID       string                         `json:"env_public_id"`
	LifecycleTargetID string                         `json:"lifecycle_target_id"`
	TargetGeneration  int64                          `json:"target_generation"`
	ClientKeyID       string                         `json:"client_key_id"`
	ClientPublicKey   string                         `json:"client_public_key"`
	Method            string                         `json:"method"`
	Route             string                         `json:"route"`
	BodySHA256        string                         `json:"body_sha256"`
	BodyB64u          string                         `json:"body_b64u,omitempty"`
	ArtifactUpload    *ProviderRuntimeArtifactUpload `json:"artifact_upload,omitempty"`
	Nonce             string                         `json:"nonce"`
	TimestampUnixMS   int64                          `json:"timestamp_unix_ms"`
	Signature         string                         `json:"signature"`
}

type ProviderRuntimeArtifactUpload struct {
	UploadID     string `json:"upload_id"`
	Offset       int64  `json:"offset"`
	TotalSize    int64  `json:"total_size"`
	Final        bool   `json:"final"`
	MetadataB64u string `json:"metadata_b64u"`
}

type ProviderRuntimeManagementTunnelForwardRequest struct {
	ProviderRuntimeManagementTunnelRequest
	RuntimeGrants []RuntimeGrant `json:"runtime_grants"`
}

type ProviderRuntimeManagementTunnelResponse struct {
	ProtocolVersion string `json:"protocol_version"`
	StatusCode      int    `json:"status_code"`
	ContentType     string `json:"content_type,omitempty"`
	BodyB64u        string `json:"body_b64u,omitempty"`
}

type ProviderRuntimeManagementTransportPollRequest struct {
	ProtocolVersion      string `json:"protocol_version"`
	EnvPublicID          string `json:"env_public_id"`
	BindingID            string `json:"binding_id"`
	LifecycleTargetID    string `json:"lifecycle_target_id"`
	TargetGeneration     int64  `json:"target_generation"`
	SupervisorInstanceID string `json:"supervisor_instance_id"`
	Nonce                string `json:"nonce"`
	TimestampUnixMS      int64  `json:"timestamp_unix_ms"`
	Signature            string `json:"signature"`
}

type ProviderRuntimeManagementTransportPollResponse struct {
	ProtocolVersion string                                        `json:"protocol_version"`
	RequestID       string                                        `json:"request_id"`
	Request         ProviderRuntimeManagementTunnelForwardRequest `json:"request"`
}

type ProviderRuntimeManagementTransportResponseRequest struct {
	ProtocolVersion      string `json:"protocol_version"`
	EnvPublicID          string `json:"env_public_id"`
	BindingID            string `json:"binding_id"`
	LifecycleTargetID    string `json:"lifecycle_target_id"`
	TargetGeneration     int64  `json:"target_generation"`
	SupervisorInstanceID string `json:"supervisor_instance_id"`
	RequestID            string `json:"request_id"`
	ResponseSHA256       string `json:"response_sha256"`
	ResponseB64u         string `json:"response_b64u"`
	Nonce                string `json:"nonce"`
	TimestampUnixMS      int64  `json:"timestamp_unix_ms"`
	Signature            string `json:"signature"`
}

type ProviderRuntimeManagementTransportResponse struct {
	ProtocolVersion  string `json:"protocol_version"`
	AcceptedAtUnixMS int64  `json:"accepted_at_unix_ms"`
}

func CanonicalProviderRuntimeManagementTransportPollPayload(request ProviderRuntimeManagementTransportPollRequest) ([]byte, error) {
	return json.Marshal(map[string]any{
		"binding_id": request.BindingID, "env_public_id": request.EnvPublicID,
		"lifecycle_target_id": request.LifecycleTargetID, "nonce": request.Nonce,
		"protocol_version": request.ProtocolVersion, "supervisor_instance_id": request.SupervisorInstanceID,
		"target_generation": request.TargetGeneration, "timestamp_unix_ms": request.TimestampUnixMS,
	})
}

func CanonicalProviderRuntimeManagementTransportResponsePayload(request ProviderRuntimeManagementTransportResponseRequest) ([]byte, error) {
	return json.Marshal(map[string]any{
		"binding_id": request.BindingID, "env_public_id": request.EnvPublicID,
		"lifecycle_target_id": request.LifecycleTargetID, "nonce": request.Nonce,
		"protocol_version": request.ProtocolVersion, "request_id": request.RequestID,
		"response_sha256":        strings.ToLower(strings.TrimSpace(request.ResponseSHA256)),
		"supervisor_instance_id": request.SupervisorInstanceID, "target_generation": request.TargetGeneration,
		"timestamp_unix_ms": request.TimestampUnixMS,
	})
}

func CanonicalProviderRuntimeManagementTunnelPayload(request ProviderRuntimeManagementTunnelRequest) ([]byte, error) {
	payload := map[string]any{
		"body_sha256":         strings.ToLower(strings.TrimSpace(request.BodySHA256)),
		"client_key_id":       strings.TrimSpace(request.ClientKeyID),
		"env_public_id":       strings.TrimSpace(request.EnvPublicID),
		"lifecycle_target_id": strings.TrimSpace(request.LifecycleTargetID),
		"method":              strings.ToUpper(strings.TrimSpace(request.Method)),
		"nonce":               strings.TrimSpace(request.Nonce),
		"protocol_version":    strings.TrimSpace(request.ProtocolVersion),
		"route":               strings.TrimSpace(request.Route),
		"target_generation":   request.TargetGeneration,
		"timestamp_unix_ms":   request.TimestampUnixMS,
	}
	if request.ArtifactUpload != nil {
		payload["artifact_upload"] = map[string]any{
			"final":         request.ArtifactUpload.Final,
			"metadata_b64u": strings.TrimSpace(request.ArtifactUpload.MetadataB64u),
			"offset":        request.ArtifactUpload.Offset,
			"total_size":    request.ArtifactUpload.TotalSize,
			"upload_id":     strings.TrimSpace(request.ArtifactUpload.UploadID),
		}
	}
	return json.Marshal(payload)
}
