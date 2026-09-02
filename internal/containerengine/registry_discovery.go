package containerengine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	maxRegistryTagsBytes     = 8 << 20
	maxRegistryManifestBytes = 4 << 20
	maxRegistryTags          = 10_000
)

var registryDigestPattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

var (
	registryRepositoryPattern = regexp.MustCompile(`^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$`)
	registryTagPattern        = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$`)
)

type RegistryCredential struct {
	Username string
	Secret   string
}

type OCIReleaseDiscoveryRequest struct {
	Reference    string
	PlatformOS   string
	PlatformArch string
	Credential   RegistryCredential
}

type OCIRelease struct {
	Tag            string
	IndexDigest    string
	PlatformDigest string
	PlatformOS     string
	PlatformArch   string
	Compatible     bool
	ReasonCode     string
	Reason         string
}

type OCIReleaseDiscovery struct {
	Client *http.Client
}

type ociReleaseVerificationError struct {
	cause error
}

func (e *ociReleaseVerificationError) Error() string {
	return "OCI release identity is unverifiable"
}

func (e *ociReleaseVerificationError) Unwrap() error {
	return e.cause
}

func unverifiableOCIRelease(tag, platformOS, platformArch string, err error) (OCIRelease, bool) {
	var verificationError *ociReleaseVerificationError
	if !errors.As(err, &verificationError) {
		return OCIRelease{}, false
	}
	return OCIRelease{
		Tag: tag, PlatformOS: platformOS, PlatformArch: platformArch,
		ReasonCode: "RELEASE_IDENTITY_UNVERIFIABLE",
		Reason:     "The Registry did not provide a verifiable manifest identity for this exact tag.",
	}, true
}

func (d OCIReleaseDiscovery) Discover(ctx context.Context, request OCIReleaseDiscoveryRequest) ([]OCIRelease, error) {
	client := d.Client
	if client == nil {
		client = &http.Client{Timeout: 45 * time.Second}
	}
	reference, err := parseRegistryReference(request.Reference)
	if err != nil {
		return nil, err
	}
	token := ""
	tags, token, err := d.listTags(ctx, client, reference, request.Credential, token)
	if err != nil {
		return nil, err
	}
	if len(tags) == 0 {
		return []OCIRelease{}, nil
	}
	resolved := make([]OCIRelease, len(tags))
	present := make([]bool, len(tags))
	first, refreshed, err := d.resolveTag(ctx, client, reference, tags[0], request.PlatformOS, request.PlatformArch, request.Credential, token)
	if refreshed != "" {
		token = refreshed
	}
	if err == nil {
		resolved[0], present[0] = first, true
	} else if item, ok := unverifiableOCIRelease(tags[0], request.PlatformOS, request.PlatformArch, err); ok {
		resolved[0], present[0] = item, true
	} else if !errors.Is(err, ErrImageNotFound) {
		return nil, err
	}
	workerContext, cancel := context.WithCancel(ctx)
	defer cancel()
	indexes := make(chan int)
	errorsFound := make(chan error, 1)
	var workers sync.WaitGroup
	workerCount := min(8, len(tags)-1)
	for range workerCount {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for index := range indexes {
				item, _, discoverErr := d.resolveTag(workerContext, client, reference, tags[index], request.PlatformOS, request.PlatformArch, request.Credential, token)
				if discoverErr != nil {
					if unavailable, ok := unverifiableOCIRelease(tags[index], request.PlatformOS, request.PlatformArch, discoverErr); ok {
						resolved[index], present[index] = unavailable, true
						continue
					}
					if errors.Is(discoverErr, ErrImageNotFound) {
						continue
					}
					select {
					case errorsFound <- discoverErr:
						cancel()
					default:
					}
					return
				}
				resolved[index], present[index] = item, true
			}
		}()
	}
sendLoop:
	for index := 1; index < len(tags); index++ {
		select {
		case <-workerContext.Done():
			break sendLoop
		case indexes <- index:
		}
	}
	close(indexes)
	workers.Wait()
	select {
	case discoverErr := <-errorsFound:
		return nil, discoverErr
	default:
	}
	items := make([]OCIRelease, 0, len(tags))
	for index := range resolved {
		if present[index] {
			items = append(items, resolved[index])
		}
	}
	return items, nil
}

type parsedRegistryReference struct {
	RegistryHost string
	Repository   string
	APIBase      string
}

func parseRegistryReference(value string) (parsedRegistryReference, error) {
	value = strings.TrimSpace(value)
	if strings.Contains(value, "://") || strings.ContainsAny(value, "?#\x00\r\n\t ") {
		return parsedRegistryReference{}, fmt.Errorf("invalid OCI image reference")
	}
	if before, digest, ok := strings.Cut(value, "@"); ok {
		if !registryDigestPattern.MatchString(digest) {
			return parsedRegistryReference{}, fmt.Errorf("invalid OCI image digest")
		}
		value = before
	}
	lastSlash, lastColon := strings.LastIndex(value, "/"), strings.LastIndex(value, ":")
	if lastColon > lastSlash {
		if !registryTagPattern.MatchString(value[lastColon+1:]) {
			return parsedRegistryReference{}, fmt.Errorf("invalid OCI image tag")
		}
		value = value[:lastColon]
	}
	parts := strings.Split(value, "/")
	if len(parts) == 0 || strings.TrimSpace(value) == "" {
		return parsedRegistryReference{}, fmt.Errorf("invalid OCI image reference")
	}
	host := "registry-1.docker.io"
	repository := value
	if strings.Contains(parts[0], ".") || strings.Contains(parts[0], ":") || parts[0] == "localhost" {
		host, repository = parts[0], strings.Join(parts[1:], "/")
	}
	if host == "docker.io" || host == "index.docker.io" {
		host = "registry-1.docker.io"
	}
	if host == "registry-1.docker.io" && !strings.Contains(repository, "/") {
		repository = "library/" + repository
	}
	hostURL, hostErr := url.Parse("https://" + host)
	if hostErr != nil || hostURL.User != nil || hostURL.Host != host || hostURL.Hostname() == "" || hostURL.Path != "" || len(repository) > 255 || !registryRepositoryPattern.MatchString(repository) {
		return parsedRegistryReference{}, fmt.Errorf("invalid OCI image reference")
	}
	return parsedRegistryReference{RegistryHost: host, Repository: repository, APIBase: "https://" + host + "/v2/" + repository}, nil
}

func (d OCIReleaseDiscovery) listTags(ctx context.Context, client *http.Client, reference parsedRegistryReference, credential RegistryCredential, token string) ([]string, string, error) {
	next := reference.APIBase + "/tags/list?n=100"
	seen := map[string]struct{}{}
	for page := 0; next != "" && page < 100; page++ {
		response, refreshed, err := registryRequest(ctx, client, http.MethodGet, next, reference.Repository, credential, token, "application/json")
		if err != nil {
			return nil, token, err
		}
		if refreshed != "" {
			token = refreshed
		}
		raw, err := readRegistryBody(response, maxRegistryTagsBytes)
		if err != nil {
			return nil, token, err
		}
		var document struct {
			Tags []string `json:"tags"`
		}
		if err := json.Unmarshal(raw, &document); err != nil {
			return nil, token, fmt.Errorf("invalid OCI tag response")
		}
		for _, tag := range document.Tags {
			tag = strings.TrimSpace(tag)
			if tag == "" || len(tag) > 128 || strings.ContainsAny(tag, "\x00\r\n\t /@") {
				continue
			}
			seen[tag] = struct{}{}
			if len(seen) > maxRegistryTags {
				return nil, token, fmt.Errorf("OCI Registry returned too many tags")
			}
		}
		link := response.Header.Get("Link")
		next = registryNextLink(response.Request.URL, link, reference.RegistryHost)
		if next == "" && strings.Contains(strings.ToLower(link), `rel="next"`) {
			return nil, token, fmt.Errorf("OCI Registry returned an unsafe pagination link")
		}
	}
	if next != "" {
		return nil, token, fmt.Errorf("OCI Registry pagination exceeded its safe limit")
	}
	tags := make([]string, 0, len(seen))
	for tag := range seen {
		tags = append(tags, tag)
	}
	return tags, token, nil
}

func (d OCIReleaseDiscovery) resolveTag(ctx context.Context, client *http.Client, reference parsedRegistryReference, tag, platformOS, platformArch string, credential RegistryCredential, token string) (OCIRelease, string, error) {
	accept := strings.Join([]string{
		"application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json",
		"application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json",
	}, ", ")
	endpoint := reference.APIBase + "/manifests/" + url.PathEscape(tag)
	response, refreshed, err := registryRequest(ctx, client, http.MethodGet, endpoint, reference.Repository, credential, token, accept)
	if err != nil {
		return OCIRelease{}, refreshed, err
	}
	raw, err := readRegistryBody(response, maxRegistryManifestBytes)
	if err != nil {
		return OCIRelease{}, refreshed, &ociReleaseVerificationError{cause: err}
	}
	digest, err := registryContentDigest(response.Header.Get("Docker-Content-Digest"), raw)
	if err != nil {
		return OCIRelease{}, refreshed, &ociReleaseVerificationError{cause: err}
	}
	mediaType, _, _ := mime.ParseMediaType(response.Header.Get("Content-Type"))
	item := OCIRelease{Tag: tag, IndexDigest: digest, PlatformOS: platformOS, PlatformArch: platformArch}
	if strings.Contains(mediaType, "manifest.list") || strings.Contains(mediaType, "image.index") {
		var index struct {
			Manifests []struct {
				Digest   string                            `json:"digest"`
				Platform struct{ OS, Architecture string } `json:"platform"`
			} `json:"manifests"`
		}
		if err := json.Unmarshal(raw, &index); err != nil {
			return OCIRelease{}, refreshed, &ociReleaseVerificationError{cause: fmt.Errorf("invalid OCI image index")}
		}
		for _, manifest := range index.Manifests {
			if manifest.Platform.OS == platformOS && manifest.Platform.Architecture == platformArch && registryDigestPattern.MatchString(manifest.Digest) {
				item.PlatformDigest, item.Compatible = manifest.Digest, true
				return item, refreshed, nil
			}
		}
		item.ReasonCode, item.Reason = "PLATFORM_UNAVAILABLE", "This tag does not publish an image for the current platform."
		return item, refreshed, nil
	}
	var manifest struct {
		Config struct {
			Digest string `json:"digest"`
		} `json:"config"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil || !registryDigestPattern.MatchString(manifest.Config.Digest) {
		return OCIRelease{}, refreshed, &ociReleaseVerificationError{cause: fmt.Errorf("invalid OCI image manifest")}
	}
	configResponse, refreshedConfig, err := registryRequest(ctx, client, http.MethodGet, reference.APIBase+"/blobs/"+manifest.Config.Digest, reference.Repository, credential, refreshed, "application/octet-stream")
	if refreshedConfig != "" {
		refreshed = refreshedConfig
	}
	if err != nil {
		if errors.Is(err, ErrImageNotFound) {
			return OCIRelease{}, refreshed, &ociReleaseVerificationError{cause: err}
		}
		return OCIRelease{}, refreshed, err
	}
	configRaw, err := readRegistryBody(configResponse, maxRegistryManifestBytes)
	if err != nil {
		return OCIRelease{}, refreshed, &ociReleaseVerificationError{cause: err}
	}
	var config struct{ OS, Architecture string }
	if err := json.Unmarshal(configRaw, &config); err != nil {
		return OCIRelease{}, refreshed, &ociReleaseVerificationError{cause: fmt.Errorf("invalid OCI image configuration")}
	}
	item.PlatformDigest = digest
	item.Compatible = config.OS == platformOS && config.Architecture == platformArch
	if !item.Compatible {
		item.ReasonCode, item.Reason = "PLATFORM_UNAVAILABLE", "This tag does not publish an image for the current platform."
	}
	return item, refreshed, nil
}

func registryRequest(ctx context.Context, client *http.Client, method, endpoint, repository string, credential RegistryCredential, token, accept string) (*http.Response, string, error) {
	makeRequest := func(bearer string) (*http.Response, error) {
		req, err := http.NewRequestWithContext(ctx, method, endpoint, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Accept", accept)
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		} else if credential.Username != "" || credential.Secret != "" {
			req.SetBasicAuth(credential.Username, credential.Secret)
		}
		return client.Do(req)
	}
	response, err := makeRequest(token)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return nil, token, err
		}
		return nil, token, fmt.Errorf("%w", ErrImageRegistryUnavailable)
	}
	if response.StatusCode == http.StatusUnauthorized {
		challenge := response.Header.Get("WWW-Authenticate")
		_ = response.Body.Close()
		fresh, authErr := registryBearerToken(ctx, client, challenge, repository, credential)
		if authErr != nil {
			return nil, token, authErr
		}
		response, err = makeRequest(fresh)
		if err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				return nil, token, err
			}
			return nil, token, fmt.Errorf("%w", ErrImageRegistryUnavailable)
		}
		token = fresh
	}
	switch response.StatusCode {
	case http.StatusOK:
		return response, token, nil
	case http.StatusUnauthorized, http.StatusForbidden:
		_ = response.Body.Close()
		return nil, token, ErrImageAccessDenied
	case http.StatusNotFound:
		_ = response.Body.Close()
		return nil, token, ErrImageNotFound
	case http.StatusTooManyRequests:
		_ = response.Body.Close()
		return nil, token, ErrImageRateLimited
	default:
		_ = response.Body.Close()
		return nil, token, ErrImageRegistryUnavailable
	}
}

func registryBearerToken(ctx context.Context, client *http.Client, challenge, repository string, credential RegistryCredential) (string, error) {
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(challenge)), "bearer ") {
		return "", ErrImageAccessDenied
	}
	params := map[string]string{}
	for _, part := range strings.Split(strings.TrimSpace(challenge[len("Bearer "):]), ",") {
		key, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if ok {
			params[strings.ToLower(key)] = strings.Trim(strings.TrimSpace(value), `"`)
		}
	}
	realm, err := url.Parse(params["realm"])
	if err != nil || realm.Scheme != "https" || realm.Hostname() == "" || realm.User != nil {
		return "", ErrImageAccessDenied
	}
	query := realm.Query()
	if service := strings.TrimSpace(params["service"]); service != "" {
		query.Set("service", service)
	}
	query.Set("scope", "repository:"+repository+":pull")
	realm.RawQuery = query.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, realm.String(), nil)
	if err != nil {
		return "", err
	}
	if credential.Username != "" || credential.Secret != "" {
		req.SetBasicAuth(credential.Username, credential.Secret)
	}
	req.Header.Set("Accept", "application/json")
	response, err := client.Do(req)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return "", err
		}
		return "", ErrImageRegistryUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", ErrImageAccessDenied
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return "", err
	}
	var document struct{ Token, AccessToken string }
	if err := json.Unmarshal(raw, &document); err != nil {
		return "", ErrImageAccessDenied
	}
	token := strings.TrimSpace(document.Token)
	if token == "" {
		token = strings.TrimSpace(document.AccessToken)
	}
	if token == "" {
		return "", ErrImageAccessDenied
	}
	return token, nil
}

func readRegistryBody(response *http.Response, limit int64) ([]byte, error) {
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) > limit {
		return nil, fmt.Errorf("OCI Registry response exceeded its safe limit")
	}
	return raw, nil
}

func registryContentDigest(header string, raw []byte) (string, error) {
	header = strings.ToLower(strings.TrimSpace(header))
	digest := sha256.Sum256(raw)
	computed := "sha256:" + hex.EncodeToString(digest[:])
	if header != "" {
		if !registryDigestPattern.MatchString(header) || header != computed {
			return "", fmt.Errorf("OCI Registry returned a mismatched content digest")
		}
	}
	return computed, nil
}

func registryNextLink(current *url.URL, value, expectedHost string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	before, parameters, ok := strings.Cut(value, ";")
	if !ok || !strings.Contains(strings.ToLower(parameters), `rel="next"`) {
		return ""
	}
	target, err := url.Parse(strings.Trim(strings.TrimSpace(before), "<>"))
	if err != nil {
		return ""
	}
	target = current.ResolveReference(target)
	if target.Scheme != "https" || target.Host != expectedHost {
		return ""
	}
	return target.String()
}
