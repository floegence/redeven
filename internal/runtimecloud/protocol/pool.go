package protocol

import "encoding/json"

const ControlArtifactPoolContractVersion = "control_artifact_pool_v2"

const (
	ControlPoolTargetWaterline       = 2
	ControlPoolRefreshHorizonSeconds = 60
	ControlPoolMaxEntries            = 8
	ControlPoolMaxOutstandingUnspent = 4
	ControlPoolMaxTopUpEntries       = 4
	ControlPoolMaxArtifactJSONBytes  = 65_536
	ControlPoolMaxTopUpResponseBytes = 512 * 1024
)

const ControlPoolMaxDeliveryRequestsPerBindingGeneration = 65_536

const ControlPoolRelinkRequiredError = "control_pool_relink_required"

type ControlArtifactPoolEntry struct {
	ArtifactJSON      json.RawMessage `json:"artifact_json"`
	ArtifactChannelID string          `json:"artifact_channel_id"`
	BindingGeneration int64           `json:"binding_generation"`
	ArtifactSequence  uint64          `json:"artifact_sequence"`
	ExpiresAtUnixS    int64           `json:"expires_at_unix_s"`
}

type ControlArtifactPoolV2 struct {
	Version                       string                     `json:"version"`
	LogicalCloudBindingID         string                     `json:"logical_cloud_binding_id"`
	BindingGeneration             int64                      `json:"binding_generation"`
	TargetWaterline               int                        `json:"target_waterline"`
	RefreshHorizonSeconds         int64                      `json:"refresh_horizon_seconds"`
	ServerHighestArtifactSequence uint64                     `json:"server_highest_artifact_sequence"`
	Entries                       []ControlArtifactPoolEntry `json:"entries"`
	ResponseDigestB64u            string                     `json:"response_digest_b64u"`
}

type ControlArtifactPoolTopUpRequest struct {
	EnvPublicID              string `json:"env_public_id"`
	LocalEnvironmentPublicID string `json:"local_environment_public_id"`
	BindingGeneration        int64  `json:"binding_generation"`
	TopUpRequestIDB64u       string `json:"top_up_request_id_b64u"`
}

type ControlArtifactPoolTopUpResponse struct {
	TopUpRequestIDB64u string                `json:"top_up_request_id_b64u"`
	Pool               ControlArtifactPoolV2 `json:"pool"`
}

type ControlArtifactPoolAck struct {
	EnvPublicID             string `json:"env_public_id"`
	BindingGeneration       int64  `json:"binding_generation"`
	TopUpRequestIDB64u      string `json:"top_up_request_id_b64u"`
	ResponseDigestB64u      string `json:"response_digest_b64u"`
	HighestArtifactSequence uint64 `json:"highest_artifact_sequence"`
}
