package gatewaycloud

type CertificateRotation struct {
	RequestPublicID           string `json:"request_public_id"`
	PreviousCertificateSHA256 string `json:"previous_certificate_sha256"`
	ClientCertificateSHA256   string `json:"client_certificate_sha256"`
}

type LocalCertificateRenewal struct {
	RequestPublicID string `json:"request_public_id"`
	CSRPEM          string `json:"csr_pem"`
}
