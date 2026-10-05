package runtimeidentity

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// AccessIdentity identifies one Runtime state directory, never an authorization grant.
type AccessIdentity struct{ key ed25519.PrivateKey }

type AccessIdentityProof struct {
	Version   string `json:"version"`
	Challenge string `json:"challenge"`
	PublicKey string `json:"public_key"`
	Signature string `json:"signature"`
}

// LoadAccessIdentity publishes a complete immutable seed exclusively. Competing
// initializers read the winner; malformed existing material is never replaced.
func LoadAccessIdentity(stateDir string) (*AccessIdentity, error) {
	name := filepath.Join(stateDir, "access-identity.key")
	if err := os.MkdirAll(stateDir, 0700); err != nil {
		return nil, err
	}
	if _, err := os.Lstat(name); errors.Is(err, os.ErrNotExist) {
		seed := make([]byte, ed25519.SeedSize)
		if _, err := rand.Read(seed); err != nil {
			return nil, err
		}
		staged, err := os.CreateTemp(stateDir, ".access-identity-*")
		if err != nil {
			return nil, err
		}
		defer os.Remove(staged.Name())
		if _, err = staged.Write(seed); err == nil {
			err = staged.Sync()
		}
		closeErr := staged.Close()
		if err != nil {
			return nil, err
		}
		if closeErr != nil {
			return nil, closeErr
		}
		if err = os.Link(staged.Name(), name); err != nil && !errors.Is(err, os.ErrExist) {
			return nil, err
		}
	}
	info, err := os.Lstat(name)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() != ed25519.SeedSize {
		return nil, fmt.Errorf("invalid Runtime access identity at %s; preserve this file and restore the original identity", name)
	}
	seed, err := os.ReadFile(name)
	if err != nil {
		return nil, err
	}
	if len(seed) != ed25519.SeedSize {
		return nil, errors.New("Runtime access identity changed while reading")
	}
	return &AccessIdentity{key: ed25519.NewKeyFromSeed(seed)}, nil
}

func (i *AccessIdentity) Prove(challenge string) (AccessIdentityProof, error) {
	nonce, err := base64.RawURLEncoding.DecodeString(challenge)
	if err != nil || len(nonce) != 32 || base64.RawURLEncoding.EncodeToString(nonce) != challenge {
		return AccessIdentityProof{}, errors.New("invalid Runtime identity challenge")
	}
	if i == nil || len(i.key) != ed25519.PrivateKeySize {
		return AccessIdentityProof{}, errors.New("Runtime access identity unavailable")
	}
	return AccessIdentityProof{
		Version: "redeven-runtime-access-v1", Challenge: challenge,
		PublicKey: base64.RawURLEncoding.EncodeToString(i.key.Public().(ed25519.PublicKey)),
		Signature: base64.RawURLEncoding.EncodeToString(ed25519.Sign(i.key, []byte("redeven-runtime-access-v1\n"+challenge))),
	}, nil
}
