package fs

import (
	"context"
	"fmt"
	"io"
	"os"

	yekazip "github.com/yeka/zip"
)

func extractZipArchive(ctx context.Context, reader io.Reader, password string, writer *archiveTreeWriter) error {
	readerAt, ok := reader.(io.ReaderAt)
	if !ok {
		return fmt.Errorf("%w: zip reader is not seekable", errArchiveCorrupt)
	}
	seeker, ok := reader.(io.Seeker)
	if !ok {
		return fmt.Errorf("%w: zip reader is not seekable", errArchiveCorrupt)
	}
	start, err := seeker.Seek(0, io.SeekCurrent)
	if err != nil {
		return err
	}
	end, err := seeker.Seek(0, io.SeekEnd)
	if err != nil {
		return err
	}
	if _, err := seeker.Seek(start, io.SeekStart); err != nil {
		return err
	}
	zr, err := yekazip.NewReader(readerAt, end-start)
	if err != nil {
		return err
	}
	for _, file := range zr.File {
		if file.IsEncrypted() {
			if password == "" {
				return errArchivePasswordRequired
			}
			file.SetPassword(password)
		}
	}
	for _, file := range zr.File {
		if err := ctx.Err(); err != nil {
			return err
		}
		entry := archiveEntry{
			name:       file.Name,
			mode:       file.Mode(),
			modifiedAt: file.ModTime(),
			open: func() (io.ReadCloser, error) {
				return file.Open()
			},
		}
		if file.Mode()&os.ModeSymlink != 0 {
			entry.linkTarget = ""
		}
		if err := writer.add(entry); err != nil {
			return err
		}
	}
	return nil
}
