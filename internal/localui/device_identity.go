package localui

import (
	"bytes"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/lockfile"
)

const maxCertificateFileSize = 1024 * 1024

// CertificateImport carries a PEM certificate chain and its matching key only
// through the privileged maintenance input. It is never part of a status report.
type CertificateImport struct {
	CertificatePEM string `json:"certificate_pem"`
	PrivateKeyPEM  string `json:"private_key_pem"`
}

func withDeviceIdentityLock(stateDir string, create bool, action func() error) error {
	if strings.TrimSpace(stateDir) == "" || filepath.Clean(stateDir) == "." {
		return ErrLocalUIDeviceCAInvalid
	}
	if create {
		if err := os.MkdirAll(stateDir, 0700); err != nil {
			return err
		}
	}
	if _, err := os.Stat(stateDir); errors.Is(err, os.ErrNotExist) {
		return ErrLocalUIDeviceCAMissing
	} else if err != nil {
		return err
	}
	lock, err := lockfile.Acquire(filepath.Join(stateDir, "device-ca.lock"))
	if err != nil {
		return err
	}
	defer lock.Release()
	target := localUIDeviceCADir(stateDir)
	previous := target + ".previous"
	// A process interruption before the new directory was committed restores the
	// previous complete identity. A committed directory always wins.
	if _, err := os.Lstat(previous); err == nil {
		if err := requireIdentityDirectory(previous); err != nil {
			return err
		}
		if _, err := os.Lstat(target); errors.Is(err, os.ErrNotExist) {
			if err := os.Rename(previous, target); err != nil {
				return err
			}
		} else if err != nil {
			return err
		} else {
			if err := requireIdentityDirectory(target); err != nil {
				return err
			}
			if err := os.RemoveAll(previous); err != nil {
				return err
			}
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return action()
}

func requireIdentityDirectory(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0077 != 0 {
		return fmt.Errorf("%w: unsafe certificate directory", ErrLocalUIDeviceCAInvalid)
	}
	return nil
}

func deviceIdentityKind(dir string) (string, error) {
	body, err := readSecureDeviceCAFile(filepath.Join(dir, "identity-kind"), false)
	if errors.Is(err, ErrLocalUIDeviceCAInvalid) {
		if _, statErr := os.Lstat(filepath.Join(dir, "identity-kind")); errors.Is(statErr, os.ErrNotExist) {
			return "device_ca", nil
		}
	}
	if err != nil {
		return "", err
	}
	kind := strings.TrimSpace(string(body))
	if kind != "device_ca" && kind != "server" && kind != "removed" {
		return "", ErrLocalUIDeviceCAInvalid
	}
	return kind, nil
}

// replaceDeviceIdentity publishes a complete pair under the same maintenance
// lock used by readers. The previous pair is retained until commit succeeds.
func replaceDeviceIdentity(stateDir, staged string, rename func(string, string) error) error {
	target := localUIDeviceCADir(stateDir)
	previous := target + ".previous"
	existed := false
	if _, err := os.Lstat(target); err == nil {
		if err := requireIdentityDirectory(target); err != nil {
			return err
		}
		if err := rename(target, previous); err != nil {
			return err
		}
		existed = true
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := rename(staged, target); err != nil {
		if existed {
			if rollbackErr := os.Rename(previous, target); rollbackErr != nil {
				return fmt.Errorf("certificate commit failed; recovery required: %w", rollbackErr)
			}
		}
		return err
	}
	if existed {
		if err := os.RemoveAll(previous); err != nil {
			return fmt.Errorf("certificate updated; previous identity cleanup failed: %w", err)
		}
	}
	return nil
}

func mutateLocalUIDeviceIdentity(stateDir, operation string, input *CertificateImport) (DeviceCAStatus, error) {
	var result DeviceCAStatus
	err := withDeviceIdentityLock(stateDir, true, func() error {
		root, err := os.MkdirTemp(stateDir, ".certificate-operation-")
		if err != nil {
			return err
		}
		defer os.RemoveAll(root)
		staged := localUIDeviceCADir(root)
		if operation == "regenerate" {
			if _, err := generateLocalUIDeviceCAUnlocked(root); err != nil {
				return err
			}
		} else {
			if err := os.Mkdir(staged, 0700); err != nil {
				return err
			}
			if operation == "remove" {
				if err := writeExclusiveFile(filepath.Join(staged, "identity-kind"), []byte("removed\n"), 0600); err != nil {
					return err
				}
			} else {
				if input == nil || len(input.CertificatePEM) == 0 || len(input.PrivateKeyPEM) == 0 || len(input.CertificatePEM) > maxCertificateFileSize || len(input.PrivateKeyPEM) > maxCertificateFileSize {
					return fmt.Errorf("%w: select a PEM certificate and its matching unencrypted private key (at most 1 MiB each)", ErrLocalUIDeviceCAInvalid)
				}
				pair, err := strictCertificatePair([]byte(input.CertificatePEM), []byte(input.PrivateKeyPEM))
				if err != nil {
					return fmt.Errorf("%w: certificate and private key are malformed, encrypted, or do not match", ErrLocalUIDeviceCAInvalid)
				}
				cert, err := x509.ParseCertificate(pair.Certificate[0])
				if err != nil {
					return ErrLocalUIDeviceCAInvalid
				}
				kind := "server"
				if cert.IsCA {
					kind = "device_ca"
				}
				for name, body := range map[string]string{localUIDeviceCACertName: input.CertificatePEM, localUIDeviceCAKeyName: input.PrivateKeyPEM, "identity-kind": kind} {
					if err := writeExclusiveFile(filepath.Join(staged, name), []byte(body), 0600); err != nil {
						return err
					}
				}
				if _, err := loadLocalUIDeviceCAUnlocked(root); err != nil {
					return err
				}
			}
		}
		if err := replaceDeviceIdentity(stateDir, staged, os.Rename); err != nil {
			return err
		}
		if operation == "remove" {
			result = DeviceCAStatus{Identity: "missing", Trust: "unknown"}
			return nil
		}
		result, err = inspectLocalUIDeviceCAUnlocked(stateDir, false)
		return err
	})
	return result, err
}

func ImportLocalUICertificate(stateDir string, input CertificateImport) (DeviceCAStatus, error) {
	return mutateLocalUIDeviceIdentity(stateDir, "import", &input)
}
func RegenerateLocalUIDeviceCA(stateDir string) (DeviceCAStatus, error) {
	return mutateLocalUIDeviceIdentity(stateDir, "regenerate", nil)
}
func RemoveLocalUICertificate(stateDir string) (DeviceCAStatus, error) {
	return mutateLocalUIDeviceIdentity(stateDir, "remove", nil)
}

func parseImportedServerCertificate(certBody, keyBody []byte) (*deviceCA, error) {
	pair, err := strictCertificatePair(certBody, keyBody)
	if err != nil {
		return nil, fmt.Errorf("%w: certificate and key do not match", ErrLocalUIDeviceCAInvalid)
	}
	for i, der := range pair.Certificate {
		cert, err := x509.ParseCertificate(der)
		if err != nil {
			return nil, ErrLocalUIDeviceCAInvalid
		}
		if time.Now().Before(cert.NotBefore) {
			return nil, ErrLocalUIDeviceCANotYetValid
		}
		if !time.Now().Before(cert.NotAfter) {
			return nil, ErrLocalUIDeviceCAExpired
		}
		if i == 0 {
			pair.Leaf = cert
		} else {
			child, _ := x509.ParseCertificate(pair.Certificate[i-1])
			if child.CheckSignatureFrom(cert) != nil {
				return nil, fmt.Errorf("%w: invalid certificate chain", ErrLocalUIDeviceCAInvalid)
			}
		}
	}
	if pair.Leaf.KeyUsage != 0 && pair.Leaf.KeyUsage&x509.KeyUsageDigitalSignature == 0 {
		return nil, fmt.Errorf("%w: certificate does not allow TLS signatures", ErrLocalUIDeviceCAInvalid)
	}
	if len(pair.Leaf.UnhandledCriticalExtensions) > 0 {
		return nil, fmt.Errorf("%w: unsupported critical certificate extension", ErrLocalUIDeviceCAInvalid)
	}
	if pair.Leaf.IsCA {
		return nil, ErrLocalUIDeviceCAInvalid
	}
	if len(pair.Leaf.DNSNames)+len(pair.Leaf.IPAddresses) == 0 {
		return nil, fmt.Errorf("%w: the server certificate requires DNS or IP subject alternative names", ErrLocalUIDeviceCAInvalid)
	}
	if len(pair.Leaf.ExtKeyUsage) > 0 {
		allowed := false
		for _, usage := range pair.Leaf.ExtKeyUsage {
			allowed = allowed || usage == x509.ExtKeyUsageServerAuth || usage == x509.ExtKeyUsageAny
		}
		if !allowed {
			return nil, fmt.Errorf("%w: certificate does not allow server authentication", ErrLocalUIDeviceCAInvalid)
		}
	}
	var publicPEM []byte
	for _, der := range pair.Certificate {
		publicPEM = append(publicPEM, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})...)
	}
	return &deviceCA{certificate: pair.Leaf, serverCertificate: &pair, certificatePEM: publicPEM}, nil
}

func deviceIdentityFingerprint(ca *deviceCA) string {
	if ca == nil || ca.certificate == nil {
		return ""
	}
	sum := sha256.Sum256(ca.certificate.Raw)
	return hex.EncodeToString(sum[:])
}

// Certificate chain changes also require restart even when the leaf fingerprint
// is unchanged (for example, replacing an intermediate certificate).
func deviceIdentityServingFingerprint(ca *deviceCA) string {
	if ca == nil || ca.serverCertificate == nil {
		return deviceIdentityFingerprint(ca)
	}
	digest := sha256.New()
	for _, der := range ca.serverCertificate.Certificate {
		_, _ = digest.Write(der)
	}
	return hex.EncodeToString(digest.Sum(nil))
}

// Reject skipped PEM blocks and text so the public certificate can never carry
// private material. Key parsing and algorithm matching remain owned by crypto/tls.
func strictCertificatePair(certBody, keyBody []byte) (tls.Certificate, error) {
	invalid := fmt.Errorf("%w: select only PEM certificates and one unencrypted private key", ErrLocalUIDeviceCAInvalid)
	remaining := bytes.TrimSpace(certBody)
	count := 0
	for len(remaining) > 0 {
		if !bytes.HasPrefix(remaining, []byte("-----BEGIN CERTIFICATE-----")) {
			return tls.Certificate{}, invalid
		}
		block, rest := pem.Decode(remaining)
		if block == nil || block.Type != "CERTIFICATE" || len(block.Headers) > 0 || bytes.Count(remaining[:len(remaining)-len(rest)], []byte("-----BEGIN ")) != 1 {
			return tls.Certificate{}, invalid
		}
		count++
		remaining = bytes.TrimSpace(rest)
	}
	keyBody = bytes.TrimSpace(keyBody)
	if count == 0 || !bytes.HasPrefix(keyBody, []byte("-----BEGIN ")) {
		return tls.Certificate{}, invalid
	}
	block, rest := pem.Decode(keyBody)
	if block == nil || len(bytes.TrimSpace(rest)) != 0 || len(block.Headers) > 0 || bytes.Count(keyBody, []byte("-----BEGIN ")) != 1 {
		return tls.Certificate{}, invalid
	}
	switch block.Type {
	case "PRIVATE KEY", "RSA PRIVATE KEY", "EC PRIVATE KEY":
	default:
		return tls.Certificate{}, invalid
	}
	return tls.X509KeyPair(certBody, keyBody)
}

// ValidateLocalUICertificateForBind checks the saved identity without binding a
// port or interrupting the current Runtime. Startup repeats the check against
// its actual listener authorities.
func ValidateLocalUICertificateForBind(stateDir, rawBind string) error {
	bind, err := ParseBind(rawBind)
	if err != nil {
		return err
	}
	ca, err := loadLocalUIDeviceCA(stateDir)
	if err != nil {
		return err
	}
	hosts := []string{bind.Host()}
	if bind.localhost {
		hosts = []string{"localhost", "127.0.0.1", "::1"}
	}
	if bind.IsNetworkExposure() {
		addresses, err := resolveNetworkAccessHosts(bind)
		if err != nil {
			return err
		}
		hosts = nil
		for _, addr := range addresses {
			hosts = append(hosts, addr.String())
		}
	}
	_, _, err = newLocalUIServerCertificate(ca, hosts)
	return err
}
