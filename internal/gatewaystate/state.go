package gatewaystate

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

var ErrState = errors.New("gateway state is invalid or unavailable")

const maxStateBytes = 64 << 20

// ReadError describes a rejected state file without exposing its contents.
type ReadError struct {
	Code    string
	File    string
	Message string
}

func (e *ReadError) Error() string { return e.File + ": " + e.Message }
func (e *ReadError) Unwrap() error { return ErrState }

func readError(path, code, message string) error {
	return &ReadError{Code: code, File: filepath.Base(path), Message: message}
}

// Write publishes complete private state after syncing its contents.
func Write(path string, state any) error {
	raw, err := json.Marshal(state)
	if err != nil || len(raw) > maxStateBytes {
		return ErrState
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return ErrState
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".gateway-state-*")
	if err != nil {
		return ErrState
	}
	name := file.Name()
	defer os.Remove(name)
	defer file.Close()
	if err := file.Chmod(0600); err != nil {
		return ErrState
	}
	if _, err := file.Write(raw); err != nil {
		return ErrState
	}
	if err := file.Sync(); err != nil {
		return ErrState
	}
	if err := file.Close(); err != nil {
		return ErrState
	}
	if err := os.Rename(name, path); err != nil {
		return ErrState
	}
	dir, err := os.Open(filepath.Dir(path))
	if err != nil {
		return ErrState
	}
	defer dir.Close()
	if err := dir.Sync(); err != nil {
		return ErrState
	}
	return nil
}

func Read(path string, state any) error {
	return read(path, state, 0)
}

// ReadVersioned rejects any other schema before decoding the current contract.
// Schema inspection grants no compatibility or permission to rewrite old state.
func ReadVersioned(path string, state any, expectedVersion int) error {
	return read(path, state, expectedVersion)
}

func read(path string, state any, expectedVersion int) error {
	info, err := os.Lstat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return err
		}
		return readError(path, "gateway_state_unavailable", "state file could not be inspected; check file access")
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > maxStateBytes {
		return readError(path, "gateway_state_invalid", "state file must be a private regular file within the size limit")
	}
	file, err := os.Open(path)
	if err != nil {
		return readError(path, "gateway_state_unavailable", "state file could not be opened; check file access")
	}
	defer file.Close()
	if expectedVersion > 0 {
		var header struct {
			SchemaVersion int `json:"schema_version"`
		}
		if json.NewDecoder(io.LimitReader(file, maxStateBytes+1)).Decode(&header) != nil || header.SchemaVersion < 1 {
			return readError(path, "gateway_state_invalid", "state file has an invalid schema_version")
		}
		if header.SchemaVersion != expectedVersion {
			return readError(path, "gateway_state_unsupported", fmt.Sprintf("unsupported schema_version %d; expected %d; existing state was not changed", header.SchemaVersion, expectedVersion))
		}
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			return readError(path, "gateway_state_unavailable", "state file could not be read")
		}
	}
	decoder := json.NewDecoder(io.LimitReader(file, maxStateBytes+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(state); err != nil {
		return readError(path, "gateway_state_invalid", "state file does not match the current contract; existing state was not changed")
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return readError(path, "gateway_state_invalid", "state file contains trailing data; existing state was not changed")
	}
	return nil
}
