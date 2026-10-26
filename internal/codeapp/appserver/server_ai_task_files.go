package appserver

import (
	"fmt"
	"io"
	"mime"
	"net/http"
	"strconv"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/session"
)

func serveFlowerTaskFile(w http.ResponseWriter, r *http.Request, svc *ai.Service, meta *session.Meta, threadID string, chunked bool) {
	q := r.URL.Query()
	kind := q.Get("kind")
	if kind != "working" && kind != "delivered" {
		writeJSON(w, 400, apiResp{OK: false, Error: "invalid file kind"})
		return
	}
	file, err := svc.OpenTaskFile(r.Context(), meta, threadID, q.Get("path"), kind == "working")
	if err != nil {
		writeJSON(w, aiThreadActionHTTPStatus(err), apiResp{OK: false, Error: "file unavailable"})
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		writeJSON(w, 400, apiResp{OK: false, Error: "not a regular file"})
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	if !chunked {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": info.Name()}))
		http.ServeContent(w, r, info.Name(), info.ModTime(), file)
		return
	}
	offset, err := strconv.ParseInt(q.Get("offset"), 10, 64)
	if err != nil || offset < 0 || offset > info.Size() {
		writeJSON(w, 400, apiResp{OK: false, Error: "invalid file offset"})
		return
	}
	data := make([]byte, min(int64(256<<10), info.Size()-offset))
	n, err := file.ReadAt(data, offset)
	if err != nil && err != io.EOF {
		writeJSON(w, 409, apiResp{OK: false, Error: "file changed"})
		return
	}
	after, err := file.Stat()
	if err != nil || after.Size() != info.Size() || !after.ModTime().Equal(info.ModTime()) || n != len(data) {
		writeJSON(w, 409, apiResp{OK: false, Error: "file changed"})
		return
	}
	writeJSON(w, 200, apiResp{OK: true, Data: map[string]any{"bytes": data, "next_offset": offset + int64(n), "size": info.Size(), "version": fmt.Sprintf("%d:%d", info.Size(), info.ModTime().UnixNano())}})
}
