package accessgate

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"golang.org/x/crypto/bcrypt"
)

const credentialFileName = "local-ui-password.bcrypt"

// ReadPasswordHash reads only a private regular file. Absence is distinct from
// a damaged credential, which must stop startup instead of removing the gate.
func ReadPasswordHash(stateDir string) ([]byte, error) {
	path := filepath.Join(stateDir, credentialFileName)
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read environment password: %w", err)
	}
	if !info.Mode().IsRegular() || info.Size() > 128 || (runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0) {
		return nil, errors.New("environment password must be a private regular file with mode 0600")
	}
	hash, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read environment password: %w", err)
	}
	if _, err := bcrypt.Cost(hash); err != nil {
		return nil, errors.New("invalid stored environment password; set a new password explicitly")
	}
	return hash, nil
}

func HashPassword(password string) ([]byte, error) {
	if password == "" {
		return nil, errors.New("environment password cannot be empty")
	}
	if len([]byte(password)) > 72 {
		return nil, errors.New("environment password must be at most 72 UTF-8 bytes")
	}
	return bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
}

// WritePasswordHash is called by the Runtime owner under its state lock.
// Clearing is explicit; an omitted startup secret never clears a saved hash.
func WritePasswordHash(stateDir string, hash []byte) error {
	path := filepath.Join(stateDir, credentialFileName)
	if len(hash) == 0 {
		err := os.Remove(path)
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if _, err := bcrypt.Cost(hash); err != nil {
		return errors.New("invalid environment password hash")
	}
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		return err
	}
	f, err := os.CreateTemp(stateDir, ".local-ui-password-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	defer f.Close()
	if _, err := f.Write(hash); err != nil {
		return err
	}
	if err := f.Sync(); err != nil {
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}
