package supervisor

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/user"
	"path/filepath"
	"strings"
	"sync"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/lockfile"
	gatewayprotocol "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimegateway/security"
)

const bindingSchemaVersion = 1

const targetMarkerFileName = ".redeven-runtime-lifecycle-target-v1.json"

type PermitVerificationKey struct {
	KeyID     string `json:"key_id"`
	Algorithm string `json:"algorithm"`
	PublicKey string `json:"public_key"`
}

type RuntimeValidation struct {
	RuntimeInstanceID    string   `json:"runtime_instance_id"`
	RuntimeBinaryVersion string   `json:"runtime_binary_version"`
	Platform             string   `json:"platform"`
	Architecture         string   `json:"architecture"`
	ServiceProtocol      string   `json:"service_protocol"`
	CompatibilityEpoch   int      `json:"compatibility_epoch"`
	Capabilities         []string `json:"capabilities"`
	ArtifactSHA256       string   `json:"artifact_sha256"`
}

type TargetBinding struct {
	BindingID                string                `json:"binding_id"`
	GatewayEnvID             string                `json:"gateway_env_id"`
	LifecycleTargetID        string                `json:"lifecycle_target_id"`
	TargetGeneration         int64                 `json:"target_generation"`
	OSPrincipal              string                `json:"os_principal"`
	RuntimeRoot              string                `json:"runtime_root"`
	RuntimeControlSocketPath string                `json:"runtime_control_socket_path"`
	InstallationRootDigest   string                `json:"installation_root_digest"`
	SupervisorInstanceID     string                `json:"supervisor_instance_id"`
	SupervisorPublicKey      string                `json:"supervisor_public_key"`
	SupervisorPrivateKey     string                `json:"supervisor_private_key"`
	ProviderOrigin           string                `json:"provider_origin,omitempty"`
	AccessPointID            string                `json:"access_point_id,omitempty"`
	AccessPointOrigin        string                `json:"access_point_origin,omitempty"`
	EnvironmentPublicID      string                `json:"environment_public_id,omitempty"`
	PermitVerificationKey    PermitVerificationKey `json:"permit_verification_key,omitempty"`
	ValidatedRuntime         *RuntimeValidation    `json:"validated_runtime,omitempty"`
}

type targetMarker struct {
	SchemaVersion          int    `json:"schema_version"`
	LifecycleTargetID      string `json:"lifecycle_target_id"`
	OSPrincipal            string `json:"os_principal"`
	InstallationRootDigest string `json:"installation_root_digest"`
}

type bindingFile struct {
	SchemaVersion int           `json:"schema_version"`
	Binding       TargetBinding `json:"binding"`
}

type BindingStore struct {
	mu       sync.Mutex
	filePath string
	binding  TargetBinding
}

func OpenLocalBindingStore(stateRoot string, runtimeRoot string) (*BindingStore, error) {
	stateRoot, err := canonicalRoot(stateRoot)
	if err != nil {
		return nil, fmt.Errorf("resolve Gateway state root: %w", err)
	}
	runtimeRoot, err = canonicalRoot(runtimeRoot)
	if err != nil {
		return nil, fmt.Errorf("resolve Runtime root: %w", err)
	}
	if err := os.MkdirAll(stateRoot, 0o700); err != nil {
		return nil, fmt.Errorf("create Gateway state root: %w", err)
	}
	if err := os.MkdirAll(runtimeRoot, 0o700); err != nil {
		return nil, fmt.Errorf("create Runtime root: %w", err)
	}
	releaseTargetLock, err := acquireTargetRegistrationLock(runtimeRoot)
	if err != nil {
		return nil, err
	}
	defer releaseTargetLock()
	store := &BindingStore{filePath: filepath.Join(stateRoot, "runtime-target-binding-v1.json")}
	if err := store.loadLocked(); err != nil {
		return nil, err
	}
	principal, err := currentOSPrincipal()
	if err != nil {
		return nil, err
	}
	runtimeStateDir := filepath.Join(runtimeRoot, "local-environment")
	legacyControlSocket := filepath.Join(runtimeStateDir, "runtime", "control.sock")
	controlSocket := config.RuntimeControlSocketPathForStateDir(runtimeStateDir)
	if store.binding.LifecycleTargetID == "" {
		targetID, err := randomID("rlt_")
		if err != nil {
			return nil, err
		}
		bindingID, err := randomID("rmb_")
		if err != nil {
			return nil, err
		}
		supervisorInstanceID, err := randomID("rsi_")
		if err != nil {
			return nil, err
		}
		supervisorKeys, err := security.GenerateKeyPair()
		if err != nil {
			return nil, err
		}
		store.binding = TargetBinding{
			BindingID: bindingID, GatewayEnvID: gatewayprotocol.ReservedLocalEnvironmentID,
			LifecycleTargetID: targetID, TargetGeneration: 1, OSPrincipal: principal,
			RuntimeRoot: runtimeRoot, RuntimeControlSocketPath: controlSocket,
			InstallationRootDigest: installationRootDigest(runtimeRoot),
			SupervisorInstanceID:   supervisorInstanceID, SupervisorPublicKey: supervisorKeys.PublicKeyPEM,
			SupervisorPrivateKey: supervisorKeys.PrivateKeyPEM,
		}
		if err := validateTargetMarker(runtimeRoot, store.binding); err != nil {
			return nil, err
		}
		if err := store.saveLocked(store.binding); err != nil {
			return nil, err
		}
		if err := ensureTargetMarker(runtimeRoot, store.binding); err != nil {
			_ = os.Remove(store.filePath)
			return nil, err
		}
		return store, nil
	}
	if store.binding.RuntimeControlSocketPath == legacyControlSocket && controlSocket != legacyControlSocket &&
		store.binding.GatewayEnvID == gatewayprotocol.ReservedLocalEnvironmentID && store.binding.TargetGeneration > 0 &&
		store.binding.OSPrincipal == principal && store.binding.RuntimeRoot == runtimeRoot &&
		store.binding.InstallationRootDigest == installationRootDigest(runtimeRoot) {
		next := cloneBinding(store.binding)
		next.RuntimeControlSocketPath = controlSocket
		if err := store.saveLocked(next); err != nil {
			return nil, fmt.Errorf("migrate Runtime target control socket: %w", err)
		}
	}
	if store.binding.GatewayEnvID != gatewayprotocol.ReservedLocalEnvironmentID || store.binding.TargetGeneration <= 0 ||
		store.binding.OSPrincipal != principal || store.binding.RuntimeRoot != runtimeRoot ||
		store.binding.RuntimeControlSocketPath != controlSocket ||
		store.binding.InstallationRootDigest != installationRootDigest(runtimeRoot) {
		return nil, errors.New("Runtime target binding does not match the current OS principal and canonical Runtime root")
	}
	if err := ensureTargetMarker(runtimeRoot, store.binding); err != nil {
		return nil, err
	}
	return store, nil
}

func (s *BindingStore) Binding() TargetBinding {
	if s == nil {
		return TargetBinding{}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return cloneBinding(s.binding)
}

func (s *BindingStore) Validate(gatewayEnvID string, target gatewayprotocol.LifecycleTarget) error {
	if s == nil {
		return errors.New("Runtime target binding is unavailable")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if strings.TrimSpace(gatewayEnvID) != s.binding.GatewayEnvID ||
		strings.TrimSpace(target.LifecycleTargetID) != s.binding.LifecycleTargetID ||
		target.TargetGeneration != s.binding.TargetGeneration {
		return errors.New("Runtime lifecycle target or generation changed")
	}
	return nil
}

func (s *BindingStore) RecordRuntimeValidation(validation RuntimeValidation) error {
	if s == nil {
		return errors.New("Runtime target binding is unavailable")
	}
	validation = normalizeRuntimeValidation(validation)
	if validation.RuntimeInstanceID == "" || validation.Platform == "" || validation.Architecture == "" || validation.ServiceProtocol == "" || validation.CompatibilityEpoch <= 0 ||
		validation.ArtifactSHA256 == "" || len(validation.Capabilities) == 0 {
		return errors.New("Runtime validation facts are incomplete")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	mutationLock, err := lockfile.Acquire(s.filePath + ".lock")
	if err != nil {
		return fmt.Errorf("lock Runtime target binding: %w", err)
	}
	defer func() { _ = mutationLock.Release() }()
	if err := s.loadLocked(); err != nil {
		return err
	}
	next := cloneBinding(s.binding)
	next.ValidatedRuntime = &validation
	return s.saveLocked(next)
}

func (s *BindingStore) ConfigureProvider(bindingID string, providerOrigin string, accessPointID string, accessPointOrigin string, environmentPublicID string, key PermitVerificationKey, targetGeneration int64) error {
	if s == nil {
		return errors.New("Runtime target binding is unavailable")
	}
	bindingID = strings.TrimSpace(bindingID)
	providerOrigin = strings.TrimSpace(providerOrigin)
	accessPointID = strings.TrimSpace(accessPointID)
	accessPointOrigin = strings.TrimSpace(accessPointOrigin)
	environmentPublicID = strings.TrimSpace(environmentPublicID)
	key.KeyID = strings.TrimSpace(key.KeyID)
	key.Algorithm = strings.TrimSpace(key.Algorithm)
	key.PublicKey = strings.TrimSpace(key.PublicKey)
	if bindingID == "" || providerOrigin == "" || accessPointID == "" || accessPointOrigin == "" || environmentPublicID == "" ||
		key.KeyID == "" || key.Algorithm != "EdDSA" || key.PublicKey == "" {
		return errors.New("Provider Runtime binding is incomplete")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	mutationLock, err := lockfile.Acquire(s.filePath + ".lock")
	if err != nil {
		return fmt.Errorf("lock Runtime target binding: %w", err)
	}
	defer func() { _ = mutationLock.Release() }()
	if err := s.loadLocked(); err != nil {
		return err
	}
	expectedGeneration := providerEnrollmentTargetGeneration(s.binding)
	if targetGeneration != expectedGeneration {
		return errors.New("Runtime target generation changed")
	}
	next := cloneBinding(s.binding)
	next.TargetGeneration = targetGeneration
	next.BindingID = bindingID
	next.ProviderOrigin = providerOrigin
	next.AccessPointID = accessPointID
	next.AccessPointOrigin = accessPointOrigin
	next.EnvironmentPublicID = environmentPublicID
	next.PermitVerificationKey = key
	return s.saveLocked(next)
}

func (s *BindingStore) Reload() error {
	if s == nil {
		return errors.New("Runtime target binding is unavailable")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loadLocked()
}

func (s *BindingStore) loadLocked() error {
	raw, err := os.ReadFile(s.filePath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read Runtime target binding: %w", err)
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	var state bindingFile
	if err := decoder.Decode(&state); err != nil {
		return fmt.Errorf("parse Runtime target binding: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("Runtime target binding contains trailing data")
	}
	if state.SchemaVersion != bindingSchemaVersion {
		return fmt.Errorf("Runtime target binding schema_version=%d is unsupported", state.SchemaVersion)
	}
	state.Binding = normalizeBinding(state.Binding)
	if err := validateBinding(state.Binding); err != nil {
		return err
	}
	s.binding = state.Binding
	return nil
}

func (s *BindingStore) saveLocked(next TargetBinding) error {
	next = normalizeBinding(next)
	if err := validateBinding(next); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(bindingFile{SchemaVersion: bindingSchemaVersion, Binding: next}, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	temporaryPath := s.filePath + ".tmp"
	if err := os.WriteFile(temporaryPath, raw, 0o600); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, s.filePath); err != nil {
		return err
	}
	s.binding = next
	return nil
}

func normalizeBinding(binding TargetBinding) TargetBinding {
	binding.BindingID = strings.TrimSpace(binding.BindingID)
	binding.GatewayEnvID = strings.TrimSpace(binding.GatewayEnvID)
	binding.LifecycleTargetID = strings.TrimSpace(binding.LifecycleTargetID)
	binding.OSPrincipal = strings.TrimSpace(binding.OSPrincipal)
	binding.RuntimeRoot = filepath.Clean(strings.TrimSpace(binding.RuntimeRoot))
	binding.RuntimeControlSocketPath = filepath.Clean(strings.TrimSpace(binding.RuntimeControlSocketPath))
	binding.InstallationRootDigest = strings.ToLower(strings.TrimSpace(binding.InstallationRootDigest))
	binding.SupervisorInstanceID = strings.TrimSpace(binding.SupervisorInstanceID)
	binding.SupervisorPublicKey = strings.TrimSpace(binding.SupervisorPublicKey)
	binding.SupervisorPrivateKey = strings.TrimSpace(binding.SupervisorPrivateKey)
	binding.ProviderOrigin = strings.TrimSpace(binding.ProviderOrigin)
	binding.AccessPointID = strings.TrimSpace(binding.AccessPointID)
	binding.AccessPointOrigin = strings.TrimSpace(binding.AccessPointOrigin)
	binding.EnvironmentPublicID = strings.TrimSpace(binding.EnvironmentPublicID)
	binding.PermitVerificationKey.KeyID = strings.TrimSpace(binding.PermitVerificationKey.KeyID)
	binding.PermitVerificationKey.Algorithm = strings.TrimSpace(binding.PermitVerificationKey.Algorithm)
	binding.PermitVerificationKey.PublicKey = strings.TrimSpace(binding.PermitVerificationKey.PublicKey)
	if binding.ValidatedRuntime != nil {
		value := normalizeRuntimeValidation(*binding.ValidatedRuntime)
		binding.ValidatedRuntime = &value
	}
	return binding
}

func validateBinding(binding TargetBinding) error {
	if binding.BindingID == "" || binding.GatewayEnvID == "" || binding.LifecycleTargetID == "" || binding.TargetGeneration <= 0 ||
		binding.OSPrincipal == "" || !filepath.IsAbs(binding.RuntimeRoot) || !filepath.IsAbs(binding.RuntimeControlSocketPath) ||
		len(binding.InstallationRootDigest) != sha256.Size*2 || binding.SupervisorInstanceID == "" ||
		binding.SupervisorPublicKey == "" || binding.SupervisorPrivateKey == "" {
		return errors.New("Runtime target binding shape is incomplete")
	}
	signature, err := security.SignPayload(binding.SupervisorPrivateKey, "redeven-supervisor-key-validation-v1")
	if err != nil || !security.VerifySignature(binding.SupervisorPublicKey, "redeven-supervisor-key-validation-v1", signature) {
		return errors.New("Runtime supervisor identity key pair is invalid")
	}
	providerConfigured := binding.ProviderOrigin != "" || binding.AccessPointID != "" || binding.AccessPointOrigin != "" ||
		binding.EnvironmentPublicID != "" || binding.PermitVerificationKey.KeyID != "" || binding.PermitVerificationKey.PublicKey != ""
	if providerConfigured && (binding.ProviderOrigin == "" || binding.AccessPointID == "" || binding.AccessPointOrigin == "" ||
		binding.EnvironmentPublicID == "" || binding.PermitVerificationKey.KeyID == "" ||
		binding.PermitVerificationKey.Algorithm != "EdDSA" || binding.PermitVerificationKey.PublicKey == "") {
		return errors.New("Provider Runtime binding shape is incomplete")
	}
	return nil
}

func installationRootDigest(runtimeRoot string) string {
	sum := sha256.Sum256([]byte("redeven-runtime-installation-root-v1\x00" + filepath.Clean(runtimeRoot)))
	return hex.EncodeToString(sum[:])
}

func ensureTargetMarker(runtimeRoot string, binding TargetBinding) error {
	path := filepath.Join(runtimeRoot, targetMarkerFileName)
	expected := targetMarker{
		SchemaVersion: 1, LifecycleTargetID: binding.LifecycleTargetID,
		OSPrincipal: binding.OSPrincipal, InstallationRootDigest: binding.InstallationRootDigest,
	}
	raw, err := os.ReadFile(path)
	if err == nil {
		current, decodeErr := decodeTargetMarker(raw)
		if decodeErr != nil || current != expected {
			return errors.New("Runtime installation root is already registered to a different lifecycle target")
		}
		return nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.MkdirAll(runtimeRoot, 0o700); err != nil {
		return err
	}
	body, err := json.MarshalIndent(expected, "", "  ")
	if err != nil {
		return err
	}
	temporaryPath := path + ".tmp"
	if err := os.WriteFile(temporaryPath, append(body, '\n'), 0o600); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return err
	}
	return nil
}

func validateTargetMarker(runtimeRoot string, binding TargetBinding) error {
	path := filepath.Join(runtimeRoot, targetMarkerFileName)
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	current, err := decodeTargetMarker(raw)
	if err != nil {
		return errors.New("Runtime installation root target marker is invalid")
	}
	expected := targetMarker{
		SchemaVersion: 1, LifecycleTargetID: binding.LifecycleTargetID,
		OSPrincipal: binding.OSPrincipal, InstallationRootDigest: binding.InstallationRootDigest,
	}
	if current != expected {
		return errors.New("Runtime installation root is already registered to a different lifecycle target")
	}
	return nil
}

func decodeTargetMarker(raw []byte) (targetMarker, error) {
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	var marker targetMarker
	if err := decoder.Decode(&marker); err != nil {
		return targetMarker{}, err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return targetMarker{}, errors.New("Runtime installation root target marker contains trailing data")
	}
	return marker, nil
}

func acquireTargetRegistrationLock(runtimeRoot string) (func(), error) {
	path := filepath.Join(runtimeRoot, ".redeven-runtime-lifecycle-target.lock")
	lock, err := lockfile.Acquire(path)
	if err != nil {
		if errors.Is(err, lockfile.ErrAlreadyLocked) {
			return nil, errors.New("Runtime installation root registration is already in progress")
		}
		return nil, err
	}
	return func() { _ = lock.Release() }, nil
}

func normalizeRuntimeValidation(validation RuntimeValidation) RuntimeValidation {
	validation.RuntimeInstanceID = strings.TrimSpace(validation.RuntimeInstanceID)
	validation.RuntimeBinaryVersion = strings.TrimSpace(validation.RuntimeBinaryVersion)
	validation.Platform = strings.ToLower(strings.TrimSpace(validation.Platform))
	validation.Architecture = strings.ToLower(strings.TrimSpace(validation.Architecture))
	validation.ServiceProtocol = strings.TrimSpace(validation.ServiceProtocol)
	validation.ArtifactSHA256 = strings.ToLower(strings.TrimSpace(validation.ArtifactSHA256))
	validation.Capabilities = compactSorted(validation.Capabilities)
	return validation
}

func cloneBinding(binding TargetBinding) TargetBinding {
	binding.PermitVerificationKey = PermitVerificationKey{
		KeyID: binding.PermitVerificationKey.KeyID, Algorithm: binding.PermitVerificationKey.Algorithm, PublicKey: binding.PermitVerificationKey.PublicKey,
	}
	if binding.ValidatedRuntime != nil {
		validation := *binding.ValidatedRuntime
		validation.Capabilities = append([]string(nil), validation.Capabilities...)
		binding.ValidatedRuntime = &validation
	}
	return binding
}

func canonicalRoot(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", errors.New("path is required")
	}
	absolute, err := filepath.Abs(value)
	if err != nil {
		return "", err
	}
	absolute = filepath.Clean(absolute)
	// Create before resolving so a first open and later process observe the same
	// canonical path even when an ancestor such as /var resolves through a symlink.
	if err := os.MkdirAll(absolute, 0o700); err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return "", err
	}
	return filepath.Clean(resolved), nil
}

func currentOSPrincipal() (string, error) {
	current, err := user.Current()
	if err != nil {
		return "", fmt.Errorf("resolve current OS principal: %w", err)
	}
	principal := strings.TrimSpace(current.Uid) + ":" + strings.TrimSpace(current.Gid) + ":" + strings.TrimSpace(current.Username)
	if principal == "::" {
		return "", errors.New("current OS principal is empty")
	}
	return principal, nil
}

func randomID(prefix string) (string, error) {
	raw := make([]byte, 18)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return prefix + base64.RawURLEncoding.EncodeToString(raw), nil
}

func compactSorted(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	slicesSort(out)
	return out
}

func slicesSort(values []string) {
	for i := 1; i < len(values); i++ {
		for j := i; j > 0 && values[j] < values[j-1]; j-- {
			values[j], values[j-1] = values[j-1], values[j]
		}
	}
}
