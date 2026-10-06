package gatewaystate

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
)

var ErrState = errors.New("gateway state is invalid or unavailable")

const maxStateBytes = 64 << 20

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
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > maxStateBytes {
		return ErrState
	}
	file, err := os.Open(path)
	if err != nil {
		return ErrState
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, maxStateBytes+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(state); err != nil {
		return ErrState
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return ErrState
	}
	return nil
}
