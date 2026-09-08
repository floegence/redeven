package sqliteutil

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"os"
	"path/filepath"

	"modernc.org/sqlite"
)

// Backup copies committed SQLite state, including WAL, into an exclusive new
// destination. The storage owner must close its database and exclude writers.
func Backup(ctx context.Context, source, destination string, spec Spec) (err error) {
	if ctx == nil {
		return errors.New("backup context is required")
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	if _, err = Inspect(source, spec); err != nil {
		return err
	}
	if _, err = os.Stat(source); err != nil {
		return err
	}
	destination, err = filepath.Abs(destination)
	if err != nil {
		return err
	}
	for _, suffix := range []string{"-wal", "-shm", "-journal"} {
		if _, err = os.Lstat(destination + suffix); err == nil {
			return os.ErrExist
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	file, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	if err = file.Close(); err != nil {
		_ = os.Remove(destination)
		return err
	}
	defer func() {
		if err != nil {
			for _, suffix := range []string{"", "-wal", "-shm", "-journal"} {
				_ = os.Remove(destination + suffix)
			}
		}
	}()
	var absentSidecars []string
	for _, suffix := range []string{"-wal", "-shm", "-journal"} {
		exists, statErr := fileExists(source + suffix)
		if statErr != nil {
			return statErr
		}
		if !exists {
			absentSidecars = append(absentSidecars, source+suffix)
		}
	}
	defer func() {
		for _, path := range absentSidecars {
			if removeErr := os.Remove(path); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
				err = errors.Join(err, removeErr)
			}
		}
	}()
	db, err := sql.Open("sqlite", readOnlyDSN(source))
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, db.Close()) }()
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	if err = conn.Raw(func(raw any) error {
		copier, ok := raw.(interface {
			NewBackup(string) (*sqlite.Backup, error)
		})
		if !ok {
			return errors.New("SQLite backup is unavailable")
		}
		copy, err := copier.NewBackup((&url.URL{Scheme: "file", Path: destination}).String())
		if err != nil {
			return err
		}
		for {
			if err = ctx.Err(); err != nil {
				return errors.Join(err, copy.Finish())
			}
			more, err := copy.Step(128)
			if err != nil {
				return errors.Join(err, copy.Finish())
			}
			if !more {
				return copy.Finish()
			}
		}
	}); err != nil {
		return err
	}
	file, err = os.OpenFile(destination, os.O_RDWR, 0)
	if err != nil {
		return err
	}
	return errors.Join(file.Sync(), file.Close())
}
