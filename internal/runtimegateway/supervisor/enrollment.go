package supervisor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/runtimegateway/security"
)

const EnrollmentProtocolVersion = "rcpp-v3"

type EnrollmentProofRequest struct {
	ProtocolVersion          string `json:"protocol_version"`
	ChallengeID              string `json:"challenge_id"`
	ProofNonce               string `json:"proof_nonce"`
	EnvironmentPublicID      string `json:"environment_public_id"`
	ControlBindingGeneration int64  `json:"control_binding_generation"`
	LifecycleTargetID        string `json:"lifecycle_target_id"`
	TargetGeneration         int64  `json:"target_generation"`
	SupervisorInstanceID     string `json:"supervisor_instance_id"`
	SupervisorPublicKey      string `json:"supervisor_public_key"`
	InstallationRootDigest   string `json:"installation_root_digest"`
}

type EnrollmentProofResponse struct {
	ProtocolVersion string `json:"protocol_version"`
	ChallengeID     string `json:"challenge_id"`
	Signature       string `json:"signature"`
}

type EnrollmentProofServer struct {
	listener net.Listener
	path     string
	store    *BindingStore
	envID    string
	once     sync.Once
}

func EnrollmentProofSocketPath(runtimeRoot string) string {
	cleanRoot := filepath.Clean(strings.TrimSpace(runtimeRoot))
	if resolved, err := filepath.EvalSymlinks(cleanRoot); err == nil {
		cleanRoot = filepath.Clean(resolved)
	}
	path := filepath.Join(cleanRoot, "local-environment", "runtime", "gateway-enrollment.sock")
	if len(path) <= 96 {
		return path
	}
	digest := sha256.Sum256([]byte(cleanRoot))
	return filepath.Join(os.TempDir(), "redeven-gateway-enroll-"+hex.EncodeToString(digest[:12])+".sock")
}

func OpenEnrollmentProofServer(store *BindingStore, environmentPublicID string) (*EnrollmentProofServer, error) {
	if store == nil || strings.TrimSpace(environmentPublicID) == "" {
		return nil, errors.New("Runtime enrollment proof server scope is incomplete")
	}
	path := EnrollmentProofSocketPath(store.Binding().RuntimeRoot)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	_ = os.Remove(path)
	listener, err := net.Listen("unix", path)
	if err != nil {
		return nil, err
	}
	if err := os.Chmod(path, 0o600); err != nil {
		_ = listener.Close()
		_ = os.Remove(path)
		return nil, err
	}
	return &EnrollmentProofServer{listener: listener, path: path, store: store, envID: strings.TrimSpace(environmentPublicID)}, nil
}

func (s *EnrollmentProofServer) ServeOnce(ctx context.Context) error {
	if s == nil || s.listener == nil {
		return errors.New("Runtime enrollment proof server is unavailable")
	}
	if deadline, ok := ctx.Deadline(); ok {
		if unix, ok := s.listener.(*net.UnixListener); ok {
			_ = unix.SetDeadline(deadline)
		}
	}
	connection, err := s.listener.Accept()
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return err
	}
	defer connection.Close()
	_ = connection.SetDeadline(time.Now().Add(15 * time.Second))
	decoder := json.NewDecoder(io.LimitReader(connection, 64*1024))
	decoder.DisallowUnknownFields()
	var request EnrollmentProofRequest
	if err := decoder.Decode(&request); err != nil {
		return err
	}
	response, err := s.store.SignEnrollmentProof(s.envID, request)
	if err != nil {
		_ = json.NewEncoder(connection).Encode(map[string]any{"error": err.Error()})
		return err
	}
	return json.NewEncoder(connection).Encode(response)
}

func (s *EnrollmentProofServer) Close() error {
	if s == nil {
		return nil
	}
	var err error
	s.once.Do(func() {
		if s.listener != nil {
			err = s.listener.Close()
		}
		_ = os.Remove(s.path)
	})
	return err
}

func RequestEnrollmentProof(ctx context.Context, socketPath string, request EnrollmentProofRequest) (EnrollmentProofResponse, error) {
	dialer := net.Dialer{}
	connection, err := dialer.DialContext(ctx, "unix", strings.TrimSpace(socketPath))
	if err != nil {
		return EnrollmentProofResponse{}, err
	}
	defer connection.Close()
	if deadline, ok := ctx.Deadline(); ok {
		_ = connection.SetDeadline(deadline)
	}
	if err := json.NewEncoder(connection).Encode(request); err != nil {
		return EnrollmentProofResponse{}, err
	}
	decoder := json.NewDecoder(io.LimitReader(connection, 64*1024))
	decoder.DisallowUnknownFields()
	var response EnrollmentProofResponse
	if err := decoder.Decode(&response); err != nil {
		return EnrollmentProofResponse{}, err
	}
	if response.ProtocolVersion != EnrollmentProtocolVersion || response.ChallengeID != strings.TrimSpace(request.ChallengeID) || strings.TrimSpace(response.Signature) == "" {
		return EnrollmentProofResponse{}, errors.New("Runtime enrollment proof response is invalid")
	}
	return response, nil
}

func (s *BindingStore) SignEnrollmentProof(environmentPublicID string, request EnrollmentProofRequest) (EnrollmentProofResponse, error) {
	if s == nil {
		return EnrollmentProofResponse{}, errors.New("Runtime target binding is unavailable")
	}
	binding := s.Binding()
	if request.ProtocolVersion != EnrollmentProtocolVersion || strings.TrimSpace(request.ChallengeID) == "" ||
		strings.TrimSpace(request.ProofNonce) == "" || strings.TrimSpace(request.EnvironmentPublicID) != strings.TrimSpace(environmentPublicID) ||
		request.ControlBindingGeneration < 0 || strings.TrimSpace(request.LifecycleTargetID) != binding.LifecycleTargetID ||
		request.TargetGeneration != providerEnrollmentTargetGeneration(binding) || strings.TrimSpace(request.SupervisorInstanceID) != binding.SupervisorInstanceID ||
		strings.TrimSpace(request.SupervisorPublicKey) != binding.SupervisorPublicKey ||
		strings.TrimSpace(request.InstallationRootDigest) != binding.InstallationRootDigest {
		return EnrollmentProofResponse{}, errors.New("Runtime enrollment proof scope does not match this supervisor target")
	}
	payload, err := CanonicalEnrollmentProofPayload(request)
	if err != nil {
		return EnrollmentProofResponse{}, err
	}
	signature, err := security.SignPayload(binding.SupervisorPrivateKey, payload)
	if err != nil {
		return EnrollmentProofResponse{}, err
	}
	return EnrollmentProofResponse{ProtocolVersion: EnrollmentProtocolVersion, ChallengeID: request.ChallengeID, Signature: signature}, nil
}

func CanonicalEnrollmentProofPayload(request EnrollmentProofRequest) (string, error) {
	return security.CanonicalJSON(map[string]any{
		"challenge_id": request.ChallengeID, "control_binding_generation": request.ControlBindingGeneration,
		"environment_public_id": request.EnvironmentPublicID, "installation_root_digest": request.InstallationRootDigest,
		"lifecycle_target_id": request.LifecycleTargetID, "proof_nonce": request.ProofNonce,
		"protocol_version": request.ProtocolVersion, "supervisor_instance_id": request.SupervisorInstanceID,
		"supervisor_public_key": request.SupervisorPublicKey, "target_generation": request.TargetGeneration,
	})
}
