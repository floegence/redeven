package redevpluginintegration

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/floegence/redeven/internal/lockfile"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redevplugin/pkg/host"
	"github.com/floegence/redevplugin/pkg/sessionctx"
	"github.com/floegence/redevplugin/pkg/sessionscope"
)

const (
	sessionLifecycleV1Schema          = "redeven.redevplugin-closed-sessions.v1"
	sessionLifecycleGateSchema        = "redeven.redevplugin-closed-sessions.v2-gate"
	sessionLifecycleDescriptorSchema  = "redeven.redevplugin-closed-sessions-generation.v2"
	sessionLifecycleRecordsSchema     = "redeven.redevplugin-closed-sessions-records.v2"
	sessionLifecycleMigrationSchema   = "redeven.redevplugin-closed-sessions-migration.v2"
	sessionAuthorityActive            = "active"
	sessionAuthorityRetired           = "retired"
	sessionAuthorityTerminal          = "terminal"
	legacyProcessGeneration           = "legacy-v1-prior-process"
	maximumSessionGenerationValueSize = 256
)

var errSessionLifecycleMutationOutcomeUnknown = errors.New("session lifecycle mutation outcome is unknown")

type PluginSessionGeneration struct {
	Session           sessionctx.Context
	ProcessGeneration string
	SessionGeneration string
}

type sessionLifecycleStartupAuthority struct {
	runtime           *RuntimeProcessAuthority
	stateGenerationID string
}

type RuntimeProcessAuthority struct {
	lock              *lockfile.Lock
	lockPath          string
	processGeneration string
}

func NewRuntimeProcessAuthority(runtimeLock *lockfile.Lock, expectedLockPath, processGeneration string) (*RuntimeProcessAuthority, error) {
	expectedLockPath = filepath.Clean(strings.TrimSpace(expectedLockPath))
	if runtimeLock == nil || !runtimeLock.Held() || expectedLockPath == "." || !filepath.IsAbs(expectedLockPath) ||
		filepath.Clean(runtimeLock.Path()) != expectedLockPath || !validSessionGenerationValue(processGeneration) {
		return nil, errors.New("runtime process lock authority is invalid")
	}
	return &RuntimeProcessAuthority{
		lock: runtimeLock, lockPath: expectedLockPath, processGeneration: processGeneration,
	}, nil
}

func (authority *RuntimeProcessAuthority) ProcessGeneration() string {
	if !authority.valid() {
		return ""
	}
	return authority.processGeneration
}

func (authority *RuntimeProcessAuthority) valid() bool {
	return authority != nil && authority.lock != nil && authority.lock.Held() &&
		filepath.Clean(authority.lock.Path()) == authority.lockPath && filepath.IsAbs(authority.lockPath) &&
		validSessionGenerationValue(authority.processGeneration)
}

func PluginSessionGenerationFromMeta(meta *session.Meta, processGeneration, sessionGeneration string) (PluginSessionGeneration, error) {
	sessionContext, err := canonicalPluginSessionContextFromMeta(strings.TrimSpace(metaChannelID(meta)), meta)
	if err != nil {
		return PluginSessionGeneration{}, err
	}
	generation := PluginSessionGeneration{
		Session:           sessionContext,
		ProcessGeneration: processGeneration,
		SessionGeneration: sessionGeneration,
	}
	if _, err := validatePluginSessionGeneration(generation); err != nil {
		return PluginSessionGeneration{}, err
	}
	return generation, nil
}

func metaChannelID(meta *session.Meta) string {
	if meta == nil {
		return ""
	}
	return meta.ChannelID
}

type sessionLifecycleValue struct {
	session           sessionctx.Context
	processGeneration string
	sessionGeneration string
	authority         string
	phase             host.SessionScopeLifecyclePhase
	identity          sessionscope.TeardownIdentity
	proof             []byte
	closeContinuation bool
	terminalClaimID   string
}

type sessionLifecycleAdapter struct {
	mu               sync.Mutex
	gatePath         string
	startupAuthority sessionLifecycleStartupAuthority
	generationID     string
	recordsPath      string
	revision         uint64
	records          map[sessionctx.SessionScope]sessionLifecycleValue
	syncDirectory    func(string) error
	poisoned         bool
}

type sessionLifecycleV1Document struct {
	SchemaVersion string                     `json:"schema_version"`
	Records       []sessionLifecycleV1Record `json:"records"`
}

type sessionLifecycleV1Record struct {
	OwnerSessionHash     string `json:"owner_session_hash"`
	OwnerUserHash        string `json:"owner_user_hash"`
	OwnerEnvHash         string `json:"owner_env_hash"`
	SessionChannelIDHash string `json:"session_channel_id_hash"`
	OperationID          string `json:"operation_id"`
	Proof                []byte `json:"proof"`
	Closed               bool   `json:"closed"`
}

type sessionLifecycleGate struct {
	SchemaVersion    string `json:"schema_version"`
	GenerationID     string `json:"generation_id"`
	DescriptorSHA256 string `json:"descriptor_sha256"`
}

type sessionLifecycleDescriptor struct {
	SchemaVersion     string `json:"schema_version"`
	GenerationID      string `json:"generation_id"`
	StateGenerationID string `json:"state_generation_id"`
	SourceSchema      string `json:"source_schema"`
	SourceSHA256      string `json:"source_sha256,omitempty"`
}

type sessionLifecycleMigration struct {
	SchemaVersion     string `json:"schema_version"`
	GenerationID      string `json:"generation_id"`
	StateGenerationID string `json:"state_generation_id"`
	SourceSchema      string `json:"source_schema"`
	SourceSHA256      string `json:"source_sha256,omitempty"`
	DescriptorSHA256  string `json:"descriptor_sha256"`
	Phase             string `json:"phase"`
}

type sessionLifecycleRecordsDocument struct {
	SchemaVersion string                   `json:"schema_version"`
	GenerationID  string                   `json:"generation_id"`
	Revision      uint64                   `json:"revision"`
	Checksum      string                   `json:"checksum"`
	Records       []sessionLifecycleRecord `json:"records"`
}

type sessionLifecycleChecksumPayload struct {
	GenerationID string                   `json:"generation_id"`
	Revision     uint64                   `json:"revision"`
	Records      []sessionLifecycleRecord `json:"records"`
}

type sessionLifecycleRecord struct {
	OwnerSessionHash     string                          `json:"owner_session_hash"`
	OwnerUserHash        string                          `json:"owner_user_hash"`
	OwnerEnvHash         string                          `json:"owner_env_hash"`
	SessionChannelIDHash string                          `json:"session_channel_id_hash"`
	ProcessGeneration    string                          `json:"process_generation"`
	SessionGeneration    string                          `json:"session_generation"`
	Authority            string                          `json:"authority"`
	Phase                host.SessionScopeLifecyclePhase `json:"phase,omitempty"`
	OperationID          string                          `json:"operation_id,omitempty"`
	Proof                []byte                          `json:"proof,omitempty"`
	CloseContinuation    bool                            `json:"close_continuation,omitempty"`
	TerminalClaimID      string                          `json:"terminal_claim_id,omitempty"`
}

func newSessionLifecycleAdapter(path string, authority sessionLifecycleStartupAuthority) (*sessionLifecycleAdapter, error) {
	path = filepath.Clean(path)
	if path == "." || !filepath.IsAbs(path) {
		return nil, errors.New("session lifecycle state path must be absolute")
	}
	if !validSessionGenerationValue(authority.stateGenerationID) {
		return nil, errors.New("session lifecycle startup authority is invalid")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	if err := ensureRealDirectory(filepath.Dir(path)); err != nil {
		return nil, err
	}
	adapter := &sessionLifecycleAdapter{
		gatePath:         path,
		startupAuthority: authority,
		records:          make(map[sessionctx.SessionScope]sessionLifecycleValue),
		syncDirectory:    syncDirectory,
	}
	if err := adapter.loadOrMigrate(); err != nil {
		return nil, err
	}
	if err := adapter.recoverPriorProcessAuthority(); err != nil {
		return nil, err
	}
	return adapter, nil
}

func (adapter *sessionLifecycleAdapter) loadOrMigrate() error {
	raw, err := readRegularFile(adapter.gatePath)
	if errors.Is(err, os.ErrNotExist) {
		return adapter.createGeneration(nil, sessionLifecycleV1Document{})
	}
	if err != nil {
		return err
	}
	var header struct {
		SchemaVersion string `json:"schema_version"`
	}
	if err := json.Unmarshal(raw, &header); err != nil {
		return fmt.Errorf("decode session lifecycle state header: %w", err)
	}
	switch header.SchemaVersion {
	case sessionLifecycleGateSchema:
		return adapter.loadGeneration(raw)
	case sessionLifecycleV1Schema:
		var legacy sessionLifecycleV1Document
		if err := decodeStrictJSON(raw, &legacy); err != nil {
			return fmt.Errorf("decode legacy session lifecycle state: %w", err)
		}
		return adapter.createGeneration(raw, legacy)
	default:
		return errors.New("session lifecycle state schema is unsupported")
	}
}

func (adapter *sessionLifecycleAdapter) createGeneration(source []byte, legacy sessionLifecycleV1Document) error {
	if len(legacy.Records) > sessionscope.HardMaxScopes {
		return errors.New("session lifecycle state exceeds the record limit")
	}
	if source != nil && !adapter.startupAuthority.runtime.valid() {
		return errors.New("legacy session lifecycle migration requires the held runtime process lock")
	}
	sourceHash := ""
	if source != nil {
		sourceHash = sha256Hex(source)
	}
	journalPath := adapter.migrationPath()
	if migration, err := readSessionLifecycleMigration(journalPath); err == nil {
		if migration.SourceSHA256 != sourceHash || migration.SourceSchema != sessionLifecycleV1Schema ||
			migration.StateGenerationID != adapter.startupAuthority.stateGenerationID {
			return errors.New("session lifecycle migration journal does not match the active source")
		}
		return adapter.commitPreparedGeneration(migration)
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	generationID, err := randomSessionLifecycleID("generation")
	if err != nil {
		return err
	}
	generationDir := adapter.generationDir(generationID)
	if err := os.MkdirAll(generationDir, 0o700); err != nil {
		return err
	}
	if err := ensureRealDirectory(generationDir); err != nil {
		return err
	}
	descriptor := sessionLifecycleDescriptor{
		SchemaVersion:     sessionLifecycleDescriptorSchema,
		GenerationID:      generationID,
		StateGenerationID: adapter.startupAuthority.stateGenerationID,
		SourceSchema:      sessionLifecycleV1Schema,
		SourceSHA256:      sourceHash,
	}
	descriptorRaw, err := marshalSessionLifecycleJSON(descriptor)
	if err != nil {
		return err
	}
	descriptorHash := sha256Hex(descriptorRaw)
	if source != nil {
		if err := writeExclusiveSynced(filepath.Join(generationDir, "inactive-v1.json"), source, 0o400, adapter.syncDirectory); err != nil {
			return err
		}
	}
	if err := writeExclusiveSynced(filepath.Join(generationDir, "descriptor.json"), descriptorRaw, 0o400, adapter.syncDirectory); err != nil {
		return err
	}
	records := make(map[sessionctx.SessionScope]sessionLifecycleValue, len(legacy.Records))
	for _, record := range legacy.Records {
		value, scope, err := migrateSessionLifecycleV1Record(record)
		if err != nil {
			return err
		}
		if _, exists := records[scope]; exists {
			return errors.New("session lifecycle state contains a duplicate scope")
		}
		records[scope] = value
	}
	adapter.generationID = generationID
	adapter.recordsPath = filepath.Join(generationDir, "records.json")
	adapter.revision = 0
	if err := adapter.persist(records); err != nil {
		return err
	}
	if err := adapter.syncDirectory(generationDir); err != nil {
		return err
	}
	migration := sessionLifecycleMigration{
		SchemaVersion:     sessionLifecycleMigrationSchema,
		GenerationID:      generationID,
		StateGenerationID: adapter.startupAuthority.stateGenerationID,
		SourceSchema:      sessionLifecycleV1Schema,
		SourceSHA256:      sourceHash,
		DescriptorSHA256:  descriptorHash,
		Phase:             "prepared",
	}
	migrationRaw, err := marshalSessionLifecycleJSON(migration)
	if err != nil {
		return err
	}
	if err := writeAtomicSynced(journalPath, migrationRaw, 0o600, adapter.syncDirectory); err != nil {
		return err
	}
	return adapter.commitPreparedGeneration(migration)
}

func (adapter *sessionLifecycleAdapter) commitPreparedGeneration(migration sessionLifecycleMigration) error {
	if migration.SchemaVersion != sessionLifecycleMigrationSchema || migration.Phase != "prepared" ||
		!validSessionGenerationValue(migration.GenerationID) || migration.StateGenerationID != adapter.startupAuthority.stateGenerationID ||
		len(migration.DescriptorSHA256) != sha256.Size*2 {
		return errors.New("session lifecycle migration journal is invalid")
	}
	descriptorPath := filepath.Join(adapter.generationDir(migration.GenerationID), "descriptor.json")
	descriptorRaw, err := readRegularFile(descriptorPath)
	if err != nil {
		return err
	}
	if sha256Hex(descriptorRaw) != migration.DescriptorSHA256 {
		return errors.New("session lifecycle descriptor checksum mismatch")
	}
	var descriptor sessionLifecycleDescriptor
	if err := decodeStrictJSON(descriptorRaw, &descriptor); err != nil {
		return err
	}
	if descriptor.SchemaVersion != sessionLifecycleDescriptorSchema || descriptor.GenerationID != migration.GenerationID ||
		descriptor.StateGenerationID != adapter.startupAuthority.stateGenerationID ||
		descriptor.SourceSchema != migration.SourceSchema || descriptor.SourceSHA256 != migration.SourceSHA256 {
		return errors.New("session lifecycle descriptor does not match migration journal")
	}
	if migration.SourceSHA256 != "" {
		inactive, err := readRegularFile(filepath.Join(adapter.generationDir(migration.GenerationID), "inactive-v1.json"))
		if err != nil {
			return err
		}
		if sha256Hex(inactive) != migration.SourceSHA256 {
			return errors.New("inactive legacy session lifecycle evidence checksum mismatch")
		}
	}
	gateRaw, err := marshalSessionLifecycleJSON(sessionLifecycleGate{
		SchemaVersion:    sessionLifecycleGateSchema,
		GenerationID:     migration.GenerationID,
		DescriptorSHA256: migration.DescriptorSHA256,
	})
	if err != nil {
		return err
	}
	// Validate the complete prepared generation before replacing the v1 reader
	// path. A durable journal alone is not sufficient authority.
	if err := adapter.loadGeneration(gateRaw); err != nil {
		return err
	}
	if err := writeAtomicSynced(adapter.gatePath, gateRaw, 0o600, adapter.syncDirectory); err != nil {
		return err
	}
	return nil
}

func (adapter *sessionLifecycleAdapter) loadGeneration(gateRaw []byte) error {
	var gate sessionLifecycleGate
	if err := decodeStrictJSON(gateRaw, &gate); err != nil {
		return fmt.Errorf("decode session lifecycle gate: %w", err)
	}
	if gate.SchemaVersion != sessionLifecycleGateSchema || !validSessionGenerationValue(gate.GenerationID) ||
		len(gate.DescriptorSHA256) != sha256.Size*2 {
		return errors.New("session lifecycle gate is invalid")
	}
	generationDir := adapter.generationDir(gate.GenerationID)
	descriptorRaw, err := readRegularFile(filepath.Join(generationDir, "descriptor.json"))
	if err != nil {
		return err
	}
	if sha256Hex(descriptorRaw) != gate.DescriptorSHA256 {
		return errors.New("session lifecycle descriptor checksum mismatch")
	}
	var descriptor sessionLifecycleDescriptor
	if err := decodeStrictJSON(descriptorRaw, &descriptor); err != nil {
		return err
	}
	if descriptor.SchemaVersion != sessionLifecycleDescriptorSchema || descriptor.GenerationID != gate.GenerationID ||
		descriptor.StateGenerationID != adapter.startupAuthority.stateGenerationID ||
		descriptor.SourceSchema != sessionLifecycleV1Schema {
		return errors.New("session lifecycle descriptor is invalid")
	}
	if descriptor.SourceSHA256 != "" {
		inactive, err := readRegularFile(filepath.Join(generationDir, "inactive-v1.json"))
		if err != nil {
			return err
		}
		if sha256Hex(inactive) != descriptor.SourceSHA256 {
			return errors.New("inactive legacy session lifecycle evidence checksum mismatch")
		}
	}
	migration, err := readSessionLifecycleMigration(adapter.migrationPath())
	if err != nil {
		return err
	}
	if migration.SchemaVersion != sessionLifecycleMigrationSchema || migration.Phase != "prepared" ||
		migration.GenerationID != gate.GenerationID || migration.StateGenerationID != adapter.startupAuthority.stateGenerationID ||
		migration.SourceSchema != descriptor.SourceSchema || migration.SourceSHA256 != descriptor.SourceSHA256 ||
		migration.DescriptorSHA256 != gate.DescriptorSHA256 {
		return errors.New("session lifecycle migration journal does not match the committed gate")
	}
	recordsPath := filepath.Join(generationDir, "records.json")
	recordsRaw, err := readRegularFile(recordsPath)
	if err != nil {
		return err
	}
	var document sessionLifecycleRecordsDocument
	if err := decodeStrictJSON(recordsRaw, &document); err != nil {
		return fmt.Errorf("decode session lifecycle records: %w", err)
	}
	if document.SchemaVersion != sessionLifecycleRecordsSchema || document.GenerationID != gate.GenerationID || document.Revision == 0 {
		return errors.New("session lifecycle records metadata is invalid")
	}
	expectedChecksum, err := sessionLifecycleRecordsChecksum(document.GenerationID, document.Revision, document.Records)
	if err != nil {
		return err
	}
	if document.Checksum != expectedChecksum {
		return errors.New("session lifecycle records checksum mismatch")
	}
	if len(document.Records) > sessionscope.HardMaxScopes {
		return errors.New("session lifecycle state exceeds the record limit")
	}
	records := make(map[sessionctx.SessionScope]sessionLifecycleValue, len(document.Records))
	for _, record := range document.Records {
		value, scope, err := decodeSessionLifecycleRecord(record)
		if err != nil {
			return err
		}
		if _, exists := records[scope]; exists {
			return errors.New("session lifecycle state contains a duplicate scope")
		}
		records[scope] = value
	}
	adapter.generationID = gate.GenerationID
	adapter.recordsPath = recordsPath
	adapter.revision = document.Revision
	adapter.records = records
	return nil
}

func (adapter *sessionLifecycleAdapter) recoverPriorProcessAuthority() error {
	next := cloneSessionLifecycleRecords(adapter.records)
	changed := false
	for scope, value := range next {
		if value.authority == sessionAuthorityTerminal {
			continue
		}
		if !adapter.startupAuthority.runtime.valid() {
			return errors.New("prior session authority recovery requires the held runtime process lock")
		}
		if value.processGeneration == adapter.startupAuthority.runtime.processGeneration {
			continue
		}
		claim, err := randomSessionLifecycleID("recovery")
		if err != nil {
			return err
		}
		value.authority = sessionAuthorityTerminal
		value.terminalClaimID = claim
		next[scope] = value
		changed = true
	}
	if !changed {
		return nil
	}
	if err := adapter.persist(next); err != nil {
		return err
	}
	adapter.records = next
	return nil
}

func (adapter *sessionLifecycleAdapter) persist(records map[sessionctx.SessionScope]sessionLifecycleValue) error {
	if adapter.poisoned {
		return errSessionLifecycleMutationOutcomeUnknown
	}
	if len(records) > sessionscope.HardMaxScopes {
		return errors.New("session lifecycle state exceeds the record limit")
	}
	encoded := make([]sessionLifecycleRecord, 0, len(records))
	for _, value := range records {
		record, err := encodeSessionLifecycleRecord(value)
		if err != nil {
			return err
		}
		encoded = append(encoded, record)
	}
	sortSessionLifecycleRecords(encoded)
	nextRevision := adapter.revision + 1
	checksum, err := sessionLifecycleRecordsChecksum(adapter.generationID, nextRevision, encoded)
	if err != nil {
		return err
	}
	raw, err := marshalSessionLifecycleJSON(sessionLifecycleRecordsDocument{
		SchemaVersion: sessionLifecycleRecordsSchema,
		GenerationID:  adapter.generationID,
		Revision:      nextRevision,
		Checksum:      checksum,
		Records:       encoded,
	})
	if err != nil {
		return err
	}
	if err := writeAtomicSynced(adapter.recordsPath, raw, 0o600, adapter.syncDirectory); err != nil {
		if errors.Is(err, errSessionLifecycleMutationOutcomeUnknown) {
			adapter.poisoned = true
		}
		return err
	}
	adapter.revision = nextRevision
	return nil
}

func (adapter *sessionLifecycleAdapter) ReconcileRetainedSessionScopes(ctx context.Context, request host.ReconcileRetainedSessionScopesRequest) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	adapter.mu.Lock()
	defer adapter.mu.Unlock()
	for _, retained := range request.Scopes {
		if err := retained.SessionScope.Validate(); err != nil || !retained.Snapshot.State.Valid() ||
			retained.Snapshot.State == sessionscope.StateActive || !retained.Snapshot.Fenced {
			return errors.New("retained session scope fence is invalid")
		}
		value, ok := adapter.records[retained.SessionScope]
		if !ok || !value.identity.Valid() || !retained.MatchesIdentity(value.identity) {
			return errors.New("retained session scope identity is unavailable")
		}
		if value.phase != host.SessionScopeLifecyclePrepared && value.phase != host.SessionScopeLifecycleClosed &&
			value.phase != host.SessionScopeLifecycleFinalizing {
			return errors.New("retained session scope phase is invalid")
		}
	}
	return nil
}

func (adapter *sessionLifecycleAdapter) PrepareSessionScopeClose(ctx context.Context, request host.PrepareSessionScopeCloseRequest) (sessionscope.TeardownIdentity, error) {
	if err := ctx.Err(); err != nil {
		return sessionscope.TeardownIdentity{}, err
	}
	scope, err := request.Session.SessionScope()
	if err != nil {
		return sessionscope.TeardownIdentity{}, err
	}
	adapter.mu.Lock()
	defer adapter.mu.Unlock()
	if value, ok := adapter.records[scope]; ok && value.identity.Valid() {
		return value.identity, nil
	}
	value, ok := adapter.records[scope]
	if ok && value.phase != "" {
		return sessionscope.TeardownIdentity{}, errors.New("session close record has an invalid identity")
	}
	if !ok {
		return sessionscope.TeardownIdentity{}, errors.New("session generation is not registered")
	}
	proof, err := sessionscope.GenerateClosedSessionProof()
	if err != nil {
		return sessionscope.TeardownIdentity{}, err
	}
	proofBytes, err := proof.BytesForDurableStorage()
	if err != nil {
		return sessionscope.TeardownIdentity{}, err
	}
	operationID, err := randomSessionLifecycleID("redeven-session-close")
	if err != nil {
		return sessionscope.TeardownIdentity{}, err
	}
	identity, err := sessionscope.NewTeardownIdentity(operationID, proof)
	if err != nil {
		return sessionscope.TeardownIdentity{}, err
	}
	value.identity = identity
	value.proof = proofBytes
	value.phase = host.SessionScopeLifecyclePrepared
	next := cloneSessionLifecycleRecords(adapter.records)
	next[scope] = value
	if err := adapter.persist(next); err != nil {
		return sessionscope.TeardownIdentity{}, err
	}
	adapter.records = next
	return identity, nil
}

func (adapter *sessionLifecycleAdapter) CommitSessionScopeClose(ctx context.Context, request host.CommitSessionScopeCloseRequest) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	scope, err := request.Session.SessionScope()
	if err != nil {
		return err
	}
	adapter.mu.Lock()
	defer adapter.mu.Unlock()
	value, ok := adapter.records[scope]
	if !ok || !value.identity.Matches(request.Identity) {
		return errors.New("session close identity does not match")
	}
	if value.phase == host.SessionScopeLifecycleClosed {
		return nil
	}
	if value.phase != host.SessionScopeLifecyclePrepared {
		return errors.New("session close phase is invalid")
	}
	value.phase = host.SessionScopeLifecycleClosed
	value.closeContinuation = true
	if value.authority == sessionAuthorityActive {
		value.authority = sessionAuthorityRetired
	}
	next := cloneSessionLifecycleRecords(adapter.records)
	next[scope] = value
	if err := adapter.persist(next); err != nil {
		return err
	}
	adapter.records = next
	return nil
}

func (adapter *sessionLifecycleAdapter) ValidateClosedSessionScope(ctx context.Context, request host.ValidateClosedSessionScopeRequest) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	scope, err := request.Session.SessionScope()
	if err != nil {
		return err
	}
	adapter.mu.Lock()
	defer adapter.mu.Unlock()
	value, ok := adapter.records[scope]
	if !ok || (value.phase != host.SessionScopeLifecycleClosed && value.phase != host.SessionScopeLifecycleFinalizing) ||
		!value.identity.Matches(request.Identity) {
		return errors.New("closed session identity does not match")
	}
	return nil
}

func (adapter *sessionLifecycleAdapter) ListSessionScopeMaintenanceRecords(ctx context.Context) ([]host.SessionScopeMaintenanceRecord, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	adapter.mu.Lock()
	defer adapter.mu.Unlock()
	records := make([]host.SessionScopeMaintenanceRecord, 0, len(adapter.records))
	for _, value := range adapter.records {
		records = append(records, maintenanceRecord(value))
	}
	sort.Slice(records, func(i, j int) bool {
		left, _ := records[i].Session.SessionScope()
		right, _ := records[j].Session.SessionScope()
		return sessionScopeKey(left) < sessionScopeKey(right)
	})
	return records, nil
}

func (adapter *sessionLifecycleAdapter) InspectSessionScopeMaintenance(ctx context.Context, request host.InspectSessionScopeMaintenanceRequest) (host.SessionScopeMaintenanceRecord, error) {
	if err := ctx.Err(); err != nil {
		return host.SessionScopeMaintenanceRecord{}, err
	}
	scope, err := request.Session.SessionScope()
	if err != nil {
		return host.SessionScopeMaintenanceRecord{}, err
	}
	adapter.mu.Lock()
	defer adapter.mu.Unlock()
	value, ok := adapter.records[scope]
	if !ok || value.session != request.Session {
		return host.SessionScopeMaintenanceRecord{}, host.ErrSessionMaintenanceAbsent
	}
	return maintenanceRecord(value), nil
}

func (adapter *sessionLifecycleAdapter) ValidateTerminalSessionScopeClose(ctx context.Context, request host.ValidateTerminalSessionScopeCloseRequest) (host.SessionScopeMaintenanceRecord, error) {
	if err := ctx.Err(); err != nil {
		return host.SessionScopeMaintenanceRecord{}, err
	}
	scope, err := request.Session.SessionScope()
	if err != nil {
		return host.SessionScopeMaintenanceRecord{}, err
	}
	adapter.mu.Lock()
	defer adapter.mu.Unlock()
	value, ok := adapter.records[scope]
	if !ok || value.session != request.Session {
		return host.SessionScopeMaintenanceRecord{}, host.ErrSessionMaintenanceAbsent
	}
	if value.authority != sessionAuthorityTerminal || strings.TrimSpace(value.terminalClaimID) == "" {
		return host.SessionScopeMaintenanceRecord{}, host.ErrSessionMaintenanceState
	}
	if value.phase == "" {
		if request.Identity.Valid() || strings.TrimSpace(request.Identity.OperationID) != "" {
			return host.SessionScopeMaintenanceRecord{}, host.ErrSessionMaintenanceState
		}
	} else if !value.identity.Matches(request.Identity) {
		return host.SessionScopeMaintenanceRecord{}, host.ErrSessionMaintenanceState
	}
	return maintenanceRecord(value), nil
}

func (adapter *sessionLifecycleAdapter) PrepareSessionScopeFinalization(ctx context.Context, request host.PrepareSessionScopeFinalizationRequest) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	scope, err := request.Session.SessionScope()
	if err != nil {
		return err
	}
	adapter.mu.Lock()
	defer adapter.mu.Unlock()
	value, ok := adapter.records[scope]
	if !ok {
		return host.ErrSessionMaintenanceAbsent
	}
	if value.session != request.Session || value.authority != sessionAuthorityTerminal || value.terminalClaimID == "" ||
		!value.identity.Matches(request.Identity) {
		return host.ErrSessionMaintenanceState
	}
	if value.phase == host.SessionScopeLifecycleFinalizing {
		return nil
	}
	if value.phase != host.SessionScopeLifecycleClosed {
		return host.ErrSessionMaintenanceState
	}
	value.phase = host.SessionScopeLifecycleFinalizing
	next := cloneSessionLifecycleRecords(adapter.records)
	next[scope] = value
	if err := adapter.persist(next); err != nil {
		return err
	}
	adapter.records = next
	return nil
}

func (adapter *sessionLifecycleAdapter) CommitSessionScopeFinalization(ctx context.Context, request host.CommitSessionScopeFinalizationRequest) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	scope, err := request.Session.SessionScope()
	if err != nil {
		return err
	}
	adapter.mu.Lock()
	defer adapter.mu.Unlock()
	value, ok := adapter.records[scope]
	if !ok {
		return nil
	}
	if value.session != request.Session || value.phase != host.SessionScopeLifecycleFinalizing ||
		value.authority != sessionAuthorityTerminal || !value.identity.Matches(request.Identity) {
		return host.ErrSessionMaintenanceState
	}
	next := cloneSessionLifecycleRecords(adapter.records)
	delete(next, scope)
	if err := adapter.persist(next); err != nil {
		return err
	}
	adapter.records = next
	return nil
}

func (adapter *sessionLifecycleAdapter) bindActiveGeneration(ctx context.Context, generation PluginSessionGeneration) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	scope, err := validatePluginSessionGeneration(generation)
	if err != nil {
		return err
	}
	if !adapter.startupAuthority.runtime.valid() || generation.ProcessGeneration != adapter.startupAuthority.runtime.processGeneration {
		return errors.New("plugin session generation belongs to a different process")
	}
	adapter.mu.Lock()
	defer adapter.mu.Unlock()
	if current, ok := adapter.records[scope]; ok {
		if current.session == generation.Session && current.processGeneration == generation.ProcessGeneration &&
			current.sessionGeneration == generation.SessionGeneration && current.authority == sessionAuthorityActive && current.phase == "" {
			return nil
		}
		return errors.New("session generation scope is already bound")
	}
	value := sessionLifecycleValue{
		session:           generation.Session,
		processGeneration: generation.ProcessGeneration,
		sessionGeneration: generation.SessionGeneration,
		authority:         sessionAuthorityActive,
	}
	next := cloneSessionLifecycleRecords(adapter.records)
	next[scope] = value
	if err := adapter.persist(next); err != nil {
		return err
	}
	adapter.records = next
	return nil
}

func (adapter *sessionLifecycleAdapter) recordCloseContinuation(ctx context.Context, generation PluginSessionGeneration) error {
	return adapter.mutateExactGeneration(ctx, generation, func(value *sessionLifecycleValue) error {
		if value.phase != host.SessionScopeLifecycleClosed || !value.identity.Valid() ||
			(value.authority != sessionAuthorityRetired && value.authority != sessionAuthorityTerminal) {
			return errors.New("session close continuation is not committed")
		}
		value.closeContinuation = true
		return nil
	})
}

func (adapter *sessionLifecycleAdapter) recordTerminalIntent(ctx context.Context, generation PluginSessionGeneration) error {
	return adapter.mutateExactGeneration(ctx, generation, func(value *sessionLifecycleValue) error {
		if value.authority == sessionAuthorityTerminal && value.terminalClaimID != "" {
			return nil
		}
		if value.authority != sessionAuthorityActive && value.authority != sessionAuthorityRetired {
			return errors.New("session generation cannot become terminal")
		}
		claim, err := randomSessionLifecycleID("terminal")
		if err != nil {
			return err
		}
		value.authority = sessionAuthorityTerminal
		value.terminalClaimID = claim
		return nil
	})
}

func (adapter *sessionLifecycleAdapter) discardFinalizedGeneration(ctx context.Context, generation PluginSessionGeneration) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	scope, err := validatePluginSessionGeneration(generation)
	if err != nil {
		return err
	}
	adapter.mu.Lock()
	defer adapter.mu.Unlock()
	value, ok := adapter.records[scope]
	if !ok {
		return nil
	}
	if value.processGeneration != generation.ProcessGeneration || value.sessionGeneration != generation.SessionGeneration {
		return errors.New("session generation does not match durable record")
	}
	return errors.New("session generation still has durable lifecycle evidence")
}

func (adapter *sessionLifecycleAdapter) mutateExactGeneration(ctx context.Context, generation PluginSessionGeneration, mutate func(*sessionLifecycleValue) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	scope, err := validatePluginSessionGeneration(generation)
	if err != nil {
		return err
	}
	adapter.mu.Lock()
	defer adapter.mu.Unlock()
	value, ok := adapter.records[scope]
	if !ok || value.session != generation.Session || value.processGeneration != generation.ProcessGeneration ||
		value.sessionGeneration != generation.SessionGeneration {
		return errors.New("session generation does not match durable record")
	}
	before := value
	if err := mutate(&value); err != nil {
		return err
	}
	if sessionLifecycleValuesEqual(before, value) {
		return nil
	}
	next := cloneSessionLifecycleRecords(adapter.records)
	next[scope] = value
	if err := adapter.persist(next); err != nil {
		return err
	}
	adapter.records = next
	return nil
}

func maintenanceRecord(value sessionLifecycleValue) host.SessionScopeMaintenanceRecord {
	return host.SessionScopeMaintenanceRecord{
		Session:          value.session,
		Identity:         value.identity,
		Phase:            value.phase,
		TerminalEvidence: value.authority == sessionAuthorityTerminal && value.terminalClaimID != "",
	}
}

func migrateSessionLifecycleV1Record(record sessionLifecycleV1Record) (sessionLifecycleValue, sessionctx.SessionScope, error) {
	session := sessionctx.Context{
		OwnerSessionHash:     record.OwnerSessionHash,
		OwnerUserHash:        record.OwnerUserHash,
		OwnerEnvHash:         record.OwnerEnvHash,
		SessionChannelIDHash: record.SessionChannelIDHash,
	}
	scope, err := session.SessionScope()
	if err != nil {
		return sessionLifecycleValue{}, sessionctx.SessionScope{}, err
	}
	proof, err := sessionscope.NewClosedSessionProof(record.Proof)
	if err != nil {
		return sessionLifecycleValue{}, sessionctx.SessionScope{}, err
	}
	identity, err := sessionscope.NewTeardownIdentity(record.OperationID, proof)
	if err != nil {
		return sessionLifecycleValue{}, sessionctx.SessionScope{}, err
	}
	phase := host.SessionScopeLifecyclePrepared
	if record.Closed {
		phase = host.SessionScopeLifecycleClosed
	}
	return sessionLifecycleValue{
		session:           session,
		processGeneration: legacyProcessGeneration,
		sessionGeneration: "legacy-v1-" + record.SessionChannelIDHash,
		authority:         sessionAuthorityTerminal,
		phase:             phase,
		identity:          identity,
		proof:             append([]byte(nil), record.Proof...),
		closeContinuation: record.Closed,
		terminalClaimID:   "legacy-v1-recovery-" + record.SessionChannelIDHash,
	}, scope, nil
}

func decodeSessionLifecycleRecord(record sessionLifecycleRecord) (sessionLifecycleValue, sessionctx.SessionScope, error) {
	session := sessionctx.Context{
		OwnerSessionHash:     record.OwnerSessionHash,
		OwnerUserHash:        record.OwnerUserHash,
		OwnerEnvHash:         record.OwnerEnvHash,
		SessionChannelIDHash: record.SessionChannelIDHash,
	}
	scope, err := session.SessionScope()
	if err != nil {
		return sessionLifecycleValue{}, sessionctx.SessionScope{}, err
	}
	if !validSessionGenerationValue(record.ProcessGeneration) || !validSessionGenerationValue(record.SessionGeneration) ||
		!validSessionAuthority(record.Authority) {
		return sessionLifecycleValue{}, sessionctx.SessionScope{}, errors.New("session lifecycle generation metadata is invalid")
	}
	value := sessionLifecycleValue{
		session:           session,
		processGeneration: record.ProcessGeneration,
		sessionGeneration: record.SessionGeneration,
		authority:         record.Authority,
		phase:             record.Phase,
		proof:             append([]byte(nil), record.Proof...),
		closeContinuation: record.CloseContinuation,
		terminalClaimID:   record.TerminalClaimID,
	}
	if record.TerminalClaimID != "" && !validSessionGenerationValue(record.TerminalClaimID) {
		return sessionLifecycleValue{}, sessionctx.SessionScope{}, errors.New("session lifecycle terminal claim is invalid")
	}
	if record.Authority != sessionAuthorityTerminal && record.TerminalClaimID != "" {
		return sessionLifecycleValue{}, sessionctx.SessionScope{}, errors.New("non-terminal session lifecycle record contains terminal evidence")
	}
	if record.Phase == "" {
		if record.OperationID != "" || len(record.Proof) != 0 || record.CloseContinuation ||
			record.Authority == sessionAuthorityRetired ||
			(record.Authority == sessionAuthorityTerminal && record.TerminalClaimID == "") ||
			(record.Authority != sessionAuthorityTerminal && record.TerminalClaimID != "") {
			return sessionLifecycleValue{}, sessionctx.SessionScope{}, errors.New("session lifecycle authority record is invalid")
		}
		return value, scope, nil
	}
	if !record.Phase.Valid() {
		return sessionLifecycleValue{}, sessionctx.SessionScope{}, errors.New("session lifecycle phase is invalid")
	}
	proof, err := sessionscope.NewClosedSessionProof(record.Proof)
	if err != nil {
		return sessionLifecycleValue{}, sessionctx.SessionScope{}, err
	}
	identity, err := sessionscope.NewTeardownIdentity(record.OperationID, proof)
	if err != nil {
		return sessionLifecycleValue{}, sessionctx.SessionScope{}, err
	}
	value.identity = identity
	if (record.Phase == host.SessionScopeLifecycleClosed || record.Phase == host.SessionScopeLifecycleFinalizing) &&
		(!record.CloseContinuation || record.Authority == sessionAuthorityActive) {
		return sessionLifecycleValue{}, sessionctx.SessionScope{}, errors.New("closed session lifecycle continuation is invalid")
	}
	if record.Phase == host.SessionScopeLifecycleFinalizing &&
		(record.Authority != sessionAuthorityTerminal || record.TerminalClaimID == "") {
		return sessionLifecycleValue{}, sessionctx.SessionScope{}, errors.New("finalizing session lifecycle record lacks terminal evidence")
	}
	return value, scope, nil
}

func encodeSessionLifecycleRecord(value sessionLifecycleValue) (sessionLifecycleRecord, error) {
	if !value.session.Valid() || !validSessionGenerationValue(value.processGeneration) ||
		!validSessionGenerationValue(value.sessionGeneration) || !validSessionAuthority(value.authority) {
		return sessionLifecycleRecord{}, errors.New("session lifecycle record is invalid")
	}
	record := sessionLifecycleRecord{
		OwnerSessionHash:     value.session.OwnerSessionHash,
		OwnerUserHash:        value.session.OwnerUserHash,
		OwnerEnvHash:         value.session.OwnerEnvHash,
		SessionChannelIDHash: value.session.SessionChannelIDHash,
		ProcessGeneration:    value.processGeneration,
		SessionGeneration:    value.sessionGeneration,
		Authority:            value.authority,
		Phase:                value.phase,
		CloseContinuation:    value.closeContinuation,
		TerminalClaimID:      value.terminalClaimID,
	}
	if value.phase == "" {
		if value.identity.Valid() || len(value.proof) != 0 || value.closeContinuation ||
			value.authority == sessionAuthorityRetired ||
			(value.authority == sessionAuthorityTerminal && value.terminalClaimID == "") {
			return sessionLifecycleRecord{}, errors.New("session lifecycle authority record is invalid")
		}
		return record, nil
	}
	if !value.phase.Valid() || !value.identity.Valid() {
		return sessionLifecycleRecord{}, errors.New("session lifecycle close record is invalid")
	}
	if value.authority != sessionAuthorityTerminal && value.terminalClaimID != "" {
		return sessionLifecycleRecord{}, errors.New("non-terminal session lifecycle record contains terminal evidence")
	}
	if (value.phase == host.SessionScopeLifecycleClosed || value.phase == host.SessionScopeLifecycleFinalizing) &&
		(!value.closeContinuation || value.authority == sessionAuthorityActive) {
		return sessionLifecycleRecord{}, errors.New("closed session lifecycle continuation is invalid")
	}
	record.OperationID = value.identity.OperationID
	record.Proof = append([]byte(nil), value.proof...)
	return record, nil
}

func validatePluginSessionGeneration(generation PluginSessionGeneration) (sessionctx.SessionScope, error) {
	scope, err := generation.Session.SessionScope()
	if err != nil {
		return sessionctx.SessionScope{}, err
	}
	if !validSessionGenerationValue(generation.ProcessGeneration) || !validSessionGenerationValue(generation.SessionGeneration) {
		return sessionctx.SessionScope{}, errors.New("plugin session generation is invalid")
	}
	return scope, nil
}

func validSessionGenerationValue(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > maximumSessionGenerationValueSize {
		return false
	}
	for index := range len(value) {
		character := value[index]
		if character < 0x21 || character > 0x7e {
			return false
		}
	}
	return true
}

func validSessionAuthority(authority string) bool {
	return authority == sessionAuthorityActive || authority == sessionAuthorityRetired || authority == sessionAuthorityTerminal
}

func (adapter *sessionLifecycleAdapter) generationDir(generationID string) string {
	return filepath.Join(filepath.Dir(adapter.gatePath), "closed_sessions.generations", generationID)
}

func (adapter *sessionLifecycleAdapter) migrationPath() string {
	return filepath.Join(filepath.Dir(adapter.gatePath), "closed_sessions.migration.json")
}

func readSessionLifecycleMigration(path string) (sessionLifecycleMigration, error) {
	raw, err := readRegularFile(path)
	if err != nil {
		return sessionLifecycleMigration{}, err
	}
	var migration sessionLifecycleMigration
	if err := decodeStrictJSON(raw, &migration); err != nil {
		return sessionLifecycleMigration{}, err
	}
	return migration, nil
}

func sessionLifecycleRecordsChecksum(generationID string, revision uint64, records []sessionLifecycleRecord) (string, error) {
	raw, err := json.Marshal(sessionLifecycleChecksumPayload{
		GenerationID: generationID,
		Revision:     revision,
		Records:      records,
	})
	if err != nil {
		return "", err
	}
	return sha256Hex(raw), nil
}

func sortSessionLifecycleRecords(records []sessionLifecycleRecord) {
	sort.Slice(records, func(i, j int) bool {
		left := records[i]
		right := records[j]
		return left.OwnerSessionHash+"\x00"+left.OwnerUserHash+"\x00"+left.OwnerEnvHash+"\x00"+left.SessionChannelIDHash <
			right.OwnerSessionHash+"\x00"+right.OwnerUserHash+"\x00"+right.OwnerEnvHash+"\x00"+right.SessionChannelIDHash
	})
}

func sessionScopeKey(scope sessionctx.SessionScope) string {
	return scope.OwnerSessionHash + "\x00" + scope.OwnerUserHash + "\x00" + scope.OwnerEnvHash + "\x00" + scope.SessionChannelIDHash
}

func cloneSessionLifecycleRecords(source map[sessionctx.SessionScope]sessionLifecycleValue) map[sessionctx.SessionScope]sessionLifecycleValue {
	cloned := make(map[sessionctx.SessionScope]sessionLifecycleValue, len(source)+1)
	for scope, value := range source {
		value.proof = append([]byte(nil), value.proof...)
		cloned[scope] = value
	}
	return cloned
}

func sessionLifecycleValuesEqual(left, right sessionLifecycleValue) bool {
	return left.session == right.session && left.processGeneration == right.processGeneration &&
		left.sessionGeneration == right.sessionGeneration && left.authority == right.authority &&
		left.phase == right.phase && left.identity.OperationID == right.identity.OperationID &&
		string(left.proof) == string(right.proof) && left.closeContinuation == right.closeContinuation &&
		left.terminalClaimID == right.terminalClaimID
}

func randomSessionLifecycleID(prefix string) (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return prefix + "-" + hex.EncodeToString(value), nil
}

func sha256Hex(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func marshalSessionLifecycleJSON(value any) ([]byte, error) {
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(raw, '\n'), nil
}

func decodeStrictJSON(raw []byte, target any) error {
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values are not allowed")
		}
		return err
	}
	return nil
}

func writeExclusiveSynced(path string, raw []byte, mode os.FileMode, syncParent func(string) error) error {
	if err := ensureRealDirectory(filepath.Dir(path)); err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
	if err != nil {
		return err
	}
	if _, err := file.Write(raw); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := syncParent(filepath.Dir(path)); err != nil {
		return errors.Join(errSessionLifecycleMutationOutcomeUnknown, err)
	}
	return nil
}

func writeAtomicSynced(path string, raw []byte, mode os.FileMode, syncParent func(string) error) error {
	if err := ensureRealDirectory(filepath.Dir(path)); err != nil {
		return err
	}
	if info, err := os.Lstat(path); err == nil && (!info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0) {
		return errors.New("session lifecycle target is not a regular file")
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+"-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(mode); err != nil {
		_ = temporary.Close()
		return err
	}
	if _, err := temporary.Write(raw); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return err
	}
	if err := syncParent(filepath.Dir(path)); err != nil {
		return errors.Join(errSessionLifecycleMutationOutcomeUnknown, err)
	}
	return nil
}

func readRegularFile(path string) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("session lifecycle authority path is not a regular file")
	}
	return os.ReadFile(path)
}

func ensureRealDirectory(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("session lifecycle directory is not a real directory")
	}
	return nil
}

func syncDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	if err := directory.Sync(); err != nil {
		_ = directory.Close()
		return err
	}
	return directory.Close()
}

var _ host.SessionLifecycleAdapter = (*sessionLifecycleAdapter)(nil)
var _ host.SessionLifecycleMaintenanceAdapter = (*sessionLifecycleAdapter)(nil)
