package ai

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
)

// The run owns the authorized task directory. Browser helpers only supply bytes
// for an exact source-owned ID; guest code cannot nominate a destination path.
func (r *run) saveComputerDownload(ctx context.Context, read func(context.Context, int) (map[string]any, error)) (map[string]any, error) {
	space, err := r.prepareTaskFilesContext(ctx)
	if err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(space.Scratch)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	name := "browser-download-" + rand.Text()
	file, err := root.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	complete := false
	defer func() {
		file.Close()
		if !complete {
			_ = root.Remove(name)
		}
	}()
	offset := 0
	size := -1
	var id, filename string
	for {
		if err = ctx.Err(); err != nil {
			return nil, err
		}
		chunk, e := read(ctx, offset)
		if e != nil {
			return nil, e
		}
		if offset == 0 {
			id = anyToString(chunk["id"])
			filename = anyToString(chunk["filename"])
		}
		bytes, e := base64.StdEncoding.DecodeString(anyToString(chunk["base64"]))
		more, valid := chunk["truncated"].(bool)
		if e != nil || !valid || id == "" || chunk["id"] != id || chunk["filename"] != filename || computerDownloadInteger(chunk["offset"]) != offset || computerDownloadInteger(chunk["bytes"]) != len(bytes) || len(bytes) > 65536 || offset+len(bytes) > 256*1024*1024 || (more && (len(bytes) == 0 || computerDownloadInteger(chunk["next_offset"]) != offset+len(bytes))) {
			return nil, errors.New("invalid browser download content")
		}
		if value, present := chunk["size_bytes"]; present {
			n := computerDownloadInteger(value)
			if n < 0 || n > 256*1024*1024 || (size >= 0 && size != n) || offset+len(bytes) > n || (!more && offset+len(bytes) != n) || (more && offset+len(bytes) >= n) {
				return nil, errors.New("invalid browser download size")
			}
			size = n
		} else if size >= 0 {
			return nil, errors.New("browser download size disappeared")
		}
		if _, err = file.Write(bytes); err != nil {
			return nil, err
		}
		offset += len(bytes)
		if !more {
			break
		}
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	if err = file.Close(); err != nil {
		return nil, err
	}
	complete = true
	return map[string]any{"id": id, "filename": filename, "path": filepath.Join(space.Scratch, name), "size_bytes": offset, "state": "saved", "action_executed": true}, nil
}

// Accept only exact nonnegative protocol integers; missing fields are invalid.
func computerDownloadInteger(value any) int {
	var n float64
	switch v := value.(type) {
	case int:
		n = float64(v)
	case float64:
		n = v
	case json.Number:
		var err error
		n, err = v.Float64()
		if err != nil {
			return -1
		}
	default:
		return -1
	}
	if math.IsNaN(n) || n < 0 || n > 256*1024*1024 || math.Trunc(n) != n {
		return -1
	}
	return int(n)
}
