package redevpluginintegration

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"

	"github.com/floegence/redevplugin/pkg/host"
	"github.com/floegence/redevplugin/pkg/sessionctx"
	"github.com/floegence/redevplugin/pkg/sessionscope"
)

const sessionLifecycleSchemaVersion = "redeven.redevplugin-closed-sessions.v1"

type sessionLifecycleValue struct {
	identity sessionscope.TeardownIdentity
	proof    []byte
	closed   bool
}

type sessionLifecycleAdapter struct {
	mu      sync.Mutex
	path    string
	records map[sessionctx.SessionScope]sessionLifecycleValue
}

type sessionLifecycleDocument struct {
	SchemaVersion string                   `json:"schema_version"`
	Records       []sessionLifecycleRecord `json:"records"`
}

type sessionLifecycleRecord struct {
	OwnerSessionHash     string `json:"owner_session_hash"`
	OwnerUserHash        string `json:"owner_user_hash"`
	OwnerEnvHash         string `json:"owner_env_hash"`
	SessionChannelIDHash string `json:"session_channel_id_hash"`
	OperationID          string `json:"operation_id"`
	Proof                []byte `json:"proof"`
	Closed               bool   `json:"closed"`
}

func newSessionLifecycleAdapter(path string) (*sessionLifecycleAdapter, error) {
	path = filepath.Clean(path)
	if path == "." || !filepath.IsAbs(path) {
		return nil, errors.New("session lifecycle state path must be absolute")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	adapter := &sessionLifecycleAdapter{
		path:    path,
		records: make(map[sessionctx.SessionScope]sessionLifecycleValue),
	}
	if err := adapter.load(); err != nil {
		return nil, err
	}
	return adapter, nil
}

func (adapter *sessionLifecycleAdapter) load() error {
	raw, err := os.ReadFile(adapter.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var document sessionLifecycleDocument
	if err := json.Unmarshal(raw, &document); err != nil {
		return err
	}
	if document.SchemaVersion != sessionLifecycleSchemaVersion {
		return errors.New("session lifecycle state schema is unsupported")
	}
	if len(document.Records) > sessionscope.HardMaxScopes {
		return errors.New("session lifecycle state exceeds the record limit")
	}
	for _, record := range document.Records {
		scope := sessionctx.SessionScope{
			OwnerSessionHash:     record.OwnerSessionHash,
			OwnerUserHash:        record.OwnerUserHash,
			OwnerEnvHash:         record.OwnerEnvHash,
			SessionChannelIDHash: record.SessionChannelIDHash,
		}
		if err := scope.Validate(); err != nil {
			return err
		}
		proof, err := sessionscope.NewClosedSessionProof(record.Proof)
		if err != nil {
			return err
		}
		identity, err := sessionscope.NewTeardownIdentity(record.OperationID, proof)
		if err != nil {
			return err
		}
		if _, exists := adapter.records[scope]; exists {
			return errors.New("session lifecycle state contains a duplicate scope")
		}
		adapter.records[scope] = sessionLifecycleValue{
			identity: identity,
			proof:    append([]byte(nil), record.Proof...),
			closed:   record.Closed,
		}
	}
	return nil
}

func (adapter *sessionLifecycleAdapter) persist(records map[sessionctx.SessionScope]sessionLifecycleValue) error {
	if len(records) > sessionscope.HardMaxScopes {
		return errors.New("session lifecycle state exceeds the record limit")
	}
	encoded := make([]sessionLifecycleRecord, 0, len(records))
	for scope, value := range records {
		encoded = append(encoded, sessionLifecycleRecord{
			OwnerSessionHash:     scope.OwnerSessionHash,
			OwnerUserHash:        scope.OwnerUserHash,
			OwnerEnvHash:         scope.OwnerEnvHash,
			SessionChannelIDHash: scope.SessionChannelIDHash,
			OperationID:          value.identity.OperationID,
			Proof:                append([]byte(nil), value.proof...),
			Closed:               value.closed,
		})
	}
	sort.Slice(encoded, func(i, j int) bool {
		left := encoded[i]
		right := encoded[j]
		return left.OwnerSessionHash+"\x00"+left.OwnerUserHash+"\x00"+left.OwnerEnvHash+"\x00"+left.SessionChannelIDHash <
			right.OwnerSessionHash+"\x00"+right.OwnerUserHash+"\x00"+right.OwnerEnvHash+"\x00"+right.SessionChannelIDHash
	})
	raw, err := json.MarshalIndent(sessionLifecycleDocument{
		SchemaVersion: sessionLifecycleSchemaVersion,
		Records:       encoded,
	}, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(adapter.path), ".closed-sessions-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
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
	if err := os.Rename(temporaryPath, adapter.path); err != nil {
		return err
	}
	directory, err := os.Open(filepath.Dir(adapter.path))
	if err != nil {
		return err
	}
	if err := directory.Sync(); err != nil {
		_ = directory.Close()
		return err
	}
	return directory.Close()
}

func (adapter *sessionLifecycleAdapter) ReconcileRetainedSessionScopes(ctx context.Context, request host.ReconcileRetainedSessionScopesRequest) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	adapter.mu.Lock()
	defer adapter.mu.Unlock()
	next := cloneSessionLifecycleRecords(adapter.records)
	changed := false
	for _, retained := range request.Scopes {
		if err := retained.SessionScope.Validate(); err != nil || !retained.Snapshot.State.Valid() ||
			retained.Snapshot.State == sessionscope.StateActive || !retained.Snapshot.Fenced {
			return errors.New("retained session scope fence is invalid")
		}
		value, ok := adapter.records[retained.SessionScope]
		if !ok || !value.identity.Valid() || !retained.MatchesIdentity(value.identity) {
			return errors.New("retained session scope identity is unavailable")
		}
		if !value.closed {
			value.closed = true
			next[retained.SessionScope] = value
			changed = true
		}
	}
	if changed {
		if err := adapter.persist(next); err != nil {
			return err
		}
		adapter.records = next
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
	if value, ok := adapter.records[scope]; ok {
		return value.identity, nil
	}
	proof, err := sessionscope.GenerateClosedSessionProof()
	if err != nil {
		return sessionscope.TeardownIdentity{}, err
	}
	proofBytes, err := proof.BytesForDurableStorage()
	if err != nil {
		return sessionscope.TeardownIdentity{}, err
	}
	operationBytes := make([]byte, 16)
	if _, err := rand.Read(operationBytes); err != nil {
		return sessionscope.TeardownIdentity{}, err
	}
	identity, err := sessionscope.NewTeardownIdentity("redeven-session-close-"+hex.EncodeToString(operationBytes), proof)
	if err != nil {
		return sessionscope.TeardownIdentity{}, err
	}
	next := cloneSessionLifecycleRecords(adapter.records)
	next[scope] = sessionLifecycleValue{identity: identity, proof: proofBytes}
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
	if value.closed {
		return nil
	}
	next := cloneSessionLifecycleRecords(adapter.records)
	value.closed = true
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
	if !ok || !value.closed || !value.identity.Matches(request.Identity) {
		return errors.New("closed session identity does not match")
	}
	return nil
}

func cloneSessionLifecycleRecords(source map[sessionctx.SessionScope]sessionLifecycleValue) map[sessionctx.SessionScope]sessionLifecycleValue {
	cloned := make(map[sessionctx.SessionScope]sessionLifecycleValue, len(source)+1)
	for scope, value := range source {
		value.proof = append([]byte(nil), value.proof...)
		cloned[scope] = value
	}
	return cloned
}

var _ host.SessionLifecycleAdapter = (*sessionLifecycleAdapter)(nil)
