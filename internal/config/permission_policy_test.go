package config

import "testing"

func TestPermissionPolicyResolveCap(t *testing.T) {
	t.Parallel()

	all := PermissionSet{Read: true, Write: true, Execute: true}
	readOnly := PermissionSet{Read: true}
	executeOnly := PermissionSet{Execute: true}
	readExecute := PermissionSet{Read: true, Execute: true}

	tests := []struct {
		name    string
		policy  *PermissionPolicy
		userID  string
		floeApp string
		want    PermissionSet
	}{
		{
			name:   "nil policy uses default",
			policy: nil,
			want:   all,
		},
		{
			name:   "nil local max uses default",
			policy: &PermissionPolicy{SchemaVersion: permissionPolicySchemaVersionV1},
			want:   all,
		},
		{
			name: "by user match narrows local max",
			policy: &PermissionPolicy{
				SchemaVersion: permissionPolicySchemaVersionV1,
				LocalMax:      &all,
				ByUser: map[string]*PermissionSet{
					"user_1": &readOnly,
				},
			},
			userID: " user_1 ",
			want:   readOnly,
		},
		{
			name: "empty user does not match by user",
			policy: &PermissionPolicy{
				SchemaVersion: permissionPolicySchemaVersionV1,
				LocalMax:      &all,
				ByUser: map[string]*PermissionSet{
					"":       &readOnly,
					"user_1": &readOnly,
				},
			},
			userID: " ",
			want:   all,
		},
		{
			name: "by app match narrows local max",
			policy: &PermissionPolicy{
				SchemaVersion: permissionPolicySchemaVersionV1,
				LocalMax:      &all,
				ByApp: map[string]*PermissionSet{
					"com.example.app": &executeOnly,
				},
			},
			floeApp: " com.example.app ",
			want:    executeOnly,
		},
		{
			name: "local direct empty user still honors by app without by user wildcard",
			policy: &PermissionPolicy{
				SchemaVersion: permissionPolicySchemaVersionV1,
				LocalMax:      &all,
				ByUser: map[string]*PermissionSet{
					"":       &readOnly,
					"user_1": &readOnly,
				},
				ByApp: map[string]*PermissionSet{
					"com.example.local": &executeOnly,
				},
			},
			userID:  "",
			floeApp: "com.example.local",
			want:    executeOnly,
		},
		{
			name: "by user and by app intersection wins",
			policy: &PermissionPolicy{
				SchemaVersion: permissionPolicySchemaVersionV1,
				LocalMax:      &all,
				ByUser: map[string]*PermissionSet{
					"user_1": &readExecute,
				},
				ByApp: map[string]*PermissionSet{
					"com.example.app": &executeOnly,
				},
			},
			userID:  "user_1",
			floeApp: "com.example.app",
			want:    executeOnly,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			if got := tt.policy.ResolveCap(tt.userID, tt.floeApp); got != tt.want {
				t.Fatalf("ResolveCap() = %#v, want %#v", got, tt.want)
			}
		})
	}
}
