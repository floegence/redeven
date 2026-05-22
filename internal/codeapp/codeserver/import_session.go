package codeserver

import (
	"context"
	"crypto/rand"
	"encoding/base64"
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
	defaultWorkspaceEngineChunkSize = 8 * 1024 * 1024
	workspaceEngineUploadTTL        = 6 * time.Hour
)

type WorkspaceEngineImportSession struct {
	UploadID        string                          `json:"upload_id"`
	OperationID     string                          `json:"operation_id"`
	Manifest        WorkspaceEngineArtifactManifest `json:"manifest"`
	State           string                          `json:"state"`
	ReceivedBytes   int64                           `json:"received_bytes"`
	ExpectedBytes   int64                           `json:"expected_bytes"`
	ChunkSizeBytes  int64                           `json:"chunk_size_bytes"`
	NextChunkIndex  int64                           `json:"next_chunk_index"`
	CreatedAtUnixMS int64                           `json:"created_at_unix_ms"`
	ExpiresAtUnixMS int64                           `json:"expires_at_unix_ms"`
}

type WorkspaceEngineImportChunkResult struct {
	UploadID       string `json:"upload_id"`
	ReceivedBytes  int64  `json:"received_bytes"`
	ExpectedBytes  int64  `json:"expected_bytes"`
	NextChunkIndex int64  `json:"next_chunk_index"`
}

func newWorkspaceEngineUploadID() (string, error) {
	buf := make([]byte, 18)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return "cwe_" + base64.RawURLEncoding.EncodeToString(buf), nil
}

func (m *RuntimeManager) CreateImportSession(ctx context.Context, manifest WorkspaceEngineArtifactManifest) (WorkspaceEngineImportSession, error) {
	if m == nil {
		return WorkspaceEngineImportSession{}, errors.New("runtime manager not ready")
	}
	if err := validateWorkspaceEngineManifest(manifest, currentWorkspaceEnginePlatform()); err != nil {
		return WorkspaceEngineImportSession{}, err
	}
	uploadID, err := newWorkspaceEngineUploadID()
	if err != nil {
		return WorkspaceEngineImportSession{}, err
	}
	now := m.now()
	session := WorkspaceEngineImportSession{
		UploadID:        uploadID,
		OperationID:     uploadID,
		Manifest:        manifest,
		State:           "receiving",
		ExpectedBytes:   manifest.Archive.SizeBytes,
		ChunkSizeBytes:  defaultWorkspaceEngineChunkSize,
		CreatedAtUnixMS: now.UnixMilli(),
		ExpiresAtUnixMS: now.Add(workspaceEngineUploadTTL).UnixMilli(),
	}
	if err := ensureSharedRuntimeDirs(m.stateRoot); err != nil {
		return WorkspaceEngineImportSession{}, err
	}
	if err := os.MkdirAll(sharedUploadRoot(m.stateRoot), 0o700); err != nil {
		return WorkspaceEngineImportSession{}, err
	}
	_, started := m.startOperation(RuntimeOperationActionPrepareWorkspaceEngine, manifest.Version)
	if !started {
		return WorkspaceEngineImportSession{}, errors.New("another workspace engine operation is already running")
	}
	m.importSessionMu.Lock()
	defer m.importSessionMu.Unlock()
	if err := saveWorkspaceEngineImportSession(m.stateRoot, session); err != nil {
		m.finishOperation("import_session_failed", err.Error(), false)
		return WorkspaceEngineImportSession{}, err
	}
	m.setActiveImportUploadID(session.UploadID)
	m.setStage(RuntimeOperationStageReceiving)
	m.appendLog("Receiving workspace engine package from Desktop.")
	return session, nil
}

func (m *RuntimeManager) AppendImportChunk(ctx context.Context, uploadID string, chunkIndex int64, chunk io.Reader) (WorkspaceEngineImportChunkResult, error) {
	if m == nil {
		return WorkspaceEngineImportChunkResult{}, errors.New("runtime manager not ready")
	}
	opCtx, err := m.operationContextForImportSession(uploadID)
	if err != nil {
		return WorkspaceEngineImportChunkResult{}, err
	}
	m.importSessionMu.Lock()
	defer m.importSessionMu.Unlock()

	session, err := loadWorkspaceEngineImportSession(m.stateRoot, uploadID)
	if err != nil {
		return WorkspaceEngineImportChunkResult{}, err
	}
	if err := opCtx.Err(); err != nil {
		return WorkspaceEngineImportChunkResult{}, err
	}
	if session.State != "receiving" {
		return WorkspaceEngineImportChunkResult{}, fmt.Errorf("workspace engine import session %s is not receiving", session.UploadID)
	}
	if chunkIndex != session.NextChunkIndex {
		return WorkspaceEngineImportChunkResult{}, fmt.Errorf("workspace engine chunk index mismatch: got %d, want %d", chunkIndex, session.NextChunkIndex)
	}
	if m.now().UnixMilli() > session.ExpiresAtUnixMS {
		_ = m.removeImportSessionFiles(session.UploadID)
		m.finishOperation("import_session_expired", "workspace engine import session expired", false)
		return WorkspaceEngineImportChunkResult{}, errors.New("workspace engine import session expired")
	}
	m.setStage(RuntimeOperationStageReceiving)
	body, err := io.ReadAll(io.LimitReader(chunk, defaultWorkspaceEngineChunkSize+1))
	if err != nil {
		return WorkspaceEngineImportChunkResult{}, err
	}
	if len(body) > defaultWorkspaceEngineChunkSize {
		return WorkspaceEngineImportChunkResult{}, fmt.Errorf("workspace engine chunk is too large: %d bytes", len(body))
	}
	if len(body) == 0 {
		return WorkspaceEngineImportChunkResult{}, errors.New("workspace engine chunk is empty")
	}
	written := int64(len(body))
	session.ReceivedBytes += written
	if session.ReceivedBytes > session.ExpectedBytes {
		return WorkspaceEngineImportChunkResult{}, errors.New("workspace engine upload exceeded expected size")
	}
	path := workspaceEngineUploadPartPath(m.stateRoot, session.UploadID)
	out, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return WorkspaceEngineImportChunkResult{}, err
	}
	if _, err := out.Write(body); err != nil {
		_ = out.Close()
		return WorkspaceEngineImportChunkResult{}, err
	}
	if err := out.Close(); err != nil {
		return WorkspaceEngineImportChunkResult{}, err
	}
	session.NextChunkIndex++
	if err := saveWorkspaceEngineImportSession(m.stateRoot, session); err != nil {
		return WorkspaceEngineImportChunkResult{}, err
	}
	return WorkspaceEngineImportChunkResult{
		UploadID:       session.UploadID,
		ReceivedBytes:  session.ReceivedBytes,
		ExpectedBytes:  session.ExpectedBytes,
		NextChunkIndex: session.NextChunkIndex,
	}, nil
}

func (m *RuntimeManager) CompleteImportSession(ctx context.Context, uploadID string) (RuntimeStatus, error) {
	if m == nil {
		return RuntimeStatus{}, errors.New("runtime manager not ready")
	}
	opCtx, err := m.operationContextForImportSession(uploadID)
	if err != nil {
		return RuntimeStatus{}, err
	}
	m.importSessionMu.Lock()
	defer m.importSessionMu.Unlock()

	session, err := loadWorkspaceEngineImportSession(m.stateRoot, uploadID)
	if err != nil {
		return RuntimeStatus{}, err
	}
	if session.ReceivedBytes != session.ExpectedBytes {
		return RuntimeStatus{}, fmt.Errorf("workspace engine upload is incomplete: got %d bytes, want %d", session.ReceivedBytes, session.ExpectedBytes)
	}
	version := strings.TrimSpace(session.Manifest.Version)
	m.setTargetVersion(version)
	m.setStage(RuntimeOperationStageVerifying)
	archivePath := workspaceEngineUploadPartPath(m.stateRoot, session.UploadID)
	stagePrefix := filepath.Join(sharedStagingRoot(m.stateRoot), sanitizePathSegment(session.OperationID))
	versionRoot := sharedVersionRoot(m.stateRoot, version)
	cleanupSessionArtifacts := func() {
		_ = os.RemoveAll(stagePrefix)
		_ = os.Remove(workspaceEngineUploadPartPath(m.stateRoot, session.UploadID))
		_ = os.Remove(workspaceEngineUploadSessionPath(m.stateRoot, session.UploadID))
	}
	if err := opCtx.Err(); err != nil {
		cleanupSessionArtifacts()
		m.finishOperation("", "", true)
		return m.Status(ctx), err
	}
	if err := verifyWorkspaceEngineArchive(archivePath, session.Manifest); err != nil {
		cleanupSessionArtifacts()
		m.finishOperation("artifact_validation_failed", err.Error(), false)
		return m.Status(ctx), err
	}
	if err := opCtx.Err(); err != nil {
		cleanupSessionArtifacts()
		m.finishOperation("", "", true)
		return m.Status(ctx), err
	}
	m.setStage(RuntimeOperationStageInstalling)
	if err := installWorkspaceEngineArchive(opCtx, archivePath, stagePrefix, session.Manifest); err != nil {
		cleanupSessionArtifacts()
		if errors.Is(err, context.Canceled) || errors.Is(opCtx.Err(), context.Canceled) {
			m.finishOperation("", "", true)
			return m.Status(ctx), err
		}
		m.finishOperation("artifact_install_failed", err.Error(), false)
		return m.Status(ctx), err
	}
	if err := opCtx.Err(); err != nil {
		cleanupSessionArtifacts()
		m.finishOperation("", "", true)
		return m.Status(ctx), err
	}
	m.setStage(RuntimeOperationStageFinalizing)
	var commitPromote func() error
	var revertPromote func() error
	err = withLocalEnvironmentRuntimeStateLock(m.stateRoot, func(state *localEnvironmentRuntimeState) error {
		if err := opCtx.Err(); err != nil {
			return err
		}
		if existing, ok := state.Versions[version]; ok {
			existingBinary := filepath.Join(versionRoot, strings.TrimSpace(existing.BinaryRelPath))
			err := probeRuntimeBinary(opCtx, existingBinary)
			if err == nil {
				state.SelectedVersion = version
				state.UpdatedAtUnixMs = m.now().UnixMilli()
				return repairManagedRuntimeLink(m.stateDir, m.stateRoot, version)
			}
			if errors.Is(err, context.Canceled) || errors.Is(opCtx.Err(), context.Canceled) {
				return err
			}
			delete(state.Versions, version)
		}
		binaryRelPath := normalizedWorkspaceEngineBinaryRelPath(session.Manifest)
		commit, revert, err := promoteManagedRuntime(stagePrefix, versionRoot)
		if err != nil {
			return err
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
		cleanupSessionArtifacts()
		if errors.Is(err, context.Canceled) || errors.Is(opCtx.Err(), context.Canceled) {
			m.finishOperation("", "", true)
			return m.Status(ctx), err
		}
		m.finishOperation("finalize_failed", err.Error(), false)
		return m.Status(ctx), err
	}
	if commitPromote != nil {
		if err := commitPromote(); err != nil {
			m.appendLog("Workspace engine backup cleanup failed: " + err.Error())
		}
	}
	cleanupSessionArtifacts()
	m.appendLog("The code workspace engine is ready for this environment.")
	m.finishOperation("", "", false)
	return m.Status(ctx), nil
}

func (m *RuntimeManager) operationContextForImportSession(uploadID string) (context.Context, error) {
	uploadID = strings.TrimSpace(uploadID)
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.operationState != RuntimeOperationStateRunning || m.operationAction != RuntimeOperationActionPrepareWorkspaceEngine || m.operationContext == nil {
		return nil, errors.New("workspace engine operation is not running")
	}
	if strings.TrimSpace(m.activeImportUploadID) != uploadID {
		return nil, errors.New("workspace engine import session is not active")
	}
	return m.operationContext, nil
}

func (m *RuntimeManager) CancelImportSession(ctx context.Context, uploadID string) error {
	if m == nil {
		return nil
	}
	m.importSessionMu.Lock()
	defer m.importSessionMu.Unlock()

	uploadID = sanitizePathSegment(uploadID)
	_ = os.Remove(workspaceEngineUploadPartPath(m.stateRoot, uploadID))
	_ = os.Remove(workspaceEngineUploadSessionPath(m.stateRoot, uploadID))
	return nil
}

func (m *RuntimeManager) CancelActiveImportSession(ctx context.Context) error {
	if m == nil {
		return nil
	}
	m.importSessionMu.Lock()
	defer m.importSessionMu.Unlock()

	entries, err := os.ReadDir(sharedUploadRoot(m.stateRoot))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	var firstErr error
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		uploadID := strings.TrimSuffix(entry.Name(), ".json")
		if err := m.removeImportSessionFiles(uploadID); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func (m *RuntimeManager) removeImportSessionFiles(uploadID string) error {
	uploadID = sanitizePathSegment(uploadID)
	_ = os.Remove(workspaceEngineUploadPartPath(m.stateRoot, uploadID))
	_ = os.Remove(workspaceEngineUploadSessionPath(m.stateRoot, uploadID))
	return nil
}

func sharedUploadRoot(stateRoot string) string {
	return filepath.Join(sharedDownloadsRoot(stateRoot), "uploads")
}

func workspaceEngineUploadPartPath(stateRoot string, uploadID string) string {
	return filepath.Join(sharedUploadRoot(stateRoot), sanitizePathSegment(uploadID)+".part")
}

func workspaceEngineUploadSessionPath(stateRoot string, uploadID string) string {
	return filepath.Join(sharedUploadRoot(stateRoot), sanitizePathSegment(uploadID)+".json")
}

func saveWorkspaceEngineImportSession(stateRoot string, session WorkspaceEngineImportSession) error {
	if err := os.MkdirAll(sharedUploadRoot(stateRoot), 0o700); err != nil {
		return err
	}
	body, err := json.MarshalIndent(session, "", "  ")
	if err != nil {
		return err
	}
	path := workspaceEngineUploadSessionPath(stateRoot, session.UploadID)
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

func loadWorkspaceEngineImportSession(stateRoot string, uploadID string) (WorkspaceEngineImportSession, error) {
	uploadID = sanitizePathSegment(uploadID)
	body, err := os.ReadFile(workspaceEngineUploadSessionPath(stateRoot, uploadID))
	if err != nil {
		return WorkspaceEngineImportSession{}, err
	}
	var session WorkspaceEngineImportSession
	if err := json.Unmarshal(body, &session); err != nil {
		return WorkspaceEngineImportSession{}, err
	}
	if session.UploadID == "" {
		session.UploadID = uploadID
	}
	return session, nil
}
