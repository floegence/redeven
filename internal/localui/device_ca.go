package localui

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

const (
	localUIDeviceCADirName  = "local-ui-tls"
	localUIDeviceCACertName = "device-ca.pem"
	localUIDeviceCAKeyName  = "device-ca-key.pem"
)

var (
	ErrLocalUIDeviceCAMissing   = errors.New("local UI device CA is missing")
	ErrLocalUIDeviceCAInvalid   = errors.New("local UI device CA is invalid")
	ErrLocalUIDeviceCAExpired   = errors.New("local UI device CA is expired")
	ErrLocalUIDeviceCAUntrusted = errors.New("local UI device CA is not trusted by this OS user")
	ErrLocalUIDeviceCAManual    = errors.New("local UI device CA requires manual trust installation")
)

// DeviceCAStatus is the stable, credential-free Local UI trust projection.
type DeviceCAStatus struct {
	Identity string `json:"identity"`
	Trust    string `json:"trust"`
	NotAfter string `json:"not_after,omitempty"`
	CertPath string `json:"certificate_path,omitempty"`
	Remedy   string `json:"remedy,omitempty"`
}

type deviceCA struct {
	certificate *x509.Certificate
	key         *ecdsa.PrivateKey
}

// GenerateLocalUIDeviceCA explicitly creates the persistent device-local CA.
// Runtime startup never calls this function.
func GenerateLocalUIDeviceCA(stateDir string) (DeviceCAStatus, error) {
	stateDir = filepath.Clean(strings.TrimSpace(stateDir))
	if stateDir == "" || stateDir == "." {
		return DeviceCAStatus{}, fmt.Errorf("%w: missing state directory", ErrLocalUIDeviceCAInvalid)
	}
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		return DeviceCAStatus{}, fmt.Errorf("create Local UI state directory: %w", err)
	}
	target := localUIDeviceCADir(stateDir)
	if _, err := os.Lstat(target); err == nil {
		return DeviceCAStatus{}, fmt.Errorf("%w: device CA already exists", ErrLocalUIDeviceCAInvalid)
	} else if !errors.Is(err, os.ErrNotExist) {
		return DeviceCAStatus{}, fmt.Errorf("inspect Local UI device CA: %w", err)
	}

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return DeviceCAStatus{}, fmt.Errorf("generate Local UI device CA key: %w", err)
	}
	serial, err := randomCertificateSerial()
	if err != nil {
		return DeviceCAStatus{}, err
	}
	now := time.Now().UTC()
	template := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{Organization: []string{"Redeven"}, CommonName: "Redeven Local UI Device CA"},
		NotBefore:             now.Add(-5 * time.Minute),
		NotAfter:              now.AddDate(5, 0, 0),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
		MaxPathLenZero:        true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		return DeviceCAStatus{}, fmt.Errorf("create Local UI device CA: %w", err)
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return DeviceCAStatus{}, fmt.Errorf("encode Local UI device CA key: %w", err)
	}

	temporary, err := os.MkdirTemp(stateDir, ".local-ui-tls-")
	if err != nil {
		return DeviceCAStatus{}, fmt.Errorf("prepare Local UI device CA: %w", err)
	}
	keepTemporary := false
	defer func() {
		if !keepTemporary {
			_ = os.RemoveAll(temporary)
		}
	}()
	if err := os.Chmod(temporary, 0o700); err != nil {
		return DeviceCAStatus{}, fmt.Errorf("secure Local UI device CA directory: %w", err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})
	if err := writeExclusiveFile(filepath.Join(temporary, localUIDeviceCACertName), certPEM, 0o644); err != nil {
		return DeviceCAStatus{}, err
	}
	if err := writeExclusiveFile(filepath.Join(temporary, localUIDeviceCAKeyName), keyPEM, 0o600); err != nil {
		return DeviceCAStatus{}, err
	}
	if err := os.Rename(temporary, target); err != nil {
		return DeviceCAStatus{}, fmt.Errorf("commit Local UI device CA: %w", err)
	}
	keepTemporary = true
	return inspectLocalUIDeviceCA(stateDir, false)
}

// InspectLocalUIDeviceCA reports the serving identity and platform-specific
// client-trust guidance without exposing the CA key or a generated certificate.
func InspectLocalUIDeviceCA(stateDir string) (DeviceCAStatus, error) {
	return inspectLocalUIDeviceCA(stateDir, true)
}

func inspectLocalUIDeviceCA(stateDir string, checkTrust bool) (DeviceCAStatus, error) {
	ca, err := loadLocalUIDeviceCA(stateDir)
	if err != nil {
		status := DeviceCAStatus{Identity: "invalid", Trust: "unknown", Remedy: "Regenerate the Local UI device CA after removing the invalid files."}
		if errors.Is(err, ErrLocalUIDeviceCAMissing) {
			status.Identity = "missing"
			status.Remedy = "Run `redeven local-authority device-ca generate --state-root <path>`."
		}
		if errors.Is(err, ErrLocalUIDeviceCAExpired) {
			status.Identity = "expired"
		}
		return status, err
	}
	status := DeviceCAStatus{
		Identity: "ready",
		Trust:    "unknown",
		NotAfter: ca.certificate.NotAfter.UTC().Format(time.RFC3339),
		CertPath: localUIDeviceCACertificatePath(stateDir),
	}
	if !checkTrust {
		return status, nil
	}
	if runtime.GOOS != "darwin" && runtime.GOOS != "windows" {
		status.Trust = "manual_required"
		status.Remedy = "Export the public CA certificate and import it into every browser or client trust store that will open this Local UI."
		return status, nil
	}
	if err := verifyLocalUIDeviceCATrust(ca); err != nil {
		status.Trust = "untrusted"
		status.Remedy = "Install the exported CA certificate for the current OS user, then restart Redeven."
		return status, err
	}
	status.Trust = "trusted"
	return status, nil
}

// ExportLocalUIDeviceCA writes only the public CA certificate.
func ExportLocalUIDeviceCA(stateDir, outputPath string) error {
	ca, err := loadLocalUIDeviceCA(stateDir)
	if err != nil {
		return err
	}
	outputPath = filepath.Clean(strings.TrimSpace(outputPath))
	if outputPath == "" || outputPath == "." {
		return fmt.Errorf("missing Local UI device CA export path")
	}
	body := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: ca.certificate.Raw})
	file, err := os.OpenFile(outputPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return fmt.Errorf("create Local UI device CA export: %w", err)
	}
	if _, err := file.Write(body); err != nil {
		_ = file.Close()
		return fmt.Errorf("write Local UI device CA export: %w", err)
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return fmt.Errorf("sync Local UI device CA export: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close Local UI device CA export: %w", err)
	}
	return nil
}

func localUIDeviceCACertificatePath(stateDir string) string {
	return filepath.Join(localUIDeviceCADir(stateDir), localUIDeviceCACertName)
}

// LocalUIDeviceCACertificatePath returns the public certificate path. The CA
// private key path is intentionally not exposed.
func LocalUIDeviceCACertificatePath(stateDir string) string {
	return localUIDeviceCACertificatePath(stateDir)
}

func localUIDeviceCADir(stateDir string) string {
	return filepath.Join(filepath.Clean(strings.TrimSpace(stateDir)), localUIDeviceCADirName)
}

func loadLocalUIDeviceCA(stateDir string) (*deviceCA, error) {
	dir := localUIDeviceCADir(stateDir)
	info, err := os.Lstat(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrLocalUIDeviceCAMissing
	}
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0o077 != 0 {
		return nil, fmt.Errorf("%w: unsafe device CA directory", ErrLocalUIDeviceCAInvalid)
	}
	certBody, err := readSecureDeviceCAFile(filepath.Join(dir, localUIDeviceCACertName), false)
	if err != nil {
		return nil, err
	}
	keyBody, err := readSecureDeviceCAFile(filepath.Join(dir, localUIDeviceCAKeyName), true)
	if err != nil {
		return nil, err
	}
	certBlock, rest := pem.Decode(certBody)
	if certBlock == nil || certBlock.Type != "CERTIFICATE" || len(strings.TrimSpace(string(rest))) != 0 {
		return nil, fmt.Errorf("%w: malformed device CA certificate", ErrLocalUIDeviceCAInvalid)
	}
	certificate, err := x509.ParseCertificate(certBlock.Bytes)
	if err != nil || !certificate.IsCA || !certificate.BasicConstraintsValid || certificate.KeyUsage&x509.KeyUsageCertSign == 0 {
		return nil, fmt.Errorf("%w: malformed device CA certificate", ErrLocalUIDeviceCAInvalid)
	}
	if err := certificate.CheckSignatureFrom(certificate); err != nil {
		return nil, fmt.Errorf("%w: device CA is not self-signed", ErrLocalUIDeviceCAInvalid)
	}
	now := time.Now()
	if now.Before(certificate.NotBefore) || !now.Before(certificate.NotAfter) {
		return nil, ErrLocalUIDeviceCAExpired
	}
	keyBlock, rest := pem.Decode(keyBody)
	if keyBlock == nil || keyBlock.Type != "PRIVATE KEY" || len(strings.TrimSpace(string(rest))) != 0 {
		return nil, fmt.Errorf("%w: malformed device CA key", ErrLocalUIDeviceCAInvalid)
	}
	parsedKey, err := x509.ParsePKCS8PrivateKey(keyBlock.Bytes)
	key, ok := parsedKey.(*ecdsa.PrivateKey)
	if err != nil || !ok || key == nil || key.Curve != elliptic.P256() {
		return nil, fmt.Errorf("%w: malformed device CA key", ErrLocalUIDeviceCAInvalid)
	}
	publicKey, ok := certificate.PublicKey.(*ecdsa.PublicKey)
	if !ok || !publicKey.Equal(&key.PublicKey) {
		return nil, fmt.Errorf("%w: device CA certificate and key do not match", ErrLocalUIDeviceCAInvalid)
	}
	return &deviceCA{certificate: certificate, key: key}, nil
}

func readSecureDeviceCAFile(path string, private bool) ([]byte, error) {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrLocalUIDeviceCAMissing
	}
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("%w: unsafe device CA file", ErrLocalUIDeviceCAInvalid)
	}
	if private && info.Mode().Perm()&0o077 != 0 {
		return nil, fmt.Errorf("%w: device CA key permissions are too broad", ErrLocalUIDeviceCAInvalid)
	}
	body, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read Local UI device CA: %w", err)
	}
	return body, nil
}

func newLocalUIServerCertificate(ca *deviceCA, hosts []string) (tls.Certificate, string, error) {
	if ca == nil || ca.certificate == nil || ca.key == nil {
		return tls.Certificate{}, "", ErrLocalUIDeviceCAInvalid
	}
	hosts = uniqueCertificateHosts(hosts)
	if len(hosts) == 0 {
		return tls.Certificate{}, "", fmt.Errorf("%w: missing Local UI certificate hosts", ErrLocalUIDeviceCAInvalid)
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, "", err
	}
	serial, err := randomCertificateSerial()
	if err != nil {
		return tls.Certificate{}, "", err
	}
	now := time.Now().UTC()
	template := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{Organization: []string{"Redeven"}, CommonName: "Redeven Local UI"},
		NotBefore:    now.Add(-2 * time.Minute),
		NotAfter:     now.Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	for _, host := range hosts {
		if ip := net.ParseIP(host); ip != nil {
			template.IPAddresses = append(template.IPAddresses, ip)
		} else {
			template.DNSNames = append(template.DNSNames, host)
		}
	}
	der, err := x509.CreateCertificate(rand.Reader, template, ca.certificate, &key.PublicKey, ca.key)
	if err != nil {
		return tls.Certificate{}, "", err
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return tls.Certificate{}, "", err
	}
	certificate, err := tls.X509KeyPair(
		pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}),
		pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER}),
	)
	if err != nil {
		return tls.Certificate{}, "", err
	}
	certificate.Leaf, _ = x509.ParseCertificate(der)
	return certificate, hosts[0], nil
}

func verifyLocalUIDeviceCATrust(ca *deviceCA) error {
	certificate, host, err := newLocalUIServerCertificate(ca, []string{"localhost"})
	if err != nil || certificate.Leaf == nil {
		return ErrLocalUIDeviceCAInvalid
	}
	roots, err := x509.SystemCertPool()
	if err != nil || roots == nil {
		return ErrLocalUIDeviceCAUntrusted
	}
	if _, err := certificate.Leaf.Verify(x509.VerifyOptions{
		Roots:     roots,
		DNSName:   host,
		KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}); err != nil {
		return ErrLocalUIDeviceCAUntrusted
	}
	return nil
}

func uniqueCertificateHosts(hosts []string) []string {
	unique := make(map[string]struct{}, len(hosts))
	for _, host := range hosts {
		host = strings.TrimSpace(strings.Trim(host, "[]"))
		if host == "" {
			continue
		}
		if ip := net.ParseIP(host); ip != nil {
			host = ip.String()
		} else {
			host = strings.ToLower(host)
		}
		unique[host] = struct{}{}
	}
	result := make([]string, 0, len(unique))
	for host := range unique {
		result = append(result, host)
	}
	sort.Strings(result)
	return result
}

func randomCertificateSerial() (*big.Int, error) {
	limit := new(big.Int).Lsh(big.NewInt(1), 128)
	serial, err := rand.Int(rand.Reader, limit)
	if err != nil {
		return nil, fmt.Errorf("generate certificate serial: %w", err)
	}
	if serial.Sign() == 0 {
		serial.SetInt64(1)
	}
	return serial, nil
}

func writeExclusiveFile(path string, body []byte, mode os.FileMode) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
	if err != nil {
		return fmt.Errorf("create %s: %w", filepath.Base(path), err)
	}
	if _, err := file.Write(body); err != nil {
		_ = file.Close()
		return fmt.Errorf("write %s: %w", filepath.Base(path), err)
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return fmt.Errorf("sync %s: %w", filepath.Base(path), err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close %s: %w", filepath.Base(path), err)
	}
	return nil
}
