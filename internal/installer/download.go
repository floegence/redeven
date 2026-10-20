package installer

import (
	"bufio"
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/floegence/floe-native-apps/artifactcache"
)

const maxArchiveBytes int64 = 512 << 20

type downloader struct {
	client *http.Client
	output io.Writer
	cache  string
}

func newDownloader(cache string, output io.Writer) *downloader {
	allowed := map[string]bool{
		"https://github.com": true, "https://api.github.com": true,
		"https://objects.githubusercontent.com": true, "https://release-assets.githubusercontent.com": true,
		"https://raw.githubusercontent.com": true, "https://redeven.com": true,
		"https://agent.package.redeven.com": true, "https://version.agent.redeven.com/v1/manifest.json": true,
	}
	return &downloader{
		cache: cache, output: output,
		client: &http.Client{Timeout: 2 * time.Minute, CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 8 || req.URL.Scheme != "https" || req.URL.User != nil || !(allowed[req.URL.Scheme+"://"+req.URL.Host] || allowed[req.URL.String()]) {
				return errors.New("download redirect is outside the official HTTPS distribution sources")
			}
			return nil
		}},
	}
}

func (d *downloader) request(ctx context.Context, method, url string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Redeven-Installer")
	req.Header.Set("Accept-Encoding", "identity")
	return d.client.Do(req)
}

func (d *downloader) metadata(ctx context.Context, urls []string, limit int64) ([]byte, error) {
	var failures []error
	for _, url := range urls {
		response, err := d.request(ctx, http.MethodGet, url)
		if err != nil {
			failures = append(failures, err)
			continue
		}
		if response.StatusCode != http.StatusOK {
			response.Body.Close()
			failures = append(failures, fmt.Errorf("download metadata: HTTP %d", response.StatusCode))
			continue
		}
		data, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
		response.Body.Close()
		if err != nil {
			failures = append(failures, err)
			continue
		}
		if len(data) == 0 || int64(len(data)) > limit {
			return nil, errors.New("downloaded metadata is empty or exceeds its size limit")
		}
		return data, nil
	}
	return nil, errors.Join(failures...)
}

func (d *downloader) archive(ctx context.Context, urls []string, digest, label string) (string, error) {
	// SHA256SUMS authenticates the digest. HTTP length is only an untrusted,
	// bounded transfer size: it cannot authorize different bytes. The published
	// artifactcache owns acquisition, mirror fallback, hashing and publication.
	var size int64
	var failures []error
	for _, url := range urls {
		response, err := d.request(ctx, http.MethodHead, url)
		if err != nil {
			failures = append(failures, err)
			continue
		}
		response.Body.Close()
		if response.StatusCode == http.StatusOK && response.ContentLength > 0 && response.ContentLength <= maxArchiveBytes {
			size = response.ContentLength
			break
		}
		failures = append(failures, fmt.Errorf("invalid archive size or HTTP status: %d", response.StatusCode))
	}
	if size == 0 {
		return "", fmt.Errorf("inspect %s transfer size: %w", label, errors.Join(failures...))
	}
	lastPercent := -10
	result, err := artifactcache.Acquire(ctx, d.cache, artifactcache.Spec{
		URL: urls[0], Mirrors: urls[1:], SHA256: digest, SizeBytes: size,
	}, artifactcache.Options{Client: d.client, PreferredSource: -1, OnProgress: func(p artifactcache.Progress) error {
		if p.Phase == "downloading" {
			percent := int(p.ReceivedBytes * 100 / p.TotalBytes)
			if percent >= lastPercent+10 {
				fmt.Fprintf(d.output, "Downloading %s: %d%%\n", label, percent)
				lastPercent = percent
			}
		}
		return ctx.Err()
	}})
	if err != nil {
		return "", fmt.Errorf("download and verify %s: %w", label, err)
	}
	return result.Path, nil
}

func parseChecksums(data []byte) (map[string]string, error) {
	entries := map[string]string{}
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) != 2 {
			return nil, errors.New("signed checksum list contains an invalid record")
		}
		digest, err := hex.DecodeString(fields[0])
		name := strings.TrimPrefix(fields[1], "*")
		if err != nil || len(digest) != 32 || fields[0] != strings.ToLower(fields[0]) || name == "" || filepath.Base(name) != name || strings.ContainsAny(name, "\\\x00") {
			return nil, errors.New("signed checksum list contains an unsafe name or digest")
		}
		if _, duplicate := entries[name]; duplicate {
			return nil, fmt.Errorf("signed checksum entry appears more than once: %s", name)
		}
		entries[name] = fields[0]
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return nil, errors.New("signed checksum list is empty")
	}
	return entries, nil
}
