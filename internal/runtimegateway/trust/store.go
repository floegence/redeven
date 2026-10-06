package trust

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/gatewaystate"
	"github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimegateway/security"
)

const challengeTTL = 5 * time.Minute

type Store struct {
	mu       sync.Mutex
	filePath string
	state    fileState
	pending  map[string]pendingChallenge
}

type pendingChallenge struct {
	ClientNonce     string
	ClientPublicKey string
	BindingAudience string
	PairingCode     string
	ExpiresAtUnixMS int64
}

type PendingChallenge struct {
	ClientNonce     string
	BindingAudience string
	PairingCode     string
	ExpiresAtUnixMS int64
}

type fileState struct {
	SchemaVersion int                  `json:"schema_version"`
	Gateway       gatewayIdentity      `json:"gateway"`
	Clients       map[string]clientKey `json:"clients"`
}

type gatewayIdentity struct {
	GatewayID   string `json:"gateway_id"`
	DisplayName string `json:"display_name"`
	PublicKey   string `json:"public_key"`
	PrivateKey  string `json:"private_key"`
}

type clientKey struct {
	ClientKeyID        string                      `json:"client_key_id"`
	ClientPublicKey    string                      `json:"client_public_key"`
	BindingAudience    string                      `json:"binding_audience"`
	Permissions        protocol.GatewayPermissions `json:"permissions"`
	PairedAtUnixMS     int64                       `json:"paired_at_unix_ms"`
	LastVerifiedUnixMS int64                       `json:"last_verified_at_unix_ms,omitempty"`
}

func NewStore(filePath string) *Store {
	return &Store{filePath: strings.TrimSpace(filePath)}
}

func (s *Store) GatewayMetadata(bindingAudience string) (protocol.GatewayMetadata, string, error) {
	state, err := s.ensureStateForRead()
	if err != nil {
		return protocol.GatewayMetadata{}, "", err
	}
	if err := s.validateBindingAudience(state, bindingAudience); err != nil {
		return protocol.GatewayMetadata{}, "", err
	}
	fingerprint, err := security.PublicKeyFingerprint(state.Gateway.PublicKey)
	if err != nil {
		return protocol.GatewayMetadata{}, "", err
	}
	return protocol.GatewayMetadata{
		GatewayID:                   state.Gateway.GatewayID,
		DisplayName:                 state.Gateway.DisplayName,
		GatewayPublicKeyFingerprint: fingerprint,
	}, fingerprint, nil
}

func (s *Store) PairingChallenge(req protocol.PairingChallengeRequest) (protocol.PairingChallengeResponse, error) {
	if strings.TrimSpace(req.ProtocolVersion) != protocol.Version {
		return protocol.PairingChallengeResponse{}, errors.New("protocol_version is not supported")
	}
	req.ClientNonce = strings.TrimSpace(req.ClientNonce)
	req.ClientPublicKey = strings.TrimSpace(req.ClientPublicKey)
	req.BindingAudience = strings.TrimSpace(req.BindingAudience)
	req.PairingCode = strings.TrimSpace(req.PairingCode)
	if req.ClientNonce == "" || req.ClientPublicKey == "" || req.BindingAudience == "" {
		return protocol.PairingChallengeResponse{}, errors.New("pairing challenge request is incomplete")
	}
	state, err := s.ensureStateForPairing(req.BindingAudience)
	if err != nil {
		return protocol.PairingChallengeResponse{}, err
	}
	fingerprint, err := security.PublicKeyFingerprint(state.Gateway.PublicKey)
	if err != nil {
		return protocol.PairingChallengeResponse{}, err
	}
	gatewayNonce, err := randomB64u(24)
	if err != nil {
		return protocol.PairingChallengeResponse{}, err
	}
	expiresAt := time.Now().Add(challengeTTL).UnixMilli()
	challengeFields := map[string]any{
		"binding_audience":   req.BindingAudience,
		"client_nonce":       req.ClientNonce,
		"client_public_key":  req.ClientPublicKey,
		"expires_at_unix_ms": expiresAt,
		"gateway_id":         state.Gateway.GatewayID,
		"gateway_nonce":      gatewayNonce,
		"gateway_public_key": state.Gateway.PublicKey,
		"protocol_version":   protocol.Version,
	}
	if req.PairingCode != "" {
		challengeFields["pairing_code"] = req.PairingCode
	}
	payload, err := security.CanonicalJSON(challengeFields)
	if err != nil {
		return protocol.PairingChallengeResponse{}, err
	}
	signature, err := security.SignPayload(state.Gateway.PrivateKey, payload)
	if err != nil {
		return protocol.PairingChallengeResponse{}, err
	}
	s.mu.Lock()
	if s.pending == nil {
		s.pending = map[string]pendingChallenge{}
	}
	for id, pending := range s.pending {
		if pending.ExpiresAtUnixMS <= time.Now().UnixMilli() {
			delete(s.pending, id)
		}
	}
	if len(s.pending) >= 128 {
		s.mu.Unlock()
		return protocol.PairingChallengeResponse{}, errors.New("too many pending pairings")
	}
	s.pending[gatewayNonce] = pendingChallenge{
		ClientNonce:     req.ClientNonce,
		ClientPublicKey: req.ClientPublicKey,
		BindingAudience: req.BindingAudience,
		PairingCode:     req.PairingCode,
		ExpiresAtUnixMS: expiresAt,
	}
	s.mu.Unlock()
	return protocol.PairingChallengeResponse{
		ProtocolVersion:             protocol.Version,
		GatewayID:                   state.Gateway.GatewayID,
		GatewayPublicKey:            state.Gateway.PublicKey,
		GatewayPublicKeyFingerprint: fingerprint,
		GatewayNonce:                gatewayNonce,
		PairingCode:                 req.PairingCode,
		ExpiresAtUnixMS:             expiresAt,
		Signature:                   signature,
	}, nil
}

func (s *Store) CompletePairing(req protocol.PairingCompleteRequest) (protocol.PairingCompleteResponse, error) {
	if err := protocol.ValidatePairingCompleteRequest(req); err != nil {
		return protocol.PairingCompleteResponse{}, err
	}
	req = protocol.NormalizePairingCompleteRequest(req)
	if req.ClientNonce == "" || req.GatewayNonce == "" || req.GatewayID == "" || req.BindingAudience == "" || req.ClientKeyID == "" || req.Proof == "" {
		return protocol.PairingCompleteResponse{}, errors.New("pairing completion request is incomplete")
	}
	state, err := s.ensureStateForRead()
	if err != nil {
		return protocol.PairingCompleteResponse{}, err
	}
	if err := s.validateBindingAudience(state, req.BindingAudience); err != nil {
		return protocol.PairingCompleteResponse{}, err
	}
	if req.GatewayID != state.Gateway.GatewayID {
		return protocol.PairingCompleteResponse{}, errors.New("gateway_id does not match this Gateway")
	}
	challenge, ok := s.consumeChallenge(req.GatewayNonce)
	if !ok || challenge.ClientNonce != req.ClientNonce || challenge.BindingAudience != req.BindingAudience || challenge.ExpiresAtUnixMS <= time.Now().UnixMilli() {
		return protocol.PairingCompleteResponse{}, errors.New("pairing challenge is unknown or expired")
	}
	if expectedClientKeyID := security.ClientKeyID(challenge.ClientPublicKey); expectedClientKeyID != req.ClientKeyID {
		return protocol.PairingCompleteResponse{}, errors.New("client_key_id does not match client_public_key")
	}
	requestFields := map[string]any{
		"binding_audience": req.BindingAudience,
		"client_key_id":    req.ClientKeyID,
		"client_nonce":     req.ClientNonce,
		"gateway_id":       req.GatewayID,
		"gateway_nonce":    req.GatewayNonce,
		"protocol_version": protocol.Version,
	}
	requestFields["permissions"] = req.Permissions
	requestPayload, err := security.CanonicalJSON(requestFields)
	if err != nil {
		return protocol.PairingCompleteResponse{}, err
	}
	if !security.VerifySignature(challenge.ClientPublicKey, requestPayload, req.Proof) {
		return protocol.PairingCompleteResponse{}, errors.New("pairing completion proof is invalid")
	}
	pairedAt := time.Now().UnixMilli()
	client := clientKey{
		ClientKeyID:     req.ClientKeyID,
		ClientPublicKey: challenge.ClientPublicKey,
		BindingAudience: req.BindingAudience,
		Permissions:     req.Permissions,
		PairedAtUnixMS:  pairedAt,
	}
	if err := s.saveClient(client); err != nil {
		return protocol.PairingCompleteResponse{}, err
	}
	responseFields := map[string]any{
		"binding_audience":  req.BindingAudience,
		"client_key_id":     req.ClientKeyID,
		"client_nonce":      req.ClientNonce,
		"gateway_id":        req.GatewayID,
		"gateway_nonce":     req.GatewayNonce,
		"paired_at_unix_ms": pairedAt,
		"protocol_version":  protocol.Version,
	}
	responseFields["permissions"] = req.Permissions
	payload, err := security.CanonicalJSON(responseFields)
	if err != nil {
		return protocol.PairingCompleteResponse{}, err
	}
	proof, err := security.SignPayload(state.Gateway.PrivateKey, payload)
	if err != nil {
		return protocol.PairingCompleteResponse{}, err
	}
	return protocol.PairingCompleteResponse{
		ProtocolVersion: protocol.Version,
		GatewayID:       state.Gateway.GatewayID,
		ClientKeyID:     req.ClientKeyID,
		PairedAtUnixMS:  pairedAt,
		Permissions:     req.Permissions,
		Proof:           proof,
	}, nil
}

func (s *Store) PendingChallenge(gatewayNonce string) (PendingChallenge, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pending == nil {
		return PendingChallenge{}, false
	}
	challenge, ok := s.pending[strings.TrimSpace(gatewayNonce)]
	if !ok {
		return PendingChallenge{}, false
	}
	return PendingChallenge{
		ClientNonce:     challenge.ClientNonce,
		BindingAudience: challenge.BindingAudience,
		PairingCode:     challenge.PairingCode,
		ExpiresAtUnixMS: challenge.ExpiresAtUnixMS,
	}, true
}

func (s *Store) consumeChallenge(gatewayNonce string) (pendingChallenge, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pending == nil {
		return pendingChallenge{}, false
	}
	key := strings.TrimSpace(gatewayNonce)
	challenge, ok := s.pending[key]
	delete(s.pending, key)
	return challenge, ok
}

func (s *Store) GatewayPrivateKey() (string, error) {
	state, err := s.ensureStateForRead()
	if err != nil {
		return "", err
	}
	return state.Gateway.PrivateKey, nil
}

func (s *Store) IsPaired(clientKeyID string, bindingAudience string) bool {
	state, err := s.ensureStateForRead()
	if err != nil {
		return false
	}
	_, ok := state.Clients[strings.TrimSpace(clientKeyID)]
	if !ok {
		return false
	}
	return ok
}

func (s *Store) ClientPublicKey(clientKeyID string, bindingAudience string) (string, bool) {
	state, err := s.ensureStateForRead()
	if err != nil {
		return "", false
	}
	if err := s.validateBindingAudience(state, bindingAudience); err != nil {
		return "", false
	}
	client, ok := state.Clients[strings.TrimSpace(clientKeyID)]
	if !ok {
		return "", false
	}
	return client.ClientPublicKey, true
}

func (s *Store) ClientPermissions(clientKeyID string) protocol.GatewayPermissions {
	state, err := s.ensureStateForRead()
	if err != nil {
		return protocol.GatewayPermissions{}
	}
	return state.Clients[strings.TrimSpace(clientKeyID)].Permissions
}

// Initialize establishes a machine identity before any client is paired. Its ID
// and key remain stable across listener address changes.
func (s *Store) Initialize() error { _, err := s.ensureStateForPairing(""); return err }

func (s *Store) ensureStateForPairing(bindingAudience string) (fileState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Gateway.GatewayID != "" {
		return s.state, nil
	}
	state, err := s.loadState()
	if err != nil {
		return fileState{}, err
	}
	if state.Gateway.GatewayID == "" {
		state, err = newFileState(bindingAudience)
		if err != nil {
			return fileState{}, err
		}
		if err := s.saveStateLocked(state); err != nil {
			return fileState{}, err
		}
	}
	s.state = state
	return s.state, nil
}

func (s *Store) validateBindingAudience(_ fileState, bindingAudience string) error {
	if len(bindingAudience) > 1024 || strings.ContainsAny(bindingAudience, "\r\n\x00") {
		return errors.New("invalid binding audience")
	}
	return nil
}

func (s *Store) ensureStateForRead() (fileState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Gateway.GatewayID != "" {
		return s.state, nil
	}
	state, err := s.loadState()
	if err != nil {
		return fileState{}, err
	}
	if state.Gateway.GatewayID == "" {
		return fileState{}, errors.New("gateway identity is not initialized")
	}
	s.state = state
	return s.state, nil
}

func (s *Store) loadState() (fileState, error) {
	if strings.TrimSpace(s.filePath) == "" {
		return newFileState("")
	}
	info, err := os.Lstat(s.filePath)
	if err == nil && (!info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > 4<<20) {
		return fileState{}, errors.New("invalid Gateway trust file")
	}
	raw, err := os.ReadFile(s.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return fileState{}, nil
		}
		return fileState{}, err
	}
	var state fileState
	if err := json.Unmarshal(raw, &state); err != nil {
		return fileState{}, err
	}
	if state.Gateway.GatewayID == "" || state.Gateway.PublicKey == "" || state.Gateway.PrivateKey == "" {
		return fileState{}, errors.New("invalid Gateway identity")
	}
	// Verify the key pair before any one-time migration can replace the file.
	proof, err := security.SignPayload(state.Gateway.PrivateKey, state.Gateway.GatewayID)
	if err != nil || !security.VerifySignature(state.Gateway.PublicKey, state.Gateway.GatewayID, proof) {
		return fileState{}, errors.New("invalid Gateway identity key pair")
	}
	for id, client := range state.Clients {
		if id != client.ClientKeyID || id != security.ClientKeyID(client.ClientPublicKey) {
			return fileState{}, errors.New("invalid paired Gateway client")
		}
		if _, err := security.PublicKeyFingerprint(client.ClientPublicKey); err != nil {
			return fileState{}, errors.New("invalid paired Gateway client key")
		}
	}
	if state.SchemaVersion == 1 {
		for id, client := range state.Clients {
			client.Permissions = protocol.GatewayPermissions{Access: true}
			state.Clients[id] = client
		}
		state.SchemaVersion = 2
		if err := s.persistState(state); err != nil {
			return fileState{}, err
		}
	} else if state.SchemaVersion != 2 {
		return fileState{}, errors.New("unsupported Gateway trust schema")
	}
	if state.Clients == nil {
		state.Clients = map[string]clientKey{}
	}
	return state, nil
}

// Readers retain immutable snapshots; each writer clones the latest committed
// map while holding the lock so concurrent pairings cannot lose one another.
func (s *Store) saveClient(client clientKey) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.state
	state.Clients = maps.Clone(state.Clients)
	if state.Clients == nil {
		state.Clients = map[string]clientKey{}
	}
	state.Clients[client.ClientKeyID] = client
	return s.saveStateLocked(state)
}

func (s *Store) saveStateLocked(state fileState) error {
	state.SchemaVersion = 2
	if state.Clients == nil {
		state.Clients = map[string]clientKey{}
	}
	if err := s.persistState(state); err != nil {
		return err
	}
	s.state = state
	return nil
}

func (s *Store) persistState(state fileState) error {
	if strings.TrimSpace(s.filePath) == "" {
		return nil
	}
	return gatewaystate.Write(s.filePath, state)
}

func newFileState(_ string) (fileState, error) {
	keyPair, err := security.GenerateKeyPair()
	if err != nil {
		return fileState{}, err
	}
	gatewayID, err := randomB64u(24)
	if err != nil {
		return fileState{}, err
	}
	gatewayID = "gw_" + gatewayID
	return fileState{
		SchemaVersion: 2,
		Gateway: gatewayIdentity{
			GatewayID:   gatewayID,
			DisplayName: "Redeven Gateway",
			PublicKey:   keyPair.PublicKeyPEM,
			PrivateKey:  keyPair.PrivateKeyPEM,
		},
		Clients: map[string]clientKey{},
	}, nil
}

func randomB64u(n int) (string, error) {
	if n <= 0 {
		return "", fmt.Errorf("invalid random byte length %d", n)
	}
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
