package accessgate

import (
	"encoding/json"
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
func readLegacyPasswordHash(stateDir string) ([]byte, error) {
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
	if _, err := os.Lstat(filepath.Join(stateDir, authKeyName)); !errors.Is(err, os.ErrNotExist) {
		store, state, err := openAuthStore(stateDir, nil)
		if err != nil {
			return err
		}
		defer store.db.Close()
		if state.Secret != "" || state.RecoveryPending {
			return errors.New("use authenticated security settings to change a protected environment password")
		}
		if len(hash) > 0 {
			if _, err := bcrypt.Cost(hash); err != nil {
				return err
			}
		}
		state.PasswordHash = append([]byte(nil), hash...)
		state.Revision++
		return store.save(state)
	}

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

// ReadPasswordHash reads the single committed authority after migration.
func ReadPasswordHash(stateDir string) ([]byte, error) {
	if _, err := os.Lstat(filepath.Join(stateDir, authKeyName)); errors.Is(err, os.ErrNotExist) {
		if _, dbErr := os.Lstat(filepath.Join(stateDir, authDatabaseName)); errors.Is(dbErr, os.ErrNotExist) {
			return readLegacyPasswordHash(stateDir)
		}
	}
	// Interrupted first initialization has no committed authority yet. Only the
	// private legacy verifier may supply the initial policy; this read never writes.
	if raw, err := os.ReadFile(filepath.Join(stateDir, authKeyName)); err == nil {
		var key authKey
		if json.Unmarshal(raw, &key) == nil && !key.Initialized {
			info, statErr := os.Lstat(filepath.Join(stateDir, authDatabaseName))
			if errors.Is(statErr, os.ErrNotExist) || (statErr == nil && info.Size() == 0) {
				return readLegacyPasswordHash(stateDir)
			}
		}
	}
	store, state, err := openAuthStoreMode(stateDir, nil, true)
	if err != nil {
		return nil, err
	}
	defer store.db.Close()
	return append([]byte(nil), state.PasswordHash...), nil
}
