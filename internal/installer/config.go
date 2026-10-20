package installer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Config contains product installation choices, not trust or verification
// overrides. Publisher identities and verification policy are not configurable.
type Config struct {
	InstallerVersion string
	Channel          string
	Version          string
	Mode             string
	InstallDir       string
	Home             string
	Shell            string
	Output           io.Writer
}

func (c Config) normalized() (Config, error) {
	if c.Channel == "" {
		c.Channel = "github"
	}
	if c.Channel != "github" && c.Channel != "portal" {
		return c, errors.New("installation channel must be github or portal")
	}
	if c.Mode == "" {
		c.Mode = "install"
	}
	if c.Mode != "install" && c.Mode != "upgrade" {
		return c, errors.New("installation mode must be install or upgrade")
	}
	if c.Home == "" {
		var err error
		c.Home, err = os.UserHomeDir()
		if err != nil {
			return c, fmt.Errorf("find user home: %w", err)
		}
	}
	if !filepath.IsAbs(c.Home) || strings.ContainsAny(c.Home, "\x00\r\n") {
		return c, errors.New("user home must be an absolute single-line path")
	}
	if c.InstallDir == "" {
		c.InstallDir = filepath.Join(c.Home, ".redeven", "bin")
	}
	if !filepath.IsAbs(c.InstallDir) || strings.ContainsAny(c.InstallDir, "\x00\r\n") {
		return c, errors.New("installation directory must be an absolute single-line path")
	}
	c.InstallDir = filepath.Clean(c.InstallDir)
	for _, component := range strings.Split(c.InstallDir, string(filepath.Separator)) {
		if component == suiteDirectory {
			return c, errors.New("installation directory must be the stable activation root, not a runtime suite")
		}
	}
	if c.Output == nil {
		c.Output = os.Stdout
	}
	if c.Version != "" {
		if err := validateReleaseVersion(c.Version); err != nil {
			return c, err
		}
	}
	return c, nil
}

func platformName(goos, goarch string) (string, error) {
	if (goos != "linux" && goos != "darwin") || (goarch != "amd64" && goarch != "arm64") {
		return "", fmt.Errorf("unsupported platform %s/%s; Windows installation requires a supported Linux environment in WSL", goos, goarch)
	}
	return goos + "_" + goarch, nil
}

type releaseSource struct {
	versionURL string
	githubURL  string
	mirrorURL  string
}

func sourceFor(channel string) releaseSource {
	if channel == "portal" {
		return releaseSource{
			versionURL: "https://version.agent.redeven.com/v1/manifest.json",
			githubURL:  "https://github.com/floegence/redeven/releases/download",
			mirrorURL:  "https://agent.package.redeven.com/agent-install-pkg",
		}
	}
	return releaseSource{
		versionURL: "https://api.github.com/repos/floegence/redeven/releases/latest",
		githubURL:  "https://github.com/floegence/redeven/releases/download",
	}
}

func (s releaseSource) assetURLs(version, name string) []string {
	urls := []string{s.githubURL + "/" + version + "/" + name}
	if s.mirrorURL != "" {
		urls = append(urls, s.mirrorURL+"/"+version+"/"+name)
	}
	return urls
}

func resolveVersion(ctx context.Context, d *downloader, c Config, source releaseSource) (string, error) {
	if c.Version != "" {
		return c.Version, nil
	}
	data, err := d.metadata(ctx, []string{source.versionURL}, 1<<20)
	if err != nil {
		return "", fmt.Errorf("resolve release version: %w", err)
	}
	var metadata struct {
		Tag         string `json:"tag_name"`
		Recommended string `json:"recommended"`
		Latest      string `json:"latest"`
	}
	if err := json.Unmarshal(data, &metadata); err != nil {
		return "", fmt.Errorf("decode version metadata: %w", err)
	}
	version := metadata.Tag
	if c.Channel == "portal" {
		version = metadata.Recommended
		if version == "" {
			version = metadata.Latest
		}
	}
	if err := validateReleaseVersion(version); err != nil {
		return "", fmt.Errorf("unusable version metadata: %w", err)
	}
	return version, nil
}

func hostPlatform() (string, error) { return platformName(runtime.GOOS, runtime.GOARCH) }
