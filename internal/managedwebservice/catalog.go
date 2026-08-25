package managedwebservice

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"runtime"
	"strings"
	"time"

	redevpluginartifacts "github.com/floegence/redeven/spec/redevplugin"
)

const (
	defaultCatalogURL    = "https://version.agent.redeven.com/v1/managed-web-services/deepseek-harness/0.1.1-rc.2.json"
	defaultPackageOrigin = "https://agent.package.redeven.com"
	maxCatalogBytes      = 256 * 1024
	managedCatalogKeyID  = "redeven_official_signing_2026_08"
)

type signedCatalogEnvelope struct {
	SchemaVersion int    `json:"schema_version"`
	KeyID         string `json:"key_id"`
	Payload       string `json:"payload"`
	Signature     string `json:"signature"`
}

type catalogPayload struct {
	TemplateID string                    `json:"template_id"`
	Version    string                    `json:"version"`
	Platforms  map[string]nativeArtifact `json:"platforms"`
	Docker     map[string]dockerArtifact `json:"docker"`
}

type nativeArtifact struct {
	DownloadURL       string `json:"download_url"`
	SHA256            string `json:"sha256"`
	SizeBytes         int64  `json:"size_bytes"`
	ExecutableRelPath string `json:"executable_rel_path"`
}

type dockerArtifact struct {
	Image  string `json:"image"`
	Digest string `json:"digest"`
}

type catalogClient struct {
	client        *http.Client
	catalogURL    string
	packageOrigin string
	publicKey     ed25519.PublicKey
	keyID         string
}

func defaultCatalogClient() *catalogClient {
	key, _ := redevpluginartifacts.OfficialSigningPublicKey()
	return &catalogClient{
		client: &http.Client{Timeout: 70 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 4 {
				return errors.New("too many redirects")
			}
			if len(via) > 0 && req.URL.Host != via[0].URL.Host {
				return errors.New("cross-origin redirect rejected")
			}
			return nil
		}},
		catalogURL: defaultCatalogURL, packageOrigin: defaultPackageOrigin, publicKey: append(ed25519.PublicKey(nil), key.PublicKey...), keyID: key.KeyID,
	}
}

func (c *catalogClient) packageHTTPClient() *http.Client {
	if c == nil || c.client == nil {
		return nil
	}
	client := *c.client
	client.Timeout = 30 * time.Minute
	return &client
}

func (c *catalogClient) trusted() bool {
	return c != nil && c.keyID == managedCatalogKeyID && len(c.publicKey) == ed25519.PublicKeySize
}

func (c *catalogClient) resolve(ctx context.Context) (catalogPayload, error) {
	if !c.trusted() {
		return catalogPayload{}, serviceError("CATALOG_TRUST_UNAVAILABLE", "This Redeven build does not include the managed service catalog trust anchor.", 503, false, nil)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.catalogURL, nil)
	if err != nil {
		return catalogPayload{}, err
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return catalogPayload{}, serviceError("CATALOG_UNAVAILABLE", "The audited package catalog is unavailable.", 503, true, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return catalogPayload{}, serviceError("CATALOG_UNAVAILABLE", "The audited package catalog is unavailable.", 503, true, fmt.Errorf("catalog returned %s", resp.Status))
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxCatalogBytes+1))
	if err != nil {
		return catalogPayload{}, err
	}
	if len(body) > maxCatalogBytes {
		return catalogPayload{}, serviceError("CATALOG_INVALID", "The audited package catalog is invalid.", 502, false, nil)
	}
	var envelope signedCatalogEnvelope
	if err := decodeStrictJSON(body, &envelope); err != nil {
		return catalogPayload{}, serviceError("CATALOG_INVALID", "The audited package catalog is invalid.", 502, false, err)
	}
	if envelope.SchemaVersion != 1 || envelope.KeyID != c.keyID {
		return catalogPayload{}, serviceError("CATALOG_INVALID", "The audited package catalog has an unsupported schema or signing identity.", 502, false, nil)
	}
	payloadBytes, err := base64.StdEncoding.DecodeString(envelope.Payload)
	if err != nil {
		return catalogPayload{}, serviceError("CATALOG_INVALID", "The audited package catalog payload is invalid.", 502, false, err)
	}
	signature, err := base64.StdEncoding.DecodeString(envelope.Signature)
	if err != nil || !ed25519.Verify(c.publicKey, payloadBytes, signature) {
		return catalogPayload{}, serviceError("CATALOG_SIGNATURE_INVALID", "The audited package catalog signature is invalid.", 502, false, err)
	}
	var payload catalogPayload
	if err := decodeStrictJSON(payloadBytes, &payload); err != nil {
		return catalogPayload{}, serviceError("CATALOG_INVALID", "The audited package catalog payload is invalid.", 502, false, err)
	}
	if payload.TemplateID != DeepSeekHarnessTemplateID || payload.Version != DeepSeekHarnessVersion {
		return catalogPayload{}, serviceError("CATALOG_VERSION_MISMATCH", "The audited package catalog does not match the fixed DeepSeek Harness version.", 502, false, nil)
	}
	return payload, nil
}

func decodeStrictJSON(raw []byte, destination any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("trailing JSON value")
		}
		return err
	}
	return nil
}

func currentPlatformKey() string { return runtime.GOOS + "-" + runtime.GOARCH }

func validatePackageURL(raw, origin string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return err
	}
	trusted, err := url.Parse(origin)
	if err != nil {
		return err
	}
	if parsed.Scheme != "https" || parsed.Host != trusted.Host || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return errors.New("package URL is outside the audited package origin")
	}
	return nil
}
