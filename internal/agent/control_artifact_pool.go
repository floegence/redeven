package agent

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/rpcutil"
)

const (
	controlRPCTypeControlPoolTopUp uint32 = 41006
	controlRPCTypeControlPoolAck   uint32 = 41007
)

type controlArtifactPoolWireEntry struct {
	ArtifactJSON      json.RawMessage `json:"artifact_json"`
	ArtifactChannelID string          `json:"artifact_channel_id"`
	BindingGeneration int64           `json:"binding_generation"`
	ArtifactSequence  uint64          `json:"artifact_sequence"`
	ExpiresAtUnixS    int64           `json:"expires_at_unix_s"`
}

type controlArtifactPoolWire struct {
	Version                       string                         `json:"version"`
	LogicalProviderBindingID      string                         `json:"logical_provider_binding_id"`
	BindingGeneration             int64                          `json:"binding_generation"`
	TargetWaterline               int                            `json:"target_waterline"`
	RefreshHorizonSeconds         int64                          `json:"refresh_horizon_seconds"`
	ServerHighestArtifactSequence uint64                         `json:"server_highest_artifact_sequence"`
	Entries                       []controlArtifactPoolWireEntry `json:"entries"`
	ResponseDigestB64u            string                         `json:"response_digest_b64u"`
}

type controlArtifactPoolTopUpRequest struct {
	EnvPublicID              string `json:"env_public_id"`
	LocalEnvironmentPublicID string `json:"local_environment_public_id"`
	BindingGeneration        int64  `json:"binding_generation"`
	TopUpRequestIDB64u       string `json:"top_up_request_id_b64u"`
}

type controlArtifactPoolTopUpResponse struct {
	TopUpRequestIDB64u string                  `json:"top_up_request_id_b64u"`
	Pool               controlArtifactPoolWire `json:"pool"`
}

type controlArtifactPoolAck struct {
	EnvPublicID             string `json:"env_public_id"`
	BindingGeneration       int64  `json:"binding_generation"`
	TopUpRequestIDB64u      string `json:"top_up_request_id_b64u"`
	ResponseDigestB64u      string `json:"response_digest_b64u"`
	HighestArtifactSequence uint64 `json:"highest_artifact_sequence"`
}

type controlArtifactPoolAckResponse struct {
	OK bool `json:"ok"`
}

func (a *Agent) maintainControlArtifactPool(ctx context.Context, caller rpcutil.Caller) error {
	if a == nil || caller == nil {
		return errors.New("control artifact pool maintenance unavailable")
	}
	pending, cfg, err := a.prepareControlArtifactTopUp()
	if err != nil || pending == nil {
		return err
	}
	switch pending.State {
	case config.ControlArtifactTopUpPending:
		request := controlArtifactPoolTopUpRequest{
			EnvPublicID:              cfg.EnvironmentID,
			LocalEnvironmentPublicID: cfg.LocalEnvironmentPublicID,
			BindingGeneration:        pending.BindingGeneration,
			TopUpRequestIDB64u:       pending.RequestIDB64u,
		}
		raw, callErr := callControlRawJSON(ctx, a, caller, controlRPCTypeControlPoolTopUp, &request)
		if callErr != nil {
			if isRelinkRequiredControlArtifactTopUpRPCError(callErr) {
				if err := a.markControlArtifactTopUpTerminal(pending); err != nil {
					return fmt.Errorf("persist terminal control artifact pool top-up: %w", err)
				}
			}
			if isExpiredControlArtifactTopUpRPCError(callErr) {
				if err := a.recordExpiredControlArtifactTopUp(pending, config.ControlArtifactTopUpPending); err != nil {
					return fmt.Errorf("persist expired control artifact pool top-up: %w", err)
				}
			}
			return fmt.Errorf("top up control artifact pool: %w", callErr)
		}
		response, validationErr := validateControlArtifactPoolTopUpResponse(raw, cfg.ControlArtifactPool, pending, time.Now())
		if validationErr != nil {
			_ = a.markControlArtifactTopUpTerminal(pending)
			return validationErr
		}
		if err := a.applyControlArtifactTopUp(pending, response); err != nil {
			return err
		}
		pending, cfg, err = a.controlArtifactPendingSnapshot()
		if err != nil {
			return err
		}
	case config.ControlArtifactTopUpApplied:
	case config.ControlArtifactTopUpAcked:
		return a.clearAcknowledgedControlArtifactTopUp(pending)
	case config.ControlArtifactTopUpTerminal:
		return errors.New("control artifact pool requires relink after terminal top-up failure")
	default:
		return errors.New("invalid control artifact top-up state")
	}

	if pending == nil || pending.State != config.ControlArtifactTopUpApplied {
		return nil
	}
	ack := controlArtifactPoolAck{
		EnvPublicID:             cfg.EnvironmentID,
		BindingGeneration:       pending.BindingGeneration,
		TopUpRequestIDB64u:      pending.RequestIDB64u,
		ResponseDigestB64u:      pending.ResponseDigestB64u,
		HighestArtifactSequence: pending.HighestSequence,
	}
	raw, err := callControlRawJSON(ctx, a, caller, controlRPCTypeControlPoolAck, &ack)
	if err != nil {
		if isExpiredControlArtifactTopUpRPCError(err) {
			if persistErr := a.recordExpiredControlArtifactTopUp(pending, config.ControlArtifactTopUpApplied); persistErr != nil {
				return fmt.Errorf("persist expired control artifact pool acknowledgement: %w", persistErr)
			}
		}
		return fmt.Errorf("acknowledge control artifact pool top-up: %w", err)
	}
	var response controlArtifactPoolAckResponse
	if err := decodeExactControlJSON(raw, &response); err != nil || !response.OK {
		return errors.New("control artifact pool acknowledgement was not confirmed")
	}
	if err := a.markControlArtifactTopUpAcknowledged(pending); err != nil {
		return err
	}
	return a.clearAcknowledgedControlArtifactTopUp(pending)
}

func (a *Agent) prepareControlArtifactTopUp() (*config.ControlArtifactPendingTopUp, *config.Config, error) {
	now := time.Now().Unix()
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg == nil || a.cfg.ControlArtifactPool == nil {
		return nil, nil, errors.New("control artifact pool is unavailable; relink is required")
	}
	next := *a.cfg
	pool := cloneControlArtifactPool(a.cfg.ControlArtifactPool)
	changed, err := a.reconcileControlArtifactPoolSpendLedger(pool)
	if err != nil {
		return nil, nil, fmt.Errorf("reconcile control artifact spend ledger: %w", err)
	}
	changed = normalizeControlArtifactPool(pool, now) || changed
	if pool.BindingGeneration != a.cfg.BindingGeneration {
		return nil, nil, errors.New("control artifact pool binding generation mismatch")
	}
	if strings.TrimSpace(pool.LogicalBindingID) == "" || strings.TrimSpace(pool.LogicalBindingID) == "legacy-untrusted" {
		return nil, nil, errors.New("control artifact pool has no Portal durable binding; relink is required")
	}
	if pool.PendingTopUp != nil {
		if pool.PendingTopUp.State == config.ControlArtifactTopUpAcked {
			pool.PendingTopUp = nil
			changed = true
		} else {
			next.ControlArtifactPool = pool
			if changed {
				if err := config.Save(a.configPath, &next); err != nil {
					return nil, nil, err
				}
				a.cfg = &next
			}
			return clonePendingControlArtifactTopUp(pool.PendingTopUp), cloneRemoteConfig(&next), nil
		}
	}
	usable := usableControlArtifactCount(pool, now)
	if usable >= pool.TargetWaterline {
		if pool.RecoveryState != config.ControlArtifactRecoveryReady {
			pool.RecoveryState = config.ControlArtifactRecoveryReady
			changed = true
		}
		next.ControlArtifactPool = pool
		if changed {
			if err := config.Save(a.configPath, &next); err != nil {
				return nil, nil, err
			}
			a.cfg = &next
		}
		return nil, cloneRemoteConfig(&next), nil
	}
	requestID := make([]byte, 32)
	if _, err := rand.Read(requestID); err != nil {
		return nil, nil, fmt.Errorf("create control artifact top-up request id: %w", err)
	}
	pool.PendingTopUp = &config.ControlArtifactPendingTopUp{
		RequestIDB64u:     base64.RawURLEncoding.EncodeToString(requestID),
		BindingGeneration: pool.BindingGeneration,
		State:             config.ControlArtifactTopUpPending,
	}
	pool.RecoveryState = config.ControlArtifactRecoveryDegraded
	next.ControlArtifactPool = pool
	if err := config.Save(a.configPath, &next); err != nil {
		return nil, nil, err
	}
	a.cfg = &next
	return clonePendingControlArtifactTopUp(pool.PendingTopUp), cloneRemoteConfig(&next), nil
}

func validateControlArtifactPoolTopUpResponse(raw json.RawMessage, current *config.ControlArtifactPool, pending *config.ControlArtifactPendingTopUp, now time.Time) (controlArtifactPoolTopUpResponse, error) {
	var response controlArtifactPoolTopUpResponse
	if len(raw) == 0 || len(raw) > config.ControlArtifactMaxResponseBytes {
		return response, errors.New("control artifact pool response exceeds exact byte bound")
	}
	if err := decodeExactControlJSON(raw, &response); err != nil {
		return response, fmt.Errorf("decode control artifact pool response: %w", err)
	}
	if pending == nil || response.TopUpRequestIDB64u != pending.RequestIDB64u {
		return response, errors.New("control artifact pool response request mismatch")
	}
	pool := response.Pool
	if current == nil || pool.Version != config.ControlArtifactPoolContractVersion ||
		pool.BindingGeneration != current.BindingGeneration || pool.BindingGeneration != pending.BindingGeneration ||
		pool.TargetWaterline != current.TargetWaterline || pool.RefreshHorizonSeconds != current.RefreshHorizonSeconds ||
		strings.TrimSpace(pool.LogicalProviderBindingID) == "" ||
		(strings.TrimSpace(current.LogicalBindingID) != "" && pool.LogicalProviderBindingID != current.LogicalBindingID) {
		return response, errors.New("control artifact pool response binding mismatch")
	}
	if pool.ServerHighestArtifactSequence == 0 || pool.ServerHighestArtifactSequence > math.MaxInt64 {
		return response, errors.New("invalid control artifact pool server waterline")
	}
	if len(pool.Entries) > config.ControlArtifactMaxTopUpEntries {
		return response, errors.New("control artifact pool response exceeds entry bound")
	}
	digest := pool.ResponseDigestB64u
	digestBytes, err := base64.RawURLEncoding.DecodeString(digest)
	if err != nil || len(digestBytes) != sha256.Size || base64.RawURLEncoding.EncodeToString(digestBytes) != digest {
		return response, errors.New("invalid control artifact pool response digest")
	}
	unsigned := response
	unsigned.Pool.ResponseDigestB64u = ""
	encoded, err := json.Marshal(unsigned)
	if err != nil {
		return response, err
	}
	computed := sha256.Sum256(encoded)
	if !bytes.Equal(computed[:], digestBytes) {
		return response, errors.New("control artifact pool response digest mismatch")
	}

	highest := highestControlArtifactSequence(current.Entries)
	outstanding := outstandingControlArtifactCount(current, now.Unix())
	previous := uint64(0)
	digests := make(map[string]struct{}, len(current.Entries)+len(pool.Entries))
	channels := make(map[string]struct{}, len(current.Entries)+len(pool.Entries))
	for _, entry := range current.Entries {
		if entry.ArtifactDigest != "" {
			digests[entry.ArtifactDigest] = struct{}{}
		}
		if strings.TrimSpace(entry.ChannelID) != "" {
			channels[entry.ChannelID] = struct{}{}
		}
	}
	for index := range pool.Entries {
		entry := &pool.Entries[index]
		sequenceInvalid := entry.ArtifactSequence <= highest
		if index > 0 {
			sequenceInvalid = entry.ArtifactSequence != previous+1
		}
		if entry.BindingGeneration != current.BindingGeneration || sequenceInvalid ||
			strings.TrimSpace(entry.ArtifactChannelID) == "" || len(entry.ArtifactJSON) == 0 ||
			len(entry.ArtifactJSON) > config.ControlArtifactMaxJSONBytes ||
			entry.ExpiresAtUnixS <= now.Unix()+current.RefreshHorizonSeconds ||
			entry.ExpiresAtUnixS > now.Add(5*time.Minute).Unix() {
			return response, errors.New("invalid control artifact pool response entry")
		}
		if _, err := flowersec.ParseArtifact(entry.ArtifactJSON); err != nil {
			return response, fmt.Errorf("parse control artifact pool response entry: %w", err)
		}
		entryDigest := sha256.Sum256(entry.ArtifactJSON)
		encodedDigest := base64.RawURLEncoding.EncodeToString(entryDigest[:])
		if _, exists := digests[encodedDigest]; exists {
			return response, errors.New("control artifact pool response repeats an artifact digest")
		}
		if _, exists := channels[entry.ArtifactChannelID]; exists {
			return response, errors.New("control artifact pool response repeats an artifact channel")
		}
		digests[encodedDigest] = struct{}{}
		channels[entry.ArtifactChannelID] = struct{}{}
		previous = entry.ArtifactSequence
		outstanding++
	}
	if pool.ServerHighestArtifactSequence < highest ||
		(len(pool.Entries) > 0 && previous != pool.ServerHighestArtifactSequence) {
		return response, errors.New("control artifact pool server waterline mismatch")
	}
	if outstanding > config.ControlArtifactMaxOutstanding {
		return response, errors.New("control artifact pool response exceeds outstanding bound")
	}
	return response, nil
}

func (a *Agent) applyControlArtifactTopUp(pending *config.ControlArtifactPendingTopUp, response controlArtifactPoolTopUpResponse) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg == nil || a.cfg.ControlArtifactPool == nil || pending == nil {
		return errors.New("control artifact pool changed before response commit")
	}
	if response.TopUpRequestIDB64u != pending.RequestIDB64u {
		return errors.New("control artifact top-up response request changed before commit")
	}
	pool := cloneControlArtifactPool(a.cfg.ControlArtifactPool)
	if !samePendingControlArtifactTopUp(pool.PendingTopUp, pending, config.ControlArtifactTopUpPending) {
		return errors.New("control artifact top-up changed before response commit")
	}
	pool.LogicalBindingID = strings.TrimSpace(response.Pool.LogicalProviderBindingID)
	for _, delivered := range response.Pool.Entries {
		normalizedArtifact, err := config.NormalizeControlArtifactJSON(delivered.ArtifactJSON)
		if err != nil {
			return errors.New("invalid control artifact pool response artifact JSON")
		}
		digest := sha256.Sum256(normalizedArtifact)
		pool.Entries = append(pool.Entries, config.ControlArtifactEntry{
			Sequence:       delivered.ArtifactSequence,
			ArtifactJSON:   normalizedArtifact,
			ArtifactDigest: base64.RawURLEncoding.EncodeToString(digest[:]),
			ChannelID:      strings.TrimSpace(delivered.ArtifactChannelID),
			ExpiresAtUnixS: delivered.ExpiresAtUnixS,
		})
	}
	pool.Entries = compactControlArtifactEntries(pool.Entries)
	pool.PendingTopUp.State = config.ControlArtifactTopUpApplied
	pool.PendingTopUp.ResponseDigestB64u = response.Pool.ResponseDigestB64u
	pool.PendingTopUp.HighestSequence = response.Pool.ServerHighestArtifactSequence
	if usableControlArtifactCount(pool, time.Now().Unix()) >= pool.TargetWaterline {
		pool.RecoveryState = config.ControlArtifactRecoveryReady
	} else {
		pool.RecoveryState = config.ControlArtifactRecoveryDegraded
	}
	if err := pool.Validate(time.Now().Unix()); err != nil {
		return fmt.Errorf("validate applied control artifact pool: %w", err)
	}
	next := *a.cfg
	next.ControlArtifactPool = pool
	next.Direct = nil
	if err := config.Save(a.configPath, &next); err != nil {
		return fmt.Errorf("persist applied control artifact pool: %w", err)
	}
	a.cfg = &next
	return nil
}

func (a *Agent) controlArtifactPendingSnapshot() (*config.ControlArtifactPendingTopUp, *config.Config, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg == nil || a.cfg.ControlArtifactPool == nil || a.cfg.ControlArtifactPool.PendingTopUp == nil {
		return nil, nil, errors.New("control artifact top-up disappeared")
	}
	return clonePendingControlArtifactTopUp(a.cfg.ControlArtifactPool.PendingTopUp), cloneRemoteConfig(a.cfg), nil
}

func (a *Agent) markControlArtifactTopUpAcknowledged(expected *config.ControlArtifactPendingTopUp) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg == nil || a.cfg.ControlArtifactPool == nil || !samePendingControlArtifactTopUp(a.cfg.ControlArtifactPool.PendingTopUp, expected, config.ControlArtifactTopUpApplied) {
		return errors.New("control artifact top-up changed before acknowledgement commit")
	}
	next := *a.cfg
	pool := cloneControlArtifactPool(a.cfg.ControlArtifactPool)
	pool.PendingTopUp.State = config.ControlArtifactTopUpAcked
	next.ControlArtifactPool = pool
	if err := config.Save(a.configPath, &next); err != nil {
		return fmt.Errorf("persist control artifact pool acknowledgement: %w", err)
	}
	a.cfg = &next
	return nil
}

func (a *Agent) clearAcknowledgedControlArtifactTopUp(expected *config.ControlArtifactPendingTopUp) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg == nil || a.cfg.ControlArtifactPool == nil {
		return errors.New("control artifact pool unavailable")
	}
	pending := a.cfg.ControlArtifactPool.PendingTopUp
	if pending == nil {
		return nil
	}
	if pending.State != config.ControlArtifactTopUpAcked || expected == nil || pending.RequestIDB64u != expected.RequestIDB64u || pending.BindingGeneration != expected.BindingGeneration {
		return errors.New("control artifact top-up is not acknowledged")
	}
	next := *a.cfg
	pool := cloneControlArtifactPool(a.cfg.ControlArtifactPool)
	pool.PendingTopUp = nil
	next.ControlArtifactPool = pool
	if err := config.Save(a.configPath, &next); err != nil {
		return fmt.Errorf("clear acknowledged control artifact top-up: %w", err)
	}
	a.cfg = &next
	return nil
}

func (a *Agent) markControlArtifactTopUpTerminal(expected *config.ControlArtifactPendingTopUp) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg == nil || a.cfg.ControlArtifactPool == nil || expected == nil || !samePendingControlArtifactTopUp(a.cfg.ControlArtifactPool.PendingTopUp, expected, config.ControlArtifactTopUpPending) {
		return errors.New("control artifact top-up changed before terminal commit")
	}
	next := *a.cfg
	pool := cloneControlArtifactPool(a.cfg.ControlArtifactPool)
	pool.PendingTopUp.State = config.ControlArtifactTopUpTerminal
	pool.RecoveryState = config.ControlArtifactRecoveryRelink
	next.ControlArtifactPool = pool
	if err := config.Save(a.configPath, &next); err != nil {
		return err
	}
	a.cfg = &next
	return nil
}

func isExpiredControlArtifactTopUpRPCError(err error) bool {
	var rpcErr *flowersec.RPCError
	return errors.As(err, &rpcErr) && rpcErr.Code == 409 && rpcErr.Message == config.ControlArtifactTopUpExpired
}

func isRelinkRequiredControlArtifactTopUpRPCError(err error) bool {
	var rpcErr *flowersec.RPCError
	return errors.As(err, &rpcErr) && rpcErr.Code == 409 && rpcErr.Message == config.ControlArtifactTopUpRelink
}

func (a *Agent) recordExpiredControlArtifactTopUp(expected *config.ControlArtifactPendingTopUp, expectedState string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg == nil || a.cfg.ControlArtifactPool == nil || expected == nil ||
		!samePendingControlArtifactTopUp(a.cfg.ControlArtifactPool.PendingTopUp, expected, expectedState) {
		return errors.New("control artifact top-up changed before expiry commit")
	}
	now := time.Now().Unix()
	next := *a.cfg
	pool := cloneControlArtifactPool(a.cfg.ControlArtifactPool)
	pool.LastTerminalTopUp = &config.ControlArtifactTerminalTopUp{
		RequestIDB64u:     expected.RequestIDB64u,
		BindingGeneration: expected.BindingGeneration,
		Reason:            config.ControlArtifactTopUpExpired,
		RecordedAtUnixS:   now,
	}
	pool.PendingTopUp = nil
	normalizeControlArtifactPool(pool, now)
	if usableControlArtifactCount(pool, now) >= pool.TargetWaterline {
		pool.RecoveryState = config.ControlArtifactRecoveryReady
	} else {
		pool.RecoveryState = config.ControlArtifactRecoveryDegraded
	}
	next.ControlArtifactPool = pool
	if err := config.Save(a.configPath, &next); err != nil {
		return err
	}
	a.cfg = &next
	return nil
}

func callControlRawJSON(ctx context.Context, a *Agent, caller rpcutil.Caller, typeID uint32, request any) (json.RawMessage, error) {
	if caller == nil {
		return nil, errors.New("missing control rpc client")
	}
	if a != nil {
		a.controlRPCCallMu.Lock()
		defer a.controlRPCCallMu.Unlock()
	}
	var response json.RawMessage
	if err := caller.Call(ctx, typeID, request, &response); err != nil {
		return nil, err
	}
	return append(json.RawMessage(nil), response...), nil
}

func decodeExactControlJSON(raw []byte, destination any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("multiple JSON values")
	}
	return nil
}

func cloneControlArtifactPool(pool *config.ControlArtifactPool) *config.ControlArtifactPool {
	if pool == nil {
		return nil
	}
	clone := *pool
	clone.PendingTopUp = clonePendingControlArtifactTopUp(pool.PendingTopUp)
	if pool.LastTerminalTopUp != nil {
		terminal := *pool.LastTerminalTopUp
		clone.LastTerminalTopUp = &terminal
	}
	clone.Entries = make([]config.ControlArtifactEntry, len(pool.Entries))
	copy(clone.Entries, pool.Entries)
	for index := range clone.Entries {
		clone.Entries[index].ArtifactJSON = append(json.RawMessage(nil), clone.Entries[index].ArtifactJSON...)
	}
	return &clone
}

func clonePendingControlArtifactTopUp(pending *config.ControlArtifactPendingTopUp) *config.ControlArtifactPendingTopUp {
	if pending == nil {
		return nil
	}
	clone := *pending
	return &clone
}

func cloneRemoteConfig(source *config.Config) *config.Config {
	if source == nil {
		return nil
	}
	clone := *source
	clone.ControlArtifactPool = cloneControlArtifactPool(source.ControlArtifactPool)
	if source.Direct != nil {
		direct := *source.Direct
		direct.ArtifactJSON = append(json.RawMessage(nil), source.Direct.ArtifactJSON...)
		clone.Direct = &direct
	}
	return &clone
}

func samePendingControlArtifactTopUp(actual, expected *config.ControlArtifactPendingTopUp, state string) bool {
	return actual != nil && expected != nil && actual.RequestIDB64u == expected.RequestIDB64u &&
		actual.BindingGeneration == expected.BindingGeneration && actual.State == state
}

func normalizeControlArtifactPool(pool *config.ControlArtifactPool, nowUnixS int64) bool {
	if pool == nil {
		return false
	}
	changed := false
	for index := range pool.Entries {
		entry := &pool.Entries[index]
		if (entry.Spent || entry.Revoked || entry.ExpiresAtUnixS <= nowUnixS) && len(entry.ArtifactJSON) != 0 {
			entry.ArtifactJSON = nil
			changed = true
		}
	}
	compacted := compactControlArtifactEntries(pool.Entries)
	if len(compacted) != len(pool.Entries) {
		changed = true
	}
	pool.Entries = compacted
	return changed
}

func compactControlArtifactEntries(entries []config.ControlArtifactEntry) []config.ControlArtifactEntry {
	if len(entries) <= config.ControlArtifactMaxPoolEntries {
		return entries
	}
	remove := len(entries) - config.ControlArtifactMaxPoolEntries
	compacted := make([]config.ControlArtifactEntry, 0, config.ControlArtifactMaxPoolEntries)
	for _, entry := range entries {
		if remove > 0 && (entry.Spent || entry.Revoked || len(entry.ArtifactJSON) == 0) {
			remove--
			continue
		}
		compacted = append(compacted, entry)
	}
	// Never discard a usable entry merely to satisfy the storage bound. If
	// terminal entries are insufficient, leave the pool oversized so the
	// caller's exact validation fails closed instead of silently losing a
	// recovery credential.
	return compacted
}

func usableControlArtifactCount(pool *config.ControlArtifactPool, nowUnixS int64) int {
	if pool == nil {
		return 0
	}
	count := 0
	for _, entry := range pool.Entries {
		if !entry.Spent && !entry.Revoked && len(entry.ArtifactJSON) != 0 && entry.ExpiresAtUnixS > nowUnixS+pool.RefreshHorizonSeconds {
			count++
		}
	}
	return count
}

func outstandingControlArtifactCount(pool *config.ControlArtifactPool, nowUnixS int64) int {
	if pool == nil {
		return 0
	}
	count := 0
	for _, entry := range pool.Entries {
		if !entry.Spent && !entry.Revoked && len(entry.ArtifactJSON) != 0 && entry.ExpiresAtUnixS > nowUnixS {
			count++
		}
	}
	return count
}

func highestControlArtifactSequence(entries []config.ControlArtifactEntry) uint64 {
	var highest uint64
	for _, entry := range entries {
		if entry.Sequence > highest {
			highest = entry.Sequence
		}
	}
	return highest
}
