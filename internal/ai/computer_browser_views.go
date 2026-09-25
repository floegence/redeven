package ai

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/browserstore"
	"github.com/floegence/redeven/internal/session"
)

var errBrowserViewUnavailable = errors.New("browser view unavailable")

const browserInputDrainTimeout = 5 * time.Second

type BrowserViewRequest struct {
	Targets       []string `json:"targets"`
	InitialTarget string   `json:"initial_target"`
	ProfileID     string   `json:"profile_id,omitempty"`
	workspace     *browserWorkspace
}

type BrowserViewDescriptor struct {
	Generation       string `json:"generation"`
	ID               string `json:"id"`
	Protocol         int    `json:"protocol_version"`
	MediaProtocol    int    `json:"media_wire_version"`
	ProfileID        string `json:"profile_id,omitempty"`
	InitialTarget    string `json:"initial_target"`
	LibraryProfileID string `json:"library_profile_id,omitempty"`
}

// View identity and source grants belong to Runtime. The helper only applies
// these grants to the published projection engine. A view never grants AI access.
type browserView struct {
	runtime            *ComputerUseRuntime
	host               *browserSourceHost
	id, owner, channel string
	targets            []string
	initial            string
	profile            string
	libraryProfile     string
	libraryTabs        map[string]browserstore.Tab // Last observed metadata, under connectMu.
	workspace          *browserWorkspace
	ctx                context.Context
	cancel             context.CancelFunc
	mu                 sync.Mutex
	observing          bool
	input              bool
	uploads            int
	expiry             *time.Timer
	opMu               sync.Mutex
	lease              *browserTargetLease
	target, token      string
	closeOnce          sync.Once
	closeError         error
}

func (r *ComputerUseRuntime) OpenBrowserView(ctx context.Context, meta *session.Meta, request BrowserViewRequest) (BrowserViewDescriptor, error) {
	if r == nil || requireRWX(meta) != nil || browserLibraryOwner(meta) == "" || strings.TrimSpace(meta.ChannelID) == "" || len(request.Targets) == 0 || len(request.Targets) > 128 {
		return BrowserViewDescriptor{}, errBrowserViewUnavailable
	}
	if request.InitialTarget == "" {
		request.InitialTarget = request.Targets[0]
	}
	if !slices.Contains(request.Targets, request.InitialTarget) {
		return BrowserViewDescriptor{}, errBrowserViewUnavailable
	}
	r.connectMu.Lock()
	defer r.connectMu.Unlock()
	if len(request.Targets) == 1 && request.ProfileID == "" {
		for _, workspace := range r.browserWorkspaces {
			if workspace.owner == browserLibraryOwner(meta) && slices.Contains(workspace.targets, request.Targets[0]) {
				request.workspace, request.Targets = workspace, slices.Clone(workspace.targets)
				if workspace.connection == nil {
					request.ProfileID = workspace.profile
				}
				break
			}
		}
	}
	return r.openBrowserViewLocked(ctx, meta, request)
}

func (r *ComputerUseRuntime) openBrowserViewLocked(ctx context.Context, meta *session.Meta, request BrowserViewRequest) (BrowserViewDescriptor, error) {
	r.mu.RLock()
	valid := !r.closed && len(r.browserViews) < 16
	profile := r.managedProfiles[request.ProfileID]
	if request.ProfileID != "" && (profile == nil || profile.stopped()) {
		valid = false
	}
	for i, target := range request.Targets {
		var sourceHost *browserSourceHost
		executor, managed := r.executors[target].(*PlaywrightTargetExecutor)
		if managed {
			sourceHost = executor.sourceHost
		} else if extension, ok := r.executors[target].(*extensionTargetExecutor); ok {
			sourceHost = extension.sourceHost
		}
		if sourceHost == nil || sourceHost != r.browserHost || slices.Contains(request.Targets[:i], target) {
			valid = false
			break
		}
		if request.ProfileID != "" && (!managed || profile == nil || !executor.ManagedAttachment || executor.CDPURL != profile.endpoint) {
			valid = false
			break
		}
	}
	r.mu.RUnlock()
	if !valid {
		return BrowserViewDescriptor{}, errBrowserViewUnavailable
	}
	host, err := r.browserSourceHostLocked(ctx)
	if err != nil {
		return BrowserViewDescriptor{}, err
	}
	for _, target := range request.Targets {
		if err := host.call(ctx, "source.ready", map[string]string{"target": target}, nil); err != nil {
			return BrowserViewDescriptor{}, errBrowserViewUnavailable
		}
	}
	libraryProfile, err := r.prepareBrowserViewLibrary(ctx, meta, request)
	if err != nil {
		return BrowserViewDescriptor{}, err
	}
	lifetime, cancel := context.WithCancel(host.ctx)
	view := &browserView{runtime: r, host: host, id: "browser-view-" + rand.Text(), owner: browserLibraryOwner(meta), channel: meta.ChannelID, targets: slices.Clone(request.Targets), initial: request.InitialTarget, profile: request.ProfileID, ctx: lifetime, cancel: cancel}
	view.workspace = request.workspace
	view.libraryProfile = libraryProfile
	view.libraryTabs = make(map[string]browserstore.Tab)
	r.mu.Lock()
	if r.browserViews == nil {
		r.browserViews = make(map[string]*browserView)
	}
	r.browserViews[view.id] = view
	r.mu.Unlock()
	if libraryProfile != "" && (view.workspace == nil || view.workspace.connection != nil) {
		var tabs []browserstore.Tab
		if err := host.call(ctx, "source.describe", map[string]any{"targets": request.Targets}, &tabs); err != nil {
			_ = view.close()
			return BrowserViewDescriptor{}, err
		}
		for index, tab := range tabs {
			if index < len(request.Targets) {
				r.browserSourceMetadata(ctx, browserHostEvent{Target: request.Targets[index], Tab: &tab})
			}
		}
	}
	// An issued document grant cannot remain orphaned if the client never opens
	// its DOM carrier. The DOM stream owns the view lifetime once attached.
	view.expiry = time.AfterFunc(time.Minute, func() { _ = view.close() })
	context.AfterFunc(lifetime, func() { _ = view.close() })
	return BrowserViewDescriptor{Generation: r.browserServiceSnapshot().Generation, ID: view.id, Protocol: browserProjectionProtocolVersion, MediaProtocol: browserMediaWireVersion, ProfileID: view.profile, InitialTarget: view.initial, LibraryProfileID: view.libraryProfile}, nil
}

func (r *ComputerUseRuntime) browserView(meta *session.Meta, id string) (*browserView, error) {
	if r == nil || requireRWX(meta) != nil {
		return nil, errBrowserViewUnavailable
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	view := r.browserViews[id]
	if r.closed || view == nil || view.ctx.Err() != nil || view.owner != browserLibraryOwner(meta) || view.channel != meta.ChannelID {
		return nil, errBrowserViewUnavailable
	}
	return view, nil
}

func (r *ComputerUseRuntime) AuthorizeBrowserView(meta *session.Meta, id string) error {
	_, err := r.browserView(meta, id)
	return err
}

// Visibility and audio are observation preferences, never an input lease. A
// hidden view can retain authorized audio without competing for source sizing.
func (r *ComputerUseRuntime) SetBrowserViewPreferences(ctx context.Context, meta *session.Meta, id string, visible, audio bool) error {
	view, err := r.browserView(meta, id)
	if err != nil {
		return err
	}
	view.opMu.Lock()
	defer view.opMu.Unlock()
	ctx, cancel := view.operationContext(ctx)
	defer cancel()
	view.mu.Lock()
	observing := view.observing
	view.mu.Unlock()
	if !observing || ctx.Err() != nil {
		return errBrowserViewUnavailable
	}
	if err := view.host.call(ctx, "view.visible", map[string]any{"view": id, "visible": visible}, nil); err != nil {
		return err
	}
	return view.host.call(ctx, "view.audio", map[string]any{"view": id, "enabled": audio}, nil)
}

func (view *browserView) operationContext(ctx context.Context) (context.Context, func()) {
	ctx, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(view.ctx, cancel)
	return ctx, func() { stop(); cancel() }
}

// Closing the DOM carrier revokes every capability of this view. Media and file
// lanes borrow its lifetime; closing one of those lanes never closes the view.
func (r *ComputerUseRuntime) OpenBrowserObservation(ctx context.Context, meta *session.Meta, id string) (io.ReadCloser, error) {
	if r == nil {
		return nil, errBrowserViewUnavailable
	}
	// Directory updates must observe the registered helper view and the same
	// grant snapshot. Only registration holds this lock, never the stream body.
	r.connectMu.Lock()
	defer r.connectMu.Unlock()
	view, err := r.browserView(meta, id)
	if err != nil {
		return nil, err
	}
	view.mu.Lock()
	if view.observing {
		view.mu.Unlock()
		return nil, errBrowserViewUnavailable
	}
	view.expiry.Stop()
	targets := slices.Clone(view.targets)
	view.mu.Unlock()
	ctx, cancel := view.operationContext(ctx)
	body, _ := json.Marshal(map[string]any{"id": view.id, "targets": targets, "initialTab": view.initial, "editable": view.workspace != nil, "restoreClosedTabs": view.workspace != nil && view.workspace.connection == nil, "audio": false, "visible": true})
	response, err := view.host.request(ctx, http.MethodPost, "/observe", bytes.NewReader(body))
	if err != nil {
		cancel()
		_ = view.close()
		return nil, errBrowserViewUnavailable
	}
	if response.StatusCode != http.StatusOK {
		_ = response.Body.Close()
		cancel()
		_ = view.close()
		return nil, errBrowserViewUnavailable
	}
	view.mu.Lock()
	view.observing = true
	view.mu.Unlock()
	return &browserObservationBody{ReadCloser: response.Body, close: func() { cancel(); _ = view.close() }}, nil
}

type browserObservationBody struct {
	io.ReadCloser
	close func()
	once  sync.Once
}

func (body *browserObservationBody) Close() error {
	err := body.ReadCloser.Close()
	body.once.Do(body.close)
	return err
}

func (r *ComputerUseRuntime) AcquireBrowserViewControl(ctx context.Context, meta *session.Meta, id, target string, takeover, private bool) (string, error) {
	view, err := r.browserView(meta, id)
	if err != nil {
		return "", err
	}
	view.opMu.Lock()
	defer view.opMu.Unlock()
	ctx, cancel := view.operationContext(ctx)
	defer cancel()
	view.mu.Lock()
	observing := view.observing
	view.mu.Unlock()
	if !observing || ctx.Err() != nil || !view.permits(target) {
		return "", errBrowserViewUnavailable
	}
	if view.lease != nil && view.target == target && view.lease.private == private && view.lease.current() {
		return view.token, nil
	}
	if err := view.release(ctx); err != nil {
		return "", err
	}
	token := rand.Text()
	lease, err := r.acquireBrowserLease(ctx, target, id, private, takeover, func(cleanup context.Context) error {
		if err := view.host.call(cleanup, "view.release", map[string]string{"view": id, "token": token}, nil); err != nil {
			return err
		}
		if private {
			return view.host.call(cleanup, "view.privacy", map[string]any{"target": target, "view": nil}, nil)
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	view.lease, view.target, view.token = lease, target, token
	err = lease.run(ctx, func(ctx context.Context) error {
		var observer any
		if private {
			observer = id
		}
		if err := view.host.call(ctx, "view.privacy", map[string]any{"target": target, "view": observer}, nil); err != nil {
			return err
		}
		var granted bool
		if err := view.host.call(ctx, "view.acquire", map[string]string{"view": id, "target": target, "token": token}, &granted); err != nil {
			return err
		}
		if !granted {
			return errBrowserControlRevoked
		}
		return nil
	})
	if err != nil {
		cleanup, done := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer done()
		return "", errors.Join(err, view.release(cleanup))
	}
	return token, nil
}

// Caller holds opMu. Failed cleanup retains the revoked lease at the target
// gate; neither another view nor AI can bypass an uncertain release.
func (view *browserView) release(ctx context.Context) error {
	if view.lease == nil {
		return nil
	}
	if err := view.lease.close(ctx); err != nil {
		return err
	}
	view.lease, view.target, view.token = nil, "", ""
	return nil
}

func (r *ComputerUseRuntime) ReleaseBrowserViewControl(ctx context.Context, meta *session.Meta, id, token string) error {
	view, err := r.browserView(meta, id)
	if err != nil {
		return err
	}
	view.opMu.Lock()
	defer view.opMu.Unlock()
	if token == "" || token != view.token {
		return errBrowserControlRevoked
	}
	return view.release(ctx)
}

func (r *ComputerUseRuntime) ReceiveBrowserView(ctx context.Context, meta *session.Meta, id, token string, message json.RawMessage) error {
	view, err := r.browserView(meta, id)
	if err != nil {
		return err
	}
	if len(message) > 64*1024 {
		return errBrowserViewUnavailable
	}
	var envelope struct {
		Type, Tab string
		Action    struct{ Kind, Tab string }
	}
	if json.Unmarshal(message, &envelope) != nil {
		return errBrowserViewUnavailable
	}
	ctx, cancel := view.operationContext(ctx)
	defer cancel()
	// A directory-owned beforeunload decision releases source.close while it
	// holds the target gate. Only the SDK's exact pending decision can use this
	// path; an ordinary website dialog still requires the page input lease.
	if envelope.Type == "command" && envelope.Action.Kind == "dialog_reply" {
		var accepted bool
		if err := view.host.call(ctx, "view.directory_decision", map[string]any{"view": id, "message": message}, &accepted); err != nil {
			return err
		}
		if accepted {
			return nil
		}
	}
	view.opMu.Lock()
	defer view.opMu.Unlock()
	receive := func(ctx context.Context) error {
		return view.host.call(ctx, "view.receive", map[string]any{"view": id, "token": token, "message": message}, nil)
	}
	if envelope.Type == "command" && !strings.HasPrefix(envelope.Action.Kind, "tab_") {
		if token == "" || token != view.token || envelope.Tab != view.target || view.lease == nil {
			return errBrowserControlRevoked
		}
		if err := view.lease.run(ctx, receive); err != nil {
			view.lease.revoke()
			return err
		}
		return nil
	}
	if envelope.Type == "command" && envelope.Action.Kind == "tab_select" {
		if !view.permits(envelope.Action.Tab) {
			return errBrowserViewUnavailable
		}
		if err := view.release(ctx); err != nil {
			return err
		}
	}
	return receive(ctx)
}

func (view *browserView) permits(target string) bool {
	view.mu.Lock()
	defer view.mu.Unlock()
	return slices.Contains(view.targets, target)
}

func (view *browserView) close() error {
	// Immediate cancellation fences new work before waiting on in-flight input.
	view.cancel()
	view.closeOnce.Do(func() {
		view.runtime.mu.Lock()
		delete(view.runtime.browserViews, view.id)
		view.runtime.mu.Unlock()
		view.mu.Lock()
		if view.expiry != nil {
			view.expiry.Stop()
		}
		view.mu.Unlock()
		view.opMu.Lock()
		defer view.opMu.Unlock()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		view.closeError = view.release(ctx)
		if view.closeError == nil {
			view.closeError = view.host.call(ctx, "view.close", map[string]string{"view": view.id}, nil)
		}
	})
	return view.closeError
}

func (r *ComputerUseRuntime) CloseBrowserView(_ context.Context, meta *session.Meta, id string) error {
	view, err := r.browserView(meta, id)
	if err != nil {
		return err
	}
	return view.close()
}

func (r *ComputerUseRuntime) CloseBrowserChannel(meta *session.Meta) {
	if meta == nil {
		return
	}
	r.mu.RLock()
	var views []*browserView
	for _, view := range r.browserViews {
		if view.channel == meta.ChannelID && view.owner == browserLibraryOwner(meta) {
			views = append(views, view)
		}
	}
	r.mu.RUnlock()
	for _, view := range views {
		_ = view.close()
	}
}
