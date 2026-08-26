package managedwebservice

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"runtime"
	"strings"
	"time"
)

const (
	defaultNodePackageOrigin = "https://nodejs.org"
	deepSeekRuntimeBundleID  = "deepseek-harness-0.1.1-rc.2-node-24.19.0"
)

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
	ArchiveRoot       string `json:"archive_root"`
	NodeRelPath       string `json:"node_rel_path"`
	NPMCLIRelPath     string `json:"npm_cli_rel_path"`
	ExecutableRelPath string `json:"executable_rel_path"`
}

type dockerArtifact struct {
	Image  string `json:"image"`
	Digest string `json:"digest"`
}

type packageDownloadClient struct {
	client *http.Client
}

func defaultPackageDownloadClient() *packageDownloadClient {
	return &packageDownloadClient{
		client: &http.Client{Timeout: 70 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 4 {
				return errors.New("too many redirects")
			}
			if len(via) > 0 && req.URL.Host != via[0].URL.Host {
				return errors.New("cross-origin redirect rejected")
			}
			return nil
		}},
	}
}

func (c *packageDownloadClient) packageHTTPClient() *http.Client {
	if c == nil || c.client == nil {
		return nil
	}
	client := *c.client
	client.Timeout = 30 * time.Minute
	return &client
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

func auditedNativeArtifact(platform string) (nativeArtifact, bool) {
	const nodeVersion = "24.19.0"
	type identity struct {
		SHA256 string
		Size   int64
	}
	identities := map[string]identity{
		"darwin-arm64": {SHA256: "8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d", Size: 52234372},
		"darwin-amd64": {SHA256: "d1b5e999db158c62fe8f7267a4476b035d8bd93b1a605bac24a3f0dd166e3316", Size: 53439583},
		"linux-arm64":  {SHA256: "d28c8a5bf0a808f0ed434a1dce8c54ae98f0371c0bd86ac58abc613f73e6643f", Size: 57128466},
		"linux-amd64":  {SHA256: "f625d97cd707df4ff96254916fbc5ff014f09c09effe5a1e0ca8f6d41a8789d4", Size: 57409532},
	}
	entry, ok := identities[platform]
	if !ok {
		return nativeArtifact{}, false
	}
	parts := strings.Split(platform, "-")
	if len(parts) != 2 {
		return nativeArtifact{}, false
	}
	arch := parts[1]
	if arch == "amd64" {
		arch = "x64"
	}
	archiveRoot := "node-v" + nodeVersion + "-" + parts[0] + "-" + arch
	return nativeArtifact{
		DownloadURL:       defaultNodePackageOrigin + "/dist/v" + nodeVersion + "/" + archiveRoot + ".tar.gz",
		SHA256:            entry.SHA256,
		SizeBytes:         entry.Size,
		ArchiveRoot:       archiveRoot,
		NodeRelPath:       archiveRoot + "/bin/node",
		NPMCLIRelPath:     archiveRoot + "/lib/node_modules/npm/bin/npm-cli.js",
		ExecutableRelPath: "bin/dsh",
	}, true
}

func auditedNativeCatalog() catalogPayload {
	platforms := make(map[string]nativeArtifact, 4)
	for _, platform := range []string{"darwin-arm64", "darwin-amd64", "linux-arm64", "linux-amd64"} {
		artifact, _ := auditedNativeArtifact(platform)
		platforms[platform] = artifact
	}
	return catalogPayload{TemplateID: DeepSeekHarnessTemplateID, Version: DeepSeekHarnessVersion, Platforms: platforms}
}

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
