package supervisor

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	gatewayprotocol "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimegateway/security"
)

func TestCanonicalEnrollmentProofPayloadMatchesRCPPV3Contract(t *testing.T) {
	payload, err := CanonicalEnrollmentProofPayload(EnrollmentProofRequest{
		ProtocolVersion: EnrollmentProtocolVersion, ChallengeID: "challenge_demo", ProofNonce: "nonce_demo",
		EnvironmentPublicID: "env_demo", ControlBindingGeneration: 7,
		LifecycleTargetID: "target_demo", TargetGeneration: 3,
		SupervisorInstanceID: "supervisor_demo", SupervisorPublicKey: "public-key",
		InstallationRootDigest: strings.Repeat("a", 64),
	})
	if err != nil {
		t.Fatal(err)
	}
	want := `{"challenge_id":"challenge_demo","control_binding_generation":7,"environment_public_id":"env_demo","installation_root_digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","lifecycle_target_id":"target_demo","proof_nonce":"nonce_demo","protocol_version":"rcpp-v3","supervisor_instance_id":"supervisor_demo","supervisor_public_key":"public-key","target_generation":3}`
	if payload != want {
		t.Fatalf("canonical enrollment proof payload = %s, want %s", payload, want)
	}
}

func TestOpenLocalBindingStorePersistsStableCanonicalTarget(t *testing.T) {
	root := t.TempDir()
	stateRoot := filepath.Join(root, "gateway", "state")
	runtimeRoot := filepath.Join(root, "runtime-root")
	if err := os.MkdirAll(runtimeRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(root, "runtime-alias")
	if err := os.Symlink(runtimeRoot, alias); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	first, err := OpenLocalBindingStore(stateRoot, alias)
	if err != nil {
		t.Fatalf("OpenLocalBindingStore(alias) error = %v", err)
	}
	initial := first.Binding()
	canonicalRuntimeRoot, err := filepath.EvalSymlinks(runtimeRoot)
	if err != nil {
		t.Fatal(err)
	}
	if initial.LifecycleTargetID == "" || initial.TargetGeneration != 1 || initial.RuntimeRoot != canonicalRuntimeRoot {
		t.Fatalf("initial binding = %#v", initial)
	}
	if initial.InstallationRootDigest == "" || initial.SupervisorInstanceID == "" || initial.SupervisorPublicKey == "" || initial.SupervisorPrivateKey == "" {
		t.Fatalf("initial supervisor identity = %#v", initial)
	}
	second, err := OpenLocalBindingStore(stateRoot, runtimeRoot)
	if err != nil {
		t.Fatalf("OpenLocalBindingStore(canonical) error = %v", err)
	}
	got := second.Binding()
	if got.LifecycleTargetID != initial.LifecycleTargetID || got.BindingID != initial.BindingID || got.TargetGeneration != initial.TargetGeneration {
		t.Fatalf("binding identity changed across canonical alias: before=%#v after=%#v", initial, got)
	}
	if err := second.Validate(gatewayprotocol.ReservedLocalEnvironmentID, gatewayprotocol.LifecycleTarget{
		LifecycleTargetID: got.LifecycleTargetID, TargetGeneration: got.TargetGeneration,
	}); err != nil {
		t.Fatalf("Validate(exact) error = %v", err)
	}
	if err := second.Validate("env_alias", gatewayprotocol.LifecycleTarget{
		LifecycleTargetID: got.LifecycleTargetID, TargetGeneration: got.TargetGeneration,
	}); err == nil {
		t.Fatal("Validate accepted a Gateway Environment alias")
	}
	if err := second.Validate(gatewayprotocol.ReservedLocalEnvironmentID, gatewayprotocol.LifecycleTarget{
		LifecycleTargetID: got.LifecycleTargetID, TargetGeneration: got.TargetGeneration + 1,
	}); err == nil {
		t.Fatal("Validate accepted a stale target generation")
	}
}

func TestOpenLocalBindingStoreMigratesLegacyLongRuntimeControlSocket(t *testing.T) {
	root := filepath.Join(t.TempDir(), strings.Repeat("long-runtime-root-", 8))
	stateRoot := filepath.Join(root, "gateway-state")
	runtimeRoot := filepath.Join(root, "runtime-root")
	first, err := OpenLocalBindingStore(stateRoot, runtimeRoot)
	if err != nil {
		t.Fatal(err)
	}
	initial := first.Binding()
	legacySocket := filepath.Join(initial.RuntimeRoot, "local-environment", "runtime", "control.sock")
	wantSocket := config.RuntimeControlSocketPathForStateDir(filepath.Join(initial.RuntimeRoot, "local-environment"))
	if wantSocket == legacySocket {
		t.Fatalf("fixture did not require a shortened socket path: %q", legacySocket)
	}

	legacy := initial
	legacy.RuntimeControlSocketPath = legacySocket
	raw, err := json.MarshalIndent(bindingFile{SchemaVersion: bindingSchemaVersion, Binding: legacy}, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stateRoot, "runtime-target-binding-v1.json"), append(raw, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}

	migratedStore, err := OpenLocalBindingStore(stateRoot, runtimeRoot)
	if err != nil {
		t.Fatalf("OpenLocalBindingStore(legacy long socket) error = %v", err)
	}
	migrated := migratedStore.Binding()
	if migrated.RuntimeControlSocketPath != wantSocket {
		t.Fatalf("migrated RuntimeControlSocketPath = %q, want %q", migrated.RuntimeControlSocketPath, wantSocket)
	}
	if migrated.LifecycleTargetID != initial.LifecycleTargetID || migrated.TargetGeneration != initial.TargetGeneration {
		t.Fatalf("socket migration changed target identity: before=%#v after=%#v", initial, migrated)
	}
}

func TestOpenLocalBindingStoreMigratesLegacyRuntimeValidationFromExactManagedSuite(t *testing.T) {
	stateRoot := filepath.Join(t.TempDir(), "gateway-state")
	runtimeRoot := filepath.Join(t.TempDir(), "runtime-root")
	store, err := OpenLocalBindingStore(stateRoot, runtimeRoot)
	if err != nil {
		t.Fatal(err)
	}
	managedBinary := filepath.Join(runtimeRoot, "runtime", "managed", "bin", "redeven")
	writeExecutableFixture(t, managedBinary, []byte("legacy verified Runtime"))
	executableDigest, err := fileSHA256(managedBinary)
	if err != nil {
		t.Fatal(err)
	}
	legacyRaw := writeLegacyBindingWithoutSuiteDigest(t, stateRoot, store.Binding(), executableDigest)

	migrated, err := OpenLocalBindingStore(stateRoot, runtimeRoot)
	if err != nil {
		t.Fatalf("OpenLocalBindingStore(legacy validation) error = %v", err)
	}
	validation := migrated.Binding().ValidatedRuntime
	if validation == nil || !validSHA256(validation.ManagedSuiteSHA256) {
		t.Fatalf("migrated validation = %#v", validation)
	}
	raw, err := os.ReadFile(filepath.Join(stateRoot, "runtime-target-binding-v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) == string(legacyRaw) {
		t.Fatal("legacy binding was not migrated")
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["schema_version"] != float64(2) {
		t.Fatalf("migrated schema_version = %#v, want 2", decoded["schema_version"])
	}
	binding := decoded["binding"].(map[string]any)
	persistedValidation := binding["validated_runtime"].(map[string]any)
	provenance, _ := persistedValidation["installation_provenance"].(map[string]any)
	if provenance["kind"] != "migrated_v1_validation" {
		t.Fatalf("migrated provenance = %#v", provenance)
	}
}

func TestOpenLocalBindingStoreLeavesLegacyBindingUnchangedWhenSuiteCannotBeProven(t *testing.T) {
	stateRoot := filepath.Join(t.TempDir(), "gateway-state")
	runtimeRoot := filepath.Join(t.TempDir(), "runtime-root")
	store, err := OpenLocalBindingStore(stateRoot, runtimeRoot)
	if err != nil {
		t.Fatal(err)
	}
	managedBinRoot := filepath.Join(runtimeRoot, "runtime", "managed", "bin")
	managedBinary := filepath.Join(managedBinRoot, "redeven")
	writeExecutableFixture(t, managedBinary, []byte("legacy verified Runtime"))
	if err := os.WriteFile(filepath.Join(managedBinRoot, "unexpected"), []byte("unreviewed companion"), 0o600); err != nil {
		t.Fatal(err)
	}
	executableDigest, err := fileSHA256(managedBinary)
	if err != nil {
		t.Fatal(err)
	}
	legacyRaw := writeLegacyBindingWithoutSuiteDigest(t, stateRoot, store.Binding(), executableDigest)

	if _, err := OpenLocalBindingStore(stateRoot, runtimeRoot); err == nil {
		t.Fatal("OpenLocalBindingStore migrated a legacy validation with an unsupported managed inventory")
	}
	after, err := os.ReadFile(filepath.Join(stateRoot, "runtime-target-binding-v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(legacyRaw) {
		t.Fatal("failed legacy migration changed the original binding bytes")
	}
}

func TestOpenLocalBindingStoreLeavesLegacyBindingUnchangedWhenManagedModeChanged(t *testing.T) {
	stateRoot := filepath.Join(t.TempDir(), "gateway-state")
	runtimeRoot := filepath.Join(t.TempDir(), "runtime-root")
	store, err := OpenLocalBindingStore(stateRoot, runtimeRoot)
	if err != nil {
		t.Fatal(err)
	}
	managedBinary := filepath.Join(runtimeRoot, "runtime", "managed", "bin", "redeven")
	writeExecutableFixture(t, managedBinary, []byte("legacy verified Runtime"))
	executableDigest, err := fileSHA256(managedBinary)
	if err != nil {
		t.Fatal(err)
	}
	legacyRaw := writeLegacyBindingWithoutSuiteDigest(t, stateRoot, store.Binding(), executableDigest)
	if err := os.Chmod(managedBinary, 0o755); err != nil {
		t.Fatal(err)
	}

	if _, err := OpenLocalBindingStore(stateRoot, runtimeRoot); err == nil {
		t.Fatal("OpenLocalBindingStore migrated a legacy validation after its managed executable mode changed")
	}
	after, err := os.ReadFile(filepath.Join(stateRoot, "runtime-target-binding-v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(legacyRaw) {
		t.Fatal("failed legacy mode migration changed the original binding bytes")
	}
}

func writeLegacyBindingWithoutSuiteDigest(t *testing.T, stateRoot string, binding TargetBinding, executableDigest string) []byte {
	t.Helper()
	binding.ValidatedRuntime = &RuntimeValidation{
		RuntimeInstanceID: "legacy-runtime", RuntimeBinaryVersion: "v1.1.0",
		Platform: runtime.GOOS, Architecture: runtime.GOARCH,
		ServiceProtocol: "redeven-runtime-v2", CompatibilityEpoch: 9,
		Capabilities: []string{"lifecycle_fence_v1"}, ArtifactSHA256: executableDigest,
	}
	raw, err := json.MarshalIndent(bindingFile{SchemaVersion: 1, Binding: binding}, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	raw = append(raw, '\n')
	if err := os.WriteFile(filepath.Join(stateRoot, "runtime-target-binding-v1.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	return raw
}

func completeTestRuntimeValidation(validation RuntimeValidation) RuntimeValidation {
	if validation.ManagedSuiteSHA256 == "" {
		validation.ManagedSuiteSHA256 = "sha256:" + strings.Repeat("b", 64)
	}
	if validation.InstallationProvenance.Kind == "" {
		validation.InstallationProvenance = RuntimeInstallationProvenance{Kind: "migrated_v1_validation"}
	}
	return validation
}

func TestOpenLocalBindingStoreRejectsSecondTargetForSameInstallationRoot(t *testing.T) {
	runtimeRoot := filepath.Join(t.TempDir(), "runtime")
	if _, err := OpenLocalBindingStore(filepath.Join(t.TempDir(), "gateway-a"), runtimeRoot); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenLocalBindingStore(filepath.Join(t.TempDir(), "gateway-b"), runtimeRoot); err == nil {
		t.Fatal("OpenLocalBindingStore accepted a second lifecycle target for one installation root")
	}
}

func TestOpenLocalBindingStoreRejectsCorruptTargetMarker(t *testing.T) {
	runtimeRoot := filepath.Join(t.TempDir(), "runtime")
	if err := os.MkdirAll(runtimeRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(runtimeRoot, targetMarkerFileName), []byte(`{"schema_version":1} trailing`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenLocalBindingStore(filepath.Join(t.TempDir(), "gateway"), runtimeRoot); err == nil {
		t.Fatal("OpenLocalBindingStore accepted a corrupt target marker")
	}
}

func TestOpenLocalBindingStoreConcurrentRegistrationHasSingleWinner(t *testing.T) {
	runtimeRoot := filepath.Join(t.TempDir(), "runtime")
	stateRoots := []string{filepath.Join(t.TempDir(), "gateway-a"), filepath.Join(t.TempDir(), "gateway-b")}
	start := make(chan struct{})
	results := make(chan error, len(stateRoots))
	var group sync.WaitGroup
	for _, stateRoot := range stateRoots {
		stateRoot := stateRoot
		group.Add(1)
		go func() {
			defer group.Done()
			<-start
			_, err := OpenLocalBindingStore(stateRoot, runtimeRoot)
			results <- err
		}()
	}
	close(start)
	group.Wait()
	close(results)
	succeeded := 0
	for err := range results {
		if err == nil {
			succeeded++
		}
	}
	if succeeded != 1 {
		t.Fatalf("concurrent registration successes = %d, want 1", succeeded)
	}
}

func TestOpenLocalBindingStoreRollsBackBindingWhenMarkerCannotBeWritten(t *testing.T) {
	runtimeRoot := filepath.Join(t.TempDir(), "runtime")
	stateRoot := filepath.Join(t.TempDir(), "gateway")
	if err := os.MkdirAll(filepath.Join(runtimeRoot, targetMarkerFileName), 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenLocalBindingStore(stateRoot, runtimeRoot); err == nil {
		t.Fatal("OpenLocalBindingStore succeeded when the target marker path was a directory")
	}
	if _, err := os.Stat(filepath.Join(stateRoot, "runtime-target-binding-v1.json")); !os.IsNotExist(err) {
		t.Fatalf("binding file was not rolled back: %v", err)
	}
}

func TestEnrollmentProofTraversesTargetOwnedLocalSocket(t *testing.T) {
	runtimeRoot := filepath.Join(t.TempDir(), "runtime")
	store, err := OpenLocalBindingStore(filepath.Join(t.TempDir(), "gateway"), runtimeRoot)
	if err != nil {
		t.Fatal(err)
	}
	binding := store.Binding()
	server, err := OpenEnrollmentProofServer(store, "env_demo")
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	served := make(chan error, 1)
	go func() { served <- server.ServeOnce(ctx) }()
	request := EnrollmentProofRequest{
		ProtocolVersion: EnrollmentProtocolVersion, ChallengeID: "challenge_demo", ProofNonce: "nonce_demo",
		EnvironmentPublicID: "env_demo", ControlBindingGeneration: 4,
		LifecycleTargetID: binding.LifecycleTargetID, TargetGeneration: binding.TargetGeneration,
		SupervisorInstanceID: binding.SupervisorInstanceID, SupervisorPublicKey: binding.SupervisorPublicKey,
		InstallationRootDigest: binding.InstallationRootDigest,
	}
	response, err := RequestEnrollmentProof(ctx, EnrollmentProofSocketPath(runtimeRoot), request)
	if err != nil {
		t.Fatal(err)
	}
	if err := <-served; err != nil {
		t.Fatal(err)
	}
	payload, err := CanonicalEnrollmentProofPayload(request)
	if err != nil {
		t.Fatal(err)
	}
	if !security.VerifySignature(binding.SupervisorPublicKey, payload, response.Signature) {
		t.Fatal("enrollment proof signature did not verify")
	}
}

func TestOpenLocalBindingStoreRejectsDifferentRuntimeRoot(t *testing.T) {
	stateRoot := filepath.Join(t.TempDir(), "gateway")
	firstRoot := filepath.Join(t.TempDir(), "runtime-a")
	secondRoot := filepath.Join(t.TempDir(), "runtime-b")
	if _, err := OpenLocalBindingStore(stateRoot, firstRoot); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenLocalBindingStore(stateRoot, secondRoot); err == nil {
		t.Fatal("OpenLocalBindingStore accepted a different Runtime root for an existing target marker")
	}
}
