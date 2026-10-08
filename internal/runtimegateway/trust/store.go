package trust

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/gatewaystate"
	"github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimegateway/security"
	"github.com/floegence/redeven/internal/runtimeservice"
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
	AccessCodeHash  string
	ClientName      string
	HostAdmin       bool
	Completion      *protocol.PairingCompleteResponse
	CompletionProof string
	ExpiresAtUnixMS int64
}

type fileState struct {
	SchemaVersion int                   `json:"schema_version"`
	Gateway       gatewayIdentity       `json:"gateway"`
	Clients       map[string]clientKey  `json:"clients"`
	AccessCodes   map[string]accessCode `json:"access_codes"`
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
	Access             bool   `json:"access"`
	HostManaged        bool   `json:"host_managed,omitempty"`
	ClientName         string `json:"client_name"`
	RevokedAtUnixMS    int64  `json:"revoked_at_unix_ms,omitempty"`
	PairedAtUnixMS     int64  `json:"paired_at_unix_ms"`
	LastVerifiedUnixMS int64  `json:"last_verified_at_unix_ms,omitempty"`
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

type accessCode struct {
	ExpiresAtUnixMS int64  `json:"expires_at_unix_ms"`
	ClientKeyID     string `json:"client_key_id,omitempty"`
}

func accessCodeHash(code string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(code)))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func (s *Store) IssueAccessCode() (protocol.ClientAccessCodeResponse, error) {
	if _, err := s.ensureStateForRead(); err != nil {
		return protocol.ClientAccessCodeResponse{}, err
	}
	code, err := randomB64u(18)
	if err != nil {
		return protocol.ClientAccessCodeResponse{}, err
	}
	expires := time.Now().Add(10 * time.Minute).UnixMilli()
	s.mu.Lock()
	defer s.mu.Unlock()
	next := s.state
	next.AccessCodes = maps.Clone(next.AccessCodes)
	if next.AccessCodes == nil {
		next.AccessCodes = map[string]accessCode{}
	}
	for id, value := range next.AccessCodes {
		if value.ExpiresAtUnixMS <= time.Now().UnixMilli() {
			delete(next.AccessCodes, id)
		}
	}
	if len(next.AccessCodes) >= 128 {
		return protocol.ClientAccessCodeResponse{}, errors.New("too many active access codes")
	}
	next.AccessCodes[accessCodeHash(code)] = accessCode{ExpiresAtUnixMS: expires}
	if err := s.saveStateLocked(next); err != nil {
		return protocol.ClientAccessCodeResponse{}, err
	}
	return protocol.ClientAccessCodeResponse{AccessCode: code, ExpiresAtUnixMS: expires}, nil
}

func (s *Store) PairingChallenge(req protocol.PairingChallengeRequest, hostAdmin bool) (protocol.PairingChallengeResponse, error) {
	if err := protocol.ValidateProtocolVersion(req.ProtocolVersion); err != nil {
		return protocol.PairingChallengeResponse{}, err
	}
	req.ClientNonce = strings.TrimSpace(req.ClientNonce)
	req.ClientPublicKey = strings.TrimSpace(req.ClientPublicKey)
	req.BindingAudience = strings.TrimSpace(req.BindingAudience)
	req.ClientName = strings.TrimSpace(req.ClientName)
	if req.ClientNonce == "" || req.BindingAudience == "" || len(req.ClientName) > 160 || len(req.AccessCode) > 128 {
		return protocol.PairingChallengeResponse{}, errors.New("pairing challenge request is incomplete")
	}
	if _, err := security.PublicKeyFingerprint(req.ClientPublicKey); err != nil {
		return protocol.PairingChallengeResponse{}, err
	}
	state, err := s.ensureStateForPairing(req.BindingAudience)
	if err != nil {
		return protocol.PairingChallengeResponse{}, err
	}
	gatewayNonce, err := randomB64u(24)
	if err != nil {
		return protocol.PairingChallengeResponse{}, err
	}
	fingerprint, err := security.PublicKeyFingerprint(state.Gateway.PublicKey)
	if err != nil {
		return protocol.PairingChallengeResponse{}, err
	}
	epoch := runtimeservice.CurrentCompatibilityContract().CompatibilityEpoch
	expires := time.Now().Add(challengeTTL).UnixMilli()
	fields := map[string]any{"binding_audience": req.BindingAudience, "client_nonce": req.ClientNonce, "client_public_key": req.ClientPublicKey, "expires_at_unix_ms": expires, "gateway_id": state.Gateway.GatewayID, "gateway_nonce": gatewayNonce, "gateway_public_key": state.Gateway.PublicKey, "protocol_version": protocol.Version, "compatibility_epoch": epoch}
	payload, err := security.CanonicalJSON(fields)
	if err != nil {
		return protocol.PairingChallengeResponse{}, err
	}
	signature, err := security.SignPayload(state.Gateway.PrivateKey, payload)
	if err != nil {
		return protocol.PairingChallengeResponse{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	codeHash := accessCodeHash(req.AccessCode)
	if !hostAdmin {
		if err := s.checkAccessCodeLocked(codeHash, security.ClientKeyID(req.ClientPublicKey)); err != nil {
			return protocol.PairingChallengeResponse{}, err
		}
	}
	if s.pending == nil {
		s.pending = map[string]pendingChallenge{}
	}
	for id, pending := range s.pending {
		if pending.ExpiresAtUnixMS <= time.Now().UnixMilli() {
			delete(s.pending, id)
		}
	}
	if len(s.pending) >= 128 {
		return protocol.PairingChallengeResponse{}, errors.New("too many pending pairings")
	}
	s.pending[gatewayNonce] = pendingChallenge{ClientNonce: req.ClientNonce, ClientPublicKey: req.ClientPublicKey, BindingAudience: req.BindingAudience, AccessCodeHash: codeHash, ClientName: req.ClientName, HostAdmin: hostAdmin, ExpiresAtUnixMS: expires}
	return protocol.PairingChallengeResponse{ProtocolVersion: protocol.Version, GatewayID: state.Gateway.GatewayID, GatewayPublicKey: state.Gateway.PublicKey, GatewayPublicKeyFingerprint: fingerprint, GatewayNonce: gatewayNonce, CompatibilityEpoch: epoch, ExpiresAtUnixMS: expires, Signature: signature}, nil
}

func (s *Store) checkAccessCodeLocked(hash, clientKeyID string) error {
	code, ok := s.state.AccessCodes[hash]
	if !ok || code.ExpiresAtUnixMS <= time.Now().UnixMilli() {
		return errors.New("ACCESS_CODE_INVALID_OR_EXPIRED")
	}
	if code.ClientKeyID != "" && code.ClientKeyID != clientKeyID {
		return errors.New("ACCESS_CODE_USED")
	}
	if code.ClientKeyID != "" && !s.state.Clients[clientKeyID].Access {
		return errors.New("CLIENT_ACCESS_REVOKED")
	}
	return nil
}

func (s *Store) CompletePairing(req protocol.PairingCompleteRequest, hostAdmin bool) (protocol.PairingCompleteResponse, error) {
	if err := protocol.ValidatePairingCompleteRequest(req); err != nil {
		return protocol.PairingCompleteResponse{}, err
	}
	req = protocol.NormalizePairingCompleteRequest(req)
	if req.Proof == "" {
		return protocol.PairingCompleteResponse{}, errors.New("pairing proof is required")
	}
	if _, err := s.ensureStateForRead(); err != nil {
		return protocol.PairingCompleteResponse{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	challenge, ok := s.pending[req.GatewayNonce]
	if !ok || challenge.ClientNonce != req.ClientNonce || challenge.BindingAudience != req.BindingAudience || req.GatewayID != s.state.Gateway.GatewayID || security.ClientKeyID(challenge.ClientPublicKey) != req.ClientKeyID || (challenge.HostAdmin && !hostAdmin) {
		return protocol.PairingCompleteResponse{}, errors.New("pairing challenge is invalid")
	}
	if challenge.Completion != nil {
		if challenge.CompletionProof != req.Proof || !s.state.Clients[req.ClientKeyID].Access {
			return protocol.PairingCompleteResponse{}, errors.New("CLIENT_ACCESS_REVOKED")
		}
		return *challenge.Completion, nil
	}
	if challenge.ExpiresAtUnixMS <= time.Now().UnixMilli() {
		return protocol.PairingCompleteResponse{}, errors.New("pairing challenge expired")
	}
	fields := map[string]any{"binding_audience": req.BindingAudience, "client_key_id": req.ClientKeyID, "client_nonce": req.ClientNonce, "gateway_id": req.GatewayID, "gateway_nonce": req.GatewayNonce, "protocol_version": protocol.Version}
	payload, err := security.CanonicalJSON(fields)
	if err != nil || !security.VerifySignature(challenge.ClientPublicKey, payload, req.Proof) {
		return protocol.PairingCompleteResponse{}, errors.New("pairing completion proof is invalid")
	}
	if !challenge.HostAdmin {
		if err := s.checkAccessCodeLocked(challenge.AccessCodeHash, req.ClientKeyID); err != nil {
			return protocol.PairingCompleteResponse{}, err
		}
	}
	pairedAt := time.Now().UnixMilli()
	previous, exists := s.state.Clients[req.ClientKeyID]
	if exists && previous.Access {
		pairedAt = previous.PairedAtUnixMS
	}
	permissions := protocol.GatewayPermissions{Access: true}
	fields["paired_at_unix_ms"] = pairedAt
	fields["permissions"] = permissions
	payload, err = security.CanonicalJSON(fields)
	if err != nil {
		return protocol.PairingCompleteResponse{}, err
	}
	proof, err := security.SignPayload(s.state.Gateway.PrivateKey, payload)
	if err != nil {
		return protocol.PairingCompleteResponse{}, err
	}
	next := s.state
	next.Clients = maps.Clone(next.Clients)
	next.AccessCodes = maps.Clone(next.AccessCodes)
	next.Clients[req.ClientKeyID] = clientKey{ClientKeyID: req.ClientKeyID, ClientPublicKey: challenge.ClientPublicKey, BindingAudience: req.BindingAudience, Access: true, HostManaged: challenge.HostAdmin, ClientName: challenge.ClientName, PairedAtUnixMS: pairedAt, LastVerifiedUnixMS: previous.LastVerifiedUnixMS}
	if !challenge.HostAdmin {
		code := next.AccessCodes[challenge.AccessCodeHash]
		code.ClientKeyID = req.ClientKeyID
		next.AccessCodes[challenge.AccessCodeHash] = code
	}
	if err := s.saveStateLocked(next); err != nil {
		return protocol.PairingCompleteResponse{}, err
	}
	response := protocol.PairingCompleteResponse{ProtocolVersion: protocol.Version, GatewayID: req.GatewayID, ClientKeyID: req.ClientKeyID, PairedAtUnixMS: pairedAt, Permissions: permissions, Proof: proof}
	challenge.Completion = &response
	challenge.CompletionProof = req.Proof
	s.pending[req.GatewayNonce] = challenge
	return response, nil
}

func (s *Store) ListClients() ([]protocol.GatewayClientRecord, error) {
	state, err := s.ensureStateForRead()
	if err != nil {
		return nil, err
	}
	result := make([]protocol.GatewayClientRecord, 0, len(state.Clients))
	for _, client := range state.Clients {
		if client.HostManaged {
			continue
		}
		result = append(result, protocol.GatewayClientRecord{ClientKeyID: client.ClientKeyID, ClientName: client.ClientName, PairedAtUnixMS: client.PairedAtUnixMS, LastVerifiedUnixMS: client.LastVerifiedUnixMS, RevokedAtUnixMS: client.RevokedAtUnixMS})
	}
	sort.Slice(result, func(first, second int) bool { return result[first].PairedAtUnixMS > result[second].PairedAtUnixMS })
	return result, nil
}

func (s *Store) RevokeClient(clientKeyID string) error {
	if _, err := s.ensureStateForRead(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	client, ok := s.state.Clients[strings.TrimSpace(clientKeyID)]
	if !ok {
		return errors.New("client is unknown")
	}
	if client.HostManaged {
		return errors.New("HOST_CONNECTION_MANAGED_ON_HOST")
	}
	if client.RevokedAtUnixMS != 0 {
		return nil
	}
	client.Access = false
	client.RevokedAtUnixMS = time.Now().UnixMilli()
	next := s.state
	next.Clients = maps.Clone(next.Clients)
	next.Clients[client.ClientKeyID] = client
	return s.saveStateLocked(next)
}

func (s *Store) RecordVerified(clientKeyID string, hostAdmin bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	client, ok := s.state.Clients[clientKeyID]
	if !ok || !client.Access {
		return errors.New("CLIENT_ACCESS_REVOKED")
	}
	now := time.Now().UnixMilli()
	if now-client.LastVerifiedUnixMS < 60_000 && (!hostAdmin || client.HostManaged) {
		return nil
	}
	client.LastVerifiedUnixMS = now
	client.HostManaged = client.HostManaged || hostAdmin
	next := s.state
	next.Clients = maps.Clone(next.Clients)
	next.Clients[clientKeyID] = client
	return s.saveStateLocked(next)
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
	if !ok || !client.Access || client.RevokedAtUnixMS != 0 {
		return "", false
	}
	return client.ClientPublicKey, true
}

func (s *Store) ClientPermissions(clientKeyID string) protocol.GatewayPermissions {
	state, err := s.ensureStateForRead()
	if err != nil {
		return protocol.GatewayPermissions{}
	}
	client := state.Clients[strings.TrimSpace(clientKeyID)]
	return protocol.GatewayPermissions{Access: client.Access && client.RevokedAtUnixMS == 0}
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
	if state.SchemaVersion == 1 || state.SchemaVersion == 2 {
		var legacy struct {
			Clients map[string]struct {
				Permissions protocol.GatewayPermissions `json:"permissions"`
			} `json:"clients"`
		}
		if err := json.Unmarshal(raw, &legacy); err != nil {
			return fileState{}, err
		}
		for id, client := range state.Clients {
			client.Access = state.SchemaVersion == 1 || legacy.Clients[id].Permissions.Access
			if !client.Access && client.RevokedAtUnixMS == 0 {
				client.RevokedAtUnixMS = max(int64(1), client.PairedAtUnixMS)
			}
			state.Clients[id] = client
		}
		state.SchemaVersion = 3
		if err := s.persistState(state); err != nil {
			return fileState{}, err
		}
	} else if state.SchemaVersion != 3 {
		return fileState{}, errors.New("unsupported Gateway trust schema")
	}
	if state.Clients == nil {
		state.Clients = map[string]clientKey{}
	}
	return state, nil
}

func (s *Store) saveStateLocked(state fileState) error {
	state.SchemaVersion = 3
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
		SchemaVersion: 3,
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
