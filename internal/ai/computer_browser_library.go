package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"

	"github.com/floegence/redeven/internal/browserstore"
	"github.com/floegence/redeven/internal/session"
)

// Browser library state is product-owned and independent from the AI thread
// store. The owner key binds it to the authenticated user and environment;
// runtime target IDs, cookies, form contents and control leases never enter it.
func browserLibraryOwner(meta *session.Meta) string {
	if meta == nil {
		return ""
	}
	user, environment := strings.TrimSpace(meta.UserPublicID), strings.TrimSpace(meta.EndpointID)
	if user == "" || environment == "" {
		return ""
	}
	digest := sha256.Sum256([]byte(user + "\x00" + environment))
	return hex.EncodeToString(digest[:])
}

// External libraries describe only explicitly admitted product browsing. The
// profile key never contains a debugger endpoint and grants no restore authority.
// Caller holds connectMu; executor identity is immutable after admission.
func (r *ComputerUseRuntime) browserSourceLibrary(target string) browserstore.Profile {
	switch source := r.executors[target].(type) {
	case *PlaywrightTargetExecutor:
		if source.ManagedAttachment {
			for id, process := range r.managedProfiles {
				if process.endpoint == source.CDPURL {
					return browserstore.Profile{ID: id, Name: id, Kind: browserstore.Managed}
				}
			}
		}
		digest := sha256.Sum256([]byte(source.CDPURL + "\x00" + source.BrowserContextID))
		return browserstore.Profile{ID: "cdp-" + hex.EncodeToString(digest[:]), Name: "Chromium", Kind: browserstore.CDP}
	case *extensionTargetExecutor:
		return browserstore.Profile{ID: source.client.profile.LibraryID, Name: source.client.profile.Name, Kind: browserstore.Extension}
	default:
		return browserstore.Profile{}
	}
}

func (r *ComputerUseRuntime) prepareBrowserViewLibrary(ctx context.Context, meta *session.Meta, request BrowserViewRequest) (string, error) {
	if r.browserStore == nil {
		return "", nil
	}
	if request.ProfileID != "" {
		return request.ProfileID, nil
	}
	r.mu.RLock()
	profile := r.browserSourceLibrary(request.Targets[0])
	for _, target := range request.Targets[1:] {
		if r.browserSourceLibrary(target).ID != profile.ID {
			profile = browserstore.Profile{}
			break
		}
	}
	r.mu.RUnlock()
	if profile.ID == "" {
		return "", nil
	}
	if profile.Kind == browserstore.Managed {
		return profile.ID, nil
	}
	if err := r.browserStore.PutProfile(ctx, browserLibraryOwner(meta), profile); err != nil {
		return "", err
	}
	return profile.ID, nil
}

func (r *ComputerUseRuntime) browserLibrary(meta *session.Meta) (*ComputerUseRuntime, string, error) {
	if err := requireRWX(meta); err != nil {
		return nil, "", err
	}
	if r == nil || r.browserStoreErr != nil || r.browserStore == nil {
		return nil, "", errors.New("browser library unavailable")
	}
	owner := browserLibraryOwner(meta)
	if owner == "" {
		return nil, "", errors.New("browser library owner unavailable")
	}
	return r, owner, nil
}

func (r *ComputerUseRuntime) BrowserLibraryProfiles(ctx context.Context, meta *session.Meta) ([]browserstore.Profile, error) {
	host, owner, err := r.browserLibrary(meta)
	if err != nil {
		return nil, err
	}
	return host.browserStore.Profiles(ctx, owner)
}

func (r *ComputerUseRuntime) SaveBrowserLibraryProfile(ctx context.Context, meta *session.Meta, profile browserstore.Profile) error {
	host, owner, err := r.browserLibrary(meta)
	if err != nil {
		return err
	}
	return host.browserStore.PutProfile(ctx, owner, profile)
}

func (r *ComputerUseRuntime) BrowserLibraryTabs(ctx context.Context, meta *session.Meta, profileID string) ([]browserstore.Tab, error) {
	host, owner, err := r.browserLibrary(meta)
	if err != nil {
		return nil, err
	}
	return host.browserStore.Tabs(ctx, owner, profileID)
}

func (r *ComputerUseRuntime) SaveBrowserBookmark(ctx context.Context, meta *session.Meta, profileID string, entry browserstore.Entry) error {
	host, owner, err := r.browserLibrary(meta)
	if err != nil {
		return err
	}
	return host.browserStore.PutBookmark(ctx, owner, profileID, entry)
}

func (r *ComputerUseRuntime) BrowserBookmarks(ctx context.Context, meta *session.Meta, profileID string) ([]browserstore.Entry, error) {
	host, owner, err := r.browserLibrary(meta)
	if err != nil {
		return nil, err
	}
	return host.browserStore.Bookmarks(ctx, owner, profileID)
}

func (r *ComputerUseRuntime) DeleteBrowserBookmark(ctx context.Context, meta *session.Meta, profileID, url string) error {
	host, owner, err := r.browserLibrary(meta)
	if err != nil {
		return err
	}
	return host.browserStore.DeleteBookmark(ctx, owner, profileID, url)
}

func (r *ComputerUseRuntime) BrowserZoom(ctx context.Context, meta *session.Meta, profileID, origin string) (float64, error) {
	host, owner, err := r.browserLibrary(meta)
	if err != nil {
		return 0, err
	}
	return host.browserStore.Zoom(ctx, owner, profileID, origin)
}

func (r *ComputerUseRuntime) SaveBrowserZoom(ctx context.Context, meta *session.Meta, profileID, origin string, zoom float64) error {
	host, owner, err := r.browserLibrary(meta)
	if err != nil {
		return err
	}
	return host.browserStore.SetZoom(ctx, owner, profileID, origin, zoom)
}

func (r *ComputerUseRuntime) RecordBrowserVisit(ctx context.Context, meta *session.Meta, profileID string, entry browserstore.Entry) error {
	host, owner, err := r.browserLibrary(meta)
	if err != nil {
		return err
	}
	return host.browserStore.Visit(ctx, owner, profileID, entry)
}

func (r *ComputerUseRuntime) BrowserHistory(ctx context.Context, meta *session.Meta, profileID, query string, limit int) ([]browserstore.Entry, error) {
	host, owner, err := r.browserLibrary(meta)
	if err != nil {
		return nil, err
	}
	return host.browserStore.History(ctx, owner, profileID, query, limit)
}

func (r *ComputerUseRuntime) ClearBrowserHistory(ctx context.Context, meta *session.Meta, profileID string) error {
	host, owner, err := r.browserLibrary(meta)
	if err != nil {
		return err
	}
	return host.browserStore.ClearHistory(ctx, owner, profileID)
}
