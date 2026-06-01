package trust

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

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
	ClientKeyID        string `json:"client_key_id"`
	ClientPublicKey    string `json:"client_public_key"`
	BindingAudience    string `json:"binding_audience"`
	PairedAtUnixMS     int64  `json:"paired_at_unix_ms"`
	LastVerifiedUnixMS int64  `json:"last_verified_at_unix_ms,omitempty"`
}

func NewStore(filePath string) *Store {
	return &Store{filePath: strings.TrimSpace(filePath)}
}

func (s *Store) GatewayMetadata(bindingAudience string) (protocol.GatewayMetadata, string, error) {
	state, err := s.ensureState(bindingAudience)
	if err != nil {
		return protocol.GatewayMetadata{}, "", err
	}
	fingerprint, err := security.PublicKeyFingerprint(state.Gateway.PublicKey)
	if err != nil {
		return protocol.GatewayMetadata{}, "", err
	}
	return protocol.GatewayMetadata{
		GatewayID:   state.Gateway.GatewayID,
		DisplayName: state.Gateway.DisplayName,
		Status:      protocol.GatewayStatusOnline,
		Capabilities: []protocol.GatewayCapability{
			protocol.GatewayCapabilityEnvCatalog,
			protocol.GatewayCapabilityEnvOpenSession,
		},
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
	if req.ClientNonce == "" || req.ClientPublicKey == "" || req.BindingAudience == "" {
		return protocol.PairingChallengeResponse{}, errors.New("pairing challenge request is incomplete")
	}
	state, err := s.ensureState(req.BindingAudience)
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
	payload, err := security.CanonicalJSON(map[string]any{
		"binding_audience":   req.BindingAudience,
		"client_nonce":       req.ClientNonce,
		"client_public_key":  req.ClientPublicKey,
		"expires_at_unix_ms": expiresAt,
		"gateway_id":         state.Gateway.GatewayID,
		"gateway_nonce":      gatewayNonce,
		"gateway_public_key": state.Gateway.PublicKey,
		"protocol_version":   protocol.Version,
	})
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
	s.pending[gatewayNonce] = pendingChallenge{
		ClientNonce:     req.ClientNonce,
		ClientPublicKey: req.ClientPublicKey,
		BindingAudience: req.BindingAudience,
		ExpiresAtUnixMS: expiresAt,
	}
	s.mu.Unlock()
	return protocol.PairingChallengeResponse{
		ProtocolVersion:             protocol.Version,
		GatewayID:                   state.Gateway.GatewayID,
		GatewayPublicKey:            state.Gateway.PublicKey,
		GatewayPublicKeyFingerprint: fingerprint,
		GatewayNonce:                gatewayNonce,
		ExpiresAtUnixMS:             expiresAt,
		Signature:                   signature,
	}, nil
}

func (s *Store) CompletePairing(req protocol.PairingCompleteRequest) (protocol.PairingCompleteResponse, error) {
	if strings.TrimSpace(req.ProtocolVersion) != protocol.Version {
		return protocol.PairingCompleteResponse{}, errors.New("protocol_version is not supported")
	}
	state, err := s.ensureState(req.BindingAudience)
	if err != nil {
		return protocol.PairingCompleteResponse{}, err
	}
	req.ClientNonce = strings.TrimSpace(req.ClientNonce)
	req.GatewayNonce = strings.TrimSpace(req.GatewayNonce)
	req.GatewayID = strings.TrimSpace(req.GatewayID)
	req.BindingAudience = strings.TrimSpace(req.BindingAudience)
	req.ClientKeyID = strings.TrimSpace(req.ClientKeyID)
	req.Proof = strings.TrimSpace(req.Proof)
	if req.ClientNonce == "" || req.GatewayNonce == "" || req.GatewayID == "" || req.BindingAudience == "" || req.ClientKeyID == "" || req.Proof == "" {
		return protocol.PairingCompleteResponse{}, errors.New("pairing completion request is incomplete")
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
	requestPayload, err := security.CanonicalJSON(map[string]any{
		"binding_audience": req.BindingAudience,
		"client_key_id":    req.ClientKeyID,
		"client_nonce":     req.ClientNonce,
		"gateway_id":       req.GatewayID,
		"gateway_nonce":    req.GatewayNonce,
		"protocol_version": protocol.Version,
	})
	if err != nil {
		return protocol.PairingCompleteResponse{}, err
	}
	if !security.VerifySignature(challenge.ClientPublicKey, requestPayload, req.Proof) {
		return protocol.PairingCompleteResponse{}, errors.New("pairing completion proof is invalid")
	}
	pairedAt := time.Now().UnixMilli()
	if state.Clients == nil {
		state.Clients = map[string]clientKey{}
	}
	state.Clients[req.ClientKeyID] = clientKey{
		ClientKeyID:     req.ClientKeyID,
		ClientPublicKey: challenge.ClientPublicKey,
		BindingAudience: req.BindingAudience,
		PairedAtUnixMS:  pairedAt,
	}
	if err := s.saveState(state); err != nil {
		return protocol.PairingCompleteResponse{}, err
	}
	payload, err := security.CanonicalJSON(map[string]any{
		"binding_audience":  req.BindingAudience,
		"client_key_id":     req.ClientKeyID,
		"client_nonce":      req.ClientNonce,
		"gateway_id":        req.GatewayID,
		"gateway_nonce":     req.GatewayNonce,
		"paired_at_unix_ms": pairedAt,
		"protocol_version":  protocol.Version,
	})
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
		Proof:           proof,
	}, nil
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
	client, ok := state.Clients[strings.TrimSpace(clientKeyID)]
	if !ok {
		return false
	}
	if cleanAudience := strings.TrimSpace(bindingAudience); cleanAudience != "" && client.BindingAudience != cleanAudience {
		return false
	}
	return ok
}

func (s *Store) ClientPublicKey(clientKeyID string, bindingAudience string) (string, bool) {
	state, err := s.ensureState(bindingAudience)
	if err != nil {
		return "", false
	}
	client, ok := state.Clients[strings.TrimSpace(clientKeyID)]
	if !ok {
		return "", false
	}
	if cleanAudience := strings.TrimSpace(bindingAudience); cleanAudience != "" && client.BindingAudience != cleanAudience {
		return "", false
	}
	return client.ClientPublicKey, true
}

func (s *Store) ensureState(bindingAudience string) (fileState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Gateway.GatewayID != "" {
		if err := s.migrateBlankAudienceGatewayIDLocked(bindingAudience); err != nil {
			return fileState{}, err
		}
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
	if err := s.migrateBlankAudienceGatewayIDLocked(bindingAudience); err != nil {
		return fileState{}, err
	}
	return s.state, nil
}

func (s *Store) migrateBlankAudienceGatewayIDLocked(bindingAudience string) error {
	cleanAudience := strings.TrimSpace(bindingAudience)
	if cleanAudience == "" {
		return nil
	}
	expectedGatewayID := security.StableGatewayID(cleanAudience)
	if s.state.Gateway.GatewayID == expectedGatewayID || !isBlankAudienceGatewayID(s.state.Gateway.GatewayID) || len(s.state.Clients) > 0 {
		return nil
	}
	state := s.state
	state.Gateway.GatewayID = expectedGatewayID
	return s.saveStateLocked(state)
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
		return fileState{}, errors.New("Gateway identity is not initialized")
	}
	s.state = state
	return s.state, nil
}

func (s *Store) loadState() (fileState, error) {
	if strings.TrimSpace(s.filePath) == "" {
		return newFileState("")
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
	if state.Clients == nil {
		state.Clients = map[string]clientKey{}
	}
	return state, nil
}

func (s *Store) saveState(state fileState) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saveStateLocked(state)
}

func (s *Store) saveStateLocked(state fileState) error {
	state.SchemaVersion = 1
	if state.Clients == nil {
		state.Clients = map[string]clientKey{}
	}
	s.state = state
	if strings.TrimSpace(s.filePath) == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(s.filePath), 0o700); err != nil {
		return err
	}
	body, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.filePath, append(body, '\n'), 0o600)
}

func newFileState(bindingAudience string) (fileState, error) {
	keyPair, err := security.GenerateKeyPair()
	if err != nil {
		return fileState{}, err
	}
	gatewayID := security.StableGatewayID(bindingAudience)
	return fileState{
		SchemaVersion: 1,
		Gateway: gatewayIdentity{
			GatewayID:   gatewayID,
			DisplayName: "Redeven Runtime Gateway",
			PublicKey:   keyPair.PublicKeyPEM,
			PrivateKey:  keyPair.PrivateKeyPEM,
		},
		Clients: map[string]clientKey{},
	}, nil
}

func isBlankAudienceGatewayID(gatewayID string) bool {
	return strings.TrimSpace(gatewayID) == security.StableGatewayID("")
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
