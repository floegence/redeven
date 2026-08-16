package config

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
)

const (
	ControlArtifactPoolContractVersion = "control_artifact_pool_v1"
	ControlArtifactPoolSchemaVersion   = 1
	ControlArtifactTargetWaterline     = 2
	ControlArtifactMaxPoolEntries      = 8
	ControlArtifactMaxOutstanding      = 4
	ControlArtifactMaxTopUpEntries     = 4
	ControlArtifactRefreshHorizonS     = 60
	ControlArtifactMaxJSONBytes        = 65_536
	ControlArtifactMaxResponseBytes    = 512 * 1024

	ControlArtifactTopUpPending  = "pending"
	ControlArtifactTopUpApplied  = "applied"
	ControlArtifactTopUpAcked    = "acked"
	ControlArtifactTopUpTerminal = "terminal"
	ControlArtifactTopUpExpired  = "top_up_request_expired"
	ControlArtifactTopUpRelink   = "control_pool_relink_required"

	ControlArtifactRecoveryReady     = "ready"
	ControlArtifactRecoveryDegraded  = "degraded"
	ControlArtifactRecoveryExhausted = "exhausted"
	ControlArtifactRecoveryRelink    = "relink_required"
)

// DirectConnectInfo is the control-plane artifact envelope persisted by
// Redeven. The opaque artifact bytes are interpreted only by Flowersec v2.
type DirectConnectInfo struct {
	ArtifactJSON   json.RawMessage `json:"artifact_json"`
	ExpiresAtUnixS int64           `json:"expires_at_unix_s"`
	Spent          bool            `json:"spent"`
}

// ControlArtifactEntry is one independently issued, one-shot control lease.
// ArtifactJSON remains opaque to Redeven and is never emitted in diagnostics.
type ControlArtifactEntry struct {
	Sequence       uint64          `json:"artifact_sequence"`
	ArtifactJSON   json.RawMessage `json:"artifact_json"`
	ArtifactDigest string          `json:"artifact_digest_b64u"`
	ChannelID      string          `json:"artifact_channel_id"`
	ExpiresAtUnixS int64           `json:"expires_at_unix_s"`
	Spent          bool            `json:"spent"`
	Revoked        bool            `json:"revoked,omitempty"`
}

type ControlArtifactPendingTopUp struct {
	RequestIDB64u      string `json:"top_up_request_id_b64u"`
	BindingGeneration  int64  `json:"binding_generation"`
	State              string `json:"state"`
	ResponseDigestB64u string `json:"response_digest_b64u,omitempty"`
	HighestSequence    uint64 `json:"highest_artifact_sequence,omitempty"`
}

// ControlArtifactTerminalTopUp is the durable tombstone for a Portal outbox
// request that can no longer be replayed. PendingTopUp is cleared atomically
// with this record so the next maintenance tick can allocate a fresh request.
type ControlArtifactTerminalTopUp struct {
	RequestIDB64u     string `json:"top_up_request_id_b64u"`
	BindingGeneration int64  `json:"binding_generation"`
	Reason            string `json:"reason"`
	RecordedAtUnixS   int64  `json:"recorded_at_unix_s"`
}

type ControlArtifactPool struct {
	SchemaVersion         int                           `json:"schema_version"`
	LogicalBindingID      string                        `json:"logical_provider_binding_id"`
	TargetWaterline       int                           `json:"target_waterline"`
	RefreshHorizonSeconds int64                         `json:"refresh_horizon_seconds"`
	BindingGeneration     int64                         `json:"binding_generation"`
	RecoveryState         string                        `json:"recovery_state"`
	PendingTopUp          *ControlArtifactPendingTopUp  `json:"pending_top_up,omitempty"`
	LastTerminalTopUp     *ControlArtifactTerminalTopUp `json:"last_terminal_top_up,omitempty"`
	Entries               []ControlArtifactEntry        `json:"entries"`
}

func NewControlArtifactPool(generation int64) *ControlArtifactPool {
	return &ControlArtifactPool{
		SchemaVersion:         ControlArtifactPoolSchemaVersion,
		TargetWaterline:       ControlArtifactTargetWaterline,
		RefreshHorizonSeconds: ControlArtifactRefreshHorizonS,
		BindingGeneration:     generation,
		RecoveryState:         ControlArtifactRecoveryDegraded,
		Entries:               []ControlArtifactEntry{},
	}
}

func (pool *ControlArtifactPool) Validate(nowUnixS int64) error {
	if pool == nil {
		return errors.New("missing control_artifact_pool")
	}
	if pool.SchemaVersion != ControlArtifactPoolSchemaVersion {
		return fmt.Errorf("unsupported control_artifact_pool schema_version %d", pool.SchemaVersion)
	}
	if strings.TrimSpace(pool.LogicalBindingID) == "" || strings.TrimSpace(pool.LogicalBindingID) == "legacy-untrusted" || strings.TrimSpace(pool.LogicalBindingID) == "legacy-test-migration" {
		return errors.New("missing control_artifact_pool logical_provider_binding_id")
	}
	if pool.TargetWaterline != ControlArtifactTargetWaterline {
		return errors.New("invalid control_artifact_pool target_waterline")
	}
	if pool.RefreshHorizonSeconds != ControlArtifactRefreshHorizonS {
		return errors.New("invalid control_artifact_pool refresh_horizon_seconds")
	}
	if pool.BindingGeneration <= 0 {
		return errors.New("invalid control_artifact_pool binding_generation")
	}
	if len(pool.Entries) > ControlArtifactMaxPoolEntries {
		return errors.New("control_artifact_pool exceeds entry limit")
	}
	if !validControlArtifactRecoveryState(pool.RecoveryState) {
		return errors.New("invalid control_artifact_pool recovery_state")
	}
	if err := validatePendingControlArtifactTopUp(pool.PendingTopUp, pool.BindingGeneration); err != nil {
		return err
	}
	if err := validateTerminalControlArtifactTopUp(pool.LastTerminalTopUp, pool.BindingGeneration); err != nil {
		return err
	}
	var previous uint64
	outstanding := 0
	digests := make(map[string]struct{}, len(pool.Entries))
	channels := make(map[string]struct{}, len(pool.Entries))
	for index := range pool.Entries {
		entry := &pool.Entries[index]
		if entry.Sequence == 0 || entry.Sequence > math.MaxInt64 || (previous != 0 && entry.Sequence <= previous) {
			return errors.New("control_artifact_pool sequences must increase")
		}
		previous = entry.Sequence
		if len(entry.ArtifactJSON) > ControlArtifactMaxJSONBytes {
			return errors.New("control artifact exceeds Flowersec JSON limit")
		}
		if entry.ExpiresAtUnixS <= 0 {
			return errors.New("invalid control_artifact_pool entry")
		}
		digestBytes, digestErr := base64.RawURLEncoding.DecodeString(strings.TrimSpace(entry.ArtifactDigest))
		if digestErr != nil || len(digestBytes) != sha256.Size {
			return errors.New("invalid control_artifact_pool artifact digest")
		}
		if base64.RawURLEncoding.EncodeToString(digestBytes) != entry.ArtifactDigest {
			return errors.New("non-canonical control_artifact_pool artifact digest")
		}
		if _, exists := digests[entry.ArtifactDigest]; exists {
			return errors.New("control_artifact_pool repeats an artifact digest")
		}
		digests[entry.ArtifactDigest] = struct{}{}
		channelID := strings.TrimSpace(entry.ChannelID)
		if channelID != "" {
			if _, exists := channels[channelID]; exists {
				return errors.New("control_artifact_pool repeats an artifact channel")
			}
			channels[channelID] = struct{}{}
		}
		if entry.Spent || entry.Revoked {
			if len(entry.ArtifactJSON) != 0 {
				return errors.New("terminal control artifact retains opaque bytes")
			}
			continue
		}
		if entry.ExpiresAtUnixS <= nowUnixS {
			continue
		}
		outstanding++
		if strings.TrimSpace(entry.ChannelID) == "" || len(entry.ArtifactJSON) == 0 {
			return errors.New("invalid control_artifact_pool entry")
		}
		digest := sha256.Sum256(entry.ArtifactJSON)
		if entry.ArtifactDigest != base64.RawURLEncoding.EncodeToString(digest[:]) {
			return errors.New("control artifact digest mismatch")
		}
		if _, err := flowersec.ParseArtifact(entry.ArtifactJSON); err != nil {
			return fmt.Errorf("invalid control artifact: %w", err)
		}
	}
	if outstanding > ControlArtifactMaxOutstanding {
		return errors.New("control_artifact_pool exceeds outstanding entry limit")
	}
	return nil
}

func validateTerminalControlArtifactTopUp(terminal *ControlArtifactTerminalTopUp, generation int64) error {
	if terminal == nil {
		return nil
	}
	requestID, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(terminal.RequestIDB64u))
	if err != nil || len(requestID) != sha256.Size || base64.RawURLEncoding.EncodeToString(requestID) != terminal.RequestIDB64u ||
		terminal.BindingGeneration != generation || terminal.Reason != ControlArtifactTopUpExpired || terminal.RecordedAtUnixS <= 0 {
		return errors.New("invalid control_artifact_pool terminal top-up tombstone")
	}
	return nil
}

func validControlArtifactRecoveryState(state string) bool {
	switch strings.TrimSpace(state) {
	case ControlArtifactRecoveryReady, ControlArtifactRecoveryDegraded, ControlArtifactRecoveryExhausted, ControlArtifactRecoveryRelink:
		return true
	default:
		return false
	}
}

func validatePendingControlArtifactTopUp(pending *ControlArtifactPendingTopUp, generation int64) error {
	if pending == nil {
		return nil
	}
	requestID, err := base64.RawURLEncoding.DecodeString(pending.RequestIDB64u)
	if err != nil || len(requestID) != 32 || base64.RawURLEncoding.EncodeToString(requestID) != pending.RequestIDB64u || pending.BindingGeneration != generation {
		return errors.New("invalid control_artifact_pool pending_top_up binding")
	}
	switch pending.State {
	case ControlArtifactTopUpPending:
		if pending.ResponseDigestB64u != "" || pending.HighestSequence != 0 {
			return errors.New("pending control top-up contains applied response state")
		}
	case ControlArtifactTopUpApplied, ControlArtifactTopUpAcked:
		digest, decodeErr := base64.RawURLEncoding.DecodeString(pending.ResponseDigestB64u)
		if decodeErr != nil || len(digest) != sha256.Size || base64.RawURLEncoding.EncodeToString(digest) != pending.ResponseDigestB64u {
			return errors.New("invalid applied control top-up digest")
		}
		if pending.HighestSequence == 0 || pending.HighestSequence > math.MaxInt64 {
			return errors.New("invalid applied control top-up server waterline")
		}
	case ControlArtifactTopUpTerminal:
	default:
		return errors.New("invalid control_artifact_pool pending_top_up state")
	}
	return nil
}

// Config is the runtime configuration for Redeven. Runtime-managed one-shot
// artifacts remain opaque but are intentionally persisted here for recovery;
// user-provided provider keys are loaded separately from secrets.json.
type Config struct {
	ProviderOrigin           string               `json:"provider_origin"`
	ControlplaneBaseURL      string               `json:"controlplane_base_url"`
	ControlplaneProviderID   string               `json:"controlplane_provider_id,omitempty"`
	EnvironmentID            string               `json:"environment_id"`
	LocalEnvironmentPublicID string               `json:"local_environment_public_id"`
	BindingGeneration        int64                `json:"binding_generation,omitempty"`
	AgentInstanceID          string               `json:"agent_instance_id"`
	Direct                   *DirectConnectInfo   `json:"direct"`
	ControlArtifactPool      *ControlArtifactPool `json:"control_artifact_pool,omitempty"`

	// AI config controls optional Flower AI assistant features.
	AI *AIConfig `json:"ai,omitempty"`

	// PermissionPolicy is the local permission cap applied on the endpoint.
	// It is designed to limit the effective permissions even if the control-plane grants more.
	PermissionPolicy *PermissionPolicy `json:"permission_policy,omitempty"`

	// AgentHomeDir is the default home/working directory and the target of "~".
	// If empty, the runtime picks a safe default (the current user home dir).
	// Filesystem access boundaries are defined by FilesystemScope.
	AgentHomeDir string `json:"agent_home_dir,omitempty"`

	// FilesystemScope defines the endpoint-local filesystem roots exposed to
	// runtime capabilities. When omitted, the runtime derives a Home root from
	// AgentHomeDir and a read-only Computer root at the OS filesystem root.
	FilesystemScope *FilesystemScope `json:"filesystem_scope,omitempty"`

	// Shell is the shell command used for terminal sessions.
	// If empty, the runtime picks a default (SHELL or /bin/bash).
	Shell string `json:"shell,omitempty"`

	// LogFormat is "json" or "text".
	LogFormat string `json:"log_format,omitempty"`
	// LogLevel is "debug|info|warn|error".
	LogLevel string `json:"log_level,omitempty"`

	// CodeServerPortMin/Max configures the dynamic port range used for code-server processes.
	// If unset/invalid, the runtime uses a safe default range.
	CodeServerPortMin int `json:"code_server_port_min,omitempty"`
	CodeServerPortMax int `json:"code_server_port_max,omitempty"`

	extra                          map[string]json.RawMessage
	bootstrapDeliveryAttemptPath   string
	bootstrapDeliveryRequestIDB64u string
}

// ValidateLocalMinimal validates config fields required to start the runtime in local-only mode.
//
// Local-only mode is enabled by `redeven run --mode local` and must work even when the
// controlplane credentials are missing (no bootstrap yet).
func (c *Config) ValidateLocalMinimal() error {
	if c == nil {
		return errors.New("nil config")
	}
	if c.PermissionPolicy != nil {
		if err := c.PermissionPolicy.Validate(); err != nil {
			return fmt.Errorf("invalid permission_policy: %w", err)
		}
	}
	if c.FilesystemScope != nil {
		if err := c.FilesystemScope.Validate(); err != nil {
			return fmt.Errorf("invalid filesystem_scope: %w", err)
		}
	}
	if c.AI != nil {
		if err := c.AI.Validate(); err != nil {
			return fmt.Errorf("invalid ai: %w", err)
		}
	}
	return nil
}

// ValidateRemoteStrict validates the fields required to connect to the remote control channel.
//
// This is the standard mode requirements: the runtime must be fully bootstrapped.
func (c *Config) ValidateRemoteStrict() error {
	if c == nil {
		return errors.New("nil config")
	}
	if err := c.ValidateLocalMinimal(); err != nil {
		return err
	}
	if strings.TrimSpace(c.ControlplaneBaseURL) == "" {
		return errors.New("missing controlplane_base_url")
	}
	if strings.TrimSpace(c.ProviderOrigin) == "" {
		return errors.New("missing provider_origin")
	}
	if _, err := normalizeControlplaneBaseURL(c.ProviderOrigin); err != nil {
		return fmt.Errorf("invalid provider_origin: %w", err)
	}
	if _, err := normalizeControlplaneBaseURL(c.ControlplaneBaseURL); err != nil {
		return fmt.Errorf("invalid controlplane_base_url: %w", err)
	}
	if strings.TrimSpace(c.EnvironmentID) == "" {
		return errors.New("missing environment_id")
	}
	if strings.TrimSpace(c.LocalEnvironmentPublicID) == "" {
		return errors.New("missing local_environment_public_id")
	}
	if c.BindingGeneration <= 0 {
		return errors.New("missing binding_generation")
	}
	if strings.TrimSpace(c.AgentInstanceID) == "" {
		return errors.New("missing agent_instance_id")
	}
	if c.ControlArtifactPool != nil {
		if err := c.ControlArtifactPool.Validate(time.Now().Unix()); err != nil {
			return err
		}
	} else {
		if c.Direct == nil || len(c.Direct.ArtifactJSON) == 0 || c.Direct.ExpiresAtUnixS <= 0 {
			return errors.New("missing direct connect info")
		}
		if _, err := flowersec.ParseArtifact(c.Direct.ArtifactJSON); err != nil {
			return fmt.Errorf("invalid direct connect artifact: %w", err)
		}
	}
	return nil
}

func Load(path string) (*Config, error) {
	return loadConfig(path, defaultConfigPersistence())
}

func Save(path string, cfg *Config) error {
	return saveConfig(path, cfg, defaultConfigPersistence())
}
