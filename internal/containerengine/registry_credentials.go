package containerengine

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var credentialHelperPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`)

var registryCredentialHelperTimeout = 5 * time.Second

type registryAuthDocument struct {
	Auths map[string]struct {
		Auth string `json:"auth"`
	} `json:"auths"`
	CredHelpers map[string]string `json:"credHelpers"`
	CredsStore  string            `json:"credsStore"`
}

func (c *CLIClient) RegistryCredential(ctx context.Context, engine Engine, registryHost string) (RegistryCredential, error) {
	if err := validateEngine(engine); err != nil {
		return RegistryCredential{}, err
	}
	registryHost = normalizedCredentialRegistryHost(registryHost)
	for _, path := range c.registryCredentialPaths(engine) {
		raw, err := os.ReadFile(path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return RegistryCredential{}, err
		}
		var document registryAuthDocument
		if err := json.Unmarshal(raw, &document); err != nil {
			return RegistryCredential{}, err
		}
		for _, key := range registryCredentialKeys(registryHost) {
			if entry, ok := document.Auths[key]; ok && strings.TrimSpace(entry.Auth) != "" {
				decoded, decodeErr := base64.StdEncoding.DecodeString(strings.TrimSpace(entry.Auth))
				if decodeErr != nil {
					return RegistryCredential{}, decodeErr
				}
				username, secret, found := strings.Cut(string(decoded), ":")
				if found {
					return RegistryCredential{Username: username, Secret: secret}, nil
				}
			}
		}
		helper := ""
		for _, key := range registryCredentialKeys(registryHost) {
			if value := strings.TrimSpace(document.CredHelpers[key]); value != "" {
				helper = value
				break
			}
		}
		if helper == "" {
			helper = strings.TrimSpace(document.CredsStore)
		}
		if helper != "" {
			return readRegistryCredentialHelper(ctx, helper, registryHost)
		}
	}
	return RegistryCredential{}, nil
}

func (c *CLIClient) registryCredentialPaths(engine Engine) []string {
	paths := []string{}
	if engine == EngineDocker {
		if directory := c.dockerConfigurationDirectory(); directory != "" {
			paths = append(paths, filepath.Join(directory, "config.json"))
		}
		return paths
	}
	if path, ok := c.environmentValue("REGISTRY_AUTH_FILE"); ok && filepath.IsAbs(path) {
		paths = append(paths, filepath.Clean(path))
	}
	if directory, ok := c.environmentValue("XDG_RUNTIME_DIR"); ok && filepath.IsAbs(directory) {
		paths = append(paths, filepath.Join(directory, "containers", "auth.json"))
	}
	if directory := c.userConfigDirectory(); directory != "" {
		paths = append(paths, filepath.Join(directory, "containers", "auth.json"))
	}
	return paths
}

func normalizedCredentialRegistryHost(value string) string {
	value = strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(value, "https://"), "http://"))
	value = strings.TrimSuffix(value, "/")
	if value == "registry-1.docker.io" || value == "docker.io" {
		return "index.docker.io"
	}
	return value
}

func registryCredentialKeys(host string) []string {
	keys := []string{host, "https://" + host, "https://" + host + "/v1/"}
	if host == "index.docker.io" {
		keys = append(keys, "https://index.docker.io/v1/", "registry-1.docker.io", "https://registry-1.docker.io")
	}
	return keys
}

func readRegistryCredentialHelper(ctx context.Context, helper, server string) (RegistryCredential, error) {
	if !credentialHelperPattern.MatchString(helper) {
		return RegistryCredential{}, errors.New("invalid container credential helper name")
	}
	helperContext, cancel := context.WithTimeout(ctx, registryCredentialHelperTimeout)
	defer cancel()
	cmd := exec.CommandContext(helperContext, "docker-credential-"+helper, "get")
	cmd.Stdin = strings.NewReader(server + "\n")
	var stdout bytes.Buffer
	cmd.Stdout = &limitedCredentialWriter{destination: &stdout, remaining: 1 << 20}
	cmd.Stderr = io.Discard
	if err := cmd.Run(); err != nil {
		if helperContext.Err() != nil {
			return RegistryCredential{}, helperContext.Err()
		}
		return RegistryCredential{}, err
	}
	var response struct {
		Username string
		Secret   string
	}
	if err := json.Unmarshal(stdout.Bytes(), &response); err != nil {
		return RegistryCredential{}, err
	}
	return RegistryCredential{Username: response.Username, Secret: response.Secret}, nil
}

type limitedCredentialWriter struct {
	destination io.Writer
	remaining   int64
}

func (w *limitedCredentialWriter) Write(value []byte) (int, error) {
	if int64(len(value)) > w.remaining {
		return 0, errors.New("container credential helper response is too large")
	}
	written, err := w.destination.Write(value)
	w.remaining -= int64(written)
	return written, err
}
