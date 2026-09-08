package threadstore

import (
	"context"
	"errors"
)

// RetainCanonicalUploads records product resource retention after the caller
// has verified membership in Floret's canonical history, including fork paths.
// It does not admit a message or grant access to an attachment.
func (s *Store) RetainCanonicalUploads(ctx context.Context, endpointID, threadID string, uploadIDs []string) error {
	if len(uploadIDs) == 0 {
		return nil
	}
	if s == nil || s.db == nil {
		return errors.New("upload store is unavailable")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := bindUploadsToRefTx(ctx, tx, endpointID, threadID, UploadRefKindThread, threadID, uploadIDs, "", "", ""); err != nil {
		return err
	}
	return tx.Commit()
}
