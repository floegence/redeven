package gatewaycloud

type UserMigrationConsent struct {
	TargetRequestPublicID string `json:"target_request_public_id"`
	EnvPublicID           string `json:"env_public_id"`
	Generation            int64  `json:"generation"`
}

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
