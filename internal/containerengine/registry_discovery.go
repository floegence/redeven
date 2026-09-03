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
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	maxRegistryTagsBytes     = 8 << 20
	maxRegistryManifestBytes = 4 << 20
	registryTagPageSize      = 100
	registryVerifyWorkers    = 4
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

type OCIReleaseTagPageRequest struct {
	Reference  string
	Credential RegistryCredential
	Cursor     string
}

type OCIReleaseTagPage struct {
	Tags       []string
	NextCursor string
}

type OCIReleaseVerificationRequest struct {
	Reference    string
	PlatformOS   string
	PlatformArch string
	Credential   RegistryCredential
	Tags         []string
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

func unavailableOCIRelease(tag, platformOS, platformArch string, err error) (OCIRelease, bool) {
	if errors.Is(err, ErrImageNotFound) {
		return OCIRelease{
			Tag: tag, PlatformOS: platformOS, PlatformArch: platformArch,
			ReasonCode: "RELEASE_NOT_FOUND",
			Reason:     "The Registry no longer publishes this tag.",
		}, true
	}
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

func (d OCIReleaseDiscovery) ListTagsPage(ctx context.Context, request OCIReleaseTagPageRequest) (OCIReleaseTagPage, error) {
	client := d.Client
	if client == nil {
		client = &http.Client{Timeout: 45 * time.Second}
	}
	reference, err := parseRegistryReference(request.Reference)
	if err != nil {
		return OCIReleaseTagPage{}, err
	}
	endpoint := strings.TrimSpace(request.Cursor)
	if endpoint == "" {
		endpoint = reference.APIBase + "/tags/list?n=" + strconv.Itoa(registryTagPageSize)
	} else if !validRegistryCursor(endpoint, reference) {
		return OCIReleaseTagPage{}, fmt.Errorf("%w: unsafe pagination cursor", ErrImageRegistryResponseInvalid)
	}
	response, _, err := registryRequest(ctx, client, http.MethodGet, endpoint, reference.Repository, request.Credential, "", "application/json")
	if err != nil {
		return OCIReleaseTagPage{}, err
	}
	raw, err := readRegistryBody(response, maxRegistryTagsBytes)
	if err != nil {
		return OCIReleaseTagPage{}, err
	}
	var document struct {
		Tags []string `json:"tags"`
	}
	if err := json.Unmarshal(raw, &document); err != nil {
		return OCIReleaseTagPage{}, fmt.Errorf("%w: invalid tag response", ErrImageRegistryResponseInvalid)
	}
	if len(document.Tags) > registryTagPageSize {
		return OCIReleaseTagPage{}, fmt.Errorf("%w: tag page exceeded its safe limit", ErrImageRegistryResponseInvalid)
	}
	seen := map[string]struct{}{}
	tags := make([]string, 0, min(len(document.Tags), registryTagPageSize))
	for _, tag := range document.Tags {
		tag = strings.TrimSpace(tag)
		if !registryTagPattern.MatchString(tag) {
			continue
		}
		if _, ok := seen[tag]; ok {
			continue
		}
		seen[tag] = struct{}{}
		tags = append(tags, tag)
	}
	link := response.Header.Get("Link")
	next := registryNextLink(response.Request.URL, link, reference.RegistryHost)
	if next == "" && strings.Contains(strings.ToLower(link), `rel="next"`) {
		return OCIReleaseTagPage{}, fmt.Errorf("%w: unsafe pagination link", ErrImageRegistryResponseInvalid)
	}
	return OCIReleaseTagPage{Tags: tags, NextCursor: next}, nil
}

func (d OCIReleaseDiscovery) VerifyTags(ctx context.Context, request OCIReleaseVerificationRequest) ([]OCIRelease, error) {
	client := d.Client
	if client == nil {
		client = &http.Client{Timeout: 45 * time.Second}
	}
	reference, err := parseRegistryReference(request.Reference)
	if err != nil {
		return nil, err
	}
	tags := uniqueRegistryTags(request.Tags)
	if len(tags) == 0 {
		return []OCIRelease{}, nil
	}
	resolved := make([]OCIRelease, len(tags))
	present := make([]bool, len(tags))
	token := ""
	first, refreshed, err := d.resolveTag(ctx, client, reference, tags[0], request.PlatformOS, request.PlatformArch, request.Credential, token)
	if refreshed != "" {
		token = refreshed
	}
	if err == nil {
		resolved[0], present[0] = first, true
	} else if item, ok := unavailableOCIRelease(tags[0], request.PlatformOS, request.PlatformArch, err); ok {
		resolved[0], present[0] = item, true
		err = nil
	}
	if err != nil {
		return collectOCIReleases(resolved, present), err
	}
	indexes := make(chan int)
	errorsFound := make(chan error, 1)
	var workers sync.WaitGroup
	workerCount := min(registryVerifyWorkers, len(tags)-1)
	for range workerCount {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for index := range indexes {
				item, _, discoverErr := d.resolveTag(ctx, client, reference, tags[index], request.PlatformOS, request.PlatformArch, request.Credential, token)
				if discoverErr != nil {
					if unavailable, ok := unavailableOCIRelease(tags[index], request.PlatformOS, request.PlatformArch, discoverErr); ok {
						resolved[index], present[index] = unavailable, true
						continue
					}
					select {
					case errorsFound <- discoverErr:
					default:
					}
					continue
				}
				resolved[index], present[index] = item, true
			}
		}()
	}
	for index := 1; index < len(tags); index++ {
		select {
		case <-ctx.Done():
			close(indexes)
			workers.Wait()
			return collectOCIReleases(resolved, present), ctx.Err()
		case indexes <- index:
		}
	}
	close(indexes)
	workers.Wait()
	items := collectOCIReleases(resolved, present)
	select {
	case discoverErr := <-errorsFound:
		return items, discoverErr
	default:
	}
	return items, nil
}

func collectOCIReleases(resolved []OCIRelease, present []bool) []OCIRelease {
	items := make([]OCIRelease, 0, len(resolved))
	for index := range resolved {
		if present[index] {
			items = append(items, resolved[index])
		}
	}
	return items
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

func validRegistryCursor(value string, reference parsedRegistryReference) bool {
	cursor, err := url.Parse(strings.TrimSpace(value))
	if err != nil || cursor.Scheme != "https" || cursor.Host != reference.RegistryHost || cursor.User != nil || cursor.Fragment != "" ||
		cursor.Path != reference.APIBase[len("https://"+reference.RegistryHost):]+"/tags/list" {
		return false
	}
	if pageSize := cursor.Query().Get("n"); pageSize != "" {
		value, parseErr := strconv.Atoi(pageSize)
		return parseErr == nil && value > 0 && value <= registryTagPageSize
	}
	return true
}

func uniqueRegistryTags(values []string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, min(len(values), 20))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if !registryTagPattern.MatchString(value) {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
		if len(result) == 20 {
			break
		}
	}
	return result
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
		return nil, token, registryTransportError(err)
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
			return nil, token, registryTransportError(err)
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
		return "", registryTransportError(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		switch response.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			return "", ErrImageAccessDenied
		case http.StatusTooManyRequests:
			return "", ErrImageRateLimited
		default:
			return "", ErrImageRegistryUnavailable
		}
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return "", err
	}
	var document struct{ Token, AccessToken string }
	if err := json.Unmarshal(raw, &document); err != nil {
		return "", fmt.Errorf("%w: invalid bearer token response", ErrImageRegistryResponseInvalid)
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

func registryTransportError(err error) error {
	if errors.Is(err, context.Canceled) {
		return err
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return fmt.Errorf("%w: %v", ErrImageRegistryTimeout, err)
	}
	var networkError net.Error
	if errors.As(err, &networkError) && networkError.Timeout() {
		return fmt.Errorf("%w: %v", ErrImageRegistryTimeout, err)
	}
	return fmt.Errorf("%w: %v", ErrImageRegistryNetworkUnavailable, err)
}

func readRegistryBody(response *http.Response, limit int64) ([]byte, error) {
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, fmt.Errorf("%w: read response body", ErrImageRegistryResponseInvalid)
	}
	if int64(len(raw)) > limit {
		return nil, fmt.Errorf("%w: response exceeded its safe limit", ErrImageRegistryResponseInvalid)
	}
	return raw, nil
}

func registryContentDigest(header string, raw []byte) (string, error) {
	header = strings.ToLower(strings.TrimSpace(header))
	digest := sha256.Sum256(raw)
	computed := "sha256:" + hex.EncodeToString(digest[:])
	if header != "" {
		if !registryDigestPattern.MatchString(header) || header != computed {
			return "", fmt.Errorf("%w: mismatched content digest", ErrImageRegistryResponseInvalid)
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
	if target.Scheme != "https" || target.Host != expectedHost || target.User != nil || target.Fragment != "" || target.Path != current.Path {
		return ""
	}
	if pageSize := target.Query().Get("n"); pageSize != "" {
		value, parseErr := strconv.Atoi(pageSize)
		if parseErr != nil || value <= 0 || value > registryTagPageSize {
			return ""
		}
	}
	if target.RawQuery == "" {
		return ""
	}
	return target.String()
}
