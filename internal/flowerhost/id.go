package flowerhost

import (
	"crypto/rand"
	"encoding/base64"
)

func randomToken(prefix string, n int) (string, error) {
	if n <= 0 {
		n = 18
	}
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return prefix + base64.RawURLEncoding.EncodeToString(b), nil
}

func newHostID() (string, error) {
	id, err := randomToken("", 18)
	if err != nil {
		return "", err
	}
	return "flower-host:" + id, nil
}

func newDecisionID() (string, error) {
	return randomToken("frd_", 18)
}
