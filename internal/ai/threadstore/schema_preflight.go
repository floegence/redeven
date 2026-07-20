package threadstore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
)

type LegacyThreadTitle struct {
	EndpointID string
	ThreadID   string
	Title      string
}

func migrateLegacyThreadTitles(path string, migrate func(context.Context, LegacyThreadTitle) error) error {
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}

	db, err := sql.Open("sqlite", "file:"+path+"?mode=rw&_pragma=busy_timeout(3000)")
	if err != nil {
		return err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	var hasMeta int
	if err := db.QueryRow(`SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = '__redeven_db_meta'`).Scan(&hasMeta); err != nil {
		return err
	}
	if hasMeta == 0 {
		return nil
	}
	var kind string
	if err := db.QueryRow(`SELECT db_kind FROM __redeven_db_meta WHERE singleton = 1`).Scan(&kind); err != nil {
		return err
	}
	var version int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		return err
	}
	kind = strings.TrimSpace(kind)
	if kind != threadstoreSchemaKind {
		return fmt.Errorf("unsupported threadstore database kind %q version %d; only %q schema v2 and v3 are supported", kind, version, threadstoreSchemaKind)
	}
	switch version {
	case threadstoreCurrentSchemaVersion:
		return nil
	case 2:
	case 0:
		return errors.New("existing threadstore database has unsupported schema version 0; only v2 and v3 are supported")
	default:
		return fmt.Errorf("unsupported threadstore database kind %q version %d; only schema v2 and v3 are supported", kind, version)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return err
	}
	if err := verifyProductSchemaVersion(tx, 2); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("verify product threadstore v2 before title migration: %w", err)
	}
	if err := validateProductV2UploadRefs(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	if err := validateProductV2PermissionSnapshots(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	if err := validateProductV2ForkOperationSnapshots(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	if err := validateProductV2DeleteOperationSnapshots(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	rows, err := tx.QueryContext(ctx, `
SELECT endpoint_id, thread_id, title
FROM ai_threads
WHERE TRIM(COALESCE(title, '')) <> ''
ORDER BY endpoint_id, thread_id
`)
	if err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("read legacy thread titles: %w", err)
	}
	var titles []LegacyThreadTitle
	for rows.Next() {
		var title LegacyThreadTitle
		if err := rows.Scan(&title.EndpointID, &title.ThreadID, &title.Title); err != nil {
			_ = rows.Close()
			_ = tx.Rollback()
			return err
		}
		title.EndpointID = strings.TrimSpace(title.EndpointID)
		title.ThreadID = strings.TrimSpace(title.ThreadID)
		title.Title = strings.TrimSpace(title.Title)
		if title.EndpointID == "" || title.ThreadID == "" || title.Title == "" {
			_ = rows.Close()
			_ = tx.Rollback()
			return errors.New("legacy thread title has incomplete identity")
		}
		titles = append(titles, title)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		_ = tx.Rollback()
		return err
	}
	if err := rows.Close(); err != nil {
		_ = tx.Rollback()
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	if len(titles) > 0 && migrate == nil {
		return errors.New("threadstore schema v2 contains titles but no Floret title migrator was configured")
	}
	for _, title := range titles {
		if err := migrate(ctx, title); err != nil {
			return fmt.Errorf("migrate title for thread %q: %w", title.ThreadID, err)
		}
	}
	return nil
}
