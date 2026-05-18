package config

import (
	"errors"
	"fmt"
	"strings"
)

const FilesystemScopeSchemaVersionV1 = 1

type FilesystemScope struct {
	SchemaVersion int                    `json:"schema_version"`
	DefaultRootID string                 `json:"default_root_id,omitempty"`
	Roots         []FilesystemRootPolicy `json:"roots"`
}

type FilesystemRootKind string

const (
	FilesystemRootHome     FilesystemRootKind = "home"
	FilesystemRootComputer FilesystemRootKind = "computer"
	FilesystemRootCustom   FilesystemRootKind = "custom"
)

type FilesystemRootPolicy struct {
	ID          string                  `json:"id"`
	Label       string                  `json:"label"`
	Path        string                  `json:"path"`
	Kind        FilesystemRootKind      `json:"kind"`
	Permissions FilesystemPermissionSet `json:"permissions"`
	Hidden      bool                    `json:"hidden,omitempty"`
	System      bool                    `json:"system,omitempty"`
}

type FilesystemPermissionSet struct {
	Read  bool `json:"read"`
	Write bool `json:"write"`
}

func (s *FilesystemScope) Validate() error {
	if s == nil {
		return nil
	}
	if s.SchemaVersion != FilesystemScopeSchemaVersionV1 {
		return fmt.Errorf("unsupported schema_version: %d", s.SchemaVersion)
	}
	if len(s.Roots) == 0 {
		return errors.New("missing roots")
	}
	seen := make(map[string]struct{}, len(s.Roots))
	for i, root := range s.Roots {
		id := strings.TrimSpace(root.ID)
		if id == "" {
			return fmt.Errorf("roots[%d].id is required", i)
		}
		if _, ok := seen[id]; ok {
			return fmt.Errorf("duplicate root id: %s", id)
		}
		seen[id] = struct{}{}
		if strings.TrimSpace(root.Label) == "" {
			return fmt.Errorf("roots[%d].label is required", i)
		}
		if strings.TrimSpace(root.Path) == "" {
			return fmt.Errorf("roots[%d].path is required", i)
		}
		switch root.Kind {
		case FilesystemRootHome, FilesystemRootComputer, FilesystemRootCustom:
		default:
			return fmt.Errorf("roots[%d].kind is invalid", i)
		}
		if !root.Permissions.Read && root.Permissions.Write {
			return fmt.Errorf("roots[%d].permissions.write requires read", i)
		}
	}
	defaultRootID := strings.TrimSpace(s.DefaultRootID)
	if defaultRootID != "" {
		if _, ok := seen[defaultRootID]; !ok {
			return fmt.Errorf("default_root_id references unknown root: %s", defaultRootID)
		}
	}
	return nil
}
