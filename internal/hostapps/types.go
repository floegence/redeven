// Package hostapps connects Redeven's application catalog and owned sessions to
// native macOS applications or installed GIO and Xpra runtimes. Applications execute as the Runtime user.
package hostapps

import (
	"context"
	"errors"

	"github.com/floegence/redeven/internal/portforward"
)

type Application struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Categories  []string `json:"categories"`
	Icon        string   `json:"icon"`
	Custom      bool     `json:"custom"`
}

type Availability struct {
	Backend      string          `json:"backend,omitempty"`
	NativeReady  bool            `json:"native_ready,omitempty"`
	Permissions  map[string]bool `json:"permissions,omitempty"`
	Supported    bool            `json:"supported"`
	Ready        bool            `json:"ready"`
	Reason       string          `json:"reason,omitempty"`
	Version      string          `json:"version,omitempty"`
	Requirements []string        `json:"requirements,omitempty"`
}

type Catalog struct {
	Availability Availability  `json:"availability"`
	Applications []Application `json:"applications"`
	Sessions     []Session     `json:"sessions"`
}

type Session struct {
	Backend      string                      `json:"backend,omitempty"`
	Mode         string                      `json:"mode,omitempty"`
	ID           string                      `json:"id"`
	Application  Application                 `json:"application"`
	State        string                      `json:"state"`
	ErrorCode    string                      `json:"error_code,omitempty"`
	StartedAt    int64                       `json:"started_at_unix_ms"`
	Forward      *portforward.ForwardSession `json:"forward,omitempty"`
	Presentation Presentation                `json:"presentation"`
}

// Presentation comes from the caller's explicit localized catalog. The window
// document renders these bounded strings as text, never as markup or script.
type Presentation struct {
	Menu           string `json:"menu,omitempty"`
	Input          string `json:"input,omitempty"`
	Windows        string `json:"windows,omitempty"`
	CloseWindow    string `json:"closeWindow,omitempty"`
	SharedControl  string `json:"sharedControl,omitempty"`
	Locale         string `json:"locale"`
	Connecting     string `json:"connecting"`
	Reconnecting   string `json:"reconnecting"`
	Disconnected   string `json:"disconnected"`
	ConnectionHint string `json:"connectionHint"`
	Reconnect      string `json:"reconnect"`
	Starting       string `json:"starting"`
	Failed         string `json:"failed"`
	Ended          string `json:"ended"`
	Retry          string `json:"retry"`
}

type LaunchRequest struct {
	Mode          string       `json:"mode,omitempty"`
	ApplicationID string       `json:"application_id"`
	Locale        string       `json:"locale"`
	Presentation  Presentation `json:"presentation"`
}

type AddRequest struct {
	Name       string `json:"name"`
	Executable string `json:"executable"`
	Arguments  string `json:"arguments"`
}

type Backend interface {
	SetupStatus(string) (SetupStatus, error)
	WatchSetup() (<-chan struct{}, func(), error)
	StartSetup(string, string, string, int64) (SetupStatus, error)
	CancelSetup(string, string) (SetupStatus, error)
	WriteSetup(string, string, int64, []byte) (SetupStatus, error)
	CompleteSetup(string, string) (SetupStatus, error)
	Catalog(context.Context, string, string) (Catalog, error)
	Sessions(string) []Session
	Launch(context.Context, string, LaunchRequest) (Session, error)
	Stop(context.Context, string, string) error
	Add(context.Context, AddRequest) error
	ForTarget(string) (Session, string, bool)
	Password(string) string
	Permissions(context.Context, string) error
}

var (
	ErrUnavailable = errors.New("host applications are unavailable")
	ErrNotFound    = errors.New("application or session not found")
	ErrInvalid     = errors.New("invalid application request")
	ErrLimit       = errors.New("host application session limit reached")
)
