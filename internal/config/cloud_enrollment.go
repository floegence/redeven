package config

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"runtime"

	rc "github.com/floegence/redeven/internal/runtimecloud/protocol"
)

// The operation and independent key are durable before enrollment sends any
// bytes. Unknown results resume this exact operation instead of changing IDs.
func prepareRuntimeCloudEnrollment(path string, assignment *runtimeLinkAssignment, previous *Config, args cloudLinkResolveArgs) (bootstrapDeliveryAttempt, string, error) {
	unlock := lockConfig(path)
	defer unlock()
	journalPath := filepath.Clean(path) + ".cloud-enrollment-v5.json"
	if raw, err := os.ReadFile(journalPath); err == nil {
		var pending bootstrapDeliveryAttempt
		if err := decodeExactBootstrapDeliveryAttempt(raw, &pending); err != nil {
			return pending, "", err
		}
		if pending.Suspended {
			return pending, "", errors.New("cloud enrollment is cancelled locally; resume its original operation")
		}
		if pending.CloudOrigin != assignment.CloudOrigin || pending.EnvPublicID != assignment.EnvPublicID || pending.NamespacePublicID != assignment.NamespacePublicID || pending.AccessPointOrigin != assignment.AccessPointOrigin {
			return pending, "", errors.New("pending Cloud enrollment belongs to another environment; query or cancel that original operation")
		}
		associationRevision, routeRevision := int64(0), int64(0)
		if previous != nil && previous.CloudAssociation != nil {
			associationRevision = previous.CloudAssociation.Revision
		}
		if previous != nil && previous.CloudRoute != nil {
			routeRevision = previous.CloudRoute.Revision
		}
		alreadyCommitted := previous != nil && previous.CloudAssociation != nil && previous.CloudAssociation.EnrollmentOperationID == pending.BootstrapDeliveryRequestIDB64u && associationRevision >= pending.ExpectedAssociationRevision+1
		if !alreadyCommitted && (associationRevision != pending.ExpectedAssociationRevision || routeRevision != pending.ExpectedRouteRevision) {
			return pending, "", errors.New("cloud enrollment owner changed; inspect the original operation")
		}
		return pending, journalPath, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return bootstrapDeliveryAttempt{}, "", err
	}
	pending := bootstrapDeliveryAttempt{Version: bootstrapDeliveryAttemptVersion, CloudID: assignment.CloudID, CloudOrigin: assignment.CloudOrigin, AccessPointOrigin: assignment.AccessPointOrigin, EnvPublicID: assignment.EnvPublicID, NamespacePublicID: assignment.NamespacePublicID}
	if previous != nil {
		pending.LocalEnvironmentPublicID, pending.AgentInstanceID = previous.LocalEnvironmentPublicID, previous.AgentInstanceID
		if previous.CloudAssociation != nil {
			if previous.CloudAssociation.Revision == 1<<63-1 {
				return pending, "", errors.New("cloud association revision exhausted")
			}
			pending.ExpectedAssociationRevision = previous.CloudAssociation.Revision
		}
		if previous.CloudRoute != nil {
			pending.ExpectedRouteRevision = previous.CloudRoute.Revision
		}
	}
	var err error
	if pending.LocalEnvironmentPublicID == "" {
		pending.LocalEnvironmentPublicID, err = newLocalEnvironmentPublicID()
		if err != nil {
			return pending, "", err
		}
	}
	if pending.AgentInstanceID == "" {
		pending.AgentInstanceID, err = newAgentInstanceID()
		if err != nil {
			return pending, "", err
		}
	}
	if previous != nil && previous.CloudAssociation != nil {
		association := previous.CloudAssociation
		// A new setup ticket is the explicit independent ownership authorization.
		pending.PublicKeyB64u, pending.PrivateKeyB64u = association.PublicKeyB64u, association.PrivateKeyB64u
	} else {
		public, key, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return pending, "", err
		}
		pending.PublicKeyB64u, pending.PrivateKeyB64u = base64.RawURLEncoding.EncodeToString(public), base64.RawURLEncoding.EncodeToString(key)
	}
	pending.BootstrapDeliveryRequestIDB64u, err = newBootstrapDeliveryRequestID()
	if err != nil {
		return pending, "", err
	}
	pending.DeliveryRequestID = pending.BootstrapDeliveryRequestIDB64u
	hostname := args.RuntimeHostname
	if hostname == "" {
		hostname, _ = os.Hostname()
	}
	goos, goarch := args.RuntimeGOOS, args.RuntimeGOARCH
	if goos == "" {
		goos = runtime.GOOS
	}
	if goarch == "" {
		goarch = runtime.GOARCH
	}
	pending.Metadata = rc.Metadata{Hostname: hostname, OS: goos, Arch: goarch, Version: args.RuntimeVersion}
	if err := writeBootstrapDeliveryAttemptAtomic(journalPath, pending); err != nil {
		return pending, "", err
	}
	return pending, journalPath, nil
}
