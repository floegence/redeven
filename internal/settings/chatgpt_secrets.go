package settings

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"time"

	"github.com/floegence/redeven/internal/lockfile"
)

// ChatGPTAccount is a protected registration record. It must never be encoded
// into a product API response; account status is projected separately.
type ChatGPTAccount struct {
	Issuer              string    `json:"issuer"`
	Subject             string    `json:"subject"`
	Email               string    `json:"email"`
	ClientID            string    `json:"client_id"`
	IDToken             string    `json:"id_token,omitempty"`
	AccessToken         string    `json:"access_token,omitempty"`
	RefreshToken        string    `json:"refresh_token,omitempty"`
	Scopes              []string  `json:"scopes,omitempty"`
	ExpiresAt           time.Time `json:"expires_at"`
	EarliestRefreshAt   time.Time `json:"earliest_refresh_at"`
	WelcomeAcknowledged bool      `json:"welcome_acknowledged,omitempty"`
	SessionRevision     uint64    `json:"session_revision,omitempty"`
	Lifecycle           string    `json:"lifecycle,omitempty"`
	ErrorCode           string    `json:"error_code,omitempty"`
	RevocationConfirmed *bool     `json:"revocation_confirmed,omitempty"`
	SignedOutAt         time.Time `json:"signed_out_at,omitempty"`
	RetryAt             time.Time `json:"retry_at,omitempty"`
	HTTPStatus          int       `json:"http_status,omitempty"`
	RequestID           string    `json:"request_id,omitempty"`
}

func (a ChatGPTAccount) ID() string {
	digest := sha256.Sum256([]byte(a.Issuer + "\x00" + a.Subject + "\x00" + a.ClientID))
	return "chatgpt_" + hex.EncodeToString(digest[:16])
}
func (a ChatGPTAccount) PlanEnabled() bool {
	return a.AccessToken != "" && slices.Contains(a.Scopes, "chatgpt.tokens.use.direct") && slices.Contains(a.Scopes, "resource.invoke")
}

type chatGPTSecrets struct {
	HostID   string                    `json:"host_id"`
	Accounts map[string]ChatGPTAccount `json:"accounts,omitempty"`
}

// All file access shares one OS lock, including API-key writes, so a Runtime
// and Desktop connector cannot overwrite a rotating token or each other's keys.
func (s *SecretsStore) lock(ctx context.Context) (func(), error) {
	if s == nil || s.path == "" {
		return nil, errors.New("missing secrets store")
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	for !s.mu.TryLock() {
		if err := waitForSecretsLock(ctx); err != nil {
			return nil, err
		}
	}
	if err := ctx.Err(); err != nil {
		s.mu.Unlock()
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		s.mu.Unlock()
		return nil, err
	}
	for {
		lock, err := lockfile.Acquire(s.path + ".lock")
		if err == nil {
			return func() { _ = lock.Release(); s.mu.Unlock() }, nil
		}
		if !errors.Is(err, lockfile.ErrAlreadyLocked) {
			s.mu.Unlock()
			return nil, err
		}
		if err := waitForSecretsLock(ctx); err != nil {
			s.mu.Unlock()
			return nil, err
		}
	}
}

func waitForSecretsLock(ctx context.Context) error {
	timer := time.NewTimer(25 * time.Millisecond)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (s *SecretsStore) ChatGPTHostID(ctx context.Context) (string, error) {
	unlock, err := s.lock(ctx)
	if err != nil {
		return "", err
	}
	defer unlock()
	sf, err := s.loadLocked()
	if err != nil {
		return "", err
	}
	if sf.ChatGPT == nil {
		sf.ChatGPT = &chatGPTSecrets{}
	}
	if sf.ChatGPT.HostID == "" {
		var bytes [16]byte
		if _, err := rand.Read(bytes[:]); err != nil {
			return "", err
		}
		bytes[6] = bytes[6]&0x0f | 0x40
		bytes[8] = bytes[8]&0x3f | 0x80
		sf.ChatGPT.HostID = fmt.Sprintf("urn:uuid:%x-%x-%x-%x-%x", bytes[:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:])
		if err := s.saveLocked(sf); err != nil {
			return "", err
		}
	}
	return sf.ChatGPT.HostID, nil
}

func (s *SecretsStore) ChatGPTAccount(id string) (ChatGPTAccount, bool, error) {
	unlock, err := s.lock(context.Background())
	if err != nil {
		return ChatGPTAccount{}, false, err
	}
	defer unlock()
	sf, err := s.loadLocked()
	if err != nil {
		return ChatGPTAccount{}, false, err
	}
	if sf.ChatGPT == nil {
		return ChatGPTAccount{}, false, nil
	}
	a, ok := sf.ChatGPT.Accounts[id]
	a.Scopes = slices.Clone(a.Scopes)
	return a, ok, nil
}

// UpdateChatGPTAccount locks only the canonical read and atomic replacement.
// Network operations use the separate per-account operation lock.
func (s *SecretsStore) UpdateChatGPTAccount(ctx context.Context, id string, update func(*ChatGPTAccount) error) error {
	unlock, err := s.lock(ctx)
	if err != nil {
		return err
	}
	defer unlock()
	sf, err := s.loadLocked()
	if err != nil {
		return err
	}
	if sf.ChatGPT == nil {
		sf.ChatGPT = &chatGPTSecrets{}
	}
	if sf.ChatGPT.Accounts == nil {
		sf.ChatGPT.Accounts = map[string]ChatGPTAccount{}
	}
	account := sf.ChatGPT.Accounts[id]
	previous := account
	previous.Scopes = slices.Clone(account.Scopes)
	if err := update(&account); err != nil {
		return err
	}
	if account.Issuer == "" || account.Subject == "" || account.ClientID == "" || account.ClientID == "dynamic_agent_client" || account.ID() != id {
		return errors.New("invalid ChatGPT registration identity")
	}
	if reflect.DeepEqual(previous, account) {
		return nil
	}
	sf.ChatGPT.Accounts[id] = account
	return s.saveLocked(sf)
}

// LockChatGPTAccountOperation serializes rotating refresh and revocation for one
// registration across processes without blocking other credential operations.
func (s *SecretsStore) LockChatGPTAccountOperation(ctx context.Context, id string) (func(), error) {
	if s == nil || s.path == "" {
		return nil, errors.New("missing secrets store")
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0700); err != nil {
		return nil, err
	}
	digest := sha256.Sum256([]byte(id))
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		lock, err := lockfile.Acquire(s.path + ".chatgpt-" + hex.EncodeToString(digest[:16]) + ".lock")
		if err == nil {
			return func() { _ = lock.Release() }, nil
		}
		if !errors.Is(err, lockfile.ErrAlreadyLocked) {
			return nil, err
		}
		if err := waitForSecretsLock(ctx); err != nil {
			return nil, err
		}
	}
}

func (s *SecretsStore) ChatGPTAccounts(ctx context.Context) (map[string]ChatGPTAccount, error) {
	unlock, err := s.lock(ctx)
	if err != nil {
		return nil, err
	}
	defer unlock()
	sf, err := s.loadLocked()
	if err != nil {
		return nil, err
	}
	out := map[string]ChatGPTAccount{}
	if sf.ChatGPT != nil {
		for id, account := range sf.ChatGPT.Accounts {
			account.Scopes = slices.Clone(account.Scopes)
			out[id] = account
		}
	}
	return out, nil
}

// InstallChatGPTAccounts atomically commits verified sign-ins.
// Callers serialize each account's operation before entering this short lock.
func (s *SecretsStore) InstallChatGPTAccounts(ctx context.Context, accounts []ChatGPTAccount) error {
	if len(accounts) == 0 {
		return nil
	}
	unlock, err := s.lock(ctx)
	if err != nil {
		return err
	}
	defer unlock()
	sf, err := s.loadLocked()
	if err != nil {
		return err
	}
	if sf.ChatGPT == nil {
		sf.ChatGPT = &chatGPTSecrets{}
	}
	if sf.ChatGPT.Accounts == nil {
		sf.ChatGPT.Accounts = map[string]ChatGPTAccount{}
	}
	for _, next := range accounts {
		old := sf.ChatGPT.Accounts[next.ID()]
		if next.Issuer == "" || next.Subject == "" || next.ClientID == "" || next.ClientID == "dynamic_agent_client" || old.Lifecycle == "signing_out" || old.SessionRevision+1 != next.SessionRevision {
			return errors.New("ChatGPT sign-in is no longer current")
		}
		sf.ChatGPT.Accounts[next.ID()] = next
	}
	return s.saveLocked(sf)
}
