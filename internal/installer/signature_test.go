package installer

import (
	"context"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestReleaseVersionRequiresCanonicalTag(t *testing.T) {
	for _, version := range []string{"", "latest", "1.2.3", "v1.2", "v01.2.3", "v1.2.3/../../main", "v1.2.3\n"} {
		if err := validateReleaseVersion(version); err == nil {
			t.Errorf("accepted unsafe release tag %q", version)
		}
	}
	for _, version := range []string{"v0.13.12", "v1.2.3-rc.1", "v1.2.3+build.1"} {
		if err := validateReleaseVersion(version); err != nil {
			t.Errorf("rejected canonical release tag %q: %v", version, err)
		}
	}
}

func TestInvalidSignatureMaterialFailsClosed(t *testing.T) {
	verifier := &releaseVerifier{}
	for _, payload := range [][]byte{nil, []byte("untrusted checksums")} {
		if err := verifier.verify(context.Background(), payload, []byte("bad signature"), []byte("not a certificate"), "v0.13.12"); err == nil {
			t.Fatal("invalid signature material was accepted")
		}
	}
}

func TestPublishedReleaseVerification(t *testing.T) {
	dir := os.Getenv("REDEVEN_INSTALLER_VERIFY_FIXTURE_DIR")
	if dir == "" {
		t.Skip("set REDEVEN_INSTALLER_VERIFY_FIXTURE_DIR to run authenticated live-release verification")
	}
	read := func(name string) []byte {
		t.Helper()
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		return data
	}
	payload, signature, certificate := read("SHA256SUMS"), read("SHA256SUMS.sig"), read("SHA256SUMS.pem")
	// User-provided trust paths and log endpoints must not weaken the embedded
	// publisher policy or redirect trust lookup to attacker-supplied material.
	t.Setenv("SIGSTORE_ROOT_FILE", filepath.Join(t.TempDir(), "untrusted-root"))
	t.Setenv("SIGSTORE_REKOR_PUBLIC_KEY", filepath.Join(t.TempDir(), "untrusted-log"))
	t.Setenv("COSIGN_EXPERIMENTAL", "0")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	verifier, err := newReleaseVerifier(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := verifier.verify(ctx, payload, signature, certificate, "v0.13.12"); err != nil {
		t.Fatalf("official immutable release was rejected: %v", err)
	}
	if decoded, err := base64.StdEncoding.DecodeString(string(certificate)); err == nil {
		if err := verifier.verify(ctx, payload, signature, decoded, "v0.13.12"); err != nil {
			t.Fatalf("documented PEM certificate form was rejected: %v", err)
		}
	}
	if err := verifier.verify(ctx, append([]byte("tampered\n"), payload...), signature, certificate, "v0.13.12"); err == nil {
		t.Fatal("tampered checksums were accepted")
	}
	if err := verifier.verify(ctx, payload, signature, certificate, "v0.13.11"); err == nil {
		t.Fatal("cross-tag replay was accepted")
	}
}
