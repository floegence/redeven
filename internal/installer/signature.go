package installer

import (
	"context"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	httptransport "github.com/go-openapi/runtime/client"
	"github.com/sigstore/cosign/v3/pkg/cosign"
	"github.com/sigstore/cosign/v3/pkg/oci/static"
	rekorapi "github.com/sigstore/rekor/pkg/generated/client"
	"github.com/sigstore/sigstore-go/pkg/root"
	"github.com/sigstore/sigstore-go/pkg/tuf"
	"github.com/theupdateframework/go-tuf/v2/metadata/fetcher"
	"golang.org/x/mod/semver"
)

const releaseIssuer = "https://token.actions.githubusercontent.com"

var releaseVersionPattern = regexp.MustCompile(`^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$`)

type releaseVerifier struct {
	trusted root.TrustedMaterial
	rekor   *rekorapi.Rekor
}

// TUF's upstream fetcher owns metadata bounds and authentication. This adapter
// only propagates the installer cancellation/deadline into its HTTP requests.
type trustHTTPClient struct {
	ctx    context.Context
	client *http.Client
}

func (c trustHTTPClient) Do(req *http.Request) (*http.Response, error) {
	return c.client.Do(req.Clone(c.ctx))
}

func newTrustFetcher(ctx context.Context, client *http.Client) *fetcher.DefaultFetcher {
	metadataFetcher := fetcher.NewDefaultFetcher()
	// Preserve the upstream fetcher's bounded retry policy. Its constructor-
	// style HTTP-client helper does not copy retry options in the pinned SDK.
	metadataFetcher.SetHTTPClient(trustHTTPClient{ctx, client})
	metadataFetcher.SetRetry(0, 1)
	return metadataFetcher
}

func validateReleaseVersion(version string) error {
	if !releaseVersionPattern.MatchString(version) || !semver.IsValid(version) {
		return fmt.Errorf("invalid release version %q", version)
	}
	return nil
}

func newReleaseVerifier(ctx context.Context) (*releaseVerifier, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	// TUF starts from the upstream embedded trust anchor and authenticates every
	// metadata update. Never accept roots or log keys from release downloads or
	// SIGSTORE_* environment overrides, and do not mutate the user's trust cache.
	client := &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if req.URL.Scheme != "https" || req.URL.User != nil || len(via) >= 8 {
			return errors.New("trust metadata redirect must remain bounded HTTPS")
		}
		return nil
	}}
	metadataFetcher := newTrustFetcher(ctx, client)
	trusted, err := root.FetchTrustedRootWithOptions(tuf.DefaultOptions().WithDisableLocalCache().WithFetcher(metadataFetcher))
	if err != nil {
		return nil, fmt.Errorf("load authenticated Sigstore trust metadata: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	logHTTP := &http.Client{Timeout: 30 * time.Second, Transport: rekorInputTransport{http.DefaultTransport},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	rekor := rekorapi.New(httptransport.NewWithClient("rekor.sigstore.dev", rekorapi.DefaultBasePath, []string{"https"}, logHTTP), nil)
	return &releaseVerifier{trusted: trusted, rekor: rekor}, nil
}

func (v *releaseVerifier) verify(ctx context.Context, payload, signature, certificate []byte, version string) error {
	if err := validateReleaseVersion(version); err != nil {
		return err
	}
	if len(payload) == 0 || len(payload) > 8<<20 || len(signature) == 0 || len(signature) > 32<<10 || len(certificate) > 256<<10 {
		return errors.New("release signature material is empty or exceeds its size limit")
	}
	// Cosign's detached certificate output is PEM or base64-encoded PEM.
	// Normalize that documented encoding before passing the same certificate
	// to the verifier; this does not introduce a second verification policy.
	certificate = []byte(strings.TrimSpace(string(certificate)))
	if !strings.HasPrefix(string(certificate), "-----BEGIN CERTIFICATE-----") {
		decoded, err := base64.StdEncoding.Strict().DecodeString(string(certificate))
		if err != nil {
			return errors.New("release certificate is neither PEM nor base64-encoded PEM")
		}
		certificate = decoded
	}
	block, rest := pem.Decode(certificate)
	if block == nil || block.Type != "CERTIFICATE" || len(strings.TrimSpace(string(rest))) != 0 {
		return errors.New("release certificate must contain exactly one PEM certificate")
	}
	encoded := strings.TrimSpace(string(signature))
	if decoded, err := base64.StdEncoding.Strict().DecodeString(encoded); err != nil || len(decoded) == 0 {
		return errors.New("release signature is not canonical base64")
	}
	if v == nil || v.trusted == nil || v.rekor == nil {
		return errors.New("release verifier is not initialized")
	}
	blob, err := static.NewSignature(payload, encoded, static.WithCertChain(certificate, nil))
	if err != nil {
		return fmt.Errorf("construct detached release signature: %w", err)
	}
	options := &cosign.CheckOpts{
		TrustedMaterial: v.trusted,
		RekorClient:     v.rekor,
		Identities: []cosign.Identity{{
			Issuer:  releaseIssuer,
			Subject: "https://github.com/floegence/redeven/.github/workflows/release.yml@refs/tags/" + version,
		}},
	}
	// The published contract is detached .sig + .pem, not a JSON bundle.
	// Keep certificate transparency and Rekor verification enabled. Cosign
	// checks authenticated signing time rather than accepting an expired leaf
	// certificate solely because its cryptographic signature matches.
	if _, err := cosign.VerifyBlobSignature(ctx, blob, options); err != nil {
		return fmt.Errorf("verify release signature and publisher identity: %w", err)
	}
	return nil
}

// VerifyRelease verifies an immutable release's SHA256SUMS using the official
// workflow identity, authenticated Sigstore roots and transparency evidence.
// It does not execute or install any release content.
func VerifyRelease(ctx context.Context, payload, signature, certificate []byte, version string) error {
	if err := validateReleaseVersion(version); err != nil {
		return err
	}
	verifier, err := newReleaseVerifier(ctx)
	if err != nil {
		return err
	}
	return verifier.verify(ctx, payload, signature, certificate, version)
}
