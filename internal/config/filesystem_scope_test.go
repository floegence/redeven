package config

import (
	"strings"
	"testing"
)

func TestFilesystemScopeValidate(t *testing.T) {
	t.Parallel()

	validRoot := FilesystemRootPolicy{
		ID:          "home",
		Label:       "Home",
		Path:        "/tmp",
		Kind:        FilesystemRootHome,
		Permissions: FilesystemPermissionSet{Read: true, Write: true},
	}

	tests := []struct {
		name    string
		scope   *FilesystemScope
		wantErr string
	}{
		{
			name: "valid",
			scope: &FilesystemScope{
				SchemaVersion: FilesystemScopeSchemaVersionV1,
				DefaultRootID: "home",
				Roots:         []FilesystemRootPolicy{validRoot},
			},
		},
		{
			name: "unsupported schema",
			scope: &FilesystemScope{
				SchemaVersion: 99,
				Roots:         []FilesystemRootPolicy{validRoot},
			},
			wantErr: "unsupported schema_version",
		},
		{
			name: "duplicate root id",
			scope: &FilesystemScope{
				SchemaVersion: FilesystemScopeSchemaVersionV1,
				Roots:         []FilesystemRootPolicy{validRoot, validRoot},
			},
			wantErr: "duplicate root id",
		},
		{
			name: "missing path",
			scope: &FilesystemScope{
				SchemaVersion: FilesystemScopeSchemaVersionV1,
				Roots: []FilesystemRootPolicy{{
					ID:          "home",
					Label:       "Home",
					Kind:        FilesystemRootHome,
					Permissions: FilesystemPermissionSet{Read: true},
				}},
			},
			wantErr: "path is required",
		},
		{
			name: "write requires read",
			scope: &FilesystemScope{
				SchemaVersion: FilesystemScopeSchemaVersionV1,
				Roots: []FilesystemRootPolicy{{
					ID:          "custom",
					Label:       "Custom",
					Path:        "/tmp/custom",
					Kind:        FilesystemRootCustom,
					Permissions: FilesystemPermissionSet{Read: false, Write: true},
				}},
			},
			wantErr: "permissions.write requires read",
		},
		{
			name: "unknown default root",
			scope: &FilesystemScope{
				SchemaVersion: FilesystemScopeSchemaVersionV1,
				DefaultRootID: "missing",
				Roots:         []FilesystemRootPolicy{validRoot},
			},
			wantErr: "default_root_id references unknown root",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			err := tt.scope.Validate()
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("Validate() error = %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("Validate() error = %v, want substring %q", err, tt.wantErr)
			}
		})
	}
}
