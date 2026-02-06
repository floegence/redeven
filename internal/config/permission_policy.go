package config

import (
	"errors"
	"fmt"
	"strings"
)

const permissionPolicySchemaVersionV1 = 1

// PermissionPolicy is the local permission cap configuration stored on the agent endpoint.
//
// It is used to clamp control-plane granted permissions ("session_meta") to a user-approved maximum.
type PermissionPolicy struct {
	SchemaVersion int `json:"schema_version"`

	// LocalMax is the global cap. It must be present for schema_version=1.
	LocalMax *PermissionSet `json:"local_max"`

	// ByUser and ByApp are optional additional caps. They can only further reduce LocalMax.
	ByUser map[string]*PermissionSet `json:"by_user,omitempty"`
	ByApp  map[string]*PermissionSet `json:"by_app,omitempty"`
}

// PermissionSet is the 3-bit permission model used by Redeven agents.
type PermissionSet struct {
	Read    bool `json:"read"`
	Write   bool `json:"write"`
	Execute bool `json:"execute"`
}

func (p PermissionSet) Intersect(other PermissionSet) PermissionSet {
	return PermissionSet{
		Read:    p.Read && other.Read,
		Write:   p.Write && other.Write,
		Execute: p.Execute && other.Execute,
	}
}

func defaultPermissionSet() PermissionSet {
	// Default: allow all RWX capabilities out of the box.
	//
	// NOTE: This is a local cap only. The effective permissions are still clamped by the control-plane grant.
	return PermissionSet{Read: true, Write: true, Execute: true}
}

func defaultPermissionPolicy() *PermissionPolicy {
	d := defaultPermissionSet()
	return &PermissionPolicy{
		SchemaVersion: permissionPolicySchemaVersionV1,
		LocalMax:      &d,
	}
}

func (p *PermissionPolicy) Validate() error {
	if p == nil {
		return nil
	}
	if p.SchemaVersion != permissionPolicySchemaVersionV1 {
		return fmt.Errorf("unsupported schema_version: %d", p.SchemaVersion)
	}
	if p.LocalMax == nil {
		return errors.New("missing local_max")
	}
	return nil
}

// ResolveCap returns the local cap to apply for the given user/app pair.
//
// The resolution model is:
// - start from LocalMax
// - intersect with by_user[user_public_id] if present
// - intersect with by_app[floe_app] if present
func (p *PermissionPolicy) ResolveCap(userPublicID string, floeApp string) PermissionSet {
	if p == nil || p.LocalMax == nil {
		return defaultPermissionSet()
	}
	cap := *p.LocalMax

	userPublicID = strings.TrimSpace(userPublicID)
	if userPublicID != "" && p.ByUser != nil {
		if u := p.ByUser[userPublicID]; u != nil {
			cap = cap.Intersect(*u)
		}
	}

	floeApp = strings.TrimSpace(floeApp)
	if floeApp != "" && p.ByApp != nil {
		if a := p.ByApp[floeApp]; a != nil {
			cap = cap.Intersect(*a)
		}
	}

	return cap
}

func ParsePermissionPolicyPreset(preset string) (*PermissionPolicy, error) {
	p := strings.ToLower(strings.TrimSpace(preset))
	p = strings.ReplaceAll(p, "-", "_")

	switch p {
	case "":
		return defaultPermissionPolicy(), nil
	case "execute_read":
		s := PermissionSet{Read: true, Write: false, Execute: true}
		return &PermissionPolicy{SchemaVersion: permissionPolicySchemaVersionV1, LocalMax: &s}, nil
	case "read_only":
		s := PermissionSet{Read: true, Write: false, Execute: false}
		return &PermissionPolicy{SchemaVersion: permissionPolicySchemaVersionV1, LocalMax: &s}, nil
	case "execute_read_write":
		s := PermissionSet{Read: true, Write: true, Execute: true}
		return &PermissionPolicy{SchemaVersion: permissionPolicySchemaVersionV1, LocalMax: &s}, nil
	default:
		return nil, fmt.Errorf("unknown permission policy preset: %q", preset)
	}
}
