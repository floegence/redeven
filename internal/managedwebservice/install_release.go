package managedwebservice

import (
	"context"
	"strings"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

// verifyInstallRelease checks the already-persisted selection before creating any
// workspace or runtime. Retries use the same immutable identity, never a new default.
func (m *Manager) verifyInstallRelease(ctx context.Context, service *pfregistry.ManagedService, resolved *resolvedRuntime) error {
	expected := resolved.Release
	switch expected.Kind {
	case "npm":
		spec := resolved.Spec.Host.NPM
		token := resolved.Parameters[strings.TrimSpace(spec.AuthTokenParameter)]
		items, err := fetchNPMReleases(withReleaseSourceRefresh(ctx), m.releaseHTTPClient(), *spec, token)
		if err != nil {
			return err
		}
		release, ok := npmReleaseByVersion(items, expected.Version)
		if !ok {
			return serviceError("RELEASE_NOT_FOUND", "The selected npm version is no longer available from its Registry.", 409, true, nil)
		}
		if !release.IntegrityVerified {
			return serviceError("RELEASE_IDENTITY_UNVERIFIABLE", "The exact npm release has no verifiable SHA-512 integrity.", 409, false, nil)
		}
		if compatible, code, reason := nodeRangeCompatible(release.NodeRange); !compatible {
			return serviceError(code, reason, 409, false, nil)
		}
		actual := expected
		actual.Integrity, actual.Trust = release.Integrity, "registry_verified"
		if err := verifyExpectedNPMReleaseIdentity(service, actual); err != nil {
			return err
		}
		// Default selections gain their verified integrity once, before installation.
		raw, digest, err := canonicalReleaseIdentity(actual)
		if err != nil {
			return err
		}
		if err := m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{ReleaseIdentityJSON: &raw, ReleaseIdentitySHA256: &digest}); err != nil {
			return err
		}
		service.ReleaseIdentityJSON, service.ReleaseIdentitySHA256 = raw, digest
		resolved.Release = actual
	case "oci":
		var actualDigest string
		if expected.Tag != "" && !expected.DigestVerified {
			items, err := m.verifyOCIReleaseTags(withReleaseSourceRefresh(ctx), resolved.Spec, []string{expected.Tag})
			if err != nil {
				return err
			}
			if len(items) == 1 && items[0].Compatible {
				actualDigest = items[0].PlatformDigest
			}
		} else {
			items, err := m.verifyOCIReleaseDigests(withReleaseSourceRefresh(ctx), resolved.Spec, []string{expected.Digest})
			if err != nil {
				return err
			}
			if len(items) == 1 && items[0].Compatible {
				actualDigest = items[0].PlatformDigest
			}
		}
		if actualDigest == "" || actualDigest != expected.Digest {
			return serviceError("RELEASE_CANDIDATE_CHANGED", "The selected container release changed at its Registry. Review it again.", 409, true, nil)
		}
	}
	return nil
}

// InstallRequest reports only a durably accepted request. A missing receipt does
// not prove that a concurrent request was rejected and never authorizes replay.
func (m *Manager) InstallRequest(ctx context.Context, requestID string) (*CreateResult, error) {
	if err := validateRequestID(requestID); err != nil {
		return nil, err
	}
	op, err := m.registry.GetManagedOperationByRequestID(ctx, requestID)
	if err != nil || op == nil {
		return nil, err
	}
	if OperationAction(op.Action) != ActionInstall {
		return nil, serviceError("REQUEST_ID_INVALID", "The request does not identify an installation.", 400, false, nil)
	}
	service, err := m.registry.GetManagedService(ctx, op.ServiceID)
	if err != nil {
		return nil, err
	}
	if service == nil {
		return nil, serviceError("SERVICE_NOT_FOUND", "The installed service record is unavailable.", 404, false, nil)
	}
	return &CreateResult{Service: *service, Operation: *op}, nil
}
