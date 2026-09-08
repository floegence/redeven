package threadstore

import (
	"context"
	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

// Inspect checks a product store before any other owner begins an upgrade.
func Inspect(path string) (sqliteutil.Inspection, error) {
	return sqliteutil.Inspect(path, threadstoreSchemaSpec())
}

// Backup snapshots product storage while its service generation is closed.
func Backup(ctx context.Context, source, destination string) error {
	return sqliteutil.Backup(ctx, source, destination, threadstoreSchemaSpec())
}
