package ai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"

	"github.com/floegence/redeven/internal/session"
)

// These finite lanes borrow the view's authenticated lifetime. The published
// source engine resolves opaque resources and files; Runtime never accepts a
// website URL or a source filesystem path from the client.
func (r *ComputerUseRuntime) openBrowserFile(ctx context.Context, meta *session.Meta, id, target, file, route string) (*http.Response, error) {
	view, err := r.browserView(meta, id)
	if err != nil || file == "" || len(file) > 4096 || !view.permits(target) {
		return nil, errBrowserViewUnavailable
	}
	ctx, cancel := view.operationContext(ctx)
	query := url.Values{"view": {id}, "target": {target}, "id": {file}}
	response, err := view.host.request(ctx, http.MethodGet, route+"?"+query.Encode(), nil)
	if err != nil {
		cancel()
		return nil, errBrowserViewUnavailable
	}
	if response.StatusCode != http.StatusOK {
		_ = response.Body.Close()
		cancel()
		return nil, errBrowserViewUnavailable
	}
	response.Body = &browserHostBody{ReadCloser: response.Body, release: cancel}
	return response, nil
}

func (r *ComputerUseRuntime) OpenBrowserResource(ctx context.Context, meta *session.Meta, id, target, resource string) (*http.Response, error) {
	return r.openBrowserFile(ctx, meta, id, target, resource, "/resource")
}

func (r *ComputerUseRuntime) OpenBrowserDownload(ctx context.Context, meta *session.Meta, id, target, download string) (*http.Response, error) {
	return r.openBrowserFile(ctx, meta, id, target, download, "/download")
}

type BrowserUploadFile struct {
	Chooser      string
	Name         string
	Size         int64
	RelativePath string
}

func (r *ComputerUseRuntime) UploadBrowserFile(ctx context.Context, meta *session.Meta, id, token string, file BrowserUploadFile, body io.Reader) (string, error) {
	view, err := r.browserView(meta, id)
	if err != nil || body == nil || file.Chooser == "" || len(file.Chooser) > 256 || file.Name == "" || len(file.Name) > 1024 || len(file.RelativePath) > 4096 || file.Size < 0 || file.Size > 256<<20 {
		return "", errBrowserViewUnavailable
	}
	view.opMu.Lock()
	lease := view.lease
	authorized := token != "" && token == view.token && lease != nil && lease.current()
	view.opMu.Unlock()
	if !authorized {
		return "", errBrowserControlRevoked
	}
	ctx, cancel := view.operationContext(ctx)
	defer cancel()
	// Staging bytes does not operate the source input element. Keep it off the
	// target gate; the SDK commits staged IDs only through the ordered file reply.
	go func() {
		select {
		case <-lease.revoked:
			cancel()
		case <-ctx.Done():
		}
	}()
	query := url.Values{"view": {id}, "token": {token}, "chooser": {file.Chooser}, "name": {file.Name}, "size": {strconv.FormatInt(file.Size, 10)}}
	if file.RelativePath != "" {
		query.Set("relativePath", file.RelativePath)
	}
	response, err := view.host.request(ctx, http.MethodPost, "/upload?"+query.Encode(), io.LimitReader(body, file.Size+1))
	if err != nil {
		return "", errBrowserViewUnavailable
	}
	defer response.Body.Close()
	var result struct {
		ID string `json:"id"`
	}
	if response.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&result) != nil || result.ID == "" || len(result.ID) > 256 || !lease.current() {
		return "", errBrowserViewUnavailable
	}
	return result.ID, nil
}
