package gatewaycloud

// UserMigrationConsent is signed by the new identity and submitted through the authenticated old control session.
type UserMigrationConsent struct {
	TargetRequestPublicID string `json:"target_request_public_id"`
	EnvPublicID           string `json:"env_public_id"`
	Generation            int64  `json:"generation"`
}

// UserMigrationWitness is built by Region from a real control connection, never a public caller.
type UserMigrationWitness struct {
	Proof             SignedRequest `json:"proof"`
	ProviderID        string        `json:"provider_id"`
	UserPublicID      string        `json:"user_public_id"`
	RuntimePublicID   string        `json:"runtime_public_id"`
	NamespacePublicID string        `json:"namespace_public_id"`
	EnvPublicID       string        `json:"env_public_id"`
	Generation        int64         `json:"generation"`
}

type UserMigrationSource struct {
	EnvPublicID string `json:"env_public_id"`
	Generation  int64  `json:"generation"`
}

type UserMigrationApproval struct {
	TargetRequestPublicID string              `json:"target_request_public_id"`
	Current               UserMigrationSource `json:"current"`
}
