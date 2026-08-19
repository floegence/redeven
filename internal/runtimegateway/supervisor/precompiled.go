package supervisor

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	gatewayprotocol "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

const (
	precompiledStartupOperationID     = "desktop-precompiled-runtime-startup"
	precompiledConvergenceOperationID = "desktop-precompiled-runtime-convergence"
)

type precompiledArtifact struct {
	Path       string `json:"path"`
	SHA256     string `json:"sha256"`
	SizeBytes  int64  `json:"size_bytes"`
	Executable bool   `json:"executable"`
}

type precompiledManifest struct {
	SchemaVersion      int                   `json:"schema_version"`
	Version            string                `json:"version"`
	Commit             string                `json:"commit"`
	Platform           string                `json:"platform"`
	Architecture       string                `json:"architecture"`
	Provenance         string                `json:"provenance"`
	Gateway            precompiledArtifact   `json:"gateway"`
	RuntimeSuite       []precompiledArtifact `json:"runtime_suite"`
	RuntimeSuiteSHA256 string                `json:"runtime_suite_sha256"`
}

type verifiedPrecompiledFile struct {
	artifact precompiledArtifact
	bytes    []byte
}

type verifiedPrecompiledRuntime struct {
	Version       string
	Commit        string
	Platform      string
	Architecture  string
	RuntimeSHA256 string
	SuiteSHA256   string
	Provenance    RuntimeInstallationProvenance
	files         []verifiedPrecompiledFile
}

type managedRuntimeSuiteEntry struct {
	Name       string `json:"name"`
	SHA256     string `json:"sha256"`
	SizeBytes  int    `json:"size_bytes"`
	Executable bool   `json:"executable"`
}

type precompiledRuntimeTargetAction string

const (
	precompiledTargetExact    precompiledRuntimeTargetAction = "exact"
	precompiledTargetPreserve precompiledRuntimeTargetAction = "preserve_verified_update"
	precompiledTargetInstall  precompiledRuntimeTargetAction = "install"
	precompiledTargetReplace  precompiledRuntimeTargetAction = "replace"
)

type precompiledRuntimeTarget struct {
	Action  precompiledRuntimeTargetAction
	Runtime verifiedPrecompiledRuntime
}

type PrecompiledRuntimeConvergenceError struct {
	Code     string
	Reason   string
	Recovery string
}

func (e *PrecompiledRuntimeConvergenceError) Error() string {
	if e == nil {
		return ""
	}
	return fmt.Sprintf("%s: %s Recovery: %s", e.Code, e.Reason, e.Recovery)
}

func (c *Controller) PrecompiledRuntimeTargetID() string {
	if c == nil || c.bindings == nil {
		return ""
	}
	return c.bindings.Binding().LifecycleTargetID
}

func (c *Controller) EnsurePrecompiledRuntime(ctx context.Context) error {
	if c == nil || strings.TrimSpace(c.precompiledRuntimeManifest) == "" {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	c.startupMu.Lock()
	defer c.startupMu.Unlock()

	bundle, err := c.ensurePrecompiledRuntimeTarget(ctx)
	if err != nil {
		return err
	}
	if identity, identityErr := c.controlClient().identity(ctx); identityErr == nil {
		if normalizeVersion(identity.RuntimeBinaryVersion) != normalizeVersion(bundle.Version) ||
			normalizeSHA256(identity.ArtifactSHA256) != bundle.RuntimeSHA256 {
			return errors.New("running Runtime identity does not match the precompiled Desktop bundle")
		}
		if err := c.validateAndRecordIdentity(identity, &bundle.Provenance); err != nil {
			return err
		}
		return c.controlClient().health(ctx)
	}
	snapshot, err := c.offlineSnapshot(ctx)
	if err != nil || snapshot.Impact.Knowledge != gatewayprotocol.WorkloadKnown || len(snapshot.WorkloadIdentities) != 0 {
		return errors.New("precompiled Runtime startup requires a verified idle Runtime target")
	}
	operation := gatewayprotocol.RuntimeOperation{
		OperationID: precompiledStartupOperationID,
		Kind:        gatewayprotocol.RuntimeOperationStart,
		DesiredRuntime: gatewayprotocol.DesiredRuntime{
			Version: bundle.Version, Platform: bundle.Platform, Architecture: bundle.Architecture,
			ArtifactPolicy: gatewayprotocol.ArtifactPolicyPublishedRelease,
		},
		Artifact: &gatewayprotocol.RuntimeArtifact{ExecutableSHA256: bundle.RuntimeSHA256},
	}
	checkpointPath := c.checkpointPath(operation.OperationID)
	if _, statErr := os.Stat(checkpointPath); statErr == nil {
		if err := c.Recover(ctx, operation); err != nil {
			return fmt.Errorf("recover interrupted precompiled Runtime startup: %w", err)
		}
		if err := removeFileDurably(checkpointPath); err != nil {
			return err
		}
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return statErr
	}
	checkpoint := operationCheckpoint{
		OperationID: operation.OperationID,
		Phase:       checkpointPrepared,
		ManagedRoot: filepath.Join(c.bindings.Binding().RuntimeRoot, "runtime", "managed"),
	}
	if err := c.startAndVerifyWithProvenance(ctx, operation, &checkpoint, &bundle.Provenance); err != nil {
		startupErr := err
		if _, statErr := os.Stat(checkpointPath); statErr == nil {
			if recoverErr := c.Recover(ctx, operation); recoverErr != nil {
				return fmt.Errorf("start precompiled Runtime: %v; recover failed startup: %w", startupErr, recoverErr)
			}
			_ = removeFileDurably(checkpointPath)
		}
		return startupErr
	}
	return removeFileDurably(checkpointPath)
}

func (c *Controller) provisionPrecompiledRuntime() (verifiedPrecompiledRuntime, error) {
	if c == nil {
		return verifiedPrecompiledRuntime{}, errors.New("Runtime lifecycle controller is unavailable")
	}
	c.startupMu.Lock()
	defer c.startupMu.Unlock()
	return c.provisionPrecompiledRuntimeUnlocked()
}

func (c *Controller) provisionPrecompiledRuntimeUnlocked() (verifiedPrecompiledRuntime, error) {
	bundle, err := loadPrecompiledRuntimeManifest(c.precompiledRuntimeManifest, c.artifactProbeTimeout)
	if err != nil {
		return verifiedPrecompiledRuntime{}, err
	}
	target, err := c.inspectPrecompiledRuntimeTarget(bundle)
	if err != nil {
		return verifiedPrecompiledRuntime{}, err
	}
	switch target.Action {
	case precompiledTargetExact, precompiledTargetPreserve:
		return target.Runtime, nil
	case precompiledTargetReplace:
		return verifiedPrecompiledRuntime{}, errors.New("managed Runtime requires Gateway lifecycle convergence to the precompiled Desktop target")
	case precompiledTargetInstall:
	default:
		return verifiedPrecompiledRuntime{}, errors.New("precompiled Runtime target selection is invalid")
	}
	stagingRoot, err := c.stagePrecompiledRuntime(bundle, filepath.Join(c.bindings.Binding().RuntimeRoot, "runtime", ".precompiled-staging"))
	if err != nil {
		return verifiedPrecompiledRuntime{}, err
	}
	managedRoot := filepath.Join(c.bindings.Binding().RuntimeRoot, "runtime", "managed")
	if err := durableRename(stagingRoot, managedRoot); err != nil {
		_ = durableRemoveAll(stagingRoot)
		return verifiedPrecompiledRuntime{}, err
	}
	return bundle, nil
}

func (c *Controller) ensurePrecompiledRuntimeTarget(ctx context.Context) (verifiedPrecompiledRuntime, error) {
	bundle, err := loadPrecompiledRuntimeManifest(c.precompiledRuntimeManifest, c.artifactProbeTimeout)
	if err != nil {
		return verifiedPrecompiledRuntime{}, err
	}
	operation := gatewayprotocol.RuntimeOperation{
		OperationID: precompiledConvergenceOperationID,
		Kind:        gatewayprotocol.RuntimeOperationStart,
		DesiredRuntime: gatewayprotocol.DesiredRuntime{
			Version: bundle.Version, Platform: bundle.Platform, Architecture: bundle.Architecture,
			ArtifactPolicy: gatewayprotocol.ArtifactPolicyPublishedRelease,
		},
		Artifact: &gatewayprotocol.RuntimeArtifact{ExecutableSHA256: bundle.RuntimeSHA256},
	}
	checkpointPath := c.checkpointPath(operation.OperationID)
	if _, statErr := os.Stat(checkpointPath); statErr == nil {
		if err := c.Recover(ctx, operation); err != nil {
			return verifiedPrecompiledRuntime{}, fmt.Errorf("recover interrupted precompiled Runtime convergence: %w", err)
		}
		if err := removeFileDurably(checkpointPath); err != nil {
			return verifiedPrecompiledRuntime{}, err
		}
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return verifiedPrecompiledRuntime{}, statErr
	}

	target, err := c.inspectPrecompiledRuntimeTarget(bundle)
	if err != nil {
		return verifiedPrecompiledRuntime{}, err
	}
	switch target.Action {
	case precompiledTargetExact, precompiledTargetPreserve:
		return target.Runtime, nil
	case precompiledTargetInstall:
		stagingRoot, err := c.stagePrecompiledRuntime(bundle, filepath.Join(c.bindings.Binding().RuntimeRoot, "runtime", ".precompiled-staging"))
		if err != nil {
			return verifiedPrecompiledRuntime{}, err
		}
		managedRoot := filepath.Join(c.bindings.Binding().RuntimeRoot, "runtime", "managed")
		if err := durableRename(stagingRoot, managedRoot); err != nil {
			_ = durableRemoveAll(stagingRoot)
			return verifiedPrecompiledRuntime{}, err
		}
		return bundle, nil
	case precompiledTargetReplace:
		return c.convergePrecompiledRuntime(ctx, operation, target.Runtime)
	default:
		return verifiedPrecompiledRuntime{}, errors.New("precompiled Runtime target selection is invalid")
	}
}

func (c *Controller) convergePrecompiledRuntime(ctx context.Context, operation gatewayprotocol.RuntimeOperation, bundle verifiedPrecompiledRuntime) (verifiedPrecompiledRuntime, error) {
	binding := c.bindings.Binding()
	managedRoot := filepath.Join(binding.RuntimeRoot, "runtime", "managed")
	checkpoint := operationCheckpoint{
		OperationID: operation.OperationID, Phase: checkpointPrepared, ManagedRoot: managedRoot,
		PreviousManagedRoot:    managedRoot + ".previous." + safeOperationID(operation.OperationID),
		PreviousManagedPresent: true,
	}
	previousDigest, err := fileSHA256(filepath.Join(managedRoot, "bin", "redeven"))
	if err != nil {
		return verifiedPrecompiledRuntime{}, err
	}
	checkpoint.PreviousExecutableSHA256 = previousDigest
	client := c.controlClient()
	identity, identityErr := client.identity(ctx)
	checkpoint.RuntimeWasRunning = identityErr == nil
	fenceToken := ""
	if checkpoint.RuntimeWasRunning {
		validated := binding.ValidatedRuntime
		if validated == nil || normalizeSHA256(identity.ArtifactSHA256) != normalizeSHA256(validated.ArtifactSHA256) {
			return verifiedPrecompiledRuntime{}, errors.New("running Runtime identity does not match the verified managed installation")
		}
		fence, fenceErr := client.beginFence(ctx, operation.OperationID, binding.TargetGeneration)
		if fenceErr != nil {
			return verifiedPrecompiledRuntime{}, fenceErr
		}
		if precompiledConvergenceNeedsConfirmation(fence.Snapshot) {
			_ = client.releaseFence(ctx, fence.Token)
			return verifiedPrecompiledRuntime{}, &PrecompiledRuntimeConvergenceError{
				Code:     "runtime_target_active_workload_confirmation_required",
				Reason:   "the managed Runtime differs from this development bundle and still owns active or unknown workloads",
				Recovery: "close the environment workloads and retry, or explicitly review and confirm the Runtime update from Desktop",
			}
		}
		fenceToken = fence.Token
	} else {
		snapshot, snapshotErr := c.offlineSnapshot(ctx)
		if snapshotErr != nil || snapshot.Impact.Knowledge != gatewayprotocol.WorkloadKnown || len(snapshot.WorkloadIdentities) != 0 {
			return verifiedPrecompiledRuntime{}, &PrecompiledRuntimeConvergenceError{
				Code:     "runtime_target_identity_unproven",
				Reason:   "the Gateway cannot prove that the previous managed Runtime is stopped and idle",
				Recovery: "stop the exact Runtime instance through this Gateway and retry without deleting its state",
			}
		}
	}
	stagingRoot := filepath.Join(binding.RuntimeRoot, "runtime", "staging", safeOperationID(operation.OperationID))
	checkpoint.StagingRoot, err = c.stagePrecompiledRuntime(bundle, stagingRoot)
	if err != nil {
		if fenceToken != "" {
			_ = client.releaseFence(ctx, fenceToken)
		}
		return verifiedPrecompiledRuntime{}, err
	}
	if err := c.writeCheckpoint(checkpoint); err != nil {
		if fenceToken != "" {
			_ = client.releaseFence(ctx, fenceToken)
		}
		return verifiedPrecompiledRuntime{}, err
	}
	if checkpoint.RuntimeWasRunning {
		if err := client.shutdown(ctx, fenceToken); err != nil {
			return verifiedPrecompiledRuntime{}, fmt.Errorf("request Runtime shutdown for target convergence: %w", err)
		}
		if err := c.waitForRuntimeStopped(ctx); err != nil {
			return verifiedPrecompiledRuntime{}, err
		}
		if err := c.waitForNoRuntimeProcesses(ctx); err != nil {
			return verifiedPrecompiledRuntime{}, err
		}
	}
	checkpoint.Phase = checkpointRuntimeStopped
	if err := c.writeCheckpoint(checkpoint); err != nil {
		return verifiedPrecompiledRuntime{}, err
	}
	if err := c.activateStaging(checkpoint); err != nil {
		return verifiedPrecompiledRuntime{}, err
	}
	checkpoint.Phase = checkpointArtifactActive
	if err := c.writeCheckpoint(checkpoint); err != nil {
		return verifiedPrecompiledRuntime{}, err
	}
	if err := c.startAndVerifyWithProvenance(ctx, operation, &checkpoint, &bundle.Provenance); err != nil {
		startupErr := err
		if recoverErr := c.Recover(ctx, operation); recoverErr != nil {
			return verifiedPrecompiledRuntime{}, fmt.Errorf("converge precompiled Runtime: %v; restore previous Runtime: %w", startupErr, recoverErr)
		}
		_ = removeFileDurably(c.checkpointPath(operation.OperationID))
		return verifiedPrecompiledRuntime{}, startupErr
	}
	if err := durableRemoveAll(checkpoint.PreviousManagedRoot); err != nil {
		return verifiedPrecompiledRuntime{}, err
	}
	if err := removeFileDurably(c.checkpointPath(operation.OperationID)); err != nil {
		return verifiedPrecompiledRuntime{}, err
	}
	return bundle, nil
}

func precompiledConvergenceNeedsConfirmation(snapshot gatewayprotocol.WorkloadSnapshot) bool {
	snapshot = gatewayprotocol.NormalizeWorkloadSnapshot(snapshot)
	return snapshot.Impact.Knowledge != gatewayprotocol.WorkloadKnown || len(snapshot.WorkloadIdentities) != 0
}

func (c *Controller) inspectPrecompiledRuntimeTarget(bundle verifiedPrecompiledRuntime) (precompiledRuntimeTarget, error) {
	runtimeRoot := c.bindings.Binding().RuntimeRoot
	managedRoot := filepath.Join(runtimeRoot, "runtime", "managed")
	if info, statErr := os.Lstat(managedRoot); statErr == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return precompiledRuntimeTarget{}, errors.New("managed Runtime slot is not a regular directory")
		}
		bundleExact := verifyManagedPrecompiledRuntime(managedRoot, bundle) == nil
		validated := c.bindings.Binding().ValidatedRuntime
		persistedIdentityValid := runtimeValidationCompatible(validated) && validSHA256(validated.ManagedSuiteSHA256)
		var managed verifiedPrecompiledRuntime
		if persistedIdentityValid {
			suiteDigest, executableDigest, err := managedRuntimeSuiteSHA256(managedRoot)
			persistedIdentityValid = err == nil && suiteDigest == normalizeSHA256(validated.ManagedSuiteSHA256) &&
				executableDigest == normalizeSHA256(validated.ArtifactSHA256) &&
				strings.ToLower(strings.TrimSpace(validated.Platform)) == runtime.GOOS &&
				strings.ToLower(strings.TrimSpace(validated.Architecture)) == runtime.GOARCH &&
				validRuntimeInstallationProvenance(validated.InstallationProvenance)
			if persistedIdentityValid {
				managed = verifiedPrecompiledRuntime{
					Version: validated.RuntimeBinaryVersion, Platform: validated.Platform,
					Architecture: validated.Architecture, RuntimeSHA256: executableDigest, SuiteSHA256: suiteDigest,
					Provenance: validated.InstallationProvenance,
				}
			}
		}
		if bundle.Provenance.Kind == "packaged_bundle" && persistedIdentityValid &&
			(validated.InstallationProvenance.Kind == "verified_lifecycle_update" || validated.InstallationProvenance.Kind == "migrated_v1_validation") {
			return precompiledRuntimeTarget{Action: precompiledTargetPreserve, Runtime: managed}, nil
		}
		if bundleExact {
			return precompiledRuntimeTarget{Action: precompiledTargetExact, Runtime: bundle}, nil
		}
		if !persistedIdentityValid {
			return precompiledRuntimeTarget{}, errors.New("managed Runtime does not match the precompiled Desktop bundle or a persisted verified update")
		}
		return precompiledRuntimeTarget{Action: precompiledTargetReplace, Runtime: bundle}, nil
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return precompiledRuntimeTarget{}, statErr
	}
	return precompiledRuntimeTarget{Action: precompiledTargetInstall, Runtime: bundle}, nil
}

func (c *Controller) stagePrecompiledRuntime(bundle verifiedPrecompiledRuntime, stagingRoot string) (string, error) {
	if err := durableRemoveAll(stagingRoot); err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	completed := false
	defer func() {
		if !completed {
			_ = durableRemoveAll(stagingRoot)
		}
	}()
	binRoot := filepath.Join(stagingRoot, "bin")
	if err := os.MkdirAll(binRoot, 0o700); err != nil {
		return "", err
	}
	for _, file := range bundle.files {
		mode := os.FileMode(0o600)
		if file.artifact.Executable {
			mode = 0o700
		}
		if err := writeExclusiveFile(filepath.Join(binRoot, file.artifact.Path), file.bytes, mode); err != nil {
			return "", err
		}
	}
	if err := syncDirectory(binRoot); err != nil {
		return "", err
	}
	if err := syncDirectory(stagingRoot); err != nil {
		return "", err
	}
	completed = true
	return stagingRoot, nil
}

func loadPrecompiledRuntimeManifest(manifestPath string, probeTimeout time.Duration) (verifiedPrecompiledRuntime, error) {
	manifestPath = filepath.Clean(strings.TrimSpace(manifestPath))
	if manifestPath == "." || !filepath.IsAbs(manifestPath) {
		return verifiedPrecompiledRuntime{}, errors.New("precompiled Runtime manifest path must be absolute")
	}
	manifestBytes, err := readRegularPrecompiledFile(manifestPath, false)
	if err != nil {
		return verifiedPrecompiledRuntime{}, fmt.Errorf("read precompiled Runtime manifest: %w", err)
	}
	var manifest precompiledManifest
	decoder := json.NewDecoder(bytes.NewReader(manifestBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return verifiedPrecompiledRuntime{}, fmt.Errorf("parse precompiled Runtime manifest: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return verifiedPrecompiledRuntime{}, errors.New("precompiled Runtime manifest contains trailing data")
	}
	manifest.Version = strings.TrimSpace(manifest.Version)
	manifest.Commit = strings.TrimSpace(manifest.Commit)
	manifest.Platform = strings.ToLower(strings.TrimSpace(manifest.Platform))
	manifest.Architecture = strings.ToLower(strings.TrimSpace(manifest.Architecture))
	manifest.Provenance = strings.TrimSpace(manifest.Provenance)
	manifest.RuntimeSuiteSHA256 = normalizeSHA256(manifest.RuntimeSuiteSHA256)
	if manifest.SchemaVersion != 2 || manifest.Version == "" || manifest.Commit == "" ||
		(manifest.Provenance != "packaged_bundle" && manifest.Provenance != "development_bundle") ||
		!validSHA256(manifest.RuntimeSuiteSHA256) {
		return verifiedPrecompiledRuntime{}, errors.New("precompiled Runtime manifest identity is incomplete")
	}
	if manifest.Platform != runtime.GOOS || manifest.Architecture != runtime.GOARCH {
		return verifiedPrecompiledRuntime{}, errors.New("precompiled Runtime manifest target does not match this Gateway host")
	}
	if manifest.Gateway.Path != "redeven-gateway" || !manifest.Gateway.Executable {
		return verifiedPrecompiledRuntime{}, errors.New("precompiled Gateway manifest entry is invalid")
	}
	root := filepath.Dir(manifestPath)
	if _, err := verifyPrecompiledArtifact(root, manifest.Gateway); err != nil {
		return verifiedPrecompiledRuntime{}, fmt.Errorf("verify precompiled Gateway: %w", err)
	}
	expected := expectedPrecompiledRuntimeFiles(manifest.Platform)
	actual := make([]string, 0, len(manifest.RuntimeSuite))
	seen := make(map[string]struct{}, len(manifest.RuntimeSuite))
	files := make([]verifiedPrecompiledFile, 0, len(manifest.RuntimeSuite))
	runtimeDigest := ""
	var totalSize int64
	for _, artifact := range manifest.RuntimeSuite {
		if _, exists := seen[artifact.Path]; exists {
			return verifiedPrecompiledRuntime{}, errors.New("precompiled Runtime manifest contains duplicate suite entries")
		}
		seen[artifact.Path] = struct{}{}
		actual = append(actual, artifact.Path)
		fileBytes, err := verifyPrecompiledArtifact(root, artifact)
		if err != nil {
			return verifiedPrecompiledRuntime{}, fmt.Errorf("verify precompiled Runtime file %q: %w", artifact.Path, err)
		}
		if totalSize > (512<<20)-int64(len(fileBytes)) {
			return verifiedPrecompiledRuntime{}, errors.New("precompiled Runtime suite exceeds the size limit")
		}
		totalSize += int64(len(fileBytes))
		artifact.SHA256 = normalizeSHA256(artifact.SHA256)
		files = append(files, verifiedPrecompiledFile{artifact: artifact, bytes: fileBytes})
		if artifact.Path == "redeven" {
			if !artifact.Executable {
				return verifiedPrecompiledRuntime{}, errors.New("precompiled Runtime binary is not executable")
			}
			runtimeDigest = artifact.SHA256
		}
	}
	sort.Strings(actual)
	if strings.Join(actual, "\x00") != strings.Join(expected, "\x00") || runtimeDigest == "" {
		return verifiedPrecompiledRuntime{}, errors.New("precompiled Runtime suite inventory is incomplete or unsupported")
	}
	suiteDigest, err := precompiledRuntimeSuiteSHA256(files)
	if err != nil || suiteDigest != manifest.RuntimeSuiteSHA256 {
		return verifiedPrecompiledRuntime{}, errors.New("precompiled Runtime suite digest does not match the manifest")
	}
	runtimePath := filepath.Join(root, "redeven")
	probeContext, cancel := context.WithTimeout(context.Background(), probeTimeout)
	defer cancel()
	output, err := exec.CommandContext(probeContext, runtimePath, "version").CombinedOutput()
	if err != nil {
		if errors.Is(probeContext.Err(), context.DeadlineExceeded) {
			return verifiedPrecompiledRuntime{}, errors.New("precompiled Runtime version check timed out")
		}
		return verifiedPrecompiledRuntime{}, fmt.Errorf("precompiled Runtime version check failed: %s", strings.TrimSpace(string(output)))
	}
	fields := strings.Fields(string(output))
	reportedCommit := ""
	if len(fields) >= 3 {
		reportedCommit = strings.TrimSuffix(strings.TrimPrefix(fields[2], "("), ")")
	}
	if len(fields) < 3 || fields[0] != "redeven" || normalizeVersion(fields[1]) != normalizeVersion(manifest.Version) || reportedCommit != manifest.Commit {
		return verifiedPrecompiledRuntime{}, errors.New("precompiled Runtime version or commit does not match its manifest")
	}
	return verifiedPrecompiledRuntime{
		Version: manifest.Version, Commit: manifest.Commit, Platform: manifest.Platform,
		Architecture: manifest.Architecture, RuntimeSHA256: runtimeDigest, SuiteSHA256: suiteDigest,
		Provenance: RuntimeInstallationProvenance{Kind: manifest.Provenance, BundleCommit: manifest.Commit}, files: files,
	}, nil
}

func expectedPrecompiledRuntimeFiles(platform string) []string {
	files := []string{"redeven"}
	if platform == "linux" {
		files = append(files,
			".redevplugin-release-artifacts-verified.json",
			"REDEVPLUGIN_RUNTIME.spdx.json",
			"REDEVPLUGIN_THIRD_PARTY_NOTICES.md",
			"redevplugin-runtime",
			"redevplugin-runtime.pem",
			"redevplugin-runtime.provenance.json",
			"redevplugin-runtime.sig",
		)
	}
	sort.Strings(files)
	return files
}

func verifyPrecompiledArtifact(root string, artifact precompiledArtifact) ([]byte, error) {
	artifact.Path = strings.TrimSpace(artifact.Path)
	if artifact.Path == "" || filepath.Base(artifact.Path) != artifact.Path || artifact.Path == "." ||
		artifact.SizeBytes <= 0 || normalizeSHA256(artifact.SHA256) == "" {
		return nil, errors.New("manifest artifact descriptor is invalid")
	}
	value, err := readRegularPrecompiledFile(filepath.Join(root, artifact.Path), artifact.Executable)
	if err != nil {
		return nil, err
	}
	if int64(len(value)) != artifact.SizeBytes {
		return nil, errors.New("artifact size does not match the manifest")
	}
	digest := fmt.Sprintf("sha256:%x", sha256Bytes(value))
	if digest != normalizeSHA256(artifact.SHA256) {
		return nil, errors.New("artifact digest does not match the manifest")
	}
	return value, nil
}

func readRegularPrecompiledFile(filePath string, executable bool) ([]byte, error) {
	before, err := os.Lstat(filePath)
	if err != nil {
		return nil, err
	}
	if !before.Mode().IsRegular() || before.Mode()&os.ModeSymlink != 0 || (executable && before.Mode().Perm()&0o111 == 0) {
		return nil, errors.New("bundle artifact must be a regular file with the declared executable mode")
	}
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !opened.Mode().IsRegular() || !os.SameFile(before, opened) {
		return nil, errors.New("bundle artifact identity changed while opening")
	}
	return io.ReadAll(io.LimitReader(file, (512<<20)+1))
}

func verifyManagedPrecompiledRuntime(managedRoot string, bundle verifiedPrecompiledRuntime) error {
	if err := verifyManagedRuntimeDirectoryModes(managedRoot); err != nil {
		return err
	}
	entries, err := os.ReadDir(filepath.Join(managedRoot, "bin"))
	if err != nil {
		return err
	}
	actualNames := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.Type()&os.ModeSymlink != 0 || !entry.Type().IsRegular() {
			return errors.New("managed Runtime suite contains an unsupported entry")
		}
		actualNames = append(actualNames, entry.Name())
	}
	expectedNames := make([]string, 0, len(bundle.files))
	for _, expected := range bundle.files {
		expectedNames = append(expectedNames, expected.artifact.Path)
	}
	sort.Strings(actualNames)
	sort.Strings(expectedNames)
	if strings.Join(actualNames, "\x00") != strings.Join(expectedNames, "\x00") {
		return errors.New("managed Runtime suite inventory differs from the precompiled Desktop bundle")
	}
	for _, expected := range bundle.files {
		filePath := filepath.Join(managedRoot, "bin", expected.artifact.Path)
		info, err := os.Lstat(filePath)
		if err != nil || !managedRuntimeFileModeValid(expected.artifact.Path, info.Mode()) {
			return fmt.Errorf("managed file %q has an unsupported mode", expected.artifact.Path)
		}
		actual, err := readRegularPrecompiledFile(filePath, expected.artifact.Executable)
		if err != nil {
			return err
		}
		if int64(len(actual)) != expected.artifact.SizeBytes || fmt.Sprintf("sha256:%x", sha256Bytes(actual)) != expected.artifact.SHA256 {
			return fmt.Errorf("managed file %q has different bytes", expected.artifact.Path)
		}
	}
	return nil
}

func managedRuntimeSuiteSHA256(managedRoot string) (string, string, error) {
	if err := verifyManagedRuntimeDirectoryModes(managedRoot); err != nil {
		return "", "", err
	}
	binRoot := filepath.Join(managedRoot, "bin")
	entries, err := os.ReadDir(binRoot)
	if err != nil {
		return "", "", err
	}
	if len(entries) == 0 || len(entries) > 32 {
		return "", "", errors.New("managed Runtime suite inventory is invalid")
	}
	manifest := make([]managedRuntimeSuiteEntry, 0, len(entries))
	runtimeDigest := ""
	var totalSize int64
	for _, entry := range entries {
		name := entry.Name()
		if name == "" || filepath.Base(name) != name || entry.Type()&os.ModeSymlink != 0 || !entry.Type().IsRegular() {
			return "", "", errors.New("managed Runtime suite contains an unsupported entry")
		}
		filePath := filepath.Join(binRoot, name)
		fileInfo, statErr := os.Lstat(filePath)
		if statErr != nil || !fileInfo.Mode().IsRegular() || fileInfo.Mode()&os.ModeSymlink != 0 {
			return "", "", errors.New("managed Runtime suite entry is not a regular file")
		}
		if !managedRuntimeFileModeValid(name, fileInfo.Mode()) {
			return "", "", fmt.Errorf("managed Runtime suite file %q has an unsupported mode", name)
		}
		fileBytes, readErr := readRegularPrecompiledFile(filePath, name == "redeven" || name == "redevplugin-runtime")
		if readErr != nil {
			return "", "", readErr
		}
		if totalSize > (512<<20)-int64(len(fileBytes)) {
			return "", "", errors.New("managed Runtime suite exceeds the size limit")
		}
		totalSize += int64(len(fileBytes))
		digest := fmt.Sprintf("sha256:%x", sha256.Sum256(fileBytes))
		manifest = append(manifest, managedRuntimeSuiteEntry{
			Name: name, SHA256: digest, SizeBytes: len(fileBytes), Executable: fileInfo.Mode().Perm()&0o111 != 0,
		})
		if name == "redeven" {
			runtimeDigest = digest
		}
	}
	if runtimeDigest == "" {
		return "", "", errors.New("managed Runtime suite is missing the Runtime executable")
	}
	suiteDigest, err := runtimeSuiteEntriesSHA256(manifest)
	if err != nil {
		return "", "", err
	}
	return suiteDigest, runtimeDigest, nil
}

func verifyManagedRuntimeDirectoryModes(managedRoot string) error {
	for _, directory := range []string{managedRoot, filepath.Join(managedRoot, "bin")} {
		info, err := os.Lstat(directory)
		if err != nil {
			return err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != 0o700 {
			return errors.New("managed Runtime suite directory must be a non-symlink directory with mode 0700")
		}
	}
	return nil
}

func managedRuntimeFileModeValid(name string, mode os.FileMode) bool {
	if !mode.IsRegular() || mode&os.ModeSymlink != 0 {
		return false
	}
	expected := os.FileMode(0o600)
	if name == "redeven" || name == "redevplugin-runtime" {
		expected = 0o700
	}
	return mode.Perm() == expected
}

func precompiledRuntimeSuiteSHA256(files []verifiedPrecompiledFile) (string, error) {
	manifest := make([]managedRuntimeSuiteEntry, 0, len(files))
	for _, file := range files {
		manifest = append(manifest, managedRuntimeSuiteEntry{
			Name: file.artifact.Path, SHA256: normalizeSHA256(file.artifact.SHA256),
			SizeBytes: len(file.bytes), Executable: file.artifact.Executable,
		})
	}
	return runtimeSuiteEntriesSHA256(manifest)
}

func runtimeSuiteEntriesSHA256(manifest []managedRuntimeSuiteEntry) (string, error) {
	sort.Slice(manifest, func(i, j int) bool { return manifest[i].Name < manifest[j].Name })
	raw, err := json.Marshal(struct {
		SchemaVersion int                        `json:"schema_version"`
		Files         []managedRuntimeSuiteEntry `json:"files"`
	}{SchemaVersion: 1, Files: manifest})
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("sha256:%x", sha256.Sum256(raw)), nil
}

func writeExclusiveFile(filePath string, value []byte, mode os.FileMode) error {
	file, err := os.OpenFile(filePath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	if _, err = file.Write(value); err == nil {
		err = file.Sync()
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	return err
}

func removeFileDurably(filePath string) error {
	if err := os.Remove(filePath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return syncDirectory(filepath.Dir(filePath))
}

func sha256Bytes(value []byte) [32]byte {
	return sha256.Sum256(value)
}
