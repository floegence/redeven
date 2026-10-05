package runtimeidentity

import (
	"crypto/ed25519"
	"encoding/base64"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestAccessIdentityPersistsAndSignsBoundedChallenges(t *testing.T) {
	dir := t.TempDir()
	key, err := LoadAccessIdentity(dir)
	if err != nil {
		t.Fatal(err)
	}
	nonce := base64.RawURLEncoding.EncodeToString(make([]byte, 32))
	proof, err := key.Prove(nonce)
	if err != nil {
		t.Fatal(err)
	}
	public, _ := base64.RawURLEncoding.DecodeString(proof.PublicKey)
	signature, _ := base64.RawURLEncoding.DecodeString(proof.Signature)
	if !ed25519.Verify(public, []byte("redeven-runtime-access-v1\n"+nonce), signature) {
		t.Fatal("proof is not bound to challenge and domain")
	}
	again, err := LoadAccessIdentity(dir)
	if err != nil {
		t.Fatal(err)
	}
	second, _ := again.Prove(nonce)
	if proof != second {
		t.Fatal("restart changed identity")
	}
	for _, invalid := range []string{"", "a", nonce + "=", nonce + "\n"} {
		if _, err := key.Prove(invalid); err == nil {
			t.Fatal("accepted invalid challenge")
		}
	}
}

func TestAccessIdentityNeverReplacesCorruptState(t *testing.T) {
	dir := t.TempDir()
	name := filepath.Join(dir, "access-identity.key")
	original := []byte("invalid private key")
	if err := os.WriteFile(name, original, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadAccessIdentity(dir); err == nil {
		t.Fatal("accepted corrupt key")
	}
	got, _ := os.ReadFile(name)
	if string(got) != string(original) {
		t.Fatal("replaced corrupt identity")
	}
}

func TestAccessIdentityConcurrentInitialization(t *testing.T) {
	dir := t.TempDir()
	var wg sync.WaitGroup
	keys := make(chan string, 8)
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			key, err := LoadAccessIdentity(dir)
			if err != nil {
				t.Error(err)
				return
			}
			proof, _ := key.Prove(base64.RawURLEncoding.EncodeToString(make([]byte, 32)))
			keys <- proof.PublicKey
		}()
	}
	wg.Wait()
	close(keys)
	first := ""
	for key := range keys {
		if first != "" && first != key {
			t.Fatal("published different identities")
		}
		first = key
	}
}
