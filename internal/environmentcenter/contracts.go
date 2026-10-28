package environmentcenter

import (
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/webbinding"
)

// These public DTOs are the single contract source for Center's generated TS
// declarations and JSON Schema. Credential-bearing persistence types stay private.
type Status struct {
	Authenticated bool     `json:"authenticated"`
	Security      Security `json:"security"`
	Device        Device   `json:"device"`
	Origin        string   `json:"origin"`
}

func PublicContracts() map[string]any {
	return map[string]any{
		"PairPreview": PairPreview{}, "RouteResult": RouteResult{}, "Binding": webbinding.Binding{}, "ApplicationResult": ApplicationResult{}, "Empty": struct{}{}, "Devices": []Device{}, "AuditEvents": []auditEvent{},
		"SetupRequest":          SetupRequest{},
		"RevokeDeviceRequest":   RevokeDeviceRequest{},
		"PasswordRequest":       PasswordRequest{},
		"GrantRequest":          GrantRequest{},
		"AddBookmarkRequest":    AddBookmarkRequest{},
		"RemoveBookmarkRequest": RemoveBookmarkRequest{},
		"AddRouteRequest":       AddRouteRequest{},
		"RotateRouteRequest":    RotateRouteRequest{},
		"FavoriteRequest":       FavoriteRequest{},
		"RemoveSourceRequest":   RemoveSourceRequest{},
		"OpenRequest":           OpenRequest{},
		"CancelRequest":         CancelRequest{},
		"BeginPairRequest":      BeginPairRequest{},
		"CompletePairRequest":   CompletePairRequest{},
		"ApplicationRequest":    ApplicationRequest{}, "AuditEvent": auditEvent{}, "Status": Status{}, "Security": Security{}, "Device": Device{}, "Source": Source{},
		"Directory": Directory{}, "Route": Route{}, "Bookmark": Bookmark{}, "BookmarkInput": BookmarkInput{},
		"RotateRouteInput": RotateRouteInput{}, "RouteInput": RouteInput{}, "Operation": openOperation{}, "Setup": SetupResult{},
		"Authentication": Authentication{}, "AuthenticationResult": AuthenticationResult{},
		"Catalog": gp.CatalogResponse{}, "Member": gp.Member{},
	}
}

type SetupRequest struct {
	Bootstrap   string `json:"bootstrap,omitempty"`
	Password    string `json:"password,omitempty"`
	Operation   string `json:"operation,omitempty"`
	Code        string `json:"code,omitempty"`
	Saved       bool   `json:"saved,omitempty"`
	Replacement bool   `json:"replacement,omitempty"`
}

type RevokeDeviceRequest struct {
	ID  string `json:"id,omitempty"`
	All bool   `json:"all,omitempty"`
}

type PasswordRequest struct {
	Grant    string `json:"grant"`
	Password string `json:"password"`
}

type GrantRequest struct {
	Grant string `json:"grant"`
}

type AddBookmarkRequest struct {
	Grant string        `json:"grant"`
	Input BookmarkInput `json:"input"`
}

type RemoveBookmarkRequest struct {
	ID       string `json:"id"`
	Revision int64  `json:"revision"`
}

type AddRouteRequest struct {
	Grant string     `json:"grant"`
	Input RouteInput `json:"input"`
}

type RotateRouteRequest struct {
	Grant string           `json:"grant"`
	Input RotateRouteInput `json:"input"`
}

type FavoriteRequest struct {
	ID       string `json:"id"`
	Value    bool   `json:"value"`
	Revision int64  `json:"revision"`
}

type RemoveSourceRequest struct {
	Grant    string `json:"grant"`
	ID       string `json:"id"`
	Revision int64  `json:"revision"`
}

type OpenRequest struct {
	Route   string `json:"route"`
	Request string `json:"request"`
}

type CancelRequest struct {
	ID string `json:"id"`
}

type BeginPairRequest struct {
	URL        string `json:"url"`
	Name       string `json:"name"`
	AccessCode string `json:"access_code"`
	Grant      string `json:"grant"`
}

type CompletePairRequest struct {
	Operation   string `json:"operation"`
	Fingerprint string `json:"fingerprint"`
	Revision    int64  `json:"revision"`
}

type PairPreview struct {
	Operation   string `json:"operation"`
	GatewayID   string `json:"gateway_id"`
	Fingerprint string `json:"fingerprint"`
	URL         string `json:"url"`
}
type RouteResult struct {
	Route   Route              `json:"route"`
	Binding webbinding.Binding `json:"binding"`
}
type ApplicationResult struct {
	Destination string `json:"destination"`
	Origin      string `json:"origin"`
}

// EndpointContracts is the browser HTTP contract, generated alongside the DTOs.
// Authentication, revision and permission checks remain server-owned behavior.
func EndpointContracts() map[string][2]string {
	return map[string][2]string{
		"status": {"", "Status"}, "directory": {"", "Directory"},
		"catalog": {"", "Catalog"}, "devices": {"", "Devices"},
		"security": {"", "Security"}, "audit": {"", "AuditEvents"},
		"binding": {"", "Binding"}, "operations": {"", "Operation"},
		"authenticate": {"Authentication", "AuthenticationResult"},
		"setup/start":  {"SetupRequest", "Setup"}, "setup/verify": {"SetupRequest", "Setup"},
		"setup/commit": {"SetupRequest", "Empty"}, "setup/cancel": {"SetupRequest", "Empty"},
		"activity": {"Empty", "Device"}, "devices/revoke": {"RevokeDeviceRequest", "Empty"},
		"password": {"PasswordRequest", "Empty"}, "factor/replace": {"GrantRequest", "Setup"},
		"recovery/rotate": {"GrantRequest", "Setup"}, "gateways/begin": {"BeginPairRequest", "PairPreview"},
		"gateways/complete": {"CompletePairRequest", "Empty"}, "bookmarks/add": {"AddBookmarkRequest", "Bookmark"},
		"bookmarks/remove": {"RemoveBookmarkRequest", "Empty"}, "routes/add": {"AddRouteRequest", "RouteResult"},
		"routes/rotate": {"RotateRouteRequest", "Binding"}, "routes/favorite": {"FavoriteRequest", "Empty"},
		"sources/remove": {"RemoveSourceRequest", "Empty"}, "open": {"OpenRequest", "Operation"},
		"operations/cancel": {"CancelRequest", "Operation"},
	}
}
