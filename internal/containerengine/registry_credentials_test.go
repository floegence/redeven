package containerengine

import (
	"context"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func TestRegistryCredentialReadsDockerAndPodmanStoresWithoutCopyingFiles(t *testing.T) {
	t.Run("docker", func(t *testing.T) {
		directory := t.TempDir()
		writeRegistryAuthFixture(t, filepath.Join(directory, "config.json"), "https://index.docker.io/v1/", "docker-user", "docker-secret")
		client := &CLIClient{DockerConfigDir: func() string { return directory }}
		credential, err := client.RegistryCredential(context.Background(), EngineDocker, "registry-1.docker.io")
		if err != nil {
			t.Fatal(err)
		}
		if credential.Username != "docker-user" || credential.Secret != "docker-secret" {
			t.Fatalf("unexpected Docker credential: %#v", credential)
		}
	})

	t.Run("podman", func(t *testing.T) {
		directory := t.TempDir()
		authFile := filepath.Join(directory, "auth.json")
		writeRegistryAuthFixture(t, authFile, "quay.io", "podman-user", "podman-secret")
		client := &CLIClient{Environment: func(name string) (string, bool) {
			if name == "REGISTRY_AUTH_FILE" {
				return authFile, true
			}
			return "", false
		}}
		credential, err := client.RegistryCredential(context.Background(), EnginePodman, "quay.io")
		if err != nil {
			t.Fatal(err)
		}
		if credential.Username != "podman-user" || credential.Secret != "podman-secret" {
			t.Fatalf("unexpected Podman credential: %#v", credential)
		}
	})
}

func writeRegistryAuthFixture(t *testing.T, path, host, username, secret string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	auth := base64.StdEncoding.EncodeToString([]byte(username + ":" + secret))
	raw := []byte(`{"auths":{"` + host + `":{"auth":"` + auth + `"}}}`)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
}
