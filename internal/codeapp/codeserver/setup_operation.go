package codeserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	defaultWorkspaceEngineChunkSize = 1 * 1024 * 1024
	workspaceEngineUploadTTL        = 6 * time.Hour
)

type WorkspaceEngineSetupOperation struct {
	OperationID     string                     `json:"operation_id"`
	InstallMethod   BrowserEditorInstallMethod `json:"install_method"`
	State           string                     `json:"state"`
	ReceivedBytes   int64                      `json:"received_bytes"`
	ExpectedBytes   int64                      `json:"expected_bytes"`
	ChunkSizeBytes  int64                      `json:"chunk_size_bytes,omitempty"`
	NextChunkIndex  int64                      `json:"next_chunk_index,omitempty"`
	CreatedAtUnixMS int64                      `json:"created_at_unix_ms"`
	ExpiresAtUnixMS int64                      `json:"expires_at_unix_ms,omitempty"`
}

type WorkspaceEngineSetupChunkResult struct {
	OperationID    string `json:"operation_id"`
	ReceivedBytes  int64  `json:"received_bytes"`
	ExpectedBytes  int64  `json:"expected_bytes"`
	NextChunkIndex int64  `json:"next_chunk_index"`
}

type workspaceEngineSetupSession struct {
	WorkspaceEngineSetupOperation
	Manifest WorkspaceEngineArtifactManifest `json:"manifest"`
}

func validateBrowserEditorOperationID(operationID string) (string, error) {
	operationID = strings.TrimSpace(operationID)
	if operationID == "" {
		return "", errors.New("missing browser editor setup operation id")
	}
	if len(operationID) > 160 {
		return "", errors.New("browser editor setup operation id is too long")
	}
	for _, char := range operationID {
		if (char >= 'a' && char <= 'z') ||
			(char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') ||
			char == '-' || char == '_' || char == '.' || char == ':' {
			continue
		}
		return "", errors.New("browser editor setup operation id contains unsupported characters")
	}
	return operationID, nil
}

func (m *RuntimeManager) CreateSetupOperation(
	ctx context.Context,
	operationID string,
	installMethod BrowserEditorInstallMethod,
	manifest *WorkspaceEngineArtifactManifest,
) (WorkspaceEngineSetupOperation, error) {
	if m == nil {
		return WorkspaceEngineSetupOperation{}, errors.New("runtime manager not ready")
	}
	cleanOperationID, err := validateBrowserEditorOperationID(operationID)
	if err != nil {
		return WorkspaceEngineSetupOperation{}, err
	}
	if installMethod != BrowserEditorInstallMethodDesktopTransfer && installMethod != BrowserEditorInstallMethodRemoteDownload {
		return WorkspaceEngineSetupOperation{}, fmt.Errorf("unsupported browser editor install method %q", installMethod)
	}
	if installMethod == BrowserEditorInstallMethodDesktopTransfer {
		if manifest == nil {
			return WorkspaceEngineSetupOperation{}, errors.New("desktop transfer requires a browser editor package manifest")
		}
		if err := validateWorkspaceEngineManifest(*manifest, currentWorkspaceEnginePlatform()); err != nil {
			return WorkspaceEngineSetupOperation{}, err
		}
	} else if manifest != nil {
		return WorkspaceEngineSetupOperation{}, errors.New("environment download does not accept a client package manifest")
	}
	if err := ensureSharedRuntimeDirs(m.stateRoot); err != nil {
		return WorkspaceEngineSetupOperation{}, err
	}

	m.mu.Lock()
	_, reusedOperationID := m.usedSetupOperationIDs[cleanOperationID]
	m.mu.Unlock()
	if reusedOperationID {
		return WorkspaceEngineSetupOperation{}, errors.New("browser editor setup operation id has already been used")
	}

	targetVersion := ""
	if manifest != nil {
		targetVersion = manifest.Version
	}
	opCtx, started := m.startOperation(RuntimeOperationActionPrepareWorkspaceEngine, targetVersion, cleanOperationID, installMethod)
	if !started {
		return WorkspaceEngineSetupOperation{}, errors.New("another browser editor setup operation is already running")
	}
	m.mu.Lock()
	m.usedSetupOperationIDs[cleanOperationID] = struct{}{}
	m.mu.Unlock()

	now := m.now()
	operation := WorkspaceEngineSetupOperation{
		OperationID:     cleanOperationID,
		InstallMethod:   installMethod,
		State:           "running",
		CreatedAtUnixMS: now.UnixMilli(),
	}
	if installMethod == BrowserEditorInstallMethodDesktopTransfer {
		operation.State = "receiving"
		operation.ExpectedBytes = manifest.Archive.SizeBytes
		operation.ChunkSizeBytes = defaultWorkspaceEngineChunkSize
		operation.ExpiresAtUnixMS = now.Add(workspaceEngineUploadTTL).UnixMilli()
		if err := os.MkdirAll(sharedSetupOperationRoot(m.stateRoot), 0o700); err != nil {
			m.finishSetupOperation(cleanOperationID, "transfer_state_failed", err.Error(), false)
			return WorkspaceEngineSetupOperation{}, err
		}
		session := workspaceEngineSetupSession{WorkspaceEngineSetupOperation: operation, Manifest: *manifest}
		m.setupOperationMu.Lock()
		err = saveWorkspaceEngineSetupSession(m.stateRoot, session)
		m.setupOperationMu.Unlock()
		if err != nil {
			m.finishSetupOperation(cleanOperationID, "transfer_state_failed", err.Error(), false)
			return WorkspaceEngineSetupOperation{}, err
		}
		m.setSetupStage(cleanOperationID, RuntimeOperationStageReceiving)
		m.setSetupTransferProgress(cleanOperationID, 0, operation.ExpectedBytes, false)
		m.appendSetupLog(cleanOperationID, "Receiving Browser Editor package from the current Env App session.")
		return operation, nil
	}

	m.setSetupStage(cleanOperationID, RuntimeOperationStageResolvingCatalog)
	m.appendSetupLog(cleanOperationID, "Checking the Redeven Browser Editor catalog from this environment.")
	go m.runRemoteDownloadSetupOperation(opCtx, cleanOperationID)
	return operation, nil
}

func (m *RuntimeManager) AppendSetupOperationChunk(
	ctx context.Context,
	operationID string,
	chunkIndex int64,
	chunk io.Reader,
) (WorkspaceEngineSetupChunkResult, error) {
	if m == nil {
		return WorkspaceEngineSetupChunkResult{}, errors.New("runtime manager not ready")
	}
	cleanOperationID, err := validateBrowserEditorOperationID(operationID)
	if err != nil {
		return WorkspaceEngineSetupChunkResult{}, err
	}
	opCtx, installMethod, err := m.operationContextForSetup(cleanOperationID)
	if err != nil {
		return WorkspaceEngineSetupChunkResult{}, err
	}
	if installMethod != BrowserEditorInstallMethodDesktopTransfer {
		err := errors.New("browser editor setup operation does not accept uploaded chunks")
		m.finishSetupOperation(cleanOperationID, "transfer_protocol_failed", err.Error(), false)
		return WorkspaceEngineSetupChunkResult{}, err
	}

	m.setupOperationMu.Lock()
	defer m.setupOperationMu.Unlock()
	fail := func(code string, failure error) (WorkspaceEngineSetupChunkResult, error) {
		_ = m.removeSetupOperationFiles(cleanOperationID)
		if errors.Is(failure, context.Canceled) || errors.Is(opCtx.Err(), context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
			m.finishSetupOperation(cleanOperationID, "", "", true)
		} else {
			m.finishSetupOperation(cleanOperationID, code, failure.Error(), false)
		}
		return WorkspaceEngineSetupChunkResult{}, failure
	}

	session, err := loadWorkspaceEngineSetupSession(m.stateRoot, cleanOperationID)
	if err != nil {
		return fail("transfer_state_failed", err)
	}
	if err := opCtx.Err(); err != nil {
		return fail("", err)
	}
	if session.State != "receiving" {
		return fail("transfer_protocol_failed", fmt.Errorf("browser editor setup operation %s is not receiving", cleanOperationID))
	}
	if chunkIndex != session.NextChunkIndex {
		return fail("transfer_protocol_failed", fmt.Errorf("browser editor chunk index mismatch: got %d, want %d", chunkIndex, session.NextChunkIndex))
	}
	if m.now().UnixMilli() > session.ExpiresAtUnixMS {
		return fail("transfer_expired", errors.New("browser editor package transfer expired"))
	}

	body, err := io.ReadAll(io.LimitReader(chunk, defaultWorkspaceEngineChunkSize+1))
	if err != nil {
		return fail("transfer_read_failed", err)
	}
	if len(body) > defaultWorkspaceEngineChunkSize {
		return fail("transfer_protocol_failed", fmt.Errorf("browser editor chunk is too large: %d bytes", len(body)))
	}
	if len(body) == 0 {
		return fail("transfer_protocol_failed", errors.New("browser editor chunk is empty"))
	}
	written := int64(len(body))
	if session.ReceivedBytes+written > session.ExpectedBytes {
		return fail("transfer_protocol_failed", errors.New("browser editor package transfer exceeded expected size"))
	}

	path := workspaceEngineSetupPartPath(m.stateRoot, cleanOperationID)
	out, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return fail("transfer_write_failed", err)
	}
	_, writeErr := out.Write(body)
	closeErr := out.Close()
	if writeErr != nil {
		return fail("transfer_write_failed", writeErr)
	}
	if closeErr != nil {
		return fail("transfer_write_failed", closeErr)
	}

	session.ReceivedBytes += written
	session.NextChunkIndex++
	if err := saveWorkspaceEngineSetupSession(m.stateRoot, session); err != nil {
		return fail("transfer_state_failed", err)
	}
	m.setSetupTransferProgress(cleanOperationID, session.ReceivedBytes, session.ExpectedBytes, false)
	return WorkspaceEngineSetupChunkResult{
		OperationID:    cleanOperationID,
		ReceivedBytes:  session.ReceivedBytes,
		ExpectedBytes:  session.ExpectedBytes,
		NextChunkIndex: session.NextChunkIndex,
	}, nil
}

func (m *RuntimeManager) CompleteSetupOperation(ctx context.Context, operationID string) (RuntimeStatus, error) {
	if m == nil {
		return RuntimeStatus{}, errors.New("runtime manager not ready")
	}
	cleanOperationID, err := validateBrowserEditorOperationID(operationID)
	if err != nil {
		return RuntimeStatus{}, err
	}
	opCtx, installMethod, err := m.operationContextForSetup(cleanOperationID)
	if err != nil {
		return RuntimeStatus{}, err
	}
	if installMethod != BrowserEditorInstallMethodDesktopTransfer {
		err := errors.New("environment download completes without a client completion request")
		m.finishSetupOperation(cleanOperationID, "transfer_protocol_failed", err.Error(), false)
		return m.Status(ctx), err
	}

	m.setupOperationMu.Lock()
	defer m.setupOperationMu.Unlock()
	session, err := loadWorkspaceEngineSetupSession(m.stateRoot, cleanOperationID)
	if err != nil {
		m.finishSetupOperation(cleanOperationID, "transfer_state_failed", err.Error(), false)
		return m.Status(ctx), err
	}
	cleanup := func() {
		_ = m.removeSetupOperationFiles(cleanOperationID)
	}
	if session.ReceivedBytes != session.ExpectedBytes {
		err := fmt.Errorf("browser editor package transfer is incomplete: got %d bytes, want %d", session.ReceivedBytes, session.ExpectedBytes)
		cleanup()
		m.finishSetupOperation(cleanOperationID, "transfer_incomplete", err.Error(), false)
		return m.Status(ctx), err
	}
	if err := opCtx.Err(); err != nil {
		cleanup()
		m.finishSetupOperation(cleanOperationID, "", "", true)
		return m.Status(ctx), err
	}

	session.State = "installing"
	if err := saveWorkspaceEngineSetupSession(m.stateRoot, session); err != nil {
		cleanup()
		m.finishSetupOperation(cleanOperationID, "transfer_state_failed", err.Error(), false)
		return m.Status(ctx), err
	}
	defer cleanup()
	return m.installWorkspaceEnginePackage(ctx, opCtx, cleanOperationID, workspaceEngineSetupPartPath(m.stateRoot, cleanOperationID), session.Manifest)
}

func (m *RuntimeManager) CancelSetupOperation(ctx context.Context, operationID string) (RuntimeStatus, error) {
	if m == nil {
		return RuntimeStatus{}, errors.New("runtime manager not ready")
	}
	cleanOperationID, err := validateBrowserEditorOperationID(operationID)
	if err != nil {
		return RuntimeStatus{}, err
	}
	m.mu.Lock()
	if !m.setupOperationMatchesLocked(cleanOperationID) {
		alreadyCancelled := m.operationAction == RuntimeOperationActionPrepareWorkspaceEngine &&
			m.operationID == cleanOperationID &&
			m.operationState == RuntimeOperationStateCancelled
		m.mu.Unlock()
		if alreadyCancelled {
			return m.Status(ctx), nil
		}
		return m.Status(ctx), errors.New("browser editor setup operation is not running")
	}
	cancel := m.cancelOperation
	m.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	m.setupOperationMu.Lock()
	_ = m.removeSetupOperationFiles(cleanOperationID)
	m.setupOperationMu.Unlock()
	_ = os.Remove(remoteDownloadTempPath(m.stateRoot, currentWorkspaceEnginePlatform(), cleanOperationID))
	m.finishSetupOperation(cleanOperationID, "", "", true)
	return m.Status(ctx), nil
}

func (m *RuntimeManager) operationContextForSetup(operationID string) (context.Context, BrowserEditorInstallMethod, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.setupOperationMatchesLocked(operationID) || m.operationContext == nil {
		return nil, "", errors.New("browser editor setup operation is not running")
	}
	return m.operationContext, m.installMethod, nil
}

func (m *RuntimeManager) installWorkspaceEnginePackage(
	requestContext context.Context,
	opCtx context.Context,
	operationID string,
	archivePath string,
	manifest WorkspaceEngineArtifactManifest,
) (RuntimeStatus, error) {
	version := strings.TrimSpace(manifest.Version)
	stagePrefix := filepath.Join(sharedStagingRoot(m.stateRoot), sanitizePathSegment(operationID))
	defer os.RemoveAll(stagePrefix)
	m.setSetupTargetVersion(operationID, version)

	fail := func(code string, err error) (RuntimeStatus, error) {
		if errors.Is(err, context.Canceled) || errors.Is(opCtx.Err(), context.Canceled) {
			m.finishSetupOperation(operationID, "", "", true)
		} else {
			m.finishSetupOperation(operationID, code, err.Error(), false)
		}
		return m.Status(requestContext), err
	}
	if err := opCtx.Err(); err != nil {
		return fail("", err)
	}
	m.setSetupStage(operationID, RuntimeOperationStageVerifying)
	if err := verifyWorkspaceEngineArchive(archivePath, manifest); err != nil {
		return fail("artifact_validation_failed", err)
	}
	if err := opCtx.Err(); err != nil {
		return fail("", err)
	}

	m.setSetupStage(operationID, RuntimeOperationStageInstalling)
	if err := installWorkspaceEngineArchive(opCtx, archivePath, stagePrefix, manifest); err != nil {
		return fail("artifact_install_failed", err)
	}
	if err := opCtx.Err(); err != nil {
		return fail("", err)
	}

	m.setSetupStage(operationID, RuntimeOperationStageFinalizing)
	versionRoot := sharedVersionRoot(m.stateRoot, version)
	var commitPromote func() error
	var revertPromote func() error
	err := withLocalEnvironmentRuntimeStateLock(m.stateRoot, func(state *localEnvironmentRuntimeState) error {
		if err := opCtx.Err(); err != nil {
			return err
		}
		if existing, ok := state.Versions[version]; ok {
			existingBinary := filepath.Join(versionRoot, strings.TrimSpace(existing.BinaryRelPath))
			probeErr := probeRuntimeBinary(opCtx, existingBinary)
			if probeErr == nil {
				state.SelectedVersion = version
				state.UpdatedAtUnixMs = m.now().UnixMilli()
				return repairManagedRuntimeLink(m.stateDir, m.stateRoot, version)
			}
			if errors.Is(probeErr, context.Canceled) || errors.Is(opCtx.Err(), context.Canceled) {
				return probeErr
			}
			delete(state.Versions, version)
		}
		binaryRelPath := normalizedWorkspaceEngineBinaryRelPath(manifest)
		commit, revert, promoteErr := promoteManagedRuntime(stagePrefix, versionRoot)
		if promoteErr != nil {
			return promoteErr
		}
		commitPromote = commit
		revertPromote = revert
		if err := probeRuntimeBinary(opCtx, filepath.Join(versionRoot, binaryRelPath)); err != nil {
			if revertPromote != nil {
				_ = revertPromote()
				revertPromote = nil
			}
			return err
		}
		state.Versions[version] = localEnvironmentRuntimeVersion{
			InstalledAtUnixMs: m.now().UnixMilli(),
			BinaryRelPath:     binaryRelPath,
		}
		state.SelectedVersion = version
		state.UpdatedAtUnixMs = m.now().UnixMilli()
		if err := repairManagedRuntimeLink(m.stateDir, m.stateRoot, version); err != nil {
			if revertPromote != nil {
				_ = revertPromote()
				revertPromote = nil
			}
			return err
		}
		return nil
	})
	if err != nil {
		if revertPromote != nil {
			if revertErr := revertPromote(); revertErr != nil {
				err = errors.Join(err, fmt.Errorf("rollback failed: %w", revertErr))
			}
		}
		return fail("finalize_failed", err)
	}
	if commitPromote != nil {
		if err := commitPromote(); err != nil {
			m.appendSetupLog(operationID, "Browser Editor backup cleanup failed: "+err.Error())
		}
	}
	m.appendSetupLog(operationID, "The Browser Editor is ready for this environment.")
	m.finishSetupOperation(operationID, "", "", false)
	return m.Status(requestContext), nil
}

func sharedSetupOperationRoot(stateRoot string) string {
	return filepath.Join(sharedDownloadsRoot(stateRoot), "setup-operations")
}

func workspaceEngineSetupPartPath(stateRoot string, operationID string) string {
	return filepath.Join(sharedSetupOperationRoot(stateRoot), sanitizePathSegment(operationID)+".part")
}

func workspaceEngineSetupSessionPath(stateRoot string, operationID string) string {
	return filepath.Join(sharedSetupOperationRoot(stateRoot), sanitizePathSegment(operationID)+".json")
}

func (m *RuntimeManager) removeSetupOperationFiles(operationID string) error {
	operationID = sanitizePathSegment(operationID)
	_ = os.Remove(workspaceEngineSetupPartPath(m.stateRoot, operationID))
	_ = os.Remove(workspaceEngineSetupSessionPath(m.stateRoot, operationID))
	return nil
}

func saveWorkspaceEngineSetupSession(stateRoot string, session workspaceEngineSetupSession) error {
	if err := os.MkdirAll(sharedSetupOperationRoot(stateRoot), 0o700); err != nil {
		return err
	}
	body, err := json.MarshalIndent(session, "", "  ")
	if err != nil {
		return err
	}
	path := workspaceEngineSetupSessionPath(stateRoot, session.OperationID)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(body, '\n'), 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func loadWorkspaceEngineSetupSession(stateRoot string, operationID string) (workspaceEngineSetupSession, error) {
	body, err := os.ReadFile(workspaceEngineSetupSessionPath(stateRoot, operationID))
	if err != nil {
		return workspaceEngineSetupSession{}, err
	}
	var session workspaceEngineSetupSession
	if err := json.Unmarshal(body, &session); err != nil {
		return workspaceEngineSetupSession{}, err
	}
	if session.OperationID != operationID {
		return workspaceEngineSetupSession{}, errors.New("browser editor setup operation state does not match the request")
	}
	return session, nil
}
