package threadstore

import (
	"crypto/sha256"
	"fmt"
	"time"
)

func stagingScopeForTest(endpointID, targetID, ownerHash, scopeID string) UploadStagingScope {
	capabilityHash := sha256.Sum256([]byte(scopeID))
	return UploadStagingScope{
		StagingScopeID:  scopeID,
		EndpointID:      endpointID,
		OwnerUserHash:   ownerHash,
		TargetID:        targetID,
		CapabilityHash:  fmt.Sprintf("%x", capabilityHash),
		CreatedAtUnixMs: 10,
		ExpiresAtUnixMs: time.Now().Add(time.Hour).UnixMilli(),
	}
}
